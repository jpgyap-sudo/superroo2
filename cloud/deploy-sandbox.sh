#!/bin/bash
# SuperRoo Cloud — Docker Sandbox Deployment Script
# Run this on the Ubuntu VPS as the user that owns /opt/superroo2
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
# 3. Build sandbox image
# ---------------------------------------------------------------------------
echo ""
echo "[3/7] Building Docker image ${IMAGE_NAME}..."
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
    # Use the Node version that matches the project (20.x)
    npm install bullmq ioredis
else
    echo "Dependencies already present."
fi

echo "Dependencies OK."

# ---------------------------------------------------------------------------
# 5. Start / restart PM2 worker
# ---------------------------------------------------------------------------
echo ""
echo "[5/7] Starting worker with PM2..."
cd "${CLOUD_DIR}"

if pm2 describe superroo-worker &> /dev/null; then
    echo "Worker already managed by PM2. Restarting..."
    pm2 restart ecosystem.config.js
else
    echo "Starting worker for the first time..."
    pm2 start ecosystem.config.js
fi

echo "Worker started."

# ---------------------------------------------------------------------------
# 6. Run test job
# ---------------------------------------------------------------------------
echo ""
echo "[6/7] Publishing test job..."
cd "${CLOUD_DIR}"
node test-job.js

echo "Test job published."

# ---------------------------------------------------------------------------
# 7. Show logs
# ---------------------------------------------------------------------------
echo ""
echo "[7/7] Tailing worker logs (Ctrl+C to exit)..."
sleep 2
pm2 logs superroo-worker --lines 50
