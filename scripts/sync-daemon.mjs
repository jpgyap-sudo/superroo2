#!/usr/bin/env node
/**
 * sync-daemon.mjs — Background sync daemon
 *
 * Runs sync-all-brains.mjs on a schedule (default: every 15 minutes).
 * Logs health to ~/.superroo/sync-health.json.
 * Restarts automatically if sync fails (exponential backoff).
 *
 * Usage:
 *   node scripts/sync-daemon.mjs              # run forever (15min interval)
 *   node scripts/sync-daemon.mjs --interval=5 # 5-minute interval
 *   node scripts/sync-daemon.mjs --once       # run once and exit
 *   node scripts/sync-daemon.mjs --status     # show health log and exit
 */

import { execSync } from "child_process"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import os from "os"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, "..")
const SUPERROO_HOME = process.env.SUPERROO_HOME || path.join(os.homedir(), ".superroo")
const HEALTH_FILE = path.join(SUPERROO_HOME, "sync-health.json")
const SYNC_SCRIPT  = path.join(ROOT, "scripts", "sync-all-brains.mjs")
const LESSON_SCRIPT = path.join(ROOT, "scripts", "sync-lessons-to-central-brain.mjs")
const ACTIVE_WORK_SCRIPT = path.join(ROOT, "scripts", "gen-active-work.mjs")
const WATCH_SCRIPT = path.join(ROOT, "scripts", "sync-watch.mjs")
const HEALTH_CHECK_SCRIPT = path.join(ROOT, "scripts", "sync-health.mjs")
const MONITOR_SCRIPT = path.join(ROOT, "scripts", "sync-monitor-agent.mjs")
const ORCHESTRATOR_SCRIPT = path.join(ROOT, "scripts", "global-ecosystem-orchestrator.mjs")
const LESSON_PERSIST_SCRIPT = path.join(os.homedir(), ".superroo", "scripts", "lesson-sync-persistent.mjs")

const args = process.argv.slice(2)
const ONCE   = args.includes("--once")
const STATUS = args.includes("--status")
const intervalArg = args.find(a => a.startsWith("--interval="))
const INTERVAL_MIN = intervalArg ? parseInt(intervalArg.split("=")[1]) : 15
const ENABLE_WATCH = !args.includes("--no-watch")
const ENABLE_MONITOR = !args.includes("--no-monitor")

function loadHealth() {
  try { return JSON.parse(fs.readFileSync(HEALTH_FILE, "utf8")) }
  catch { return { runs: [], consecutiveFailures: 0 } }
}

function saveHealth(health) {
  fs.mkdirSync(path.dirname(HEALTH_FILE), { recursive: true })
  fs.writeFileSync(HEALTH_FILE, JSON.stringify(health, null, 2), "utf8")
}

function log(msg) {
  const ts = new Date().toISOString()
  console.log(`[${ts}] ${msg}`)
}

function runSync() {
  const start = Date.now()
  const health = loadHealth()
  let ok = false
  let error = null

  try {
    // 1. Sync all brains
    if (fs.existsSync(SYNC_SCRIPT)) {
      execSync(`node "${SYNC_SCRIPT}" --awareness`, {
        cwd: ROOT, timeout: 120000, stdio: "pipe",
        env: { ...process.env, PROJECT_ROOT: ROOT, SUPERROO_HOME },
      })
    }

    // 2. Sync lessons to Central Brain
    if (fs.existsSync(LESSON_SCRIPT)) {
      execSync(`node "${LESSON_SCRIPT}"`, {
        cwd: ROOT, timeout: 60000, stdio: "pipe",
        env: { ...process.env, PROJECT_ROOT: ROOT, SUPERROO_HOME },
      })
    }

    // 3. Regenerate ACTIVE_WORK.md
    if (fs.existsSync(ACTIVE_WORK_SCRIPT)) {
      execSync(`node "${ACTIVE_WORK_SCRIPT}"`, {
        cwd: ROOT, timeout: 30000, stdio: "pipe",
        env: { ...process.env, PROJECT_ROOT: ROOT, SUPERROO_HOME },
      })
    }

    // 3b. Sync lessons persistent to global store
    if (fs.existsSync(LESSON_PERSIST_SCRIPT)) {
      try {
        execSync(`node "${LESSON_PERSIST_SCRIPT}"`, { cwd: ROOT, timeout: 30000, stdio: "pipe", env: { ...process.env, PROJECT_ROOT: ROOT, SUPERROO_HOME } })
      } catch {}
    }

    // 4. Run Global Ecosystem Orchestrator (dry-run by default)
    // Only runs --force during maintenance windows (02:00-04:00)
    const now = new Date()
    const hour = now.getHours()
    const isMaintenanceWindow = hour >= 2 && hour < 4
    const orchestratorForce = isMaintenanceWindow ? ["--force"] : ["--dry-run"]
    
    if (fs.existsSync(ORCHESTRATOR_SCRIPT)) {
      try {
        execSync(`node "${ORCHESTRATOR_SCRIPT}" --full ${orchestratorForce.join(" ")}`, {
          cwd: ROOT, timeout: 120000, stdio: "pipe",
          env: { ...process.env, PROJECT_ROOT: ROOT, SUPERROO_HOME },
        })
        log(`  Ecosystem orchestrator ran ${isMaintenanceWindow ? "in force mode" : "in dry-run mode"}`)
      } catch (orchError) {
        log(`  Ecosystem orchestrator warning: ${orchError.message?.slice(0, 100)}`)
      }
    }

    ok = true
    health.consecutiveFailures = 0
  } catch (e) {
    error = e.message?.slice(0, 300)
    health.consecutiveFailures = (health.consecutiveFailures || 0) + 1
  }

  const duration = Date.now() - start
  const run = {
    timestamp: new Date().toISOString(),
    ok,
    duration_ms: duration,
    error: error || undefined,
  }

  health.lastRun = run.timestamp
  health.lastStatus = ok ? "ok" : "failed"
  health.runs = [run, ...(health.runs || [])].slice(0, 50)  // keep last 50
  saveHealth(health)

  if (ok) {
    log(`✅ Sync complete (${(duration/1000).toFixed(1)}s)`)
  } else {
    log(`❌ Sync failed: ${error} (consecutive failures: ${health.consecutiveFailures})`)
  }

  return { ok, consecutiveFailures: health.consecutiveFailures }
}

