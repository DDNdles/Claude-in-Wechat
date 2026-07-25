# Claude in WeChat v0.4.0

> 🔷 轻量化可接入微信的 Claude Code 远程项目管理桌面应用

[中文文档](README_CN.md) | [Changelog](CHANGELOG.md)

**Claude in WeChat** is a desktop application that bridges WeChat (微信) with your local Claude Code, allowing you to monitor progress, dispatch tasks, and make decisions from your phone — similar to commercial AI chat apps, but powered by your own Claude Code running locally.

---

## How It Works

```
You (WeChat on phone)                Desktop (Windows 11)
      │                                     │
      │  /list, /new, /check, /token        │
      ├────────────────────────────────────►│
      │                                     ├── Project Manager (CRUD)
      │                                     ├── WeChat Relay Service
      │                                     ├── Claude Code Orchestrator
      │                                     │
      │            "收到" + response         │
      │◄────────────────────────────────────┤
      │                                     │
      │  Task description                   │
      ├────────────────────────────────────►│
      │                                     ├── Spawns Claude Code
      │                                     │   └── Hooks → decisions → WeChat
      │◄─────── Decision prompt ────────────┤
      │  Reply "1"                          │
      ├────────────────────────────────────►│
      │                                     └── Claude continues
```

## Features

- **📱 WeChat Remote Control** — Full project management via WeChat: create, list, check progress, view tokens, make decisions
- **🖥️ Desktop GUI** — Visual dashboard with project cards, progress bars, token charts, and real-time status
- **🤖 Multi-Project Orchestration** — Each project gets its own independent Claude Code process
- **📊 Progress Tracking** — Auto-detects task lists from Claude output, estimates completion progress
- **💰 Token Monitoring** — Per-project token usage tracking with cost estimation
- **🔐 Decision Forwarding** — Claude's AskUserQuestion prompts are sent to WeChat, you reply with a number
- **⚡ Auto-Start** — Runs on Windows startup, minimizes to system tray
- **📦 Packaged Installer** — Single .exe installer for easy deployment

## Prerequisites

- **Windows 11** (primary platform; macOS/Linux may work with adjustments)
- **Node.js >= 20**
- **Claude Code CLI** installed and authenticated (`claude` command)
- **WeChat account** linked via claude-to-im QR login

## Quick Start

### 1. Install

Download the latest installer from [GitHub Releases](https://github.com/YOUR_USER/Claude-in-Wechat/releases):

```
Claude-in-Wechat-Setup-0.4.0.exe
```

Or build from source:

```bash
git clone https://github.com/YOUR_USER/Claude-in-Wechat.git
cd Claude-in-Wechat
npm install
npm run electron:dev
```

### 2. Setup

The first-run setup wizard will guide you through:
1. WeChat QR code binding
2. Claude Code CLI verification
3. Hook installation (for decision forwarding)

### 3. Start Using

On WeChat, send these commands to your linked bot:

| Command | Description |
|---------|-------------|
| `/list` | List all projects with status |
| `/new project-name` | Create a new project |
| `/open project-name` | Open and activate a project |
| `/delete project-name` | Delete a project |
| `/rename old new` | Rename a project |
| `/check project-name` | Check project progress |
| `/token project-name` | View token usage |
| Text message | Send task to active project's Claude Code |
| Number reply | Answer a decision prompt |

## WeChat Commands Reference

### `/list`
Lists all registered projects with their status and progress.
```
📁 项目列表：

1. my-app — 🟢 运行中 | 进度 67% | 12.3K tokens
2. api-server — ⚪ 空闲 | 45.1K tokens
3. website — ✅ 已完成 | 89.2K tokens
```

### `/new project-name`
Creates a new project folder at `~/projects/Wechat/project-name/` and registers it.
```
✅ 项目「project-name」已创建
请回复你想让我做什么
```

### `/open project-name`
Activates a project and starts Claude Code for it.
```
✅ 已打开项目「project-name」
你现在可以直接发消息给 Claude Code
```

### `/check project-name`
Shows detailed progress with task list and progress bar.
```
📊 my-app 进度
🟢 活跃操作: API开发
任务清单:
✅ 1/5 初始化项目
✅ 2/5 数据库设计
🔄 3/5 API开发
⬜ 4/5 前端页面
⬜ 5/5 测试
进度: ██████░░░░ 60%
```

### `/token project-name`
Shows token usage statistics.
```
💰 my-app Token使用:
本次会话: 45,230 tokens
今日总计: 128,500 tokens
估算费用: ~$0.39
```

## Project Structure

```
Claude-in-Wechat/
├── electron/                 # Electron main process
│   ├── main.ts               # App entry, window, tray
│   ├── preload.ts            # IPC bridge
│   ├── ipc/                  # IPC handlers
│   └── services/             # Core services
│       ├── project-manager.ts
│       ├── relay-service.ts
│       ├── cc-orchestrator.ts
│       ├── progress-tracker.ts
│       ├── config-service.ts
│       └── auto-starter.ts
├── src/                      # React frontend
│   ├── App.tsx
│   ├── components/
│   │   ├── layout/           # Layout, sidebar
│   │   ├── dashboard/        # Project cards, progress
│   │   ├── project/          # Detail, task list
│   │   ├── settings/         # Settings panel
│   │   ├── wizard/           # Setup wizard
│   │   └── common/           # Shared components
│   └── stores/               # Zustand state
├── shared/                   # Shared types
├── scripts/                  # Setup & build scripts
├── vendor/                   # Vendored weixin-global-integration
└── assets/                   # Icons and images
```

## Architecture

```
┌─────────────────────────────────────────┐
│         Electron Desktop App            │
│  ┌──────────────┐  ┌────────────────┐   │
│  │ React GUI    │  │ Main Process   │   │
│  │ (renderer)   │  │                │   │
│  │              │  │ • Project Mgr  │   │
│  │ Dashboard    │  │ • WeChat Relay │   │
│  │ Settings     │◄─┤ • CC Orchestr. │   │
│  │ Setup Wizard │  │ • Config Svc   │   │
│  └──────────────┘  └───────┬────────┘   │
│                            │             │
└────────────────────────────┼─────────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
        ┌─────────┐  ┌──────────┐  ┌───────────┐
        │Projects │  │ WeChat   │  │ Claude    │
        │~/proj.. │  │ iLink API│  │ Code CLI  │
        │/Wechat/ │  │          │  │ processes │
        └─────────┘  └──────────┘  └───────────┘
```

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run electron:dev

# Build for production
npm run build

# Package as Windows installer
npm run electron:build:win

# Run tests
npm test
```

## Technology Stack

| Component | Technology |
|-----------|-----------|
| Desktop Shell | Electron 33+ |
| Frontend | React 18 + TypeScript |
| Styling | Tailwind CSS 3 |
| State | Zustand |
| Charts | Recharts |
| Packaging | electron-builder (NSIS) |

## Related Projects

- [claude-to-im](https://github.com/op7418/Claude-to-IM-skill) — IM bridge skill for Claude Code
- [wechat-claude-code](https://www.npmjs.com/package/wechat-claude-code) — Similar Electron desktop app
- [nexu](https://github.com/nexu-io/nexu) — Desktop client for OpenClaw

## License

MIT

## Changelog

See [CHANGELOG.md](CHANGELOG.md)
