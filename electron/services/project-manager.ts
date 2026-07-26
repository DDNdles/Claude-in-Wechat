// ═══════════════════════════════════════════════════════════════════════════
// Project Manager Service v0.3
// Real filesystem CRUD at ~/projects/Wechat/
// Registry stored at ~/.claude-in-wechat/projects.json
// ═══════════════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { execSync } from 'node:child_process';
import type {
  Project,
  ProjectStatus,
  IpcResponse,
  TaskItem,
} from '../../shared/types.js';

import {
  PROJECTS_DIR,
  REGISTRY_FILE,
  RUNTIME_DIR,
  projectProgressFile,
  ACTIVE_PROJECT_FILE,
} from '../utils/paths.js';

import { info, warn, error, debug } from '../utils/logger.js';
import { refreshProjectProgress } from './progress-watcher.js';

const HOME = os.homedir();

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const MAX_NAME_LENGTH = 50;
const ILLEGAL_NAME_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;
const SPACE_RUN = /\s+/g;

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

export function generateId(): string {
  return crypto.randomUUID();
}

export function sanitizeProjectName(name: string): string {
  let cleaned = name.replace(ILLEGAL_NAME_CHARS, '');
  cleaned = cleaned.replace(SPACE_RUN, '-');
  cleaned = cleaned.replace(/^-+|-+$/g, '');
  if (cleaned.length > MAX_NAME_LENGTH) cleaned = cleaned.slice(0, MAX_NAME_LENGTH);
  return cleaned || 'untitled';
}

function ensureDataDirs(): void {
  for (const dir of [PROJECTS_DIR, RUNTIME_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
  const registryDir = path.dirname(REGISTRY_FILE);
  if (!fs.existsSync(registryDir)) fs.mkdirSync(registryDir, { recursive: true });
}

function readRegistry(): Project[] {
  try {
    ensureDataDirs();
    if (!fs.existsSync(REGISTRY_FILE)) return [];
    const raw = fs.readFileSync(REGISTRY_FILE, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) { warn('Registry not an array — resetting'); return []; }
    return parsed as Project[];
  } catch (err) { error('Failed to read registry', err); return []; }
}

function writeRegistry(projects: Project[]): void {
  try {
    ensureDataDirs();
    const tmp = REGISTRY_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(projects, null, 2), 'utf-8');
    fs.renameSync(tmp, REGISTRY_FILE);
    debug(`Registry written — ${projects.length} project(s)`);
  } catch (err) { error('Failed to write registry', err); throw err; }
}

function projectPath(name: string): string {
  return path.join(PROJECTS_DIR, name);
}

function isProcessAlive(pid: number): boolean {
  try {
    if (process.platform === 'win32') {
      const result = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, {
        encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true,
      });
      return result.includes(`"${pid}"`);
    }
    process.kill(pid, 0);
    return true;
  } catch { return false; }
}

/** Check if Claude CLI is available */
function claudeAvailable(): boolean {
  try { execSync('claude --version', { stdio: 'ignore' }); return true; }
  catch { return false; }
}

// ═══════════════════════════════════════════════════════════════════════════
// Public API — all functions are synchronous, return IpcResponse
// ═══════════════════════════════════════════════════════════════════════════

export function listProjects(): Project[] {
  const projects = readRegistry();
  const result: Project[] = [];

  for (const proj of projects) {
    const live = { ...proj };

    // Check if tracked PID is still alive
    if (live.pid) {
      if (!isProcessAlive(live.pid)) {
        live.status = 'idle';
        live.pid = undefined;
        live.lastOutput = undefined;
      }
    }

    // Verify project folder exists
    if (!fs.existsSync(live.path)) {
      live.status = live.status === 'running' ? 'error' : live.status;
    }

    // Real-time progress from session jsonl (for running/desktop projects)
    if (live.status === 'running' || live.launchMode === 'desktop') {
      try {
        const rtProgress = refreshProjectProgress(live.id, live.path);
        if (rtProgress.toolUseCount > 0) {
          live.progress = rtProgress.progress;
          // If session is active but status is idle, mark as running
          if (rtProgress.sessionActive && live.status === 'idle') {
            live.status = 'running';
          }
        }
      } catch { /* progress watcher shouldn't break list */ }
    }

    result.push(live);
  }

  // Persist corrections
  writeRegistry(result);
  return result;
}

