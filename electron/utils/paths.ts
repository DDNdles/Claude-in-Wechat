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
 * Resolve the install root directory where the app exe lives.
 * - Packaged (NSIS): e.g. %LOCALAPPDATA%\Programs\Claude in WeChat
 * - Dev: project root (<repo>/)
 *
 * Projects are stored in <installRoot>/projects/ so they sit next to
 * the exe and are trivially discoverable.
 */
function getInstallRoot(): string {
  try {
    if (app && app.isPackaged) {
      // app.getPath('exe') = C:\...\Claude in WeChat\Claude in WeChat.exe
      return path.dirname(app.getPath('exe'));
    }
  } catch { /* not ready yet, fall through */ }
  // Dev: __dirname = dist-electron/, go up 2 = project root
  return path.resolve(__dirname, '..', '..');
}

function getProjectsDir(): string {
  return path.join(getInstallRoot(), 'projects');
}

/** Project storage — lives under the install directory. Always user-writable
 *  because NSIS perMachine:false installs to %LOCALAPPDATA%. */
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