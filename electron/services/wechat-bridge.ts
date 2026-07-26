// ═══════════════════════════════════════════════════════════════
// WeChat Bridge Service v0.4
// Integrates claude-to-im skill + our own direct relay service.
// Provides unified API for: QR login, bridge management, status.
// ═══════════════════════════════════════════════════════════════

import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { shell } from 'electron';
import { info, warn, error, debug } from '../utils/logger';
import { isConfigured as directIsConfigured, readAccounts, getActiveAccount, sendMessage } from './wechat-sender';
import { start as startRelay, stop as stopRelay, isRunning as isRelayRunning, getStatus as getRelayStatus } from './relay-service';

const HOME = os.homedir();

// ── Paths ─────────────────────────────────────────────────────────

const SKILL_DIR = path.join(HOME, '.claude', 'skills', 'claude-to-im');
const DATA_DIR = path.join(HOME, '.claude-to-im', 'data');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'weixin-accounts.json');
const CONFIG_FILE = path.join(HOME, '.claude-to-im', 'config.env');
const LOG_DIR = path.join(HOME, '.claude-to-im', 'logs');
const BRIDGE_LOG = path.join(LOG_DIR, 'bridge.log');

// ── Types ─────────────────────────────────────────────────────────

export interface WeChatAccount {
  accountId: string;
  userId: string;
  baseUrl: string;
  token: string;
  name?: string;
  enabled?: boolean;
  lastLoginAt: string | null;
}

export interface BridgeStatus {
  running: boolean;
  pid: number | null;
  polling: boolean;
  channels: string[];
  startedAt: string | null;
  sessions: number;
  messagesToday: number;
  pendingDecisions: number;
}

// ── Public API ────────────────────────────────────────────────────

/** Check if claude-to-im is installed */
export function isInstalled(): boolean {
  return fs.existsSync(SKILL_DIR) && fs.existsSync(path.join(SKILL_DIR, 'package.json'));
}

