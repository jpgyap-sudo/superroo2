#!/usr/bin/env node

/**
 * IDE Terminal Unit Test Runner
 *
 * Runs pure-function tests for:
 *   - computeDiff (api.ts)
 *   - ideReducer, serialize, deserialize (ide-store.tsx)
 *
 * Run: node cloud/dashboard/src/components/ide-terminal/__tests__/run-ide-tests.js
 */

const path = require("path")

// Change to dashboard directory for consistent paths
process.chdir(path.resolve(__dirname, "../../../.."))

const { test, section, printSummary, reset } = require("./test-helpers.js")

// ═══════════════════════════════════════════════════════════════════════════════
// computeDiff Tests
// ═══════════════════════════════════════════════════════════════════════════════

section("computeDiff — identical content")

const { computeDiff } = require("./api-compute-diff.test.js")

// computeDiff tests are self-contained in the module
// (they run their own test() calls via the module's inline tests)

// ═══════════════════════════════════════════════════════════════════════════════
// ide-store reducer Tests
// ═══════════════════════════════════════════════════════════════════════════════

section("ide-store reducer")

const reducerTests = require("./ide-store-reducer.test.js")

// ═══════════════════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════════════════

printSummary()
