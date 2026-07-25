// ═══════════════════════════════════════════════════════════════════════════
// Project Manager Service v0.3
// Real filesystem CRUD at ~/projects/Wechat/
// Registry stored at ~/.claude-in-wechat/projects.json
// ═══════════════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
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

// External project auto-sync

export interface ScannedProject {
  pid: number;
  cwd: string;
  name: string;
  commandLine: string;
}

/**
 * Scan for running claude.exe processes that are NOT already registered.
 * Returns newly discovered projects that should be imported.
 */
export function scanExternalProjects(): ScannedProject[] {
  try {
    if (process.platform !== 'win32') return [];

    // Get all claude.exe processes with their command lines
    const result = execSync(
      'wmic process where "name=\'claude.exe\'" get ProcessId,CommandLine /format:csv 2>nul',
      { encoding: 'utf-8', windowsHide: true },
    );

    const registeredProjects = readRegistry();
    const knownPaths = new Set(registeredProjects.map(p => p.path.toLowerCase()));
    const knownPids = new Set(
      registeredProjects
        .filter(p => p.pid && isProcessAlive(p.pid!))
        .map(p => p.pid),
    );
    const discovered: ScannedProject[] = [];

    for (const line of result.split('\n')) {
      if (!line.includes('claude')) continue;

      // Parse CSV: NodeName,ProcessId,CommandLine
      const parts = line.split(',');
      const pid = parseInt(parts[1], 10);
      if (!pid || isNaN(pid)) continue;

      const commandLine = parts.slice(2).join(',').replace(/\r/g, '');
      if (!commandLine.toLowerCase().includes('claude')) continue;

      // Extract working directory from claude process
      // Claude Code's typical invocation: node ... claude (with cwd being the project)
      // For wmic, we need to find the actual cwd - use PowerShell
      let cwd = '';
      try {
        const cwdResult = execSync(
          `powershell -NoProfile -Command "(Get-WmiObject Win32_Process -Filter 'ProcessId=${pid}').ExecutablePath | Split-Path" 2>nul`,
          { encoding: 'utf-8', windowsHide: true },
        );
        const exePath = cwdResult.trim();
        // Try getting parent cmd.exe's working directory
        const parentResult = execSync(
          `wmic process where "processid=${pid}" get parentprocessid /format:csv 2>nul`,
          { encoding: 'utf-8', windowsHide: true },
        );
        const ppidLine = parentResult.split('\n')[1];
        if (ppidLine) {
          const ppid = parseInt(ppidLine.split(',')[1], 10);
          if (ppid && !isNaN(ppid)) {
            // Get cmd.exe's working directory if parent is cmd
            const cmdCwd = execSync(
              `powershell -NoProfile -Command "try { $p = Get-WmiObject Win32_Process -Filter 'ProcessId=${ppid}'; if ($p.Name -eq 'cmd.exe') { $sw = Get-WmiObject Win32_LogicalProgramGroupItem | Out-Null; $p.CommandLine -match '.*cd /d ''([^'']+).*' | Out-Null; $Matches[1] } } catch { '' }" 2>nul`,
              { encoding: 'utf-8', windowsHide: true },
            );
            cwd = cmdCwd.trim();
          }
        }
      } catch {
        // Fallback: try to guess from command line
      }

      if (!cwd) {
        // Fallback: scan known project directories for best match
        if (fs.existsSync(PROJECTS_DIR)) {
          const dirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
            .filter(d => d.isDirectory());
          for (const d of dirs) {
            const fullPath = path.join(PROJECTS_DIR, d.name);
            // Check if this dir has a .claude directory (marker of a Claude project)
            if (fs.existsSync(path.join(fullPath, '.claude'))) {
              cwd = fullPath;
              break;
            }
          }
        }
      }

      const normalizedCwd = cwd.toLowerCase();
      if (!cwd || knownPaths.has(normalizedCwd)) continue;

      const name = path.basename(cwd);

      discovered.push({ pid, cwd, name, commandLine });
    }

    return discovered;
  } catch (err) {
    warn('Failed to scan external projects', err);
    return [];
  }
}

/**
 * Auto-import discovered external projects into the registry.
 */
export function importExternalProjects(discovered: ScannedProject[]): Project[] {
  const imported: Project[] = [];

  for (const ext of discovered) {
    try {
      const now = new Date().toISOString();
      const project: Project = {
        id: generateId(),
        name: ext.name,
        path: ext.cwd,
        status: 'running',
        progress: 0,
        tasks: [],
        sessionTokens: 0,
        dailyTokens: 0,
        pid: ext.pid,
        createdAt: now,
        lastActiveAt: now,
        launchMode: 'desktop',
      };

      const projects = readRegistry();
      projects.push(project);
      writeRegistry(projects);
      imported.push(project);
      info(`Auto-imported external project: ${ext.name} (pid=${ext.pid})`);
    } catch (err) {
      warn(`Failed to import external project: ${ext.name}`, err);
    }
  }

  return imported;
}

/**
 * Sync external project states: update PIDs for running projects,
 * mark projects with dead PIDs as idle.
 */
export function syncExternalProjectStates(): number {
  let changed = 0;
  const projects = readRegistry();
  const now = new Date().toISOString();

  for (const proj of projects) {
    if (proj.launchMode === 'desktop') {
      // Check if a claude process is running in this directory
      const orphanPid = findClaudeInDir(proj.path);
      if (orphanPid && proj.status !== 'running') {
        proj.status = 'running';
        proj.pid = orphanPid;
        proj.lastActiveAt = now;
        changed++;
      } else if (!orphanPid && proj.status === 'running' && !isProcessAlive(proj.pid || -1)) {
        proj.status = 'idle';
        proj.pid = undefined;
        proj.lastActiveAt = now;
        changed++;
      }
    }
  }

  if (changed > 0) {
    writeRegistry(projects);
    info(`Synced ${changed} external project state(s)`);
  }

  return changed;
}

function findClaudeInDir(cwd: string): number | null {
  try {
    if (process.platform !== 'win32') return null;
    const result = execSync(
      'wmic process where "name=\'claude.exe\'" get ProcessId,CommandLine /format:csv 2>nul',
      { encoding: 'utf-8', windowsHide: true },
    );
    const norm = cwd.toLowerCase().replace(/\\/g, '\\\\');
    for (const line of result.split('\n')) {
      if (line.toLowerCase().includes(norm)) {
        const match = line.match(/\d+/);
        if (match) {
          const pid = parseInt(match[0], 10);
          if (pid && isProcessAlive(pid)) return pid;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}
