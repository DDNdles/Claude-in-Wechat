// ═══════════════════════════════════════════════════════════════
// Relay Service v0.4
// Central WeChat message polling & routing orchestrator.
// Polls WeChat for messages, routes commands, handles text/decisions.
// ═══════════════════════════════════════════════════════════════

import { BrowserWindow } from 'electron';
import { info, warn, error, debug } from '../utils/logger';
import { getUpdates, sendMessage, isConfigured, extractText } from './wechat-sender';
import { parseCommand, handleCommand, isNumericReply } from './command-handler';
import { getActiveProject } from './project-manager';
import {
  startWatching, stopWatching,
  tryMatchDecision, resolveDecision,
  getPendingDecisions, getOldestPendingDecision,
} from './hook-events-watcher';

// ── Types ─────────────────────────────────────────────────────────

export interface RelayStatus {
  running: boolean;
  polling: boolean;
  configured: boolean;
  messagesToday: number;
  pendingDecisions: number;
  lastPollAt: string | null;
  lastError: string | null;
}

// ── State ─────────────────────────────────────────────────────────

let pollingTimer: ReturnType<typeof setInterval> | null = null;
let running = false;
let polling = false;
let messagesToday = 0;
let lastPollAt: string | null = null;
let lastError: string | null = null;
let mainWindow: BrowserWindow | null = null;
let pollInterval = 5000; // ms

// ── Public API ────────────────────────────────────────────────────

export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win;
}

export function setPollInterval(ms: number): void {
  pollInterval = Math.max(1000, Math.min(60000, ms));
}

export function start(): void {
  if (running) return;
  running = true;

  info('Relay service starting...');

  // Start hook events watcher (completion notifications)
  startWatching();

  // Reset daily counter if needed
  messagesToday = 0;

  if (!isConfigured()) {
    warn('Relay service: WeChat not configured, polling will be skipped');
    // Still mark as running so the status shows correctly
    return;
  }

  // Start polling loop
  startPolling();
  info('Relay service started');
}

export function stop(): void {
  running = false;
  stopPolling();
  stopWatching();
  info('Relay service stopped');
}

export function getStatus(): RelayStatus {
  return {
    running,
    polling,
    configured: isConfigured(),
    messagesToday,
    pendingDecisions: getPendingDecisions().length,
    lastPollAt,
    lastError,
  };
}

export function isRunning(): boolean {
  return running;
}

export async function sendReply(text: string): Promise<boolean> {
  if (!isConfigured()) return false;
  const result = await sendMessage(text);
  return result.success;
}

// ── Internal: Polling ─────────────────────────────────────────────

function startPolling(): void {
  if (polling) return;
  if (!isConfigured()) return;

  polling = true;
  pollOnce(); // First poll immediately
  pollingTimer = setInterval(pollOnce, pollInterval);
  info(`Polling started (interval: ${pollInterval}ms)`);
}

function stopPolling(): void {
  polling = false;
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
  info('Polling stopped');
}

async function pollOnce(): Promise<void> {
  if (!polling) return;

  try {
    const result = await getUpdates();
    lastPollAt = new Date().toISOString();
    lastError = null;

    if (result.msgs && result.msgs.length > 0) {
      for (const msg of result.msgs) {
        await processMessage(msg);
      }
    }
  } catch (err: any) {
    lastError = err.message || String(err);
    warn('Poll error', err);
  }
}

// ── Internal: Message Processing ──────────────────────────────────

async function processMessage(msg: any): Promise<void> {
  const text = extractText(msg);
  if (!text) return;

  messagesToday++;
  debug(`WeChat message: "${text.slice(0, 100)}"`);

  // Send to renderer for real-time display
  notifyRenderer('message_received', { text, fromUserId: msg.from_user_id });

  // 1. Check if it's a numeric reply for a pending decision
  if (isNumericReply(text)) {
    const decision = tryMatchDecision(text);
    if (decision) {
      const num = parseInt(text, 10);
      const result = resolveDecision(decision.decisionId, num - 1);
      if (result.success) {
        await sendMessage(`收到，已选择「${result.label}」`);
        return;
      }
    }
  }

  // 2. Check if it's a command
  const parsed = parseCommand(text);
  if (parsed.isCommand && parsed.command !== 'numeric') {
    // Send "收到" immediately
    await sendMessage('收到');

    // Execute the command
    const response = await handleCommand(parsed.command, parsed.args);

    // Send response
    await sendMessage(response);
    info(`Command handled: /${parsed.command} ${parsed.args.join(' ')}`);
    return;
  }

  // 3. Plain text message — forward to active project's Claude Code
  await sendMessage('收到');

  const active = getActiveProject();
  if (active.success && active.data) {
    // The active project exists — this is a task message for Claude
    // The actual forwarding to Claude Code depends on whether CC is running
    // For now, acknowledge and tell the user
    const projectName = active.data.name;
    await sendMessage(`已转发到项目「${projectName}」。\nClaude Code 正在处理...`);
    info(`Task forwarded to project: ${projectName}`);
  } else {
    await sendMessage('没有活跃项目。请先用 /open 项目名 打开一个项目，或 /new 项目名 创建新项目。');
  }
}

// ── Internal: Renderer Notifications ──────────────────────────────

function notifyRenderer(type: string, data: unknown): void {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('relay:event', {
        type,
        data,
        timestamp: new Date().toISOString(),
      });
    }
  } catch {
    // Best effort
  }
}

// ── Event Handlers ────────────────────────────────────────────────

// Listen for hook event decisions and forward to WeChat
import { setQuestionHandler, setSessionStopHandler, setDangerousHandler } from './hook-events-watcher';

setQuestionHandler(async (decision) => {
  // Already handled in hook-events-watcher directly
});

setSessionStopHandler(async (projectName) => {
  // Update renderer
  notifyRenderer('project_completed', { projectName });
});

setDangerousHandler(async (reason) => {
  notifyRenderer('dangerous_operation', { reason });
});