import { create } from 'zustand';
import type { AppSettings } from '../../shared/types';

interface SettingsStore {
  settings: AppSettings;
  loading: boolean;
  error: string | null;
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

export const useSettingsStore = create<SettingsStore>((set) => ({
  settings: DEFAULT_SETTINGS,
  loading: false,
  error: null,

  loadSettings: async () => {
    set({ loading: true });
    try {
      const api = window.electronAPI;
      if (!api) {
        set({ loading: false, error: 'Electron API 不可用' });
        return;
      }
      const resp = await api.settingsGetAll();
      if (resp.success && resp.data) {
        set({ settings: { ...DEFAULT_SETTINGS, ...resp.data }, loading: false, error: null });
      } else {
        set({ loading: false, error: resp.error || '加载设置失败' });
      }
    } catch (err) {
      set({ loading: false, error: String(err) });
    }
  },

  updateSetting: async (key, value) => {
    const api = window.electronAPI;
    if (api) {
      await api.settingsSet(key as string, value);
    }
    set(s => ({
      settings: { ...s.settings, [key]: value },
    }));
  },
}));
