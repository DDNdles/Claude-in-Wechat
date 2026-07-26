// Claude Launcher Service v0.5.5
// Uses Claude Code's native --session-id / --resume for real task forwarding.
// WeChat tasks run via `claude --resume <sid> -p` in headless mode,
// sharing the SAME session as the visible desktop terminal.

import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { info, warn, error, debug } from '../utils/logger';

const HOME = os.homedir();
const CLAUDE_PROJECTS_DIR = path.join(HOME, '.claude', 'projects');

interface TerminalSession {
  projectId: string;
  pid: number;
  sessionId: string;
  startedAt: string;
  cwd: string;
  projectName: string;
}

const sessions = new Map<string, TerminalSession>();

// Generate a fresh session UUID
function newSessionId(): string {
  return crypto.randomUUID();
}

/**
 * Encode a cwd path the way Claude Code stores project dirs:
 * C:\Users\foo\bar -> C--Users-foo-bar
 */
function encodeCwd(cwd: string): string {
  return cwd.replace(/[:\\\/]/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Find the most recent session jsonl for a project directory.
 * Returns the session ID (filename without extension) or null.
 */
export function findLatestSession(cwd: string): string | null {
  try {
    const encoded = encodeCwd(cwd);
    const dir = path.join(CLAUDE_PROJECTS_DIR, encoded);
    if (!fs.existsSync(dir)) return null;

    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({
        name: f,
        mtime: fs.statSync(path.join(dir, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);

    if (files.length === 0) return null;
    return files[0].name.replace(/\.jsonl$/, '');
  } catch {
    return null;
  }
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Open a visible terminal running Claude Code with a fixed session ID.
 * If a session already exists for this project, focuses its window.
 */
export function openClaudeTerminal(
  projectId: string,
  cwd: string,
  projectName: string,
  existingSessionId?: string,
): { success: boolean; pid?: number; message: string; sessionId?: string } {
  try {
    if (!fs.existsSync(cwd)) {
      fs.mkdirSync(cwd, { recursive: true });
    }

    // Reuse or create session ID
    const sessionId = existingSessionId || sessions.get(projectId)?.sessionId || newSessionId();

    // Focus existing window if alive
    const existing = sessions.get(projectId);
    if (existing && isPidAlive(existing.pid)) {
      focusClaudeWindow(existing.pid, projectName);
      return { success: true, pid: existing.pid, sessionId, message: `已聚焦项目「${projectName}」窗口` };
    }

    // Check for orphaned claude process in this dir
    const orphanPid = findClaudePidInDir(cwd);
    if (orphanPid) {
      focusClaudeWindow(orphanPid, projectName);
      sessions.set(projectId, {
        projectId, pid: orphanPid, sessionId,
        cwd, projectName, startedAt: new Date().toISOString(),
      });
      return { success: true, pid: orphanPid, sessionId, message: `已连接到现有 Claude「${projectName}」` };
    }

    if (process.platform === 'win32') {
      return openOnWindows(projectId, cwd, projectName, sessionId);
    } else {
      return openOnUnix(projectId, cwd, projectName, sessionId);
    }
  } catch (err: any) {
    error(`Failed to open Claude terminal for ${projectName}`, err);
    return { success: false, message: `无法打开终端: ${err.message}` };
  }
}

function openOnWindows(
  projectId: string, cwd: string, projectName: string, sessionId: string,
): { success: boolean; pid?: number; message: string; sessionId?: string } {
  const title = `Claude - ${projectName}`;
  // Ensure cwd exists
  if (!fs.existsSync(cwd)) fs.mkdirSync(cwd, { recursive: true });

  // Use `start` to open a new console window. Quote the inner command carefully:
  //   start "TITLE" cmd /k "cd /d "C:\path with space" && claude --session-id <sid>"
  // The inner double-quotes around the path are balanced within the outer quotes.
  const innerCmd = `cd /d "${cwd}" && claude --session-id ${sessionId}`;

  try {
    // Use Start-Process for PID tracking
    const psCmd = `Start-Process cmd -ArgumentList '/k ${escapeForPowerShell(innerCmd)}' -PassThru -WindowStyle Normal | Select-Object -ExpandProperty Id`;
    const result = execSync(`powershell -NoProfile -Command "${psCmd.replace(/"/g, '\\"')}"`, {
      encoding: 'utf-8', timeout: 15_000, windowsHide: true,
    });
    const pid = parseInt(result.trim(), 10);
    if (pid && !isNaN(pid)) {
      sessions.set(projectId, { projectId, pid, sessionId, cwd, projectName, startedAt: new Date().toISOString() });
      info(`Claude terminal opened: ${projectName} (pid=${pid}, session=${sessionId.slice(0, 8)})`);
      return { success: true, pid, sessionId, message: `已在终端中打开项目「${projectName}」` };
    }
  } catch (err) {
    warn('PowerShell launch failed, falling back to start', err);
  }

  // Fallback: cmd /c start (no PID)
  spawn('cmd', ['/c', 'start', `"${title}"`, 'cmd', '/k', innerCmd], {
    cwd, stdio: 'ignore', windowsHide: false, detached: true,
  }).unref();
  sessions.set(projectId, { projectId, pid: 0, sessionId, cwd, projectName, startedAt: new Date().toISOString() });
  return { success: true, sessionId, message: `已在终端中打开项目「${projectName}」` };
}

/** Escape a string so it survives being placed inside PowerShell single-quoted ArgumentList. */
function escapeForPowerShell(s: string): string {
  // Wrap in single quotes; double any existing single quotes
  return "'" + s.replace(/'/g, "''") + "'";
}

function openOnUnix(
  projectId: string, cwd: string, projectName: string, sessionId: string,
): { success: boolean; pid?: number; message: string; sessionId?: string } {
  const escaped = cwd.replace(/'/g, "'\\''");
  let child;
  if (process.platform === 'darwin') {
    child = spawn('osascript', ['-e', `tell app "Terminal" to do script "cd ${escaped} && claude --session-id ${sessionId}"`], {
      stdio: 'ignore', detached: true,
    });
  } else {
    child = spawn('gnome-terminal', ['--', 'bash', '-c', `cd ${escaped} && claude --session-id ${sessionId}; exec bash`], {
      stdio: 'ignore', detached: true,
    });
  }
  child.unref();
  sessions.set(projectId, {
    projectId, pid: child.pid || 0, sessionId, cwd, projectName,
    startedAt: new Date().toISOString(),
  });
  return { success: true, pid: child.pid, sessionId, message: `已在终端中打开项目「${projectName}」` };
}

/**
 * Open a plain terminal in the project directory (no Claude).
 */
export function openProjectTerminal(
  projectId: string, cwd: string, projectName: string,
): { success: boolean; message: string } {
  try {
    if (!fs.existsSync(cwd)) fs.mkdirSync(cwd, { recursive: true });

    if (process.platform === 'win32') {
      const title = `Project - ${projectName}`;
      const innerCmd = `cd /d "${cwd}"`;
      // `start "TITLE" cmd /k "cd /d "C:\path""`
      spawn('cmd', ['/c', 'start', `"${title}"`, 'cmd', '/k', innerCmd], {
        cwd, stdio: 'ignore', windowsHide: false, detached: true,
      }).unref();
    } else if (process.platform === 'darwin') {
      const escaped = cwd.replace(/'/g, "'\\''");
      execSync(`osascript -e 'tell app "Terminal" to do script "cd ${escaped}"'`, { timeout: 5000 });
    } else {
      const escaped = cwd.replace(/'/g, "'\\''");
      execSync(`gnome-terminal -- bash -c "cd ${escaped}; exec bash"`, { timeout: 5000 });
    }
    return { success: true, message: '已在终端中打开项目目录' };
  } catch (err: any) {
    return { success: false, message: `无法打开终端: ${err.message}` };
  }
}

/**
 * Forward a task to the project's Claude session via headless `claude -p`.
 * - If a session jsonl exists on disk → `claude --resume <sid> -p` (continue it)
 * - If not → `claude --session-id <new-uuid> -p` (create a new fixed-id session,
 *   which persists to disk so future --resume works)
 * Returns Claude's actual reply text.
 */
export async function forwardTask(
  projectId: string,
  cwd: string,
  projectName: string,
  text: string,
  knownSessionId?: string,
): Promise<{ success: boolean; message: string }> {
  // Resolve candidate session ID: known > tracked > latest jsonl
  const candidateSid = knownSessionId || sessions.get(projectId)?.sessionId || findLatestSession(cwd) || undefined;
  // Only --resume if the session actually exists on disk (jsonl present)
  const sessionExists = candidateSid ? sessionJsonlExists(cwd, candidateSid) : false;

  try {
    const reply = await runClaudeHeadless(cwd, text, sessionExists ? candidateSid : undefined);
    debug(`Task forwarded to ${projectName}: "${text.slice(0, 50)}"`);
    return { success: true, message: reply };
  } catch (err: any) {
    error(`Failed to forward task to ${projectName}`, err);
    return { success: false, message: `转发失败: ${err.message}` };
  }
}

/** Check whether a session jsonl exists for the given cwd + sessionId. */
function sessionJsonlExists(cwd: string, sessionId: string): boolean {
  try {
    const encoded = encodeCwd(cwd);
    const file = path.join(CLAUDE_PROJECTS_DIR, encoded, `${sessionId}.jsonl`);
    return fs.existsSync(file);
  } catch { return false; }
}

/**
 * Run `claude -p "<text>"` headless. If resumeSid is provided AND exists, resume it;
 * otherwise start a fresh session (optionally with a fixed --session-id).
 * stdin is set to 'ignore' to avoid the "no stdin data received" warning.
 */
function runClaudeHeadless(cwd: string, text: string, resumeSid?: string): Promise<string> {
  return new Promise((resolve) => {
    const args = ['-p', text, '--output-format', 'text'];
    if (resumeSid) {
      args.unshift('--resume', resumeSid);
    } else {
      // Fresh session with a fixed UUID so it persists and can be resumed later
      args.unshift('--session-id', newSessionId());
    }

    const child = spawn('claude', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'], // stdin ignored → no "no stdin data" warning
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill();
      resolve(`(执行超时，但任务可能仍在后台运行)`);
    }, 600000); // 10 min

    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    child.on('close', (code) => {
      clearTimeout(timeout);
      const out = stdout.trim();
      if (out) resolve(out);
      else resolve(`(无输出，退出码 ${code})${stderr ? '\n' + stderr.slice(0, 200) : ''}`);
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      resolve(`Claude Code 启动失败: ${err.message}`);
    });
  });
}

// ── Focus existing window ─────────────────────────────────────────

function focusClaudeWindow(pid: number, projectName: string): void {
  try {
    if (process.platform !== 'win32') return;

    const ps = `
Add-Type @"
  using System;
  using System.Runtime.InteropServices;
  public class Win32 {
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, int lParam);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
    public delegate bool EnumWindowsProc(IntPtr hWnd, int lParam);
  }
"@
$targetPid = ${pid}
$script:found = [IntPtr]::Zero
$cb = {
  param($hWnd, $l)
  $wp = 0
  [Win32]::GetWindowThreadProcessId($hWnd, [ref]$wp)
  if ($wp -eq $targetPid) {
    $sb = New-Object System.Text.StringBuilder(256)
    [Win32]::GetWindowText($hWnd, $sb, 256)
    if ($sb.ToString().Length -gt 0) { $script:found = $hWnd; return $false }
  }
  return $true
}
[Win32]::EnumWindows([Win32+EnumWindowsProc]$cb, 0) | Out-Null
if ($script:found -ne [IntPtr]::Zero) {
  if ([Win32]::IsIconic($script:found)) { [Win32]::ShowWindow($script:found, 9) }
  [Win32]::SetForegroundWindow($script:found) | Out-Null
}`.trim();

    spawn('powershell', ['-NoProfile', '-Command', ps], {
      stdio: 'ignore', windowsHide: true, detached: true,
    }).unref();
    debug(`Focusing Claude window for ${projectName} (pid=${pid})`);
  } catch (err) {
    warn(`Failed to focus Claude window for ${projectName}`, err);
  }
}

// ── Session management ────────────────────────────────────────────

export function hasSession(projectId: string): boolean {
  const s = sessions.get(projectId);
  if (!s) return false;
  if (s.pid && !isPidAlive(s.pid)) { sessions.delete(projectId); return false; }
  return true;
}

export function getSessionPid(projectId: string): number | null {
  const s = sessions.get(projectId);
  if (!s) return null;
  if (s.pid && !isPidAlive(s.pid)) { sessions.delete(projectId); return null; }
  return s.pid;
}

export function getSessionId(projectId: string): string | null {
  return sessions.get(projectId)?.sessionId || null;
}

export function killSession(projectId: string): boolean {
  const s = sessions.get(projectId);
  if (!s) return false;
  try {
    if (s.pid) killProcess(s.pid);
    sessions.delete(projectId);
    return true;
  } catch { return false; }
}

export function killAllSessions(): void {
  for (const [id, s] of sessions) {
    try { if (s.pid) killProcess(s.pid); } catch { /* ok */ }
    sessions.delete(id);
  }
}

// ── Internal ───────────────────────────────────────────────────────

function findClaudePidInDir(cwd: string): number | null {
  try {
    if (process.platform !== 'win32') return null;
    const result = execSync(
      `wmic process where "name='cmd.exe'" get ProcessId,CommandLine /format:csv 2>nul`,
      { encoding: 'utf-8', windowsHide: true },
    );
    const norm = cwd.toLowerCase();
    for (const line of result.split('\n')) {
      if (line.toLowerCase().includes(norm) && line.toLowerCase().includes('claude')) {
        const match = line.match(/(\d+)\s*$/);
        if (match) {
          const pid = parseInt(match[1], 10);
          if (pid && isPidAlive(pid)) return pid;
        }
      }
    }
    return null;
  } catch { return null; }
}

function killProcess(pid: number): void {
  if (process.platform === 'win32') {
    execSync(`taskkill /PID ${pid} /T /F 2>nul`, { stdio: 'ignore' });
  } else {
    try { process.kill(pid, 'SIGTERM'); } catch { /* dead */ }
  }
}

function isPidAlive(pid: number): boolean {
  if (!pid) return false;
  try {
    if (process.platform === 'win32') {
      const result = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, {
        encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true,
      });
      return result.includes(`"${pid}"`);
    }
    process.kill(pid, 0);
    return true;
  } catch { return false; }
}