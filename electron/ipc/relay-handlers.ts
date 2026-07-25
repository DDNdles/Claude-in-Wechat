// ═══════════════════════════════════════════════════════════════
// IPC Handlers — Relay service (WeChat polling)
// ═══════════════════════════════════════════════════════════════

import { ipcMain, BrowserWindow } from 'electron';
import { info, error, debug } from '../utils/logger';
import { getRelayService, RelayService } from '../services/relay-service';
import { getCcOrchestrator } from '../services/cc-orchestrator';
import type {
  IpcResponse,
  RelayStatus,
  RelayEvent,
  AppSettings,
} from '../../shared/types';
import { IPC_CHANNELS } from '../../shared/types';

// ── Service reference ──────────────────────────────────────────────────

let relayService: RelayService;
let mainWindow: BrowserWindow | null = null;

/** Push relay events to the renderer process */
function pushEvent(event: RelayEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.send('relay:event', event);
    } catch (err) {
      debug('Failed to push relay event to renderer', err);
    }
  }
}

/** Push chat events to orchestrator for active project */
function pushChatToOrchestrator(projectId: string, text: string): void {
  const orchestrator = getCcOrchestrator();
  orchestrator.sendToClaude(projectId, text);
}

// ── Registration ───────────────────────────────────────────────────────

export function registerRelayHandlers(window: BrowserWindow): void {
  mainWindow = window;
  relayService = getRelayService();

  // Set up event forwarding to renderer
  relayService.setEventCallback((event: RelayEvent) => {
    pushEvent(event);

    // If this is a chat command, also forward to orchestrator
    if (
      event.type === 'command_handled' &&
      event.data &&
      typeof event.data === 'object' &&
      (event.data as any).command === 'chat' &&
      (event.data as any).projectId &&
      (event.data as any).text
    ) {
      pushChatToOrchestrator(
        (event.data as any).projectId,
        (event.data as any).text,
      );
    }
  });

  // ── relay:status ─────────────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.RELAY_STATUS,
    async (): Promise<IpcResponse<RelayStatus>> => {
      try {
        const status = relayService.getStatus();
        return { success: true, data: status };
      } catch (err) {
        error('relay:status handler error', err);
        return { success: false, error: (err as Error).message };
      }
    },
  );

  // ── relay:start ──────────────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.RELAY_START,
    async (): Promise<IpcResponse<void>> => {
      try {
        relayService.start();
        return { success: true };
      } catch (err) {
        error('relay:start handler error', err);
        return { success: false, error: (err as Error).message };
      }
    },
  );

  // ── relay:stop ───────────────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.RELAY_STOP,
    async (): Promise<IpcResponse<void>> => {
      try {
        relayService.stop();
        return { success: true };
      } catch (err) {
        error('relay:stop handler error', err);
        return { success: false, error: (err as Error).message };
      }
    },
  );

  // ── relay:message ────────────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.RELAY_MESSAGE,
    async (
      _event,
      payload: { text: string },
    ): Promise<IpcResponse<void>> => {
      try {
        if (!payload || typeof payload.text !== 'string') {
          return { success: false, error: 'Invalid payload: text is required' };
        }
        await relayService.sendMessage(payload.text);
        return { success: true };
      } catch (err) {
        error('relay:message handler error', err);
        return { success: false, error: (err as Error).message };
      }
    },
  );

  // ── relay:updateSettings ─────────────────────────────────────────
  // Allow renderer to push updated settings to relay service
  ipcMain.handle(
    'relay:updateSettings',
    async (
      _event,
      settings: Partial<AppSettings>,
    ): Promise<IpcResponse<void>> => {
      try {
        relayService.updateSettings(settings);
        return { success: true };
      } catch (err) {
        error('relay:updateSettings handler error', err);
        return { success: false, error: (err as Error).message };
      }
    },
  );

  info('Relay IPC handlers registered');
}

/** Unregister relay handlers (for cleanup) */
export function unregisterRelayHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.RELAY_STATUS);
  ipcMain.removeHandler(IPC_CHANNELS.RELAY_START);
  ipcMain.removeHandler(IPC_CHANNELS.RELAY_STOP);
  ipcMain.removeHandler(IPC_CHANNELS.RELAY_MESSAGE);
  ipcMain.removeHandler('relay:updateSettings');
  relayService.stop();
  mainWindow = null;
}

export { relayService };