export function createProject(name: string): IpcResponse<Project> {
  try {
    const sanitized = sanitizeProjectName(name);
    const existing = readRegistry();
    if (existing.some((p) => p.name.toLowerCase() === sanitized.toLowerCase())) {
      return { success: false, error: `项目 "${sanitized}" 已存在` };
    }

    const dir = projectPath(sanitized);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const now = new Date().toISOString();
    const project: Project = {
      id: generateId(),
      name: sanitized,
      path: dir,
      status: 'idle',
      progress: 0,
      tasks: [],
      sessionTokens: 0,
      dailyTokens: 0,
      createdAt: now,
      lastActiveAt: now,
      launchMode: 'wechat',
    };

    existing.push(project);
    writeRegistry(existing);
    info(`Created project: ${sanitized} (${project.id})`);
    return { success: true, data: project };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    error('createProject failed', err);
    return { success: false, error: msg };
  }
}

export function deleteProject(id: string): IpcResponse<void> {
  try {
    const projects = readRegistry();
    const idx = projects.findIndex((p) => p.id === id);
    if (idx === -1) return { success: false, error: `项目 ${id} 不存在` };

    const proj = projects[idx];

    // Kill running process if tracked
    if (proj.pid && isProcessAlive(proj.pid)) {
      try {
        if (process.platform === 'win32') {
          execSync(`taskkill /PID ${proj.pid} /T /F 2>nul`, { stdio: 'ignore' });
        } else {
          process.kill(proj.pid, 'SIGTERM');
        }
      } catch { /* already dead */ }
    }

    projects.splice(idx, 1);
    writeRegistry(projects);
    info(`Deleted project: ${proj.name} (${id}) — folder preserved at ${proj.path}`);
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    error('deleteProject failed', err);
    return { success: false, error: msg };
  }
}

export function renameProject(id: string, newName: string): IpcResponse<Project> {
  try {
    const sanitized = sanitizeProjectName(newName);
    const projects = readRegistry();
    const idx = projects.findIndex((p) => p.id === id);
    if (idx === -1) return { success: false, error: `项目 ${id} 不存在` };

    if (projects.some((p) => p.id !== id && p.name.toLowerCase() === sanitized.toLowerCase())) {
      return { success: false, error: `项目 "${sanitized}" 已存在` };
    }

    const proj = projects[idx];
    const oldDir = proj.path;
    const newDir = projectPath(sanitized);

    if (fs.existsSync(oldDir) && oldDir !== newDir) {
      fs.renameSync(oldDir, newDir);
    }

    proj.name = sanitized;
    proj.path = newDir;
    proj.lastActiveAt = new Date().toISOString();
    projects[idx] = proj;
    writeRegistry(projects);
    info(`Renamed project: ${id} → ${sanitized}`);
    return { success: true, data: proj };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    error('renameProject failed', err);
    return { success: false, error: msg };
  }
}

export function getProject(id: string): IpcResponse<Project> {
  try {
    const projects = readRegistry();
    const proj = projects.find((p) => p.id === id);
    if (!proj) return { success: false, error: `项目 ${id} 不存在` };
    return { success: true, data: proj };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    error('getProject failed', err);
    return { success: false, error: msg };
  }
}

/**
 * Open/activate a project — marks it as active and running.
 * The actual terminal window is opened by the frontend via claude-launcher.
 */
export function openProject(id: string): IpcResponse<Project> {
  try {
    const projects = readRegistry();
    const idx = projects.findIndex((p) => p.id === id);
    if (idx === -1) return { success: false, error: `项目 ${id} 不存在` };

    const proj = projects[idx];

    if (!claudeAvailable()) {
      return { success: false, error: '未找到 Claude CLI，请确认已安装 Claude Code' };
    }

    if (!fs.existsSync(proj.path)) {
      fs.mkdirSync(proj.path, { recursive: true });
      warn(`Project folder re-created: ${proj.path}`);
    }

    // Mark as running and active
    proj.status = 'running';
    proj.lastActiveAt = new Date().toISOString();
    proj.launchMode = 'desktop';

    // Set as active project
    ensureDataDirs();
    fs.writeFileSync(ACTIVE_PROJECT_FILE, JSON.stringify({ projectId: id }), 'utf-8');

    projects[idx] = proj;
    writeRegistry(projects);
    info(`Project activated: ${proj.name}`);
    return { success: true, data: proj };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    error('openProject failed', err);
    return { success: false, error: msg };
  }
}

export function updateProjectStatus(
  id: string, status: ProjectStatus, progress?: number, tasks?: TaskItem[],
): IpcResponse<Project> {
  try {
    const projects = readRegistry();
    const idx = projects.findIndex((p) => p.id === id);
    if (idx === -1) return { success: false, error: `项目 ${id} 不存在` };

    const proj = projects[idx];
    proj.status = status;
    if (progress !== undefined) proj.progress = Math.max(0, Math.min(100, Math.round(progress)));
    if (tasks !== undefined) {
      proj.tasks = tasks;
      proj.totalSteps = tasks.length;
      proj.currentStep = tasks.filter((t) => t.status === 'completed').length;
    }
    proj.lastActiveAt = new Date().toISOString();
    projects[idx] = proj;
    writeRegistry(projects);
    debug(`Updated project ${id}: status=${status}, progress=${proj.progress}`);
    return { success: true, data: proj };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    error('updateProjectStatus failed', err);
    return { success: false, error: msg };
  }
}

