// ═══════════════════════════════════════════════════════════════
// WeChat Sender Service v0.4
// Direct iLink Bot API client — sends messages to WeChat.
// Works independently of the claude-to-im daemon.
// ═══════════════════════════════════════════════════════════════

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { info, warn, error, debug } from '../utils/logger';

const HOME = os.homedir();

// ── Types ─────────────────────────────────────────────────────────

export interface WeChatAccount {
  accountId: string;
  userId: string;
  baseUrl: string;
  cdnBaseUrl: string;
  token: string;
  name: string;
  enabled: boolean;
  lastLoginAt: string | null;
}

export interface WeChatMessage {
  message_id?: string;
  seq?: number;
  from_user_id: string;
  item_list?: Array<{
    type: number;
    text_item?: { text: string };
    image_item?: unknown;
    voice_item?: unknown;
  }>;
  context_token?: string;
  create_time?: number;
}

export interface GetUpdatesResponse {
  msgs: WeChatMessage[];
  get_updates_buf: string;
  errcode?: number;
  errmsg?: string;
}

interface SendResult {
  success: boolean;
  messageId?: string;
  message: string;
}

// ── Paths ─────────────────────────────────────────────────────────

const ACCOUNTS_FILE = path.join(HOME, '.claude-to-im', 'data', 'weixin-accounts.json');
const CONTEXT_TOKENS_FILE = path.join(HOME, '.claude-to-im', 'data', 'weixin-context-tokens.json');
const CURSOR_FILE = path.join(HOME, '.claude-in-wechat', 'runtime', 'relay-cursor.json');

// ── Helpers ───────────────────────────────────────────────────────

function randomHex(length: number): string {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}

function generateClientId(): string {
  return `ciw-${Date.now()}-${randomHex(6)}`;
}

function generateWechatUin(): string {
  return String(Math.floor(10_000_000 + Math.random() * 90_000_000));
}

// ── Account Management ────────────────────────────────────────────

