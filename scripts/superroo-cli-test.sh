#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

pnpm --filter superroo check-types
pnpm --filter superroo bundle
node src/dist/cli/index.js --help
node src/dist/cli/index.js status --project .
node src/dist/cli/index.js task "smoke test cli contract"
node src/dist/cli/index.js autonomous --mode safe --hours 1 --no-deploy
