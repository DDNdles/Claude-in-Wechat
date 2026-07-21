#!/usr/bin/env node
/**
 * weixin-global-integration installer
 *
 * Cross-platform Node.js installation script.
 *
 * Usage:
 *   node install.js                  — full install
 *   node install.js --no-daemon      — install without starting progress daemon
 *   node install.js --dry-run         — show what would be done without doing it
 *   node install.js --skip-settings   — don't modify settings.json
 *
 * Steps:
 *   1. Validate Node.js >= 20
 *   2. Validate WeChat account exists
 *   3. Copy files to install dir (~/.weixin-global-integration)
 *   4. Back up settings.json
 *   5. Merge hook configuration
 *   6. Optional: start progress daemon
 *   7. Send test message to WeChat
 */

import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

const HOME = homedir();
const SETTINGS_FILE = path.join(HOME, '.claude', 'settings.json');
const SKILL_DIR = path.join(HOME, '.claude', 'skills', 'weixin-global-integration');
const INSTALL_DIR = path.join(HOME, '.weixin-global-integration');
const CTI_DATA = path.join(HOME, '.claude-to-im', 'data');

const DRY_RUN = process.argv.includes('--dry-run');
const NO_DAEMON = process.argv.includes('--no-daemon');
const SKIP_SETTINGS = process.argv.includes('--skip-settings');

// Style helpers
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

const check = (label, fn) => {
  try {
    const result = fn();
    if (result === false) throw new Error('check failed');
    console.log(`  ${green('✓')} ${label}`);
    return result;
  } catch (err) {
    console.log(`  ${red('✗')} ${label}: ${err.message}`);
    return false;
  }
};

