#!/usr/bin/env node
/**
 * One-shot progress query script.
 *
 * Reads progress-state.json and session data, outputs a summary to stdout.
 *
 * Usage:
 *   node query-progress.mjs
 *   node query-progress.mjs --json     # machine-readable output
 *
 * Output (human-readable):
 *   📊 Claude Code 进度摘要
 *   ...
 *
 * Output (--json):
 *   {"active":true,"toolName":"Bash","description":"运行测试","age":32,...}
 */

import fs from 'node:fs';
import path from 'node:path';
import { readProgressState, CTI_HOME } from '../lib/weixin-client.mjs';
import { listProjects, getContextSummary } from '../lib/project-context.mjs';

const JSON_MODE = process.argv.includes('--json');

// ── Data sources ──

function getSessionInfo() {
  const result = { sessions: [] };

  // Try Claude session directories
  const sessionsDir = path.join(
    process.env.HOME || process.env.USERPROFILE,
    '.claude', 'projects',
  );
  try {
    if (fs.existsSync(sessionsDir)) {
      const dirs = fs.readdirSync(sessionsDir, { withFileTypes: true });
      for (const dirent of dirs) {
        if (!dirent.isDirectory()) continue;
        const sessionDir = path.join(sessionsDir, dirent.name);
        const stat = fs.statSync(sessionDir);
        result.sessions.push({
          name: dirent.name,
          lastModified: stat.mtime.toISOString(),
        });
      }
    }
  } catch { /* ok */ }

  // Sort by most recent
  result.sessions.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
  if (result.sessions.length > 5) result.sessions = result.sessions.slice(0, 5);

  return result;
}

function getBridgeStatus() {
  const statusFile = path.join(CTI_HOME, 'runtime', 'status.json');
  try {
    const raw = fs.readFileSync(statusFile, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ── Main ──

function main() {
  const progress = readProgressState();
  const session = getSessionInfo();
  const bridge = getBridgeStatus();

  if (JSON_MODE) {
    console.log(JSON.stringify({
      active: progress !== null,
      progress,
      sessions: session.sessions,
      bridgeRunning: bridge?.running || false,
    }));
    return;
  }

  // ── Human-readable output ──

  console.log('📊 Claude Code 进度摘要');
  console.log('');
  console.log(getContextSummary());
  console.log('');

  if (progress) {
    const ageStr = progress.ageSeconds < 60
      ? `${progress.ageSeconds} 秒前`
      : `${Math.round(progress.ageSeconds / 60)} 分钟前`;
    console.log(`🟢 当前活动 (${ageStr}):`);
    console.log(`   工具: ${progress.toolName}`);
    console.log(`   操作: ${progress.description}`);
    if (progress.cwd) {
      const folder = progress.cwd.split(/[/\\]/).pop() || progress.cwd;
      console.log(`   目录: ${folder}`);
    }
  } else {
    console.log('⚪ 当前无活跃操作');
  }

  console.log('');

  if (session.sessions.length > 0) {
    console.log('📁 最近项目:');
    for (const s of session.sessions) {
      const age = Math.round((Date.now() - new Date(s.lastModified).getTime()) / 60000);
      const ageStr = age < 1 ? '刚刚' : `${age} 分钟前`;
      console.log(`   • ${s.name} (${ageStr})`);
    }
  } else {
    console.log('📁 无最近项目记录');
  }

  console.log('');

  if (bridge) {
    console.log(`🌉 Bridge 状态: ${bridge.running ? '✅ 运行中' : '❌ 已停止'}`);
    if (bridge.startedAt) {
      console.log(`   启动时间: ${bridge.startedAt}`);
    }
  } else {
    console.log('🌉 Bridge 状态: ⚪ 无状态文件');
  }
}

main();