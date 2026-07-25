/**
 * Simple file logger with rotation.
 * Writes to ~/.claude-in-wechat/logs/
 */

import fs from 'node:fs';
import path from 'node:path';
import { LOG_DIR } from './paths';

const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_LOG_FILES = 5;

let logFile: string | null = null;

function getLogFile(): string {
  if (!logFile) {
    const date = new Date().toISOString().slice(0, 10);
    logFile = path.join(LOG_DIR, `app-${date}.log`);
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
  }
  return logFile;
}

function rotateIfNeeded(): void {
  const file = getLogFile();
  try {
    const stat = fs.statSync(file);
    if (stat.size > MAX_LOG_SIZE) {
      for (let i = MAX_LOG_FILES - 1; i >= 0; i--) {
        const old = file.replace('.log', `.${i}.log`);
        const next = file.replace('.log', `.${i + 1}.log`);
        if (fs.existsSync(old)) {
          if (i === MAX_LOG_FILES - 1) {
            fs.unlinkSync(old);
          } else {
            fs.renameSync(old, next);
          }
        }
      }
      logFile = null; // Force new file name
    }
  } catch {
    // File doesn't exist yet, ok
  }
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let minLevel: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  minLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[minLevel];
}

function formatMessage(level: LogLevel, message: string, ...args: unknown[]): string {
  const timestamp = new Date().toISOString();
  const extra = args.length > 0 ? ' ' + args.map(a => {
    try { return typeof a === 'object' ? JSON.stringify(a) : String(a); }
    catch { return String(a); }
  }).join(' ') : '';
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${extra}`;
}

export function debug(msg: string, ...args: unknown[]): void {
  if (!shouldLog('debug')) return;
  const line = formatMessage('debug', msg, ...args);
  console.debug(line);
  writeToFile(line);
}

export function info(msg: string, ...args: unknown[]): void {
  if (!shouldLog('info')) return;
  const line = formatMessage('info', msg, ...args);
  console.log(line);
  writeToFile(line);
}

export function warn(msg: string, ...args: unknown[]): void {
  if (!shouldLog('warn')) return;
  const line = formatMessage('warn', msg, ...args);
  console.warn(line);
  writeToFile(line);
}

export function error(msg: string, ...args: unknown[]): void {
  const line = formatMessage('error', msg, ...args);
  console.error(line);
  writeToFile(line);
}

function writeToFile(line: string): void {
  try {
    rotateIfNeeded();
    fs.appendFileSync(getLogFile(), line + '\n', 'utf-8');
  } catch {
    // Best effort — don't crash because logging failed
  }
}
