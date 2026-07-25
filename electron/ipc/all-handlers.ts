/**
 * Claude-in-WeChat v0.4 — Consolidated IPC handlers
 * Project CRUD + WeChat Bridge + Claude Launcher + Hooks + Settings + App + Relay
 */

import { ipcMain, BrowserWindow, app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IpcResponse, AppSettings, Project } from '../../shared/types';
import * as logger from '../utils/logger';
import { getConfigService } from '../services/config-service';
import { AutoStarter } from '../services/auto-starter';

// Project manager
import {
  listProjects, createProject, deleteProject, renameProject,
  getProject, openProject, updateProjectStatus, updateTokenUsage,
  getActiveProject, setActiveProject, readProgress, getTokenUsage as pmGetTokenUsage,
  updateProjectProgress,
} from '../services/project-manager';

// Claude launcher
import { openClaudeTerminal, openProjectTerminal, hasSession, killSession } from '../services/claude-launcher';

// WeChat bridge
import {
  loginWeChat, getWeChatAccount, getBridgeStatus, startBridge, stopBridge,
  getBridgeLogs, isConfigured, hasWeChatAccount, sendMessageDirect,
} from '../services/wechat-bridge';

// Hooks
import { installHooks, removeHooks, getHooksConfig, areHooksInstalled, isWeixinGlobalInstalled } from '../services/hooks-manager';

// Relay
import { start as startRelay, stop as stopRelay, isRunning as isRelayRunning, getStatus as getRelayStatus } from '../services/relay-service';
import { getPendingDecisions, tryMatchDecision, resolveDecision } from '../services/hook-events-watcher';
import { isConfigured as wechatConfigured } from '../services/wechat-sender';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Helpers ──────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;

function respond<T = any>(success: boolean, data?: T, error?: string): IpcResponse<T> {
  return { success, data: data as T, error };
}

// ── Register all ─────────────────────────────────────────────────────

