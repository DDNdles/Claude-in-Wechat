// ═══════════════════════════════════════════════════════════════════════════
// Project Manager Service
// Complete CRUD service managing projects at ~/projects/Wechat/
// ═══════════════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import {
  Project,
  ProjectStatus,
  IpcResponse,
  type TaskItem,
} from '../../shared/types.js';

import {
  PROJECTS_DIR,
  REGISTRY_FILE,
  RUNTIME_DIR,
  projectProgressFile,
} from '../utils/paths.js';

import { info, warn, error, debug } from '../utils/logger.js';

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const MAX_NAME_LENGTH = 50;
const ILLEGAL_NAME_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;
const SPACE_RUN = /\s+/g;
const MAX_LAST_OUTPUT_LENGTH = 200;

// ═══════════════════════════════════════════════════════════════════════════
// In-memory process registry (survives across calls within the same session)
// ═══════════════════════════════════════════════════════════════════════════

const runningProcesses = new Map<string, ChildProcess>();

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

/** Generate a version-4 UUID via the Web Crypto API (available in Node 20+) */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Sanitize a project name for use as a filesystem directory name:
 * - Strip illegal filesystem characters
 * - Replace runs of whitespace with a single hyphen
 * - Trim leading/trailing hyphens
 * - Limit to 50 characters
 * - Fall back to 'untitled' if the result is empty
 */
export function sanitizeProjectName(name: string): string {
  let cleaned = name.replace(ILLEGAL_NAME_CHARS, '');
  cleaned = cleaned.replace(SPACE_RUN, '-');
  cleaned = cleaned.replace(/^-+|-+$/g, '');
  if (cleaned.length > MAX_NAME_LENGTH) {
    cleaned = cleaned.slice(0, MAX_NAME_LENGTH);
  }
  return cleaned || 'untitled';
}

/** Read the full registry array from disk (or return [] if missing / corrupt) */
function readRegistry(): Project[] {
  try {
    ensureDataDirs();
    if (!fs.existsSync(REGISTRY_FILE)) {
      return [];
    }
    const raw = fs.readFileSync(REGISTRY_FILE, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      warn('Registry file is not an array — resetting');
      return [];
    }
    return parsed as Project[];
  } catch (err) {
    error('Failed to read registry', err);
    return [];
  }
}

/** Atomically write the project registry to disk */
function writeRegistry(projects: Project[]): void {
  try {
    ensureDataDirs();
    const tmp = REGISTRY_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(projects, null, 2), 'utf-8');
    fs.renameSync(tmp, REGISTRY_FILE);
    debug(`Registry written — ${projects.length} project(s)`);
  } catch (err) {
    error('Failed to write registry', err);
    throw err;
  }
}

