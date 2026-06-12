# SuperRoo — Register Windows Task Scheduler jobs for ML auto-training
# Run once as Administrator to set up recurring ML training and VPS sync.
#
# Tasks created:
#   SuperRoo-ML-Train   — Every 6 hours: retrain central ML on accumulated outcomes
#   SuperRoo-ML-Sync    — Every 12 hours: sync local model to VPS + download merged
#   SuperRoo-Brain-Sync — Every hour: sync lessons and awareness to all three brains
#
# Usage:
#   Set-ExecutionPolicy -Scope Process Bypass
#   .\ops\windows\schedule-ml-training.ps1

$NodePath  = (Get-Command node -ErrorAction Stop).Source
$RepoRoot  = "C:\Users\user\Documents\superroo2"
$LogDir    = "$RepoRoot\cloud\logs"

if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Force $LogDir | Out-Null }

function Register-SuperRooTask {
    param(
        [string]$Name,
        [string]$Script,
        [string]$Args = "",
        [string]$RepeatInterval,
        [string]$Description
    )

    $action  = New-ScheduledTaskAction -Execute $NodePath -Argument "$Script $Args" -WorkingDirectory $RepoRoot
    $trigger = New-ScheduledTaskTrigger -RepetitionInterval ([TimeSpan]::Parse($RepeatInterval)) -Once -At (Get-Date)
    $settings = New-ScheduledTaskSettingsSet `
        -ExecutionTimeLimit ([TimeSpan]::FromMinutes(15)) `
        -RestartOnIdle $false `
        -StartWhenAvailable $true `
        -RunOnlyIfNetworkAvailable $false

    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Highest

    $existing = Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
    if ($existing) {
        Unregister-ScheduledTask -TaskName $Name -Confirm:$false
        Write-Host "  Replaced existing task: $Name"
    }

    Register-ScheduledTask `
        -TaskName    $Name `
        -Action      $action `
        -Trigger     $trigger `
        -Settings    $settings `
        -Principal   $principal `
        -Description $Description `
        -Force | Out-Null

    Write-Host "  ✅ $Name (every $RepeatInterval)"
}

Write-Host "🧠 SuperRoo ML Task Scheduler Setup"
Write-Host ""

# Train central ML every 6 hours
Register-SuperRooTask `
    -Name "SuperRoo-ML-Train" `
    -Script "scripts\train-central-ml.mjs" `
    -Args "--epochs=50" `
    -RepeatInterval "06:00:00" `
    -Description "Retrain SuperRoo central ML model on accumulated outcomes from Codex, Kilo, and Claude"

# Sync to VPS every 12 hours
Register-SuperRooTask `
    -Name "SuperRoo-ML-Sync" `
    -Script "scripts\sync-ml-to-vps.mjs" `
    -RepeatInterval "12:00:00" `
    -Description "Upload trained ML model to VPS for federated merge, download merged model"

# Brain sync every hour
Register-SuperRooTask `
    -Name "SuperRoo-Brain-Sync" `
    -Script "scripts\sync-all-brains.mjs" `
    -Args "--awareness" `
    -RepeatInterval "01:00:00" `
    -Description "Sync cross-agent awareness and lessons to all three brains (Brain MCP, Codex, Claude)"

Write-Host ""
Write-Host "All tasks registered. Verify with:"
Write-Host "  Get-ScheduledTask | Where-Object TaskName -like 'SuperRoo-*'"
Write-Host ""
Write-Host "To run immediately:"
Write-Host "  Start-ScheduledTask -TaskName 'SuperRoo-ML-Train'"
Write-Host "  Start-ScheduledTask -TaskName 'SuperRoo-Brain-Sync'"
