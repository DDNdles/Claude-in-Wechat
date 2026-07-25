// ═══════════════════════════════════════════════════════════════
// Hook Events Watcher Service v0.4
// Watches hook-events.jsonl for events from Claude Code hooks.
// Handles: session stop notifications, dangerous operation alerts.
// (AskUserQuestion is handled by weixin-global-integration hooks)
// ═══════════════════════════════════════════════════════════════

import { watchFile, statSync, openSync, readSync, closeSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { info, warn, error, debug } from '../utils/logger';
import { sendMessage, isConfigured } from './wechat-sender';
import { listProjects } from './project-manager';

const HOME = os.homedir();

// ── Paths ─────────────────────────────────────────────────────────

const HOOK_EVENTS_FILE = path.join(HOME, '.claude-in-wechat', 'runtime', 'hook-events.jsonl');

// ── Types ─────────────────────────────────────────────────────────

interface HookEvent {
  type: 'ask_user_question' | 'dangerous_operation' | 'session_stop';
  tool?: string;
  questions?: Array<{
    question: string;
    header?: string;
    options?: Array<{ label: string; description: string }>;
    multiSelect?: boolean;
  }>;
  reason?: string;
  sessionId?: string;
  projectPath?: string;
  decisionId?: string;
  timestamp: string;
}

interface PendingDecision {
  decisionId: string;
  projectId: string;
  question: string;
  options: string[];
  timestamp: string;
}

// ── State ─────────────────────────────────────────────────────────

let watcher: ReturnType<typeof setInterval> | null = null;
let lastSize = 0;
let running = false;

const pendingDecisions = new Map<string, PendingDecision>();
const decisionResolvers = new Map<string, (index: number) => void>();

// ── Event Handlers ────────────────────────────────────────────────

let onSessionStop: ((projectName: string) => void) | null = null;
let onQuestion: ((decision: PendingDecision) => void) | null = null;
let onDangerous: ((reason: string) => void) | null = null;

export function setSessionStopHandler(handler: (projectName: string) => void): void {
  onSessionStop = handler;
}

export function setQuestionHandler(handler: (decision: PendingDecision) => void): void {
  onQuestion = handler;
}

export function setDangerousHandler(handler: (reason: string) => void): void {
  onDangerous = handler;
}

// ── Public API ────────────────────────────────────────────────────

export function startWatching(): void {
  if (running) return;
  running = true;

  // Ensure runtime dir and file exist
  const dir = path.dirname(HOOK_EVENTS_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!existsSync(HOOK_EVENTS_FILE)) {
    // Touch the file
    let fd2: number | undefined; try { fd2 = openSync(HOOK_EVENTS_FILE, 'a'); } finally { if (fd2 !== undefined) { closeSync(fd2); } }
  }

  // Get initial file size
  try {
    const stat = statSync(HOOK_EVENTS_FILE);
    lastSize = stat.size;
  } catch {
    lastSize = 0;
  }

  // Poll every 2 seconds (fs.watch is unreliable on Windows for JSONL)
  watcher = setInterval(checkForNewEvents, 2000);
  info('Hook events watcher started');
}

export function stopWatching(): void {
  running = false;
  if (watcher) {
    clearInterval(watcher);
    watcher = null;
  }
  info('Hook events watcher stopped');
}

export function isWatching(): boolean {
  return running;
}

// ── Decision Management ───────────────────────────────────────────

export function addPendingDecision(decision: PendingDecision): void {
  pendingDecisions.set(decision.decisionId, decision);
  debug(`Pending decision added: ${decision.decisionId}`);
}

export function getPendingDecisions(): PendingDecision[] {
  return Array.from(pendingDecisions.values());
}

export function getOldestPendingDecision(): PendingDecision | null {
  let oldest: PendingDecision | null = null;
  for (const d of pendingDecisions.values()) {
    if (!oldest || new Date(d.timestamp) < new Date(oldest.timestamp)) {
      oldest = d;
    }
  }
  return oldest;
}

export function resolveDecision(decisionId: string, chosenIndex: number): { success: boolean; label?: string } {
  const decision = pendingDecisions.get(decisionId);
  if (!decision) return { success: false };

  const label = decision.options[chosenIndex] || `选项${chosenIndex + 1}`;
  pendingDecisions.delete(decisionId);

  // Resolve the promise if someone is waiting
  const resolver = decisionResolvers.get(decisionId);
  if (resolver) {
    resolver(chosenIndex);
    decisionResolvers.delete(decisionId);
  }

  debug(`Decision resolved: ${decisionId} → option ${chosenIndex} (${label})`);
  return { success: true, label };
}

export function tryMatchDecision(text: string): PendingDecision | null {
  const num = parseInt(text.trim(), 10);
  if (isNaN(num)) return null;

  const decisions = getPendingDecisions()
    .filter(d => d.options.length >= num && num > 0)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  return decisions[0] || null;
}

// ── Cleanup ───────────────────────────────────────────────────────

/** Remove stale pending decisions (older than 10 minutes) */
function cleanupStaleDecisions(): void {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [id, d] of pendingDecisions) {
    if (new Date(d.timestamp).getTime() < cutoff) {
      pendingDecisions.delete(id);
      decisionResolvers.delete(id);
      debug(`Cleaned up stale decision: ${id}`);
    }
  }
}