function copyDir(src, dest) {
  if (DRY_RUN) {
    console.log(`  ${yellow('[dry-run]')} Would copy ${src} → ${dest}`);
    return;
  }
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const ent of entries) {
    const srcPath = path.join(src, ent.name);
    const destPath = path.join(dest, ent.name);
    if (ent.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// ═══════════════════════════════════════════
// Step 0: Header
// ═══════════════════════════════════════════

console.log('');
console.log(bold('weixin-global-integration installer'));
console.log('='.repeat(50));
if (DRY_RUN) console.log(yellow('[DRY RUN — no changes will be made]'));
console.log('');

// ═══════════════════════════════════════════
// Step 1: Validate prerequisites
// ═══════════════════════════════════════════

console.log(bold('1. Prerequisites'));
console.log('─'.repeat(40));

const nodeVersion = check('Node.js >= 20', () => {
  const v = process.version.slice(1).split('.')[0];
  if (parseInt(v, 10) < 20) throw new Error(`Node ${process.version} < 20`);
  return process.version;
});

const wechatAccount = check('WeChat account linked', () => {
  const accountsFile = path.join(CTI_DATA, 'weixin-accounts.json');
  if (!fs.existsSync(accountsFile)) throw new Error(`${accountsFile} not found`);
  const accounts = JSON.parse(fs.readFileSync(accountsFile, 'utf-8'));
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error('No linked accounts — run /claude-to-im setup first');
  }
  return accounts[0].name || 'weixin';
});

if (!nodeVersion || !wechatAccount) {
  console.log('');
  console.log(red('Prerequisites not met. Please fix the issues above and retry.'));
  process.exit(1);
}

console.log('');

// ═══════════════════════════════════════════
// Step 2: Copy files
// ═══════════════════════════════════════════

console.log(bold('2. Copy files'));
console.log('─'.repeat(40));

const filesToCopy = [
  'lib/weixin-client.mjs',
  'hooks/hook-guard.mjs',
  'hooks/hook-ask-user.mjs',
  'hooks/hook-notify.mjs',
  'scripts/ask-weixin.mjs',
  'scripts/send-weixin.mjs',
  'scripts/query-progress.mjs',
  'daemon/progress-daemon.mjs',
];

for (const relPath of filesToCopy) {
  const src = path.join(SKILL_DIR, relPath);
  const dest = path.join(INSTALL_DIR, relPath);

  if (!fs.existsSync(src)) {
    console.log(`  ${red('✗')} Source missing: ${src}`);
    continue;
  }

  if (DRY_RUN) {
    console.log(`  ${yellow('[dry-run]')} Would copy ${relPath}`);
  } else {
    const destDir = path.dirname(dest);
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    fs.copyFileSync(src, dest);
    console.log(`  ${green('✓')} ${relPath}`);
  }
}

console.log('');

// ═══════════════════════════════════════════
// Step 3: Settings.json hook merge
// ═══════════════════════════════════════════

console.log(bold('3. Settings.json'));
console.log('─'.repeat(40));

if (SKIP_SETTINGS) {
  console.log(`  ${yellow('Skip')} --skip-settings flag set`);
} else if (!fs.existsSync(SETTINGS_FILE)) {
  console.log(`  ${red('✗')} ${SETTINGS_FILE} not found — cannot configure hooks.`);
  console.log('    Please add hooks manually. See docs for the required config.');
} else {
  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
  } catch (err) {
    console.log(`  ${red('✗')} Cannot parse ${SETTINGS_FILE}: ${err.message}`);
    process.exit(1);
  }

  // Backup
  const backupPath = SETTINGS_FILE + '.bak.weixin-integration';
  if (DRY_RUN) {
    console.log(`  ${yellow('[dry-run]')} Would backup to ${path.basename(backupPath)}`);
  } else {
    fs.copyFileSync(SETTINGS_FILE, backupPath);
    console.log(`  ${green('✓')} Backed up to ${path.basename(backupPath)}`);
  }

  // Use forward slashes for paths (Node.js understands them on Windows)
  const installDirUnix = INSTALL_DIR.replace(/\\/g, '/');
  const homeDirUnix = HOME.replace(/\\/g, '/');

  // Build new PreToolUse hooks
  const newPreToolUseHooks = [
    {
      hooks: [
        {
          command: `node "${installDirUnix}/hooks/hook-ask-user.mjs"`,
          timeout: 300,
          type: 'command',
        },
        {
          command: `node "${installDirUnix}/hooks/hook-guard.mjs"`,
          timeout: 300,
          type: 'command',
        },
      ],
    },
  ];

  // Build new PostToolUse hooks (error notification)
  const newPostToolUseHooks = [
    {
      hooks: [
        {
          command: `node "${installDirUnix}/hooks/hook-error-notify.mjs"`,
          timeout: 15,
          type: 'command',
        },
      ],
    },
  ];

  // Build new Stop hooks
  const newStopHooks = [
    {
      hooks: [
        {
          command: `node "${installDirUnix}/hooks/hook-notify.mjs"`,
          timeout: 15,
          type: 'command',
        },
      ],
    },
  ];

  // Initialize hooks if not present
  if (!settings.hooks) settings.hooks = {};

  // Replace PreToolUse hooks
  const existingPreToolUse = settings.hooks.PreToolUse;
  if (existingPreToolUse) {
    console.log(`  ${yellow('ℹ')} Replacing existing PreToolUse hooks (backup saved)`);
  }
  settings.hooks.PreToolUse = newPreToolUseHooks;

  // Replace Stop hooks
  const existingStop = settings.hooks.Stop;
  if (existingStop) {
    console.log(`  ${yellow('ℹ')} Replacing existing Stop hooks (backup saved)`);
  }
  settings.hooks.Stop = newStopHooks;

  // Add PostToolUse hooks (error notification)
  settings.hooks.PostToolUse = newPostToolUseHooks;

  if (DRY_RUN) {
    console.log(`  ${yellow('[dry-run]')} Would update settings.json hooks`);
  } else {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2) + '\n');
    console.log(`  ${green('✓')} Hooks configured in settings.json`);
  }
}

