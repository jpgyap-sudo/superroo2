#!/bin/bash
# SuperRoo Cloud — Remote Dashboard Deployment Script
# Run this FROM YOUR LOCAL MACHINE to deploy dashboard to VPS via SSH
#
# Usage:
#   chmod +x remote-deploy-dashboard.sh
#   ./remote-deploy-dashboard.sh
#
# Uses root SSH access with id_superroo_vps key for full deployment automation.

set -euo pipefail

SSH_KEY="C:\\Users\\User\\.ssh\\id_superroo_vps"
SSH_TARGET="root@104.248.225.250"
SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=10 -i ${SSH_KEY}"
PROJECT_ROOT="/opt/superroo2"
CLOUD_DIR="${PROJECT_ROOT}/cloud"
DASHBOARD_DIR="${CLOUD_DIR}/dashboard"

echo "========================================"
echo "SuperRoo Dashboard Remote Deploy"
echo "Target: ${SSH_TARGET}"
echo "========================================"

# ---------------------------------------------------------------------------
# 1. Test SSH connection
# ---------------------------------------------------------------------------
echo ""
echo "[1/9] Testing SSH connection..."
if ! ssh ${SSH_OPTS} "${SSH_TARGET}" "echo 'SSH OK'"; then
    echo "ERROR: Cannot connect to ${SSH_TARGET}"
    echo "Make sure id_superroo_vps key is accessible"
    exit 1
fi

# ---------------------------------------------------------------------------
# 2. Deploy nginx config
# ---------------------------------------------------------------------------
echo ""
echo "[2/9] Deploying nginx config..."
scp ${SSH_OPTS} cloud/nginx-dashboard.conf "${SSH_TARGET}:/etc/nginx/sites-enabled/dashboard"
echo "Nginx config copied."

# ---------------------------------------------------------------------------
# 3. Add /_next/static/ block to HTTPS config if missing
# ---------------------------------------------------------------------------
echo ""
echo "[3/9] Checking HTTPS config for /_next/static/ block..."
if ssh ${SSH_OPTS} "${SSH_TARGET}" "grep -q '_next/static' /etc/nginx/sites-enabled/dev.abcx124.xyz"; then
    echo "HTTPS config already has /_next/static/ block."
else
    echo "Adding /_next/static/ block to HTTPS config..."
    ssh ${SSH_OPTS} "${SSH_TARGET}" "sed -i '/location \/ {/i\    location /_next/static/ {\n        alias /opt/superroo2/cloud/dashboard/.next/static/;\n        expires 365d;\n        add_header Cache-Control \"public, immutable, max-age=31536000\";\n        access_log off;\n    }\n' /etc/nginx/sites-enabled/dev.abcx124.xyz"
fi

# ---------------------------------------------------------------------------
# 4. Test and reload nginx
# ---------------------------------------------------------------------------
echo ""
echo "[4/9] Testing and reloading nginx..."
ssh ${SSH_OPTS} "${SSH_TARGET}" "nginx -t && systemctl reload nginx"
echo "Nginx reloaded."

# ---------------------------------------------------------------------------
# 5. Pull latest code
# ---------------------------------------------------------------------------
echo ""
echo "[5/9] Pulling latest code from git..."
ssh ${SSH_OPTS} "${SSH_TARGET}" "cd ${PROJECT_ROOT} && git pull origin main"

# ---------------------------------------------------------------------------
# 6. Install dashboard dependencies
# ---------------------------------------------------------------------------
echo ""
echo "[6/9] Installing dashboard dependencies..."
ssh ${SSH_OPTS} "${SSH_TARGET}" "cd ${PROJECT_ROOT} && corepack enable && pnpm install --frozen-lockfile"

# ---------------------------------------------------------------------------
# 7. Build dashboard
# ---------------------------------------------------------------------------
echo ""
echo "[7/9] Building dashboard..."
ssh ${SSH_OPTS} "${SSH_TARGET}" "cd ${PROJECT_ROOT} && pnpm --dir ${DASHBOARD_DIR} run build"

# ---------------------------------------------------------------------------
# 8. Restart PM2 services
# ---------------------------------------------------------------------------
echo ""
echo "[8/9] Restarting PM2 services..."
ssh ${SSH_OPTS} "${SSH_TARGET}" "cd ${CLOUD_DIR} && (pm2 restart ecosystem.config.js || pm2 start ecosystem.config.js) && pm2 save"

# ---------------------------------------------------------------------------
# 9. Show status
# ---------------------------------------------------------------------------
echo ""
echo "[9/9] Checking service status..."
ssh ${SSH_OPTS} "${SSH_TARGET}" "pm2 list"

echo ""
echo "========================================"
echo "Dashboard deployed successfully!"
echo "========================================"
echo ""
echo "Access the dashboard at: https://dev.abcx124.xyz"
echo ""
echo "View logs:"
echo "  ssh ${SSH_OPTS} ${SSH_TARGET} 'pm2 logs superroo-dashboard'"
echo ""
