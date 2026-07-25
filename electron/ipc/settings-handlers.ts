/**
 * Claude in WeChat — IPC handlers for Settings.
 *
 * Registers all settings-related ipcMain.handle() listeners plus
 * app-level channels.
 */

import { ipcMain, BrowserWindow, app } from 'electron';
import type { IpcResponse, AppSettings } from '../../shared/types';
import { IPC_CHANNELS } from '../../shared/types';
import { getConfigService } from '../services/config-service';
import { AutoStarter } from '../services/auto-starter';
import * as logger from '../utils/logger';
import { HOOKS_DIR, CLAUDE_SETTINGS_FILE } from '../utils/paths';
import { isWindows } from '../utils/platform';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// ESM __dirname polyfill (for resolving package.json path in dev)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Helpers ──────────────────────────────────────────────────────────

function respond<T>(success: boolean, data?: T, error?: string): IpcResponse<T> {
  return { success, data, error };
}

function getMainWindow(): BrowserWindow | null {
  const windows = BrowserWindow.getAllWindows();
  return windows.length > 0 ? windows[0] : null;
}

// ── Settings handlers ────────────────────────────────────────────────

export function registerSettingsHandlers(): void {
  const configService = getConfigService();

  /**
   * settings:get — retrieve a single setting value.
   */
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, (_event, { key }): IpcResponse<unknown> => {
    try {
      const value = configService.get(key as keyof AppSettings);
      return respond(true, value);
    } catch (err) {
      logger.error(`Failed to get setting: ${key}`, err);
      return respond(false, undefined, `Failed to get setting: ${key}`);
    }
  });

  /**
   * settings:set — update a single setting value.
   */
  ipcMain.handle(IPC_CHANNELS.SETTINGS_SET, (_event, { key, value }): IpcResponse<void> => {
    try {
      configService.set(key as keyof AppSettings, value);

      // Side-effect: sync auto-start when the `autoStart` setting changes
      if (key === 'autoStart') {
        const autoStarter = new AutoStarter();
        if (value) {
          autoStarter.enable();
        } else {
          autoStarter.disable();
        }
      }

      return respond(true);
    } catch (err) {
      logger.error(`Failed to set setting: ${key}=${value}`, err);
      return respond(false, undefined, `Failed to set setting: ${key}`);
    }
  });

  /**
   * settings:getAll — return all settings.
   */
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_ALL, (): IpcResponse<AppSettings> => {
    try {
      const settings = configService.getAll();
      return respond(true, settings);
    } catch (err) {
      logger.error('Failed to get all settings', err);
      return respond(false, undefined, 'Failed to get all settings');
    }
  });

  /**
   * setup:wechat — trigger WeChat QR login flow.
   *
   * Attempts to launch the external wechat-login tool or guide the user
   * through the OAuth / qrcode-terminal login process.
   */
  ipcMain.handle(IPC_CHANNELS.SETUP_WECHAT, async (): Promise<IpcResponse<{ connected: boolean; accountId?: string; userId?: string; needLogin?: boolean }>> => {
    try {
      // Step 1: Check if already connected
      const { WEIXIN_ACCOUNTS_FILE } = await import('../utils/paths');
      if (fs.existsSync(WEIXIN_ACCOUNTS_FILE)) {
        try {
          const accounts = JSON.parse(fs.readFileSync(WEIXIN_ACCOUNTS_FILE, 'utf-8'));
          if (Array.isArray(accounts) && accounts.length > 0) {
            const acct = accounts[0];
            logger.info('WeChat account already connected', { accountId: acct.accountId });
            return respond(true, {
              connected: true,
              accountId: acct.accountId,
              userId: acct.userId,
            });
          }
        } catch (parseErr) {
          logger.warn('Failed to parse weixin-accounts.json', parseErr);
        }
      }

      // Step 2: Try to launch QR login via claude-to-im skill
      const skillDir = path.join(require('node:os').homedir(), '.claude', 'skills', 'claude-to-im');
      if (fs.existsSync(path.join(skillDir, 'package.json'))) {
        const { execSync } = await import('node:child_process');
        try {
          logger.info('Launching WeChat QR login from claude-to-im...');
          execSync('npm run weixin:login', {
            cwd: skillDir,
            encoding: 'utf-8',
            timeout: 60_000,
            windowsHide: false, // Show the terminal so user can see QR
            stdio: 'pipe',
          });
          // Wait briefly for the login file to be written
          await new Promise(r => setTimeout(r, 2000));
          // Re-check for accounts
          if (fs.existsSync(WEIXIN_ACCOUNTS_FILE)) {
            const accounts = JSON.parse(fs.readFileSync(WEIXIN_ACCOUNTS_FILE, 'utf-8'));
            if (Array.isArray(accounts) && accounts.length > 0) {
              return respond(true, {
                connected: true,
                accountId: accounts[0].accountId,
                userId: accounts[0].userId,
              });
            }
          }
          return respond(true, { connected: false, needLogin: true });
        } catch (execErr: any) {
          logger.warn('QR login launch failed', execErr.message);
          return respond(true, { connected: false, needLogin: true });
        }
      }

      // Step 3: No skill found, guide user
      return respond(true, {
        connected: false,
        needLogin: true,
      });
    } catch (err) {
      logger.error('WeChat setup failed', err);
      return respond(false, undefined, 'WeChat setup failed. Check the logs for details.');
    }
  });

  /**
   * setup:hooks — configure Claude Code hooks for WeChat integration.
   *
   * Writes hook scripts to the hooks directory and updates the Claude
   * settings.json to register the weixin-global-integration hooks.
   */
  ipcMain.handle(IPC_CHANNELS.SETUP_HOOKS, async (): Promise<IpcResponse<void>> => {
    try {
      // Ensure hooks directory exists
      if (!fs.existsSync(HOOKS_DIR)) {
        fs.mkdirSync(HOOKS_DIR, { recursive: true });
      }

      // Write a notification hook script (powershell on Windows, bash on others)
      const onStopHookContent = isWindows
        ? `# Claude Code onStop hook — notify WeChat relay
# This script is called when a Claude Code session ends.
param($sessionId, $projectPath)
$body = @{event="session_stop";sessionId=$sessionId;projectPath=$projectPath} | ConvertTo-Json
# Notify the Electron app via a temp file the relay polls
$notifyFile = Join-Path $env:USERPROFILE ".claude-in-wechat\\runtime\\session-events.json"
$body | Out-File -FilePath $notifyFile -Encoding utf8 -Force
`
        : `#!/usr/bin/env bash
# Claude Code onStop hook — notify WeChat relay
SESSION_ID="$1"
PROJECT_PATH="$2"
NOTIFY_FILE="$HOME/.claude-in-wechat/runtime/session-events.json"
echo "{\\"event\\":\\"session_stop\\",\\"sessionId\\":\\"$SESSION_ID\\",\\"projectPath\\":\\"$PROJECT_PATH\\"}" > "$NOTIFY_FILE"
`;

      const hookFileExt = isWindows ? '.ps1' : '.sh';
      const hookFilePath = path.join(HOOKS_DIR, `on-stop${hookFileExt}`);

      fs.writeFileSync(hookFilePath, onStopHookContent, { encoding: 'utf-8', mode: 0o755 });

      // Update Claude Code settings.json to register hooks
      let claudeSettings: Record<string, unknown> = {};

      if (fs.existsSync(CLAUDE_SETTINGS_FILE)) {
        try {
          const raw = fs.readFileSync(CLAUDE_SETTINGS_FILE, 'utf-8');
          claudeSettings = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          logger.warn('Could not parse Claude settings file, creating new');
        }
      }

      // Ensure hooks section exists
      if (!claudeSettings.hooks) {
        claudeSettings.hooks = {};
      }

      const hooks = claudeSettings.hooks as Record<string, unknown>;

      if (isWindows) {
        // PowerShell hook
        const psCmd = `powershell -ExecutionPolicy Bypass -File "${hookFilePath}" $SESSION_ID $PROJECT_PATH`;
        hooks.Stop = psCmd;
      } else {
        // Bash hook
        hooks.Stop = `/bin/bash "${hookFilePath}" "$SESSION_ID" "$PROJECT_PATH"`;
      }

      // Persist
      const claudeSettingsDir = path.dirname(CLAUDE_SETTINGS_FILE);
      if (!fs.existsSync(claudeSettingsDir)) {
        fs.mkdirSync(claudeSettingsDir, { recursive: true });
      }

      fs.writeFileSync(CLAUDE_SETTINGS_FILE, JSON.stringify(claudeSettings, null, 2), 'utf-8');

      logger.info('Claude Code hooks configured successfully');
      return respond(true);
    } catch (err) {
      logger.error('Failed to setup hooks', err);
      return respond(false, undefined, 'Failed to configure hooks. Check the logs for details.');
    }
  });
}

