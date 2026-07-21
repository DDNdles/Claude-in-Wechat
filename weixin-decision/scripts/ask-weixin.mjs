#!/usr/bin/env node
/**
 * Ask a decision question via WeChat and wait for the user's reply.
 *
 * Usage:
 *   node ask-weixin.mjs [--timeout SEC] "question" "optionA" ["optionB" ...]
 *
 * Blocks until user replies or timeout. Outputs JSON result to stdout.
 * All diagnostic messages go to stderr — only JSON on stdout for clean piping.
 *
 * Exit codes: 0 = got reply, 1 = timeout, 2 = config/usage error
 *
 * Output JSON (always a single line on stdout):
 *   {"ok":true,"index":0,"label":"选项A","rawReply":"1"}
 *   {"ok":false,"reason":"timeout"}
 *   {"ok":false,"reason":"no_account"}
 *   {"ok":false,"reason":"error","error":"..."}
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const CTI_HOME = process.env.CTI_HOME || path.join(process.env.HOME || process.env.USERPROFILE, '.claude-to-im');
const ACCOUNTS_FILE = path.join(CTI_HOME, 'data', 'weixin-accounts.json');
const TOKENS_FILE = path.join(CTI_HOME, 'data', 'weixin-context-tokens.json');

const log = (...args) => process.stderr.write(args.join(' ') + '\n');

function generateWechatUin() {
  return crypto.randomBytes(4).toString('base64');
}

function generateClientId() {
  return `cti-ask-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

// ── Parse args ──

const args = process.argv.slice(2);
let timeoutSec = 120;
const positionalArgs = [];

for (let i = 0; i < args.length; i++) {
  if ((args[i] === '--timeout' || args[i] === '-t') && i + 1 < args.length) {
    timeoutSec = Math.max(10, parseInt(args[++i], 10) || 120);
  } else if (!args[i].startsWith('-')) {
    positionalArgs.push(args[i]);
  }
}

if (positionalArgs.length < 2) {
  log('Usage: node ask-weixin.mjs [--timeout SEC] "question" "optionA" ["optionB" ...]');
  console.log(JSON.stringify({ ok: false, reason: 'usage' }));
  process.exit(2);
}

const question = positionalArgs[0];
const options = positionalArgs.slice(1);

if (options.length > 9) {
  log('Error: Maximum 9 options supported.');
  console.log(JSON.stringify({ ok: false, reason: 'too_many_options' }));
  process.exit(2);
}

// ── Load credentials ──

let accounts;
try {
  accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8'));
} catch {
  log('Error: No WeChat account data found at', ACCOUNTS_FILE);
  console.log(JSON.stringify({ ok: false, reason: 'no_account' }));
  process.exit(2);
}

if (!Array.isArray(accounts) || accounts.length === 0) {
  log('Error: No linked WeChat accounts.');
  console.log(JSON.stringify({ ok: false, reason: 'no_account' }));
  process.exit(2);
}

const acct = accounts[0];
const token = acct.token;
const baseUrl = (acct.baseUrl || 'https://ilinkai.weixin.qq.com').replace(/\/+$/, '');
const toUserId = acct.userId;

let contextToken = '';
try {
  const tokens = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf-8'));
  contextToken = tokens[acct.accountId] || '';
} catch { /* ok */ }

// ── Build message ──

const optionLines = options.map((opt, i) => `${i + 1}. ${opt}`);
const messageText = [
  `[决策] ${question}`,
  '',
  ...optionLines,
  '',
  `回复数字序号即可 (${timeoutSec}s 后超时)`,
].join('\n');

// ── API helpers ──

