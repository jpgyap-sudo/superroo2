#!/usr/bin/env bash
set -euo pipefail

echo "[superroo] Installing CLI..."

cd "$(dirname "$0")/.."

pnpm install
pnpm --filter superroo check-types
pnpm --filter superroo bundle

if command -v superroo &> /dev/null; then
  echo "[superroo] CLI already available."
else
  cd src
  pnpm link --global
  echo "[superroo] Linked globally."
fi

superroo --help
