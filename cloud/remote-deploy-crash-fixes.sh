#!/bin/bash
# SuperRoo Cloud — Remote Crash-Resilience Deployment Script
# Run this FROM YOUR LOCAL MACHINE to deploy container crash fixes to VPS via SSH
#
# Usage:
#   chmod +x cloud/remote-deploy-crash-fixes.sh
#   ./cloud/remote-deploy-crash-fixes.sh
#
# Uses root SSH access with id_superroo_vps key.

set -euo pipefail

SSH_KEY="C:\\Users\\User\\.ssh\\id_superroo_vps"
# Using Tailscale IP (100.64.175.88) instead of public IP for secure mesh connection
SSH_TARGET="root@100.64.175.88"
SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=10 -i ${SSH_KEY}"
PROJECT_ROOT="/opt/superroo2"
CLOUD_DIR="${PROJECT_ROOT}/cloud"

echo "========================================"
echo "SuperRoo Crash-Resilience Deploy"
echo "Target: ${SSH_TARGET}"
echo "========================================"

# ---------------------------------------------------------------------------
# 1. Test SSH connection
# ---------------------------------------------------------------------------
echo ""
echo "[1/7] Testing SSH connection..."
if ! ssh ${SSH_OPTS} "${SSH_TARGET}" "echo 'SSH OK'"; then
    echo "ERROR: Cannot connect to ${SSH_TARGET}"
    echo "Make sure id_superroo_vps key is accessible"
    exit 1
fi

# ---------------------------------------------------------------------------
# 2. Copy modified files to VPS
# ---------------------------------------------------------------------------
echo ""
echo "[2/7] Copying modified files to VPS..."

# List of files to deploy
FILES_TO_COPY=(
    "cloud/sandbox/Dockerfile"
    "cloud/worker/sandboxRunner.js"
    "cloud/worker/worker.js"
    "cloud/ecosystem.config.js"
    "cloud/deploy-sandbox.sh"
    "superroo-daemon.service"
)

for file in "${FILES_TO_COPY[@]}"; do
    echo "  Copying ${file}..."
    scp ${SSH_OPTS} "${file}" "${SSH_TARGET}:${PROJECT_ROOT}/${file}"
done

echo "All files copied."

# ---------------------------------------------------------------------------
# 3. Rebuild Docker sandbox image
# ---------------------------------------------------------------------------
echo ""
echo "[3/7] Rebuilding Docker sandbox image..."
ssh ${SSH_OPTS} "${SSH_TARGET}" bash -c "'
    set -e
    echo \"Cleaning up zombie sandbox containers...\"
    docker ps -a --filter \"name=superroo-sandbox\" --format \"{{.ID}}\" 2>/dev/null | while read -r cid; do
        echo \"  Removing zombie container: \$cid\"
        docker rm -f \"\$cid\" 2>/dev/null || true
    done

    echo \"Building new sandbox image...\"
    cd ${CLOUD_DIR}/sandbox
    docker build -t superroo-sandbox:latest .
    echo \"Image built successfully.\"
'"

# ---------------------------------------------------------------------------
# 4. Ensure cloud dependencies are installed
# ---------------------------------------------------------------------------
echo ""
echo "[4/7] Ensuring cloud dependencies..."
ssh ${SSH_OPTS} "${SSH_TARGET}" "cd ${CLOUD_DIR} && if [ ! -d \"node_modules/bullmq\" ]; then npm install bullmq ioredis; else echo 'Dependencies already present.'; fi"

# ---------------------------------------------------------------------------
# 5. Reload PM2 with new config and env vars
# ---------------------------------------------------------------------------
echo ""
echo "[5/7] Reloading PM2 processes..."
ssh ${SSH_OPTS} "${SSH_TARGET}" bash -c "'
    set -e
    cd ${CLOUD_DIR}

    echo \"Reloading PM2 ecosystem with new config...\"
    if pm2 describe superroo-worker &>/dev/null; then
        pm2 reload ecosystem.config.js --update-env
    else
        pm2 start ecosystem.config.js --update-env
    fi

    pm2 save
    echo \"PM2 reloaded and saved.\"
'"

# ---------------------------------------------------------------------------
# 6. Reload systemd daemon (if superroo-daemon.service changed)
# ---------------------------------------------------------------------------
echo ""
echo "[6/7] Reloading systemd daemon..."
ssh ${SSH_OPTS} "${SSH_TARGET}" bash -c "'
    set -e
    echo \"Reloading systemd daemon...\"
    systemctl daemon-reload
    echo \"Restarting superroo-daemon...\"
    systemctl restart superroo-daemon || echo \"Warning: superroo-daemon not found or failed to restart\"
    echo \"systemd reloaded.\"
'"

# ---------------------------------------------------------------------------
# 7. Verify deployment
# ---------------------------------------------------------------------------
echo ""
echo "[7/7] Verifying deployment..."
ssh ${SSH_OPTS} "${SSH_TARGET}" bash -c "'
    echo \"=== PM2 Status ===\"
    pm2 list

    echo \"\"
    echo \"=== Docker Images ===\"
    docker images superroo-sandbox

    echo \"\"
    echo \"=== Docker Sandbox Test ===\"
    docker run --rm --network=none superroo-sandbox:latest node -v 2>/dev/null || echo \"WARNING: Sandbox test failed\"

    echo \"\"
    echo \"=== API Health Check ===\"
    curl -s http://localhost:8787/health 2>/dev/null || echo \"WARNING: API health check failed\"
'"

echo ""
echo "========================================"
echo "Deployment complete!"
echo "========================================"
echo ""
echo "What was deployed:"
echo "  - Docker sandbox image rebuilt with tini, HEALTHCHECK, non-root user"
echo "  - Sandbox runner: job timeout, OOM protection, retry logic, zombie cleanup"
echo "  - Worker: graceful shutdown, Redis circuit breaker, health checks"
echo "  - PM2: exponential backoff restart, max restart limits, env vars"
echo "  - systemd: Docker socket access, resource limits, start limit burst"
echo ""
echo "To verify logs:"
echo "  ssh ${SSH_OPTS} ${SSH_TARGET} 'pm2 logs superroo-worker --lines 50'"
echo ""
echo "Rollback procedure:"
echo "  git revert HEAD && ./cloud/remote-deploy-crash-fixes.sh"
