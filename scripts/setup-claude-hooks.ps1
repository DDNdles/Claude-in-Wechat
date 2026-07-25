# Claude in WeChat — Claude Code Hooks Setup
# Configures the necessary hooks in ~/.claude/settings.json

$ErrorActionPreference = "Stop"
$HOME = $env:USERPROFILE
$SETTINGS_FILE = "$HOME\.claude\settings.json"
$HOOKS_DIR = "$HOME\.claude-in-wechat\hooks"
$BACKUP_FILE = "$SETTINGS_FILE.bak.claude-in-wechat"

Write-Host "════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Claude in WeChat — Hooks 配置脚本" -ForegroundColor Cyan
Write-Host "════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# Step 1: Backup
Write-Host "[1/3] 备份现有设置..." -ForegroundColor Yellow
if (Test-Path $SETTINGS_FILE) {
    Copy-Item $SETTINGS_FILE $BACKUP_FILE -Force
    Write-Host "  ✓ 已备份到 settings.json.bak.claude-in-wechat" -ForegroundColor Green
} else {
    Write-Host "  ⚠ settings.json 不存在，将创建新的" -ForegroundColor Yellow
    $initial = @{ permissions = @{ allow = @("Bash(*)", "Read(*)", "Write(*)", "Edit(*)") } }
    $initial | ConvertTo-Json -Depth 10 | Set-Content $SETTINGS_FILE
}

# Step 2: Read and modify
Write-Host "[2/3] 配置 Hooks..." -ForegroundColor Yellow
try {
    $settings = Get-Content $SETTINGS_FILE -Raw | ConvertFrom-Json
} catch {
    Write-Host "  ✗ 无法解析 settings.json" -ForegroundColor Red
    exit 1
}

# Ensure hooks directory
if (-not (Test-Path $HOOKS_DIR)) {
    New-Item -ItemType Directory -Path $HOOKS_DIR -Force | Out-Null
}

# Build hook configuration
$hooksConfig = @{
    PreToolUse = @(
        @{
            hooks = @(
                @{
                    command = "node `"$HOOKS_DIR\hook-ask-user.mjs`""
                    timeout = 300
                    type = "command"
                },
                @{
                    command = "node `"$HOOKS_DIR\hook-guard.mjs`""
                    timeout = 300
                    type = "command"
                }
            )
        }
    )
    PostToolUse = @(
        @{
            hooks = @(
                @{
                    command = "node `"$HOOKS_DIR\hook-error-notify.mjs`""
                    timeout = 15
                    type = "command"
                }
            )
        }
    )
    Stop = @(
        @{
            hooks = @(
                @{
                    command = "node `"$HOOKS_DIR\hook-notify.mjs`""
                    timeout = 15
                    type = "command"
                }
            )
        }
    )
}

# Merge hooks into settings
if (-not $settings.hooks) {
    $settings | Add-Member -NotePropertyName "hooks" -NotePropertyValue $hooksConfig -Force
} else {
    $settings.hooks.PreToolUse = $hooksConfig.PreToolUse
    $settings.hooks.PostToolUse = $hooksConfig.PostToolUse
    $settings.hooks.Stop = $hooksConfig.Stop
}

$settings | ConvertTo-Json -Depth 10 | Set-Content $SETTINGS_FILE
Write-Host "  ✓ Hooks 已配置" -ForegroundColor Green
Write-Host "    - PreToolUse: AskUserQuestion 转发 + 危险操作确认" -ForegroundColor White
Write-Host "    - PostToolUse: 错误通知" -ForegroundColor White
Write-Host "    - Stop: 完成通知" -ForegroundColor White

# Step 3: Verify
Write-Host "[3/3] 验证..." -ForegroundColor Yellow
Write-Host ""
Write-Host "════════════════════════════════════════" -ForegroundColor Green
Write-Host "  ✅ Hooks 配置完成！" -ForegroundColor Green
Write-Host "  备份文件: $BACKUP_FILE" -ForegroundColor Green
Write-Host "  现在可以在微信上接收 Claude Code 的通知了" -ForegroundColor Green
Write-Host "════════════════════════════════════════" -ForegroundColor Green
