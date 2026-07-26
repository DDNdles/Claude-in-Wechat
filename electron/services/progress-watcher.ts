/**
 * Progress Watcher — real-time progress from Claude session jsonl.
 * Scans the latest session jsonl, counts tool_use events as progress proxy.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { debug } from '../utils/logger';

const HOME = os.homedir();
const CLAUDE_PROJECTS_DIR = path.join(HOME, '.claude', 'projects');

export interface ProjectProgress {
  progress: number;
  toolUseCount: number;
  sessionActive: boolean;
}

const cache = new Map<string, ProjectProgress>();
const cacheTime = new Map<string, number>();

function encodeCwd(cwd: string): string {
  return cwd.replace(/[:\\\/]/g, '-').replace(/^-+|-+$/g, '');
}

export function refreshProjectProgress(projectId: string, cwd: string): ProjectProgress {
  const result: ProjectProgress = { progress: 0, toolUseCount: 0, sessionActive: false };

  try {
    const encoded = encodeCwd(cwd);
    const dir = path.join(CLAUDE_PROJECTS_DIR, encoded);
    if (!fs.existsSync(dir)) return result;

    const jsonls = fs.readdirSync(dir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);

    if (jsonls.length === 0) return result;

    const ageSec = (Date.now() - jsonls[0].mtime) / 1000;
    result.sessionActive = ageSec < 300; // active = written in last 5 min

    const filePath = path.join(dir, jsonls[0].name);
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    let toolUses = 0;
    for (const line of lines) {
      if (line.includes('"type":"tool_use"')) toolUses++;
    }
    result.toolUseCount = toolUses;
    result.progress = Math.min(95, Math.max(0, toolUses * 5));

    cache.set(projectId, result);
    cacheTime.set(projectId, Date.now());
    return result;
  } catch (err) {
    debug(`Progress refresh failed for ${projectId}: ${err}`);
    return result;
  }
}

export function getProjectProgress(projectId: string, cwd: string): ProjectProgress {
  const cached = cache.get(projectId);
  const lastTime = cacheTime.get(projectId) || 0;
  // Refresh if no cache, or stale (> 3s) and session was active
  if (!cached || (cached.sessionActive && Date.now() - lastTime > 3000)) {
    return refreshProjectProgress(projectId, cwd);
  }
  return cached;
}