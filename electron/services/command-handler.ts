// ═══════════════════════════════════════════════════════════════
// Command Handler Service v0.4
// Parses WeChat text messages, routes commands to project-manager.
// ═══════════════════════════════════════════════════════════════

import {
  listProjects, createProject, deleteProject, renameProject,
  openProject, getProject, getTokenUsage, getActiveProject, setActiveProject,
  updateProjectStatus, isProjectRunning,
} from './project-manager';
import { killSession, hasSession, getSessionPid } from './claude-launcher';
import { getProgressTracker } from './progress-tracker';
import { info, debug, warn, error } from '../utils/logger';

// ── Types ─────────────────────────────────────────────────────────

export interface ParseResult {
  command: string;
  args: string[];
  isCommand: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────

/** Find a project by name (exact or case-insensitive match) */
function findProjectByName(name: string) {
  const projects = listProjects();
  // Exact match first
  const exact = projects.find(p => p.name.toLowerCase() === name.toLowerCase());
  if (exact) return exact;
  // Partial match
  const partial = projects.find(p =>
    p.name.toLowerCase().includes(name.toLowerCase()) ||
    name.toLowerCase().includes(p.name.toLowerCase())
  );
  return partial || null;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins}分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时前`;
  return `${Math.floor(hours / 24)}天前`;
}

// ── Command Parser ────────────────────────────────────────────────

export function parseCommand(text: string): ParseResult {
  const trimmed = text.trim();

  // Check for slash commands
  if (trimmed.startsWith('/')) {
    const parts = trimmed.slice(1).split(/\s+/);
    const command = parts[0]?.toLowerCase() || '';
    const args = parts.slice(1).filter(Boolean);

    // Support commands with project name that may contain spaces
    if (['new', 'open', 'delete', 'check', 'token', 'rename'].includes(command) && args.length > 0) {
      // Everything after the command is the project name / args
      return { command, args, isCommand: true };
    }
    return { command, args, isCommand: true };
  }

  // Check for Chinese keywords
  const cnKeywords: Record<string, string> = {
    '查询进度': 'check',
    '进度': 'check',
    '项目列表': 'list',
    '列出项目': 'list',
    '帮助': 'help',
    'help': 'help',
  };

  for (const [keyword, cmd] of Object.entries(cnKeywords)) {
    if (trimmed.startsWith(keyword)) {
      const after = trimmed.slice(keyword.length).trim();
      return { command: cmd, args: after ? [after] : [], isCommand: true };
    }
  }

  // Numeric reply (potential decision answer)
  if (/^\d+$/.test(trimmed)) {
    return { command: 'numeric', args: [trimmed], isCommand: true };
  }

  return { command: '', args: [], isCommand: false };
}

export function isNumericReply(text: string): boolean {
  return /^\d+$/.test(text.trim());
}

// ── Command Executor ──────────────────────────────────────────────

export async function handleCommand(command: string, args: string[]): Promise<string> {
  try {
    switch (command) {
      case 'list':
        return handleList();

      case 'new':
        return handleNew(args.join(' '));

      case 'open':
        return handleOpen(args.join(' '));

      case 'delete':
        return handleDelete(args.join(' '));

      case 'rename':
        return handleRename(args);

      case 'check':
        return handleCheck(args.join(' '));

      case 'token':
        return handleToken(args.join(' '));

      case 'stop':
        return handleStop(args.join(' '));

      case 'help':
        return handleHelp();

      default:
        return `未知命令: /${command}\n\n可用命令:\n/list 列出项目\n/new 项目名 创建项目\n/open 项目名 打开项目\n/stop 项目名 关闭项目\n/delete 项目名 删除项目\n/rename 旧名 新名 重命名\n/check 项目名 查看进度\n/token 项目名 Token用量\n/help 帮助`;
    }
  } catch (err: any) {
    error(`Command ${command} failed`, err);
    return `⚠️ 命令执行失败: ${err.message}`;
  }
}

// ── Command Handlers ──────────────────────────────────────────────

function handleList(): string {
  const projects = listProjects();
  if (projects.length === 0) {
    return `📁 暂无项目\n\n使用 /new 项目名 创建新项目`;
  }

  const running = projects.filter(p => p.status === 'running');
  const lines = [`📁 项目列表（共 ${projects.length} 个，${running.length} 个运行中）：`, ''];

  projects.forEach((p, i) => {
    const statusEmoji: Record<string, string> = {
      running: '🟢',
      idle: '⚪',
      completed: '✅',
      error: '❌',
      waiting: '⏳',
    };
    const emoji = statusEmoji[p.status] || '⚪';
    const progress = p.progress ? ` | ${p.progress}%` : '';
    const tokens = p.sessionTokens ? ` | ${formatTokens(p.sessionTokens)} tok` : '';
    const time = p.lastActiveAt ? ` | ${formatTimeAgo(p.lastActiveAt)}` : '';
    lines.push(`${i + 1}. ${p.name} — ${emoji} ${p.status}${progress}${tokens}${time}`);
  });

  return lines.join('\n');
}

function handleNew(name: string): string {
  if (!name || name.trim().length === 0) {
    return '❌ 使用方法: /new 项目名\n例如: /new my-app';
  }

  const result = createProject(name.trim());
  if (!result.success) {
    return `❌ ${result.error || '创建失败'}`;
  }

  return `✅ 项目「${name.trim()}」已创建\n请回复你想让我做什么`;
}

function handleOpen(name: string): string {
  if (!name || name.trim().length === 0) {
    return '❌ 使用方法: /open 项目名\n例如: /open my-app';
  }

  const project = findProjectByName(name.trim());
  if (!project) {
    return `❌ 项目「${name.trim()}」不存在。使用 /list 查看项目列表`;
  }

  const result = openProject(project.id);
  if (!result.success) {
    return `❌ ${result.error || '打开失败'}`;
  }

  return `✅ 已打开项目「${project.name}」\n你现在可以直接发消息给 Claude Code`;
}

function handleDelete(name: string): string {
  if (!name || name.trim().length === 0) {
    return '❌ 使用方法: /delete 项目名\n例如: /delete my-app';
  }

  const project = findProjectByName(name.trim());
  if (!project) {
    return `❌ 项目「${name.trim()}」不存在`;
  }

  const result = deleteProject(project.id);
  if (!result.success) {
    return `❌ ${result.error || '删除失败'}`;
  }

  return `✅ 已删除「${project.name}」\n项目文件夹已保留在磁盘上`;
}

function handleStop(name: string): string {
  let project;
  if (name && name.trim().length > 0) {
    project = findProjectByName(name.trim());
  } else {
    const active = getActiveProject();
    if (active.success && active.data) project = active.data;
  }

  if (!project) {
    return name
      ? `❌ 项目「${name.trim()}」不存在`
      : '❌ 没有活跃项目。使用 /stop 项目名 关闭指定项目';
  }

  // Kill the Claude process if running
  const pid = project.pid || getSessionPid(project.id);
  if (pid && isProjectRunning(project.id)) {
    killSession(project.id);
    updateProjectStatus(project.id, 'idle', project.progress, project.tasks);
    return `✅ 已关闭项目「${project.name}」（PID: ${pid}）`;
  }

  if (hasSession(project.id)) {
    killSession(project.id);
    updateProjectStatus(project.id, 'idle', project.progress, project.tasks);
    return `✅ 已关闭项目「${project.name}」的终端会话`;
  }

  // Just mark as idle if no process to kill
  updateProjectStatus(project.id, 'idle', project.progress, project.tasks);
  return `✅ 项目「${project.name}」已标记为空闲（无运行中的进程）`;
}

function handleRename(args: string[]): string {
  if (args.length < 2) {
    return '❌ 使用方法: /rename 旧项目名 新项目名\n例如: /rename old-app new-app';
  }

  const oldName = args[0];
  const newName = args.slice(1).join(' ');

  const project = findProjectByName(oldName);
  if (!project) {
    return `❌ 项目「${oldName}」不存在`;
  }

  const result = renameProject(project.id, newName);
  if (!result.success) {
    return `❌ ${result.error || '重命名失败'}`;
  }

  return `✅ 已重命名「${oldName}」→「${newName}」`;
}

function handleCheck(name: string): string {
  let project;
  let usedActive = false;

  if (name && name.trim().length > 0) {
    project = findProjectByName(name.trim());
  } else {
    // Check active project
    const active = getActiveProject();
    if (active.success && active.data) {
      project = active.data;
      usedActive = true;
    }
  }

  if (!project) {
    return name
      ? `❌ 项目「${name.trim()}」不存在。使用 /list 查看项目列表`
      : '❌ 没有活跃项目。请使用 /open 项目名 打开一个项目';
  }

  const tracker = getProgressTracker();
  const progressReport = tracker.formatProgressReport({
    projectId: project.id,
    progress: project.progress || 0,
    currentStep: project.currentStep,
    totalSteps: project.totalSteps,
    tasks: project.tasks || [],
    lastUpdated: project.lastActiveAt,
    status: project.status,
  });

  const prefix = usedActive ? `📊 活跃项目: ${project.name}` : `📊 ${project.name}`;
  return `${prefix}\n${progressReport}\nToken: ${formatTokens(project.sessionTokens)} (本次) / ${formatTokens(project.dailyTokens)} (今日)`;
}

function handleToken(name: string): string {
  let project;
  if (name && name.trim().length > 0) {
    project = findProjectByName(name.trim());
  } else {
    const active = getActiveProject();
    if (active.success && active.data) project = active.data;
  }

  if (!project) {
    return name
      ? `❌ 项目「${name.trim()}」不存在`
      : '❌ 没有活跃项目';
  }

  const sessionTok = project.sessionTokens || 0;
  const dailyTok = project.dailyTokens || 0;
  const costEstimate = ((dailyTok / 1_000_000) * 3).toFixed(2);

  return [
    `💰 ${project.name} Token使用：`,
    `本次会话: ${formatTokens(sessionTok)} tokens`,
    `今日总计: ${formatTokens(dailyTok)} tokens`,
    `估算费用: ~$${costEstimate}`,
  ].join('\n');
}

function handleHelp(): string {
  return [
    '📋 Claude in WeChat 命令：',
    '',
    '/list — 列出所有项目及状态',
    '/new 项目名 — 创建新项目',
    '/open 项目名 — 打开并激活项目',
    '/stop [项目名] — 关闭项目（终止Claude Code进程）',
    '/delete 项目名 — 删除项目',
    '/rename 旧名 新名 — 重命名项目',
    '/check [项目名] — 查看项目进度',
    '/token [项目名] — 查看Token用量',
    '/help — 显示此帮助',
    '',
    '直接发送文字 — 向活跃项目的Claude Code发送任务',
    '发送数字 — 回复决策提示',
  ].join('\n');
}