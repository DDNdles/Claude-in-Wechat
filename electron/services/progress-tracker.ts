// ═══════════════════════════════════════════════════════════════
// Progress Tracker — reads/estimates project progress from Claude output
// ═══════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';
import { info, warn, error, debug } from '../utils/logger';
import { RUNTIME_DIR, projectProgressFile } from '../utils/paths';
import type { Project, ProjectStatus, TaskItem } from '../../shared/types';

// ── Types ──────────────────────────────────────────────────────────────

export interface ProgressData {
  projectId: string;
  progress: number;          // 0-100
  currentStep?: number;
  totalSteps?: number;
  tasks: TaskItem[];
  lastUpdated: string;       // ISO timestamp
  status: ProjectStatus;
}

export interface ProgressEstimate {
  progress: number;
  currentStep?: number;
  totalSteps?: number;
  method: 'tasks' | 'heuristic' | 'cached' | 'unknown';
}

// ── Constants ──────────────────────────────────────────────────────────

/** Heuristic: roughly estimate 5 tool calls per meaningful progress step */
const ESTIMATED_TOOL_CALLS_PER_STEP = 5;

/** Heuristic: typical number of tool calls for a moderate task */
const TYPICAL_TOTAL_TOOL_CALLS = 25;

/** Regex patterns for extracting task info */
const TASK_CREATE_RE = /"name"\s*:\s*"TaskCreate"[^}]*"subject"\s*:\s*"([^"]*)"/g;
const TASK_UPDATE_RE = /"name"\s*:\s*"TaskUpdate"[^}]*"taskId"\s*:\s*"([^"]*)"[^}]*"status"\s*:\s*"([^"]*)"/g;
const MD_TASK_RE = /^[-*+]\s+\[([ xX])\]\s+(.+)/;

/** Count tool call patterns in output */
const TOOL_CALL_RE = /"name"\s*:\s*"(?:Bash|Read|Write|Edit|Glob|Grep|WebFetch|WebSearch|Task|TodoWrite)"/gi;

// ── ProgressTracker Class ──────────────────────────────────────────────

export class ProgressTracker {
  private cache: Map<string, ProgressData> = new Map();

  /** Read progress data from disk for a project */
  readProgress(projectId: string): ProgressData | null {
    // Check cache first
    const cached = this.cache.get(projectId);
    if (cached) return cached;

    const file = projectProgressFile(projectId);
    if (!fs.existsSync(file)) return null;

    try {
      const raw = fs.readFileSync(file, 'utf-8');
      const data: ProgressData = JSON.parse(raw);
      this.cache.set(projectId, data);
      return data;
    } catch (err) {
      warn(`ProgressTracker: failed to read progress file for ${projectId}`, err);
      return null;
    }
  }

  /** Write progress data to disk */
  writeProgress(data: ProgressData): void {
    if (!fs.existsSync(RUNTIME_DIR)) {
      fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    }

    const file = projectProgressFile(data.projectId);
    try {
      fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
      this.cache.set(data.projectId, data);
    } catch (err) {
      error(`ProgressTracker: failed to write progress for ${data.projectId}`, err);
    }
  }

  /** Estimate progress for a project based on tasks or heuristics */
  estimateProgress(
    projectId: string,
    tasks: TaskItem[],
    processRunning?: boolean,
    toolCallCount?: number,
    elapsedSeconds?: number,
  ): ProgressEstimate {
    // Method 1: If tasks exist, calculate from completion ratio
    if (tasks.length > 0) {
      const completed = tasks.filter(t => t.status === 'completed').length;
      const inProgress = tasks.filter(t => t.status === 'in_progress').length;
      // Count in-progress tasks as half-complete each
      const effectiveComplete = completed + inProgress * 0.5;
      const progress = Math.min(100, Math.round((effectiveComplete / tasks.length) * 100));

      return {
        progress,
        currentStep: completed + inProgress,
        totalSteps: tasks.length,
        method: 'tasks',
      };
    }

    // Method 2: If process running but no tasks parsed, use heuristic
    if (processRunning && toolCallCount !== undefined) {
      // Assume each step takes roughly ESTIMATED_TOOL_CALLS_PER_STEP tool calls
      const estimatedSteps = Math.floor(toolCallCount / ESTIMATED_TOOL_CALLS_PER_STEP);
      const progress = Math.min(99, Math.round((toolCallCount / TYPICAL_TOTAL_TOOL_CALLS) * 100));

      return {
        progress: Math.max(1, progress), // At least 1% if running
        currentStep: estimatedSteps > 0 ? estimatedSteps : undefined,
        method: 'heuristic',
      };
    }

    // Method 3: If process is running but we have nothing to go on, use time-based heuristic
    if (processRunning && elapsedSeconds !== undefined) {
      // Assume most tasks take 60-300 seconds. Linear estimate with diminishing returns.
      const progress = Math.min(80, Math.round(Math.min(elapsedSeconds / 120, 1) * 60));

      return {
        progress: Math.max(1, progress),
        method: 'heuristic',
      };
    }

    // Method 4: Check if there's cached progress data
    const cached = this.cache.get(projectId);
    if (cached) {
      return {
        progress: cached.progress,
        currentStep: cached.currentStep,
        totalSteps: cached.totalSteps,
        method: 'cached',
      };
    }

    return { progress: 0, method: 'unknown' };
  }

  /** Parse task items from Claude output text */
  parseTaskList(output: string): TaskItem[] {
    const tasks: TaskItem[] = [];
    const seenSubjects = new Set<string>();
    let idCounter = 0;

    // Phase 1: Find TaskCreate JSON objects with subject
    const createMatches = output.matchAll(TASK_CREATE_RE);
    for (const match of createMatches) {
      idCounter++;
      const subject = match[1].trim();
      // Avoid duplicates
      const normalized = subject.toLowerCase();
      if (seenSubjects.has(normalized)) continue;
      seenSubjects.add(normalized);

      tasks.push({
        id: `task-${idCounter}`,
        subject,
        description: '',
        status: 'pending',
      });
    }

    // Phase 2: Apply TaskUpdate statuses
    const updateMatches = output.matchAll(TASK_UPDATE_RE);
    for (const match of updateMatches) {
      const taskId = match[1];
      const statusStr = match[2].toLowerCase();

      const status: TaskItem['status'] =
        statusStr === 'completed' ? 'completed' :
        statusStr === 'in_progress' ? 'in_progress' :
        'pending';

      // Try to find matching task by numeric ID
      const taskNum = parseInt(taskId, 10);
      if (!isNaN(taskNum) && taskNum <= tasks.length) {
        tasks[taskNum - 1].status = status;
      }
    }

    // Phase 3: Parse markdown checklists (lines with `- [x]` or `- [ ]`)
    const lines = output.split('\n');
    for (const line of lines) {
      const mdMatch = line.match(MD_TASK_RE);
      if (mdMatch) {
        idCounter++;
        const checked = mdMatch[1].toLowerCase() === 'x';
        const subject = mdMatch[2].trim();
        const normalized = subject.toLowerCase();

        // Don't add if we already have a TaskCreate for similar text
        if (seenSubjects.has(normalized)) continue;
        seenSubjects.add(normalized);

        tasks.push({
          id: `md-${idCounter}`,
          subject,
          description: '',
          status: checked ? 'completed' : 'pending',
        });
      }
    }

    return tasks;
  }

  /** Count tool calls in Claude output (for heuristic estimation) */
  countToolCalls(output: string): number {
    const matches = output.match(TOOL_CALL_RE);
    return matches ? matches.length : 0;
  }

  /** Build ASCII progress bar string */
  buildProgressBar(progress: number, currentStep?: number, totalSteps?: number): string {
    const clamped = Math.max(0, Math.min(100, Math.round(progress)));
    const barLen = 10;
    const filled = Math.round((clamped / 100) * barLen);
    const empty = barLen - filled;
    const bar = '█'.repeat(filled) + '░'.repeat(empty);

    let line = `${bar} ${clamped}%`;
    if (currentStep !== undefined && totalSteps !== undefined && totalSteps > 0) {
      line += ` (${currentStep}/${totalSteps})`;
    }
    return line;
  }

  /** Get status text with emoji + Chinese label */
  getStatusText(status: ProjectStatus): string {
    const map: Record<ProjectStatus, string> = {
      idle: '\u{1F534} 空闲',       // 🔴 空闲
      running: '\u{1F7E2} 运行中',   // 🟢 运行中
      completed: '✅ 已完成',     // ✅ 已完成
      error: '❌ 错误',                 // ❌ 错误
      waiting: '⏳ 等待中',       // ⏳ 等待中
    };
    return map[status] || '⚪ 未知'; // ⚪ 未知
  }

  /** Format a complete progress report string */
  formatProgressReport(progress: ProgressData): string {
    const bar = this.buildProgressBar(progress.progress, progress.currentStep, progress.totalSteps);
    const statusText = this.getStatusText(progress.status);

    let report = `状态: ${statusText}\n`;     // 状态: ...
    report += `进度: ${bar}\n`;               // 进度: ...

    if (progress.tasks && progress.tasks.length > 0) {
      report += `\n任务列表:\n`;     // 任务列表:
      for (const task of progress.tasks.slice(0, 15)) {
        const emoji =
          task.status === 'completed' ? '✅' :    // ✅
          task.status === 'in_progress' ? '\u{1F535}' : // 🔵
          '⚪';                                    // ⚪
        report += `${emoji} ${task.subject}\n`;
      }
      if (progress.tasks.length > 15) {
        report += `... 还有 ${progress.tasks.length - 15} 个任务\n`;
        // ... 还有 N 个任务
      }
    }

    return report;
  }

  /** Clear cached progress for a project */
  clearCache(projectId: string): void {
    this.cache.delete(projectId);
  }

  /** Clear all caches */
  clearAll(): void {
    this.cache.clear();
  }
}

// ── Singleton ──────────────────────────────────────────────────────────

let _instance: ProgressTracker | null = null;

export function getProgressTracker(): ProgressTracker {
  if (!_instance) {
    _instance = new ProgressTracker();
  }
  return _instance;
}