console.log('');

// ═══════════════════════════════════════════
// Step 4: Progress daemon
// ═══════════════════════════════════════════

console.log(bold('4. Progress daemon'));
console.log('─'.repeat(40));

if (NO_DAEMON) {
  console.log(`  ${yellow('Skip')} --no-daemon flag set`);
} else {
  const daemonScript = path.join(INSTALL_DIR, 'daemon', 'progress-daemon.mjs');
  const nodeBin = process.execPath;

  if (DRY_RUN) {
    console.log(`  ${yellow('[dry-run]')} Would start: ${nodeBin} ${daemonScript} start`);
  } else {
    const result = spawnSync(nodeBin, [daemonScript, 'start'], {
      encoding: 'utf-8',
      timeout: 10_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (result.stdout) console.log(`  ${green('✓')} ${result.stdout.trim()}`);
    if (result.stderr) console.log(`  ${yellow('⚠')} ${result.stderr.trim()}`);
    if (result.status !== 0) {
      console.log(`  ${red('✗')} Daemon start failed (exit ${result.status})`);
    }
  }
}

console.log('');

// ═══════════════════════════════════════════
// Step 5: Test message
// ═══════════════════════════════════════════

console.log(bold('5. Test notification'));
console.log('─'.repeat(40));

const sendScript = path.join(INSTALL_DIR, 'scripts', 'send-weixin.mjs');
const nodeBin = process.execPath;

if (DRY_RUN) {
  console.log(`  ${yellow('[dry-run]')} Would send test message`);
} else {
  const result = spawnSync(nodeBin, [sendScript, '✅ weixin-global-integration 安装成功！你现在会收到：\n• 危险操作确认\n• 问题询问\n• 完成通知\n回复"查询进度"获取进展'], {
    encoding: 'utf-8',
    timeout: 30_000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.stderr) {
    console.log(`  ${result.stderr.trim()}`);
  }
  if (result.status === 0) {
    console.log(`  ${green('✓')} Test message sent — check your WeChat!`);
  } else {
    console.log(`  ${red('✗')} Test message failed. Check that WeChat account is valid.`);
  }
}

console.log('');

// ═══════════════════════════════════════════
// Step 6: Summary
// ═══════════════════════════════════════════

console.log(bold('Installation complete!'));
console.log('='.repeat(50));
console.log('');
console.log("What's installed:");
console.log(`  📁 ${INSTALL_DIR}`);
console.log('');
console.log("What's configured:");
if (!SKIP_SETTINGS && !DRY_RUN) {
  console.log('  🔧 settings.json hooks updated');
}
if (!NO_DAEMON && !DRY_RUN) {
  console.log('  🤖 Progress daemon running');
}
console.log('');
console.log('WeChat commands:');
console.log('  回复 "查询进度" → 获取当前进度摘要');
console.log('');
console.log('Environment variables (optional):');
console.log('  WXG_NOTIFY_ENABLED=0  — disable Stop notifications');
console.log('  WXG_ASK_TIMEOUT=120   — AskUserQuestion timeout');
console.log('  WXG_TIMEOUT=120       — danger guard timeout');
console.log('  WXG_ALLOW_LIST="..."  — comma-separated always-allow patterns');
console.log('  WXG_DEFAULT_ACTION=block — default on timeout');
console.log('');
console.log('Manage:');
console.log(`  node ${path.join(INSTALL_DIR, 'daemon', 'progress-daemon.mjs')} start|stop|status`);
console.log(`  node ${path.join(INSTALL_DIR, 'scripts', 'query-progress.mjs')}`);
console.log(`  node ${path.join(INSTALL_DIR, 'scripts', 'send-weixin.mjs')} "your message"`);
console.log('');

if (DRY_RUN) {
  console.log(yellow('DRY RUN — no changes were made. Run without --dry-run to install.'));
  console.log('');
}