// ── Internal: File Watching ───────────────────────────────────────

function checkForNewEvents(): void {
  try {
    if (!existsSync(HOOK_EVENTS_FILE)) return;

    const stat = statSync(HOOK_EVENTS_FILE);
    if (stat.size === lastSize) {
      // Also run cleanup periodically
      cleanupStaleDecisions();
      return;
    }

    if (stat.size < lastSize) {
      // File was truncated
      lastSize = 0;
    }

    // Read new content from last position
    const fd = openSync(HOOK_EVENTS_FILE, 'r');
    try {
      const buf = Buffer.alloc(stat.size - lastSize);
      const bytesRead = readSync(fd, buf, 0, buf.length, lastSize);
      if (bytesRead > 0) {
        const newContent = buf.toString('utf-8', 0, bytesRead);
        const lines = newContent.split('\n').filter(l => l.trim());
        for (const line of lines) {
          try {
            const event: HookEvent = JSON.parse(line);
            processEvent(event);
          } catch (parseErr) {
            // Skip malformed JSON lines
          }
        }
      }
    } finally {
      try { closeSync(fd); } catch { /* ok */ }
    }

    lastSize = stat.size;
  } catch (err) {
    debug('Error checking hook events', err);
  }
}

function processEvent(event: HookEvent): void {
  switch (event.type) {
    case 'session_stop':
      handleSessionStop(event);
      break;
    case 'ask_user_question':
      handleAskUserQuestion(event);
      break;
    case 'dangerous_operation':
      handleDangerousOperation(event);
      break;
    default:
      debug(`Unknown hook event type: ${(event as any).type}`);
  }
}

async function handleSessionStop(event: HookEvent): Promise<void> {
  info(`Session stopped: ${event.projectPath || event.sessionId || 'unknown'}`);

  // Try to match project by path
  if (event.projectPath) {
    const projects = listProjects();
    const matched = projects.find(p =>
      p.path.toLowerCase() === event.projectPath!.toLowerCase() ||
      event.projectPath!.toLowerCase().includes(p.name.toLowerCase())
    );
    const projectName = matched?.name || path.basename(event.projectPath);

    if (onSessionStop) {
      onSessionStop(projectName);
    }

    if (isConfigured()) {
      await sendMessage(`✅ 「${projectName}」已完成`);
      info(`Completion notification sent for ${projectName}`);
    }
  }
}

async function handleAskUserQuestion(event: HookEvent): Promise<void> {
  if (!event.questions || event.questions.length === 0) return;

  const question = event.questions[0];
  const qText = question.question;
  const options = question.options?.map(o => o.label) || [];

  if (options.length === 0) return;

  info(`AskUserQuestion event: "${qText.slice(0, 50)}..."`);

  // Store as pending decision
  const decisionId = event.decisionId || `hook-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const pending: PendingDecision = {
    decisionId,
    projectId: event.projectPath || '',
    question: qText,
    options,
    timestamp: event.timestamp || new Date().toISOString(),
  };
  addPendingDecision(pending);

  if (onQuestion) {
    onQuestion(pending);
  }

  // Forward to WeChat
  if (isConfigured()) {
    const optionLines = options.map((o, i) => `${i + 1}. ${o}`).join('\n');
    const header = question.header || 'Claude 需要你做出选择';
    const multi = question.multiSelect ? '（可多选，用逗号分隔）' : '';

    await sendMessage(`${header}\n\n${qText}${multi ? '\n' + multi : ''}\n\n${optionLines}\n\n请回复数字`);
  }
}

async function handleDangerousOperation(event: HookEvent): Promise<void> {
  const reason = event.reason || 'Unknown dangerous operation';
  warn(`Dangerous operation detected: ${reason}`);

  if (onDangerous) {
    onDangerous(reason);
  }

  if (isConfigured()) {
    await sendMessage(`⚠️ 危险操作检测：\n${reason}\n\n操作已被阻止。如需执行请在终端中确认。`);
  }
}