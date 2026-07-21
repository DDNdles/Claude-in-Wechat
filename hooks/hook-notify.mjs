#!/usr/bin/env node
/**
 * Stop hook — sends a completion notification to WeChat when Claude Code
 * finishes responding.
 *
 * Reads Claude Code Stop hook JSON from stdin:
 *   { "session_id": "...", "transcript_path": "...", "cwd": "/path" }
 *
 * Sends a one-way WeChat message (fire and forget).
 *
 * Configuration:
 *   WXG_NOTIFY_ENABLED=1     — set to "0" to disable notifications
 *   WXG_NOTIFY_TEMPLATE=...  — custom message template
 *
 * Requires: Node.js >= 20, WeChat account linked via claude-to-im.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  loadWeixinAccount,
  loadContextToken,
  sendMessage,
} from '../lib/weixin-client.mjs';

const log = (...args) => process.stderr.write('[hook-notify] ' + args.join(' ') + '\n');

// ── Config ──

const ENABLED = process.env.WXG_NOTIFY_ENABLED !== '0';

// Default template uses {folder}
const TEMPLATE = process.env.WXG_NOTIFY_TEMPLATE || '✅ Claude Code 已完成回复 — {folder}';

// ── Main ──

async function main() {
  if (!ENABLED) {
    return; // silently skip
  }

  // Read stdin for session context
  let raw = '';
  if (!process.stdin.isTTY) {
    raw = fs.readFileSync(0, 'utf-8').trim();
  }

  let ctx = {};
  try {
    ctx = raw ? JSON.parse(raw) : {};
  } catch {
    // Not JSON — might be piped plain text
  }

  const cwd = ctx.cwd || process.cwd();
  const folder = cwd.split(/[/\\]/).pop() || cwd;

  // Load account
  let account;
  try {
    account = loadWeixinAccount();
  } catch (err) {
    log(`WeChat unavailable: ${err.message}`);
    return;
  }

  const contextToken = loadContextToken(account.accountId);

  // Format message
  const text = TEMPLATE.replace(/\{folder\}/g, folder)
    .replace(/\{cwd\}/g, cwd)
    .replace(/\{time\}/g, new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));

  try {
    await sendMessage(account, account.userId, text, contextToken);
    log(`Notification sent: ${text}`);
  } catch (err) {
    log(`Failed to send: ${err.message}`);
  }
}

main().catch(err => {
  log(`Fatal: ${err.message}`);
  process.exit(1);
});