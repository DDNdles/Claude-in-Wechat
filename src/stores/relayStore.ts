import { create } from 'zustand';

interface BridgeState {
  running: boolean;
  hasAccount: boolean;
  configured: boolean;
  polling: boolean;
  pid: number | null;
  loading: boolean;
  error: string | null;

  refreshStatus: () => Promise<void>;
  loginWeChat: () => Promise<{ success: boolean; message: string }>;
  startBridge: () => Promise<{ success: boolean; message: string }>;
  stopBridge: () => Promise<{ success: boolean; message: string }>;
}

export const useRelayStore = create<BridgeState>((set, get) => ({
  running: false,
  hasAccount: false,
  configured: false,
  polling: false,
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
      // FIXED: await refreshStatus after login completes, NOT inside synchronous set()
      await get().refreshStatus();
      return resp.data;
    }
    return { success: false, message: resp.error || '登录失败' };
  },

  startBridge: async () => {
    const api = window.electronAPI;
    if (!api) return { success: false, message: 'Electron API 不可用' };
    const resp = await api.wechatStartBridge();
    if (resp.success && resp.data) {
      // FIXED: await refreshStatus after bridge starts
      await get().refreshStatus();
      return resp.data;
    }
    return { success: false, message: resp.error || '启动失败' };
  },

  stopBridge: async () => {
    const api = window.electronAPI;
    if (!api) return { success: false, message: 'Electron API 不可用' };
    const resp = await api.wechatStopBridge();
    if (resp.success && resp.data) {
      // FIXED: await refreshStatus after bridge stops
      await get().refreshStatus();
      return resp.data;
    }
    return { success: false, message: resp.error || '停止失败' };
  },
}));