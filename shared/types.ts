// ═══════════════════════════════════════════════════════════════
// Shared types — used by both Electron main process and React renderer
// ═══════════════════════════════════════════════════════════════

/** IPC channel names — single source of truth */
export const IPC_CHANNELS = {
  // Project operations
  PROJECT_LIST: 'project:list',
  PROJECT_CREATE: 'project:create',
  PROJECT_DELETE: 'project:delete',
  PROJECT_RENAME: 'project:rename',
  PROJECT_OPEN: 'project:open',
  PROJECT_GET: 'project:get',
  PROJECT_UPDATE: 'project:update',

  // Relay
  RELAY_STATUS: 'relay:status',
  RELAY_START: 'relay:start',
  RELAY_STOP: 'relay:stop',
  RELAY_MESSAGE: 'relay:message',

  // Orchestrator
  CC_START: 'cc:start',
  CC_STOP: 'cc:stop',
  CC_STATUS: 'cc:status',
  CC_OUTPUT: 'cc:output',
  CC_OPEN_TERMINAL: 'cc:open-terminal',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_GET_ALL: 'settings:getAll',
  SETUP_WECHAT: 'setup:wechat',
  SETUP_HOOKS: 'setup:hooks',

  // App
  APP_GET_VERSION: 'app:getVersion',
  APP_MINIMIZE_TO_TRAY: 'app:minimizeToTray',
  APP_QUIT: 'app:quit',
} as const;

/** Project status enum */
export type ProjectStatus = 'idle' | 'running' | 'completed' | 'error' | 'waiting';

/** Task item within a project */
export interface TaskItem {
  id: string;
  subject: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string;
}

/** Project data model */
export interface Project {
  id: string;
  name: string;
  path: string;
  status: ProjectStatus;
  progress: number;        // 0-100
  currentStep?: number;
  totalSteps?: number;
  tasks: TaskItem[];       // Parsed Claude task list
  sessionTokens: number;   // Current session tokens
  dailyTokens: number;     // Today total tokens
  pid?: number;            // Claude process PID if running
  createdAt: string;       // ISO timestamp
  lastActiveAt: string;    // ISO timestamp
  launchMode: 'wechat' | 'desktop';
  lastOutput?: string;     // Most recent Claude output (truncated)
}

/** Relay (WeChat connection) status */
export interface RelayStatus {
  connected: boolean;
  accountId?: string;
  polling: boolean;
  lastPollAt?: string;
  messagesToday: number;
  errors: number;
}

/** App settings */
export interface AppSettings {
  wechatEnabled: boolean;
  projectDir: string;         // Default: ~/projects/Wechat
  pollInterval: number;       // Seconds, default 5
  autoStart: boolean;         // Windows startup
  minimizeToTray: boolean;
  notifyOnComplete: boolean;
  maxOutputLength: number;    // Max chars sent to WeChat
  theme: 'dark' | 'light' | 'system';
}

/** WeChat account info (mirrors weixin-accounts.json) */
export interface WeChatAccount {
  token: string;
  baseUrl: string;
  userId: string;
  accountId: string;
  name?: string;
}

/** IPC response envelope */
export interface IpcResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/** WeChat message (inbound) */
export interface WeChatMessage {
  text: string;
  fromUserId: string;
  timestamp: number;
  msgId?: string;
}

/** Relay event pushed from main to renderer */
export interface RelayEvent {
  type: 'message_received' | 'message_sent' | 'status_change' | 'error' | 'command_handled';
  data?: unknown;
  timestamp: string;
}

/** Orchestrator event pushed from main to renderer */
export interface OrchestratorEvent {
  type: 'output' | 'progress' | 'status_change' | 'task_update' | 'error';
  projectId: string;
  data?: unknown;
  timestamp: string;
}
