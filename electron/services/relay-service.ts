// ═══════════════════════════════════════════════════════════════
// WeChat Relay Service — polls WeChat API, parses commands, routes to handlers
// ═══════════════════════════════════════════════════════════════

import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { info, warn, error, debug } from '../utils/logger';
import {
  WEIXIN_ACCOUNTS_FILE,
  RELAY_CURSOR_FILE,
  RUNTIME_DIR,
} from '../utils/paths';
import type {
  RelayStatus,
  WeChatAccount,
  WeChatMessage,
  Project,
  ProjectStatus,
  TaskItem,
  AppSettings,
} from '../../shared/types';

// ── Types ──────────────────────────────────────────────────────────────

export interface ParsedCommand {
  cmd: 'open' | 'new' | 'delete' | 'rename' | 'list' | 'check' | 'token' | 'decision' | 'chat' | 'unknown';
  projectName?: string;
  oldName?: string;
  newName?: string;
  value?: number;
  text?: string;
}

interface WeChatApiMessage {
  msgId: string;
  text: string;
  fromUserId: string;
  timestamp: number;
}

interface WeChatApiResponse {
  msgs?: WeChatApiMessage[];
  get_updates_buf?: string;
  error?: string;
}

interface ProjectManagerLike {
  openProject(name: string): Promise<Project>;
  createProject(name: string, initialPrompt?: string): Promise<Project>;
  deleteProject(name: string): Promise<void>;
  renameProject(oldName: string, newName: string): Promise<Project>;
  listProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project | undefined>;
  getActiveProject(): Promise<Project | undefined>;
  setActiveProject(id: string): Promise<void>;
  updateProjectProgress(id: string, progress: number, tasks: TaskItem[]): Promise<void>;
  readProgress(projectId: string): Promise<{ progress: number; currentStep?: number; totalSteps?: number }>;
  getTokenUsage(projectId: string): Promise<{ sessionTokens: number; dailyTokens: number }>;
}

// ── Constants ──────────────────────────────────────────────────────────

const DEFAULT_POLL_INTERVAL = 5000; // ms
const DEFAULT_MAX_OUTPUT_LENGTH = 500;

// ── Command Regex Patterns ─────────────────────────────────────────────

// English command patterns
const CMD_OPEN = /^\/open\s+(.+)/i;
const CMD_NEW = /^\/new\s+(.+)/i;
const CMD_DELETE = /^\/delete\s+(.+)/i;
const CMD_RENAME = /^\/rename\s+(.+?)\s+(.+)/i;
const CMD_LIST = /^\/list\s*$/i;
const CMD_CHECK = /^\/check\s+(.+)/i;
const CMD_TOKEN = /^\/token\s+(.+)/i;

// Chinese command patterns
const CMD_OPEN_CN = /^(?:打开项目|打开)\s+(.+)/;
const CMD_NEW_CN = /^(?:新建项目|创建项目|新建)\s+(.+)/;
const CMD_DELETE_CN = /^(?:删除项目|删除)\s+(.+)/;
const CMD_LIST_CN = /^(?:列表|查看列表|项目列表|所有项目)\s*$/;
const CMD_CHECK_CN = /^(?:查询进度|进度|查看进度)\s+(.+)/;
const CMD_TOKEN_CN = /^(?:令牌|查看令牌|token)\s+(.+)/i;

// Numeric decision reply
const CMD_DECISION = /^([1-9])\s*$/;

// Acknowledgment patterns — don't forward these
const ACK_PATTERNS = /^(?:收到|ok|好的|明白|知道了|1|确认|确认删除)\s*$/i;

// ── WeChat API Client ──────────────────────────────────────────────────

