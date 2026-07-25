/**
 * Claude in WeChat — Configuration service.
 *
 * Manages app settings stored as JSON at CONFIG_FILE.
 * Provides get/set/getAll and file-watch capabilities.
 */

import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_FILE, PROJECTS_DIR, APP_DATA_DIR } from '../utils/paths';
import * as logger from '../utils/logger';
import type { AppSettings } from '../../shared/types';

// ── Default settings ─────────────────────────────────────────────────

const DEFAULTS: Readonly<AppSettings> = {
  wechatEnabled: false,
  projectDir: '', // Set dynamically from paths.ts
  pollInterval: 5,
  autoStart: false,
  minimizeToTray: true,
  notifyOnComplete: true,
  maxOutputLength: 500,
  theme: 'dark',
};

// ── Module-level cache ───────────────────────────────────────────────

let cachedSettings: AppSettings | null = null;
let watcher: fs.FSWatcher | null = null;
const changeListeners: Array<(settings: AppSettings) => void> = [];

// ── Helpers ──────────────────────────────────────────────────────────

function ensureConfigDir(): void {
  const dir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function getProjectDirDefault(): string {
  return PROJECTS_DIR;
}

function readFromDisk(): AppSettings {
  ensureConfigDir();

  if (!fs.existsSync(CONFIG_FILE)) {
    const defaults: AppSettings = {
      ...DEFAULTS,
      projectDir: getProjectDirDefault(),
    };
    writeToDisk(defaults);
    return defaults;
  }

  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<AppSettings>;

    // Merge with defaults so new keys always exist
    const merged: AppSettings = {
      ...DEFAULTS,
      projectDir: getProjectDirDefault(),
      ...parsed,
    };

    // Validate theme
    if (!['dark', 'light', 'system'].includes(merged.theme)) {
      merged.theme = DEFAULTS.theme;
    }

    return merged;
  } catch (err) {
    logger.error('Failed to read config file, using defaults', err);
    const defaults: AppSettings = {
      ...DEFAULTS,
      projectDir: getProjectDirDefault(),
    };
    return defaults;
  }
}

function writeToDisk(settings: AppSettings): void {
  ensureConfigDir();
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(settings, null, 2), 'utf-8');
  } catch (err) {
    logger.error('Failed to write config file', err);
  }
}

function notifyListeners(settings: AppSettings): void {
  for (const listener of changeListeners) {
    try {
      listener(settings);
    } catch (err) {
      logger.warn('Config change listener error', err);
    }
  }
}

// ── Public API ───────────────────────────────────────────────────────

export function createConfigService() {
  return {
    /**
     * Get a single setting by key.
     */
    get<K extends keyof AppSettings>(key: K): AppSettings[K] {
      if (!cachedSettings) {
        cachedSettings = readFromDisk();
      }
      return cachedSettings[key];
    },

    /**
     * Set a single setting and persist to disk.
     */
    set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
      if (!cachedSettings) {
        cachedSettings = readFromDisk();
      }
      if (cachedSettings[key] === value) {
        return; // No change
      }
      cachedSettings[key] = value;
      writeToDisk(cachedSettings);
      notifyListeners(cachedSettings);
    },

    /**
     * Return a shallow copy of all settings.
     */
    getAll(): AppSettings {
      if (!cachedSettings) {
        cachedSettings = readFromDisk();
      }
      return { ...cachedSettings };
    },

    /**
     * Overwrite all settings at once (e.g. from import).
     */
    setAll(settings: Partial<AppSettings>): void {
      if (!cachedSettings) {
        cachedSettings = readFromDisk();
      }
      cachedSettings = { ...cachedSettings, ...settings };
      writeToDisk(cachedSettings);
      notifyListeners(cachedSettings);
    },

    /**
     * Reset to defaults.
     */
    reset(): void {
      cachedSettings = {
        ...DEFAULTS,
        projectDir: getProjectDirDefault(),
      };
      writeToDisk(cachedSettings);
      notifyListeners(cachedSettings);
    },

    /**
     * Register a callback that fires whenever the config changes (set or file watch).
     * Returns an unsubscribe function.
     */
    onChange(listener: (settings: AppSettings) => void): () => void {
      changeListeners.push(listener);
      return () => {
        const idx = changeListeners.indexOf(listener);
        if (idx !== -1) {
          changeListeners.splice(idx, 1);
        }
      };
    },

    /**
     * Start watching the config file for external changes.
     * Useful when another tool edits config.json directly.
     */
    startWatch(): void {
      if (watcher) return;

      ensureConfigDir();
      try {
        watcher = fs.watch(CONFIG_FILE, (eventType) => {
          if (eventType === 'change') {
            logger.info('Config file changed externally, reloading');
            cachedSettings = null; // Force re-read
            const fresh = readFromDisk();
            notifyListeners(fresh);
          }
        });

        watcher.on('error', (err) => {
          logger.error('Config file watcher error', err);
        });
      } catch (err) {
        logger.warn('Could not start config file watcher', err);
      }
    },

    /**
     * Stop watching the config file.
     */
    stopWatch(): void {
      if (watcher) {
        watcher.close();
        watcher = null;
      }
    },
  };
}

// ── Singleton convenience export ─────────────────────────────────────

let instance: ReturnType<typeof createConfigService> | null = null;

export function getConfigService() {
  if (!instance) {
    instance = createConfigService();
  }
  return instance;
}
