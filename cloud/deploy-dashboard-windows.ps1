# SuperRoo Cloud — Dashboard Deployment Script for Windows
# Run this FROM YOUR LOCAL WINDOWS MACHINE to deploy dashboard to VPS
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File cloud/deploy-dashboard-windows.ps1

$SSH_KEY = "C:\Users\User\.ssh\id_superroo_vps"
# Using Tailscale IP (100.64.175.88) instead of public IP for secure mesh connection
$SSH_TARGET = "root@100.64.175.88"
$SSH_OPTS = "-o StrictHostKeyChecking=no -o ConnectTimeout=10 -i $SSH_KEY"
$PROJECT_ROOT = "/opt/superroo2"
$CLOUD_DIR = "$PROJECT_ROOT/cloud"
$DASHBOARD_DIR = "$CLOUD_DIR/dashboard"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "SuperRoo Dashboard Remote Deploy" -ForegroundColor Cyan
Write-Host "Target: $SSH_TARGET" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Test SSH connection
Write-Host "[1/9] Testing SSH connection..." -ForegroundColor Yellow
try {
    ssh $SSH_OPTS $SSH_TARGET "echo 'SSH OK'"
    if ($LASTEXITCODE -ne 0) { throw "SSH connection failed" }
} catch {
    Write-Host "ERROR: Cannot connect to $SSH_TARGET" -ForegroundColor Red
    Write-Host "Make sure you have SSH access configured with the id_superroo_vps key" -ForegroundColor Red
    exit 1
}

# Deploy nginx config
Write-Host ""
Write-Host "[2/9] Deploying nginx config..." -ForegroundColor Yellow
try {
    scp $SSH_OPTS cloud/nginx-dashboard.conf "${SSH_TARGET}:/etc/nginx/sites-enabled/dashboard"
    if ($LASTEXITCODE -ne 0) { throw "SCP failed" }
    Write-Host "Nginx config copied." -ForegroundColor Green
} catch {
    Write-Host "ERROR: Failed to copy nginx config" -ForegroundColor Red
    exit 1
}

# Add /_next/static/ block to HTTPS config if missing
Write-Host ""
Write-Host "[3/9] Checking HTTPS config for /_next/static/ block..." -ForegroundColor Yellow
$checkResult = ssh $SSH_OPTS $SSH_TARGET "grep -q '_next/static' /etc/nginx/sites-enabled/dev.abcx124.xyz && echo EXISTS || echo MISSING"
if ($checkResult -match "MISSING") {
    Write-Host "Adding /_next/static/ block to HTTPS config..." -ForegroundColor Yellow
    ssh $SSH_OPTS $SSH_TARGET "sed -i '/location \/ {/i\    location /_next/static/ {\n        alias /opt/superroo2/cloud/dashboard/.next/static/;\n        expires 365d;\n        add_header Cache-Control \"public, immutable, max-age=31536000\";\n        access_log off;\n    }\n' /etc/nginx/sites-enabled/dev.abcx124.xyz"
} else {
    Write-Host "HTTPS config already has /_next/static/ block." -ForegroundColor Green
}

# Test and reload nginx
Write-Host ""
Write-Host "[4/9] Testing and reloading nginx..." -ForegroundColor Yellow
ssh $SSH_OPTS $SSH_TARGET "nginx -t && systemctl reload nginx"
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Nginx config test failed" -ForegroundColor Red
    exit 1
}
Write-Host "Nginx reloaded." -ForegroundColor Green

# Pull latest code
Write-Host ""
Write-Host "[5/9] Pulling latest code from git..." -ForegroundColor Yellow
ssh $SSH_OPTS $SSH_TARGET "cd $PROJECT_ROOT && git pull origin main"

# Install dashboard dependencies
Write-Host ""
Write-Host "[6/9] Installing dashboard dependencies..." -ForegroundColor Yellow
ssh $SSH_OPTS $SSH_TARGET "cd $PROJECT_ROOT && corepack enable && pnpm install --frozen-lockfile"

# Build dashboard
Write-Host ""
Write-Host "[7/9] Building dashboard..." -ForegroundColor Yellow
ssh $SSH_OPTS $SSH_TARGET "cd $PROJECT_ROOT && pnpm --dir $DASHBOARD_DIR run build"

# Restart PM2 services
Write-Host ""
Write-Host "[8/9] Restarting PM2 services..." -ForegroundColor Yellow
ssh $SSH_OPTS $SSH_TARGET "cd $CLOUD_DIR && (pm2 restart ecosystem.config.js || pm2 start ecosystem.config.js) && pm2 save"

# Show status
Write-Host ""
Write-Host "[9/9] Checking service status..." -ForegroundColor Yellow
ssh $SSH_OPTS $SSH_TARGET "pm2 list"

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "Dashboard deployed successfully!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Access the dashboard at: https://dev.abcx124.xyz" -ForegroundColor Cyan
Write-Host ""
Write-Host "View logs:" -ForegroundColor Yellow
Write-Host "  ssh $SSH_OPTS $SSH_TARGET 'pm2 logs superroo-dashboard'" -ForegroundColor Gray
Write-Host ""