export function readAccounts(): WeChatAccount[] {
  try {
    if (!existsSync(ACCOUNTS_FILE)) return [];
    const raw = readFileSync(ACCOUNTS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((a: WeChatAccount) => a.enabled !== false);
  } catch (err) {
    warn('Failed to read WeChat accounts file', err);
    return [];
  }
}

export function getActiveAccount(): WeChatAccount | null {
  const accounts = readAccounts();
  if (accounts.length === 0) return null;
  // Use the most recently logged-in enabled account
  return accounts.sort((a, b) => {
    const da = a.lastLoginAt ? new Date(a.lastLoginAt).getTime() : 0;
    const db = b.lastLoginAt ? new Date(b.lastLoginAt).getTime() : 0;
    return db - da;
  })[0];
}

export function isConfigured(): boolean {
  const account = getActiveAccount();
  return account !== null && !!account.token && !!account.baseUrl && !!account.userId;
}

// ── Context Token ─────────────────────────────────────────────────

function readContextTokens(): Record<string, string> {
  try {
    if (!existsSync(CONTEXT_TOKENS_FILE)) return {};
    return JSON.parse(readFileSync(CONTEXT_TOKENS_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function getContextToken(accountId: string, userId: string): string | undefined {
  const tokens = readContextTokens();
  const key = `${accountId}::${userId}`;
  return tokens[key];
}

function saveContextToken(accountId: string, userId: string, token: string): void {
  const tokens = readContextTokens();
  const key = `${accountId}::${userId}`;
  tokens[key] = token;
  const dir = path.dirname(CONTEXT_TOKENS_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(CONTEXT_TOKENS_FILE, JSON.stringify(tokens, null, 2), 'utf-8');
}

// ── Cursor Management ─────────────────────────────────────────────

function readCursor(): string {
  try {
    if (!existsSync(CURSOR_FILE)) return '';
    const data = JSON.parse(readFileSync(CURSOR_FILE, 'utf-8'));
    return data.cursor || '';
  } catch {
    return '';
  }
}

function writeCursor(cursor: string): void {
  const dir = path.dirname(CURSOR_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(CURSOR_FILE, JSON.stringify({ cursor, updatedAt: new Date().toISOString() }), 'utf-8');
}

// ── HTTP Helpers ──────────────────────────────────────────────────

async function apiPost(endpoint: string, body: object, account: WeChatAccount): Promise<Response> {
  const url = `${account.baseUrl}/ilink/bot/${endpoint}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'AuthorizationType': 'ilink_bot_token',
    'Authorization': `Bearer ${account.token}`,
    'X-WECHAT-UIN': generateWechatUin(),
  };

  debug(`API POST ${endpoint}`);

  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  return resp;
}

async function apiGet(endpoint: string, account: WeChatAccount): Promise<Response> {
  const url = `${account.baseUrl}/ilink/bot/${endpoint}`;
  const headers: Record<string, string> = {
    'AuthorizationType': 'ilink_bot_token',
    'Authorization': `Bearer ${account.token}`,
    'X-WECHAT-UIN': generateWechatUin(),
  };

  debug(`API GET ${endpoint}`);

  const resp = await fetch(url, { headers });
  return resp;
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === maxRetries - 1) throw err;
      const delay = Math.pow(2, i) * 1000;
      warn(`API call failed, retry ${i + 1}/${maxRetries} in ${delay}ms`, err);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error('Unreachable');
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Send a text message to the linked WeChat account.
 * Uses the iLink Bot API directly — no daemon required.
 */
export async function sendMessage(text: string): Promise<SendResult> {
  const account = getActiveAccount();
  if (!account) {
    return { success: false, message: '未找到已绑定的微信账户。请先扫码绑定。' };
  }

  // Split long messages
  const maxLen = 1500;
  if (text.length > maxLen) {
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
      const end = remaining.length > maxLen ? maxLen : remaining.length;
      chunks.push(remaining.slice(0, end));
      remaining = remaining.slice(end);
    }
    // Add continuation markers
    for (let i = 0; i < chunks.length; i++) {
      const prefix = chunks.length > 1 ? `[${i + 1}/${chunks.length}] ` : '';
      const suffix = i < chunks.length - 1 ? '\n[续]' : '';
      const result = await sendSingleMessage(prefix + chunks[i] + suffix, account);
      if (!result.success) return result;
      // Brief delay between chunks
      if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 500));
    }
    return { success: true, message: 'OK' };
  }

  return sendSingleMessage(text, account);
}

async function sendSingleMessage(text: string, account: WeChatAccount): Promise<SendResult> {
  const contextToken = getContextToken(account.accountId, account.userId);
  const clientId = generateClientId();

  const body = {
    msg: {
      from_user_id: '',
      to_user_id: account.userId,
      client_id: clientId,
      message_type: 2,
      message_state: 2,
      item_list: [
        { type: 1, text_item: { text } },
      ],
      context_token: contextToken || undefined,
    },
    base_info: { channel_version: 'claude-in-wechat/1.0' },
  };

  try {
    const resp = await withRetry(() => apiPost('sendmessage', body, account));
    const data = await resp.json();

    if (resp.ok && (data.errcode === undefined || data.errcode === 0)) {
      debug(`Message sent (clientId: ${clientId})`);
      // Update context token if returned
      if (data.context_token) {
        saveContextToken(account.accountId, account.userId, data.context_token);
      }
      return { success: true, messageId: data.message_id, message: 'OK' };
    }

    if (data.errcode === -14) {
      warn('WeChat session expired — account may need re-login');
      return { success: false, message: '微信会话已过期，请重新扫码绑定' };
    }

    warn(`Send message API error: errcode=${data.errcode} errmsg=${data.errmsg}`);
    return { success: false, message: data.errmsg || `API error: ${data.errcode}` };
  } catch (err: any) {
    error('Failed to send WeChat message', err);
    return { success: false, message: err.message || '发送失败' };
  }
}

/**
 * Send a typing indicator to WeChat.
 */
export async function sendTypingIndicator(): Promise<void> {
  const account = getActiveAccount();
  if (!account) return;

  const body = {
    msg: {
      from_user_id: '',
      to_user_id: account.userId,
      message_type: 0,
      message_state: 1,
      item_list: [],
    },
    base_info: { channel_version: 'claude-in-wechat/1.0' },
  };

  try {
    await apiPost('sendtyping', body, account);
  } catch {
    // Best effort — don't fail over typing indicator
  }
}

/**
 * Poll for new messages from WeChat.
 * Returns parsed messages and the cursor for the next poll.
 */
export async function getUpdates(): Promise<GetUpdatesResponse> {
  const account = getActiveAccount();
  if (!account) {
    return { msgs: [], get_updates_buf: '' };
  }

  const cursor = readCursor();

  const body = {
    get_updates_buf: cursor,
    base_info: { channel_version: 'claude-in-wechat/1.0' },
  };

  try {
    const resp = await apiPost('getupdates', body, account);
    const data = await resp.json();

    if (resp.ok && data.errcode === undefined || data.errcode === 0) {
      if (data.get_updates_buf && data.get_updates_buf !== cursor) {
        writeCursor(data.get_updates_buf);
      }
      const msgs: WeChatMessage[] = data.msgs || [];
      if (msgs.length > 0) {
        debug(`Received ${msgs.length} WeChat message(s)`);
      }
      return { msgs, get_updates_buf: data.get_updates_buf || cursor };
    }

    if (data.errcode === -14) {
      warn('WeChat session expired during poll');
      return { msgs: [], get_updates_buf: cursor };
    }

    // Long-poll timeout is not a real error
    if (resp.status === 408 || (data.errcode && data.errcode !== 0 && data.errcode !== -14)) {
      debug(`Poll returned: errcode=${data.errcode}`);
    }

    return { msgs: [], get_updates_buf: cursor };
  } catch (err: any) {
    if (err.name === 'TimeoutError' || err.message?.includes('timeout')) {
      return { msgs: [], get_updates_buf: cursor };
    }
    warn('Failed to poll WeChat messages', err);
    return { msgs: [], get_updates_buf: cursor };
  }
}

/**
 * Extract plain text from a WeChat message's item_list.
 */
export function extractText(msg: WeChatMessage): string {
  if (!msg.item_list) return '';
  const texts: string[] = [];
  for (const item of msg.item_list) {
    if (item.type === 1 && item.text_item?.text) {
      texts.push(item.text_item.text.trim());
    }
  }
  return texts.join('').trim();
}

/**
 * Get link to QR code for WeChat login.
 */
export async function getQRCode(): Promise<{ success: boolean; qrcode?: string; message: string }> {
  const account = getActiveAccount();
  if (!account) {
    return { success: false, message: 'No account configured' };
  }

  try {
    const resp = await apiGet('get_bot_qrcode?bot_type=3', account);
    const data = await resp.json();
    if (data.qrcode) {
      return { success: true, qrcode: data.qrcode, message: 'OK' };
    }
    return { success: false, message: data.errmsg || 'Failed to get QR code' };
  } catch (err: any) {
    return { success: false, message: err.message };
  }
}

/**
 * Check QR code scan status.
 */
export async function checkQRStatus(qrcode: string): Promise<{ status: string }> {
  const account = getActiveAccount();
  if (!account) return { status: 'expired' };

  try {
    const resp = await apiGet(`get_qrcode_status?qrcode=${qrcode}`, account);
    const data = await resp.json();
    return { status: data.status || 'expired' };
  } catch {
    return { status: 'expired' };
  }
}