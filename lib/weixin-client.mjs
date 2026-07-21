/**
 * Shared WeChat iLink Bot API client.
 *
 * Extracted from ask-weixin.mjs / send-weixin.mjs / hook-guard.mjs to
 * eliminate code duplication. All scripts import from here.
 *
 * Uses the WeChat iLink Bot API:
 *   POST /ilink/bot/sendmessage  — send text messages
 *   POST /ilink/bot/getupdates   — long-poll for incoming messages
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { homedir } from 'node:os';

// ── Paths ──

export const CTI_HOME =
  process.env.CTI_HOME || path.join(homedir(), '.claude-to-im');

export const ACCOUNTS_FILE = path.join(CTI_HOME, 'data', 'weixin-accounts.json');
export const TOKENS_FILE = path.join(CTI_HOME, 'data', 'weixin-context-tokens.json');
export const PROGRESS_FILE = path.join(CTI_HOME, 'runtime', 'progress-state.json');

/** Logger: writes to stderr so stdout stays clean for JSON output. */
const log = (...args) => process.stderr.write(args.join(' ') + '\n');

// ── Helpers ──

/** Generate a random 4-byte base64 string for the X-WECHAT-UIN header. */
export function generateWechatUin() {
  return crypto.randomBytes(4).toString('base64');
}

/**
 * Generate a unique client ID.
 * @param {string} prefix — e.g. 'cti-ask', 'cti-guard'
 */
export function generateClientId(prefix = 'cti') {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

// ── Credential loading ──

/**
 * Load the first (and usually only) WeChat account from the accounts file.
 * @returns {{ token: string, baseUrl: string, userId: string, accountId: string }}
 * @throws If no account file or empty accounts
 */
export function loadWeixinAccount() {
  let accounts;
  try {
    accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8'));
  } catch {
    throw new Error(`No WeChat account data at ${ACCOUNTS_FILE}`);
  }
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error('No linked WeChat accounts');
  }
  const acct = accounts[0];
  return {
    token: acct.token,
    baseUrl: (acct.baseUrl || 'https://ilinkai.weixin.qq.com').replace(/\/+$/, ''),
    userId: acct.userId,
    accountId: acct.accountId,
  };
}

/**
 * Load the context token for the given account.
 */
export function loadContextToken(accountId) {
  try {
    const tokens = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf-8'));
    return tokens[accountId] || '';
  } catch {
    return '';
  }
}

// ── API calls ──

/**
 * Make an authenticated POST to the WeChat iLink Bot API.
 * @param {string} baseUrl
 * @param {string} token
 * @param {string} endpoint — e.g. 'sendmessage', 'getupdates'
 * @param {object} body
 * @param {number} timeoutMs
 * @returns {Promise<object>} parsed JSON response
 */
