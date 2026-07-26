/**
 * Claude-in-WeChat v0.5.3 — Preload script (CommonJS)
 * Written directly as CJS to avoid ESM/CJS interop issues in packaged asar.
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const electronAPI = {
  projectList: () => ipcRenderer.invoke('project:list'),
  projectCreate: (name) => ipcRenderer.invoke('project:create', name),
  projectDelete: (id) => ipcRenderer.invoke('project:delete', id),
  projectRename: (id, newName) => ipcRenderer.invoke('project:rename', id, newName),
  projectOpen: (id) => ipcRenderer.invoke('project:open', id),
  projectGet: (id) => ipcRenderer.invoke('project:get', id),
  projectUpdate: (id, status, progress, tasks) => ipcRenderer.invoke('project:update', id, status, progress, tasks),

  claudeOpenTerminal: (projectId, cwd, projectName) => ipcRenderer.invoke('claude:open-terminal', projectId, cwd, projectName),
  claudeOpenProjectDir: (projectId, cwd, projectName) => ipcRenderer.invoke('claude:open-project-terminal', projectId, cwd, projectName),

  wechatLogin: () => ipcRenderer.invoke('wechat:login'),
  wechatQrStart: () => ipcRenderer.invoke('wechat:qr-start'),
  wechatQrStatus: () => ipcRenderer.invoke('wechat:qr-status'),
  wechatQrCancel: () => ipcRenderer.invoke('wechat:qr-cancel'),
  wechatAccount: () => ipcRenderer.invoke('wechat:account'),
  wechatStatus: () => ipcRenderer.invoke('wechat:status'),
  wechatStartBridge: () => ipcRenderer.invoke('wechat:start-bridge'),
  wechatStopBridge: () => ipcRenderer.invoke('wechat:stop-bridge'),
  wechatLogs: (lines) => ipcRenderer.invoke('wechat:logs', lines),

  hooksInstall: () => ipcRenderer.invoke('hooks:install'),
  hooksRemove: () => ipcRenderer.invoke('hooks:remove'),
  hooksStatus: () => ipcRenderer.invoke('hooks:status'),

  relayStart: () => ipcRenderer.invoke('relay:start'),
  relayStop: () => ipcRenderer.invoke('relay:stop'),
  relayStatus: () => ipcRenderer.invoke('relay:status'),
  relaySendMessage: (text) => ipcRenderer.invoke('relay:send-message', text),

  settingsGet: (key) => ipcRenderer.invoke('settings:get', key),
  settingsSet: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  settingsGetAll: () => ipcRenderer.invoke('settings:getAll'),

  appGetVersion: () => ipcRenderer.invoke('app:getVersion'),
  appMinimizeToTray: () => { ipcRenderer.invoke('app:minimizeToTray'); },
  appQuit: () => { ipcRenderer.invoke('app:quit'); },
};

try {
  contextBridge.exposeInMainWorld('electronAPI', electronAPI);
  console.log('[preload] electronAPI exposed successfully');
} catch (err) {
  console.error('[preload] Failed to expose electronAPI:', err);
}