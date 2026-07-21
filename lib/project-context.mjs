/**
 * Project context manager for weixin-global-integration.
 *
 * Manages a project registry so the user can switch between projects
 * on WeChat. Commands: 切换到聊天, 切换到1号项目, 列出项目, etc.
 *
 * Stores state at ~/.claude-to-im/data/project-context.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { CTI_HOME } from './weixin-client.mjs';

const CONTEXT_FILE = path.join(CTI_HOME, 'data', 'project-context.json');

/** @returns {{ mode: 'chat'|'project', activeProjectId: string|null, projects: Record<string, {name:string,cwd:string,lastActive:string}> }} */
export function loadContext() {
  try {
    return JSON.parse(fs.readFileSync(CONTEXT_FILE, 'utf-8'));
  } catch {
    return { mode: 'chat', activeProjectId: null, projects: {} };
  }
}

function saveContext(ctx) {
  const dir = path.dirname(CONTEXT_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONTEXT_FILE, JSON.stringify(ctx, null, 2));
}

/** Register or update a project. Returns its ID. */
export function registerProject(name, cwd) {
  const ctx = loadContext();
  // Find existing or create new
  let id = Object.keys(ctx.projects).find(
    k => ctx.projects[k].cwd === cwd || ctx.projects[k].name === name
  );
  if (!id) {
    id = String(Object.keys(ctx.projects).length + 1);
  }
  ctx.projects[id] = { name, cwd, lastActive: new Date().toISOString() };
  saveContext(ctx);
  return id;
}

/** Switch to a specific project by ID. */
export function switchToProject(projectId) {
  const ctx = loadContext();
  if (!ctx.projects[projectId]) return false;
  ctx.mode = 'project';
  ctx.activeProjectId = projectId;
  if (ctx.projects[projectId]) {
    ctx.projects[projectId].lastActive = new Date().toISOString();
  }
  saveContext(ctx);
  return true;
}

/** Switch to chat mode (suppress extra replies). */
export function switchToChat() {
  const ctx = loadContext();
  ctx.mode = 'chat';
  ctx.activeProjectId = null;
  saveContext(ctx);
}

/** List all projects as a formatted string. */
export function listProjects() {
  const ctx = loadContext();
  if (Object.keys(ctx.projects).length === 0) {
    return '暂无注册项目。在电脑上运行 Claude Code 的会话会自动注册。';
  }
  const lines = ['📁 已注册项目：', ''];
  for (const [id, p] of Object.entries(ctx.projects)) {
    const marker = ctx.activeProjectId === id ? ' ← 当前' : '';
    lines.push(`${id}. ${p.name}${marker}`);
    lines.push(`   ${p.cwd}`);
  }
  if (ctx.mode === 'chat') {
    lines.push('');
    lines.push('当前模式: 💬 聊天（用「切换到N号项目」进入项目模式）');
  } else if (ctx.activeProjectId) {
    const active = ctx.projects[ctx.activeProjectId];
    lines.push('');
    lines.push(`当前: 🔧 ${active?.name || '未知'}`);
  }
  return lines.join('\n');
}

/** Get the currently active project (or null if in chat mode). */
export function getActiveProject() {
  const ctx = loadContext();
  if (ctx.mode !== 'project' || !ctx.activeProjectId) return null;
  return ctx.projects[ctx.activeProjectId] || null;
}

/** Update lastActive timestamp for the active project. */
export function touchActiveProject() {
  const ctx = loadContext();
  if (ctx.mode === 'project' && ctx.activeProjectId && ctx.projects[ctx.activeProjectId]) {
    ctx.projects[ctx.activeProjectId].lastActive = new Date().toISOString();
    saveContext(ctx);
  }
}

/** Get a summary of the current context. */
export function getContextSummary() {
  const ctx = loadContext();
  if (ctx.mode === 'chat') return '💬 聊天模式';
  if (ctx.activeProjectId && ctx.projects[ctx.activeProjectId]) {
    const p = ctx.projects[ctx.activeProjectId];
    return `🔧 ${p.name} (${path.basename(p.cwd)})`;
  }
  return '⚪ 无活跃项目';
}

/** Auto-register the current working directory as a project. */
export function autoRegister(cwd) {
  const name = cwd.split(/[/\\]/).pop() || cwd;
  const id = registerProject(name, cwd);
  if (!loadContext().activeProjectId) {
    switchToProject(id);
  }
  return id;
}