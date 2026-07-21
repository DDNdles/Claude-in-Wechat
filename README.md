# weixin-global-integration

Global WeChat integration for Claude Code — hooks that intercept tool calls, redirect questions, and report progress via WeChat.

## Features

| Feature | Description |
|---------|-------------|
| 🔐 **Danger Gate** | Intercepts dangerous Bash/Write/Edit operations, sends confirmation to WeChat |
| ❓ **AskUserQuestion → WeChat** | When Claude asks you a question, you can answer on WeChat instead of the terminal |
| ✅ **Completion Notifications** | Receive a WeChat message when Claude finishes responding |
| 📊 **Progress Query** | Reply "查询进度" on WeChat to get a status summary |

## Architecture

```
Claude Code
  │
  ├── PreToolUse hook
  │     ├── hook-ask-user.mjs → AskUserQuestion → WeChat Q&A
  │     └── hook-guard.mjs    → dangerous ops → WeChat confirm
  │                            → writes progress-state.json
  │
  ├── Stop hook
  │     └── hook-notify.mjs   → sends "completed" to WeChat
  │
  └── Progress Daemon (background)
        └── polls WeChat for "查询进度" → reads progress-state.json → replies
```

## Prerequisites

- [Node.js](https://nodejs.org/) >= 20
- [Claude Code](https://claude.ai/code) installed
- WeChat bot account linked via `claude-to-im` (`/claude-to-im setup`)

## Quick Install

```bash
# From the skill directory
node ~/.claude/skills/weixin-global-integration/install.js

# Or clone and install
git clone <repo-url>
cd weixin-global-integration
node install.js
```

### Install options

```bash
node install.js --dry-run         # Preview without making changes
node install.js --no-daemon       # Don't start the progress daemon
node install.js --skip-settings   # Don't modify settings.json (manual config)
```

The installer:
1. Validates Node.js >= 20 and WeChat account
2. Copies scripts to `~/.weixin-global-integration/`
3. Backs up `~/.claude/settings.json`
4. Merges hook configurations
5. Starts the progress daemon (unless `--no-daemon`)
6. Sends a test message to your WeChat

## Usage

### WeChat Commands

| Message | Response |
|---------|----------|
| `查询进度` | Current Claude Code progress summary |
| Numbered reply | Answer to a decision or question |

### CLI Commands

```bash
# Progress daemon management
node ~/.weixin-global-integration/daemon/progress-daemon.mjs start
node ~/.weixin-global-integration/daemon/progress-daemon.mjs stop
node ~/.weixin-global-integration/daemon/progress-daemon.mjs status

# One-shot progress query
node ~/.weixin-global-integration/scripts/query-progress.mjs
node ~/.weixin-global-integration/scripts/query-progress.mjs --json

# Send a message manually
node ~/.weixin-global-integration/scripts/send-weixin.mjs "Hello from Claude!"

# Decision polling
node ~/.weixin-global-integration/scripts/ask-weixin.mjs "Question?" "Option A" "Option B"
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `WXG_NOTIFY_ENABLED` | `1` | Set to `0` to disable Stop notifications |
| `WXG_ASK_TIMEOUT` | `120` | AskUserQuestion timeout in seconds |
| `WXG_TIMEOUT` | `120` | Danger gate timeout in seconds |
| `WXG_ALLOW_LIST` | (empty) | Comma-separated patterns for always-allowed commands |
| `WXG_DEFAULT_ACTION` | `block` | Action on timeout: `block` or `allow` |
| `WXG_NOTIFY_TEMPLATE` | `✅ Claude Code 已完成回复 — {folder}` | Notification template |

## Directory Structure

```
~/.weixin-global-integration/
├── lib/
│   └── weixin-client.mjs          # Shared WeChat API client
├── hooks/
│   ├── hook-guard.mjs             # PreToolUse: dangerous operation gate
│   ├── hook-ask-user.mjs          # PreToolUse: AskUserQuestion interception
│   └── hook-notify.mjs            # Stop: completion notification
├── scripts/
│   ├── ask-weixin.mjs             # Decision polling script
│   ├── send-weixin.mjs            # One-way notification
│   └── query-progress.mjs         # One-shot progress query
└── daemon/
    └── progress-daemon.mjs        # Background daemon for "查询进度"
```

## How It Works

### 1. Danger Gate (hook-guard.mjs)

When Claude tries a dangerous command (e.g., `rm -rf`, `git push --force`, `DROP TABLE`), the PreToolUse hook intercepts it and sends a confirmation message to WeChat:

```
[决策] ⚠️ 危险操作: Delete production database

1. ✅ 允许: npm run db:drop --production
2. ❌ 阻止

回复数字序号即可 (120s 后超时)
```

Reply `1` to allow or `2` to block. If no reply within the timeout, the command is blocked by default.

### 2. AskUserQuestion → WeChat (hook-ask-user.mjs)

When Claude uses the `AskUserQuestion` tool (e.g., asking "Which approach should I use?"), the hook intercepts and sends it to WeChat:

```
[提问] Architecture: Which approach should I use?

1. Monolith — Easier to start
2. Microservices — Better scalability
3. Monorepo — Shared types

回复数字序号即可 (120s 后超时)
```

Your reply is fed back to Claude, which continues based on your answer.

### 3. Progress Query

The progress daemon continuously polls WeChat. Reply "查询进度" to get:

```
📊 Claude Code 进度摘要

🟢 当前活动 (2 分钟前):
   操作: 编写 README.md 文件
   目录: weixin-global-integration

(由 weixin-global-integration 自动生成)
```

## Related

- [weixin-decision](../weixin-decision/) — Explicit decision skill for ad-hoc WeChat queries
- [claude-to-im](../claude-to-im/) — Full IM bridge daemon for mobile Claude access

## License

MIT