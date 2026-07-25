/**
 * Claude-in-WeChat v0.3 — Consolidated IPC handlers
 * Project CRUD + WeChat Bridge + Claude Launcher + Hooks + Settings + App
 */

import { ipcMain, BrowserWindow, app, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IpcResponse, AppSettings, Project } from '../../shared/types';
import * as logger from '../utils/logger';
import { getConfigService } from '../services/config-service';
import { AutoStarter } from '../services/auto-starter';

// Project manager (synchronous API)
import {
  listProjects, createProject, deleteProject, renameProject,
  getProject, openProject, updateProjectStatus, updateTokenUsage,
  getActiveProject, setActiveProject, readProgress, getTokenUsage as pmGetTokenUsage,
  updateProjectProgress,
} from '../services/project-manager';

// New services
import { loginWeChat, getWeChatAccount, getBridgeStatus, startBridge, stopBridge, getBridgeLogs, isConfigured, hasWeChatAccount } from '../services/wechat-bridge';
import { openClaudeTerminal, openProjectTerminal, hasSession, killSession } from '../services/claude-launcher';
import { installHooks, removeHooks, getHooksConfig, areHooksInstalled, isWeixinGlobalInstalled } from '../services/hooks-manager';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Helpers ──────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;

function respond<T = void>(success: boolean, data?: T, error?: string): IpcResponse<T> {
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
    catch (err) { return respond(false, undefined, String(err)) as any; }
  });

  ipcMain.handle('project:create', async (_e, name: string): Promise<IpcResponse<Project>> => {
    try {
      if (!name || typeof name !== 'string') return respond(false, undefined, '项目名称不能为空') as any;
      return createProject(name.trim());
    } catch (err) { return respond(false, undefined, String(err)) as any; }
  });

  ipcMain.handle('project:delete', async (_e, id: string): Promise<IpcResponse<void>> => {
    try {
      if (!id || typeof id !== 'string') return respond(false, undefined, '项目 ID 无效') as any;
      return deleteProject(id);
    } catch (err) { return respond(false, undefined, String(err)) as any; }
  });

  ipcMain.handle('project:rename', async (_e, id: string, newName: string): Promise<IpcResponse<Project>> => {
    try {
      if (!id || !newName) return respond(false, undefined, '参数无效') as any;
      return renameProject(id, newName.trim());
    } catch (err) { return respond(false, undefined, String(err)) as any; }
  });

  ipcMain.handle('project:open', async (_e, id: string): Promise<IpcResponse<Project>> => {
    try {
      if (!id) return respond(false, undefined, '项目 ID 无效') as any;
      return openProject(id);
    } catch (err) { return respond(false, undefined, String(err)) as any; }
  });

  ipcMain.handle('project:get', async (_e, id: string): Promise<IpcResponse<Project>> => {
    try { return getProject(id); }
    catch (err) { return respond(false, undefined, String(err)) as any; }
  });

  ipcMain.handle('project:update', async (_e, id: string, status?: string, progress?: number, tasks?: unknown): Promise<IpcResponse<Project>> => {
    try {
      return updateProjectStatus(id, (status as any) || 'idle', progress, tasks as any);
    } catch (err) { return respond(false, undefined, String(err)) as any; }
  });

  // ═════════════════════════════════════════════════════════════════
  // Claude Launcher handlers
  // ═════════════════════════════════════════════════════════════════

  ipcMain.handle('claude:open-terminal', async (_e, projectId: string, cwd: string, projectName: string) => {
    try { return respond(true, openClaudeTerminal(projectId, cwd, projectName)); }
    catch (err) { return respond(false, undefined, String(err)) as any; }
  });

  ipcMain.handle('claude:open-project-terminal', async (_e, projectId: string, cwd: string, projectName: string) => {
    try { return respond(true, openProjectTerminal(projectId, cwd, projectName)); }
    catch (err) { return respond(false, undefined, String(err)) as any; }
  });

  ipcMain.handle('claude:session-status', async (_e, projectId: string) => {
    try { return respond(true, { active: hasSession(projectId) }); }
    catch (err) { return respond(false, undefined, String(err)) as any; }
  });

  ipcMain.handle('claude:kill-session', async (_e, projectId: string) => {
    try { return respond(true, { killed: killSession(projectId) }); }
    catch (err) { return respond(false, undefined, String(err)) as any; }
  });

  // ═════════════════════════════════════════════════════════════════
  // WeChat Bridge handlers
  // ═════════════════════════════════════════════════════════════════

  ipcMain.handle('wechat:login', async () => {
    try { return respond(true, loginWeChat()); }
    catch (err) { return respond(false, undefined, String(err)) as any; }
  });

  ipcMain.handle('wechat:account', async () => {
    try { return respond(true, getWeChatAccount()); }
    catch (err) { return respond(false, undefined, String(err)) as any; }
  });

  ipcMain.handle('wechat:status', async () => {
    try { return respond(true, { ...getBridgeStatus(), hasAccount: hasWeChatAccount(), configured: isConfigured() }); }
    catch (err) { return respond(false, undefined, String(err)) as any; }
  });

  ipcMain.handle('wechat:start-bridge', async () => {
    try { return respond(true, startBridge()); }
    catch (err) { return respond(false, undefined, String(err)) as any; }
  });

  ipcMain.handle('wechat:stop-bridge', async () => {
    try { return respond(true, stopBridge()); }
    catch (err) { return respond(false, undefined, String(err)) as any; }
  });

  ipcMain.handle('wechat:logs', async (_e, lines?: number) => {
    try { return respond(true, { logs: getBridgeLogs(lines || 50) }); }
    catch (err) { return respond(false, undefined, String(err)) as any; }
  });

  // ═════════════════════════════════════════════════════════════════
  // Hooks handlers
  // ═════════════════════════════════════════════════════════════════

  ipcMain.handle('hooks:install', async () => {
    try { return respond(true, installHooks()); }
    catch (err) { return respond(false, undefined, String(err)) as any; }
  });

  ipcMain.handle('hooks:remove', async () => {
    try { return respond(true, removeHooks()); }
    catch (err) { return respond(false, undefined, String(err)) as any; }
  });

  ipcMain.handle('hooks:status', async () => {
    try { return respond(true, getHooksConfig()); }
    catch (err) { return respond(false, undefined, String(err)) as any; }
  });

  // ═════════════════════════════════════════════════════════════════
  // Settings handlers
  // ═════════════════════════════════════════════════════════════════

  ipcMain.handle('settings:get', async (_e, key: string) => {
    try { return respond(true, configService.get(key as keyof AppSettings)); }
    catch (err) { return respond(false, undefined, String(err)) as any; }
  });

  ipcMain.handle('settings:set', async (_e, key: string, value: unknown) => {
    try {
      configService.set(key as keyof AppSettings, value as any);
      if (key === 'autoStart') {
        const a = new AutoStarter();
        value ? a.enable() : a.disable();
      }
      return respond(true);
    } catch (err) { return respond(false, undefined, String(err)) as any; }
  });

  ipcMain.handle('settings:getAll', async () => {
    try { return respond(true, configService.getAll()); }
    catch (err) { return respond(false, undefined, String(err)) as any; }
  });

  // ═════════════════════════════════════════════════════════════════
  // App handlers
  // ═════════════════════════════════════════════════════════════════

  ipcMain.handle('app:getVersion', async () => {
    const pkgPath = path.join(app.isPackaged ? path.dirname(app.getAppPath()) : path.resolve(__dirname, '..', '..'), 'package.json');
    try {
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        return respond(true, pkg.version || '0.3.0');
      }
      return respond(true, '0.3.0');
    } catch { return respond(true, '0.3.0'); }
  });

  ipcMain.handle('app:minimizeToTray', async () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
    return respond(true);
  });

  ipcMain.handle('app:quit', async () => {
    setTimeout(() => app.quit(), 100);
    return respond(true);
  });

  logger.info('All IPC handlers registered');
}
