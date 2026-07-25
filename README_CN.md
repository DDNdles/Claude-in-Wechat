# Claude in WeChat v0.2.0

> 🔷 轻量化可接入微信的 Claude Code 远程项目管理桌面应用

[English](README.md) | [更新日志](CHANGELOG.md)

**Claude in WeChat** 是一个桌面应用，将微信与本地 Claude Code 桥接，让你可以通过手机监控项目进度、下达任务、做出决策——类似于千问、豆包、Kimi 等手机 AI 应用，但由你自己的本地 Claude Code 驱动。

---

## 工作原理

```
你 (微信手机端)                    桌面端 (Windows 11)
      │                                     │
      │  /list, /new, /check, /token        │
      ├────────────────────────────────────►│
      │                                     ├── 项目管理器 (CRUD)
      │                                     ├── 微信中继服务
      │                                     ├── Claude Code 调度器
      │                                     │
      │            "收到" + 响应             │
      │◄────────────────────────────────────┤
      │                                     │
      │  任务描述                           │
      ├────────────────────────────────────►│
      │                                     ├── 启动 Claude Code
      │                                     │   └── Hooks → 决策 → 微信
      │◄─────── 决策提示 ──────────────────┤
      │  回复 "1"                           │
      ├────────────────────────────────────►│
      │                                     └── Claude 继续执行
```

## 功能特点

- **📱 微信远程控制** — 通过微信进行完整项目管理：创建、列表、进度、Token、决策
- **🖥️ 桌面可视化** — 仪表盘显示项目卡片、进度条、Token 图表、实时状态
- **🤖 多项目调度** — 每个项目独立运行 Claude Code 进程
- **📊 进度追踪** — 自动检测 Claude 输出的任务清单，估算完成进度
- **💰 Token 监控** — 按项目统计 Token 用量，估算费用
- **🔐 决策转发** — Claude 的 AskUserQuestion 发送到微信，回复数字即可
- **⚡ 开机自启** — Windows 开机自动启动，最小化到系统托盘
- **📦 打包安装** — 单个 .exe 安装包，简单部署

## 前置要求

- **Windows 11**（主要平台）
- **Node.js >= 20**
- **Claude Code CLI** 已安装并认证（`claude` 命令可用）
- **微信账户** 已通过 claude-to-im 扫码绑定

## 快速开始

### 1. 安装

从 [GitHub Releases](https://github.com/YOUR_USER/Claude-in-Wechat/releases) 下载最新安装包:

```
Claude-in-Wechat-Setup-0.2.0.exe
```

或从源码构建:

```bash
git clone https://github.com/YOUR_USER/Claude-in-Wechat.git
cd Claude-in-Wechat
npm install
npm run electron:dev
```

### 2. 配置

首次运行的设置向导会引导你完成:
1. 微信扫码绑定
2. Claude Code CLI 验证
3. Hook 安装（用于决策转发）

### 3. 开始使用

在微信上向已绑定的机器人发送以下命令:

| 命令 | 说明 |
|------|------|
| `/list` | 列出所有项目及状态 |
| `/new 项目名` | 创建新项目 |
| `/open 项目名` | 打开并激活项目 |
| `/delete 项目名` | 删除项目 |
| `/rename 旧名 新名` | 重命名项目 |
| `/check 项目名` | 查看项目进度 |
| `/token 项目名` | 查看 Token 用量 |
| 文字消息 | 向活跃项目的 Claude Code 发送任务 |
| 数字回复 | 回答决策提示 |

## 微信命令详解

### `/list` — 列出项目
```
📁 项目列表：

1. my-app — 🟢 运行中 | 进度 67% | 12.3K tokens
2. api-server — ⚪ 空闲 | 45.1K tokens
3. website — ✅ 已完成 | 89.2K tokens
```

### `/new 项目名` — 创建项目
在 `~/projects/Wechat/项目名/` 创建新项目文件夹。
```
✅ 项目「项目名」已创建
请回复你想让我做什么
```

### `/open 项目名` — 打开项目
激活项目并启动 Claude Code。
```
✅ 已打开项目「项目名」
你现在可以直接发消息给 Claude Code
```

### `/check 项目名` — 查看进度
显示详细进度，包含任务清单和进度条。
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

### `/token 项目名` — Token 统计
```
💰 my-app Token使用:
本次会话: 45,230 tokens
今日总计: 128,500 tokens
估算费用: ~$0.39
```

## 项目结构

```
Claude-in-Wechat/
├── electron/                 # Electron 主进程
│   ├── main.ts               # 应用入口、窗口、托盘
│   ├── preload.ts            # IPC 桥接
│   ├── ipc/                  # IPC 处理器
│   └── services/             # 核心服务
│       ├── project-manager.ts    # 项目管理
│       ├── relay-service.ts      # 微信中继
│       ├── cc-orchestrator.ts    # Claude Code 调度
│       ├── progress-tracker.ts   # 进度追踪
│       ├── config-service.ts     # 配置管理
│       └── auto-starter.ts       # 开机自启
├── src/                      # React 前端
│   ├── App.tsx
│   ├── components/
│   │   ├── layout/           # 布局、侧边栏
│   │   ├── dashboard/        # 项目卡片、进度
│   │   ├── project/          # 详情、任务清单
│   │   ├── settings/         # 设置面板
│   │   ├── wizard/           # 设置向导
│   │   └── common/           # 通用组件
│   └── stores/               # Zustand 状态管理
├── shared/                   # 共享类型
├── scripts/                  # 安装和构建脚本
├── vendor/                   # 内嵌 weixin-global-integration
└── assets/                   # 图标资源
```

## 开发

```bash
# 安装依赖
npm install

# 开发模式运行
npm run electron:dev

# 生产构建
npm run build

# 打包 Windows 安装包
npm run electron:build:win

# 运行测试
npm test
```

## 技术栈

| 组件 | 技术 |
|------|------|
| 桌面框架 | Electron 33+ |
| 前端 | React 18 + TypeScript |
| 样式 | Tailwind CSS 3 |
| 状态管理 | Zustand |
| 图表 | Recharts |
| 打包 | electron-builder (NSIS) |

## 相关项目

- [claude-to-im](https://github.com/op7418/Claude-to-IM-skill) — Claude Code IM 桥接 Skill
- [wechat-claude-code](https://www.npmjs.com/package/wechat-claude-code) — 类似的 Electron 桌面应用
- [nexu](https://github.com/nexu-io/nexu) — OpenClaw 桌面客户端

## 许可

MIT

## 更新日志

见 [CHANGELOG.md](CHANGELOG.md)
