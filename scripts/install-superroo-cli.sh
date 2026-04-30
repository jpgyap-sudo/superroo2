#!/usr/bin/env bash
set -euo pipefail

pnpm install
pnpm build
pnpm link --global
superroo status
