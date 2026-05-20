#!/bin/bash
# =============================================================================
# sync-dashboard-static.sh
#
# Syncs Next.js static build artifacts from the Docker container to the host
# filesystem after a dashboard rebuild. This prevents the "white screen" bug
# where nginx serves stale chunks from the host while the container has new
# build hashes.
#
# Usage:
#   ./scripts/sync-dashboard-static.sh [container-name]
#
# Default container name: docker-superroo-dashboard-1
#
# Run this AFTER: docker compose up -d superroo-dashboard
# =============================================================================

set -euo pipefail

CONTAINER="${1:-docker-superroo-dashboard-1}"
HOST_STATIC_DIR="/opt/superroo2/cloud/dashboard/.next/static"
CONTAINER_STATIC_SRC="/app/cloud/dashboard/.next/static"

echo "=== Syncing Next.js static files from container '$CONTAINER' to host ==="

# Verify container is running
if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
    echo "ERROR: Container '$CONTAINER' not found."
    echo "Available containers:"
    docker ps --format "table {{.Names}}\t{{.Status}}"
    exit 1
fi

CONTAINER_STATUS=$(docker inspect --format '{{.State.Status}}' "$CONTAINER")
if [ "$CONTAINER_STATUS" != "running" ]; then
    echo "ERROR: Container '$CONTAINER' is '$CONTAINER_STATUS', not running."
    exit 1
fi

echo "Container '$CONTAINER' is running. Proceeding with sync..."

# Get the current BUILD_ID from the container
BUILD_ID=$(docker exec "$CONTAINER" cat /app/cloud/dashboard/.next/BUILD_ID 2>/dev/null || echo "")
if [ -z "$BUILD_ID" ]; then
    echo "ERROR: Could not read BUILD_ID from container."
    exit 1
fi
echo "Build ID: $BUILD_ID"

# Ensure host static directory exists
mkdir -p "$HOST_STATIC_DIR"

# Sync all static files from container to host
echo "Copying static files from container to host..."
docker cp "$CONTAINER:$CONTAINER_STATIC_SRC/." "$HOST_STATIC_DIR/"

# Also sync the standalone .next/static (used by Next.js server)
echo "Copying standalone static files..."
docker cp "$CONTAINER:/app/cloud/dashboard/.next/standalone/.next/static/." "$HOST_STATIC_DIR/" 2>/dev/null || true

# Update BUILD_ID on host
echo "Updating BUILD_ID on host..."
docker cp "$CONTAINER:/app/cloud/dashboard/.next/BUILD_ID" "/opt/superroo2/cloud/dashboard/.next/BUILD_ID"

# Clean up old/stale chunks that don't match current build
echo "Cleaning up stale chunks..."
HOST_CHUNKS_DIR="$HOST_STATIC_DIR/chunks"
if [ -d "$HOST_CHUNKS_DIR" ]; then
    # Get list of current chunk filenames from the container
    CONTAINER_CHUNKS=$(docker exec "$CONTAINER" ls /app/cloud/dashboard/.next/static/chunks/ 2>/dev/null || true)
    
    # Remove host chunks not present in container
    for HOST_CHUNK in "$HOST_CHUNKS_DIR"/*; do
        CHUNK_NAME=$(basename "$HOST_CHUNK")
        if ! echo "$CONTAINER_CHUNKS" | grep -q "^${CHUNK_NAME}$"; then
            echo "  Removing stale: $CHUNK_NAME"
            rm -f "$HOST_CHUNK"
        fi
    done
fi

echo ""
echo "=== Sync complete ==="
echo "Build ID: $BUILD_ID"
echo "Host static dir: $HOST_STATIC_DIR"
echo ""
echo "Verify with: curl -sI https://dev.abcx124.xyz/_next/static/chunks/webpack-*.js"
