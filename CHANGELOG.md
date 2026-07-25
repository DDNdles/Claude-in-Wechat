# Changelog

## v0.4.1 (2026-07-25)

### 🔧 Critical Fixes
- **Electron API unavailable bug** — Fixed two root causes:
  1. `resolveEntryHtml()` was loading stale `dist/index.html` as a plain file instead of Vite dev server, causing page to load without Electron context
  2. IPC handlers registered with `null` mainWindow (called `registerAllIpcHandlers(mainWindow!)` before `mainWindow = createMainWindow()`)
- **CSP blocked localhost** — Updated Content-Security-Policy in `index.html` to allow `http://localhost:*` and `ws://localhost:*`

---

## v0.4.0 (2026-07-25)

### 🚀 New Features
- **WeChat Message Relay** — Real-time polling of WeChat messages via iLink Bot API, with cursor-based deduplication
- **Command Handler** — Full support for `/list`, `/new`, `/open`, `/delete`, `/rename`, `/check`, `/token`, `/help` commands from WeChat
- **WeChat Message Sender** — Direct iLink API integration for sending messages, with auto-splitting for long messages and context token management
- **Hook Events Watcher** — Monitors hook-events.jsonl for AskUserQuestion events, session stops, and dangerous operation alerts
- **Decision Forwarding** — Pending decision queue matches WeChat numeric replies to AskUserQuestion prompts

### 🔧 Fixes
- **WeChat Bridge** — Rewritten to use internal relay-service instead of solely depending on claude-to-im daemon
- **RelayStore Zustand bug** — Fixed async function being called inside synchronous `set()` — now properly awaited with `get()`
- **ProjectStore auto-refresh** — Added 5-second polling for real-time project status updates
- **App startup** — Fixed settings loading race condition that always showed setup wizard
- **ProjectCard** — Fixed API response type handling for claude terminal launcher
- **IPC handlers** — Added relay control handlers (start/stop/status/send-message/pending-decisions)

### 🔄 Changed
- Main process now auto-starts the relay service on app launch and cleans up on quit
- electron-builder.yml updated to include vendor hook scripts in packaged app
- All version references updated from v0.3.0/v0.2.0 to v0.4.0
- wechat-bridge.ts now delegates status/start/stop to relay-service internally

### 📦 Architecture
- **4 new services** in `electron/services/`: `relay-service.ts`, `command-handler.ts`, `wechat-sender.ts`, `hook-events-watcher.ts`
- Direct iLink Bot API integration using `fetch()` — works without claude-to-im daemon running
- Uses existing weixin-global-integration hooks for AskUserQuestion interception

---

## v0.3.0 (2026-07-25)

### 🚀 New Features
- **Full rewrite** — Real functionality, no mock data
- **Project Manager** — Real filesystem CRUD at `~/projects/Wechat/` with JSON registry
- **Claude Launcher** — Opens real terminal windows running Claude Code via `start` command
- **WeChat Bridge** — Integration with claude-to-im daemon
- **Hooks Manager** — Installs PreToolUse/Stop hooks from vendor/ or weixin-global-integration
- **Settings Panel** — Full settings management with persistent storage
- **Setup Wizard** — Guided first-run configuration

### 🔧 Fixes
- Fixed entry HTML resolution for dev/production modes
- Fixed relay service auto-start in dev mode
- Fixed Vite watch ignore patterns

---

## v0.2.0 (2026-07-25)

### 🚀 New Features
- **Electron Desktop GUI** — Visual dashboard with project management interface
- **Project Cards** — Each project shows name, status, progress bar, and token usage
- **Progress Tracking** — Auto-detects task lists from Claude Code output
- **Token Monitoring** — Per-project token usage with cost estimation
- **WeChat Command System** — Full support for `/list`, `/new`, `/open`, `/delete`, `/rename`, `/check`, `/token`
- **Decision Forwarding** — Claude's AskUserQuestion prompts routed to WeChat with numbered options
- **Multi-Project Orchestration** — Independent Claude Code processes per project
- **Setup Wizard** — Guided first-run configuration (WeChat binding + Claude Code setup)
- **System Tray** — Minimize to tray, quick access menu
- **Auto-Start** — Windows registry startup configuration
- **Settings Panel** — GUI for all configuration options
- **Windows NSIS Installer** — Single .exe for easy deployment

### 🔄 Changed
- Complete rewrite from v0.1 skill-based architecture
- Project storage moved to `~/projects/Wechat/` with JSON registry
- WeChat relay integrated into Electron main process (was standalone daemon)
- All services rewritten in TypeScript for type safety

### 📦 Packaging
- electron-builder with NSIS target for Windows
- Smart ASAR unpacking for hook scripts
- Auto-update support via GitHub Releases

---

## v0.1.0 (2026-07-21)

### Initial Release
- WeChat global integration hooks for Claude Code
- Progress daemon polling WeChat for "查询进度"
- AskUserQuestion redirection to WeChat
- Dangerous operation gating via WeChat confirmation
- Project context tracking
- Basic CLI installation script

### Components
- `weixin-client.mjs` — WeChat iLink Bot API client
- `hook-ask-user.mjs` — AskUserQuestion interception
- `hook-guard.mjs` — Dangerous operation gating
- `hook-notify.mjs` — Completion notifications
- `progress-daemon.mjs` — Background progress polling
- `install.js` — One-click setup script