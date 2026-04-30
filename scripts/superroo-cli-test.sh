#!/usr/bin/env bash
set -euo pipefail

pnpm build
node dist/cli/index.js status
node dist/cli/index.js autonomous --mode safe
node dist/cli/index.js check-vps --url http://localhost:3000
