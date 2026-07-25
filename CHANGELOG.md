# Changelog

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