/** Load WeChat account from shared accounts file */
function loadAccount(): WeChatAccount | null {
  try {
    if (!fs.existsSync(WEIXIN_ACCOUNTS_FILE)) {
      warn(`WeChat accounts file not found: ${WEIXIN_ACCOUNTS_FILE}`);
      return null;
    }
    const raw = fs.readFileSync(WEIXIN_ACCOUNTS_FILE, 'utf-8');
    const accounts: WeChatAccount[] = JSON.parse(raw);
    if (!accounts || accounts.length === 0) {
      warn('No WeChat accounts configured');
      return null;
    }
    // Use the first enabled account, or first account
    const enabled = accounts.filter(a => (a as any).enabled !== false);
    const account = enabled.length > 0 ? enabled[0] : accounts[0];
    return account;
  } catch (err) {
    error('Failed to load WeChat account', err);
    return null;
  }
}

/** Make an HTTP request to the WeChat iLink Bot API */
function wechatRequest(
  endpoint: string,
  body: Record<string, unknown>
): Promise<WeChatApiResponse> {
  return new Promise((resolve, reject) => {
    const account = loadAccount();
    if (!account) {
      return reject(new Error('No WeChat account configured'));
    }

    const url = new URL(`/ilink/bot/${endpoint}`, account.baseUrl);
    const bodyStr = JSON.stringify(body);

    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        'Authorization': `Bearer ${account.token}`,
        'X-WECHAT-UIN': account.userId,
        'Accept': 'application/json',
      },
      timeout: 15000,
    };

    const transport = url.protocol === 'https:' ? https : http;

    const req = transport.request(options, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => {
        data += chunk.toString('utf-8');
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data) as WeChatApiResponse;
          if (res.statusCode && res.statusCode >= 400) {
            debug(`WeChat API ${endpoint} returned ${res.statusCode}: ${data.slice(0, 200)}`);
          }
          resolve(parsed);
        } catch (parseErr) {
          error(`Failed to parse WeChat API response from ${endpoint}: ${data.slice(0, 300)}`, parseErr);
          reject(new Error(`Invalid JSON response from WeChat API: ${data.slice(0, 100)}`));
        }
      });
    });

    req.on('error', (err) => {
      error(`WeChat API request to ${endpoint} failed`, err);
      reject(err);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`WeChat API request to ${endpoint} timed out`));
    });

    req.write(bodyStr);
    req.end();
  });
}

/** Poll WeChat for new messages */
async function wechatPollMessages(cursor: string): Promise<{
  msgs: WeChatApiMessage[];
  cursor: string;
}> {
  const response = await wechatRequest('getupdates', {
    get_updates_buf: cursor || '',
  });

  return {
    msgs: response.msgs || [],
    cursor: response.get_updates_buf || cursor,
  };
}

/** Send a text message via WeChat */
async function wechatSendMessage(text: string): Promise<void> {
  await wechatRequest('sendmessage', {
    text_item: {
      text,
    },
  });
}

// ── Cursor persistence ─────────────────────────────────────────────────

function loadCursor(accountId: string): string {
  try {
    if (!fs.existsSync(RELAY_CURSOR_FILE)) return '';
    const raw = fs.readFileSync(RELAY_CURSOR_FILE, 'utf-8');
    const cursors = JSON.parse(raw) as Record<string, string>;
    return cursors[accountId] || '';
  } catch {
    return '';
  }
}

function saveCursor(accountId: string, cursor: string): void {
  try {
    if (!fs.existsSync(RUNTIME_DIR)) {
      fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    }
    const cursors: Record<string, string> = {};
    if (fs.existsSync(RELAY_CURSOR_FILE)) {
      try {
        const raw = fs.readFileSync(RELAY_CURSOR_FILE, 'utf-8');
        Object.assign(cursors, JSON.parse(raw));
      } catch { /* ignore */ }
    }
    cursors[accountId] = cursor;
    fs.writeFileSync(RELAY_CURSOR_FILE, JSON.stringify(cursors, null, 2), 'utf-8');
  } catch (err) {
    warn('Failed to save relay cursor', err);
  }
}

// ── Command Parser ─────────────────────────────────────────────────────

