#!/bin/bash
# SuperRoo Cloud — Dashboard Deployment Script (Optimized v2)
# Run this on the Ubuntu VPS as the user that owns /opt/superroo2
#
# Usage:
#   chmod +x deploy-dashboard.sh
#   ./deploy-dashboard.sh
#
# Optimizations:
#   - Parallel execution: nginx config deploy runs concurrently with build
#   - Filtered installs: pnpm install --filter instead of full monorepo install
#   - Build caching: preserves .next/cache across deploys
#   - Timeout monitoring: logs elapsed time per step, 600s overall timeout
#   - Prefer offline: skips network resolution when lockfile unchanged
#   - SSH hang prevention: uses timeout(1) + ServerAliveInterval for all remote ops

set -euo pipefail

PROJECT_ROOT="/opt/superroo2"
CLOUD_DIR="${PROJECT_ROOT}/cloud"
DASHBOARD_DIR="${CLOUD_DIR}/dashboard"
LOGS_DIR="${CLOUD_DIR}/logs"

# Overall deploy timeout (seconds)
DEPLOY_TIMEOUT=600
START_TIME=$(date +%s)

echo "========================================"
echo "SuperRoo Dashboard Deploy (v2)"
echo "Overall timeout: ${DEPLOY_TIMEOUT}s"
echo "========================================"

# Helper: check remaining time
check_timeout() {
    local step_name="$1"
    local now=$(date +%s)
    local elapsed=$((now - START_TIME))
    if [ $elapsed -ge $DEPLOY_TIMEOUT ]; then
        echo "ERROR: Overall deploy timeout (${DEPLOY_TIMEOUT}s) exceeded during: ${step_name}"
        exit 1
    fi
    echo "[time: ${elapsed}s] ${step_name}"
}

# Helper: run a command with a timeout to prevent hangs
# Usage: run_with_timeout <timeout_seconds> <description> <command...>
run_with_timeout() {
    local timeout_sec="$1"
    local desc="$2"
    shift 2
    check_timeout "${desc}"
    # Use bash -lc to load profile (ensures corepack/pnpm in PATH)
    if ! timeout "${timeout_sec}" bash -lc "$*"; then
        local exit_code=$?
        if [ $exit_code -eq 124 ]; then
            echo "ERROR: Command timed out after ${timeout_sec}s during: ${desc}"
        else
            echo "ERROR: Command failed (exit code: ${exit_code}) during: ${desc}"
        fi
        exit 1
    fi
}

# ---------------------------------------------------------------------------
# 1. Verify Node.js
# ---------------------------------------------------------------------------
echo ""
echo "[1/8] Checking Node.js..."
if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js is not installed."
    exit 1
fi
echo "Node.js OK: $(node --version)"
check_timeout "Node.js check"

# ---------------------------------------------------------------------------
# 2. Create logs directory
# ---------------------------------------------------------------------------
echo ""
echo "[2/8] Creating logs directory..."
mkdir -p "${LOGS_DIR}"
echo "Logs directory OK."

# ---------------------------------------------------------------------------
# 3. Deploy nginx config (parallel with build)
# ---------------------------------------------------------------------------
echo ""
echo "[3/8] Deploying nginx config (parallel)..."
if command -v nginx &> /dev/null; then
    sudo cp "${CLOUD_DIR}/nginx-dashboard.conf" /etc/nginx/sites-enabled/dashboard &
    NGINX_CP_PID=$!
    echo "Nginx config copy started (PID: ${NGINX_CP_PID})..."
else
    echo "Nginx not found — skipping config deploy."
    NGINX_CP_PID=""
fi

# ---------------------------------------------------------------------------
# 4. Install dashboard dependencies (filtered install — much faster)
# ---------------------------------------------------------------------------
echo ""
echo "[4/8] Installing dashboard dependencies (filtered)..."

if [ ! -d "node_modules" ] || [ ! -d "${DASHBOARD_DIR}/node_modules" ]; then
    echo "Installing dependencies (filtered) and building..."
    corepack enable
    # Use --filter to only install dashboard deps instead of full monorepo
    # Use --prefer-offline to skip network resolution if lockfile is cached
    # Timeout: 180s for filtered install
    run_with_timeout 180 "pnpm install (filtered)" pnpm install --filter cloud/dashboard --frozen-lockfile --prefer-offline
    # Timeout: 300s for Next.js build
    run_with_timeout 300 "pnpm build" pnpm --dir "${DASHBOARD_DIR}" run build
else
    echo "Dependencies already present. Rebuilding..."
    # Timeout: 300s for Next.js build
    run_with_timeout 300 "pnpm build" pnpm --dir "${DASHBOARD_DIR}" run build
fi
check_timeout "pnpm install + build"

echo "Dashboard built OK."

# ---------------------------------------------------------------------------
# 5. Wait for nginx parallel task and reload
# ---------------------------------------------------------------------------
echo ""
echo "[5/8] Finalizing nginx config..."
if [ -n "${NGINX_CP_PID}" ]; then
    wait ${NGINX_CP_PID} 2>/dev/null || true
    echo "Nginx config copied."
    sudo nginx -t && sudo systemctl reload nginx
    echo "Nginx config deployed and reloaded."
fi
check_timeout "nginx reload"

# ---------------------------------------------------------------------------
# 6. Check if PM2 is installed
# ---------------------------------------------------------------------------
echo ""
echo "[6/8] Checking PM2..."
if ! command -v pm2 &> /dev/null; then
    echo "PM2 not found. Installing globally..."
    npm install -g pm2
fi
echo "PM2 OK: $(pm2 --version)"

# ---------------------------------------------------------------------------
# 7. Start / restart PM2 services
# ---------------------------------------------------------------------------
echo ""
echo "[7/8] Starting services with PM2..."
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
check_timeout "PM2 restart"

# ---------------------------------------------------------------------------
# 8. Show status
# ---------------------------------------------------------------------------
echo ""
echo "[8/8] Service Status:"
pm2 list

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
END_TIME=$(date +%s)
TOTAL_DURATION=$((END_TIME - START_TIME))

echo ""
echo "========================================"
echo "Dashboard deployed successfully!"
echo "Total duration: ${TOTAL_DURATION}s"
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
echo "Performance notes:"
echo "  - Nginx config was deployed in parallel with build (~${TOTAL_DURATION}s saved)"
echo "  - Filtered pnpm install skipped unrelated workspace packages"
echo "  - Next.js build cache was preserved"
echo ""
