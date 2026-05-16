/**
 * Record the settings upgrade deploy in commit-deploy-log.json
 * Uses safeWriteJson for atomic writes.
 *
 * Usage: node scripts/record-settings-deploy.mjs
 */
import { fileURLToPath } from "url"
import { dirname, resolve } from "path"
import { createRequire } from "module"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Use dynamic import for safeWriteJson (TypeScript file)
const safeWriteJsonPath = resolve(__dirname, "..", "src", "utils", "safeWriteJson.ts")

// We'll read and write the JSON file directly since safeWriteJson is TS
// and we're in a plain .mjs script. Use fs with atomic write pattern.
import fs from "fs/promises"
import path from "path"

const LOG_PATH = resolve(__dirname, "..", "server", "src", "memory", "commit-deploy-log.json")

async function main() {
  // Read current log
  const raw = await fs.readFile(LOG_PATH, "utf-8")
  const log = JSON.parse(raw)

  const now = Date.now()
  const deployId = `deploy-${now}`

  // Add deploy record
  log.deploys.push({
    id: deployId,
    version: "1.1.0",
    commitSha: "settings-upgrade-001",
    agent: "Roo Code",
    status: "building",
    startedAt: now,
    healthCheck: null,
    rolledBack: false,
  })

  // Update log version
  log.version = "1.1.0"

  // Atomic write: write to temp file then rename
  const tmpPath = LOG_PATH + ".tmp"
  await fs.writeFile(tmpPath, JSON.stringify(log, null, 2), "utf-8")
  await fs.rename(tmpPath, LOG_PATH)

  console.log(`✅ Deploy ${deployId} recorded (version 1.1.0, commit settings-upgrade-001)`)
  console.log(`   Status: building`)
}

main().catch((err) => {
  console.error("❌ Failed to record deploy:", err)
  process.exit(1)
})
