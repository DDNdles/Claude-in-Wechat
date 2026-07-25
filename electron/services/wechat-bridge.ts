// ═══════════════════════════════════════════════════════════════
// WeChat Bridge Service v0.3
// Wraps claude-to-im daemon and weixin-global-integration hooks
// ═══════════════════════════════════════════════════════════════

import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { info, warn, error, debug } from '../utils/logger';

const HOME = os.homedir();

// ── Paths ─────────────────────────────────────────────────────────

const SKILL_DIR = path.join(HOME, '.claude', 'skills', 'claude-to-im');
const WEIXIN_GLOBAL_DIR = path.join(HOME, '.claude', 'skills', 'weixin-global-integration');
const DATA_DIR = path.join(HOME, '.claude-to-im', 'data');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'weixin-accounts.json');
const CONFIG_FILE = path.join(HOME, '.claude-to-im', 'config.env');
const RUNTIME_DIR = path.join(HOME, '.claude-to-im', 'runtime');
const LOG_DIR = path.join(HOME, '.claude-to-im', 'logs');
const BRIDGE_LOG = path.join(LOG_DIR, 'bridge.log');
const STATUS_FILE = path.join(RUNTIME_DIR, 'status.json');

// ── Types ─────────────────────────────────────────────────────────

export interface WeChatAccount {
  accountId: string;
  userId: string;
  baseUrl: string;
  token: string;
  name?: string;
  enabled?: boolean;
  lastLoginAt?: string;
}

export interface BridgeStatus {
  running: boolean;
  pid: number | null;
  channels: string[];
  startedAt: string | null;
  sessions: number;
  messagesToday: number;
}

// ── Public API ────────────────────────────────────────────────────

/** Check if claude-to-im is installed and configured */
export function isInstalled(): boolean {
  return fs.existsSync(SKILL_DIR) && fs.existsSync(path.join(SKILL_DIR, 'package.json'));
}

/** Check if bridge is configured (config.env exists) */
export function isConfigured(): boolean {
  return fs.existsSync(CONFIG_FILE);
}

/** Check if a WeChat account is linked */
export function hasWeChatAccount(): boolean {
  try {
    if (!fs.existsSync(ACCOUNTS_FILE)) return false;
    const accounts: WeChatAccount[] = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8'));
    return Array.isArray(accounts) && accounts.length > 0;
  } catch { return false; }
}

/** Get the linked WeChat account */
export function getWeChatAccount(): WeChatAccount | null {
  try {
    if (!fs.existsSync(ACCOUNTS_FILE)) return null;
    const accounts: WeChatAccount[] = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8'));
    if (!Array.isArray(accounts) || accounts.length === 0) return null;
    const enabled = accounts.filter(a => a.enabled !== false);
    return enabled.length > 0 ? enabled[0] : accounts[0];
  } catch (err) {
    error('Failed to read WeChat account', err);
    return null;
  }
}

/**
 * Launch WeChat QR login.
 * Runs `npm run weixin:login` in the claude-to-im skill directory.
 * Opens a browser window with QR code.
 * Returns true if login was initiated.
 */
export function loginWeChat(): { success: boolean; message: string } {
  if (!isInstalled()) {
    return { success: false, message: 'claude-to-im skill 未安装。请先安装: npx skills add op7418/Claude-to-IM-skill' };
  }

  try {
    info('Launching WeChat QR login...');
    // Run the weixin:login script — it generates QR HTML and opens browser
    const result = execSync('npm run weixin:login', {
      cwd: SKILL_DIR,
      encoding: 'utf-8',
      timeout: 120_000,
      windowsHide: false,
      stdio: 'pipe',
    });
    info(`WeChat login output: ${result.slice(0, 200)}`);
    return { success: true, message: '二维码已在浏览器中打开，请用微信扫码' };
  } catch (err: any) {
    const msg = err.stderr || err.message || String(err);
    error('WeChat login failed', err);
    return { success: false, message: `登录失败: ${msg.slice(0, 200)}` };
  }
}

/** Get bridge daemon status */
export function getBridgeStatus(): BridgeStatus {
  try {
    if (!fs.existsSync(STATUS_FILE)) {
      return { running: false, pid: null, channels: [], startedAt: null, sessions: 0, messagesToday: 0 };
    }
    const raw = fs.readFileSync(STATUS_FILE, 'utf-8');
    const status = JSON.parse(raw);
    return {
      running: status.running ?? (status.pid ? isPidAlive(status.pid) : false),
      pid: status.pid ?? null,
      channels: status.channels ?? [],
      startedAt: status.startedAt ?? null,
      sessions: status.sessions ?? 0,
      messagesToday: status.messagesToday ?? 0,
    };
  } catch {
    return { running: false, pid: null, channels: [], startedAt: null, sessions: 0, messagesToday: 0 };
  }
}

/** Start the bridge daemon */
export function startBridge(): { success: boolean; message: string } {
  if (!isConfigured()) {
    return { success: false, message: '请先配置 claude-to-im。运行: /claude-to-im setup' };
  }

  try {
    info('Starting claude-to-im bridge...');
    // Try PowerShell supervisor on Windows, bash daemon.sh on Unix
    if (process.platform === 'win32') {
      const psScript = path.join(SKILL_DIR, 'scripts', 'supervisor-windows.ps1');
      if (fs.existsSync(psScript)) {
        execSync(`powershell -ExecutionPolicy Bypass -File "${psScript}" start`, {
          encoding: 'utf-8', timeout: 30_000, windowsHide: true,
        });
      }
    }
    // Fallback: use node directly (daemon starts in background)
    const daemonPath = path.join(SKILL_DIR, 'dist', 'daemon.mjs');
    if (fs.existsSync(daemonPath)) {
      spawn('node', [daemonPath], {
        cwd: SKILL_DIR,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      }).unref();
    }
    return { success: true, message: '桥接服务已启动' };
  } catch (err: any) {
    error('Failed to start bridge', err);
    return { success: false, message: `启动失败: ${err.message}` };
  }
}

/** Stop the bridge daemon */
export function stopBridge(): { success: boolean; message: string } {
  try {
    info('Stopping claude-to-im bridge...');
    const status = getBridgeStatus();
    if (status.pid) {
      if (process.platform === 'win32') {
        execSync(`taskkill /PID ${status.pid} /F 2>nul`, { stdio: 'ignore' });
      } else {
        process.kill(status.pid, 'SIGTERM');
      }
    }
    return { success: true, message: '桥接服务已停止' };
  } catch (err: any) {
    return { success: false, message: `停止失败: ${err.message}` };
  }
}

/** Get recent bridge logs */
export function getBridgeLogs(lines: number = 50): string {
  try {
    if (!fs.existsSync(BRIDGE_LOG)) return '(暂无日志)';
    const content = fs.readFileSync(BRIDGE_LOG, 'utf-8');
    const allLines = content.split('\n').filter(l => l.trim());
    return allLines.slice(-lines).join('\n');
  } catch {
    return '(无法读取日志)';
  }
}

// ── Internal ───────────────────────────────────────────────────────

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
