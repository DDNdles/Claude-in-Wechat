#!/usr/bin/env node
/**
 * Progress daemon — polls WeChat for "查询进度" and responds with a summary.
 *
 * Lifecycle:
 *   node progress-daemon.mjs start     — start as background process
 *   node progress-daemon.mjs stop      — stop running daemon
 *   node progress-daemon.mjs status    — check if daemon is running
 *
 * The daemon:
 *   1. Polls WeChat getupdates every 5 seconds
 *   2. Filters for "查询进度" / "进度" / "进度查询"
 *   3. Reads progress-state.json + session data
 *   4. Sends a formatted summary reply
 *   5. Rate limits: max 1 reply per 30 seconds
 *
 * Requirements: Node.js >= 20, WeChat account linked.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn, exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  loadWeixinAccount,
  loadContextToken,
  sendMessage,
  pollUpdates,
  readProgressState,
  CTI_HOME,
} from '../lib/weixin-client.mjs';
import {
  loadContext,
  switchToChat,
  switchToProject,
  listProjects,
  registerProject,
  getActiveProject,
  getContextSummary,
} from '../lib/project-context.mjs';

const PID_FILE = path.join(CTI_HOME, 'runtime', 'progress-daemon.pid');
const CURSOR_FILE = path.join(CTI_HOME, 'runtime', 'progress-cursor.json');
const LOG_FILE = path.join(CTI_HOME, 'logs', 'progress-daemon.log');

// ── Logging ──

function ensureLogDir() {
  const dir = path.dirname(LOG_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function log(msg) {
  ensureLogDir();
  const line = `[${new Date().toISOString()}] ${msg}`;
  process.stderr.write(line + '\n');
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch { /* ok */ }
}

// ── PID management ──

function getPid() {
  try {
    return parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim(), 10);
  } catch {
    return null;
  }
}

