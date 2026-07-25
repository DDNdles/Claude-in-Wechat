/**
 * IPC Handler Registry v0.3
 * Clean, minimal handler registration.
 */

import type { BrowserWindow } from 'electron';
import { registerAllHandlers } from './all-handlers';
import { info } from '../utils/logger';

export function registerAllIpcHandlers(mainWindow: BrowserWindow): void {
  info('Registering IPC handlers...');
  registerAllHandlers(mainWindow);
  info('IPC handlers registered');
}

export function unregisterAllIpcHandlers(): void {
  // Handlers are cleaned up when app quits
}