export function registerAllHandlers(win: BrowserWindow): void {
  mainWindow = win;
  const configService = getConfigService();

  // ═════════════════════════════════════════════════════════════════
  // Project handlers
  // ═════════════════════════════════════════════════════════════════

  ipcMain.handle('project:list', async (): Promise<IpcResponse<Project[]>> => {
    try { return respond(true, listProjects()); }
    catch (err) { return { success: false, error: String(err) } as IpcResponse<any>; }
  });

  ipcMain.handle('project:create', async (_e, name: string): Promise<IpcResponse<Project>> => {
    try {
      if (!name || typeof name !== 'string') return { success: false, error: '项目名称不能为空' } as IpcResponse<any>;
      return createProject(name.trim());
    } catch (err) { return { success: false, error: String(err) } as IpcResponse<any>; }
  });

  ipcMain.handle('project:delete', async (_e, id: string): Promise<IpcResponse<void>> => {
    try {
      if (!id || typeof id !== 'string') return { success: false, error: '项目 ID 无效' } as IpcResponse<any>;
      return deleteProject(id);
    } catch (err) { return { success: false, error: String(err) } as IpcResponse<any>; }
  });

  ipcMain.handle('project:rename', async (_e, id: string, newName: string): Promise<IpcResponse<Project>> => {
    try {
      if (!id || !newName) return { success: false, error: '参数无效' } as IpcResponse<any>;
      return renameProject(id, newName.trim());
    } catch (err) { return { success: false, error: String(err) } as IpcResponse<any>; }
  });

  ipcMain.handle('project:open', async (_e, id: string): Promise<IpcResponse<Project>> => {
    try {
      if (!id) return { success: false, error: '项目 ID 无效' } as IpcResponse<any>;
      return openProject(id);
    } catch (err) { return { success: false, error: String(err) } as IpcResponse<any>; }
  });

  ipcMain.handle('project:get', async (_e, id: string): Promise<IpcResponse<Project>> => {
    try { return getProject(id); }
    catch (err) { return { success: false, error: String(err) } as IpcResponse<any>; }
  });

  ipcMain.handle('project:update', async (_e, id: string, status?: string, progress?: number, tasks?: unknown): Promise<IpcResponse<Project>> => {
    try {
      return updateProjectStatus(id, (status as any) || 'idle', progress, tasks as any);
    } catch (err) { return { success: false, error: String(err) } as IpcResponse<any>; }
  });

  // ═════════════════════════════════════════════════════════════════
  // Claude Launcher handlers
  // ═════════════════════════════════════════════════════════════════

  ipcMain.handle('claude:open-terminal', async (_e, projectId: string, cwd: string, projectName: string) => {
    try { return respond(true, openClaudeTerminal(projectId, cwd, projectName)); }
    catch (err) { return { success: false, error: String(err) } as IpcResponse<any>; }
  });

  ipcMain.handle('claude:open-project-terminal', async (_e, projectId: string, cwd: string, projectName: string) => {
    try { return respond(true, openProjectTerminal(projectId, cwd, projectName)); }
    catch (err) { return { success: false, error: String(err) } as IpcResponse<any>; }
  });

  ipcMain.handle('claude:session-status', async (_e, projectId: string) => {
    try { return respond(true, { active: hasSession(projectId) }); }
    catch (err) { return { success: false, error: String(err) } as IpcResponse<any>; }
  });

  ipcMain.handle('claude:kill-session', async (_e, projectId: string) => {
    try { return respond(true, { killed: killSession(projectId) }); }
    catch (err) { return { success: false, error: String(err) } as IpcResponse<any>; }
  });

  // ═════════════════════════════════════════════════════════════════
  // WeChat Bridge handlers
  // ═════════════════════════════════════════════════════════════════

  ipcMain.handle('wechat:login', async () => {
    try { return respond(true, loginWeChat()); }
    catch (err) { return { success: false, error: String(err) } as IpcResponse<any>; }
  });

  ipcMain.handle('wechat:account', async () => {
    try { return respond(true, getWeChatAccount()); }
    catch (err) { return { success: false, error: String(err) } as IpcResponse<any>; }
  });

  ipcMain.handle('wechat:status', async () => {
    try {
      const bridgeStatus = getBridgeStatus();
      return respond(true, {
        ...bridgeStatus,
        hasAccount: hasWeChatAccount(),
        configured: isConfigured(),
      });
    } catch (err) { return { success: false, error: String(err) } as IpcResponse<any>; }
  });

  ipcMain.handle('wechat:start-bridge', async () => {
    try { return respond(true, startBridge()); }
    catch (err) { return { success: false, error: String(err) } as IpcResponse<any>; }
  });

  ipcMain.handle('wechat:stop-bridge', async () => {
    try { return respond(true, stopBridge()); }
    catch (err) { return { success: false, error: String(err) } as IpcResponse<any>; }
  });

  ipcMain.handle('wechat:logs', async (_e, lines?: number) => {
    try { return respond(true, { logs: getBridgeLogs(lines || 50) }); }
    catch (err) { return { success: false, error: String(err) } as IpcResponse<any>; }
  });

  // ═════════════════════════════════════════════════════════════════
  // Hooks handlers
  // ═════════════════════════════════════════════════════════════════

  ipcMain.handle('hooks:install', async () => {
    try { return respond(true, installHooks()); }
    catch (err) { return { success: false, error: String(err) } as IpcResponse<any>; }
  });

  ipcMain.handle('hooks:remove', async () => {
    try { return respond(true, removeHooks()); }
    catch (err) { return { success: false, error: String(err) } as IpcResponse<any>; }
  });

  ipcMain.handle('hooks:status', async () => {
    try { return respond(true, getHooksConfig()); }
    catch (err) { return { success: false, error: String(err) } as IpcResponse<any>; }
  });

  // ═════════════════════════════════════════════════════════════════
  // Relay handlers (NEW v0.4)
  // ═════════════════════════════════════════════════════════════════

  ipcMain.handle('relay:start', async () => {
    try {
      startRelay();
      return respond(true, { success: true, message: '中继服务已启动' });
    } catch (err) { return { success: false, error: String(err) } as IpcResponse<any>; }
  });

  ipcMain.handle('relay:stop', async () => {
    try {
      stopRelay();
      return respond(true, { success: true, message: '中继服务已停止' });
    } catch (err) { return { success: false, error: String(err) } as IpcResponse<any>; }
  });

  ipcMain.handle('relay:status', async () => {
    try { return respond(true, getRelayStatus()); }
    catch (err) { return { success: false, error: String(err) } as IpcResponse<any>; }
  });

  ipcMain.handle('relay:send-message', async (_e, text: string) => {
    try {
      const result = await sendMessageDirect(text);
      return respond(true, result);
    } catch (err) { return { success: false, error: String(err) } as IpcResponse<any>; }
  });

  ipcMain.handle('relay:pending-decisions', async () => {
    try { return respond(true, getPendingDecisions()); }
    catch (err) { return { success: false, error: String(err) } as IpcResponse<any>; }
  });

  ipcMain.handle('relay:resolve-decision', async (_e, decisionId: string, answer: string) => {
    try {
      const num = parseInt(answer, 10);
      const result = resolveDecision(decisionId, isNaN(num) ? 0 : num - 1);
      return respond(true, result);
    } catch (err) { return { success: false, error: String(err) } as IpcResponse<any>; }
  });

  // ═════════════════════════════════════════════════════════════════
  // Settings handlers
  // ═════════════════════════════════════════════════════════════════

  ipcMain.handle('settings:get', async (_e, key: string) => {
    try { return respond(true, configService.get(key as keyof AppSettings)); }
    catch (err) { return { success: false, error: String(err) } as IpcResponse<any>; }
  });

  ipcMain.handle('settings:set', async (_e, key: string, value: unknown) => {
    try {
      configService.set(key as keyof AppSettings, value as any);
      if (key === 'autoStart') {
        const a = new AutoStarter();
        value ? a.enable() : a.disable();
      }
      return respond(true);
    } catch (err) { return { success: false, error: String(err) } as IpcResponse<any>; }
  });

  ipcMain.handle('settings:getAll', async () => {
    try { return respond(true, configService.getAll()); }
    catch (err) { return { success: false, error: String(err) } as IpcResponse<any>; }
  });

  // ═════════════════════════════════════════════════════════════════
  // App handlers
  // ═════════════════════════════════════════════════════════════════

  ipcMain.handle('app:getVersion', async () => {
    const pkgPath = path.join(
      app.isPackaged ? path.dirname(app.getAppPath()) : path.resolve(__dirname, '..', '..'),
      'package.json',
    );
    try {
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        return respond(true, pkg.version || '0.4.0');
      }
      return respond(true, '0.4.0');
    } catch { return respond(true, '0.4.0'); }
  });

  ipcMain.handle('app:minimizeToTray', async () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
    return respond(true);
  });

  ipcMain.handle('app:quit', async () => {
    stopRelay();
    setTimeout(() => app.quit(), 100);
    return respond(true);
  });

  logger.info('All IPC handlers registered (v0.4)');
}