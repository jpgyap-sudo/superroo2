#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${SUPERROO_APP_DIR:-/opt/superroo}"
SERVICE_NAME="${SUPERROO_SERVICE_NAME:-superroo-daemon}"

cd "$APP_DIR"

if command -v corepack >/dev/null 2>&1; then
	corepack enable
fi

pnpm install --frozen-lockfile
pnpm --filter superroo check-types
pnpm --filter superroo test super-roo super-roo-host
pnpm vsix

sudo systemctl daemon-reload
sudo systemctl restart "$SERVICE_NAME"
sudo systemctl --no-pager --full status "$SERVICE_NAME"