/** Check if bridge is configured (account exists) */
export function isConfigured(): boolean {
  return directIsConfigured() || fs.existsSync(ACCOUNTS_FILE);
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
  const direct = getActiveAccount();
  if (direct) return direct;

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
 * Launch WeChat QR login via claude-to-im.
 * Non-blocking: spawns the login script and opens the QR HTML in the browser.
 */
export function loginWeChat(): { success: boolean; message: string } {
  if (!isInstalled()) {
    return { success: false, message: 'claude-to-im skill 未安装。请在Claude Code中运行: /claude-to-im setup' };
  }

  try {
    info('Launching WeChat QR login (non-blocking)...');

    // Spawn the login script non-blocking so it doesn't freeze the main process.
    // The script itself polls for scan status; we just kick it off and open the QR.
    const child = spawn('npm', ['run', 'weixin:login'], {
      cwd: SKILL_DIR,
      shell: process.platform === 'win32',
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();

    // Give the script a moment to generate the QR HTML, then open it in the browser.
    const ctiHome = process.env.CTI_HOME || path.join(HOME, '.claude-to-im');
    const qrHtml = path.join(ctiHome, 'runtime', 'weixin-login.html');

    setTimeout(() => {
      try {
        if (fs.existsSync(qrHtml)) {
          shell.openPath(qrHtml);
          info(`Opened QR HTML in browser: ${qrHtml}`);
        } else {
          // Fallback: the script will try to open it itself; also try the URL approach
          shell.openExternal('https://claude-to-im.local/login').catch(() => {});
          warn(`QR HTML not found at ${qrHtml}, letting script open it`);
        }
      } catch (err) {
        error('Failed to open QR HTML', err);
      }
    }, 2500);

    return { success: true, message: '正在生成二维码，请稍候…浏览器会自动打开扫码页面' };
  } catch (err: any) {
    const msg = err.stderr || err.message || String(err);
    error('WeChat login failed', err);
    return { success: false, message: `登录失败: ${msg.slice(0, 200)}` };
  }
}

/** Get bridge status (from relay-service) */
export function getBridgeStatus(): BridgeStatus {
  const relayStatus = getRelayStatus();
  return {
    running: relayStatus.running,
    pid: null, // relay runs in-process
    polling: relayStatus.polling,
    channels: [],
    startedAt: null,
    sessions: 0,
    messagesToday: relayStatus.messagesToday,
    pendingDecisions: relayStatus.pendingDecisions,
  };
}

/** Start the bridge (relay service) */
export function startBridge(): { success: boolean; message: string } {
  if (!isConfigured()) {
    return { success: false, message: '请先绑定微信账户。打开设置 → 扫码绑定微信。' };
  }

  try {
    info('Starting relay service...');

    // Try to start the external daemon too (it provides QR login and additional features)
    if (isInstalled()) {
      try {
        if (process.platform === 'win32') {
          const psScript = path.join(SKILL_DIR, 'scripts', 'supervisor-windows.ps1');
          if (fs.existsSync(psScript)) {
            execSync(`powershell -ExecutionPolicy Bypass -File "${psScript}" start 2>nul`, {
              encoding: 'utf-8', timeout: 15_000, windowsHide: true,
            });
          }
        }
        const daemonPath = path.join(SKILL_DIR, 'dist', 'daemon.mjs');
        if (fs.existsSync(daemonPath)) {
          spawn('node', [daemonPath], {
            cwd: SKILL_DIR, detached: true, stdio: 'ignore', windowsHide: true,
          }).unref();
        }
        info('External daemon started');
      } catch (daemonErr) {
        warn('External daemon start failed (non-critical)', daemonErr);
      }
    }

    // Start internal relay service
    startRelay();

    return { success: true, message: '✅ 桥接服务已启动\n\n轮询中... 在微信发送 /help 查看命令' };
  } catch (err: any) {
    error('Failed to start bridge', err);
    return { success: false, message: `启动失败: ${err.message}` };
  }
}

/** Stop the bridge (relay service) */
export function stopBridge(): { success: boolean; message: string } {
  try {
    info('Stopping bridge...');
    stopRelay();
    return { success: true, message: '桥接服务已停止' };
  } catch (err: any) {
    return { success: false, message: `停止失败: ${err.message}` };
  }
}

/** Get recent bridge logs */
export function getBridgeLogs(lines: number = 50): string {
  try {
    if (!fs.existsSync(BRIDGE_LOG)) return '(暂无日志 — 查看 ~/.claude-in-wechat/logs/ 获取应用日志)';
    const content = fs.readFileSync(BRIDGE_LOG, 'utf-8');
    const allLines = content.split('\n').filter(l => l.trim());
    return allLines.slice(-lines).join('\n');
  } catch {
    return '(无法读取日志)';
  }
}

/** Send a message directly via WeChat (one-way, no daemon needed) */
export async function sendMessageDirect(text: string): Promise<{ success: boolean; message: string }> {
  return sendMessage(text);
}

// ═══════════════════════════════════════════════════════════════
// Live QR Login — fetch QR from iLink API, poll status, save account.
// No external script, no local HTML file.
// ═══════════════════════════════════════════════════════════════

const ILINK_BASE_URL = 'https://ilinkai.weixin.qq.com';
const ILINK_CDN_BASE_URL = 'https://ilink-cdn.weixin.qq.com';

interface QrLoginSession {
  qrcode: string;            // the QR code string to render
  qrcodeImgContent?: string; // optional base64 image
  status: 'waiting' | 'scanned' | 'confirmed' | 'expired';
  startedAt: number;
}

let activeQrSession: QrLoginSession | null = null;
let qrPollTimer: ReturnType<typeof setInterval> | null = null;

const QR_TTL_MS = 5 * 60_000;
const QR_POLL_MS = 3_000;
const QR_MAX_REFRESH = 3;

function normalizeAccountId(ilinkBotId: string): string {
  return ilinkBotId.replace(/[^a-zA-Z0-9_-]/g, '');
}

function saveAccount(account: {
  accountId: string; userId: string; baseUrl: string;
  cdnBaseUrl: string; token: string; name: string; enabled: boolean;
}): void {
  try {
    let accounts: any[] = [];
    if (fs.existsSync(ACCOUNTS_FILE)) {
      accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8'));
      if (!Array.isArray(accounts)) accounts = [];
    }
    const now = new Date().toISOString();
    const existing = accounts.find((a: any) => a.accountId === account.accountId);
    if (existing) {
      Object.assign(existing, {
        userId: account.userId, baseUrl: account.baseUrl,
        cdnBaseUrl: account.cdnBaseUrl, token: account.token,
        name: account.name, enabled: account.enabled,
        lastLoginAt: now, updatedAt: now,
      });
    } else {
      accounts.unshift({
        accountId: account.accountId, userId: account.userId,
        baseUrl: account.baseUrl, cdnBaseUrl: account.cdnBaseUrl,
        token: account.token, name: account.name, enabled: account.enabled,
        lastLoginAt: now, createdAt: now, updatedAt: now,
      });
    }
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), 'utf-8');
    info(`WeChat account saved: ${account.accountId}`);
  } catch (err) {
    error('Failed to save WeChat account', err);
  }
}

/**
 * Start a live QR login session. Fetches a fresh QR code from the iLink API.
 */
export async function startQrLogin(): Promise<{ success: boolean; qrcode?: string; qrcodeImg?: string; message: string }> {
  try {
    // Stop any existing poll
    if (qrPollTimer) { clearInterval(qrPollTimer); qrPollTimer = null; }

    const url = `${ILINK_BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=3`;
    info('Fetching live WeChat QR code...');
    const resp = await fetch(url, { method: 'GET' });
    if (!resp.ok) throw new Error(`QR API returned ${resp.status}`);
    const data = await resp.json();

    if (!data.qrcode) {
      return { success: false, message: data.errmsg || '未能获取二维码' };
    }

    activeQrSession = {
      qrcode: data.qrcode,
      qrcodeImgContent: data.qrcode_img_content,
      status: 'waiting',
      startedAt: Date.now(),
    };
    info('Live QR session started');
    return { success: true, qrcode: data.qrcode, qrcodeImg: data.qrcode_img_content, message: '请用微信扫码' };
  } catch (err: any) {
    error('Failed to start QR login', err);
    return { success: false, message: `获取二维码失败: ${err.message}` };
  }
}

/**
 * Check the status of the active QR login session.
 * Polls the iLink API; on confirm, saves the account.
 */
export async function checkQrLoginStatus(): Promise<{
  status: 'waiting' | 'scanned' | 'confirmed' | 'expired' | 'none';
  message: string;
}> {
  if (!activeQrSession) return { status: 'none', message: '无活跃的登录会话' };

  // Expired by TTL
  if (Date.now() - activeQrSession.startedAt > QR_TTL_MS) {
    activeQrSession.status = 'expired';
    return { status: 'expired', message: '二维码已过期，请重新获取' };
  }

  try {
    const url = `${ILINK_BASE_URL}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(activeQrSession.qrcode)}`;
    const resp = await fetch(url, { method: 'GET' });
    if (!resp.ok) throw new Error(`status API returned ${resp.status}`);
    const data = await resp.json();

    const st = data.status as string | undefined;
    switch (st) {
      case 'wait':
        activeQrSession.status = 'waiting';
        return { status: 'waiting', message: '等待扫码…' };
      case 'scaned':
        activeQrSession.status = 'scanned';
        return { status: 'scanned', message: '已扫码，请在手机确认' };
      case 'confirmed': {
        if (!data.bot_token || !data.ilink_bot_id) {
          return { status: 'expired', message: '登录确认但未返回凭证' };
        }
        const accountId = normalizeAccountId(data.ilink_bot_id);
        saveAccount({
          accountId,
          userId: data.ilink_user_id || '',
          baseUrl: data.baseurl || ILINK_BASE_URL,
          cdnBaseUrl: ILINK_CDN_BASE_URL,
          token: data.bot_token,
          name: accountId,
          enabled: true,
        });
        activeQrSession.status = 'confirmed';
        info(`WeChat login confirmed: ${accountId}`);
        return { status: 'confirmed', message: `登录成功：${accountId}` };
      }
      case 'expired':
        activeQrSession.status = 'expired';
        return { status: 'expired', message: '二维码已过期' };
      default:
        return { status: 'waiting', message: '等待扫码…' };
    }
  } catch (err: any) {
    warn('QR status poll failed', err);
    return { status: 'waiting', message: '等待扫码…' };
  }
}

/** Cancel/forget the active QR session. */
export function cancelQrLogin(): void {
  if (qrPollTimer) { clearInterval(qrPollTimer); qrPollTimer = null; }
  activeQrSession = null;
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