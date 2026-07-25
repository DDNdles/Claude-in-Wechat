# Claude Code PreToolUse hook — intercept AskUserQuestion + dangerous ops
# Called by Claude Code before every tool use
param($toolName, $toolInput)

$eventsFile = Join-Path $env:USERPROFILE ".claude-in-wechat\runtime\hook-events.jsonl"

try {
  $input = $toolInput | ConvertFrom-Json

  if ($toolName -eq "AskUserQuestion") {
    $event = @{
      type = "ask_user_question"
      tool = $toolName
      questions = $input.questions
      timestamp = (Get-Date -Format "o")
    } | ConvertTo-Json -Compress
    Add-Content -Path $eventsFile -Value $event -Encoding UTF8
  }

  # Check for dangerous operations
  $dangerous = $false
  $reason = ""

  if ($toolName -eq "Bash") {
    $cmd = $input.command -join " "
    if ($cmd -match "rm\s+-rf|git\s+push\s+--force|DROP\s+TABLE|npm\s+unpublish|terraform\s+destroy|docker\s+rm|format\s+/[a-z]") {
      $dangerous = $true
      $reason = "危险命令: $cmd"
    }
  }

  if ($dangerous) {
    $event = @{
      type = "dangerous_operation"
      tool = $toolName
      reason = $reason
      timestamp = (Get-Date -Format "o")
    } | ConvertTo-Json -Compress
    Add-Content -Path $eventsFile -Value $event -Encoding UTF8

    # Deny by default for dangerous ops (user must approve via WeChat)
    Write-Output '{"decision":"deny","reason":"危险操作需要微信确认"}'
    exit 2
  }

  # Allow all other tools
  exit 0
} catch {
  exit 0
}
