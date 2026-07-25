// ═══════════════════════════════════════════════════════════════
// Hooks Manager Service v0.3
// Installs and manages Claude Code hooks for WeChat integration
// Uses weixin-global-integration skill's proven hook scripts
// ═══════════════════════════════════════════════════════════════

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { info, warn, error, debug } from '../utils/logger';

const HOME = os.homedir();

// ── Paths ─────────────────────────────────────────────────────────

const CLAUDE_SETTINGS_FILE = path.join(HOME, '.claude', 'settings.json');
const WEIXIN_GLOBAL_DIR = path.join(HOME, '.claude', 'skills', 'weixin-global-integration');
const HOOKS_INSTALL_SCRIPT = path.join(WEIXIN_GLOBAL_DIR, 'install.js');
const HOOKS_DIR = path.join(HOME, '.weixin-global-integration');
const APP_HOOKS_DIR = path.join(HOME, '.claude-in-wechat', 'hooks');

// ── Public API ────────────────────────────────────────────────────

/** Check if weixin-global-integration is installed */
export function isWeixinGlobalInstalled(): boolean {
  return fs.existsSync(WEIXIN_GLOBAL_DIR) && fs.existsSync(HOOKS_INSTALL_SCRIPT);
}

/** Check if hooks are currently configured in Claude settings */
export function areHooksInstalled(): boolean {
  try {
    if (!fs.existsSync(CLAUDE_SETTINGS_FILE)) return false;
    const settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_FILE, 'utf-8'));
    const hooks = settings.hooks;
    if (!hooks) return false;
    // Check for PreToolUse hooks (the key indicator)
    const preToolUse = hooks.PreToolUse;
    return Array.isArray(preToolUse) && preToolUse.length > 0;
  } catch { return false; }
}

/**
 * Install Claude Code hooks using the weixin-global-integration skill.
 * This runs `node install.js` which:
 * 1. Validates Node.js and WeChat account
 * 2. Copies hook scripts to ~/.weixin-global-integration/
 * 3. Merges hook config into ~/.claude/settings.json
 * 4. Sends a test message to WeChat
 */
export function installHooks(): { success: boolean; message: string } {
  try {
    if (!isWeixinGlobalInstalled()) {
      return {
        success: false,
        message: 'weixin-global-integration skill 未安装。请先运行 /weixin-global-integration setup',
      };
    }

    info('Installing Claude Code hooks via weixin-global-integration...');
    const result = execSync(`node "${HOOKS_INSTALL_SCRIPT}"`, {
      encoding: 'utf-8',
      timeout: 60_000,
      cwd: WEIXIN_GLOBAL_DIR,
      windowsHide: true,
      stdio: 'pipe',
    });

    info(`Hook installation output: ${result.slice(0, 300)}`);

    // Verify the hooks were installed
    if (areHooksInstalled()) {
      return { success: true, message: '✅ Claude Code Hooks 已配置成功！\n\n已安装: PreToolUse (AskUserQuestion转发 + 危险操作确认) + Stop (完成通知)' };
    }
    return { success: true, message: `Hooks 安装脚本已执行，请检查 ~/.claude/settings.json\n\n输出: ${result.slice(0, 200)}` };
  } catch (err: any) {
    error('Hook installation failed', err);
    const msg = err.stderr || err.message || String(err);
    return { success: false, message: `Hooks 配置失败: ${msg.slice(0, 300)}` };
  }
}

/**
 * Get the current hooks configuration for display.
 */
export function getHooksConfig(): { installed: boolean; hooks: Record<string, unknown> | null } {
  try {
    if (!fs.existsSync(CLAUDE_SETTINGS_FILE)) {
      return { installed: false, hooks: null };
    }
    const settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_FILE, 'utf-8'));
    return {
      installed: areHooksInstalled(),
      hooks: settings.hooks || null,
    };
  } catch {
    return { installed: false, hooks: null };
  }
}

/**
 * Remove hooks from Claude Code settings.
 */
export function removeHooks(): { success: boolean; message: string } {
  try {
    if (!fs.existsSync(CLAUDE_SETTINGS_FILE)) {
      return { success: true, message: '无需清理，settings.json 不存在' };
    }

    const settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_FILE, 'utf-8'));
    if (settings.hooks) {
      delete settings.hooks;
      // Backup before writing
      const backup = CLAUDE_SETTINGS_FILE + '.backup-' + Date.now();
      fs.copyFileSync(CLAUDE_SETTINGS_FILE, backup);
      fs.writeFileSync(CLAUDE_SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
      info('Hooks removed from Claude settings');
    }
    return { success: true, message: 'Hooks 已移除' };
  } catch (err: any) {
    return { success: false, message: `移除失败: ${err.message}` };
  }
}

/** Get the hooks directory path (for display in settings) */
export function getHooksDirectory(): string {
  return HOOKS_DIR;
}

/** Ensure local hooks directory exists */
export function ensureHooksDir(): void {
  if (!fs.existsSync(APP_HOOKS_DIR)) {
    fs.mkdirSync(APP_HOOKS_DIR, { recursive: true });
  }
}
