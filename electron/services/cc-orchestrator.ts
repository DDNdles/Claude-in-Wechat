// ═══════════════════════════════════════════════════════════════
// Claude Code Orchestrator — spawns/manages claude CLI processes per project
// ═══════════════════════════════════════════════════════════════

import { spawn, ChildProcess, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { info, warn, error, debug } from '../utils/logger';
import { RUNTIME_DIR } from '../utils/paths';
import { openTerminal as platformOpenTerminal, isWindows } from '../utils/platform';
import type {
  Project,
  TaskItem,
  OrchestratorEvent,
} from '../../shared/types';

// ── Types ──────────────────────────────────────────────────────────────

interface ManagedProcess {
  projectId: string;
  process: ChildProcess;
  pid: number;
  startedAt: string;
  cwd: string;
  outputLines: string[];       // Circular buffer, max BUFFER_SIZE
  lastOutput: string;          // Most recent meaningful output
  status: 'running' | 'exited' | 'error';
  exitCode: number | null;
}

interface ProcessStatus {
  pid: number | null;
  status: 'running' | 'exited' | 'error' | 'not_found';
  uptime: number | null;          // seconds
  lastOutput: string | null;
  exitCode: number | null;
}

interface ProjectManagerLike {
  getProject(id: string): Promise<Project | undefined>;
  getActiveProject(): Promise<Project | undefined>;
  updateProjectProgress(id: string, progress: number, tasks: TaskItem[]): Promise<void>;
  updateProjectStatus(id: string, status: Project['status'], pid?: number): Promise<void>;
}

// ── Constants ──────────────────────────────────────────────────────────

const BUFFER_SIZE = 100;          // Max lines to keep in output buffer
const CLAUDE_CMD = 'claude';      // CLI command name
const OUTPUT_DEBOUNCE_MS = 300;   // Debounce output parsing

// ── Task Parsing Regex ─────────────────────────────────────────────────

/** Match TaskCreate tool call JSON from Claude output */
const TASK_CREATE_RE = /"name"\s*:\s*"TaskCreate"\s*[,}].*?"subject"\s*:\s*"([^"]*)"/;