/** Parse text input into a structured command */
export function parseCommand(text: string): ParsedCommand {
  const trimmed = text.trim();
  if (!trimmed) {
    return { cmd: 'unknown', text };
  }

  // Check numeric decision first (single digit 1-9)
  const decisionMatch = trimmed.match(CMD_DECISION);
  if (decisionMatch && !trimmed.includes(' ')) {
    return { cmd: 'decision', value: parseInt(decisionMatch[1], 10) };
  }

  // English commands
  let match: RegExpMatchArray | null;

  match = trimmed.match(CMD_OPEN);
  if (match) return { cmd: 'open', projectName: match[1].trim() };

  match = trimmed.match(CMD_NEW);
  if (match) return { cmd: 'new', projectName: match[1].trim() };

  match = trimmed.match(CMD_RENAME);
  if (match) return { cmd: 'rename', oldName: match[1].trim(), newName: match[2].trim() };

  match = trimmed.match(CMD_DELETE);
  if (match) return { cmd: 'delete', projectName: match[1].trim() };

  match = trimmed.match(CMD_LIST);
  if (match) return { cmd: 'list' };

  match = trimmed.match(CMD_CHECK);
  if (match) return { cmd: 'check', projectName: match[1].trim() };

  match = trimmed.match(CMD_TOKEN);
  if (match) return { cmd: 'token', projectName: match[1].trim() };

  // Chinese commands
  match = trimmed.match(CMD_OPEN_CN);
  if (match) return { cmd: 'open', projectName: match[1].trim() };

  match = trimmed.match(CMD_NEW_CN);
  if (match) return { cmd: 'new', projectName: match[1].trim() };

  match = trimmed.match(CMD_DELETE_CN);
  if (match) return { cmd: 'delete', projectName: match[1].trim() };

  match = trimmed.match(CMD_LIST_CN);
  if (match) return { cmd: 'list' };

  match = trimmed.match(CMD_CHECK_CN);
  if (match) return { cmd: 'check', projectName: match[1].trim() };

  match = trimmed.match(CMD_TOKEN_CN);
  if (match) return { cmd: 'token', projectName: match[1].trim() };

  // Ack patterns — treat as chat that might be an ack
  if (ACK_PATTERNS.test(trimmed)) {
    return { cmd: 'chat', text: trimmed };
  }

  // Default: treat as chat message
  return { cmd: 'chat', text: trimmed };
}

// ── Progress Bar ───────────────────────────────────────────────────────

/** Build ASCII progress bar string */
export function buildProgressBar(progress: number, currentStep?: number, totalSteps?: number): string {
  const clamped = Math.max(0, Math.min(100, Math.round(progress)));
  const barLen = 10;
  const filled = Math.round((clamped / 100) * barLen);
  const empty = barLen - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);

  let line = `进度: ${bar} ${clamped}%`; // "进度: ██░░ 50%"
  if (currentStep !== undefined && totalSteps !== undefined && totalSteps > 0) {
    line += ` (${currentStep}/${totalSteps})`;
  }
  return line;
}

// ── Output Truncation ──────────────────────────────────────────────────

/** Truncate large Claude output for WeChat message */
export function truncateOutput(output: string, maxLen: number = DEFAULT_MAX_OUTPUT_LENGTH): string {
  if (output.length <= maxLen) return output;

  if (output.length > 2000) {
    // Very large: just give a summary
    const lines = output.split('\n').filter(l => l.trim());
    return `[Claude 输出过长，已截断] 共 ${lines.length} 行输出\n` +
      `开头: ${lines[0]?.slice(0, 80) || ''}\n` +
      `结尾: ${lines[lines.length - 1]?.slice(-80) || ''}`;
    // "[Claude 输出过长，已截断] 共 N 行输出\n开头: ...\n结尾: ..."
  }

  const head = output.slice(0, 200);
  const tail = output.slice(-100);
  return `${head}\n...(省略中间内容)...\n${tail}`;
  // "...(省略中间内容)..."
}

// ── RelayService Class ─────────────────────────────────────────────────

