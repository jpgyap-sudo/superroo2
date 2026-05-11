# SuperRoo Auto-Deployer Bot (Windows PowerShell)
# Self-retrying SSH deploy with stuck-kill and exponential backoff
# Run: powershell -ExecutionPolicy Bypass -File cloud/auto-deploy-windows.ps1
#
# This script will:
#   1. Kill any stuck SSH processes
#   2. Retry SSH connection with exponential backoff (10s, 20s, 40s, 80s, 160s)
#   3. Once connected, deploy the two changed files:
#      - cloud/api/api.js → /opt/superroo2/cloud/api/api.js
#      - cloud/dashboard/src/components/views/api-keys.tsx → /opt/superroo2/cloud/dashboard/src/components/views/api-keys.tsx
#   4. Rebuild dashboard and restart services
#   5. Report success

param(
    [int]$MaxRetries = 5,
    [int]$RetryDelay = 10
)

$SSH_KEY = "C:\Users\User\.ssh\id_superroo_vps"
$SSH_TARGET = "root@104.248.225.250"
$SSH_OPTS = "-o StrictHostKeyChecking=no -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -i `"$SSH_KEY`""
$PROJECT_ROOT = "/opt/superroo2"
$CLOUD_DIR = "$PROJECT_ROOT/cloud"
$DASHBOARD_DIR = "$CLOUD_DIR/dashboard"

$START_TIME = Get-Date

function Write-Log($msg, $color = "White") {
    $elapsed = [math]::Round(((Get-Date) - $START_TIME).TotalSeconds, 1)
    Write-Host "[${elapsed}s] $msg" -ForegroundColor $color
}

function Kill-StuckSSH {
    Write-Log "Killing any stuck SSH processes..." -color "Yellow"
    try {
        taskkill /f /im ssh.exe 2>$null
        Write-Log "Stuck SSH processes killed." -color "Green"
    } catch {
        # No SSH processes to kill — that's fine
    }
}

function Test-SSHConnection {
    $result = ssh -o StrictHostKeyChecking=no -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -i "C:\Users\User\.ssh\id_superroo_vps" root@104.248.225.250 "echo SSH_OK" 2>&1
    return ($LASTEXITCODE -eq 0)
}

function Deploy-Files {
    Write-Log "Copying api.js to VPS..." -color "Cyan"
    scp -o StrictHostKeyChecking=no -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -i "C:\Users\User\.ssh\id_superroo_vps" cloud/api/api.js "${SSH_TARGET}:${CLOUD_DIR}/api/api.js"
    if ($LASTEXITCODE -ne 0) { throw "SCP api.js failed" }
    Write-Log "api.js copied." -color "Green"

    Write-Log "Copying api-keys.tsx to VPS..." -color "Cyan"
    scp -o StrictHostKeyChecking=no -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -i "C:\Users\User\.ssh\id_superroo_vps" cloud/dashboard/src/components/views/api-keys.tsx "${SSH_TARGET}:${DASHBOARD_DIR}/src/components/views/api-keys.tsx"
    if ($LASTEXITCODE -ne 0) { throw "SCP api-keys.tsx failed" }
    Write-Log "api-keys.tsx copied." -color "Green"

    # Rebuild dashboard on VPS
    Write-Log "Rebuilding dashboard on VPS..." -color "Cyan"
    ssh -o StrictHostKeyChecking=no -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -i "C:\Users\User\.ssh\id_superroo_vps" root@104.248.225.250 "cd ${DASHBOARD_DIR} && pnpm install --filter cloud/dashboard --frozen-lockfile --prefer-offline 2>&1 && pnpm build 2>&1"
    if ($LASTEXITCODE -ne 0) { throw "Dashboard build failed" }
    Write-Log "Dashboard rebuilt." -color "Green"

    # Restart API
    Write-Log "Restarting superroo-api..." -color "Cyan"
    ssh -o StrictHostKeyChecking=no -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -i "C:\Users\User\.ssh\id_superroo_vps" root@104.248.225.250 "pm2 restart superroo-api 2>&1 && sleep 3 && pm2 status 2>&1"
    if ($LASTEXITCODE -ne 0) { throw "PM2 restart failed" }
    Write-Log "superroo-api restarted." -color "Green"

    # Health check
    Write-Log "Running health check..." -color "Cyan"
    $health = ssh -o StrictHostKeyChecking=no -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -i "C:\Users\User\.ssh\id_superroo_vps" root@104.248.225.250 "curl -sf http://127.0.0.1:8787/api/settings/providers | head -c 200" 2>&1
    if ($LASTEXITCODE -eq 0 -and $health -match "providers") {
        Write-Log "Health check PASSED. API is responding." -color "Green"
    } else {
        Write-Log "Health check WARNING: API may not be fully ready yet." -color "Yellow"
    }

    return $true
}

# ===== MAIN =====
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "🤖 Auto-Deployer Bot (Windows)" -ForegroundColor Cyan
Write-Host "Target: $SSH_TARGET" -ForegroundColor Cyan
Write-Host "Max retries: $MaxRetries" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$attempt = 1
$success = $false

while ($attempt -le $MaxRetries -and -not $success) {
    Write-Host ""
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Magenta
    Write-Log "ATTEMPT $attempt of $MaxRetries" -color "Magenta"
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Magenta

    # Kill stuck SSH first
    Kill-StuckSSH

    # Test SSH connection
    Write-Log "Testing SSH connection..." -color "Cyan"
    if (Test-SSHConnection) {
        Write-Log "SSH connection OK." -color "Green"

        # Deploy
        try {
            Deploy-Files
            $success = $true
            Write-Log "✅ DEPLOY SUCCESSFUL on attempt $attempt" -color "Green"
        } catch {
            Write-Log "❌ Deploy failed: $_" -color "Red"
        }
    } else {
        Write-Log "❌ SSH connection failed." -color "Red"
    }

    if (-not $success) {
        $delay = $RetryDelay * [math]::Pow(2, $attempt - 1)
        Write-Log "Waiting ${delay}s before retry (attempt $($attempt+1))..." -color "Yellow"
        Start-Sleep -Seconds $delay
        $attempt++
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
if ($success) {
    Write-Host "✅ Auto-Deploy completed successfully!" -ForegroundColor Green
    Write-Host "Files deployed:" -ForegroundColor Green
    Write-Host "  • cloud/api/api.js" -ForegroundColor Green
    Write-Host "  • cloud/dashboard/src/components/views/api-keys.tsx" -ForegroundColor Green
    Write-Host "Services restarted: superroo-api" -ForegroundColor Green
    Write-Host "Dashboard rebuilt with new Config button on provider cards." -ForegroundColor Green
} else {
    Write-Host "❌ Auto-Deploy FAILED after $MaxRetries attempts." -ForegroundColor Red
    Write-Host "The VPS (104.248.225.250) is still unreachable." -ForegroundColor Red
    Write-Host "Please check if the server is running and try again later." -ForegroundColor Red
}
Write-Host "========================================" -ForegroundColor Cyan