/** Match TaskUpdate tool call JSON */
const TASK_UPDATE_RE = /"name"\s*:\s*"TaskUpdate"\s*[,}].*?"taskId"\s*:\s*"([^"]*)".*?"status"\s*:\s*"([^"]*)"/;

/** Match status line like "Let me update task status" followed by TaskUpdate */
const STATUS_UPDATE_HINT = /status.*(?:completed|in.progress|pending)/i;

/** Match progress indicators like "step 3 of 7" or "(3/7)" */
const PROGRESS_RE = new RegExp('(?:step|步骤)\\s*(\\d+)\\s*(?:of\\\\s+|of|\\\\|/)\\s*(\\d+)', 'i');
const PROGRESS_PAREN_RE = /\((\d+)\s*\/\s*(\d+)\)/;

/** Match markdown task checkboxes */
const MD_TASK_RE = /^[-*+]\s+\[([ xX])\]\s+(.+)/;

/** Match token usage lines from Claude */
const TOKEN_INPUT_RE = /input.*?(\d+[,.]?\d*)\s*(?:tokens|tk)/i;
const TOKEN_OUTPUT_RE = /output.*?(\d+[,.]?\d*)\s*(?:tokens|tk)/i;
const TOKEN_CACHE_RE = /cache.*?(?:created|read).*?(\d+[,.]?\d*)/i;

/** Match error patterns */
const ERROR_RE = /(?:error|Error|ERROR|fatal|FATAL)\s*[:：]\s*(.+)/;

// ── Orchestrator Class ─────────────────────────────────────────────────

export class CcOrchestrator {
  private processes: Map<string, ManagedProcess> = new Map();
  private projectManager: ProjectManagerLike | null = null;
  private onEvent: ((event: OrchestratorEvent) => void) | null = null;
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  /** Set the project manager reference */
  setProjectManager(pm: ProjectManagerLike): void {
    this.projectManager = pm;
  }

  /** Set event callback for pushing to renderer */
  setEventCallback(cb: (event: OrchestratorEvent) => void): void {
    this.onEvent = cb;
  }

  /** Spawn a Claude Code CLI process for a project */
  spawnClaude(projectId: string, cwd: string, initialPrompt?: string): ManagedProcess {
    // Kill existing process for this project if any
    if (this.processes.has(projectId)) {
      debug(`Orchestrator: killing existing Claude process for project ${projectId}`);
      this.killClaude(projectId);
    }

    if (!fs.existsSync(cwd)) {
      throw new Error(`Project directory does not exist: ${cwd}`);
    }

    info(`Orchestrator: spawning Claude for project ${projectId} in ${cwd}`);

    const env = { ...process.env, CLAUDE_CODE_USE_NATIVE_TERM: '0' };

    let child: ChildProcess;

    if (isWindows) {
      // On Windows, spawn via cmd to run in hidden window
      const cmdArgs = ['/c', CLAUDE_CMD];
      if (initialPrompt) {
        // Pass initial prompt via stdin — we write it after spawn
      }

      child = spawn('cmd', cmdArgs, {
        cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false,
      });
    } else {
      child = spawn(CLAUDE_CMD, [], {
        cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    }

    const managed: ManagedProcess = {
      projectId,
      process: child,
      pid: child.pid || 0,
      startedAt: new Date().toISOString(),
      cwd,
      outputLines: [],
      lastOutput: '',
      status: 'running',
      exitCode: null,
    };

    this.processes.set(projectId, managed);

    // ── Setup output capture ───────────────────────────────────────

    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString('utf-8');
      this.appendOutput(projectId, text);
      this.parseOutput(projectId, text);
    });

    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString('utf-8');
      this.appendOutput(projectId, `[stderr] ${text}`);
      // Stderr might also contain useful info
      this.parseOutput(projectId, text);
    });

    child.on('error', (err) => {
      error(`Orchestrator: Claude process error for project ${projectId}`, err);
      managed.status = 'error';
      managed.exitCode = -1;
      this.appendOutput(projectId, `[error] ${err.message}`);
      this.emitEvent(projectId, 'error', { message: err.message });
      this.updateProjectStatus(projectId);
    });

    child.on('exit', (code, signal) => {
      info(`Orchestrator: Claude process exited for project ${projectId} (code=${code}, signal=${signal})`);
      managed.status = code === 0 ? 'exited' : 'error';
      managed.exitCode = code;
      this.appendOutput(projectId, `[process exited with code ${code}]`);
      this.emitEvent(projectId, 'status_change', { status: managed.status, exitCode: code });
      this.updateProjectStatus(projectId);
    });

    child.on('close', (code, signal) => {
      if (managed.status === 'running') {
        managed.status = code === 0 ? 'exited' : 'error';
        managed.exitCode = code;
        this.updateProjectStatus(projectId);
      }
    });

    // ── Write initial prompt if provided ───────────────────────────
    if (initialPrompt && child.stdin) {
      try {
        child.stdin.write(initialPrompt + '\n');
      } catch (err) {
        warn(`Orchestrator: failed to write initial prompt to Claude for ${projectId}`, err);
      }
    }

    this.updateProjectStatus(projectId);

    return managed;
  }

  /** Kill the Claude process tree for a project */
  killClaude(projectId: string): boolean {
    const managed = this.processes.get(projectId);
    if (!managed) {
      debug(`Orchestrator: no process found for project ${projectId}`);
      return false;
    }

    info(`Orchestrator: killing Claude process for project ${projectId} (pid=${managed.pid})`);

    try {
      if (isWindows) {
        // On Windows, use taskkill /T to kill entire process tree
        try {
          execSync(`taskkill /F /T /PID ${managed.pid}`, { encoding: 'utf-8', timeout: 5000 });
        } catch {
          // Process may have already exited
          debug(`Orchestrator: taskkill returned non-zero for pid ${managed.pid} (may already be dead)`);
        }
      } else {
        // On Unix, use process group kill
        try {
          process.kill(-managed.pid, 'SIGTERM');
        } catch {
          // Fallback: kill directly
          try {
            process.kill(managed.pid, 'SIGKILL');
          } catch {
            // Already dead
          }
        }
      }

      managed.status = 'exited';
      managed.exitCode = -1; // Killed
      this.processes.delete(projectId);
      this.updateProjectStatus(projectId);
      return true;
    } catch (err) {
      error(`Orchestrator: failed to kill process for ${projectId}`, err);
      return false;
    }
  }

  /** Send a message to Claude's stdin */
  sendToClaude(projectId: string, message: string): boolean {
    const managed = this.processes.get(projectId);
    if (!managed || !managed.process.stdin) {
      warn(`Orchestrator: cannot send to Claude — no stdin for project ${projectId}`);
      return false;
    }

    if (managed.status !== 'running') {
      warn(`Orchestrator: cannot send to Claude — process not running (status=${managed.status})`);
      return false;
    }

    try {
      managed.process.stdin.write(message + '\n');
      debug(`Orchestrator: sent message to Claude for project ${projectId} (${message.length} chars)`);
      return true;
    } catch (err) {
      error(`Orchestrator: failed to write to Claude stdin for ${projectId}`, err);
      return false;
    }
  }

  /** Get status of a Claude process for a project */
  getClaudeStatus(projectId: string): ProcessStatus {
    const managed = this.processes.get(projectId);
    if (!managed) {
      return {
        pid: null,
        status: 'not_found',
        uptime: null,
        lastOutput: null,
        exitCode: null,
      };
    }

    const uptime = managed.startedAt
      ? Math.round((Date.now() - new Date(managed.startedAt).getTime()) / 1000)
      : null;

    return {
      pid: managed.pid,
      status: managed.status,
      uptime,
      lastOutput: managed.lastOutput || null,
      exitCode: managed.exitCode,
    };
  }

  /** Open a visible terminal window for a project */
  openTerminal(projectId: string): boolean {
    const managed = this.processes.get(projectId);
    const cwd = managed?.cwd;

    if (!managed && !cwd) {
      // Try to find project path from project manager
      warn(`Orchestrator: no process or cwd found for project ${projectId}`);
      return false;
    }

    const projectCwd = cwd || managed!.cwd;

    try {
      platformOpenTerminal(projectCwd, `Project-${projectId}`);
      info(`Orchestrator: opened terminal for project ${projectId}`);
      return true;
    } catch (err) {
      error(`Orchestrator: failed to open terminal for ${projectId}`, err);
      return false;
    }
  }

  /** List all managed processes */
  listProcesses(): Map<string, ProcessStatus> {
    const result = new Map<string, ProcessStatus>();
    for (const [id, managed] of this.processes) {
      result.set(id, this.getClaudeStatus(id));
    }
    return result;
  }

  /** Get recent output for a project */
  getOutput(projectId: string, lines?: number): string[] {
    const managed = this.processes.get(projectId);
    if (!managed) return [];

    if (lines && lines > 0) {
      return managed.outputLines.slice(-lines);
    }
    return [...managed.outputLines];
  }

  /** Kill all processes (e.g., on app shutdown) */
  killAll(): void {
    info(`Orchestrator: killing all ${this.processes.size} Claude process(es)`);
    for (const projectId of this.processes.keys()) {
      this.killClaude(projectId);
    }
  }

  // ── Internal: Output Buffer ──────────────────────────────────────

  private appendOutput(projectId: string, text: string): void {
    const managed = this.processes.get(projectId);
    if (!managed) return;

    const lines = text.split('\n');
    for (const line of lines) {
      if (line.trim()) {
        managed.outputLines.push(line);
        managed.lastOutput = line;
      }
    }

    // Keep only last BUFFER_SIZE lines
    if (managed.outputLines.length > BUFFER_SIZE) {
      managed.outputLines = managed.outputLines.slice(-BUFFER_SIZE);
    }

    this.emitEvent(projectId, 'output', { text: text.slice(0, 500) });
  }

  // ── Internal: Output Parsing ─────────────────────────────────────

  private parseOutput(projectId: string, text: string): void {
    // Debounce parsing to batch process
    const existing = this.debounceTimers.get(projectId);
    if (existing) clearTimeout(existing);

    this.debounceTimers.set(projectId, setTimeout(() => {
      this.doParseOutput(projectId);
      this.debounceTimers.delete(projectId);
    }, OUTPUT_DEBOUNCE_MS));
  }

  private doParseOutput(projectId: string): void {
    const managed = this.processes.get(projectId);
    if (!managed) return;

    const recentOutput = managed.outputLines.slice(-20).join('\n');

    // Parse tasks from output
    const tasks = this.extractTasks(recentOutput);

    // Parse progress indicators
    const progress = this.extractProgress(recentOutput);

    if (tasks.length > 0 || progress) {
      this.emitEvent(projectId, 'task_update', { tasks, progress });
      this.updateProjectProgress(projectId, tasks);
    }

    // Check for errors
    const errorMatch = recentOutput.match(ERROR_RE);
    if (errorMatch && managed.status === 'running') {
      this.emitEvent(projectId, 'error', { message: errorMatch[1] });
    }
  }

  /** Extract task items from Claude output */
  private extractTasks(output: string): TaskItem[] {
    const tasks: TaskItem[] = [];
    let taskIdx = 0;

    // Try TaskCreate tool call JSON
    const createMatches = output.matchAll(
      /"subject"\s*:\s*"([^"]*)"/g
    );
    for (const match of createMatches) {
      taskIdx++;
      const subject = match[1];
      // Check for corresponding status update nearby
      const status = this.findTaskStatus(output, taskIdx.toString());
      tasks.push({
        id: `parsed-${taskIdx}`,
        subject,
        description: '',
        status: status || 'pending',
      });
    }

    // Parse markdown checklist
    const mdMatches = output.matchAll(new RegExp(MD_TASK_RE.source, 'gm'));
    for (const match of mdMatches) {
      taskIdx++;
      const checked = match[1].toLowerCase() === 'x';
      tasks.push({
        id: `md-${taskIdx}`,
        subject: match[2].trim(),
        description: '',
        status: checked ? 'completed' : 'pending',
      });
    }

    return tasks;
  }

  private findTaskStatus(output: string, taskId: string): TaskItem['status'] | null {
    const updateRe = new RegExp(
      `"taskId"\\s*:\\s*"?${taskId}"?[^}]*"status"\\s*:\\s*"([^"]*)"`,
      'i'
    );
    const match = output.match(updateRe);
    if (match) {
      const s = match[1].toLowerCase();
      if (s === 'completed') return 'completed';
      if (s === 'in_progress') return 'in_progress';
      return 'pending';
    }
    return null;
  }

  /** Extract progress info from output */
  private extractProgress(output: string): { currentStep?: number; totalSteps?: number } | null {
    // "step 3 of 7"
    let match = output.match(PROGRESS_RE);
    if (match) {
      return {
        currentStep: parseInt(match[1], 10),
        totalSteps: parseInt(match[2], 10),
      };
    }
    // "(3/7)"
    match = output.match(PROGRESS_PAREN_RE);
    if (match) {
      return {
        currentStep: parseInt(match[1], 10),
        totalSteps: parseInt(match[2], 10),
      };
    }
    return null;
  }

  // ── Internal: Project Updates ────────────────────────────────────

  private async updateProjectStatus(projectId: string): Promise<void> {
    if (!this.projectManager) return;
    try {
      const status = this.getClaudeStatus(projectId);
      const projectStatus: Project['status'] =
        status.status === 'running' ? 'running' :
        status.status === 'error' ? 'error' :
        status.status === 'exited' && status.exitCode === 0 ? 'completed' :
        'idle';

      await this.projectManager.updateProjectStatus(projectId, projectStatus, status.pid || undefined);
    } catch (err) {
      debug(`Orchestrator: failed to update project status for ${projectId}`, err);
    }
  }

  private async updateProjectProgress(projectId: string, tasks: TaskItem[]): Promise<void> {
    if (!this.projectManager || tasks.length === 0) return;
    try {
      const completed = tasks.filter(t => t.status === 'completed').length;
      const progress = Math.round((completed / tasks.length) * 100);
      await this.projectManager.updateProjectProgress(projectId, progress, tasks);
    } catch (err) {
      debug(`Orchestrator: failed to update project progress for ${projectId}`, err);
    }
  }

  // ── Internal: Event Emission ─────────────────────────────────────

  private emitEvent(projectId: string, type: OrchestratorEvent['type'], data?: unknown): void {
    if (this.onEvent) {
      try {
        this.onEvent({
          type,
          projectId,
          data,
          timestamp: new Date().toISOString(),
        });
      } catch {
        // Silent fail
      }
    }
  }
}

// ── Singleton ──────────────────────────────────────────────────────────

let _instance: CcOrchestrator | null = null;

export function getCcOrchestrator(): CcOrchestrator {
  if (!_instance) {
    _instance = new CcOrchestrator();
  }
  return _instance;
}