export class RelayService {
  private pollingTimer: ReturnType<typeof setTimeout> | null = null;
  private polling = false;
  private connected = false;
  private lastPollAt: string | null = null;
  private messagesToday = 0;
  private errors = 0;
  private accountId: string | null = null;
  private pollInterval: number = DEFAULT_POLL_INTERVAL;
  private maxOutputLength: number = DEFAULT_MAX_OUTPUT_LENGTH;
  private projectManager: ProjectManagerLike | null = null;
  private onEvent: ((event: any) => void) | null = null;
  private pendingDeletions: Map<string, string> = new Map(); // projectName → userId
  private dayMarker: string = new Date().toISOString().slice(0, 10);

  /** Set the project manager reference (called after initialization) */
  setProjectManager(pm: ProjectManagerLike): void {
    this.projectManager = pm;
  }

  /** Set event callback for pushing to renderer */
  setEventCallback(cb: (event: any) => void): void {
    this.onEvent = cb;
  }

  /** Update settings at runtime */
  updateSettings(settings: Partial<AppSettings>): void {
    if (settings.pollInterval !== undefined) {
      this.pollInterval = settings.pollInterval * 1000;
      // Restart polling if currently active with new interval
      if (this.polling) {
        this.stop();
        this.start();
      }
    }
    if (settings.maxOutputLength !== undefined) {
      this.maxOutputLength = settings.maxOutputLength;
    }
  }

  /** Begin polling the WeChat API */
  start(): void {
    if (this.polling) {
      debug('Relay: already polling, ignoring start()');
      return;
    }

    const account = loadAccount();
    if (!account) {
      warn('Relay: cannot start — no WeChat account configured');
      this.connected = false;
      return;
    }

    this.accountId = account.accountId;
    this.polling = true;
    this.connected = true;
    this.dayMarker = new Date().toISOString().slice(0, 10);

    info(`Relay: starting poll loop (interval=${this.pollInterval}ms, account=${this.accountId})`);
    this.emitEvent('status_change', { polling: true, connected: true });

    this.poll();
  }

  /** Stop the polling loop */
  stop(): void {
    this.polling = false;
    if (this.pollingTimer) {
      clearTimeout(this.pollingTimer);
      this.pollingTimer = null;
    }
    this.connected = false;
    info('Relay: polling stopped');
    this.emitEvent('status_change', { polling: false, connected: false });
  }

  /** Get current relay status */
  getStatus(): RelayStatus {
    return {
      connected: this.connected,
      accountId: this.accountId || undefined,
      polling: this.polling,
      lastPollAt: this.lastPollAt || undefined,
      messagesToday: this.messagesToday,
      errors: this.errors,
    };
  }

  /** Send a text message to the WeChat user */
  async sendMessage(text: string): Promise<void> {
    try {
      await wechatSendMessage(text);
      this.emitEvent('message_sent', { text: text.slice(0, 100) });
      debug(`Relay: sent message (${text.length} chars)`);
    } catch (err) {
      error('Relay: failed to send message', err);
      this.errors++;
      throw err;
    }
  }

  /** Send an acknowledgment message */
  async sendAck(): Promise<void> {
    try {
      await this.sendMessage('收到'); // "收到"
    } catch {
      // Best effort
    }
  }

  // ── Internal: Poll Loop ──────────────────────────────────────────

  private async poll(): Promise<void> {
    if (!this.polling) return;

    try {
      // Reset daily counter if day changed
      const today = new Date().toISOString().slice(0, 10);
      if (today !== this.dayMarker) {
        this.dayMarker = today;
        this.messagesToday = 0;
      }

      const cursor = this.accountId ? loadCursor(this.accountId) : '';
      const result = await wechatPollMessages(cursor);

      this.lastPollAt = new Date().toISOString();

      if (result.cursor && result.cursor !== cursor && this.accountId) {
        saveCursor(this.accountId, result.cursor);
      }

      if (result.msgs && result.msgs.length > 0) {
        this.messagesToday += result.msgs.length;
        debug(`Relay: received ${result.msgs.length} message(s)`);

        for (const msg of result.msgs) {
          await this.processIncoming(msg.text, msg.fromUserId, msg.msgId);
        }
      }
    } catch (err) {
      this.errors++;
      error('Relay: poll error', err);
      this.emitEvent('error', { message: (err as Error).message });
    } finally {
      if (this.polling) {
        this.pollingTimer = setTimeout(() => this.poll(), this.pollInterval);
      }
    }
  }

