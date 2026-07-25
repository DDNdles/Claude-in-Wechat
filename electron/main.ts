/**
 * Claude in WeChat — Electron main process entry point.
 *
 * Responsibilities:
 *   - Single instance lock (only one app instance)
 *   - BrowserWindow creation and lifecycle
 *   - System tray with context menu
 *   - Auto-start management
 *   - IPC handler registration
 *   - Window close → minimize-to-tray behaviour
 *   - Dev / production resource loading
 *   - Context menu suppression
 */

import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  shell,
  nativeImage,
  screen,
  powerMonitor,
} from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as logger from './utils/logger';
import { ensureDirs } from './utils/paths';
import { isWindows } from './utils/platform';
import { registerAllHandlers } from './ipc/settings-handlers';
import { createConfigService } from './services/config-service';
import { AutoStarter } from './services/auto-starter';

// ── ESM __dirname polyfill ──────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Constants ────────────────────────────────────────────────────────
const APP_NAME = 'ClaudeInWechat';
const DEV_SERVER_URL = 'http://localhost:5173';
const IS_DEV = !app.isPackaged;

// ── Global references (prevent GC) ───────────────────────────────────
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

// ── Helpers ──────────────────────────────────────────────────────────

/** Create a 16×16 tray icon at runtime (solid colour circle) */
function createTrayIcon(): nativeImage {
  // Use bundled icon if available; otherwise generate a minimal one.
  const iconPath = path.join(__dirname, '..', 'assets', 'tray-icon.png');
  if (fs.existsSync(iconPath)) {
    return nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  }

  // Fallback: generate a 16×16 RGBA icon (blue circle on transparent background)
  const size = 16;
  const buf = Buffer.alloc(size * size * 4, 0);
  const cx = size / 2;
  const cy = size / 2;
  const r = 6;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx + 0.5;
      const dy = y - cy + 0.5;
      if (dx * dx + dy * dy <= r * r) {
        const idx = (y * size + x) * 4;
        buf[idx] = 64;     // R
        buf[idx + 1] = 128; // G
        buf[idx + 2] = 240; // B
        buf[idx + 3] = 255; // A
      }
    }
  }

  const img = nativeImage.createFromBuffer(buf, { width: size, height: size });
  return img;
}

/** Resolve the HTML entry point for the renderer */
function resolveEntryHtml(): string {
  if (IS_DEV) {
    return DEV_SERVER_URL;
  }
  return path.join(__dirname, '..', 'dist', 'index.html');
}

// ── Window ───────────────────────────────────────────────────────────

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: true,
    title: 'Claude in WeChat',
    backgroundColor: '#0f0f0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // needed for preload to access Node APIs via contextBridge
      webSecurity: true,
    },
  });

  // ── Show window when ready (avoid white flash) ───────────────────
  win.once('ready-to-show', () => {
    if (!isQuitting) {
      win.show();
      if (IS_DEV) {
        win.webContents.openDevTools({ mode: 'detach' });
      }
    }
  });

  // ── Close → minimize to tray ─────────────────────────────────────
  win.on('close', async (event) => {
    if (!isQuitting) {
      const configService = createConfigService();
      const settings = configService.getAll();
      if (settings.minimizeToTray) {
        event.preventDefault();
        win.hide();
        return;
      }
    }
    // Allow normal close
    mainWindow = null;
  });

  win.on('closed', () => {
    mainWindow = null;
  });

  // ── Disable right-click context menu in production ───────────────
  if (!IS_DEV) {
    win.webContents.on('context-menu', (event) => {
      event.preventDefault();
    });
  }

  // ── External links open in default browser ───────────────────────
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  return win;
}

// ── Tray ─────────────────────────────────────────────────────────────

function createTray(): Tray {
  const icon = createTrayIcon();
  const t = new Tray(icon);
  t.setToolTip('Claude in WeChat');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: () => {
        showMainWindow();
      },
    },
    {
      label: '全部暂停',
      click: async () => {
        if (mainWindow) {
          mainWindow.webContents.send('relay:message', {
            type: 'status_change',
            data: { action: 'pause_all' },
            timestamp: new Date().toISOString(),
          });
          mainWindow.webContents.send('cc:output', {
            type: 'status_change',
            data: { action: 'pause_all' },
            timestamp: new Date().toISOString(),
          });
        }
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        quitApp();
      },
    },
  ]);

  t.setContextMenu(contextMenu);

  t.on('double-click', () => {
    showMainWindow();
  });

  return t;
}

function showMainWindow(): void {
  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
  } else {
    mainWindow = createMainWindow();
    loadWindowContent(mainWindow);
  }
}

async function loadWindowContent(win: BrowserWindow): Promise<void> {
  const entryUrl = resolveEntryHtml();
  if (IS_DEV) {
    try {
      await win.loadURL(entryUrl);
    } catch (err) {
      logger.error('Failed to load dev server. Is Vite running?', err);
    }
  } else {
    await win.loadFile(entryUrl);
  }
}

// ── App lifecycle ────────────────────────────────────────────────────

/** Graceful quit */
function quitApp(): void {
  isQuitting = true;
  if (tray) {
    tray.destroy();
    tray = null;
  }
  if (mainWindow) {
    mainWindow.destroy();
    mainWindow = null;
  }
  app.quit();
}

async function onAppReady(): Promise<void> {
  // Ensure required directories exist
  ensureDirs();

  // ── Register all IPC handlers ───────────────────────────────────
  registerAllHandlers();

  // ── Auto-start check ────────────────────────────────────────────
  const configService = createConfigService();
  const autoStarter = new AutoStarter(APP_NAME);

  try {
    const settings = configService.getAll();
    if (settings.autoStart) {
      if (!autoStarter.isEnabled()) {
        autoStarter.enable();
      }
    } else {
      if (autoStarter.isEnabled()) {
        autoStarter.disable();
      }
    }
  } catch (err) {
    logger.warn('Could not sync auto-start setting', err);
  }

  // ── Create window and tray ──────────────────────────────────────
  mainWindow = createMainWindow();
  tray = createTray();
  await loadWindowContent(mainWindow);
}

// ── Single instance lock ─────────────────────────────────────────────

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // Focus existing window when another instance is launched
    showMainWindow();
  });

  // ── App events ──────────────────────────────────────────────────
  app.whenReady().then(onAppReady);

  app.on('window-all-closed', () => {
    // On Windows, keep process alive for tray functionality
    // Don't quit — just leave the tray icon running
  });

  app.on('activate', () => {
    // macOS dock click or Windows taskbar click
    if (mainWindow === null) {
      mainWindow = createMainWindow();
      loadWindowContent(mainWindow);
    } else {
      showMainWindow();
    }
  });

  app.on('before-quit', () => {
    isQuitting = true;
  });

  // ── Windows shutdown / logoff handling ──────────────────────────
  if (isWindows) {
    app.on('session-end', () => {
      isQuitting = true;
      if (tray) {
        tray.destroy();
        tray = null;
      }
    });
  }

  // ── Power state changes ─────────────────────────────────────────
  powerMonitor.on('suspend', () => {
    logger.info('System suspending');
  });

  powerMonitor.on('resume', () => {
    logger.info('System resuming');
  });

  // ── Uncaught exception logging ──────────────────────────────────
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', error);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', reason);
  });
}

// ── Public API for IPC (exposed via preload) ────────────────────────

export { APP_NAME, IS_DEV, quitApp, showMainWindow };
