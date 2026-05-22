#!/usr/bin/env node
/**
 * SuperRoo OpenHands Upgrade Check
 *
 * Verifies that all OpenHands-style upgrade modules are present and loadable.
 * Run in CI or locally:
 *   node scripts/check-openhands-upgrade.mjs
 *   pnpm --dir cloud superroo:upgrade:check
 */

import { createRequire } from "module"
import { existsSync } from "fs"
import { fileURLToPath } from "url"
import path from "path"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, "..")
const require = createRequire(import.meta.url)

const CHECKS = [
  {
    label: "TaskStateMachine",
    path: "cloud/orchestrator/modules/TaskStateMachine.js",
    test: (m) => typeof m.assertTransition === "function" && typeof m.nextAllowed === "function",
  },
  {
    label: "SuperRooEventBus",
    path: "cloud/orchestrator/modules/SuperRooEventBus.js",
    test: (m) => m.eventBus && typeof m.eventBus.emit === "function" && typeof m.eventBus.subscribe === "function",
  },
  {
    label: "BrainClient",
    path: "cloud/orchestrator/modules/BrainClient.js",
    test: (m) => typeof m.BrainClient === "function" && m.brainClient,
  },
  {
    label: "Runtime Policy",
    path: "cloud/runtime/policy.js",
    test: (m) => typeof m.validateCommand === "function",
  },
  {
    label: "Runtime Server (file exists)",
    path: "cloud/runtime/server.js",
    test: null, // file-only check
  },
  {
    label: "Task Schema",
    path: "cloud/schemas/task.schema.json",
    test: (m) => m.title === "SuperRooTask" && Array.isArray(m.required),
  },
  {
    label: "PR Review Workflow",
    path: ".github/workflows/superroo-pr-review.yml",
    test: null,
  },
  {
    label: "Task Runner",
    path: "cloud/orchestrator/runTask.js",
    test: null,
  },
]

let passed = 0
let failed = 0

for (const check of CHECKS) {
  const fullPath = path.join(root, check.path)
  const exists = existsSync(fullPath)

  if (!exists) {
    console.error(`  FAIL  ${check.label} — file not found: ${check.path}`)
    failed++
    continue
  }

  if (check.test) {
    try {
      const mod = require(fullPath)
      if (!check.test(mod)) {
        console.error(`  FAIL  ${check.label} — module loaded but exports check failed`)
        failed++
        continue
      }
    } catch (err) {
      console.error(`  FAIL  ${check.label} — require threw: ${err.message}`)
      failed++
      continue
    }
  }

  console.log(`  PASS  ${check.label}`)
  passed++
}

console.log(`\n${passed}/${passed + failed} checks passed`)

if (failed > 0) {
  console.error(`\n${failed} check(s) failed — OpenHands upgrade incomplete`)
  process.exit(1)
}

console.log("\nOpenHands upgrade verified — all modules present and loadable")