export function updateTokenUsage(
  id: string, sessionTokens: number, dailyTokens: number,
): IpcResponse<Project> {
  try {
    const projects = readRegistry();
    const idx = projects.findIndex((p) => p.id === id);
    if (idx === -1) return { success: false, error: `项目 ${id} 不存在` };
    const proj = projects[idx];
    proj.sessionTokens = sessionTokens;
    proj.dailyTokens = dailyTokens;
    proj.lastActiveAt = new Date().toISOString();
    projects[idx] = proj;
    writeRegistry(projects);
    return { success: true, data: proj };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    error('updateTokenUsage failed', err);
    return { success: false, error: msg };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Active project management
// ═══════════════════════════════════════════════════════════════════════════

export function getActiveProject(): IpcResponse<Project | null> {
  try {
    ensureDataDirs();
    if (!fs.existsSync(ACTIVE_PROJECT_FILE)) return { success: true, data: null };
    const raw = fs.readFileSync(ACTIVE_PROJECT_FILE, 'utf-8');
    const data = JSON.parse(raw) as { projectId: string };
    const projects = readRegistry();
    const proj = projects.find((p) => p.id === data.projectId);
    return { success: true, data: proj || null };
  } catch (err) {
    return { success: false, error: String(err), data: null };
  }
}

export function setActiveProject(id: string): IpcResponse<void> {
  try {
    ensureDataDirs();
    const projects = readRegistry();
    if (!projects.some((p) => p.id === id)) {
      return { success: false, error: `项目 ${id} 不存在` };
    }
    fs.writeFileSync(ACTIVE_PROJECT_FILE, JSON.stringify({ projectId: id }), 'utf-8');
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Progress & Token helpers
// ═══════════════════════════════════════════════════════════════════════════

export function readProgress(projectId: string): IpcResponse<{ progress: number; currentStep?: number; totalSteps?: number }> {
  try {
    const projects = readRegistry();
    const proj = projects.find((p) => p.id === projectId);
    if (!proj) return { success: false, error: `项目 ${projectId} 不存在` };
    return { success: true, data: { progress: proj.progress || 0, currentStep: proj.currentStep, totalSteps: proj.totalSteps } };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export function getTokenUsage(projectId: string): IpcResponse<{ sessionTokens: number; dailyTokens: number }> {
  try {
    const projects = readRegistry();
    const proj = projects.find((p) => p.id === projectId);
    if (!proj) return { success: false, error: `项目 ${projectId} 不存在` };
    return { success: true, data: { sessionTokens: proj.sessionTokens || 0, dailyTokens: proj.dailyTokens || 0 } };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export function updateProjectProgress(id: string, progress: number, tasks?: TaskItem[]): IpcResponse<Project> {
  return updateProjectStatus(id, 'running', progress, tasks);
}

export function writeProgressSnapshot(projectId: string, data: Project): void {
  try {
    ensureDataDirs();
    fs.writeFileSync(projectProgressFile(projectId), JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) { warn(`Failed to write progress for ${projectId}`, err); }
}

export function updateRegistryEntry(id: string, updated: Project): void {
  const projects = readRegistry();
  const idx = projects.findIndex((p) => p.id === id);
  if (idx === -1) return;
  projects[idx] = updated;
  writeRegistry(projects);
}

export function isProjectRunning(id: string): boolean {
  const projects = readRegistry();
  const proj = projects.find((p) => p.id === id);
  if (proj?.pid && isProcessAlive(proj.pid)) return true;
  return false;
}

/** Persist sessionId and pid for a project (called after launching terminal) */
export function setProjectSession(id: string, sessionId: string, pid?: number): void {
  const projects = readRegistry();
  const idx = projects.findIndex((p) => p.id === id);
  if (idx === -1) return;
  projects[idx].sessionId = sessionId;
  if (pid !== undefined) projects[idx].pid = pid;
  writeRegistry(projects);
}

// External project auto-sync via Claude session jsonl scan

export interface ScannedProject {
  cwd: string;
  name: string;
  sessionId: string;
  lastActiveAt: string;
}

const CLAUDE_PROJECTS_DIR = path.join(HOME, '.claude', 'projects');

/** Decode Claude's encoded project dir name back to a real path.
 *  e.g. "C--Users-30959--foo" -> "C:\Users\30959\foo" */
function decodeCwd(encoded: string): string {
  // Claude encodes by replacing : \ / with -, yielding e.g. C--Users-30959--foo
  // The first char is the drive letter, then "--", then path segments joined by "--"
  // Reconstruct: first char + ":" + "\" + rest with "--" -> "\"
  if (encoded.length < 2) return encoded;
  const drive = encoded[0];
  const rest = encoded.slice(1).replace(/^-+/, '').replace(/-+/g, '\\');
  return `${drive}:\\${rest}`;
}

/**
 * Scan ~/.claude/projects/* for session jsonls.
 * Each subdirectory = one project cwd; newest jsonl = active session.
 * Returns projects not yet in the registry.
 */
export function scanExternalProjects(): ScannedProject[] {
  try {
    if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) return [];

    const registered = readRegistry();
    const knownPaths = new Set(registered.map(p => p.path.toLowerCase()));

    const discovered: ScannedProject[] = [];

    const dirs = fs.readdirSync(CLAUDE_PROJECTS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory());

    for (const d of dirs) {
      const dirPath = path.join(CLAUDE_PROJECTS_DIR, d.name);
      try {
        const jsonls = fs.readdirSync(dirPath)
          .filter(f => f.endsWith('.jsonl'))
          .map(f => ({
            name: f,
            mtime: fs.statSync(path.join(dirPath, f)).mtimeMs,
          }))
          .sort((a, b) => b.mtime - a.mtime);

        if (jsonls.length === 0) continue;

        const cwd = decodeCwd(d.name);
        // Only consider dirs that actually exist on disk (real projects)
        if (!fs.existsSync(cwd)) continue;
        if (knownPaths.has(cwd.toLowerCase())) continue;

        // Only import if the session was active recently (last 7 days)
        const newest = jsonls[0];
        const ageDays = (Date.now() - newest.mtime) / (1000 * 60 * 60 * 24);
        if (ageDays > 7) continue;

        discovered.push({
          cwd,
          name: path.basename(cwd),
          sessionId: newest.name.replace(/\.jsonl$/, ''),
          lastActiveAt: new Date(newest.mtime).toISOString(),
        });
      } catch { /* skip unreadable dir */ }
    }

    return discovered;
  } catch (err) {
    warn('Failed to scan external projects', err);
    return [];
  }
}

/** Auto-import discovered external projects into the registry. */
export function importExternalProjects(discovered: ScannedProject[]): Project[] {
  const imported: Project[] = [];
  const projects = readRegistry();
  const now = new Date().toISOString();

  for (const ext of discovered) {
    try {
      // Double-check not already present (race safety)
      if (projects.some(p => p.path.toLowerCase() === ext.cwd.toLowerCase())) continue;

      const project: Project = {
        id: generateId(),
        name: ext.name,
        path: ext.cwd,
        status: 'idle',
        progress: 0,
        tasks: [],
        sessionTokens: 0,
        dailyTokens: 0,
        sessionId: ext.sessionId,
        createdAt: ext.lastActiveAt,
        lastActiveAt: ext.lastActiveAt,
        launchMode: 'desktop',
      };

      projects.push(project);
      imported.push(project);
      info(`Auto-imported external project: ${ext.name} (session=${ext.sessionId.slice(0, 8)})`);
    } catch (err) {
      warn(`Failed to import external project: ${ext.name}`, err);
    }
  }

  if (imported.length > 0) writeRegistry(projects);
  return imported;
}

/**
 * Sync external project states: refresh sessionId from latest jsonl,
 * mark projects whose session hasn't been touched in 7 days as idle.
 */
export function syncExternalProjectStates(): number {
  let changed = 0;
  const projects = readRegistry();

  for (const proj of projects) {
    if (proj.launchMode !== 'desktop') continue;
    try {
      const encoded = proj.path.replace(/[:\\\/]/g, '-').replace(/^-+|-+$/g, '');
      const dir = path.join(CLAUDE_PROJECTS_DIR, encoded);
      if (!fs.existsSync(dir)) continue;

      const jsonls = fs.readdirSync(dir)
        .filter(f => f.endsWith('.jsonl'))
        .map(f => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);

      if (jsonls.length === 0) continue;

      const newest = jsonls[0];
      const newSid = newest.name.replace(/\.jsonl$/, '');
      const ageDays = (Date.now() - newest.mtime) / (1000 * 60 * 60 * 24);

      // Update sessionId if it changed
      if (proj.sessionId !== newSid) {
        proj.sessionId = newSid;
        proj.lastActiveAt = new Date(newest.mtime).toISOString();
        changed++;
      }
      // Mark idle if stale
      if (ageDays > 7 && proj.status === 'running') {
        proj.status = 'idle';
        changed++;
      } else if (ageDays < 1 && proj.status === 'idle') {
        proj.status = 'running';
        changed++;
      }
    } catch { /* skip */ }
  }

  if (changed > 0) {
    writeRegistry(projects);
    info(`Synced ${changed} external project state(s)`);
  }
  return changed;
}
