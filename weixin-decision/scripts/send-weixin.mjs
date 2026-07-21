#!/usr/bin/env node
/**
 * Send a text message to the linked WeChat user.
 *
 * Usage:
 *   node send-weixin.mjs "你的消息内容"
 *
 * Reads credentials from the bridge data store.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const CTI_HOME = process.env.CTI_HOME || path.join(process.env.HOME || process.env.USERPROFILE, '.claude-to-im');
const ACCOUNTS_FILE = path.join(CTI_HOME, 'data', 'weixin-accounts.json');
const TOKENS_FILE = path.join(CTI_HOME, 'data', 'weixin-context-tokens.json');

function generateWechatUin() {
  return crypto.randomBytes(4).toString('base64');
}

function generateClientId() {
  return `cti-weixin-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

async function main() {
  const text = process.argv[2];
  if (!text) {
    console.error('Usage: node send-weixin.mjs "your message"');
    process.exit(1);
  }

  // Load account
  const accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8'));
  if (!Array.isArray(accounts) || accounts.length === 0) {
    console.error('No WeChat account linked. Run weixin:login first.');
    process.exit(1);
  }

  const acct = accounts[0];
  const token = acct.token; // "id@im.bot:secret"
  const baseUrl = (acct.baseUrl || 'https://ilinkai.weixin.qq.com').replace(/\/+$/, '');
  const toUserId = acct.userId;

  // Load context token
  let contextToken = '';
  try {
    const tokens = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf-8'));
    contextToken = tokens[acct.accountId] || '';
  } catch { /* ok */ }

  const url = `${baseUrl}/ilink/bot/sendmessage`;
  const body = {
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
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'AuthorizationType': 'ilink_bot_token',
      'Authorization': `Bearer ${token}`,
      'X-WECHAT-UIN': generateWechatUin(),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });

  const raw = await res.text();
  console.log(`HTTP ${res.status}: ${raw.slice(0, 200)}`);
  if (res.ok) {
    console.log('Message sent!');
  } else {
    console.error('Send failed.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});