  // ── Internal: Process Incoming Message ───────────────────────────

  private async processIncoming(text: string, fromUserId: string, msgId?: string): Promise<void> {
    const msg: WeChatMessage = {
      text,
      fromUserId,
      timestamp: Date.now(),
      msgId,
    };
    this.emitEvent('message_received', msg);

    const cmd = parseCommand(text);

    // Check if this is a decision for a pending deletion
    if (cmd.cmd === 'decision' && this.pendingDeletions.size > 0) {
      const pendingEntries = Array.from(this.pendingDeletions.entries());
      // Use the oldest pending deletion
      const [projectName, userId] = pendingEntries[0];

      if (cmd.value === 1) {
        // User confirmed deletion
        this.pendingDeletions.delete(projectName);
        if (this.projectManager) {
          try {
            await this.projectManager.deleteProject(projectName);
            await this.sendMessage(`✅ 项目「${projectName}」已删除`);
            // ✅ 项目「{name}」已删除
          } catch (err) {
            await this.sendMessage(`❌ 删除失败: ${(err as Error).message}`);
            // ❌ 删除失败: ...
          }
        }
      } else {
        this.pendingDeletions.delete(projectName);
        await this.sendMessage(`❌ 已取消删除项目「${projectName}」`);
        // ❌ 已取消删除项目「{name}」
      }
      this.emitEvent('command_handled', { command: 'delete', projectName, confirmed: cmd.value === 1 });
      return;
    }

    await this.handleCommand(cmd);
  }

  // ── Internal: Route Command to Handler ───────────────────────────

  private async handleCommand(cmd: ParsedCommand): Promise<void> {
    info(`Relay: handling command ${cmd.cmd}`, cmd);

    switch (cmd.cmd) {
      case 'open':
        await this.handleOpen(cmd.projectName!);
        break;
      case 'new':
        await this.handleNew(cmd.projectName!);
        break;
      case 'delete':
        await this.handleDelete(cmd.projectName!);
        break;
      case 'rename':
        await this.handleRename(cmd.oldName!, cmd.newName!);
        break;
      case 'list':
        await this.handleList();
        break;
      case 'check':
        await this.handleCheck(cmd.projectName!);
        break;
      case 'token':
        await this.handleToken(cmd.projectName!);
        break;
      case 'decision':
        await this.handleDecision(cmd.value!);
        break;
      case 'chat':
        await this.handleChat(cmd.text || '');
        break;
      default:
        await this.sendMessage('未知命令。可用命令: /open, /new, /delete, /rename, /list, /check, /token');
        // "未知命令。可用命令: /open, /new, /delete, /rename, /list, /check, /token"
    }
  }

  // ── Command Handlers ─────────────────────────────────────────────

  private async handleOpen(projectName: string): Promise<void> {
    if (!this.projectManager) {
      await this.sendMessage('❌ 系统未完全初始化'); // ❌ 系统未完全初始化
      return;
    }
    await this.sendAck();
    try {
      const project = await this.projectManager.openProject(projectName);
      await this.projectManager.setActiveProject(project.id);
      await this.sendMessage(`✅ 已打开项目「${project.name}」`);
      // ✅ 已打开项目「{name}」
      this.emitEvent('command_handled', { command: 'open', projectName: project.name });
    } catch (err) {
      await this.sendMessage(`❌ 打开失败: ${(err as Error).message}`);
      // ❌ 打开失败: ...
    }
  }

  private async handleNew(projectName: string): Promise<void> {
    if (!this.projectManager) {
      await this.sendMessage('❌ 系统未完全初始化');
      return;
    }
    await this.sendAck();
    try {
      const project = await this.projectManager.createProject(projectName);
      await this.projectManager.setActiveProject(project.id);
      await this.sendMessage(
        `✅ 项目「${project.name}」已创建\n请回复你想让我做什么`
      );
      // ✅ 项目「{name}」已创建\n请回复你想让我做什么
      this.emitEvent('command_handled', { command: 'new', projectName: project.name });
    } catch (err) {
      await this.sendMessage(`❌ 创建失败: ${(err as Error).message}`);
    }
  }