/** Ensure all required directories exist */
function ensureDataDirs(): void {
  for (const dir of [PROJECTS_DIR, RUNTIME_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  // Also ensure parent of REGISTRY_FILE exists
  const registryDir = path.dirname(REGISTRY_FILE);
  if (!fs.existsSync(registryDir)) {
    fs.mkdirSync(registryDir, { recursive: true });
  }
}

/** Check whether a PID refers to a running process */
function isProcessAlive(pid: number): boolean {
  try {
    if (process.platform === 'win32') {
      // On Windows, process.kill(pid, 0) does NOT throw for non-existent PIDs.
      // Use tasklist to verify the process actually exists.
      const result = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      });
      return result.includes(`"${pid}"`);
    }
    // On POSIX, signal 0 tests existence without actually sending a signal
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Read the progress JSON for a project (or null) */
function readProgressFile(projectId: string): Partial<Project> | null {
  try {
    const progressPath = projectProgressFile(projectId);
    if (!fs.existsSync(progressPath)) {
      return null;
    }
    const raw = fs.readFileSync(progressPath, 'utf-8');
    return JSON.parse(raw) as Partial<Project>;
  } catch {
    return null;
  }
}

/**
 * Kill a Claude process (and its children where possible).
 * Uses taskkill /T on Windows to terminate the process tree.
 */
function killProcess(pid: number): void {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${pid} /T /F 2>nul`, { stdio: 'ignore' });
    } else {
      process.kill(pid, 'SIGTERM');
      // Give it 2 seconds, then SIGKILL
      setTimeout(() => {
        try { process.kill(pid, 'SIGKILL'); } catch { /* already dead */ }
      }, 2000);
    }
    info(`Killed process ${pid}`);
  } catch (err) {
    warn(`Failed to kill process ${pid}`, err);
  }
}

/** Build the full project path for a given sanitized name */
function projectPath(name: string): string {
  return path.join(PROJECTS_DIR, name);
}

/** Check if Claude CLI is available on the system */
function claudeAvailable(): boolean {
  try {
    execSync('claude --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * List all projects with live status checks.
 * For each project:
 *  - Verify the Claude process is still running (if pid is set)
 *  - Merge any persisted progress data
 *  - Mark as 'idle' if the process died
 */
export function listProjects(): Project[] {
  const projects = readRegistry();
  const result: Project[] = [];

  for (const proj of projects) {
    const live = { ...proj };

    // Check whether a tracked PID is still alive
    if (live.pid) {
      if (isProcessAlive(live.pid) || runningProcesses.has(live.id)) {
        // Still running — merge the latest progress snapshot
        const progress = readProgressFile(live.id);
        if (progress) {
          Object.assign(live, progress);
        }
      } else {
        // Process died — mark idle and clear PID
        live.status = 'idle';
        live.pid = undefined;
        live.lastOutput = undefined;
      }
    }

    result.push(live);
  }

  // Persist any status corrections back to the registry
  writeRegistry(result);
  return result;
}

/**
 * Create a new project.
 * 1. Sanitize the name
 * 2. Create the folder on disk
 * 3. Add an entry to the registry
 * 4. Return the new project via IpcResponse
 */
export function createProject(name: string): IpcResponse<Project> {
  try {
    const sanitized = sanitizeProjectName(name);

    // Check for duplicate names
    const existing = readRegistry();
    if (existing.some((p) => p.name.toLowerCase() === sanitized.toLowerCase())) {
      return { success: false, error: `项目 "${sanitized}" 已存在` };
    }

    const dir = projectPath(sanitized);

    // Create project folder
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

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

/**
 * Delete a project.
 * - Kills any running Claude process for this project
 * - Removes the entry from the registry
 * - The project folder on disk is NOT deleted (data safety)
 */
export function deleteProject(id: string): IpcResponse<void> {
  try {
    const projects = readRegistry();
    const idx = projects.findIndex((p) => p.id === id);
    if (idx === -1) {
      return { success: false, error: `项目 ${id} 不存在` };
    }

    const proj = projects[idx];

    // Kill the Claude process if running
    if (proj.pid && isProcessAlive(proj.pid)) {
      killProcess(proj.pid);
    }
    // Clean up any tracked child process
    const child = runningProcesses.get(id);
    if (child) {
      try { child.kill('SIGTERM'); } catch { /* already dead */ }
      runningProcesses.delete(id);
    }

    projects.splice(idx, 1);
    writeRegistry(projects);
    info(`Deleted project: ${proj.name} (${id}) — folder preserved`);

    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    error('deleteProject failed', err);
    return { success: false, error: msg };
  }
}

/**
 * Rename a project.
 * - Renames the folder on disk
 * - Updates the registry entry (name + path)
 * - Updates project directory name
 */
export function renameProject(id: string, newName: string): IpcResponse<Project> {
  try {
    const sanitized = sanitizeProjectName(newName);
    const projects = readRegistry();
    const idx = projects.findIndex((p) => p.id === id);
    if (idx === -1) {
      return { success: false, error: `项目 ${id} 不存在` };
    }

    // Check for duplicate names (excluding self)
    if (projects.some((p) => p.id !== id && p.name.toLowerCase() === sanitized.toLowerCase())) {
      return { success: false, error: `项目 "${sanitized}" 已存在` };
    }

    const proj = projects[idx];
    const oldDir = proj.path;
    const newDir = projectPath(sanitized);

    // Rename folder on disk
    if (fs.existsSync(oldDir) && oldDir !== newDir) {
      fs.renameSync(oldDir, newDir);
    }

    proj.name = sanitized;
    proj.path = newDir;
    proj.lastActiveAt = new Date().toISOString();

    projects[idx] = proj;
    writeRegistry(projects);
    info(`Renamed project ${id}: ${sanitized}`);

    return { success: true, data: proj };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    error('renameProject failed', err);
    return { success: false, error: msg };
  }
}

/**
 * Get a single project by ID.
 */
export function getProject(id: string): IpcResponse<Project> {
  try {
    const projects = readRegistry();
    const proj = projects.find((p) => p.id === id);
    if (!proj) {
      return { success: false, error: `项目 ${id} 不存在` };
    }
    return { success: true, data: proj };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    error('getProject failed', err);
    return { success: false, error: msg };
  }
}

/**
 * Open / activate a project.
 * - Sets the project as active
 * - Updates lastActiveAt
 * - Sets launchMode to 'wechat'
 * - Spawns a Claude Code process inside the project directory
 * - Tracks the process via PID and keeps it in the runningProcesses map
 */
export function openProject(id: string): IpcResponse<Project> {
  try {
    const projects = readRegistry();
    const idx = projects.findIndex((p) => p.id === id);
    if (idx === -1) {
      return { success: false, error: `项目 ${id} 不存在` };
    }

    const proj = projects[idx];

    // Check if Claude is available
    if (!claudeAvailable()) {
      return { success: false, error: '未找到 Claude CLI，请确认已安装 Claude Code' };
    }

    // Check if the project folder still exists
    if (!fs.existsSync(proj.path)) {
      // Re-create it
      fs.mkdirSync(proj.path, { recursive: true });
      warn(`Project folder was missing — re-created: ${proj.path}`);
    }

    // If already running with a tracked process, do nothing extra
    if (proj.pid && isProcessAlive(proj.pid)) {
      proj.lastActiveAt = new Date().toISOString();
      proj.launchMode = 'wechat';
      projects[idx] = proj;
      writeRegistry(projects);
      info(`Project ${proj.name} already running (pid ${proj.pid})`);
      return { success: true, data: proj };
    }

    // Spawn Claude Code in the project directory
    info(`Starting Claude Code in ${proj.path}...`);
    const child = spawn('claude', [], {
      cwd: proj.path,
      shell: process.platform === 'win32',        // Use shell on Windows for PATH resolution
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // Ensure UTF-8 encoding in the child process
        LANG: 'en_US.UTF-8',
        LC_ALL: 'en_US.UTF-8',
      },
    });

    const pid = child.pid!;

    // Capture stdout for lastOutput
    let outputBuffer = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      outputBuffer += chunk.toString('utf-8');
      // Keep only the tail
      if (outputBuffer.length > MAX_LAST_OUTPUT_LENGTH * 2) {
        outputBuffer = outputBuffer.slice(-MAX_LAST_OUTPUT_LENGTH);
      }
      // Persist output snapshot periodically
      const progress = readProgressFile(id) ?? {};
      progress.lastOutput = outputBuffer.slice(-MAX_LAST_OUTPUT_LENGTH);
      writeProgressSnapshot(id, progress as Project);
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      debug(`[claude stderr ${proj.name}] ${chunk.toString('utf-8').trim()}`);
    });

    child.on('error', (err) => {
      error(`Claude process error for ${proj.name}`, err);
      const projectsNow = readRegistry();
      const p = projectsNow.find((x) => x.id === id);
      if (p) {
        p.status = 'error';
        p.pid = undefined;
        p.lastOutput = err.message;
        updateRegistryEntry(id, p);
      }
      runningProcesses.delete(id);
    });

    child.on('exit', (code, signal) => {
      info(`Claude process for ${proj.name} exited — code=${code}, signal=${signal}`);
      const projectsNow = readRegistry();
      const p = projectsNow.find((x) => x.id === id);
      if (p) {
        p.status = code === 0 ? 'completed' : 'idle';
        p.pid = undefined;
        p.progress = code === 0 ? 100 : p.progress;
        updateRegistryEntry(id, p);
      }
      runningProcesses.delete(id);
      // Clean up progress file
      try {
        const pg = projectProgressFile(id);
        if (fs.existsSync(pg)) fs.unlinkSync(pg);
      } catch { /* ok */ }
    });

    runningProcesses.set(id, child);

    // Update project metadata
    proj.status = 'running';
    proj.pid = pid;
    proj.launchMode = 'wechat';
    proj.lastActiveAt = new Date().toISOString();
    proj.lastOutput = undefined;

    projects[idx] = proj;
    writeRegistry(projects);

    info(`Project ${proj.name} launched (pid ${pid})`);
    return { success: true, data: proj };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    error('openProject failed', err);
    return { success: false, error: msg };
  }
}

/**
 * Update a project's status, progress, and optionally its task list.
 */
export function updateProjectStatus(
  id: string,
  status: ProjectStatus,
  progress?: number,
  tasks?: TaskItem[],
): IpcResponse<Project> {
  try {
    const projects = readRegistry();
    const idx = projects.findIndex((p) => p.id === id);
    if (idx === -1) {
      return { success: false, error: `项目 ${id} 不存在` };
    }

    const proj = projects[idx];
    proj.status = status;
    if (progress !== undefined) {
      proj.progress = Math.max(0, Math.min(100, Math.round(progress)));
    }
    if (tasks !== undefined) {
      proj.tasks = tasks;
      // Auto-derive step counts from the task list
      proj.totalSteps = tasks.length;
      proj.currentStep = tasks.filter(
        (t) => t.status === 'completed',
      ).length;
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

/**
 * Update token usage counters for a project.
 */
export function updateTokenUsage(
  id: string,
  sessionTokens: number,
  dailyTokens: number,
): IpcResponse<Project> {
  try {
    const projects = readRegistry();
    const idx = projects.findIndex((p) => p.id === id);
    if (idx === -1) {
      return { success: false, error: `项目 ${id} 不存在` };
    }

    const proj = projects[idx];
    proj.sessionTokens = sessionTokens;
    proj.dailyTokens = dailyTokens;
    proj.lastActiveAt = new Date().toISOString();

    projects[idx] = proj;
    writeRegistry(projects);
    debug(`Updated token usage for ${id}: session=${sessionTokens}, daily=${dailyTokens}`);

    return { success: true, data: proj };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    error('updateTokenUsage failed', err);
    return { success: false, error: msg };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Internal helpers (also exported for use by other modules)
// ═══════════════════════════════════════════════════════════════════════════

/** Write a progress snapshot to the project's progress file */
export function writeProgressSnapshot(projectId: string, data: Project): void {
  try {
    ensureDataDirs();
    const file = projectProgressFile(projectId);
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    warn(`Failed to write progress snapshot for ${projectId}`, err);
  }
}

/** Update a single registry entry in-place without a full read/modify/write cycle */
export function updateRegistryEntry(id: string, updated: Project): void {
  const projects = readRegistry();
  const idx = projects.findIndex((p) => p.id === id);
  if (idx === -1) return;
  projects[idx] = updated;
  writeRegistry(projects);
}

/** Check whether a specific project has a running Claude process */
export function isProjectRunning(id: string): boolean {
  const child = runningProcesses.get(id);
  if (child && child.exitCode === null) {
    return true;
  }
  const projects = readRegistry();
  const proj = projects.find((p) => p.id === id);
  if (proj?.pid && isProcessAlive(proj.pid)) {
    return true;
  }
  return false;
}
