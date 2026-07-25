/**
 * Claude in WeChat — Preload script.
 *
 * Exposes a typed, secure IPC bridge to the renderer via contextBridge.
 * Every method corresponds to an IPC channel defined in shared/types.ts.
 */

import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import type {
  IpcResponse,
  Project,
  RelayStatus,
  AppSettings,
  RelayEvent,
  OrchestratorEvent,
} from '../shared/types';

// ── Type for relay event callback ────────────────────────────────────
type RelayEventCallback = (event: RelayEvent) => void;
type OrchestratorEventCallback = (event: OrchestratorEvent) => void;

// ── Exposed API shape ────────────────────────────────────────────────

const electronAPI = {
  // ═══════════════════════════════════════════════════════════════════
  // Project Operations
  // ═══════════════════════════════════════════════════════════════════

  projectList: (): Promise<IpcResponse<Project[]>> =>
    ipcRenderer.invoke('project:list'),

  projectCreate: (name: string, launchMode?: 'wechat' | 'desktop'): Promise<IpcResponse<Project>> =>
    ipcRenderer.invoke('project:create', { name, launchMode }),

  projectDelete: (id: string): Promise<IpcResponse<void>> =>
    ipcRenderer.invoke('project:delete', { id }),

  projectRename: (id: string, name: string): Promise<IpcResponse<Project>> =>
    ipcRenderer.invoke('project:rename', { id, name }),

  projectOpen: (id: string): Promise<IpcResponse<void>> =>
    ipcRenderer.invoke('project:open', { id }),

  projectGet: (id: string): Promise<IpcResponse<Project>> =>
    ipcRenderer.invoke('project:get', { id }),

  projectUpdate: (project: Partial<Project> & { id: string }): Promise<IpcResponse<Project>> =>
    ipcRenderer.invoke('project:update', project),

  // ═══════════════════════════════════════════════════════════════════
  // Relay (WeChat connection)
  // ═══════════════════════════════════════════════════════════════════

  relayStart: (): Promise<IpcResponse<RelayStatus>> =>
    ipcRenderer.invoke('relay:start'),

  relayStop: (): Promise<IpcResponse<RelayStatus>> =>
    ipcRenderer.invoke('relay:stop'),

  relayStatus: (): Promise<IpcResponse<RelayStatus>> =>
    ipcRenderer.invoke('relay:status'),

  // ═══════════════════════════════════════════════════════════════════
  // Orchestrator (Claude Code)
  // ═══════════════════════════════════════════════════════════════════

  ccStart: (projectId: string): Promise<IpcResponse<{ pid: number }>> =>
    ipcRenderer.invoke('cc:start', { projectId }),

  ccStop: (projectId: string): Promise<IpcResponse<void>> =>
    ipcRenderer.invoke('cc:stop', { projectId }),

  ccStatus: (projectId: string): Promise<IpcResponse<{ status: string; pid?: number }>> =>
    ipcRenderer.invoke('cc:status', { projectId }),

  ccOpenTerminal: (projectId: string): Promise<IpcResponse<void>> =>
    ipcRenderer.invoke('cc:open-terminal', { projectId }),

  // ═══════════════════════════════════════════════════════════════════
  // Settings
  // ═══════════════════════════════════════════════════════════════════

  settingsGet: <K extends keyof AppSettings>(key: K): Promise<IpcResponse<AppSettings[K]>> =>
    ipcRenderer.invoke('settings:get', { key }),

  settingsSet: <K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<IpcResponse<void>> =>
    ipcRenderer.invoke('settings:set', { key, value }),

  settingsGetAll: (): Promise<IpcResponse<AppSettings>> =>
    ipcRenderer.invoke('settings:getAll'),

  setupWechat: (): Promise<IpcResponse<{ qrCodeUrl?: string }>> =>
    ipcRenderer.invoke('setup:wechat'),

  setupHooks: (): Promise<IpcResponse<void>> =>
    ipcRenderer.invoke('setup:hooks'),

  // ═══════════════════════════════════════════════════════════════════
  // App
  // ═══════════════════════════════════════════════════════════════════

  appGetVersion: (): Promise<IpcResponse<string>> =>
    ipcRenderer.invoke('app:getVersion'),

  appMinimizeToTray: (): void => {
    ipcRenderer.invoke('app:minimizeToTray');
  },

  appQuit: (): void => {
    ipcRenderer.invoke('app:quit');
  },

  // ═══════════════════════════════════════════════════════════════════
  // Push Events (Main → Renderer)
  // ═══════════════════════════════════════════════════════════════════

  onRelayEvent: (callback: RelayEventCallback): (() => void) => {
    const handler = (_event: IpcRendererEvent, data: RelayEvent): void => {
      callback(data);
    };
    ipcRenderer.on('relay:message', handler);
    // Return cleanup function
    return () => {
      ipcRenderer.removeListener('relay:message', handler);
    };
  },

  onOrchestratorEvent: (callback: OrchestratorEventCallback): (() => void) => {
    const handler = (_event: IpcRendererEvent, data: OrchestratorEvent): void => {
      callback(data);
    };
    ipcRenderer.on('cc:output', handler);
    // Return cleanup function
    return () => {
      ipcRenderer.removeListener('cc:output', handler);
    };
  },

  /**
   * Generic remove-all-listeners helper.
   * Call when unmounting a component to prevent memory leaks.
   */
  removeListener: (channel: string): void => {
    ipcRenderer.removeAllListeners(channel);
  },
};

// ── Expose to renderer ───────────────────────────────────────────────

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// ── Renderer-side type declaration (for TypeScript consumers) ────────

export type ElectronAPI = typeof electronAPI;
