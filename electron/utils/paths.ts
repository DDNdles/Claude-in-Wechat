import path from 'node:path';
import fs from 'node:fs';
import { homedir } from 'node:os';
import { app } from 'electron';

/**
 * Centralized path management for Claude in WeChat.
 * All paths flow through here so they can be changed in one place.
 */

const HOME = homedir();

/** Root directory for all Claude-in-Wechat data */
export const APP_DATA_DIR = path.join(HOME, '.claude-in-wechat');

/**
 * Resolve the software install root.
 * - Packaged: the directory containing the app (e.g. C:\Program Files\Claude in WeChat)
 * - Dev: the project root
 */
function getInstallRoot(): string {
  try {
    if (app && app.isPackaged) {
      // app.getAppPath() -> .../resources/app ; install root is 2 levels up
      return path.dirname(path.dirname(app.getAppPath()));
    }
  } catch { /* app not ready, fall through */ }
  // Dev fallback: project root (two levels up from electron/utils)
  return path.resolve(__dirname, '..', '..');
}

/**
 * Project storage — lives under the software install root:
 *   C:\Program Files\Claude in WeChat\projects\
 *   (dev: <project-root>\projects)
 * Each project is its own subfolder.
 */
export function getProjectsDir(): string {
  return path.join(getInstallRoot(), 'projects');
}

/**
 * Projects directory. Resolved eagerly — safe because app.isPackaged is
 * available immediately after the electron module is imported, and this
 * module is only imported by the main process.
 */
export const PROJECTS_DIR = getProjectsDir();

/** Project registry file */
export const REGISTRY_FILE = path.join(APP_DATA_DIR, 'projects.json');

/** App configuration file */
export const CONFIG_FILE = path.join(APP_DATA_DIR, 'config.json');

/** Log directory */
export const LOG_DIR = path.join(APP_DATA_DIR, 'logs');

/** Runtime state directory */
export const RUNTIME_DIR = path.join(APP_DATA_DIR, 'runtime');

/** Shared WeChat accounts from claude-to-im */
export const WEIXIN_ACCOUNTS_FILE = path.join(HOME, '.claude-to-im', 'data', 'weixin-accounts.json');

export const WEIXIN_TOKENS_FILE = path.join(HOME, '.claude-to-im', 'data', 'weixin-context-tokens.json');

/** Progress state per project */
export function projectProgressFile(projectId: string): string {
  return path.join(RUNTIME_DIR, `progress-${projectId}.json`);
}

/** Active project state file */
export const ACTIVE_PROJECT_FILE = path.join(RUNTIME_DIR, 'active-project.json');

/** Relay cursor for WeChat polling */
export const RELAY_CURSOR_FILE = path.join(RUNTIME_DIR, 'relay-cursor.json');

/** Claude Code settings file */
export const CLAUDE_SETTINGS_FILE = path.join(HOME, '.claude', 'settings.json');

/** Hook scripts directory (weixin-global-integration) */
export const HOOKS_DIR = path.join(APP_DATA_DIR, 'hooks');

/** Ensure all required directories exist */
export function ensureDirs(): void {
  const projectsDir = getProjectsDir();
  for (const dir of [APP_DATA_DIR, projectsDir, LOG_DIR, RUNTIME_DIR, HOOKS_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}