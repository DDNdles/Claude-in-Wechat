---
name: weixin-global-integration
description: >
  Global WeChat integration hooks for Claude Code. Intercepts AskUserQuestion
  and redirects to WeChat; gates dangerous Bash/Write/Edit operations via
  WeChat confirmation; sends completion notifications; responds to "查询进度"
  on WeChat with progress summary. Triggers on: "微信", "weixin", "查询进度",
  "permission", "AskUserQuestion", any dangerous tool call.
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
---