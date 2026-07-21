# weixin-global-integration

Claude Code 的全局微信集成 — 通过 hooks 拦截工具调用、转发问题到微信、汇报进度。

## 功能

| 功能 | 说明 |
|------|------|
| 🔐 **危险操作门控** | 拦截危险 Bash/Write/Edit 操作，发送微信确认 |
| ❓ **AskUserQuestion → 微信** | Claude 问问题时，你可以在微信上回复，不需要在电脑前 |
| ✅ **完成通知** | Claude 回复完成后，微信收到通知 |
| 📊 **查询进度** | 在微信回复「查询进度」获取当前状态摘要 |

## 架构

```
Claude Code
  │
  ├── PreToolUse hook
  │     ├── hook-ask-user.mjs → AskUserQuestion → 微信问答
  │     └── hook-guard.mjs    → 危险操作 → 微信确认
  │                            → 写入 progress-state.json
  │
  ├── Stop hook
  │     └── hook-notify.mjs   → 发送完成通知到微信
  │
  └── Progress Daemon (后台)
        └── 轮询微信 "查询进度" → 读取 progress-state.json → 回复摘要
```

## 前置条件

- [Node.js](https://nodejs.org/) >= 20
- 已安装 [Claude Code](https://claude.ai/code)
- 已通过 `claude-to-im` 链接微信账户（`/claude-to-im setup`）

## 快速安装

```bash
node ~/.claude/skills/weixin-global-integration/install.js
```

### 安装选项

```bash
node install.js --dry-run         # 预览变更不实际执行
node install.js --no-daemon       # 不启动进度守护进程
node install.js --skip-settings   # 不修改 settings.json（手动配置）
```

安装程序会：
1. 验证 Node.js >= 20 和微信账户
2. 复制脚本到 `~/.weixin-global-integration/`
3. 备份 `~/.claude/settings.json`
4. 合并 hook 配置
5. 启动进度守护进程（除非 `--no-daemon`）
6. 发送测试消息到微信

## 使用方法

### 微信指令

| 消息 | 回复 |
|------|------|
| `查询进度` | 当前 Claude Code 进度摘要 |
| 数字回复 | 回答决策或问题 |

### 命令行

```bash
# 进度守护进程管理
node ~/.weixin-global-integration/daemon/progress-daemon.mjs start
node ~/.weixin-global-integration/daemon/progress-daemon.mjs stop
node ~/.weixin-global-integration/daemon/progress-daemon.mjs status

# 一次性进度查询
node ~/.weixin-global-integration/scripts/query-progress.mjs
node ~/.weixin-global-integration/scripts/query-progress.mjs --json

# 手动发送消息
node ~/.weixin-global-integration/scripts/send-weixin.mjs "来自 Claude 的问候！"

# 决策轮询
node ~/.weixin-global-integration/scripts/ask-weixin.mjs "选哪个？" "方案A" "方案B"
```

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `WXG_NOTIFY_ENABLED` | `1` | 设为 `0` 禁用完成通知 |
| `WXG_ASK_TIMEOUT` | `120` | AskUserQuestion 超时秒数 |
| `WXG_TIMEOUT` | `120` | 危险操作门控超时秒数 |
| `WXG_ALLOW_LIST` | (空) | 逗号分隔的白名单命令模式 |
| `WXG_DEFAULT_ACTION` | `block` | 超时默认操作：`block` 或 `allow` |
| `WXG_NOTIFY_TEMPLATE` | `✅ Claude Code 已完成回复 — {folder}` | 通知模板 |

## 工作原理

### 1. 危险操作门控 (hook-guard.mjs)

当 Claude 尝试危险命令（如 `rm -rf`、`git push --force`、`DROP TABLE`），PreToolUse hook 拦截并发送确认：

```
[决策] ⚠️ 危险操作: 删除生产数据库

1. ✅ 允许: npm run db:drop --production
2. ❌ 阻止

回复数字序号即可 (120s 后超时)
```

回复 `1` 允许，`2` 阻止。超时默认阻止。

### 2. AskUserQuestion → 微信 (hook-ask-user.mjs)

Claude 使用 AskUserQuestion 工具时，hook 拦截并发送到微信：

```
[提问] 架构: 应该用哪种方案？

1. 单体 — 更简单
2. 微服务 — 更灵活
3. Monorepo — 共享类型

回复数字序号即可 (120s 后超时)
```

回复结果反馈给 Claude，Claude 据此继续工作。

### 3. 进度查询

进度守护进程持续轮询微信。回复「查询进度」获取：

```
📊 Claude Code 进度摘要

🟢 当前活动 (2 分钟前):
   操作: 编写 README.md 文件
   目录: weixin-global-integration

(由 weixin-global-integration 自动生成)
```

## 相关项目

- [weixin-decision](./weixin-decision/) — 显式决策 skill，用于临时微信查询（已包含在本仓库中）
- [claude-to-im](https://github.com/op7418/Claude-to-IM-skill) — 完整 IM 桥接 daemon，手机端访问 Claude（本地版本与上游一致，无自改）

## 授权

MIT