export async function apiCall(baseUrl, token, endpoint, body, timeoutMs = 15000) {
  const url = `${baseUrl}/ilink/bot/${endpoint}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      AuthorizationType: 'ilink_bot_token',
      Authorization: `Bearer ${token}`,
      'X-WECHAT-UIN': generateWechatUin(),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`API ${endpoint}: ${res.status} ${raw.slice(0, 200)}`);
  }
  return raw ? JSON.parse(raw) : {};
}

/**
 * Send a text message via WeChat.
 */
export async function sendMessage(account, toUserId, text, contextToken) {
  return apiCall(account.baseUrl, account.token, 'sendmessage', {
    msg: {
      from_user_id: '',
      to_user_id: toUserId,
      client_id: generateClientId('cti-msg'),
      message_type: 2,
      message_state: 2,
      item_list: [{ type: 1, text_item: { text } }],
      context_token: contextToken || undefined,
    },
    base_info: { channel_version: 'claude-to-im-skill-weixin/1.1' },
  });
}

/**
 * Long-poll for incoming WeChat messages.
 * @param {object} account — { baseUrl, token }
 * @param {string} cursor — get_updates_buf from previous response
 * @param {number} timeoutMs — max wait before returning empty
 * @returns {Promise<{ msgs: Array, get_updates_buf: string }>}
 */
export async function pollUpdates(account, cursor, timeoutMs = 30000) {
  try {
    return await apiCall(account.baseUrl, account.token, 'getupdates', {
      get_updates_buf: cursor || '',
      base_info: { channel_version: 'claude-to-im-skill-weixin/1.1' },
    }, timeoutMs + 5000);
  } catch (err) {
    if (err.name === 'TimeoutError' || err.message?.includes('timeout')) {
      return { msgs: [], get_updates_buf: cursor };
    }
    throw err;
  }
}

// ── Reply matching ──

/**
 * Try to match a user's reply text to one of the provided options.
 *
 * Matching rules (in priority order):
 *   1. Exact number: "1", "2"
 *   2. Chinese number prefix: "选项1", "第2个", "选3"
 *   3. Number anywhere: "我选第1个"
 *   4. Chinese numerals: 一～九
 *   5. Label substring match (case-insensitive, longest wins)
 *
 * Multi-select mode: if `multiSelect` is true, returns array of indices.
 *
 * @param {string} text — raw WeChat reply text
 * @param {string[]} options — option labels
 * @param {boolean} [multiSelect=false]
 * @returns {number|null|number[]} zero-based index, array of indices, or null
 */
export function matchReply(text, options, multiSelect = false) {
  const trimmed = text.trim();
  if (!trimmed) return multiSelect ? [] : null;

  // Multi-select: parse comma-separated numbers, e.g. "1,3"
  if (multiSelect) {
    const indices = new Set();
    // Try to parse all digit sequences
    const parts = trimmed.split(/[,，\s]+/);
    for (const part of parts) {
      const n = parseInt(part, 10);
      if (n >= 1 && n <= options.length) indices.add(n - 1);
    }
    // Also try Chinese numerals
    const wordMap = { 一: 0, 二: 1, 三: 2, 四: 3, 五: 4, 六: 5, 七: 6, 八: 7, 九: 8 };
    for (const [word, idx] of Object.entries(wordMap)) {
      if (trimmed.includes(word) && idx < options.length) indices.add(idx);
    }
    if (indices.size > 0) return [...indices].sort((a, b) => a - b);
    return [];
  }

  // 1. Exact number: "1", "2"
  const numMatch = trimmed.match(/^(\d+)\s*$/);
  if (numMatch) {
    const n = parseInt(numMatch[1], 10);
    if (n >= 1 && n <= options.length) return n - 1;
  }

  // 2. Chinese number prefix: "选项1", "第2个", "选3"
  const cnMatch = trimmed.match(/(?:选项?|第)\s*(\d+)/);
  if (cnMatch) {
    const n = parseInt(cnMatch[1], 10);
    if (n >= 1 && n <= options.length) return n - 1;
  }

  // 3. Number anywhere: "我选第1个"
  const anyNum = trimmed.match(/(\d+)/);
  if (anyNum) {
    const n = parseInt(anyNum[1], 10);
    if (n >= 1 && n <= options.length) return n - 1;
  }

  // 4. Chinese numerals: 一～九
  const wordMap = { 一: 0, 二: 1, 三: 2, 四: 3, 五: 4, 六: 5, 七: 6, 八: 7, 九: 8 };
  for (const [word, idx] of Object.entries(wordMap)) {
    if (trimmed.includes(word) && idx < options.length) return idx;
  }

  // 5. Label substring match (case-insensitive), longest wins
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

/**
 * Format a decision message with numbered options.
 */
export function formatDecisionMsg(question, options, timeoutSec = 120) {
  const optionLines = options.map((opt, i) => `${i + 1}. ${opt}`);
  return [
    `[决策] ${question}`,
    '',
    ...optionLines,
    '',
    `回复数字序号即可 (${timeoutSec}s 后超时)`,
  ].join('\n');
}

/**
 * Format a question message for AskUserQuestion interception.
 */
export function formatQuestionMsg(header, question, options, descriptions, multiSelect, timeoutSec = 120) {
  const msLabel = multiSelect ? '[多选]' : '[提问]';
  const prompt = multiSelect
    ? `用逗号分隔多个数字，如 "1,3" (${timeoutSec}s 后超时)`
    : `回复数字序号即可 (${timeoutSec}s 后超时)`;

  const optionLines = options.map((opt, i) => {
    const desc = descriptions[i] ? ` — ${descriptions[i]}` : '';
    return `${i + 1}. ${opt}${desc}`;
  });

  return [
    `${msLabel} ${header}: ${question}`,
    '',
    ...optionLines,
    '',
    prompt,
  ].join('\n');
}

// ── Progress state ──

/**
 * Write the current tool call progress to the state file.
 * The progress daemon reads this to respond to "查询进度".
 */
export function writeProgressState(toolName, description, cwd, step, totalSteps) {
  const dir = path.dirname(PROGRESS_FILE);
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const entry = {
      toolName,
      description: (description || '').slice(0, 200),
      cwd: cwd || process.cwd(),
      timestamp: new Date().toISOString(),
      pid: process.pid,
    };
    if (typeof step === 'number') entry.step = step;
    if (typeof totalSteps === 'number') entry.totalSteps = totalSteps;
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(entry), 'utf-8');
  } catch {
    // Silently ignore — progress tracking is best-effort
  }
}

/**
 * Read recent inbound WeChat messages from the bridge daemon's audit log.
 * Falls back to reading the messages directory for full message text.
 *
 * @param {string} toUserId — the WeChat user ID to filter by
 * @param {number} sinceMs — only messages since this timestamp (epoch ms)
 * @returns {{text: string, timestamp: string}[]}
 */
export function readRecentInboundMessages(toUserId, sinceMs) {
  const auditFile = path.join(CTI_HOME, 'data', 'audit.json');
  try {
    const raw = fs.readFileSync(auditFile, 'utf-8');
    const entries = JSON.parse(raw);
    if (!Array.isArray(entries)) return [];

    const results = [];
    for (const entry of entries) {
      if (entry.direction !== 'inbound') continue;
      if (!entry.createdAt) continue;
      const ts = new Date(entry.createdAt).getTime();
      if (ts < sinceMs) continue;

      // Try reading the message content from the summary field
      // The bridge stores real message text in messages/<chatId>.json
      if (entry.summary) {
        results.push({
          text: entry.summary,
          timestamp: entry.createdAt,
          chatId: entry.chatId,
        });
      }
    }
    return results;
  } catch {
    return [];
  }
}

/**
 * Read recent messages from the bridge's message store for a given chat.
 * Returns the raw inbound message texts.
 */
export function readBridgeMessages(accountId, toUserId, sinceMs) {
  // Bridge stores messages in data/messages/<chatId>.json
  const chatId = `weixin::${accountId}::${toUserId}`;
  const messagesDir = path.join(CTI_HOME, 'data', 'messages');
  const msgFile = path.join(messagesDir, `${chatId}.json`);

  try {
    const raw = fs.readFileSync(msgFile, 'utf-8');
    const messages = JSON.parse(raw);
    if (!Array.isArray(messages)) return [];

    // Return the last 3 user messages (most recent first)
    const results = [];
    for (let i = messages.length - 1; i >= 0 && results.length < 3; i--) {
      const msg = messages[i];
      if (msg.role === 'user' && msg.content) {
        results.push({ text: msg.content });
      }
    }
    return results;
  } catch {
    return [];
  }
}

/**
 * Read progress state. Returns null if none exists or file is stale (>5 min).
 */
export function readProgressState() {
  try {
    const raw = fs.readFileSync(PROGRESS_FILE, 'utf-8');
    const data = JSON.parse(raw);
    const age = Date.now() - new Date(data.timestamp).getTime();
    if (age > 300_000) return null; // stale
    return { ...data, ageSeconds: Math.round(age / 1000) };
  } catch {
    return null;
  }
}