async function apiCall(endpoint, body, timeoutMs = 15000) {
  const url = `${baseUrl}/ilink/bot/${endpoint}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'AuthorizationType': 'ilink_bot_token',
      'Authorization': `Bearer ${token}`,
      'X-WECHAT-UIN': generateWechatUin(),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`API ${endpoint}: ${res.status} ${raw.slice(0, 200)}`);
  return raw ? JSON.parse(raw) : {};
}

async function sendMessage(text) {
  return apiCall('sendmessage', {
    msg: {
      from_user_id: '',
      to_user_id: toUserId,
      client_id: generateClientId(),
      message_type: 2,
      message_state: 2,
      item_list: [{ type: 1, text_item: { text } }],
      context_token: contextToken || undefined,
    },
    base_info: { channel_version: 'claude-to-im-skill-weixin/1.0' },
  });
}

async function pollUpdates(cursor, timeoutMs = 30000) {
  try {
    return await apiCall('getupdates', {
      get_updates_buf: cursor || '',
      base_info: { channel_version: 'claude-to-im-skill-weixin/1.0' },
    }, timeoutMs + 5000);
  } catch (err) {
    if (err.name === 'TimeoutError' || err.message?.includes('timeout')) {
      return { msgs: [], get_updates_buf: cursor };
    }
    throw err;
  }
}

// ── Reply matching ──

function matchReply(text, options) {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // 1. Exact number: "1", "2"
  const numMatch = trimmed.match(/^(\d+)\s*$/);
  if (numMatch) {
    const n = parseInt(numMatch[1], 10);
    if (n >= 1 && n <= options.length) return n - 1;
  }

  // 2. Chinese number prefix: "选项1", "第2个", "选3", "1选项"
  const cnMatch = trimmed.match(/(?:选项?|第)\s*(\d+)/);
  if (cnMatch) {
    const n = parseInt(cnMatch[1], 10);
    if (n >= 1 && n <= options.length) return n - 1;
  }

  // 3. Number anywhere: "我选第1个", "第一个"
  const anyNum = trimmed.match(/(\d+)/);
  if (anyNum) {
    const n = parseInt(anyNum[1], 10);
    if (n >= 1 && n <= options.length) return n - 1;
  }

  // 4. Chinese numerals: 一 二 三 四 五 六 七 八 九
  const wordMap = { '一': 0, '二': 1, '三': 2, '四': 3, '五': 4, '六': 5, '七': 6, '八': 7, '九': 8 };
  for (const [word, idx] of Object.entries(wordMap)) {
    if (trimmed.includes(word) && idx < options.length) return idx;
  }

  // 5. Label substring match (case-insensitive), longest match wins
  const lower = trimmed.toLowerCase();
  let bestIdx = null;
  let bestLen = 0;
  for (let i = 0; i < options.length; i++) {
    const optLower = options[i].toLowerCase();
    if (lower.includes(optLower) && optLower.length > bestLen) {
      bestIdx = i;
      bestLen = optLower.length;
    }
  }
  if (bestIdx !== null) return bestIdx;

  return null;
}

// ── Main ──

async function main() {
  log(`[ask-weixin] Sending decision (${timeoutSec}s timeout)...`);
  const sendResult = await sendMessage(messageText);
  log(`[ask-weixin] Sent OK (msg_id: ${sendResult.message_id || '?'})`);

  let cursor = '';
  const deadline = Date.now() + timeoutSec * 1000;

  while (Date.now() < deadline) {
    const remaining = Math.min(30000, Math.max(5000, deadline - Date.now() + 1000));

    try {
      const resp = await pollUpdates(cursor, remaining);

      for (const msg of resp.msgs || []) {
        if (msg.from_user_id !== toUserId) continue;

        let text = '';
        for (const item of msg.item_list || []) {
          if (item.type === 1 && item.text_item?.text) {
            text += item.text_item.text;
          }
        }
        text = text.trim();
        if (!text) continue;

        const matched = matchReply(text, options);
        if (matched !== null) {
          const label = options[matched];
          log(`[ask-weixin] Reply: "${text}" => #${matched + 1} "${label}"`);

          console.log(JSON.stringify({ ok: true, index: matched, label, rawReply: text }));
          process.exit(0);
        }

        // User replied but didn't match any option — silently skip
        // (could be a reply to a different conversation)
      }

      if (resp.get_updates_buf) cursor = resp.get_updates_buf;
    } catch (err) {
      log(`[ask-weixin] Poll error: ${err.message}`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  log(`[ask-weixin] Timeout after ${timeoutSec}s`);
  console.log(JSON.stringify({ ok: false, reason: 'timeout' }));
  process.exit(1);
}

main().catch((err) => {
  log(`[ask-weixin] Fatal: ${err.message}`);
  console.log(JSON.stringify({ ok: false, reason: 'error', error: err.message }));
  process.exit(1);
});