// ── App-level handlers ───────────────────────────────────────────────

export function registerAppHandlers(): void {
  const pkgPath = path.join(
    app.isPackaged ? path.dirname(app.getAppPath()) : path.resolve(__dirname, '..', '..'),
    'package.json',
  );

  /**
   * app:getVersion — return the current app version from package.json.
   */
  ipcMain.handle(IPC_CHANNELS.APP_GET_VERSION, (): IpcResponse<string> => {
    try {
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version?: string };
        return respond(true, pkg.version ?? '0.0.0');
      }
      return respond(true, app.getVersion());
    } catch {
      return respond(true, app.getVersion());
    }
  });

  /**
   * app:minimizeToTray — minimize the main window to the system tray.
   */
  ipcMain.handle(IPC_CHANNELS.APP_MINIMIZE_TO_TRAY, (): IpcResponse<void> => {
    try {
      const win = getMainWindow();
      if (win) {
        win.hide();
      }
      return respond(true);
    } catch (err) {
      logger.error('Failed to minimize to tray', err);
      return respond(false, undefined, 'Failed to minimize to tray');
    }
  });

  /**
   * app:quit — gracefully quit the application.
   */
  ipcMain.handle(IPC_CHANNELS.APP_QUIT, (): IpcResponse<void> => {
    try {
      logger.info('Quit requested via IPC');
      // Delay slightly so the IPC response can be sent back
      setTimeout(() => {
        app.quit();
      }, 100);
      return respond(true);
    } catch (err) {
      logger.error('Failed to quit', err);
      return respond(false, undefined, 'Failed to quit');
    }
  });
}

// ── Public hook: register everything ─────────────────────────────────

/**
 * Register all IPC handlers.
 * Call once from main.ts after app is ready.
 */
export function registerAllHandlers(): void {
  registerSettingsHandlers();
  registerAppHandlers();

  // Start watching config file for external changes
  const configService = getConfigService();
  configService.startWatch();

  logger.info('All IPC handlers registered');
}
