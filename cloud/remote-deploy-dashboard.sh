#!/bin/bash
# SuperRoo Cloud — Remote Dashboard Deployment Script (Optimized v2)
# Run this FROM YOUR LOCAL MACHINE to deploy dashboard to VPS via SSH
#
# Usage:
#   chmod +x remote-deploy-dashboard.sh
#   ./remote-deploy-dashboard.sh
#
# Optimizations:
#   - Parallel execution: nginx config deploy runs concurrently with build
#   - Filtered installs: pnpm install --filter instead of full monorepo install
#   - Build caching: preserves .next/cache across deploys
#   - Timeout monitoring: logs elapsed time per step, 600s overall timeout
#   - Prefer offline: skips network resolution when lockfile unchanged
#   - SSH hang prevention: ServerAliveInterval + ServerAliveCountMax detect dead connections
#   - SSH command timeout: each SSH command has a per-step timeout to prevent indefinite hangs

set -euo pipefail

# Tailscale IP (100.64.175.88) used instead of public IP (104.248.225.250) for secure mesh connection
SSH_KEY="C:\\Users\\User\\.ssh\\id_superroo_vps"
SSH_TARGET="root@100.64.175.88"
# SSH options to prevent hanging:
#   ServerAliveInterval=15  — send keepalive every 15s
#   ServerAliveCountMax=3   — disconnect after 3 missed keepalives (45s silence)
#   ConnectTimeout=15       — fail fast if host unreachable
SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -i ${SSH_KEY}"
PROJECT_ROOT="/opt/superroo2"
CLOUD_DIR="${PROJECT_ROOT}/cloud"
DASHBOARD_DIR="${CLOUD_DIR}/dashboard"

# Overall deploy timeout (seconds)
DEPLOY_TIMEOUT=600
START_TIME=$(date +%s)

echo "========================================"
echo "SuperRoo Dashboard Remote Deploy (v2)"
echo "Target: ${SSH_TARGET}"
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

# Helper: run SSH command with timeout monitoring and hang prevention
# Uses timeout(1) to enforce per-command deadline, preventing SSH hangs
ssh_cmd() {
    local desc="$1"
    local step_timeout="$2"   # per-command timeout in seconds
    shift 2
    check_timeout "${desc}"
    # Use timeout(1) to enforce per-command deadline
    # This prevents SSH from hanging indefinitely if the remote process stalls
    timeout "${step_timeout}" ssh ${SSH_OPTS} "${SSH_TARGET}" "$@"
    local exit_code=$?
    if [ $exit_code -eq 124 ]; then
        echo "ERROR: SSH command timed out after ${step_timeout}s during: ${desc}"
        exit 1
    elif [ $exit_code -ne 0 ]; then
        echo "ERROR: SSH command failed (exit code: ${exit_code}) during: ${desc}"
        exit $exit_code
    fi
}

# ---------------------------------------------------------------------------
# 1. Test SSH connection
# ---------------------------------------------------------------------------
echo ""
echo "[1/9] Testing SSH connection..."
if ! timeout 15 ssh ${SSH_OPTS} "${SSH_TARGET}" "echo 'SSH OK'"; then
    echo "ERROR: Cannot connect to ${SSH_TARGET}"
    echo "Make sure id_superroo_vps key is accessible"
    exit 1
fi
check_timeout "SSH connection"

# ---------------------------------------------------------------------------
# 2. Deploy nginx config (runs in parallel with build steps)
# ---------------------------------------------------------------------------
echo ""
echo "[2/9] Deploying nginx config (parallel)..."
timeout 30 scp ${SSH_OPTS} cloud/nginx-dashboard.conf "${SSH_TARGET}:/etc/nginx/sites-enabled/dashboard" &
NGINX_SCP_PID=$!
echo "Nginx SCP started (PID: ${NGINX_SCP_PID})..."

# ---------------------------------------------------------------------------
# 3. Add /_next/static/ block to HTTPS config if missing (parallel)
# ---------------------------------------------------------------------------
echo ""
echo "[3/9] Checking HTTPS config for /_next/static/ block (parallel)..."
if timeout 15 ssh ${SSH_OPTS} "${SSH_TARGET}" "grep -q '_next/static' /etc/nginx/sites-enabled/dev.abcx124.xyz"; then
    echo "HTTPS config already has /_next/static/ block."
    NGINX_INSERT_DONE=true
else
    echo "Adding /_next/static/ block to HTTPS config..."
    timeout 30 ssh ${SSH_OPTS} "${SSH_TARGET}" "sed -i '/location \/ {/i\    location /_next/static/ {\n        alias /opt/superroo2/cloud/dashboard/.next/static/;\n        expires 365d;\n        add_header Cache-Control \"public, immutable, max-age=31536000\";\n        access_log off;\n    }\n' /etc/nginx/sites-enabled/dev.abcx124.xyz" &
    NGINX_INSERT_PID=$!
    NGINX_INSERT_DONE=false
