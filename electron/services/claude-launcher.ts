// ═══════════════════════════════════════════════════════════════
// Claude Launcher Service v0.3
// Opens REAL visible terminal windows running Claude Code
// ═══════════════════════════════════════════════════════════════

import { execSync, exec } from 'node:child_process';
import fs from 'node:fs';
import { info, warn, error, debug } from '../utils/logger';

// ── Tracked sessions ───────────────────────────────────────────────

interface TerminalSession {
  projectId: string;
  pid: number;
  startedAt: string;
  cwd: string;
}

const sessions = new Map<string, TerminalSession>();

// ── Public API ─────────────────────────────────────────────────────

/**
 * Open a terminal window running Claude Code in the project directory.
 * On Windows: opens a new cmd.exe window.
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

    // Kill existing session for this project if tracked
    const existing = sessions.get(projectId);
    if (existing) {
      try { killProcess(existing.pid); } catch { /* already dead */ }
      sessions.delete(projectId);
    }

    if (process.platform === 'win32') {
      // Use start command to open a new visible cmd window
      const title = `Claude - ${projectName}`;
      // cmd /k keeps window open after claude exits
      const cmd = `start "${title}" cmd /k "cd /d "${cwd}" && claude"`;
      // We need to track the PID — use PowerShell to get it
      const psCmd = `powershell -Command "$p = Start-Process cmd -ArgumentList '/k cd /d \\"${cwd}\\" && claude' -PassThru -WindowStyle Normal; Write-Output $p.Id"`;
      const result = execSync(psCmd, { encoding: 'utf-8', timeout: 10_000, windowsHide: true });
      const pid = parseInt(result.trim(), 10);

      if (pid && !isNaN(pid)) {
        sessions.set(projectId, {
          projectId, pid, cwd,
          startedAt: new Date().toISOString(),
        });
        info(`Claude terminal opened: ${projectName} (pid=${pid}, cwd=${cwd})`);
        return { success: true, pid, message: `已在终端中打开项目「${projectName}」` };
      }

      // Fallback: just use start without PID tracking
      exec(`start "Claude - ${projectName}" cmd /k "cd /d "${cwd}" && claude"`, (err) => {
        if (err) error(`Failed to open terminal for ${projectName}`, err);
      });
      return { success: true, message: `已在终端中打开项目「${projectName}」` };
    } else {
      // macOS / Linux
      const escaped = cwd.replace(/'/g, "'\\''");
      const cmd = process.platform === 'darwin'
        ? `osascript -e 'tell app "Terminal" to do script "cd ${escaped} && claude"'`
        : `gnome-terminal -- bash -c "cd ${escaped} && claude; exec bash"`;
      execSync(cmd, { timeout: 5_000 });
      return { success: true, message: `已在终端中打开项目「${projectName}」` };
    }
  } catch (err: any) {
    error(`Failed to open Claude terminal for ${projectName}`, err);

    // Last resort: try the simplest approach
    try {
      if (process.platform === 'win32') {
        exec(`start "Claude - ${projectName}" cmd /k "cd /d "${cwd}" && claude"`);
        return { success: true, message: `已在终端中打开项目「${projectName}」` };
      }
    } catch { /* give up */ }

    return { success: false, message: `无法打开终端: ${err.message}` };
  }
}

/**
 * Open a terminal window in the project directory (without running Claude).
 * For when the user just wants to browse the project.
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
      exec(`start "Project - ${projectName}" cmd /k "cd /d "${cwd}""`);
    } else if (process.platform === 'darwin') {
      const escaped = cwd.replace(/'/g, "'\\''");
      exec(`osascript -e 'tell app "Terminal" to do script "cd ${escaped}"'`);
    } else {
      const escaped = cwd.replace(/'/g, "'\\''");
      exec(`gnome-terminal -- bash -c "cd ${escaped}; exec bash"`);
    }
    return { success: true, message: `已在终端中打开项目目录` };
  } catch (err: any) {
    return { success: false, message: `无法打开终端: ${err.message}` };
  }
}

/** Check if a project has an active terminal session */
export function hasSession(projectId: string): boolean {
  const s = sessions.get(projectId);
  if (!s) return false;
  // Verify the process is still alive
  if (!isPidAlive(s.pid)) {
    sessions.delete(projectId);
    return false;
  }
  return true;
}

/** Get the tracked PID for a project (for status display) */
export function getSessionPid(projectId: string): number | null {
  const s = sessions.get(projectId);
  if (!s) return null;
  if (!isPidAlive(s.pid)) {
    sessions.delete(projectId);
    return null;
  }
  return s.pid;
}

/** Kill a terminal session */
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

/** Kill all terminal sessions */
export function killAllSessions(): void {
  for (const [id, s] of sessions) {
    try { killProcess(s.pid); } catch { /* ok */ }
    sessions.delete(id);
  }
  info('All terminal sessions killed');
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
