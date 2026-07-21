#!/usr/bin/env node
/**
 * PreToolUse hook — intercepts dangerous tool calls (Bash, Write, Edit),
 * sends a WeChat decision request, blocks until user replies.
 *
 * Reads Claude Code PreToolUse JSON from stdin:
 *   { "tool_name": "Bash", "tool_input": { "command": "rm -rf /", ... } }
 *
 * Outputs Claude Code hook decision JSON to stdout:
 *   { "decision": "allow" | "block", "reason": "..." }
 *
 * Configuration (env vars):
 *   WXG_TIMEOUT=120          — timeout in seconds
 *   WXG_ALLOW_LIST="..."     — comma-separated always-allow patterns
 *   WXG_DEFAULT_ACTION=block — "block" or "allow" on timeout
 *
 * Requires: Node.js >= 20, WeChat account linked via claude-to-im.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  loadWeixinAccount,
  writeProgressState,
} from '../lib/weixin-client.mjs';
import { autoRegister, getContextSummary } from '../lib/project-context.mjs';

const NODE_PATH = process.execPath;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Ask-weixin script path (bundled in the same package)
const ASK_SCRIPT = path.join(__dirname, '..', 'scripts', 'ask-weixin.mjs');

const TIMEOUT_SEC = parseInt(process.env.WXG_TIMEOUT || '120', 10);
const DEFAULT_ACTION = process.env.WXG_DEFAULT_ACTION || 'block';

// Allow list patterns (comma-separated env var)
const ALLOW_LIST = (process.env.WXG_ALLOW_LIST || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const log = (...args) => process.stderr.write('[hook-guard] ' + args.join(' ') + '\n');

// ── Danger patterns ──

const DANGER_PATTERNS = [
  // File deletion
  /\brm\s+-[rR]/,
  /\bdel\s+\/[sq]\s/,
  /\bdeltree\b/,
  // Git destructive
  /\bgit\s+push\s+.*--force/,
  /\bgit\s+push\s+.*-f\b/,
  /\bgit\s+reset\s+--hard/,
  /\bgit\s+clean\s+-[fd]/,
  /\bgit\s+branch\s+-D\b/,
  // Database
  /\bDROP\b/,
  /\bTRUNCATE\b/,
  /\bDELETE\s+FROM\b/,
  // npm destructive
  /\bnpm\s+unpublish/,
  /\bnpm\s+deprecate/,
  // Docker destructive
  /\bdocker\s+(rm|rmi|system\s+prune|volume\s+rm)/,
  // Cloud / infra
  /\bterraform\s+(destroy|apply\s+-auto-approve)/,
  /\bkubectl\s+delete\b/,
  /\baws\s+.*\s+delete/,
  /\bgh\s+repo\s+delete/,
  // Deployment
  /\bdeploy\b/i,
  /\bpublish\b/i,
  // Environment
  /\bchmod\s+777/,
  /\b> \/dev\/sd/,
];

function isDangerous(input) {
  const cmd = input.command || '';
  const filePath = input.file_path || '';
  const desc = input.description || '';
  const combined = `${cmd} ${filePath} ${desc}`;

  for (const pattern of DANGER_PATTERNS) {
    if (pattern.test(combined)) return true;
  }
  return false;
}

function isInAllowList(input) {
  const cmd = input.command || '';
  const filePath = input.file_path || '';

  for (const pattern of ALLOW_LIST) {
    if (!pattern) continue;
    if (cmd.includes(pattern) || filePath.includes(pattern)) return true;
  }
  return false;
}

// ── Main ──

async function main() {
  // Read stdin (cross-platform)
  let raw = '';
  if (!process.stdin.isTTY) {
    raw = fs.readFileSync(0, 'utf-8').trim();
  }

  let input;
  try {
    input = raw ? JSON.parse(raw) : {};
  } catch {
    input = {};
  }

  const toolName = input.tool_name || '';
  const toolInput = input.tool_input || {};
  const cwd = input.cwd || process.cwd();

  // ── Write progress state (for "查询进度" daemon) ──
  const desc = toolInput.description || '';
  const cmdPreview = (toolInput.command || toolInput.file_path || toolName).slice(0, 100);
  writeProgressState(toolName, desc || cmdPreview, cwd);

  // Auto-register project context
  autoRegister(cwd);

  // ── Only intercept Bash, Write, Edit ──
  if (!['Bash', 'Write', 'Edit'].includes(toolName)) {
    console.log(JSON.stringify({ decision: 'allow', reason: 'safe tool type' }));
    return;
  }

  // ── Check allow list ──
  if (isInAllowList(toolInput)) {
    console.log(JSON.stringify({ decision: 'allow', reason: 'allow list match' }));
    return;
  }

  // ── Check danger ──
  if (!isDangerous(toolInput)) {
    console.log(JSON.stringify({ decision: 'allow', reason: 'safe command' }));
    return;
  }

  // ── Load WeChat account ──
  let account;
  try {
    account = loadWeixinAccount();
  } catch (err) {
    log(`WeChat unavailable: ${err.message} — allowing operation`);
    console.log(JSON.stringify({ decision: 'allow', reason: `微信不可用: ${err.message.slice(0, 80)}` }));
    return;
  }

  // ── Dangerous! Ask user via WeChat ──

  const descPreview = (toolInput.description || '无描述').slice(0, 80);
  const fileOrCmd = (toolInput.command || toolInput.file_path || 'unknown').slice(0, 100);
  const ctx = getContextSummary();

  const question = `${ctx}\n⚠️ 危险操作: ${descPreview}`;
  const optAllow = `✅ 允许: ${fileOrCmd}`;
  const optBlock = '❌ 阻止';

  try {
    // Use spawnSync for synchronous blocking (hook must wait for reply)
    const result = spawnSync(
      NODE_PATH,
      [ASK_SCRIPT, '--timeout', String(TIMEOUT_SEC), question, optAllow, optBlock],
      {
        encoding: 'utf-8',
        timeout: (TIMEOUT_SEC + 30) * 1000,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, CTI_HOME: process.env.CTI_HOME || path.join(process.env.HOME || process.env.USERPROFILE, '.claude-to-im') },
      },
    );

    // stderr goes to hook's stderr for logging
    if (result.stderr) {
      log(result.stderr.trim());
    }

    const stdout = (result.stdout || '').trim();
    if (!stdout) {
      console.log(JSON.stringify({ decision: 'block', reason: '微信脚本无输出' }));
      return;
    }

    const lines = stdout.split('\n');
    const lastLine = lines[lines.length - 1].trim();
    let parsed;
    try {
      parsed = JSON.parse(lastLine);
    } catch {
      console.log(JSON.stringify({ decision: 'block', reason: `无效输出: ${lastLine.slice(0, 80)}` }));
      return;
    }

    if (parsed.ok) {
      if (parsed.index === 0) {
        // User chose to allow
        console.log(JSON.stringify({ decision: 'allow', reason: `用户允许: ${parsed.rawReply}` }));
      } else {
        console.log(JSON.stringify({ decision: 'block', reason: `用户阻止: ${parsed.rawReply}` }));
      }
    } else {
      // Timeout or error → use default action
      const action = DEFAULT_ACTION === 'allow' ? 'allow' : 'block';
      console.log(JSON.stringify({ decision: action, reason: `微信${parsed.reason === 'timeout' ? '超时' : '错误'}: ${parsed.reason}` }));
    }
  } catch (err) {
    // spawnSync timeout or script error → block to be safe
    console.log(JSON.stringify({ decision: 'block', reason: `决策异常: ${err.message.slice(0, 80)}` }));
  }
}

main().catch((err) => {
  console.log(JSON.stringify({ decision: 'block', reason: `hook 错误: ${err.message.slice(0, 80)}` }));
});