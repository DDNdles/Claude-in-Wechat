// ═══════════════════════════════════════════════════════════════
// Hooks Manager Service v0.3
// Installs Claude Code hooks for WeChat integration.
// Priority: weixin-global-integration skill → bundled vendor/hooks
// ═══════════════════════════════════════════════════════════════

import { execSync } from 'node:child_process';
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { info, warn, error } from '../utils/logger';

const HOME = os.homedir();

// ── Paths ─────────────────────────────────────────────────────────

const CLAUDE_SETTINGS_FILE = path.join(HOME, '.claude', 'settings.json');
const WEIXIN_GLOBAL_DIR = path.join(HOME, '.claude', 'skills', 'weixin-global-integration');
const HOOKS_INSTALL_SCRIPT = path.join(WEIXIN_GLOBAL_DIR, 'install.js');
const APP_HOOKS_DIR = path.join(HOME, '.claude-in-wechat', 'hooks');

/** Resolve vendor path (works in both dev and packaged) */
function getVendorHooksDir(): string {
  if (app.isPackaged) {
    // extraResources puts vendor at process.resourcesPath/vendor/
    return path.join(process.resourcesPath, 'vendor', 'hooks');
  }
  // Dev: __dirname is dist-electron/, vendor is at project root
  return path.join(__dirname, '..', 'vendor', 'hooks');
}

// ── Public API ────────────────────────────────────────────────────

export function isWeixinGlobalInstalled(): boolean {
  return fs.existsSync(WEIXIN_GLOBAL_DIR) && fs.existsSync(HOOKS_INSTALL_SCRIPT);
}

export function areHooksInstalled(): boolean {
  try {
    if (!fs.existsSync(CLAUDE_SETTINGS_FILE)) return false;
    const settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_FILE, 'utf-8'));
    const hooks = settings.hooks;
    if (!hooks) return false;
    const preToolUse = hooks.PreToolUse;
    return Array.isArray(preToolUse) && preToolUse.length > 0;
  } catch { return false; }
}

/**
 * Install Claude Code hooks.
 * Tries weixin-global-integration first (more complete),
 * falls back to bundled vendor/hooks scripts (self-contained).
 */
