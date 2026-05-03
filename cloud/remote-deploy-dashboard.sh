#!/bin/bash
# SuperRoo Cloud — Remote Dashboard Deployment Script
# Run this FROM YOUR LOCAL MACHINE to deploy dashboard to VPS via SSH
#
# Usage:
#   chmod +x remote-deploy-dashboard.sh
#   ./remote-deploy-dashboard.sh [user@host]
#
# Example:
#   ./remote-deploy-dashboard.sh superroo@your-vps-ip

set -euo pipefail

# Check if SSH target is provided
if [ -z "${1:-}" ]; then
    echo "Usage: $0 [user@host]"
    echo "Example: $0 superroo@192.168.1.100"
    exit 1
fi

SSH_TARGET="$1"
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
echo "[1/7] Testing SSH connection..."
if ! ssh -o ConnectTimeout=5 "${SSH_TARGET}" "echo 'SSH OK'"; then
    echo "ERROR: Cannot connect to ${SSH_TARGET}"
    exit 1
fi

# ---------------------------------------------------------------------------
# 2. Pull latest code
# ---------------------------------------------------------------------------
echo ""
echo "[2/7] Pulling latest code from git..."
ssh "${SSH_TARGET}" "cd ${PROJECT_ROOT} && git pull origin main"

# ---------------------------------------------------------------------------
# 3. Install dashboard dependencies
# ---------------------------------------------------------------------------
echo ""
echo "[3/7] Installing dashboard dependencies..."
ssh "${SSH_TARGET}" "cd ${DASHBOARD_DIR} && npm install"

# ---------------------------------------------------------------------------
# 4. Build dashboard
# ---------------------------------------------------------------------------
echo ""
echo "[4/7] Building dashboard..."
ssh "${SSH_TARGET}" "cd ${DASHBOARD_DIR} && npm run build"

# ---------------------------------------------------------------------------
# 5. Ensure logs directory exists
# ---------------------------------------------------------------------------
echo ""
echo "[5/7] Creating logs directory..."
ssh "${SSH_TARGET}" "mkdir -p ${CLOUD_DIR}/logs"

# ---------------------------------------------------------------------------
# 6. Restart PM2 services
# ---------------------------------------------------------------------------
echo ""
echo "[6/7] Restarting PM2 services..."
ssh "${SSH_TARGET}" "cd ${CLOUD_DIR} && pm2 restart ecosystem.config.js || pm2 start ecosystem.config.js"
ssh "${SSH_TARGET}" "pm2 save"

# ---------------------------------------------------------------------------
# 7. Show status
# ---------------------------------------------------------------------------
echo ""
echo "[7/7] Checking service status..."
ssh "${SSH_TARGET}" "pm2 list"

echo ""
echo "========================================"
echo "Dashboard deployed successfully!"
echo "========================================"
echo ""
echo "Access the dashboard at: http://[your-vps-ip]:3001"
echo ""
echo "View logs:"
echo "  ssh ${SSH_TARGET} 'pm2 logs superroo-dashboard'"
echo ""
