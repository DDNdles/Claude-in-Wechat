#!/usr/bin/env node
/**
 * PreToolUse hook — intercepts Claude Code's AskUserQuestion tool and
 * redirects questions to WeChat. The user answers via WeChat, and the
 * hook returns those answers to Claude via systemMessage.
 *
 * Input (stdin JSON from Claude Code):
 *   { "tool_name": "AskUserQuestion", "tool_input": { "questions": [...] } }
 *
 * Output (stdout JSON):
 *   For AskUserQuestion → { "hookSpecificOutput": { "permissionDecision": "deny" }, "systemMessage": "..." }
 *   For other tools     → { "decision": "allow", "reason": "not AskUserQuestion" }
 *
 * Requires: Node.js >= 20, WeChat account linked via claude-to-im.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  loadWeixinAccount,
  loadContextToken,
  formatQuestionMsg,
  matchReply,
  sendMessage as sendWeixinMsg,
  pollUpdates,
} from '../lib/weixin-client.mjs';
import { autoRegister, getContextSummary } from '../lib/project-context.mjs';
import { recordApproval } from '../lib/approval-cache.mjs';

// ── Config ──

const TIMEOUT_SEC = parseInt(process.env.WXG_ASK_TIMEOUT || '120', 10);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const log = (...args) => process.stderr.write('[hook-ask-user] ' + args.join(' ') + '\n');

// ── Main logic ──

/**
 * Poll WeChat for a reply to a specific question.
 * @param {object} account
 * @param {string} toUserId
 * @param {string[]} options - option labels
 * @param {boolean} multiSelect
 * @param {number} deadline - Date.now() + timeout
 * @param {string} initialCursor
 * @returns {Promise<{indices: number[], rawReply: string}|{timeout: true}>}
 */
async function pollForReply(account, toUserId, options, multiSelect, deadline, initialCursor) {
  let cursor = initialCursor;

  while (Date.now() < deadline) {
    const remaining = Math.min(30000, Math.max(5000, deadline - Date.now() + 1000));

    try {
      const resp = await pollUpdates(account, cursor, remaining);

      for (const msg of resp.msgs || []) {
        if (msg.from_user_id !== toUserId) continue;

        let text = '';
        for (const item of msg.item_list || []) {
          if (item.type === 1 && item.text_item?.text) {
            text += item.text_item.text;
          }
        }
        text = text.trim();
        if (!text) continue;

        const matched = matchReply(text, options, multiSelect);
        if (multiSelect) {
          if (matched && matched.length > 0) {
            return { indices: matched, rawReply: text };
          }
        } else {
          if (matched !== null) {
            return { indices: [matched], rawReply: text };
          }
        }
      }

      if (resp.get_updates_buf) cursor = resp.get_updates_buf;
    } catch (err) {
      log(`Poll error: ${err.message}`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  return { timeout: true };
}

/**
 * Build the systemMessage with all user answers.
 */
function buildAnswerMessage(questions, answers) {
  const lines = ['用户在微信上回答了你的问题：', ''];

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const a = answers[i];

    if (a && a.indices && a.indices.length > 0) {
      const labels = a.indices.map(idx => {
        const opt = q.options[idx];
        return opt ? `「${opt.label}」` : `#${idx + 1}`;
      }).join(', ');
      lines.push(`Q${i + 1} (${q.header}): 选择了 ${labels} (回复: "${a.rawReply}")`);
    } else {
      lines.push(`Q${i + 1} (${q.header}): 用户未回复（超时）`);
    }
  }

  lines.push('');
  lines.push('请根据这些回答继续工作。');
  return lines.join('\n');
}

// ── Entry point ──

async function main() {
  // Read stdin
  let raw = '';
  if (!process.stdin.isTTY) {
    raw = fs.readFileSync(0, 'utf-8').trim();
  }

  let input;
  try {
    input = raw ? JSON.parse(raw) : {};
  } catch {
    input = {};
  }

  const toolName = input.tool_name || '';

  // Pass through non-AskUserQuestion tools immediately
  if (toolName !== 'AskUserQuestion') {
    console.log(JSON.stringify({ hookSpecificOutput: { permissionDecision: 'allow' } }));
    return 0;
  }

  const cwd = input.cwd || process.cwd();
  autoRegister(cwd);

  const questions = input.tool_input?.questions || [];
  if (questions.length === 0) {
    // No questions to forward — allow default flow
    console.log(JSON.stringify({
      hookSpecificOutput: { permissionDecision: 'allow' },
      systemMessage: 'AskUserQuestion 没有需要回答的问题。',
    }));
    return 0;
  }

  // ── Load WeChat account ──

  let account;
  try {
    account = loadWeixinAccount();
  } catch (err) {
    log(`WeChat unavailable: ${err.message}`);
    // Fall back to default AskUserQuestion flow
    console.log(JSON.stringify({
      hookSpecificOutput: { permissionDecision: 'allow' },
      systemMessage: '微信不可用 — 使用默认交互方式提问。',
    }));
    return 0;
  }

  const toUserId = account.userId;
  const contextToken = loadContextToken(account.accountId);

  log(`Intercepting AskUserQuestion with ${questions.length} question(s)`);

  // ── Send each question and wait for reply ──

  const answers = [];

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const header = q.header || `问题 ${i + 1}`;
    const question = q.question || '';
    const options = (q.options || []).map(o => o.label || '');
    const descriptions = (q.options || []).map(o => o.description || '');
    const multiSelect = q.multiSelect || false;

    if (options.length === 0) {
      answers.push(null);
      continue;
    }

    // Build and send message
    const msgText = formatQuestionMsg(header, question, options, descriptions, multiSelect, TIMEOUT_SEC);

    try {
      await sendWeixinMsg(account, toUserId, msgText, contextToken);
      log(`Sent Q${i + 1}/${questions.length}: ${header}`);
    } catch (err) {
      log(`Failed to send Q${i + 1}: ${err.message}`);
      answers.push(null);
      continue;
    }

    // Wait for reply
    const deadline = Date.now() + TIMEOUT_SEC * 1000;
    const result = await pollForReply(account, toUserId, options, multiSelect, deadline, '');

    if (result.timeout) {
      log(`Q${i + 1} timed out after ${TIMEOUT_SEC}s`);
      answers.push(null);
    } else {
      log(`Q${i + 1} answer: ${result.rawReply} => [${result.indices.join(',')}]`);
      // Send acknowledgment to WeChat
      sendWeixinMsg(account, toUserId, '收到，已记录你的选择', contextToken).catch(() => {});
      answers.push({ indices: result.indices, rawReply: result.rawReply });
    }
  }

  // ── Build response ──

  const systemMessage = buildAnswerMessage(questions, answers);
  const hasAnswers = answers.some(a => a !== null);

  // Record approval so hook-guard doesn't re-ask for subsequent tool calls
  if (hasAnswers) {
    const firstQ = questions[0];
    recordApproval('ask-user', firstQ?.question || 'user decision', cwd);
  }

  console.log(JSON.stringify({
    hookSpecificOutput: {
      permissionDecision: 'deny',
      updatedInput: {},
    },
    systemMessage,
  }));

  return 0;
}

main()
  .then(code => process.exit(code))
  .catch(err => {
    log(`Fatal: ${err.message}`);
    // On error, allow the default AskUserQuestion flow
    console.log(JSON.stringify({
      hookSpecificOutput: { permissionDecision: 'allow' },
      systemMessage: `微信提问失败: ${err.message.slice(0, 200)}。使用默认交互方式。`,
    }));
    process.exit(0);
  });