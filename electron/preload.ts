/**
 * Claude-in-WeChat v0.5.3 — Preload script
 * Clean, typed IPC bridge. No mock data.
 */

import { contextBridge, ipcRenderer } from 'electron';
import type { IpcResponse, Project, AppSettings } from '../shared/types';

const electronAPI = {
  // ═══════════════════════════════════════════════════════════════
  // Project CRUD
  // ═══════════════════════════════════════════════════════════════

  projectList: (): Promise<IpcResponse<Project[]>> =>
    ipcRenderer.invoke('project:list'),

  projectCreate: (name: string): Promise<IpcResponse<Project>> =>
    ipcRenderer.invoke('project:create', name),

  projectDelete: (id: string): Promise<IpcResponse<void>> =>
    ipcRenderer.invoke('project:delete', id),

  projectRename: (id: string, newName: string): Promise<IpcResponse<Project>> =>
    ipcRenderer.invoke('project:rename', id, newName),

  projectOpen: (id: string): Promise<IpcResponse<Project>> =>
    ipcRenderer.invoke('project:open', id),

  projectGet: (id: string): Promise<IpcResponse<Project>> =>
    ipcRenderer.invoke('project:get', id),

  projectUpdate: (id: string, status: string, progress?: number, tasks?: unknown): Promise<IpcResponse<Project>> =>
    ipcRenderer.invoke('project:update', id, status, progress, tasks),

  // ═══════════════════════════════════════════════════════════════
  // Claude Launcher
  // ═══════════════════════════════════════════════════════════════

  claudeOpenTerminal: (projectId: string, cwd: string, projectName: string): Promise<IpcResponse<{ success: boolean; pid?: number; message: string }>> =>
    ipcRenderer.invoke('claude:open-terminal', projectId, cwd, projectName),

  claudeOpenProjectDir: (projectId: string, cwd: string, projectName: string): Promise<IpcResponse<{ success: boolean; message: string }>> =>
    ipcRenderer.invoke('claude:open-project-terminal', projectId, cwd, projectName),

  // ═══════════════════════════════════════════════════════════════
  // WeChat Bridge
  // ═══════════════════════════════════════════════════════════════

  wechatLogin: (): Promise<IpcResponse<{ success: boolean; message: string }>> =>
    ipcRenderer.invoke('wechat:login'),

  wechatQrStart: (): Promise<IpcResponse<{ success: boolean; qrcode?: string; qrcodeImg?: string; message: string }>> =>
    ipcRenderer.invoke('wechat:qr-start'),

  wechatQrStatus: (): Promise<IpcResponse<{ status: 'waiting' | 'scanned' | 'confirmed' | 'expired' | 'none'; message: string }>> =>
    ipcRenderer.invoke('wechat:qr-status'),

  wechatQrCancel: (): Promise<IpcResponse<void>> =>
    ipcRenderer.invoke('wechat:qr-cancel'),

  wechatAccount: (): Promise<IpcResponse<{ accountId: string; userId: string; name?: string } | null>> =>
    ipcRenderer.invoke('wechat:account'),

  wechatStatus: (): Promise<IpcResponse<{ running: boolean; hasAccount: boolean; configured: boolean; polling: boolean; pid: number | null }>> =>
    ipcRenderer.invoke('wechat:status'),

  wechatStartBridge: (): Promise<IpcResponse<{ success: boolean; message: string }>> =>
    ipcRenderer.invoke('wechat:start-bridge'),

  wechatStopBridge: (): Promise<IpcResponse<{ success: boolean; message: string }>> =>
    ipcRenderer.invoke('wechat:stop-bridge'),

  wechatLogs: (lines?: number): Promise<IpcResponse<{ logs: string }>> =>
    ipcRenderer.invoke('wechat:logs', lines),

  // ═══════════════════════════════════════════════════════════════
  // Hooks
  // ═══════════════════════════════════════════════════════════════

  hooksInstall: (): Promise<IpcResponse<{ success: boolean; message: string }>> =>
    ipcRenderer.invoke('hooks:install'),

  hooksRemove: (): Promise<IpcResponse<{ success: boolean; message: string }>> =>
    ipcRenderer.invoke('hooks:remove'),

  hooksStatus: (): Promise<IpcResponse<{ installed: boolean; hooks: unknown }>> =>
    ipcRenderer.invoke('hooks:status'),

  // ═══════════════════════════════════════════════════════════════
  // Relay
  // ═══════════════════════════════════════════════════════════════

  relayStart: (): Promise<IpcResponse<{ success: boolean; message: string }>> =>
    ipcRenderer.invoke('relay:start'),

  relayStop: (): Promise<IpcResponse<{ success: boolean; message: string }>> =>
    ipcRenderer.invoke('relay:stop'),

  relayStatus: (): Promise<IpcResponse<{ running: boolean; polling: boolean; configured: boolean; messagesToday: number; pendingDecisions: number }>> =>
    ipcRenderer.invoke('relay:status'),

  relaySendMessage: (text: string): Promise<IpcResponse<{ success: boolean; message: string }>> =>
    ipcRenderer.invoke('relay:send-message', text),

  // ═══════════════════════════════════════════════════════════════
  // Settings
  // ═══════════════════════════════════════════════════════════════

  settingsGet: (key: string): Promise<IpcResponse<unknown>> =>
    ipcRenderer.invoke('settings:get', key),

  settingsSet: (key: string, value: unknown): Promise<IpcResponse<void>> =>
    ipcRenderer.invoke('settings:set', key, value),

  settingsGetAll: (): Promise<IpcResponse<AppSettings>> =>
    ipcRenderer.invoke('settings:getAll'),

  // ═══════════════════════════════════════════════════════════════
  // App
  // ═══════════════════════════════════════════════════════════════

  appGetVersion: (): Promise<IpcResponse<string>> =>
    ipcRenderer.invoke('app:getVersion'),

  appMinimizeToTray: (): void => {
    ipcRenderer.invoke('app:minimizeToTray');
  },

  appQuit: (): void => {
    ipcRenderer.invoke('app:quit');
  },
};

try {
  contextBridge.exposeInMainWorld('electronAPI', electronAPI);
  console.log('[preload] electronAPI exposed successfully');
} catch (err) {
  console.error('[preload] Failed to expose electronAPI:', err);
}

export type ElectronAPI = typeof electronAPI;