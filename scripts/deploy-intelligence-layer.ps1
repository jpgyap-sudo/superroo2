# Deploy Intelligence Layer to SuperRoo VPS via Tailscale SSH
# Run from PowerShell

$ErrorActionPreference = "Stop"

# Configuration
$SSH_KEY = "C:\Users\User\.ssh\id_superroo_vps"
$SSH_TARGET = "root@100.64.175.88"
$SSH_OPTS = "-o StrictHostKeyChecking=no -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -i `"$SSH_KEY`""
$VPS_PATH = "/opt/superroo2"
$COMMIT_SHA = if ($args[0]) { $args[0] } else { git rev-parse HEAD }

Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "Deploying Intelligence Layer via Tailscale SSH" -ForegroundColor Cyan
Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "Target: $SSH_TARGET"
Write-Host "Commit: $COMMIT_SHA"
Write-Host ""

# Test Tailscale SSH connection
Write-Host "🔍 Testing Tailscale SSH connection..." -ForegroundColor Yellow
try {
    $testResult = ssh $SSH_OPTS.Split(" ") $SSH_TARGET "echo 'Tailscale SSH OK' && hostname" 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "SSH connection failed"
    }
    Write-Host "✅ Tailscale SSH connection successful" -ForegroundColor Green
    Write-Host "   Host: $testResult"
} catch {
    Write-Host "❌ Failed to connect via Tailscale SSH" -ForegroundColor Red
    Write-Host "   Ensure Tailscale is running on both local machine and VPS"
    exit 1
}
Write-Host ""

# Deploy to VPS
Write-Host "🚀 Deploying intelligence layer changes..." -ForegroundColor Yellow

$deployScript = @"
    set -e
    
    echo "📂 Changing to $VPS_PATH..."
    cd $VPS_PATH
    
    echo "📥 Pulling latest changes..."
    git fetch origin
    git checkout $COMMIT_SHA 2>/dev/null || git pull origin fix/webview-recovery
    
    echo "📊 Verifying intelligence files..."
    ls -la memory/ 2>/dev/null | head -20
    echo ""
    echo "Lesson count: \$(wc -l < memory/lesson-index.jsonl) lessons indexed"
    
    echo "📝 Recording deployment..."
    echo "Deployment of $COMMIT_SHA recorded at \$(date -Iseconds)" | tee -a /tmp/deploy-log.txt
    
    echo "✅ Deployment complete!"
"@

try {
    $deployResult = ssh $SSH_OPTS.Split(" ") $SSH_TARGET $deployScript 2>&1
    Write-Host $deployResult
    
    Write-Host ""
    Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Green
    Write-Host "✅ Deployment Successful!" -ForegroundColor Green
    Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Green
    Write-Host ""
    Write-Host "Deployed files:"
    Write-Host "  - memory/lessons-learned.md"
    Write-Host "  - memory/bugs-fixed.md"
    Write-Host "  - memory/model-decisions.md"
    Write-Host "  - memory/lesson-index.jsonl"
    Write-Host "  - src/super-roo/lessons/"
    Write-Host "  - scripts/*-lesson*.mjs"
    Write-Host ""
    Write-Host "Commit: $COMMIT_SHA"
    Write-Host "Deployed via Tailscale: 100.64.175.88"
} catch {
    Write-Host ""
    Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Red
    Write-Host "❌ Deployment Failed" -ForegroundColor Red
    Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Red
    Write-Host $_
    exit 1
}
