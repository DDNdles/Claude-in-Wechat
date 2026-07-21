#!/usr/bin/env node
/**
 * PostToolUse hook — detects tool execution errors and sends
 * a WeChat notification with project name and error summary.
 *
 * Input (stdin JSON from Claude Code):
 *   { "tool_name": "...", "tool_input": {...}, "tool_output": { "content": "...", "is_error": true } }
 *
 * Exit 0: output goes to transcript (silent if no error)
 * Exit 2: output goes to Claude (stderr path — we use this to log)
 *
 * Configuration:
 *   WXG_ERROR_NOTIFY_ENABLED=1 — set to "0" to disable
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  loadWeixinAccount,
  loadContextToken,
  sendMessage as sendWeixinMsg,
} from '../lib/weixin-client.mjs';
import { getContextSummary } from '../lib/project-context.mjs';

const ENABLED = process.env.WXG_ERROR_NOTIFY_ENABLED !== '0';

const log = (...args) => process.stderr.write('[hook-error-notify] ' + args.join(' ') + '\n');

async function main() {
  if (!ENABLED) { process.exit(0); return; }

  let raw = '';
  if (!process.stdin.isTTY) {
    raw = fs.readFileSync(0, 'utf-8').trim();
  }

  let input;
  try { input = raw ? JSON.parse(raw) : {}; } catch { process.exit(0); return; }

  const toolOutput = input.tool_output || {};
  const isError = toolOutput.is_error === true ||
    (typeof toolOutput.content === 'string' && /(error|ERROR|Error|失败|错误|fatal)/.test(toolOutput.content?.slice(0, 500)));

  if (!isError) { process.exit(0); return; }

  // Extract error summary
  const toolName = input.tool_name || 'Unknown';
  const content = (toolOutput.content || '').slice(0, 200);
  const errorLine = content.split('\n').find(l => /error|ERROR|Error|失败|错误/i.test(l)) || content.slice(0, 100);

  // Load WeChat account
  let account;
  try { account = loadWeixinAccount(); } catch (err) {
    log(`WeChat unavailable: ${err.message}`);
    process.exit(0); return;
  }

  const contextToken = loadContextToken(account.accountId);
  const ctx = getContextSummary();
  const cwd = input.cwd || process.cwd();
  const folder = cwd.split(/[/\\]/).pop() || cwd;

  const msg = [
    `❌ ${folder} ERROR`,
    '',
    `项目: ${ctx}`,
    `工具: ${toolName}`,
    `错误: ${errorLine}`,
    '',
    `目录: ${cwd}`,
  ].join('\n');

  try {
    await sendWeixinMsg(account, account.userId, msg, contextToken);
    log(`Error notification sent: ${errorLine}`);
  } catch (err) {
    log(`Failed to send: ${err.message}`);
  }

  // Exit 0: output goes to transcript silently (Claude already knows about the error)
  process.exit(0);
}

main();