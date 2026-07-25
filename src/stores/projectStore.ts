import { create } from 'zustand';
import type { Project, ProjectStatus, TaskItem, IpcResponse } from '../../shared/types';

interface ProjectStore {
  projects: Project[];
  loading: boolean;
  error: string | null;

  loadProjects: () => Promise<void>;
  createProject: (name: string) => Promise<IpcResponse<Project>>;
  deleteProject: (id: string) => Promise<IpcResponse<void>>;
  renameProject: (id: string, newName: string) => Promise<IpcResponse<void>>;
  openProject: (id: string) => Promise<IpcResponse<void>>;
  getProject: (id: string) => Project | undefined;
  updateProject: (id: string, updates: Partial<Project>) => void;
}

// Mock data for development (when electron API is not available)
const MOCK_PROJECTS: Project[] = [
  {
    id: '1',
    name: 'my-app',
    path: 'C:\\Users\\30959\\projects\\Wechat\\my-app',
    status: 'running',
    progress: 60,
    currentStep: 3,
    totalSteps: 5,
    tasks: [
      { id: 't1', subject: '初始化项目结构', description: '创建基础文件', status: 'completed' },
      { id: 't2', subject: '创建数据库模型', description: '定义数据表结构', status: 'completed' },
      { id: 't3', subject: '开发 REST API', description: '实现CRUD接口', status: 'in_progress', activeForm: '开发API中' },
      { id: 't4', subject: '前端页面开发', description: 'React组件', status: 'pending' },
      { id: 't5', subject: '编写测试', description: '单元测试', status: 'pending' },
    ],
    sessionTokens: 45230,
    dailyTokens: 128500,
    pid: 12345,
    createdAt: '2026-07-25T10:00:00.000Z',
    lastActiveAt: '2026-07-25T12:30:00.000Z',
    launchMode: 'wechat',
    lastOutput: '[10:30] Creating User model...\n[10:31] Generated src/models/User.ts',
  },
  {
    id: '2',
    name: 'api-server',
    path: 'C:\\Users\\30959\\projects\\Wechat\\api-server',
    status: 'completed',
    progress: 100,
    currentStep: 8,
    totalSteps: 8,
    tasks: [],
    sessionTokens: 89300,
    dailyTokens: 89300,
    createdAt: '2026-07-24T08:00:00.000Z',
    lastActiveAt: '2026-07-24T18:00:00.000Z',
    launchMode: 'desktop',
  },
  {
    id: '3',
    name: 'website-redesign',
    path: 'C:\\Users\\30959\\projects\\Wechat\\website-redesign',
    status: 'idle',
    progress: 0,
    tasks: [],
    sessionTokens: 0,
    dailyTokens: 0,
    createdAt: '2026-07-23T14:00:00.000Z',
    lastActiveAt: '2026-07-23T14:00:00.000Z',
    launchMode: 'wechat',
  },
];

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projects: [],
  loading: false,
  error: null,

  loadProjects: async () => {
    set({ loading: true, error: null });
    try {
      // Try electron API first
      if (window.electronAPI?.projectList) {
        const resp = await window.electronAPI.projectList();
        if (resp.success && resp.data) {
          set({ projects: resp.data as Project[], loading: false });
          return;
        }
      }
      // Fallback: use mock data
      set({ projects: MOCK_PROJECTS, loading: false });
    } catch (err) {
      // Fallback: use mock data
      set({ projects: MOCK_PROJECTS, loading: false });
    }
  },

  createProject: async (name: string) => {
    if (window.electronAPI?.projectCreate) {
      const resp = await window.electronAPI.projectCreate(name);
      if (resp.success) {
        await get().loadProjects();
      }
      return resp;
    }
    // Mock
    const newProject: Project = {
      id: String(Date.now()),
      name,
      path: `C:\\Users\\30959\\projects\\Wechat\\${name}`,
      status: 'idle',
      progress: 0,
      tasks: [],
      sessionTokens: 0,
      dailyTokens: 0,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      launchMode: 'wechat',
    };
    set(s => ({ projects: [...s.projects, newProject] }));
    return { success: true, data: newProject };
  },

  deleteProject: async (id: string) => {
    if (window.electronAPI?.projectDelete) {
      const resp = await window.electronAPI.projectDelete(id);
      if (resp.success) await get().loadProjects();
      return resp;
    }
    set(s => ({ projects: s.projects.filter(p => p.id !== id) }));
    return { success: true };
  },

  renameProject: async (id: string, newName: string) => {
    if (window.electronAPI?.projectRename) {
      return await window.electronAPI.projectRename(id, newName);
    }
    set(s => ({
      projects: s.projects.map(p =>
        p.id === id ? { ...p, name: newName, path: p.path.replace(/[^\\/]+$/, newName) } : p
      ),
    }));
    return { success: true };
  },

  openProject: async (id: string) => {
    if (window.electronAPI?.projectOpen) {
      return await window.electronAPI.projectOpen(id);
    }
    set(s => ({
      projects: s.projects.map(p =>
        p.id === id ? { ...p, status: 'running' as ProjectStatus, lastActiveAt: new Date().toISOString() } : p
      ),
    }));
    return { success: true };
  },

  getProject: (id: string) => {
    return get().projects.find(p => p.id === id);
  },

  updateProject: (id: string, updates: Partial<Project>) => {
    set(s => ({
      projects: s.projects.map(p => (p.id === id ? { ...p, ...updates } : p)),
    }));
  },
}));

// Extend Window interface for electronAPI
declare global {
  interface Window {
    electronAPI?: {
      projectList: () => Promise<IpcResponse<Project[]>>;
      projectCreate: (name: string) => Promise<IpcResponse<Project>>;
      projectDelete: (id: string) => Promise<IpcResponse<void>>;
      projectRename: (id: string, newName: string) => Promise<IpcResponse<void>>;
      projectOpen: (id: string) => Promise<IpcResponse<void>>;
      projectGet: (id: string) => Promise<IpcResponse<Project>>;
      relayStatus: () => Promise<IpcResponse<unknown>>;
      relayStart: () => Promise<IpcResponse<void>>;
      relayStop: () => Promise<IpcResponse<void>>;
      settingsGet: (key: string) => Promise<IpcResponse<unknown>>;
      settingsSet: (key: string, value: unknown) => Promise<IpcResponse<void>>;
      settingsGetAll: () => Promise<IpcResponse<Record<string, unknown>>>;
      setupWechat: () => Promise<IpcResponse<void>>;
      setupHooks: () => Promise<IpcResponse<void>>;
      ccStart: (projectId: string) => Promise<IpcResponse<void>>;
      ccStop: (projectId: string) => Promise<IpcResponse<void>>;
      ccStatus: (projectId: string) => Promise<IpcResponse<unknown>>;
      ccOpenTerminal: (projectId: string) => Promise<IpcResponse<void>>;
      appGetVersion: () => Promise<string>;
      appMinimizeToTray: () => void;
      appQuit: () => void;
      onRelayEvent: (callback: (event: unknown) => void) => void;
      onOrchestratorEvent: (callback: (event: unknown) => void) => void;
      removeListener: (channel: string) => void;
    };
  }
}
