# SuperRoo Cloud — Dashboard Deployment Script for Windows
# Run this FROM YOUR LOCAL WINDOWS MACHINE to deploy dashboard to VPS
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File cloud/deploy-dashboard-windows.ps1

$SSH_TARGET = "superroo@104.248.225.250"
$PROJECT_ROOT = "/opt/superroo2"
$CLOUD_DIR = "$PROJECT_ROOT/cloud"
$DASHBOARD_DIR = "$CLOUD_DIR/dashboard"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "SuperRoo Dashboard Remote Deploy" -ForegroundColor Cyan
Write-Host "Target: $SSH_TARGET" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Test SSH connection
Write-Host "[1/7] Testing SSH connection..." -ForegroundColor Yellow
try {
    ssh -o ConnectTimeout=5 $SSH_TARGET "echo 'SSH OK'"
    if ($LASTEXITCODE -ne 0) { throw "SSH connection failed" }
} catch {
    Write-Host "ERROR: Cannot connect to $SSH_TARGET" -ForegroundColor Red
    Write-Host "Make sure you have SSH access configured" -ForegroundColor Red
    exit 1
}

# Pull latest code
Write-Host ""
Write-Host "[2/7] Pulling latest code from git..." -ForegroundColor Yellow
ssh $SSH_TARGET "cd $PROJECT_ROOT && git pull origin main"

# Install dashboard dependencies
Write-Host ""
Write-Host "[3/7] Installing dashboard dependencies..." -ForegroundColor Yellow
ssh $SSH_TARGET "cd $DASHBOARD_DIR && npm install"

# Build dashboard
Write-Host ""
Write-Host "[4/7] Building dashboard..." -ForegroundColor Yellow
ssh $SSH_TARGET "cd $DASHBOARD_DIR && npm run build"

# Ensure logs directory exists
Write-Host ""
Write-Host "[5/7] Creating logs directory..." -ForegroundColor Yellow
ssh $SSH_TARGET "mkdir -p $CLOUD_DIR/logs"

# Restart PM2 services
Write-Host ""
Write-Host "[6/7] Restarting PM2 services..." -ForegroundColor Yellow
ssh $SSH_TARGET "cd $CLOUD_DIR && (pm2 restart ecosystem.config.js || pm2 start ecosystem.config.js) && pm2 save"

# Show status
Write-Host ""
Write-Host "[7/7] Checking service status..." -ForegroundColor Yellow
ssh $SSH_TARGET "pm2 list"

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "Dashboard deployed successfully!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Access the dashboard at: http://104.248.225.250:3001" -ForegroundColor Cyan
Write-Host ""
Write-Host "View logs:" -ForegroundColor Yellow
Write-Host "  ssh $SSH_TARGET 'pm2 logs superroo-dashboard'" -ForegroundColor Gray
Write-Host ""