  private async handleDelete(projectName: string): Promise<void> {
    if (!this.projectManager) {
      await this.sendMessage('❌ 系统未完全初始化');
      return;
    }

    // Check if project exists
    const projects = await this.projectManager.listProjects();
    const found = projects.find(
      p => p.name.toLowerCase() === projectName.toLowerCase()
    );

    if (!found) {
      await this.sendMessage(`❌ 项目「${projectName}」不存在`);
      // ❌ 项目「{name}」不存在
      return;
    }

    // Require confirmation
    this.pendingDeletions.set(projectName, 'user'); // track pending
    await this.sendMessage(
      `⚠️ 确认删除项目「${projectName}」？\n回复 1 确认删除，回复其他内容取消`
    );
    // ⚠️ 确认删除项目「{name}」？\n回复 1 确认删除，回复其他内容取消
  }

  private async handleRename(oldName: string, newName: string): Promise<void> {
    if (!this.projectManager) {
      await this.sendMessage('❌ 系统未完全初始化');
      return;
    }
    await this.sendAck();
    try {
      const project = await this.projectManager.renameProject(oldName, newName);
      await this.sendMessage(`✅ 已重命名为「${project.name}」`);
      // ✅ 已重命名为「{name}」
      this.emitEvent('command_handled', { command: 'rename', oldName, newName: project.name });
    } catch (err) {
      await this.sendMessage(`❌ 重命名失败: ${(err as Error).message}`);
    }
  }

  private async handleList(): Promise<void> {
    if (!this.projectManager) {
      await this.sendMessage('❌ 系统未完全初始化');
      return;
    }
    await this.sendAck();
    try {
      const projects = await this.projectManager.listProjects();

      if (projects.length === 0) {
        await this.sendMessage('没有项目。使用 /new 来创建一个吧！');
        // "没有项目。使用 /new 来创建一个吧！"
        return;
      }

      const statusEmoji: Record<string, string> = {
        idle: '🔴',      // 🔴
        running: '🟢',   // 🟢
        completed: '✅',       // ✅
        error: '❌',           // ❌
        waiting: '⏳',         // ⏳
      };

      const lines = projects.map((p, i) => {
        const emoji = statusEmoji[p.status] || '⚪'; // ⚪ default
        const progress = p.progress > 0 ? ` [${p.progress}%]` : '';
        return `${i + 1}. ${emoji} ${p.name}${progress}`;
      });

      await this.sendMessage(`项目列表:\n${lines.join('\n')}`);
      // "项目列表:"
      this.emitEvent('command_handled', { command: 'list', count: projects.length });
    } catch (err) {
      await this.sendMessage(`❌ 获取列表失败: ${(err as Error).message}`);
    }
  }

  private async handleCheck(projectName: string): Promise<void> {
    if (!this.projectManager) {
      await this.sendMessage('❌ 系统未完全初始化');
      return;
    }
    await this.sendAck();
    try {
      const projects = await this.projectManager.listProjects();
      const project = projects.find(
        p => p.name.toLowerCase() === projectName.toLowerCase()
      );

      if (!project) {
        await this.sendMessage(`❌ 项目「${projectName}」不存在`);
        return;
      }

      const progress = await this.projectManager.readProgress(project.id);
      const bar = buildProgressBar(progress.progress, progress.currentStep, progress.totalSteps);

      let message = `项目: ${project.name}\n`;
      message += `状态: ${getStatusText(project.status)}\n`;
      message += `${bar}\n`;

      // Add task list if available
      if (project.tasks && project.tasks.length > 0) {
        message += `\n任务列表:\n`; // 任务列表:
        for (const task of project.tasks.slice(0, 10)) {
          const taskEmoji = task.status === 'completed' ? '✅' :
                           task.status === 'in_progress' ? '🔵' : '⚪';
          message += `${taskEmoji} ${task.subject}\n`;
        }
        if (project.tasks.length > 10) {
          message += `... 还有 ${project.tasks.length - 10} 个任务\n`;
          // ... 还有 N 个任务
        }
      } else {
        message += `暂无任务信息`; // "暂无任务信息"
      }

      await this.sendMessage(message);
      this.emitEvent('command_handled', { command: 'check', projectName: project.name });
    } catch (err) {
      await this.sendMessage(`❌ 查询失败: ${(err as Error).message}`);
    }
  }

