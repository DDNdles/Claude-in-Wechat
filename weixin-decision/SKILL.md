---
name: weixin-decision
description: >
  When Claude Code encounters a decision point that REQUIRES human input — deploy to production,
  delete a resource, choose between architectural approaches, approve an irreversible action —
  use this skill to send a WeChat (微信) message with numbered options and block until the user
  replies. Also use this skill to send one-way WeChat notifications when a long-running task
  completes or fails. Triggers on: "我该选哪个", "需要人工审核", "发微信通知我", "微信提醒",
  "让用户决定", "需要确认", "should I deploy", "approve this", "notify me on WeChat",
  "get user decision", any irreversible action that needs sign-off, or when the user has
  previously asked to be notified on task completion. The skill bundles scripts that directly
  call the WeChat bot API — no bridge daemon needed for one-way sends; the bridge must be running
  for the ask (polling) script. If the user hasn't set up WeChat yet, guide them through
  `/claude-to-im setup` first.
compatibility: "Requires Node.js >= 20. WeChat bot account must be linked via claude-to-im skill."
---

# WeChat Decision & Notification

> **Note:** For automatic hook-based interception (AskUserQuestion → WeChat,
> dangerous command gating, Stop notifications, "查询进度"), see
> `weixin-global-integration`. That package works transparently via Claude Code
> hooks. This skill (`weixin-decision`) is for *explicit* decisions you
> proactively send during coding sessions.

Send decisions to the user's WeChat and (for choices) block until they reply.

## Two modes

### Mode 1: One-way notification (no reply needed)

Use when a task finishes, fails, or you just want to inform. Fire and forget.

```bash
node "$HOME/.claude-to-im/scripts/send-weixin.mjs" "消息内容"
```

**When to use:**
- Long-running task completed ("构建完成，3 个警告")
- Error occurred ("部署失败: timeout connecting to server")
- Milestone reached ("阶段 1/3 已完成")
- User explicitly asked "通知我"

### Mode 2: Decision polling (waits for reply)

Use when you genuinely CANNOT proceed without human input. Sends numbered options, polls WeChat API until the user replies with a number.

```bash
node "$HOME/.claude-to-im/scripts/ask-weixin.mjs" \
  [--timeout SECONDS] \
  "问题描述" \
  "选项A" \
  "选项B" \
  "选项C..."
```

**Output (stdout):** A JSON block delimited by `=== RESULT ===`:
```json
{"index":0,"label":"选项A","rawReply":"1"}
```

Exit code 0 = got reply. Exit code 1 = timeout or error.

**When to use (mandatory):**
- Deploying to production
- Deleting resources (databases, files, servers)
- Choosing between architecture approaches with different tradeoffs
- Any irreversible action the user should sign off on
- User's instructions say "always ask before X"

**When NOT to use:**
- Trivial choices you can make yourself (variable names, formatting)
- Things the user explicitly said "just do it"
- Progress updates (use Mode 1 instead)
- The user is actively chatting with you — just ask inline

### Timeout guidelines

Choose timeout based on urgency:
- `--timeout 60` — Critical/blocking: user is likely at their desk
- `--timeout 300` — Normal: user might be away from phone
- `--timeout 900` — Non-urgent: user might be in a meeting (default: 120)

## Decision format guidelines

1. **Keep options short.** The full message must fit in one WeChat bubble. Aim for question + options under 200 chars.
2. **Use action labels.** "部署到生产环境" not "选项A". User can reply with number or fuzzy text.
3. **Include risk level.** Prefix with ⚠️ for destructive, 🔴 for high-risk, ℹ️ for informational.
4. **Provide context.** Include what will happen if no reply ("如果不回复，5 分钟后自动跳过").

Example:
```bash
node "$HOME/.claude-to-im/scripts/ask-weixin.mjs" \
  --timeout 300 \
  "⚠️ 删除 production 数据库 'orders_db'？" \
  "确认删除（不可恢复）" \
  "取消操作" \
  "导出数据后再删除"
```

## Match rules (what the user can reply)

The script matches WeChat replies in this order:
1. Exact number: `1`, `2`, `3`
2. Chinese number prefix: `选项1`, `第2个`
3. Label substring (case-insensitive, any language)
4. Chinese numerals: `一`, `二`, `三`, `四`, `五`, `六`

## Bridge prerequisite

The WeChat bridge daemon does NOT need to be running for Mode 1 (one-way send).

For Mode 2 (polling), the script calls `getupdates` directly. It coexists with the bridge but may briefly compete for the same poll cursor. If the bridge is running, that's fine — they share credentials but poll independently.

If credentials are missing (`~/.claude-to-im/data/weixin-accounts.json` not found), tell the user:
> 你还没配置微信桥接。请先运行 `/claude-to-im setup` 然后选择 weixin 渠道扫码登录。

## Script locations

Scripts are available at both:
- `~/.weixin-global-integration/scripts/send-weixin.mjs` — one-way notification (installed by weixin-global-integration)
- `~/.weixin-global-integration/scripts/ask-weixin.mjs` — decision polling (installed by weixin-global-integration)

Legacy fallback locations (still supported):
- `~/.claude-to-im/scripts/send-weixin.mjs`
- `~/.claude-to-im/scripts/ask-weixin.mjs`