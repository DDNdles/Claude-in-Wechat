import { create } from 'zustand';
import type { RelayStatus, IpcResponse } from '../../shared/types';

interface RelayStore {
  status: RelayStatus;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  startPolling: () => void;
}

const DEFAULT_STATUS: RelayStatus = {
  connected: false,
  polling: false,
  messagesToday: 0,
  errors: 0,
};

export const useRelayStore = create<RelayStore>((set, get) => ({
  status: DEFAULT_STATUS,

  start: async () => {
    if (window.electronAPI?.relayStart) {
      await window.electronAPI.relayStart();
    }
    set(s => ({ status: { ...s.status, polling: true } }));
  },

  stop: async () => {
    if (window.electronAPI?.relayStop) {
      await window.electronAPI.relayStop();
    }
    set(s => ({ status: { ...s.status, polling: false } }));
  },

  startPolling: () => {
    // Poll relay status every 5 seconds
    const poll = async () => {
      try {
        if (window.electronAPI?.relayStatus) {
          const resp = await window.electronAPI.relayStatus();
          if (resp.success && resp.data) {
            set({ status: resp.data as RelayStatus });
            return;
          }
        }
        // Mock: simulate connected state
        set({
          status: {
            connected: true,
            accountId: 'wxid_mock',
            polling: true,
            lastPollAt: new Date().toISOString(),
            messagesToday: 12,
            errors: 0,
          },
        });
      } catch {
        // Keep current state
      }
    };

    poll();
    setInterval(poll, 5000);
  },
}));