function writePid(pid) {
  const dir = path.dirname(PID_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(PID_FILE, String(pid));
}

function removePid() {
  try { fs.unlinkSync(PID_FILE); } catch { /* ok */ }
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ── Cursor persistence ──

function loadCursor() {
  try {
    const data = JSON.parse(fs.readFileSync(CURSOR_FILE, 'utf-8'));
    return data.cursor || '';
  } catch {
    return '';
  }
}

function saveCursor(cursor) {
  const dir = path.dirname(CURSOR_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CURSOR_FILE, JSON.stringify({ cursor, updatedAt: new Date().toISOString() }));
}

// ── Progress report ──

function buildProgressReport() {
  const ctx = loadContext();
  const lines = ['📊 Claude Code 进度摘要'];
  lines.push('');
  lines.push(getContextSummary());
  lines.push('');

  const progress = readProgressState();
  if (progress) {
    const ageStr = progress.ageSeconds < 60
      ? `${progress.ageSeconds} 秒前`
      : `${Math.round(progress.ageSeconds / 60)} 分钟前`;
    lines.push(`🟢 活跃操作 (${ageStr}):`);
    lines.push(`   工具: ${progress.toolName}`);
    lines.push(`   操作: ${progress.description || '(无描述)'}`);
    if (progress.cwd) {
      const folder = progress.cwd.split(/[/\\]/).pop() || progress.cwd;
      lines.push(`   目录: ${folder}`);
    }
  } else {
    lines.push('⚪ 当前无活跃操作（5 分钟内无工具调用）');
    lines.push('   可能 Claude 正在思考或已暂停');
  }

  lines.push('');
  lines.push('指令: 查询进度 | 列出项目 | 切换到聊天 | 切换到N号项目');
  lines.push('(由 weixin-global-integration 自动生成)');

  return lines.join('\n');
}

// ── Command matching ──

function matchCommand(text) {
  const t = text.trim();

  // Project switching: 切换到N号项目, 切换到项目N, 切换N
  const switchProj = t.match(/^(?:切换(?:到|至)?)?(\d+)号?项目$/);
  if (switchProj) return { cmd: 'switch-project', projectId: switchProj[1] };

  // Switch to chat mode
  if (/^(切换到)?聊天(模式)?$/.test(t)) return { cmd: 'switch-chat' };

  // List projects
  if (/^(列出)?项目(列表)?$/.test(t)) return { cmd: 'list-projects' };

  // Register current project
  if (/^注册项目\s*(.+)$/.test(t)) {
    const m = t.match(/^注册项目\s*(.+)$/);
    return { cmd: 'register-project', name: m[1].trim() };
  }

  // Progress query
  if (/^(查询)?进度$|^进度查询$|^当前进度$|^check\s*progress$/i.test(t)) {
    return { cmd: 'progress' };
  }

  // Help
  if (/^帮助$|^help$/i.test(t) || /^指令$/.test(t)) {
    return { cmd: 'help' };
  }

  return null;
}

/**
 * Handle a recognized command. Returns response text, or null if no reply needed.
 */
function handleCommand(cmd, cwd) {
  switch (cmd.cmd) {
    case 'switch-project': {
      const ok = switchToProject(cmd.projectId);
      return ok
        ? `✅ 已切换到 ${cmd.projectId} 号项目\n${getContextSummary()}`
        : `❌ ${cmd.projectId} 号项目不存在。用「列出项目」查看所有项目。`;
    }
    case 'switch-chat': {
      switchToChat();
      return '✅ 已切换到聊天模式\n💬 现在不会自动回复进度，只会响应指令。用「切换到N号项目」回到项目模式。';
    }
    case 'list-projects': {
      return listProjects();
    }
    case 'register-project': {
      const id = registerProject(cmd.name, cwd || process.cwd());
      return `✅ 已注册项目「${cmd.name}」为 ${id} 号项目`;
    }
    case 'progress': {
      return buildProgressReport();
    }
    case 'help': {
      return [
        '📋 可用指令：',
        '',
        '查询进度 — 查看当前项目进度',
        '列出项目 — 查看所有注册项目',
        '切换到N号项目 — 切换到第N个项目',
        '切换到聊天 — 进入聊天模式（不自动回复）',
        '注册项目 <名称> — 注册当前项目',
        '帮助 — 显示此帮助',
      ].join('\n');
    }
    default:
      return null;
  }
}

// ── Subcommands ──

function cmdStatus() {
  const pid = getPid();
  if (pid && isProcessRunning(pid)) {
    console.log(`Progress daemon is running (PID: ${pid})`);
  } else {
    console.log('Progress daemon is NOT running');
    if (pid) {
      console.log(`Stale PID file found (PID: ${pid}), removing...`);
      removePid();
    }
  }
}

function cmdStop() {
  const pid = getPid();
  if (!pid || !isProcessRunning(pid)) {
    console.log('Progress daemon is not running.');
    removePid();
    return;
  }

  console.log(`Stopping progress daemon (PID: ${pid})...`);
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    process.kill(pid, 'SIGKILL');
  }
  removePid();
  console.log('Stopped.');
}

function cmdStart() {
  // Check if already running
  const existingPid = getPid();
  if (existingPid && isProcessRunning(existingPid)) {
    console.log(`Progress daemon is already running (PID: ${existingPid})`);
    process.exit(0);
  }
  removePid();

  // On Windows, detached+unref is unreliable for background processes.
  // Use start /b (cmd) or nohup (unix) to truly detach.
  const scriptPath = fileURLToPath(import.meta.url);
  const isWindows = process.platform === 'win32';

  if (isWindows) {
    // Write a wrapper batch file and launch with start /b
    const batContent = `@echo off\r\n"${process.execPath}" "${scriptPath}" --run >> "${LOG_FILE}" 2>&1`;
    const batPath = path.join(path.dirname(scriptPath), 'start-progress-daemon.bat');
    fs.writeFileSync(batPath, batContent);
    // Use start to launch in a separate window (minimized)
    exec(`start /b "" cmd /c "${batPath}"`, { windowsHide: true });
    // Give it a moment to write PID
    setTimeout(() => {
      const pid = getPid();
      if (pid) {
        console.log(`Progress daemon started (PID: ${pid})`);
        console.log(`Logs: ${LOG_FILE}`);
      } else {
        console.log('Progress daemon failed to start. Check logs.');
      }
    }, 2000);
  } else {
    const child = spawn(
      process.execPath,
      [scriptPath, '--run'],
      {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env },
      },
    );
    writePid(child.pid);
    child.unref();
    console.log(`Progress daemon started (PID: ${child.pid})`);
    console.log(`Logs: ${LOG_FILE}`);
  }
}

