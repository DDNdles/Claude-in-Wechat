// ═══════════════════════════════════════════════════════════════════════════
// Project IPC Handlers
// Bridges renderer ↔ main process for all project operations.
// All handlers return IpcResponse<T> so the renderer gets a uniform envelope.
// ═══════════════════════════════════════════════════════════════════════════

import { ipcMain } from 'electron';

import {
  IPC_CHANNELS,
  type IpcResponse,
  type TaskItem,
  type ProjectStatus,
} from '../../shared/types.js';

import {
  listProjects,
  createProject,
  deleteProject,
  renameProject,
  getProject,
  openProject,
  updateProjectStatus,
  updateTokenUsage,
} from '../services/project-manager.js';

import { info, error } from '../utils/logger.js';

// ═══════════════════════════════════════════════════════════════════════════
// Type helpers for handler signatures
// ═══════════════════════════════════════════════════════════════════════════

/** Wraps a handler function to ensure it always returns IpcResponse */
function wrapHandler<T>(
  channel: string,
  fn: (...args: any[]) => IpcResponse<T> | Promise<IpcResponse<T>>,
): void {
  ipcMain.handle(channel, async (_event, ...args: any[]): Promise<IpcResponse<T>> => {
    try {
      info(`IPC → ${channel}`, ...args.filter((a) => typeof a !== 'object'));
      const result = await fn(...args);
      if (!result.success) {
        error(`IPC → ${channel} failed: ${result.error}`);
      }
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      error(`IPC → ${channel} unhandled error`, err);
      return { success: false, error: msg };
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Register all project IPC handlers
// ═══════════════════════════════════════════════════════════════════════════

export function registerProjectHandlers(): void {
  info('Registering project IPC handlers...');

  // ── project:list ────────────────────────────────────────────────────────
  wrapHandler(IPC_CHANNELS.PROJECT_LIST, () => {
    const data = listProjects();
    return { success: true, data };
  });

  // ── project:create ──────────────────────────────────────────────────────
  wrapHandler(IPC_CHANNELS.PROJECT_CREATE, (name: string) => {
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return { success: false, error: '项目名称不能为空' };
    }
    return createProject(name.trim());
  });

  // ── project:delete ──────────────────────────────────────────────────────
  wrapHandler(IPC_CHANNELS.PROJECT_DELETE, (id: string) => {
    if (!id || typeof id !== 'string') {
      return { success: false, error: '项目 ID 无效' };
    }
    return deleteProject(id);
  });

  // ── project:rename ──────────────────────────────────────────────────────
  wrapHandler(IPC_CHANNELS.PROJECT_RENAME, (id: string, newName: string) => {
    if (!id || typeof id !== 'string') {
      return { success: false, error: '项目 ID 无效' };
    }
    if (!newName || typeof newName !== 'string' || newName.trim().length === 0) {
      return { success: false, error: '新名称不能为空' };
    }
    return renameProject(id, newName.trim());
  });

  // ── project:open ────────────────────────────────────────────────────────
  wrapHandler(IPC_CHANNELS.PROJECT_OPEN, (id: string) => {
    if (!id || typeof id !== 'string') {
      return { success: false, error: '项目 ID 无效' };
    }
    return openProject(id);
  });

  // ── project:get ─────────────────────────────────────────────────────────
  wrapHandler(IPC_CHANNELS.PROJECT_GET, (id: string) => {
    if (!id || typeof id !== 'string') {
      return { success: false, error: '项目 ID 无效' };
    }
    return getProject(id);
  });

  // ── project:update ──────────────────────────────────────────────────────
  wrapHandler(IPC_CHANNELS.PROJECT_UPDATE, (
    id: string,
    status?: string,
    progress?: number,
    tasks?: unknown,
  ) => {
    if (!id || typeof id !== 'string') {
      return { success: false, error: '项目 ID 无效' };
    }
    if (!status || typeof status !== 'string') {
      return { success: false, error: '状态不能为空' };
    }
    const validStatuses = new Set(['idle', 'running', 'completed', 'error', 'waiting']);
    if (!validStatuses.has(status)) {
      return { success: false, error: `无效状态: ${status}` };
    }

    // Validate tasks array if provided
    let parsedTasks: TaskItem[] | undefined;
    if (tasks !== undefined) {
      if (!Array.isArray(tasks)) {
        return { success: false, error: 'tasks 必须是数组' };
      }
      parsedTasks = tasks as TaskItem[];
    }

    return updateProjectStatus(
      id,
      status as ProjectStatus,
      progress,
      parsedTasks,
    );
  });

  // ── project:update-token-usage (additional convenience channel) ─────────
  ipcMain.handle('project:update-token-usage', async (
    _event,
    id: string,
    sessionTokens: number,
    dailyTokens: number,
  ): Promise<IpcResponse> => {
    try {
      if (!id || typeof id !== 'string') {
        return { success: false, error: '项目 ID 无效' };
      }
      info(`IPC → project:update-token-usage id=${id}`);
      return updateTokenUsage(id, sessionTokens, dailyTokens);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      error('IPC → project:update-token-usage failed', err);
      return { success: false, error: msg };
    }
  });

  info('Project IPC handlers registered');
}

// ═══════════════════════════════════════════════════════════════════════════
// Unregister (for hot-reload / cleanup)
// ═══════════════════════════════════════════════════════════════════════════

export function unregisterProjectHandlers(): void {
  info('Unregistering project IPC handlers...');

  const channels = [
    IPC_CHANNELS.PROJECT_LIST,
    IPC_CHANNELS.PROJECT_CREATE,
    IPC_CHANNELS.PROJECT_DELETE,
    IPC_CHANNELS.PROJECT_RENAME,
    IPC_CHANNELS.PROJECT_OPEN,
    IPC_CHANNELS.PROJECT_GET,
    IPC_CHANNELS.PROJECT_UPDATE,
    'project:update-token-usage',
  ];

  for (const channel of channels) {
    ipcMain.removeHandler(channel);
  }

  info('Project IPC handlers unregistered');
}
