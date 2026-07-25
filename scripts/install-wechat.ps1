# Claude in WeChat — WeChat Binding Script
# One-click script to verify and setup WeChat connection for Claude in WeChat
# Requires: Node.js >= 20, claude-to-im skill installed

param(
    [switch]$Force = $false
)

$ErrorActionPreference = "Stop"
$HOME = $env:USERPROFILE
$CTI_HOME = "$HOME\.claude-to-im"
$ACCOUNTS_FILE = "$CTI_HOME\data\weixin-accounts.json"

Write-Host "════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Claude in WeChat — 微信绑定脚本" -ForegroundColor Cyan
Write-Host "════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# Step 1: Check Node.js
Write-Host "[1/4] 检查 Node.js..." -ForegroundColor Yellow
try {
    $nodeVersion = node --version 2>&1
    Write-Host "  ✓ Node.js $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "  ✗ Node.js 未安装或不在 PATH 中" -ForegroundColor Red
    Write-Host "  请从 https://nodejs.org 下载 Node.js >= 20" -ForegroundColor Red
    exit 1
}

# Step 2: Check claude-to-im skill
Write-Host "[2/4] 检查 claude-to-im skill..." -ForegroundColor Yellow
$SKILL_DIR = "$HOME\.claude\skills\claude-to-im"
if (-not (Test-Path $SKILL_DIR)) {
    Write-Host "  ✗ claude-to-im skill 未安装" -ForegroundColor Red
    Write-Host "  请在 Claude Code 中运行: /claude-to-im setup" -ForegroundColor Yellow
    exit 1
}
Write-Host "  ✓ claude-to-im skill 已安装" -ForegroundColor Green

# Step 3: Check existing WeChat account
Write-Host "[3/4] 检查微信账户..." -ForegroundColor Yellow
if (Test-Path $ACCOUNTS_FILE) {
    try {
        $accounts = Get-Content $ACCOUNTS_FILE -Raw | ConvertFrom-Json
        if ($accounts.Count -gt 0) {
            $name = if ($accounts[0].name) { $accounts[0].name } else { "未知" }
            Write-Host "  ✓ 已找到微信账户: $name" -ForegroundColor Green
            if (-not $Force) {
                Write-Host ""
                Write-Host "════════════════════════════════════════" -ForegroundColor Green
                Write-Host "  ✅ 微信绑定已完成！" -ForegroundColor Green
                Write-Host "  账户: $name" -ForegroundColor Green
                Write-Host "  你现在可以使用 Claude in WeChat 了" -ForegroundColor Green
                Write-Host "════════════════════════════════════════" -ForegroundColor Green
                exit 0
            }
            Write-Host "  Force 模式: 将重新绑定" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "  ⚠ 无法解析账户文件，将重新绑定" -ForegroundColor Yellow
    }
} else {
    Write-Host "  ℹ 未找到微信账户" -ForegroundColor Yellow
}

# Step 4: Run QR login
Write-Host "[4/4] 启动微信扫码登录..." -ForegroundColor Yellow
Write-Host ""
Write-Host "  即将打开微信扫码页面..." -ForegroundColor White
Write-Host "  请用微信扫描二维码完成绑定" -ForegroundColor White
Write-Host ""

try {
    Push-Location $SKILL_DIR
    npm run weixin:login 2>&1
    Pop-Location

    if (Test-Path $ACCOUNTS_FILE) {
        Write-Host ""
        Write-Host "════════════════════════════════════════" -ForegroundColor Green
        Write-Host "  ✅ 微信绑定成功！" -ForegroundColor Green
        Write-Host "════════════════════════════════════════" -ForegroundColor Green
    } else {
        Write-Host "  ⚠ 扫码可能未完成，请重试" -ForegroundColor Yellow
        exit 1
    }
} catch {
    Write-Host "  ✗ 扫码失败: $_" -ForegroundColor Red
    Write-Host "  请手动运行: cd $SKILL_DIR && npm run weixin:login" -ForegroundColor Yellow
    exit 1
}
