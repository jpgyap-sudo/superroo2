#!/usr/bin/env bash
set -euo pipefail

# Shell wrapper for SuperRoo autonomous mode on VPS
# Usage: ./scripts/superroo-autonomous.sh [project-path] [hours]

PROJECT_PATH="${1:-${SUPERROO_DEFAULT_PROJECT:-$(pwd)}}"
HOURS="${2:-1}"

echo "[superroo] Starting autonomous mode on ${PROJECT_PATH} for ${HOURS} hour(s)..."

superroo autonomous \
  --project "${PROJECT_PATH}" \
  --hours "${HOURS}" \
  --auto-approve \
  --no-deploy

echo "[superroo] Autonomous run finished."
