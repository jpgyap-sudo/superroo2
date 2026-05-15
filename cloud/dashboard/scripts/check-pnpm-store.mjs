#!/usr/bin/env node

/**
 * check-pnpm-store.mjs
 *
 * Phase 1A: Fix pnpm store corruption by verifying that `next@14.2.3` and
 * `react@18.3.1` packages exist uncorrupted in the pnpm store before building.
 *
 * Corruption manifests as:
 *   - Cannot find module '.../processChild.js' (Jest worker missing)
 *   - Cannot find module '.../next/dist/bin/next' (next binary missing)
 *   - `pnpm store status` shows next@14.2.3 and react@18.3.1 as "mutated"
 *
 * If either package is missing or corrupted, runs `pnpm install --force` to
 * repair the store. Returns exit code 0 on success, non-zero on failure.
 */

import { existsSync } from "fs";
import { readdirSync } from "fs";
import { accessSync, constants } from "fs";
import { execSync } from "child_process";
import { resolve } from "path";

const DASHBOARD_DIR = resolve(import.meta.dirname, "..");
const PNPM_DIR = resolve(DASHBOARD_DIR, "node_modules", ".pnpm");

/** Packages to verify — name → { globPrefix, requiredFile } */
const PACKAGES = {
  "next@14.2.3": {
    globPrefix: "next@14.2.3",
    requiredFile: "dist/bin/next",
  },
  "react@18.3.1": {
    globPrefix: "react@18.3.1",
    requiredFile: "index.js",
  },
};

/**
 * Find the pnpm store directory for a given package glob prefix.
 * pnpm uses names like `next@14.2.3_@babel+core@7.24.0_react@18.3.1` etc.
 */
function findPkgDir(globPrefix) {
  if (!existsSync(PNPM_DIR)) return null;
  const entries = readdirSync(PNPM_DIR);
  const match = entries.find((e) => e.startsWith(globPrefix));
  if (!match) return null;
  return resolve(PNPM_DIR, match, "node_modules", globPrefix.split("@")[0]);
}

/**
 * Check if a required file exists and is readable inside a package directory.
 */
function checkRequiredFile(pkgDir, requiredFile) {
  const fullPath = resolve(pkgDir, requiredFile);
  try {
    accessSync(fullPath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Run `pnpm install --force` to repair the store.
 */
function repairStore() {
  console.log("[check-pnpm-store] Running pnpm install --force to repair store...");
  execSync("pnpm install --force", {
    cwd: DASHBOARD_DIR,
    stdio: "inherit",
  });
  console.log("[check-pnpm-store] pnpm install --force completed successfully.");
}

let needsRepair = false;

console.log("[check-pnpm-store] Verifying pnpm store integrity...");

for (const [pkg, config] of Object.entries(PACKAGES)) {
  const pkgDir = findPkgDir(config.globPrefix);

  if (!pkgDir) {
    console.log(`[check-pnpm-store]  ✗ ${pkg}: directory not found in .pnpm store`);
    needsRepair = true;
    continue;
  }

  const valid = checkRequiredFile(pkgDir, config.requiredFile);
  if (valid) {
    console.log(`[check-pnpm-store]  ✓ ${pkg}: ${config.requiredFile} is present and readable`);
  } else {
    console.log(`[check-pnpm-store]  ✗ ${pkg}: ${config.requiredFile} is missing or corrupted`);
    needsRepair = true;
  }
}

if (needsRepair) {
  console.log("[check-pnpm-store] Corruption detected. Repairing store...");
  try {
    repairStore();
    console.log("[check-pnpm-store] Store repair complete. Exiting with code 0.");
    process.exit(0);
  } catch (err) {
    console.error("[check-pnpm-store] Store repair FAILED:", err.message);
    process.exit(1);
  }
} else {
  console.log("[check-pnpm-store] All packages verified. Store is healthy. Exiting with code 0.");
  process.exit(0);
}
