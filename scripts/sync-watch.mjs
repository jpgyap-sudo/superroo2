#!/usr/bin/env node
/**
 * sync-watch.mjs — Real-time sync triggers
 *
 * Watches memory files for changes and triggers sync operations automatically.
 * Uses fs.watch with 500ms debounce to avoid duplicate sync triggers.
 *
 * Usage:
 *   node scripts/sync-watch.mjs              # Start watching
 *   node scripts/sync-watch.mjs --once       # Single check then exit
 *   node scripts/sync-watch.mjs --status     # Show watch state
 *   node scripts/sync-watch.mjs --dry-run    # Watch but don't sync
 */

import fs from "fs"
import fsSync from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { execSync } from "child_process"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, "..")

const WATCHED_FILES = [
	path.join(ROOT, "memory", "lessons-learned.md"),
	path.join(ROOT, "memory", "lesson-index.jsonl"),
	path.join(ROOT, "ACTIVE_WORK.md"),
]

const LOCAL_SYNC_SCRIPT = path.join(ROOT, "scripts", "sync-local-extension-lessons.mjs")
const ALL_BRAINS_SCRIPT = path.join(ROOT, "scripts", "sync-all-brains.mjs")

const args = process.argv.slice(2)
const ONCE = args.includes("--once")
const STATUS = args.includes("--status")
const DRY_RUN = args.includes("--dry-run")

const DEBOUNCE_MS = 500
const pendingTimers = {}

function log(msg) {
	const ts = new Date().toISOString()
	console.log(`[${ts}] ${msg}`)
}

function syncLocalAndAll() {
	if (DRY_RUN) {
		log("Would run sync-local-extension-lessons.mjs && sync-all-brains.mjs --awareness")
		return
	}

	try {
		execSync(`node "${LOCAL_SYNC_SCRIPT}"`, { cwd: ROOT, timeout: 120000, stdio: "pipe" })
		execSync(`node "${ALL_BRAINS_SCRIPT}" --awareness`, { cwd: ROOT, timeout: 60000, stdio: "pipe" })
		log("✅ Local sync + awareness sync completed")
	} catch (err) {
		log(`❌ Sync failed: ${err.message?.slice(0, 200)}`)
	}
}

function handleChange(filePath) {
	const basename = path.basename(filePath)
	if (pendingTimers[basename]) {
		clearTimeout(pendingTimers[basename])
	}
	pendingTimers[basename] = setTimeout(() => {
		log(`File changed: ${basename}`)
		syncLocalAndAll()
		delete pendingTimers[basename]
	}, DEBOUNCE_MS)
}

function startWatching() {
	log("👀 Starting sync watcher...")
	log(`   Watching: ${WATCHED_FILES.length} files`)

	for (const file of WATCHED_FILES) {
		if (fs.existsSync(file)) {
			log(`   ✓ ${path.basename(file)}`)
		} else {
			log(`   ○ ${path.basename(file)} (not found, will watch on create)`)
		}
	}
	log("Press Ctrl+C to stop.\n")

	for (const file of WATCHED_FILES) {
		const dir = path.dirname(file)
		fs.watch(dir, { persistent: true }, (eventType, filename) => {
			if (eventType === "change" || eventType === "rename") {
				if (filename && path.basename(file) === filename) {
					handleChange(file)
				}
			}
		})
	}
}

function showStatus() {
	const stateFile = path.join(ROOT, "memory", ".sync-watch-state.json")
	const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : { lastEvents: [] }

	console.log("=== Sync Watch State ===")
	console.log("Watched files:")
	for (const file of WATCHED_FILES) {
		const exists = fs.existsSync(file)
		console.log(`  ${exists ? "✓" : "○"} ${path.basename(file)}`)
	}
	console.log("\nLast events:")
	for (const event of state.lastEvents.slice(0, 10)) {
		console.log(`  ${event.type} ${event.file} at ${event.timestamp}`)
	}
}

function saveEvent(file, type) {
	const stateFile = path.join(ROOT, "memory", ".sync-watch-state.json")
	const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : { lastEvents: [] }
	state.lastEvents = [{ type, file, timestamp: new Date().toISOString() }, ...(state.lastEvents || []).slice(0, 99)]
	fsSync.mkdirSync(path.dirname(stateFile), { recursive: true })
	fsSync.writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf8")
}

if (STATUS) {
	showStatus()
} else {
	if (ONCE) {
		syncLocalAndAll()
	} else {
		startWatching()
	}
}