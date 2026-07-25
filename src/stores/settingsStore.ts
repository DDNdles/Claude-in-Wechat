import { create } from 'zustand';
import type { AppSettings, IpcResponse } from '../../shared/types';

interface SettingsStore {
  settings: AppSettings;
  loading: boolean;
  loadSettings: () => Promise<void>;
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>;
}

const DEFAULT_SETTINGS: AppSettings = {
  wechatEnabled: false,
  projectDir: '',
  pollInterval: 5,
  autoStart: false,
  minimizeToTray: true,
  notifyOnComplete: true,
  maxOutputLength: 500,
  theme: 'dark',
};

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loading: false,

  loadSettings: async () => {
    set({ loading: true });
    try {
      if (window.electronAPI?.settingsGetAll) {
        const resp = await window.electronAPI.settingsGetAll();
        if (resp.success && resp.data) {
          set({ settings: { ...DEFAULT_SETTINGS, ...resp.data } as AppSettings, loading: false });
          return;
        }
      }
      // Mock settings
      set({
        settings: {
          ...DEFAULT_SETTINGS,
          wechatEnabled: true,
          projectDir: 'C:\\Users\\30959\\projects\\Wechat',
          autoStart: true,
        },
        loading: false,
      });
    } catch {
      set({ loading: false });
    }
  },

  updateSetting: async (key, value) => {
    if (window.electronAPI?.settingsSet) {
      await window.electronAPI.settingsSet(key as string, value);
    }
    set(s => ({
      settings: { ...s.settings, [key]: value },
    }));
  },
}));