export function installHooks(): { success: boolean; message: string } {
  try {
    // Ensure app hooks directory exists
    if (!fs.existsSync(APP_HOOKS_DIR)) {
      fs.mkdirSync(APP_HOOKS_DIR, { recursive: true });
    }

    // Strategy 1: Use weixin-global-integration if available (best)
    if (isWeixinGlobalInstalled()) {
      info('Using weixin-global-integration for hook installation');
      try {
        const result = execSync(`node "${HOOKS_INSTALL_SCRIPT}"`, {
          encoding: 'utf-8', timeout: 60_000, cwd: WEIXIN_GLOBAL_DIR,
          windowsHide: true, stdio: 'pipe',
        });
        info(`weixin-global-integration output: ${result.slice(0, 200)}`);
        if (areHooksInstalled()) {
          return { success: true, message: '✅ Hooks 已配置 (weixin-global-integration)\n\nPreToolUse: AskUserQuestion转发 + 危险操作确认\nStop: 完成通知' };
        }
      } catch (skillErr: any) {
        warn(`weixin-global-integration failed, falling back to vendor hooks: ${skillErr.message}`);
      }
    }

    // Strategy 2: Use bundled vendor/hooks scripts
    const vendorDir = getVendorHooksDir();
    info(`Installing hooks from vendor: ${vendorDir}`);

    if (!fs.existsSync(vendorDir)) {
      return { success: false, message: `内置 hooks 脚本未找到: ${vendorDir}` };
    }

    // Copy hook scripts to app hooks directory
    const preToolUseSrc = path.join(vendorDir, 'pre-tool-use.ps1');
    const onStopSrc = path.join(vendorDir, 'on-stop.ps1');
    const preToolUseDst = path.join(APP_HOOKS_DIR, 'pre-tool-use.ps1');
    const onStopDst = path.join(APP_HOOKS_DIR, 'on-stop.ps1');

    if (!fs.existsSync(preToolUseSrc) || !fs.existsSync(onStopSrc)) {
      return { success: false, message: `内置 hooks 脚本不完整: ${vendorDir}` };
    }

    fs.copyFileSync(preToolUseSrc, preToolUseDst);
    fs.copyFileSync(onStopSrc, onStopDst);
    info(`Hook scripts copied to ${APP_HOOKS_DIR}`);

    // Build Claude Code settings.json hook configuration
    const preToolUseCmd = `powershell -ExecutionPolicy Bypass -File "${preToolUseDst}" $CLAUDE_TOOL_NAME $CLAUDE_TOOL_INPUT`;
    const stopCmd = `powershell -ExecutionPolicy Bypass -File "${onStopDst}" $CLAUDE_SESSION_ID $CLAUDE_PROJECT_DIR`;

    let claudeSettings: Record<string, unknown> = {};
    if (fs.existsSync(CLAUDE_SETTINGS_FILE)) {
      try {
        claudeSettings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_FILE, 'utf-8'));
      } catch { /* create new */ }
    }

    // Backup existing settings
    const backup = CLAUDE_SETTINGS_FILE + '.backup-' + Date.now();
    if (fs.existsSync(CLAUDE_SETTINGS_FILE)) {
      fs.copyFileSync(CLAUDE_SETTINGS_FILE, backup);
    }

    // Merge hooks (preserve existing non-hook settings)
    claudeSettings.hooks = {
      PreToolUse: [
        { matcher: 'AskUserQuestion', command: preToolUseCmd },
        { matcher: 'Bash', command: preToolUseCmd },
        { matcher: 'Write', command: preToolUseCmd },
        { matcher: 'Edit', command: preToolUseCmd },
      ],
      Stop: [{ command: stopCmd }],
    };

    const settingsDir = path.dirname(CLAUDE_SETTINGS_FILE);
    if (!fs.existsSync(settingsDir)) fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(CLAUDE_SETTINGS_FILE, JSON.stringify(claudeSettings, null, 2), 'utf-8');

    info('Claude Code hooks configured successfully (vendor)');
    return {
      success: true,
      message: `✅ Claude Code Hooks 已配置！\n\n安装位置: ${APP_HOOKS_DIR}\nPreToolUse: AskUserQuestion转发 + 危险操作确认\nStop: 完成通知`,
    };
  } catch (err: any) {
    error('Hook installation failed', err);
    return { success: false, message: `Hooks 配置失败: ${err.message}` };
  }
}

export function getHooksConfig(): { installed: boolean; hooks: Record<string, unknown> | null } {
  try {
    if (!fs.existsSync(CLAUDE_SETTINGS_FILE)) return { installed: false, hooks: null };
    const settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_FILE, 'utf-8'));
    return { installed: areHooksInstalled(), hooks: settings.hooks || null };
  } catch { return { installed: false, hooks: null }; }
}

export function removeHooks(): { success: boolean; message: string } {
  try {
    if (!fs.existsSync(CLAUDE_SETTINGS_FILE)) {
      return { success: true, message: '无需清理' };
    }
    const settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_FILE, 'utf-8'));
    if (settings.hooks) {
      const backup = CLAUDE_SETTINGS_FILE + '.backup-' + Date.now();
      fs.copyFileSync(CLAUDE_SETTINGS_FILE, backup);
      delete settings.hooks;
      fs.writeFileSync(CLAUDE_SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
      info('Hooks removed from Claude settings');
    }
    return { success: true, message: 'Hooks 已移除' };
  } catch (err: any) {
    return { success: false, message: `移除失败: ${err.message}` };
  }
}

export function getHooksDirectory(): string {
  return APP_HOOKS_DIR;
}