if (STATUS) {
  const health = loadHealth()
  console.log("=== Sync Daemon Health ===")
  console.log("Last run:", health.lastRun || "never")
  console.log("Last status:", health.lastStatus || "unknown")
  console.log("Consecutive failures:", health.consecutiveFailures || 0)
  console.log("\nRecent runs (last 5):")
  ;(health.runs || []).slice(0, 5).forEach(r => {
    const icon = r.ok ? "✅" : "❌"
    console.log(`  ${icon} ${r.timestamp} (${(r.duration_ms/1000).toFixed(1)}s)${r.error ? " — " + r.error : ""}`)
  })
  process.exit(0)
}

if (ONCE) {
  const { ok } = runSync()
  process.exit(ok ? 0 : 1)
}

// Continuous loop
log(`Sync daemon started — interval: ${INTERVAL_MIN}min | scripts: ${ROOT}`)
log(`  Watch mode: ${ENABLE_WATCH ? "enabled" : "disabled"}`)
log(`  Monitor mode: ${ENABLE_MONITOR ? "enabled" : "disabled"}`)
log("Press Ctrl+C to stop. Use --once for single run, --status to check health.\n")

// Start monitor agent subprocess if enabled
let monitorProcess = null
if (ENABLE_MONITOR) {
	try {
		monitorProcess = spawnMonitor()
	} catch (e) {
		log(`  Could not start monitor: ${e.message}`)
	}
}

function spawnMonitor() {
	const { spawn } = require("child_process")
	const proc = spawn("node", [MONITOR_SCRIPT], {
		cwd: ROOT,
		stdio: "pipe",
		env: { ...process.env, PROJECT_ROOT: ROOT, SUPERROO_HOME },
	})
	proc.stdout.on("data", d => process.stdout.write(d.toString()))
	proc.stderr.on("data", d => process.stderr.write(d.toString()))
	return proc
}

async function loop() {
	while (true) {
		const { ok, consecutiveFailures } = runSync()

		// Run health check after each sync
		try {
			execSync(`node "${HEALTH_CHECK_SCRIPT}"`, { cwd: ROOT, timeout: 30000, stdio: "pipe" })
		} catch {}

		// Exponential backoff on failure (cap at 60 min)
		const backoffMin = ok ? INTERVAL_MIN : Math.min(INTERVAL_MIN * Math.pow(2, consecutiveFailures), 60)
		if (!ok) log(`  Backing off to ${backoffMin}min due to failures`)

		// Check if monitor process died
		if (ENABLE_MONITOR && monitorProcess && monitorProcess.exitCode !== null) {
			log("  Monitor process died, restarting...")
			try { monitorProcess = spawnMonitor() } catch {}
		}

		await new Promise(r => setTimeout(r, backoffMin * 60 * 1000))
	}
}

// Cleanup on exit
process.on("exit", () => {
	if (monitorProcess) {
		try { monitorProcess.kill() } catch {}
	}
})

loop().catch(e => { console.error("Daemon crashed:", e); process.exit(1) })
