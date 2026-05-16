#!/bin/bash
# SuperRoo Cloud — VPS Docker Sandbox Test Script
# Run this ON THE VPS as the user that owns /opt/superroo2
#
# Usage:
#   chmod +x run-test-on-vps.sh
#   ./run-test-on-vps.sh

set -euo pipefail

PROJECT_ROOT="/opt/superroo2"
CLOUD_DIR="${PROJECT_ROOT}/cloud"
API_DIR="${CLOUD_DIR}/api"
LOGS_DIR="${CLOUD_DIR}/logs/jobs"
SANDBOX_DIR="${CLOUD_DIR}/sandbox"

echo "========================================"
echo "SuperRoo Cloud — Docker Sandbox Test"
echo "========================================"

# ---------------------------------------------------------------------------
# 1. Verify Docker & Redis
# ---------------------------------------------------------------------------
echo ""
echo "[1/9] Checking Docker..."
if ! command -v docker &> /dev/null; then
    echo "ERROR: Docker is not installed."
    exit 1
fi
if ! sudo systemctl is-active --quiet docker; then
    echo "Starting Docker..."
    sudo systemctl start docker
fi
echo "Docker OK: $(docker --version)"

echo ""
echo "[2/9] Checking Redis..."
if ! redis-cli ping &> /dev/null; then
    echo "WARNING: Redis not responding. Make sure Redis is running."
else
    echo "Redis OK"
fi

# ---------------------------------------------------------------------------
# 2. Ensure API file exists
# ---------------------------------------------------------------------------
echo ""
echo "[3/9] Ensuring API file..."
mkdir -p "${API_DIR}"
if [ ! -f "${API_DIR}/api.js" ]; then
    echo "ERROR: ${API_DIR}/api.js missing."
    echo "Copy cloud/api/api.js from your local repo to ${API_DIR}/api.js"
    exit 1
fi
echo "API file OK."

# ---------------------------------------------------------------------------
# 3. Install cloud dependencies
# ---------------------------------------------------------------------------
echo ""
echo "[4/9] Installing cloud dependencies..."
cd "${CLOUD_DIR}"
if [ ! -d "node_modules/bullmq" ] || [ ! -d "node_modules/ioredis" ]; then
    npm install bullmq ioredis
else
    echo "Dependencies already present."
fi

# ---------------------------------------------------------------------------
# 4. Build sandbox Docker image
# ---------------------------------------------------------------------------
echo ""
echo "[5/9] Building sandbox image..."
cd "${SANDBOX_DIR}"
docker build -t superroo-sandbox:latest .
echo "Image built OK."

# ---------------------------------------------------------------------------
# 5. Start / restart PM2 services (API + Worker)
# ---------------------------------------------------------------------------
echo ""
echo "[6/9] Starting PM2 services..."
cd "${CLOUD_DIR}"
pm2 start ecosystem.config.js 2>/dev/null || pm2 restart ecosystem.config.js
pm2 save
echo "PM2 services started."

# ---------------------------------------------------------------------------
# 6. Wait for API to be ready
# ---------------------------------------------------------------------------
echo ""
echo "[7/9] Waiting for API (port 8787)..."
for i in {1..30}; do
    if curl -s http://localhost:8787/job -X POST -H "Content-Type: application/json" -d '{"task":"ping","commands":["echo pong"]}' &>/dev/null; then
        echo "API is ready."
        break
    fi
    sleep 1
done

# ---------------------------------------------------------------------------
# 7. Send test job via API
# ---------------------------------------------------------------------------
echo ""
echo "[8/9] Sending test job to http://localhost:8787/job..."
curl -s http://localhost:8787/job -X POST \
  -H "Content-Type: application/json" \
  -d @"${CLOUD_DIR}/test-payload.json" \
  && echo "" || echo "API call failed"

# ---------------------------------------------------------------------------
# 8. Wait for worker to process
# ---------------------------------------------------------------------------
echo ""
echo "[9/9] Waiting for job processing (15s)..."
sleep 15

# ---------------------------------------------------------------------------
# 9. Check logs
# ---------------------------------------------------------------------------
echo ""
echo "========================================"
echo "PM2 Worker Logs (last 100 lines)"
echo "========================================"
pm2 logs superroo-worker --lines 100 --nostream

echo ""
echo "========================================"
echo "Saved Job Logs"
echo "========================================"
if [ -d "${LOGS_DIR}" ]; then
    LATEST_LOG=$(ls -t "${LOGS_DIR}"/*.log 2>/dev/null | head -n 1)
    if [ -n "${LATEST_LOG}" ]; then
        echo "Latest log file: ${LATEST_LOG}"
        echo ""
        cat "${LATEST_LOG}"
    else
        echo "No .log files found in ${LOGS_DIR}"
    fi
else
    echo "Logs directory not found: ${LOGS_DIR}"
fi

# ---------------------------------------------------------------------------
# 10. Verify sandbox isolation
# ---------------------------------------------------------------------------
echo ""
echo "========================================"
echo "Verification"
echo "========================================"
echo "1. Check if Docker container ran:"
docker ps -a --filter "name=superroo-sandbox-" --format "table {{.Names}}\t{{.Status}}\t{{.Command}}"

echo ""
echo "2. Check if repo was cloned INSIDE sandbox (not on host):"
LATEST_JOB_DIR=$(ls -td "${CLOUD_DIR}/sandbox/jobs"/* 2>/dev/null | head -n 1)
if [ -n "${LATEST_JOB_DIR}" ]; then
    echo "Latest job folder: ${LATEST_JOB_DIR}"
    ls -la "${LATEST_JOB_DIR}/"
else
    echo "No job folders found."
fi

echo ""
echo "3. Confirm no test-repo exists in project root:"
if [ -d "${PROJECT_ROOT}/test-repo" ]; then
    echo "WARNING: test-repo found in project root! Possible host contamination."
else
    echo "OK: No test-repo in ${PROJECT_ROOT}"
fi

echo ""
echo "========================================"
echo "Test complete!"
echo "========================================"
