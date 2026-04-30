#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

pnpm install
pnpm --filter superroo check-types
pnpm --filter superroo bundle

cd src
pnpm link --global
superroo status