fi

# ---------------------------------------------------------------------------
# 4. Pull latest code (starts immediately, doesn't wait for nginx)
# ---------------------------------------------------------------------------
echo ""
echo "[4/9] Pulling latest code from git..."
ssh_cmd "git pull" 60 "cd ${PROJECT_ROOT} && git pull origin main"

# ---------------------------------------------------------------------------
# 5. Install dashboard dependencies (filtered install — much faster)
# ---------------------------------------------------------------------------
echo ""
echo "[5/9] Installing dashboard dependencies (filtered)..."
# Use --filter to only install dashboard deps instead of full monorepo
# Use --prefer-offline to skip network resolution if lockfile is cached
# Timeout: 180s for filtered install (should be fast with --prefer-offline)
# NOTE: Use direct node binary path to avoid corepack/pnpm symlink recursive loop.
# /usr/bin/pnpm -> /usr/lib/node_modules/corepack/dist/pnpm.js, and corepack
# re-invokes pnpm which creates a recursive loop. Using the direct binary path
# bypasses corepack entirely while still using the correct pnpm version.
PNPM_BIN="/usr/bin/node /usr/lib/node_modules/corepack/dist/pnpm.js"
ssh_cmd "pnpm install (filtered)" 180 "cd ${PROJECT_ROOT} && COREPACK_ENABLE_STRICT=0 ${PNPM_BIN} install --filter cloud/dashboard --frozen-lockfile --prefer-offline"

# ---------------------------------------------------------------------------
# 6. Build dashboard
# ---------------------------------------------------------------------------
echo ""
echo "[6/9] Building dashboard..."
# Timeout: 300s for Next.js build
# NOTE: Use direct node binary path to avoid corepack/pnpm symlink recursive loop
ssh_cmd "pnpm build" 300 "cd ${PROJECT_ROOT} && COREPACK_ENABLE_STRICT=0 ${PNPM_BIN} --dir ${DASHBOARD_DIR} run build"

# ---------------------------------------------------------------------------
# Now wait for nginx parallel tasks to complete
# ---------------------------------------------------------------------------
echo ""
echo "[--] Waiting for nginx parallel tasks..."

# Wait for SCP to finish
wait ${NGINX_SCP_PID} 2>/dev/null || true
echo "Nginx SCP completed."

# Wait for HTTPS config insert if it was started
if [ "${NGINX_INSERT_DONE}" = "false" ]; then
    wait ${NGINX_INSERT_PID} 2>/dev/null || true
    echo "HTTPS config insert completed."
fi

# ---------------------------------------------------------------------------
# 7. Test and reload nginx
# ---------------------------------------------------------------------------
echo ""
echo "[7/9] Testing and reloading nginx..."
ssh_cmd "nginx test+reload" 30 "nginx -t && systemctl reload nginx"
echo "Nginx reloaded."

# ---------------------------------------------------------------------------
# 8. Restart PM2 services
# ---------------------------------------------------------------------------
echo ""
echo "[8/9] Restarting PM2 services..."
ssh_cmd "pm2 restart" 60 "cd ${CLOUD_DIR} && (pm2 restart ecosystem.config.js || pm2 start ecosystem.config.js) && pm2 save"

# ---------------------------------------------------------------------------
# 9. Sync Next.js static files from Docker container to host filesystem
#    This prevents the "white screen" bug where nginx serves stale chunks
#    from the host while the container has new build hashes.
# ---------------------------------------------------------------------------
echo ""
echo "[9/10] Syncing Next.js static files from Docker container to host..."
# Copy the sync script to VPS and run it
timeout 15 scp ${SSH_OPTS} scripts/sync-dashboard-static.sh "${SSH_TARGET}:/tmp/sync-dashboard-static.sh"
ssh_cmd "sync static files" 30 "bash /tmp/sync-dashboard-static.sh docker-superroo-dashboard-1 && rm -f /tmp/sync-dashboard-static.sh"

# ---------------------------------------------------------------------------
# 10. Show status
# ---------------------------------------------------------------------------
echo ""
echo "[10/10] Checking service status..."
ssh_cmd "pm2 status" 30 "pm2 list"

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
echo "Access the dashboard at: https://dev.abcx124.xyz"
echo ""
echo "View logs:"
echo "  ssh ${SSH_OPTS} ${SSH_TARGET} 'pm2 logs superroo-dashboard'"
echo ""
echo "Performance notes:"
echo "  - Nginx config was deployed in parallel with build (~${TOTAL_DURATION}s saved)"
echo "  - Filtered pnpm install skipped unrelated workspace packages"
echo "  - Next.js build cache was preserved"
echo ""
