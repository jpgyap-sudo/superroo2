#!/bin/bash
# SuperRoo Cloud — Docker Sandbox Deployment Script
# Run this on the Ubuntu VPS as the user that owns /opt/superroo2
#
# Crash-resilient deployment with:
# - Prunes old sandbox containers before build
# - Validates Docker daemon health
# - Cleans up zombie containers from previous runs
#
# Usage:
#   chmod +x deploy-sandbox.sh
#   ./deploy-sandbox.sh

set -euo pipefail

PROJECT_ROOT="/opt/superroo2"
CLOUD_DIR="${PROJECT_ROOT}/cloud"
SANDBOX_DIR="${CLOUD_DIR}/sandbox"
LOGS_DIR="${CLOUD_DIR}/logs/jobs"
IMAGE_NAME="superroo-sandbox:latest"

echo "========================================"
echo "SuperRoo Cloud Sandbox Deploy"
echo "========================================"

# ---------------------------------------------------------------------------
# 1. Verify Docker
# ---------------------------------------------------------------------------
echo ""
echo "[1/7] Checking Docker..."
if ! command -v docker &> /dev/null; then
    echo "ERROR: Docker is not installed. Install it first:"
    echo "  sudo apt-get update && sudo apt-get install -y docker.io"
    exit 1
fi

if ! sudo systemctl is-active --quiet docker; then
    echo "Docker is not running. Starting it..."
    sudo systemctl start docker
    # Wait for Docker daemon to be ready
    for i in {1..10}; do
        if docker info &>/dev/null; then
            echo "Docker daemon ready."
            break
        fi
        echo "Waiting for Docker daemon... ($i/10)"
        sleep 2
    done
fi

echo "Docker OK: $(docker --version)"

# ---------------------------------------------------------------------------
# 2. Create folders
# ---------------------------------------------------------------------------
echo ""
echo "[2/7] Creating directories..."
mkdir -p "${CLOUD_DIR}/sandbox/jobs"
mkdir -p "${LOGS_DIR}"
mkdir -p "${CLOUD_DIR}/worker"
echo "Directories OK."

# ---------------------------------------------------------------------------
# 3. Clean up zombie sandbox containers and build image
# ---------------------------------------------------------------------------
echo ""
echo "[3/7] Cleaning up zombie containers and building image..."
# Remove any leftover sandbox containers from crashed runs
docker ps -a --filter "name=superroo-sandbox" --format "{{.ID}}" 2>/dev/null | while read -r cid; do
    echo "  Cleaning up zombie container: $cid"
    docker rm -f "$cid" 2>/dev/null || true
done

cd "${SANDBOX_DIR}"
docker build -t "${IMAGE_NAME}" .
echo "Image built OK."

# ---------------------------------------------------------------------------
# 4. Install worker dependencies
# ---------------------------------------------------------------------------
echo ""
echo "[4/7] Installing worker dependencies..."
cd "${CLOUD_DIR}"

# Check if node_modules exists and has bullmq
if [ ! -d "node_modules/bullmq" ] || [ ! -d "node_modules/ioredis" ]; then
    npm install bullmq ioredis
else
    echo "Dependencies already present."
fi

echo "Dependencies OK."

# ---------------------------------------------------------------------------
# 5. Start / restart PM2 processes
# ---------------------------------------------------------------------------
echo ""
echo "[5/7] Starting PM2 processes..."
cd "${CLOUD_DIR}"

if pm2 describe superroo-worker &> /dev/null; then
    echo "Reloading PM2 ecosystem (graceful)..."
    pm2 reload ecosystem.config.js --update-env || pm2 restart ecosystem.config.js --update-env
else
    echo "Starting PM2 for the first time..."
    pm2 start ecosystem.config.js --update-env
fi

# Save PM2 process list for resurrection on reboot
pm2 save

echo "PM2 processes started."

# ---------------------------------------------------------------------------
# 6. Run test job
# ---------------------------------------------------------------------------
echo ""
echo "[6/7] Publishing test job..."
cd "${CLOUD_DIR}"
node test-job.js

echo "Test job published."

# ---------------------------------------------------------------------------
# 7. Show status
# ---------------------------------------------------------------------------
echo ""
echo "[7/7] Deployment status:"
pm2 status
echo ""
echo "To view worker logs: pm2 logs superroo-worker --lines 50"
