/**
 * Approval cache — prevents double-confirmation when user already approved
 * via WeChat. Subsequent related tool calls within APPROVAL_WINDOW_MS are
 * auto-allowed without sending another WeChat message.
 *
 * Stores state at ~/.claude-to-im/runtime/approval-cache.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { CTI_HOME } from './weixin-client.mjs';

const CACHE_FILE = path.join(CTI_HOME, 'runtime', 'approval-cache.json');
const APPROVAL_WINDOW_MS = 60_000; // 60 seconds

function load() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function save(data) {
  const dir = path.dirname(CACHE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(data));
}

/**
 * Record that the user approved a decision.
 * @param {'ask-user'|'danger-guard'} source — which hook recorded the approval
 * @param {string} description — operation description for matching
 * @param {string} cwd — project directory
 */
export function recordApproval(source, description, cwd) {
  const data = load();
  const key = `${source}::${cwd || 'global'}`;
  data[key] = {
    source,
    description,
    cwd,
    timestamp: Date.now(),
  };
  // Also set a global key for any-source matching
  data['any::global'] = {
    source: 'any',
    description,
    cwd,
    timestamp: Date.now(),
  };
  save(data);
}

/**
 * Check if there's a recent approval that covers this operation.
 * @param {string} description — current operation description
 * @param {string} cwd — project directory
 * @returns {boolean}
 */
export function hasRecentApproval(description, cwd) {
  const data = load();
  const now = Date.now();

  // Check all entries
  for (const [key, entry] of Object.entries(data)) {
    if (now - entry.timestamp > APPROVAL_WINDOW_MS) continue;
    // Match: same project directory, or global approval
    if (entry.cwd === cwd || entry.cwd === 'global' || key === 'any::global') {
      return true;
    }
  }
  return false;
}

/**
 * Get info about the most recent approval for logging.
 * @returns {{source:string, description:string, ageMs:number}|null}
 */
export function getLastApproval() {
  const data = load();
  const now = Date.now();
  let best = null;
  for (const [, entry] of Object.entries(data)) {
    const age = now - entry.timestamp;
    if (age > APPROVAL_WINDOW_MS) continue;
    if (!best || entry.timestamp > best.timestamp) {
      best = { ...entry, ageMs: age };
    }
  }
  return best;
}

/** Clear expired entries. Called periodically. */
export function cleanup() {
  const data = load();
  const now = Date.now();
  let changed = false;
  for (const [key, entry] of Object.entries(data)) {
    if (now - entry.timestamp > APPROVAL_WINDOW_MS) {
      delete data[key];
      changed = true;
    }
  }
  if (changed) save(data);
}