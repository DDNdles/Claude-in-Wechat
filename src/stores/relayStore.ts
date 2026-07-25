import { create } from 'zustand';

interface BridgeState {
  running: boolean;
  hasAccount: boolean;
  configured: boolean;
  pid: number | null;
  loading: boolean;
  error: string | null;

  refreshStatus: () => Promise<void>;
  loginWeChat: () => Promise<{ success: boolean; message: string }>;
  startBridge: () => Promise<{ success: boolean; message: string }>;
  stopBridge: () => Promise<{ success: boolean; message: string }>;
}

export const useRelayStore = create<BridgeState>((set) => ({
  running: false,
  hasAccount: false,
  configured: false,
  pid: null,
  loading: false,
  error: null,

  refreshStatus: async () => {
    set({ loading: true });
    try {
      const api = window.electronAPI;
      if (!api) { set({ loading: false, error: 'Electron API 不可用' }); return; }
      const resp = await api.wechatStatus();
      if (resp.success && resp.data) {
        set({ ...resp.data, loading: false, error: null });
      } else {
        set({ loading: false, error: resp.error || '获取状态失败' });
      }
    } catch (err) {
      set({ loading: false, error: String(err) });
    }
  },

  loginWeChat: async () => {
    const api = window.electronAPI;
    if (!api) return { success: false, message: 'Electron API 不可用' };
    const resp = await api.wechatLogin();
    if (resp.success && resp.data) {
      // Refresh status after login
      set(s => { s.refreshStatus(); return {}; });
      return resp.data;
    }
    return { success: false, message: resp.error || '登录失败' };
  },

  startBridge: async () => {
    const api = window.electronAPI;
    if (!api) return { success: false, message: 'Electron API 不可用' };
    const resp = await api.wechatStartBridge();
    if (resp.success && resp.data) {
      set(s => { s.refreshStatus(); return {}; });
      return resp.data;
    }
    return { success: false, message: resp.error || '启动失败' };
  },

  stopBridge: async () => {
    const api = window.electronAPI;
    if (!api) return { success: false, message: 'Electron API 不可用' };
    const resp = await api.wechatStopBridge();
    if (resp.success && resp.data) {
      set(s => { s.refreshStatus(); return {}; });
      return resp.data;
    }
    return { success: false, message: resp.error || '停止失败' };
  },
}));
