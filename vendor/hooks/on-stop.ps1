# Claude Code Stop hook — notify when session ends
param($sessionId, $projectPath)

$eventsFile = Join-Path $env:USERPROFILE ".claude-in-wechat\runtime\hook-events.jsonl"

try {
  $event = @{
    type = "session_stop"
    sessionId = $sessionId
    projectPath = $projectPath
    timestamp = (Get-Date -Format "o")
  } | ConvertTo-Json -Compress

  Add-Content -Path $eventsFile -Value $event -Encoding UTF8
  exit 0
} catch {
  exit 0
}
