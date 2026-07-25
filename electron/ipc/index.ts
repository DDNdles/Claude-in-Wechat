/**
 * IPC Handler Registry
 * Central registration point for all IPC handlers.
 * Called from main.ts on app ready.
 */

import type { BrowserWindow } from 'electron';
import { registerProjectHandlers, unregisterProjectHandlers } from './project-handlers';
import { registerSettingsHandlers, registerAppHandlers } from './settings-handlers';
import { registerRelayHandlers, unregisterRelayHandlers } from './relay-handlers';
import { registerOrchestratorHandlers, unregisterOrchestratorHandlers } from './orchestrator-handlers';
import { info } from '../utils/logger';

/**
 * Register all IPC handlers. Call once on app startup.
 * @param mainWindow - The BrowserWindow for sending push events
 */
export function registerAllIpcHandlers(mainWindow: BrowserWindow): void {
  info('Registering all IPC handlers...');

  registerProjectHandlers();
  registerSettingsHandlers();
  registerAppHandlers();
  registerRelayHandlers(mainWindow);
  registerOrchestratorHandlers(mainWindow);

  info('All IPC handlers registered');
}

/**
 * Remove all IPC handlers. Call on app quit.
 */
export function unregisterAllIpcHandlers(): void {
  unregisterProjectHandlers();
  unregisterRelayHandlers();
  unregisterOrchestratorHandlers();
  // Settings handlers have no cleanup (stateless)
}
