import { create } from 'zustand';
import type { Project, IpcResponse, AppSettings } from '../../shared/types';

interface ProjectStore {
  projects: Project[];
  loading: boolean;
  error: string | null;
  _pollRef: ReturnType<typeof setInterval> | null;

  loadProjects: () => Promise<void>;
  createProject: (name: string) => Promise<IpcResponse<Project>>;
  deleteProject: (id: string) => Promise<IpcResponse<void>>;
  renameProject: (id: string, newName: string) => Promise<IpcResponse<Project>>;
  openProject: (id: string) => Promise<IpcResponse<Project>>;
  getProject: (id: string) => Project | undefined;
  updateProject: (id: string, updates: Partial<Project>) => void;
  startPolling: () => void;
  stopPolling: () => void;
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projects: [],
  loading: false,
  error: null,
  _pollRef: null,

  loadProjects: async () => {
    set({ loading: true, error: null });
    try {
      const api = window.electronAPI;
      if (!api) {
        set({ loading: false, error: 'Electron API 不可用' });
        return;
      }
      const resp = await api.projectList();
      if (resp.success && resp.data) {
        set({ projects: resp.data, loading: false });
      } else {
        set({ error: resp.error || '加载失败', loading: false });
      }
    } catch (err) {
      set({ error: String(err), loading: false });
    }
  },

  createProject: async (name: string) => {
    const api = window.electronAPI;
    if (!api) return { success: false, error: 'Electron API 不可用' };
    const resp = await api.projectCreate(name);
    if (resp.success) await get().loadProjects();
    return resp;
  },

  deleteProject: async (id: string) => {
    const api = window.electronAPI;
    if (!api) return { success: false, error: 'Electron API 不可用' };
    const resp = await api.projectDelete(id);
    if (resp.success) await get().loadProjects();
    return resp;
  },

  renameProject: async (id: string, newName: string) => {
    const api = window.electronAPI;
    if (!api) return { success: false, error: 'Electron API 不可用' };
    const resp = await api.projectRename(id, newName);
    if (resp.success) await get().loadProjects();
    return resp;
  },

  openProject: async (id: string) => {
    const api = window.electronAPI;
    if (!api) return { success: false, error: 'Electron API 不可用' };
    const resp = await api.projectOpen(id);
    if (resp.success) await get().loadProjects();
    return resp;
  },

  getProject: (id: string) => {
    return get().projects.find(p => p.id === id);
  },

  updateProject: (id: string, updates: Partial<Project>) => {
    set(s => ({
      projects: s.projects.map(p => (p.id === id ? { ...p, ...updates } : p)),
    }));
  },

  // v0.4: Auto-refresh polling every 5 seconds
  startPolling: () => {
    const existing = get()._pollRef;
    if (existing) clearInterval(existing);
    const id = setInterval(() => {
      get().loadProjects();
    }, 5000);
    set({ _pollRef: id });
  },

  stopPolling: () => {
    const existing = get()._pollRef;
    if (existing) {
      clearInterval(existing);
      set({ _pollRef: null });
    }
  },
}));

// Extend Window interface for electronAPI
declare global {
  interface Window {
    electronAPI?: {
      projectList: () => Promise<IpcResponse<Project[]>>;
      projectCreate: (name: string) => Promise<IpcResponse<Project>>;
      projectDelete: (id: string) => Promise<IpcResponse<void>>;
      projectRename: (id: string, newName: string) => Promise<IpcResponse<Project>>;
      projectOpen: (id: string) => Promise<IpcResponse<Project>>;
      projectGet: (id: string) => Promise<IpcResponse<Project>>;
      projectUpdate: (id: string, status: string, progress?: number, tasks?: unknown) => Promise<IpcResponse<Project>>;
      claudeOpenTerminal: (projectId: string, cwd: string, projectName: string) => Promise<IpcResponse<{ success: boolean; pid?: number; message: string }>>;
      claudeOpenProjectDir: (projectId: string, cwd: string, projectName: string) => Promise<IpcResponse<{ success: boolean; message: string }>>;
      wechatLogin: () => Promise<IpcResponse<{ success: boolean; message: string }>>;
      wechatQrStart: () => Promise<IpcResponse<{ success: boolean; qrcode?: string; qrcodeImg?: string; message: string }>>;
      wechatQrStatus: () => Promise<IpcResponse<{ status: 'waiting' | 'scanned' | 'confirmed' | 'expired' | 'none'; message: string }>>;
      wechatQrCancel: () => Promise<IpcResponse<void>>;
      wechatAccount: () => Promise<IpcResponse<{ accountId: string; userId: string; name?: string } | null>>;
      wechatStatus: () => Promise<IpcResponse<{ running: boolean; hasAccount: boolean; configured: boolean; polling: boolean; pid: number | null }>>;
      wechatStartBridge: () => Promise<IpcResponse<{ success: boolean; message: string }>>;
      wechatStopBridge: () => Promise<IpcResponse<{ success: boolean; message: string }>>;
      wechatLogs: (lines?: number) => Promise<IpcResponse<{ logs: string }>>;
      hooksInstall: () => Promise<IpcResponse<{ success: boolean; message: string }>>;
      hooksRemove: () => Promise<IpcResponse<{ success: boolean; message: string }>>;
      hooksStatus: () => Promise<IpcResponse<{ installed: boolean; hooks: unknown }>>;
      settingsGet: (key: string) => Promise<IpcResponse<unknown>>;
      settingsSet: (key: string, value: unknown) => Promise<IpcResponse<void>>;
      settingsGetAll: () => Promise<IpcResponse<AppSettings>>;
      appGetVersion: () => Promise<IpcResponse<string>>;
      appMinimizeToTray: () => void;
      appQuit: () => void;
    };
  }
}