// ── Main daemon loop ──

async function runDaemon() {
  // Check if already running
  const existingPid = getPid();
  if (existingPid && existingPid !== process.pid && isProcessRunning(existingPid)) {
    log(`Another daemon is already running (PID: ${existingPid})`);
    process.exit(1);
  }

  writePid(process.pid);

  // Graceful shutdown
  process.on('SIGTERM', () => {
    log('Received SIGTERM, shutting down...');
    removePid();
    process.exit(0);
  });
  process.on('SIGINT', () => {
    log('Received SIGINT, shutting down...');
    removePid();
    process.exit(0);
  });

  // Load account
  let account;
  try {
    account = loadWeixinAccount();
  } catch (err) {
    log(`Fatal: Cannot load WeChat account: ${err.message}`);
    removePid();
    process.exit(1);
  }

  log(`Daemon started. Polling for "查询进度"...`);

  const toUserId = account.userId;
  const contextToken = loadContextToken(account.accountId);
  let cursor = loadCursor();
  let lastReplyTime = 0;
  const RATE_LIMIT_MS = 30_000; // 30 seconds minimum between replies

  while (true) {
    try {
      const resp = await pollUpdates(account, cursor, 5000);

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

        const cmd = matchCommand(text);
        if (!cmd) {
          // Unknown message — silently ignore (especially important in chat mode)
          log(`No command matched: "${text.slice(0, 50)}"`);
          continue;
        }

        log(`Command: ${cmd.cmd} from "${text}"`);

        // Rate limit check (only for progress queries, not for switch commands)
        const now = Date.now();
        const isSwitchCmd = cmd.cmd === 'switch-project' || cmd.cmd === 'switch-chat' || cmd.cmd === 'list-projects' || cmd.cmd === 'register-project' || cmd.cmd === 'help';
        if (!isSwitchCmd && now - lastReplyTime < RATE_LIMIT_MS) {
          log('Rate limited — too soon since last reply');
          continue;
        }
        lastReplyTime = now;

        // Handle command and send reply
        const reply = handleCommand(cmd, process.cwd());
        if (reply) {
          try {
            await sendMessage(account, toUserId, reply, contextToken);
            log(`Reply sent (${reply.length} chars)`);
          } catch (err) {
            log(`Failed to send reply: ${err.message}`);
          }
        }
      }

      if (resp.get_updates_buf) {
        cursor = resp.get_updates_buf;
        saveCursor(cursor);
      }
    } catch (err) {
      log(`Poll error: ${err.message}`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

// ── Entry point ──

const subcommand = process.argv[2];
const isRun = process.argv.includes('--run');

if (isRun) {
  runDaemon().catch(err => {
    log(`Fatal daemon error: ${err.message}`);
    removePid();
    process.exit(1);
  });
} else if (subcommand === 'status') {
  cmdStatus();
} else if (subcommand === 'stop') {
  cmdStop();
} else if (subcommand === 'start') {
  cmdStart();
} else {
  console.log('Usage: node progress-daemon.mjs start|stop|status');
  console.log('  start  — start the daemon in background');
  console.log('  stop   — stop the running daemon');
  console.log('  status — check if daemon is running');
  process.exit(2);
}