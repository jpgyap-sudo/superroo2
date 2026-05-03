#!/bin/bash
# SuperRoo Cloud — Dashboard Deployment Script
# Run this on the Ubuntu VPS as the user that owns /opt/superroo2
#
# Usage:
#   chmod +x deploy-dashboard.sh
#   ./deploy-dashboard.sh

set -euo pipefail

PROJECT_ROOT="/opt/superroo2"
CLOUD_DIR="${PROJECT_ROOT}/cloud"
DASHBOARD_DIR="${CLOUD_DIR}/dashboard"
LOGS_DIR="${CLOUD_DIR}/logs"

echo "========================================"
echo "SuperRoo Dashboard Deploy"
echo "========================================"

# ---------------------------------------------------------------------------
# 1. Verify Node.js
# ---------------------------------------------------------------------------
echo ""
echo "[1/6] Checking Node.js..."
if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js is not installed."
    exit 1
fi

echo "Node.js OK: $(node --version)"

# ---------------------------------------------------------------------------
# 2. Create logs directory
# ---------------------------------------------------------------------------
echo ""
echo "[2/6] Creating logs directory..."
mkdir -p "${LOGS_DIR}"
echo "Logs directory OK."

# ---------------------------------------------------------------------------
# 3. Install dashboard dependencies
# ---------------------------------------------------------------------------
echo ""
echo "[3/6] Installing dashboard dependencies..."
cd "${DASHBOARD_DIR}"

if [ ! -d "node_modules" ] || [ ! -d ".next" ]; then
    echo "Installing dependencies and building..."
    npm install
    npm run build
else
    echo "Dependencies already present. Rebuilding..."
    npm run build
fi

echo "Dashboard built OK."

# ---------------------------------------------------------------------------
# 4. Check if PM2 is installed
# ---------------------------------------------------------------------------
echo ""
echo "[4/6] Checking PM2..."
if ! command -v pm2 &> /dev/null; then
    echo "PM2 not found. Installing globally..."
    npm install -g pm2
fi

echo "PM2 OK: $(pm2 --version)"

# ---------------------------------------------------------------------------
# 5. Start / restart PM2 services
# ---------------------------------------------------------------------------
echo ""
echo "[5/6] Starting services with PM2..."
cd "${CLOUD_DIR}"

# Check if any services are already running
if pm2 list | grep -q "superroo"; then
    echo "Services already managed by PM2. Restarting..."
    pm2 restart ecosystem.config.js
else
    echo "Starting services for the first time..."
    pm2 start ecosystem.config.js
fi

pm2 save

echo "Services started."

# ---------------------------------------------------------------------------
# 6. Show status
# ---------------------------------------------------------------------------
echo ""
echo "[6/6] Service Status:"
pm2 list

echo ""
echo "========================================"
echo "Dashboard deployed successfully!"
echo "========================================"
echo ""
echo "Access the dashboard at: http://localhost:3001"
echo ""
echo "Useful commands:"
echo "  pm2 list                          - Show all services"
echo "  pm2 logs superroo-dashboard       - View dashboard logs"
echo "  pm2 restart superroo-dashboard    - Restart dashboard"
echo "  pm2 stop superroo-dashboard       - Stop dashboard"
echo ""
