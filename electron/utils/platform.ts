/**
 * Windows-specific platform utilities.
 */

import { execSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

/** Check if running on Windows */
export const isWindows = os.platform() === 'win32';

/** Get the user's home directory */
export function getUserHome(): string {
  return os.homedir();
}

/**
 * Add app to Windows startup registry.
 * Uses HKCU\Software\Microsoft\Windows\CurrentVersion\Run
 */
export function enableAutoStart(appName: string, appPath: string): boolean {
  if (!isWindows) return false;
  try {
    const regCmd = `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "${appName}" /t REG_SZ /d "${appPath}" /f`;
    execSync(regCmd, { encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

/** Remove app from Windows startup registry */
export function disableAutoStart(appName: string): boolean {
  if (!isWindows) return false;
  try {
    const regCmd = `reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "${appName}" /f`;
    execSync(regCmd, { encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

/** Check if auto-start is enabled */
export function isAutoStartEnabled(appName: string): boolean {
  if (!isWindows) return false;
  try {
    const regCmd = `reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "${appName}"`;
    execSync(regCmd, { encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Open a PowerShell/CMD window for a project.
 * On Windows: start a new cmd window running `claude` in the project dir.
 */
export function openTerminal(cwd: string, projectName: string): void {
  if (!isWindows) return;
  try {
    const psScript = `Start-Process cmd -ArgumentList "/k title Claude - ${projectName} && cd /d ${cwd} && claude"`;
    execSync(`powershell -Command "${psScript}"`, { encoding: 'utf-8' });
  } catch (err) {
    // Fallback: use start directly
    try {
      execSync(`start "Claude - ${projectName}" cmd /k "cd /d ${cwd} && claude"`, { encoding: 'utf-8' });
    } catch {
      // Silent fail
    }
  }
}

/** Normalize a path for consistent comparison across platforms */
export function normalizePath(p: string): string {
  return path.normalize(p).replace(/\\/g, '/').toLowerCase();
}

/** Get the app data directory for Windows (%APPDATA% or ~/.config equivalent) */
export function getAppDataDir(): string {
  if (isWindows) {
    return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  }
  return path.join(os.homedir(), '.config');
}
