// ═══════════════════════════════════════════════════════════════
// Claude Launcher Service v0.5.4
// Opens visible terminal windows + stdin forwarding for WeChat tasks.
// Key change: saves stdin pipe for task forwarding from relay-service.
// ═══════════════════════════════════════════════════════════════

import { execSync, spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { info, warn, error, debug } from '../utils/logger';

// ── Tracked sessions ───────────────────────────────────────────────

interface TerminalSession {
  projectId: string;
  pid: number;
  startedAt: string;
  cwd: string;
  projectName: string;
  child?: ChildProcess; // for stdin forwarding
}

const sessions = new Map<string, TerminalSession>();

// ── Public API ─────────────────────────────────────────────────────

/**
 * Open a terminal window running Claude Code in the project directory.
 * If a session already exists for this project, focuses the existing window.
 * Returns the PID of the terminal process (for tracking).
 */
export function openClaudeTerminal(
  projectId: string,
  cwd: string,
  projectName: string,
): { success: boolean; pid?: number; message: string } {
  try {
    if (!fs.existsSync(cwd)) {
      return { success: false, message: `项目目录不存在: ${cwd}` };
    }

    // Check if a session already exists and focus it
    const existing = sessions.get(projectId);
    if (existing) {
      if (isPidAlive(existing.pid)) {
        focusClaudeWindow(existing.pid, projectName);
        return { success: true, pid: existing.pid, message: `已聚焦项目「${projectName}」窗口` };
      }
      // Dead session, clean up
      sessions.delete(projectId);
    }

    // Also check for orphaned claude processes in this directory
    const orphanPid = findClaudeInDir(cwd);
    if (orphanPid) {
      focusClaudeWindow(orphanPid, projectName);
      sessions.set(projectId, {
        projectId, pid: orphanPid, cwd, projectName,
        startedAt: new Date().toISOString(),
      });
      return { success: true, pid: orphanPid, message: `已连接到现有 Claude「${projectName}」` };
    }

    if (process.platform === 'win32') {
      return openOnWindows(projectId, cwd, projectName);
    } else {
      return openOnUnix(projectId, cwd, projectName);
    }
  } catch (err: any) {
    error(`Failed to open Claude terminal for ${projectName}`, err);
    return { success: false, message: `无法打开终端: ${err.message}` };
  }
}

function openOnWindows(
  projectId: string,
  cwd: string,
  projectName: string,
): { success: boolean; pid?: number; message: string } {
  // Use spawn to get a child process we can write stdin to
  // /k keeps the window open after claude exits
  const escapedCwd = cwd.replace(/"/g, '\\"');
  const cmd = `cd /d "${escapedCwd}" && claude`;

  const child = spawn('cmd', ['/k', cmd], {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: false,
    detached: true,
  });

  const pid = child.pid;
  if (pid) {
    sessions.set(projectId, {
      projectId, pid, cwd, projectName,
      startedAt: new Date().toISOString(),
      child,
    });
    info(`Claude terminal opened: ${projectName} (pid=${pid}, cwd=${cwd})`);

    // Don't wait for the child — let it run independently
    child.unref();

    return { success: true, pid, message: `已在终端中打开项目「${projectName}」` };
  }

  return { success: false, message: '无法获取进程 PID' };
}

function openOnUnix(
  projectId: string,
  cwd: string,
  projectName: string,
): { success: boolean; pid?: number; message: string } {
  const escaped = cwd.replace(/'/g, "'\\''");
  let child: ChildProcess;

  if (process.platform === 'darwin') {
    child = spawn('osascript', ['-e', `tell app "Terminal" to do script "cd ${escaped} && claude"`], {
      stdio: 'ignore',
      detached: true,
    });
  } else {
    child = spawn('gnome-terminal', ['--', 'bash', '-c', `cd ${escaped} && claude; exec bash`], {
      stdio: 'ignore',
      detached: true,
    });
  }

  child.unref();
  return { success: true, pid: child.pid, message: `已在终端中打开项目「${projectName}」` };
}

/**
 * Open a terminal window in the project directory (without running Claude).
 */
export function openProjectTerminal(
  projectId: string,
  cwd: string,
  projectName: string,
): { success: boolean; message: string } {
  try {
    if (!fs.existsSync(cwd)) {
      return { success: false, message: `项目目录不存在: ${cwd}` };
    }

    if (process.platform === 'win32') {
      const escapedCwd = cwd.replace(/"/g, '\\"');
      const child = spawn('cmd', ['/k', `cd /d "${escapedCwd}"`], {
        cwd,
        stdio: 'ignore',
        windowsHide: false,
        detached: true,
      });
      child.unref();
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
 * Forward a task message to the running Claude process via stdin.
 * If the tracked session is dead, starts a new one.
 */
export async function forwardTask(
  projectId: string,
  cwd: string,
  projectName: string,
  text: string,
): Promise<{ success: boolean; message: string }> {
  const session = sessions.get(projectId);

  if (session && session.child && isPidAlive(session.pid)) {
    // Try writing to existing session's stdin
    try {
      session.child.stdin?.write(text + '\n');
      debug(`Task forwarded to ${projectName}: "${text.slice(0, 50)}"`);
      return { success: true, message: `已转发到「${projectName}」` };
    } catch (writeErr: any) {
      warn(`Failed to write to ${projectName} stdin, falling back to claude --print`, writeErr);
    }
  }

  // Fallback: use claude --print for one-shot task forwarding
  // This reuses the project's session state
  try {
    const result = await runClaudePrint(cwd, text);
    return result;
  } catch (err: any) {
    error(`Failed to forward task to ${projectName}`, err);
    return { success: false, message: `转发失败: ${err.message}` };
  }
}

function runClaudePrint(cwd: string, text: string): Promise<{ success: boolean; message: string }> {
  return new Promise((resolve) => {
    const child = spawn('claude', ['--print', text], {
      cwd,
      stdio: 'pipe',
      windowsHide: true,
    });

    let output = '';
    const timeout = setTimeout(() => {
      child.kill();
      resolve({ success: false, message: 'Claude Code 执行超时' });
    }, 300000); // 5 min timeout

    child.stdout.on('data', (d: Buffer) => {
      output += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      output += d.toString();
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0 && output.trim()) {
        debug(`Claude --print output: ${output.slice(0, 100)}`);
        resolve({ success: true, message: output.trim() });
      } else {
        resolve({ success: false, message: output.trim() || `Claude Code 退出 (code=${code})` });
      }
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      resolve({ success: false, message: `Claude Code 启动失败: ${err.message}` });
    });
  });
}

// ── Focus existing window ─────────────────────────────────────────

/** Bring an existing Claude Code terminal window to the foreground */
function focusClaudeWindow(pid: number, projectName: string): void {
  try {
    if (process.platform === 'win32') {
      // PowerShell script to find and activate the window by PID
      const ps = `
Add-Type @"
  using System;
  using System.Runtime.InteropServices;
  public class Win32 {
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);
    [DllImport("user32.dll")] public static extern IntPtr GetTopWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, int lParam);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
    public delegate bool EnumWindowsProc(IntPtr hWnd, int lParam);
  }
"@

$targetPid = ${pid}
$foundWindow = [IntPtr]::Zero

$callback = {
  param($hWnd, $lParam)
  $windowPid = 0
  [Win32]::GetWindowThreadProcessId($hWnd, [ref]$windowPid)
  if ($windowPid -eq $targetPid) {
    $sb = New-Object System.Text.StringBuilder(256)
    [Win32]::GetWindowText($hWnd, $sb, 256)
    $title = $sb.ToString()
    if ($title.Length -gt 0) {
      $script:foundWindow = $hWnd
      return $false
    }
  }
  return $true
}

$enumProc = [Win32+EnumWindowsProc]$callback
[Win32]::EnumWindows($enumProc, 0) | Out-Null

if ($script:foundWindow -ne [IntPtr]::Zero) {
  if ([Win32]::IsIconic($script:foundWindow)) {
    [Win32]::ShowWindow($script:foundWindow, 9)  # SW_RESTORE
  }
  [Win32]::SetForegroundWindow($script:foundWindow) | Out-Null
}
`.trim();

      spawn('powershell', ['-NoProfile', '-Command', ps], {
        stdio: 'ignore',
        windowsHide: true,
        detached: true,
      }).unref();

      debug(`Attempting to focus Claude window for ${projectName} (pid=${pid})`);
    }
  } catch (err) {
    warn(`Failed to focus Claude window for ${projectName}`, err);
  }
}

// ── Session management ────────────────────────────────────────────

export function hasSession(projectId: string): boolean {
  const s = sessions.get(projectId);
  if (!s) return false;
  if (!isPidAlive(s.pid)) {
    sessions.delete(projectId);
    return false;
  }
  return true;
}

export function getSessionPid(projectId: string): number | null {
  const s = sessions.get(projectId);
  if (!s) return null;
  if (!isPidAlive(s.pid)) {
    sessions.delete(projectId);
    return null;
  }
  return s.pid;
}

export function killSession(projectId: string): boolean {
  const s = sessions.get(projectId);
  if (!s) return false;
  try {
    killProcess(s.pid);
    sessions.delete(projectId);
    info(`Killed terminal session for ${projectId}`);
    return true;
  } catch {
    return false;
  }
}

export function killAllSessions(): void {
  for (const [id, s] of sessions) {
    try { killProcess(s.pid); } catch { /* ok */ }
    sessions.delete(id);
  }
  info('All terminal sessions killed');
}

// ── External project detection ────────────────────────────────────

/** Find a claude.exe process running in a specific directory */
function findClaudeInDir(cwd: string): number | null {
  try {
    if (process.platform !== 'win32') return null;

    const result = execSync(
      `wmic process where "name='cmd.exe'" get ProcessId,CommandLine /format:csv 2>nul`,
      { encoding: 'utf-8', windowsHide: true },
    );

    const normalized = cwd.replace(/\\/g, '\\\\').toLowerCase();
    for (const line of result.split('\n')) {
      if (line.toLowerCase().includes(normalized)) {
        const match = line.match(/(\d+)/) as RegExpMatchArray | null;
        if (match) return parseInt(match[1], 10);
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ── Internal ───────────────────────────────────────────────────────

function killProcess(pid: number): void {
  if (process.platform === 'win32') {
    execSync(`taskkill /PID ${pid} /T /F 2>nul`, { stdio: 'ignore' });
  } else {
    try { process.kill(pid, 'SIGTERM'); } catch { /* dead */ }
  }
}

function isPidAlive(pid: number): boolean {
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