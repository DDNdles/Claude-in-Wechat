// ═══════════════════════════════════════════════════════════════
// IPC Handlers — Claude Code Orchestrator
// ═══════════════════════════════════════════════════════════════

import { ipcMain, BrowserWindow } from 'electron';
import { info, error, debug } from '../utils/logger';
import { getCcOrchestrator, CcOrchestrator } from '../services/cc-orchestrator';
import type {
  IpcResponse,
  OrchestratorEvent,
} from '../../shared/types';
import { IPC_CHANNELS } from '../../shared/types';

// ── Service reference ──────────────────────────────────────────────────

let orchestrator: CcOrchestrator;
let mainWindow: BrowserWindow | null = null;

/** Push orchestrator events to the renderer process */
function pushEvent(event: OrchestratorEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.send('cc:event', event);
    } catch (err) {
      debug('Failed to push orchestrator event to renderer', err);
    }
  }
}

// ── Registration ───────────────────────────────────────────────────────

export function registerOrchestratorHandlers(window: BrowserWindow): void {
  mainWindow = window;
  orchestrator = getCcOrchestrator();

  // Set up event forwarding to renderer
  orchestrator.setEventCallback((event: OrchestratorEvent) => {
    pushEvent(event);
  });

  // ── cc:start ─────────────────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.CC_START,
    async (
      _event,
      payload: { projectId: string; cwd: string; initialPrompt?: string },
    ): Promise<IpcResponse<{ pid: number }>> => {
      try {
        if (!payload || !payload.projectId || !payload.cwd) {
          return {
            success: false,
            error: 'Invalid payload: projectId and cwd are required',
          };
        }

        const managed = orchestrator.spawnClaude(
          payload.projectId,
          payload.cwd,
          payload.initialPrompt,
        );

        return { success: true, data: { pid: managed.pid } };
      } catch (err) {
        error('cc:start handler error', err);
        return { success: false, error: (err as Error).message };
      }
    },
  );

  // ── cc:stop ──────────────────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.CC_STOP,
    async (
      _event,
      payload: { projectId: string },
    ): Promise<IpcResponse<{ killed: boolean }>> => {
      try {
        if (!payload || !payload.projectId) {
          return { success: false, error: 'Invalid payload: projectId is required' };
        }

        const killed = orchestrator.killClaude(payload.projectId);
        return { success: true, data: { killed } };
      } catch (err) {
        error('cc:stop handler error', err);
        return { success: false, error: (err as Error).message };
      }
    },
  );

  // ── cc:status ────────────────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.CC_STATUS,
    async (
      _event,
      payload: { projectId: string },
    ): Promise<IpcResponse<Record<string, unknown>>> => {
      try {
        if (!payload || !payload.projectId) {
          // If no projectId provided, return status of all processes
          const all = orchestrator.listProcesses();
          const result: Record<string, unknown> = {};
          for (const [id, status] of all) {
            result[id] = status;
          }
          return { success: true, data: result };
        }

        const status = orchestrator.getClaudeStatus(payload.projectId);
        return { success: true, data: status as unknown as Record<string, unknown> };
      } catch (err) {
        error('cc:status handler error', err);
        return { success: false, error: (err as Error).message };
      }
    },
  );

  // ── cc:output ────────────────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.CC_OUTPUT,
    async (
      _event,
      payload: { projectId: string; lines?: number },
    ): Promise<IpcResponse<string[]>> => {
      try {
        if (!payload || !payload.projectId) {
          return { success: false, error: 'Invalid payload: projectId is required' };
        }

        const output = orchestrator.getOutput(payload.projectId, payload.lines);
        return { success: true, data: output };
      } catch (err) {
        error('cc:output handler error', err);
        return { success: false, error: (err as Error).message };
      }
    },
  );

  // ── cc:open-terminal ─────────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.CC_OPEN_TERMINAL,
    async (
      _event,
      payload: { projectId: string },
    ): Promise<IpcResponse<{ opened: boolean }>> => {
      try {
        if (!payload || !payload.projectId) {
          return { success: false, error: 'Invalid payload: projectId is required' };
        }

        const opened = orchestrator.openTerminal(payload.projectId);
        return { success: true, data: { opened } };
      } catch (err) {
        error('cc:open-terminal handler error', err);
        return { success: false, error: (err as Error).message };
      }
    },
  );

  // ── cc:send-message ──────────────────────────────────────────────
  // Send a message to Claude's stdin
  ipcMain.handle(
    'cc:send-message',
    async (
      _event,
      payload: { projectId: string; message: string },
    ): Promise<IpcResponse<{ sent: boolean }>> => {
      try {
        if (!payload || !payload.projectId || typeof payload.message !== 'string') {
          return {
            success: false,
            error: 'Invalid payload: projectId and message are required',
          };
        }

        const sent = orchestrator.sendToClaude(payload.projectId, payload.message);
        return { success: true, data: { sent } };
      } catch (err) {
        error('cc:send-message handler error', err);
        return { success: false, error: (err as Error).message };
      }
    },
  );

  // ── cc:list ──────────────────────────────────────────────────────
  // List all managed Claude processes
  ipcMain.handle(
    'cc:list',
    async (): Promise<IpcResponse<Record<string, unknown>>> => {
      try {
        const all = orchestrator.listProcesses();
        const result: Record<string, unknown> = {};
        for (const [id, status] of all) {
          result[id] = status;
        }
        return { success: true, data: result };
      } catch (err) {
        error('cc:list handler error', err);
        return { success: false, error: (err as Error).message };
      }
    },
  );

  info('Orchestrator IPC handlers registered');
}

/** Unregister orchestrator handlers (for cleanup) */
export function unregisterOrchestratorHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.CC_START);
  ipcMain.removeHandler(IPC_CHANNELS.CC_STOP);
  ipcMain.removeHandler(IPC_CHANNELS.CC_STATUS);
  ipcMain.removeHandler(IPC_CHANNELS.CC_OUTPUT);
  ipcMain.removeHandler(IPC_CHANNELS.CC_OPEN_TERMINAL);
  ipcMain.removeHandler('cc:send-message');
  ipcMain.removeHandler('cc:list');
  orchestrator.killAll();
  mainWindow = null;
}

export { orchestrator };
