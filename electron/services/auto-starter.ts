/**
 * Claude in WeChat — Windows auto-start management.
 *
 * Wraps the platform-level registry functions with a higher-level API
 * tied to this Electron app's executable path.
 */

import { app } from 'electron';
import {
  isWindows,
  enableAutoStart as platformEnable,
  disableAutoStart as platformDisable,
  isAutoStartEnabled as platformIsEnabled,
} from '../utils/platform';
import * as logger from '../utils/logger';

// ── Constants ────────────────────────────────────────────────────────

/** Registry key name used for auto-start */
const DEFAULT_APP_NAME = 'ClaudeInWechat';

// ── Public API ───────────────────────────────────────────────────────

export class AutoStarter {
  private readonly appName: string;
  private readonly appPath: string;

  /**
   * @param appName - Display name for the registry Run key.
   * @param appPath - Absolute path to the executable. Defaults to `app.getPath('exe')`.
   */
  constructor(appName: string = DEFAULT_APP_NAME, appPath?: string) {
    this.appName = appName;
    // Resolve appPath lazily during first enable, because app.getPath may
    // not be available at module init time.
    this.appPath = appPath || '';
  }

  /** Resolve the executable path (safe to call after app.ready). */
  private getAppPath(): string {
    if (this.appPath) return this.appPath;
    try {
      // In development, `app.getPath('exe')` returns `electron.exe`.
      // In production (packaged), it returns the real .exe path.
      if (app.isReady()) {
        return app.getPath('exe');
      }
      // Before ready, fall back to process.execPath.
      return process.execPath;
    } catch {
      return process.execPath;
    }
  }

  /**
   * Enable auto-start via Windows registry.
   * App will launch when the user logs in.
   */
  enable(): boolean {
    if (!isWindows) {
      logger.warn('Auto-start is only supported on Windows');
      return false;
    }

    const exePath = this.getAppPath();
    logger.info(`Enabling auto-start: ${this.appName} → ${exePath}`);

    const success = platformEnable(this.appName, exePath);
    if (success) {
      logger.info('Auto-start enabled successfully');
    } else {
      logger.error('Failed to enable auto-start');
    }
    return success;
  }

  /**
   * Disable auto-start (remove from registry).
   */
  disable(): boolean {
    if (!isWindows) {
      logger.warn('Auto-start is only supported on Windows');
      return false;
    }

    logger.info(`Disabling auto-start: ${this.appName}`);

    const success = platformDisable(this.appName);
    if (success) {
      logger.info('Auto-start disabled successfully');
    } else {
      logger.error('Failed to disable auto-start');
    }
    return success;
  }

  /**
   * Check whether auto-start is currently enabled in the registry.
   */
  isEnabled(): boolean {
    if (!isWindows) return false;
    return platformIsEnabled(this.appName);
  }

  /**
   * Toggle auto-start state.
   */
  toggle(): boolean {
    if (this.isEnabled()) {
      return this.disable();
    } else {
      return this.enable();
    }
  }
}
