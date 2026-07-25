/**
 * Claude in WeChat v0.5.0 — Electron main process.
 *
 * - Single instance lock
 * - BrowserWindow with tray icon
 * - Auto-start management
 * - Auto-update via electron-updater (GitHub Releases)
 * - IPC handler registration
 * - WeChat relay service
 * - Window close → minimize-to-tray
 */

import {
  app, BrowserWindow, Tray, Menu, shell, nativeImage, powerMonitor,
} from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import pkg from 'electron-updater';
const { autoUpdater } = pkg;
import * as logger from './utils/logger';
import { ensureDirs } from './utils/paths';
import { isWindows } from './utils/platform';
import { registerAllIpcHandlers } from './ipc/index';
import { createConfigService } from './services/config-service';
import { AutoStarter } from './services/auto-starter';
import { start as startRelay, stop as stopRelay, setMainWindow } from './services/relay-service';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const APP_NAME = 'ClaudeInWechat';
const DEV_SERVER_URL = 'http://localhost:5173';
const IS_DEV = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

// ── Tray Icon ──────────────────────────────────────────────────────

function createTrayIcon() {
  const iconPath = path.join(__dirname, '..', 'assets', 'tray-icon.png');
  if (fs.existsSync(iconPath)) {
    return nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  }
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  const cx = 8, cy = 8, r = 6;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx + 0.5, dy = y - cy + 0.5;
      if (dx * dx + dy * dy <= r * r) {
        const idx = (y * size + x) * 4;
        buf[idx] = 64; buf[idx + 1] = 128; buf[idx + 2] = 240; buf[idx + 3] = 255;
      }
    }
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}

/**
 * In dev mode (not packaged), ALWAYS connect to the Vite dev server.
 * Only load from dist/ when running as a packaged production app.
 */
function resolveEntryHtml(): string {
  if (IS_DEV) return DEV_SERVER_URL;
  // Production: load from built dist/
  return path.join(__dirname, '..', 'dist', 'index.html');
}

// ── Window ─────────────────────────────────────────────────────────

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200, height: 800, minWidth: 900, minHeight: 600,
    show: false, frame: true, title: 'Claude in WeChat',
    backgroundColor: '#0f0f0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false, contextIsolation: true, sandbox: false, webSecurity: true,
    },
  });

  win.once('ready-to-show', () => {
    if (!isQuitting) {
      win.show();
      if (IS_DEV) win.webContents.openDevTools({ mode: 'detach' });
    }
  });

  win.on('close', async (event) => {
    if (!isQuitting) {
      const configService = createConfigService();
      const settings = configService.getAll();
      if (settings.minimizeToTray) { event.preventDefault(); win.hide(); return; }
    }
    mainWindow = null;
  });

  win.on('closed', () => { mainWindow = null; });

  if (!IS_DEV) {
    win.webContents.on('context-menu', (event) => event.preventDefault());
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

// ── Tray ───────────────────────────────────────────────────────────

function createTray(): Tray {
  const t = new Tray(createTrayIcon());
  t.setToolTip('Claude in WeChat');
  t.setContextMenu(Menu.buildFromTemplate([
    { label: '显示主窗口', click: () => showMainWindow() },
    { type: 'separator' },
    { label: '退出', click: () => quitApp() },
  ]));
  t.on('double-click', () => showMainWindow());
  return t;
}

function showMainWindow(): void {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else {
    mainWindow = createMainWindow();
    // Re-register on re-create
    registerAllIpcHandlers(mainWindow);
    setMainWindow(mainWindow);
    loadWindowContent(mainWindow);
  }
}

async function loadWindowContent(win: BrowserWindow): Promise<void> {
  const entryUrl = resolveEntryHtml();
  if (IS_DEV) {
    // Dev: always connect to Vite dev server
    try {
      await win.loadURL(entryUrl);
    } catch (err) {
      logger.error('Failed to load Vite dev server — is it running?', err);
    }
  } else {
    // Production: load built HTML file
    await win.loadFile(entryUrl);
  }
}

// ── App lifecycle ──────────────────────────────────────────────────

function quitApp(): void {
  isQuitting = true;
  try { stopRelay(); } catch { /* cleanup */ }
  if (tray) { tray.destroy(); tray = null; }
  if (mainWindow) { mainWindow.destroy(); mainWindow = null; }
  app.quit();
}

async function onAppReady(): Promise<void> {
  ensureDirs();

  // 1. Create window FIRST
  mainWindow = createMainWindow();

  // 2. THEN register IPC handlers (window must exist)
  registerAllIpcHandlers(mainWindow);

  // 3. Set up relay
  setMainWindow(mainWindow);

  // Auto-start check
  const configService = createConfigService();
  const autoStarter = new AutoStarter(APP_NAME);
  try {
    const settings = configService.getAll();
    if (settings.autoStart) {
      if (!autoStarter.isEnabled()) autoStarter.enable();
    } else {
      if (autoStarter.isEnabled()) autoStarter.disable();
    }
  } catch (err) { logger.warn('Could not sync auto-start', err); }

  // 4. Create tray
  tray = createTray();

  // 5. Start relay
  try {
    startRelay();
    logger.info('WeChat relay service auto-started');
  } catch (err) {
    logger.warn('Could not auto-start relay service', err);
  }

  // 6. Load content
  await loadWindowContent(mainWindow);

  // 7. Check for updates (production only)
  if (!IS_DEV) {
    autoUpdater.checkForUpdatesAndNotify();
    logger.info("Auto-update check initiated");
  }
}

// ── Single instance ────────────────────────────────────────────────

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => showMainWindow());
  app.whenReady().then(onAppReady);
  app.on('window-all-closed', () => { /* keep alive for tray */ });
  app.on('activate', () => {
    if (mainWindow === null) {
      mainWindow = createMainWindow();
      registerAllIpcHandlers(mainWindow);
      setMainWindow(mainWindow);
      loadWindowContent(mainWindow);
    } else {
      showMainWindow();
    }
  });
  app.on('before-quit', () => {
    isQuitting = true;
    try { stopRelay(); } catch { /* cleanup */ }
    if (tray) { tray.destroy(); tray = null; }
  });
  if (isWindows) {
    (app as any).on('session-end', () => {
      isQuitting = true;
      try { stopRelay(); } catch { /* cleanup */ }
      if (tray) { tray.destroy(); tray = null; }
    });
  }
  powerMonitor.on('suspend', () => logger.info('System suspending'));
  powerMonitor.on('resume', () => logger.info('System resuming'));
  process.on('uncaughtException', (error) => logger.error('Uncaught exception', error));
  process.on('unhandledRejection', (reason) => logger.error('Unhandled rejection', reason));
}