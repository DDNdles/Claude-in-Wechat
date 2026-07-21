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

import {
  loadWeixinAccount,
  loadContextToken,
  sendMessage,
  pollUpdates,
  matchReply,
  formatDecisionMsg,
  readRecentInboundMessages,
  readBridgeMessages,
} from '../lib/weixin-client.mjs';

const log = (...args) => process.stderr.write('[ask-weixin] ' + args.join(' ') + '\n');

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

let account;
try {
  account = loadWeixinAccount();
} catch (err) {
  log(`Error: ${err.message}`);
  console.log(JSON.stringify({ ok: false, reason: 'no_account' }));
  process.exit(2);
}

const toUserId = account.userId;
const contextToken = loadContextToken(account.accountId);

// ── Build message ──

const messageText = formatDecisionMsg(question, options, timeoutSec);

// ── Main ──

async function main() {
  log(`Sending decision (${timeoutSec}s timeout)...`);
  const sendResult = await sendMessage(account, toUserId, messageText, contextToken);
  log(`Sent OK (msg_id: ${sendResult.message_id || '?'})`);

  // Record when we sent the message, to filter for replies that came after
  const sendTime = Date.now();
  let cursor = '';
  const deadline = sendTime + timeoutSec * 1000;
  let lastAuditCheck = 0;

  // Helper: check a text string against options, exit if matched
  const checkReply = (text, source) => {
    text = (text || '').trim();
    if (!text) return false;
    const matched = matchReply(text, options);
    if (matched === null) return false;
    const label = options[matched];
    log(`Reply (${source}): "${text}" => #${matched + 1} "${label}"`);
    sendMessage(account, toUserId, `收到 (${matched + 1})`, contextToken).catch(() => {});
    console.log(JSON.stringify({ ok: true, index: matched, label, rawReply: text }));
    process.exit(0);
  };

  while (Date.now() < deadline) {
    const remaining = Math.min(30000, Math.max(5000, deadline - Date.now() + 1000));

    // Strategy 1: Poll WeChat API
    try {
      const resp = await pollUpdates(account, '', Math.min(remaining, 5000));
      for (const msg of resp.msgs || []) {
        if (msg.from_user_id !== toUserId) continue;
        let text = '';
        for (const item of msg.item_list || []) {
          if (item.type === 1 && item.text_item?.text) text += item.text_item.text;
        }
        if (checkReply(text, 'API')) return;
      }
      if (resp.get_updates_buf) cursor = resp.get_updates_buf;
    } catch (err) {
      log(`Poll error: ${err.message}`);
    }

    // Strategy 2: Check bridge audit log (every 1s)
    if (Date.now() - lastAuditCheck > 1000) {
      lastAuditCheck = Date.now();
      // 2a: audit summary
      for (const msg of readRecentInboundMessages(toUserId, sendTime)) {
        if (checkReply(msg.text, 'audit')) return;
      }
      // 2b: bridge message store (full text)
      for (const msg of readBridgeMessages(account.accountId, toUserId, sendTime)) {
        if (checkReply(msg.text, 'store')) return;
      }
    }

    await new Promise(r => setTimeout(r, 500));
  }

  log(`Timeout after ${timeoutSec}s`);
  console.log(JSON.stringify({ ok: false, reason: 'timeout' }));
  process.exit(1);
}

main().catch((err) => {
  log(`Fatal: ${err.message}`);
  console.log(JSON.stringify({ ok: false, reason: 'error', error: err.message }));
  process.exit(1);
});