  private async handleToken(projectName: string): Promise<void> {
    if (!this.projectManager) {
      await this.sendMessage('❌ 系统未完全初始化');
      return;
    }
    await this.sendAck();
    try {
      const projects = await this.projectManager.listProjects();
      const project = projects.find(
        p => p.name.toLowerCase() === projectName.toLowerCase()
      );

      if (!project) {
        await this.sendMessage(`❌ 项目「${projectName}」不存在`);
        return;
      }

      const tokens = await this.projectManager.getTokenUsage(project.id);

      let message = `令牌使用报告 — ${project.name}\n\n`; // 令牌使用报告
      message += `🔸 本次会话: ${tokens.sessionTokens.toLocaleString()} tokens\n`; // 本次会话
      message += `🔸 今日累计: ${tokens.dailyTokens.toLocaleString()} tokens\n`; // 今日累计

      // Context window estimate
      if (tokens.sessionTokens > 150000) {
        message += `\n⚠️ 上下文已接近限制，建议使用 /new 开启新项目`;
        // ⚠️ 上下文已接近限制，建议使用 /new 开启新项目
      }

      await this.sendMessage(message);
      this.emitEvent('command_handled', { command: 'token', projectName: project.name });
    } catch (err) {
      await this.sendMessage(`❌ 查询失败: ${(err as Error).message}`);
    }
  }

  private async handleDecision(value: number): Promise<void> {
    // Numeric replies that didn't match a pending deletion are
    // forwarded as decision to the active project's Claude process.
    // The orchestrator handles the decision pipeline.
    this.emitEvent('command_handled', { command: 'decision', value });

    // Also forward as chat to active project
    await this.handleChat(String(value));
  }

  private async handleChat(text: string): Promise<void> {
    if (!this.projectManager) {
      // No project manager yet — reply helpfully
      await this.sendMessage('请先使用 /new 或 /open 选择一个项目');
      // "请先使用 /new 或 /open 选择一个项目"
      return;
    }

    try {
      const active = await this.projectManager.getActiveProject();
      if (!active) {
        await this.sendMessage('请先使用 /open 或 /new 选择一个项目');
        return;
      }

      // Forward chat to active project — the orchestrator will handle
      this.emitEvent('command_handled', {
        command: 'chat',
        projectId: active.id,
        text,
      });
    } catch (err) {
      error('Relay: chat handler error', err);
    }
  }

  // ── Event Emitter ────────────────────────────────────────────────

  private emitEvent(type: string, data?: unknown): void {
    if (this.onEvent) {
      try {
        this.onEvent({
          type,
          data,
          timestamp: new Date().toISOString(),
        });
      } catch {
        // Don't crash if event handler fails
      }
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Get emoji + Chinese label for a project status */
function getStatusText(status: ProjectStatus): string {
  const map: Record<ProjectStatus, string> = {
    idle: '🔴 空闲',        // 🔴 空闲
    running: '🟢 运行中', // 🟢 运行中
    completed: '✅ 已完成',     // ✅ 已完成
    error: '❌ 错误',               // ❌ 错误
    waiting: '⏳ 等待中',       // ⏳ 等待中
  };
  return map[status] || '⚪ 未知'; // ⚪ 未知
}

// ── Singleton ──────────────────────────────────────────────────────────

let _instance: RelayService | null = null;

export function getRelayService(): RelayService {
  if (!_instance) {
    _instance = new RelayService();
  }
  return _instance;
}
