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
 * Resolve a guaranteed-writable project storage directory.
 * - Packaged: app.getPath('userData')/projects (e.g. %APPDATA%\Claude in WeChat\projects)
 *   This is always user-writable regardless of install location (Program Files or not).
 * - Dev: <project-root>/projects
 *
 * This is the standard Windows app pattern: exe may be in Program Files, but
 * user data always goes to %APPDATA% (or %LOCALAPPDATA%).
 */
function getProjectsDir(): string {
  try {
    if (app && app.getPath) {
      return path.join(app.getPath('userData'), 'projects');
    }
  } catch { /* not ready yet, fall through */ }
  // Dev fallback
  return path.resolve(__dirname, '..', '..', 'projects');
}

/** Project storage — always writable, never EPERM. */
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