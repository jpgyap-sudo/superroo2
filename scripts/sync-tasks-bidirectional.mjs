#!/usr/bin/env node
/**
 * sync-tasks-bidirectional.mjs
 *
 * Keeps the nested global task registry and extension-local task files in sync.
 * The global registry shape is:
 *   { version, projects: { [projectId]: { [agentId]: Task[], updatedAt } } }
 *
 * Usage:
 *   node scripts/sync-tasks-bidirectional.mjs
 *   node scripts/sync-tasks-bidirectional.mjs --status
 *   node scripts/sync-tasks-bidirectional.mjs --watch
 *   node scripts/sync-tasks-bidirectional.mjs --dry-run
 */

import fs from "fs"
import fsSync from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, "..")
const HOME = process.env.USERPROFILE || process.env.HOME || ""
const SUPERROO_HOME = process.env.SUPERROO_HOME || path.join(HOME, ".superroo")
const CURRENT_PROJECT = process.env.PROJECT_ID || path.basename(ROOT)

const GLOBAL_TASKS = path.join(SUPERROO_HOME, "tasks", "global-tasks.json")
const CODEX_TASKS = path.join(ROOT, "server", "src", "memory", "codextask.json")
const CLAUDE_TASKS = path.join(ROOT, "server", "src", "memory", "claudetask.json")
const KILO_TASKS =
	process.env.KILO_TASKS_PATH || path.join(HOME, ".kilo", "memory", "tasks.json")
const KILO_LEGACY_TASKS =
	process.env.KILO_LEGACY_TASKS_PATH ||
	path.join(HOME, ".config", "kilo", "memory", "tasks.json")
const BLACKBOX_TASKS =
	process.env.BLACKBOX_TASKS_PATH ||
	path.join(HOME, "Documents", ".blackbox", "tasks.json")
const COPILOT_TASKS =
	process.env.COPILOT_TASKS_PATH || path.join(ROOT, ".github", "copilot-tasks.json")

const args = process.argv.slice(2)
const STATUS_ONLY = args.includes("--status")
const WATCH_MODE = args.includes("--watch")
const DRY_RUN = args.includes("--dry-run")

const LOCK_FILE = path.join(SUPERROO_HOME, "sync-lock.json")
const DEBOUNCE_MS = 500

const EXTENSIONS = [
  { file: CODEX_TASKS, agent: "codex" },
  { file: CLAUDE_TASKS, agent: "claude" },
  { file: KILO_TASKS, agent: "kilo-code" },
  { file: KILO_LEGACY_TASKS, agent: "kilo-legacy" },
  { file: BLACKBOX_TASKS, agent: "blackbox" },
  { file: COPILOT_TASKS, agent: "copilot" },
]

function log(msg) {
	console.log(`[${new Date().toISOString()}] ${msg}`)
}

function loadJson(file, fallback) {
	try { return JSON.parse(fsSync.readFileSync(file, "utf8")) } catch { return fallback }
}

function saveJson(file, data) {
	if (DRY_RUN) return
	const dir = path.dirname(file)
	if (!fsSync.existsSync(dir)) fsSync.mkdirSync(dir, { recursive: true })
	fsSync.writeFileSync(file, JSON.stringify(data, null, 2), "utf8")
}

function acquireLock() {
	const lockDir = path.dirname(LOCK_FILE)
	if (!fsSync.existsSync(lockDir)) fsSync.mkdirSync(lockDir, { recursive: true })
	if (fsSync.existsSync(LOCK_FILE)) {
		const lock = loadJson(LOCK_FILE, null)
		const age = lock?.acquiredAt ? Date.now() - new Date(lock.acquiredAt).getTime() : 0
		if (age < 30000) return false
	}
	saveJson(LOCK_FILE, { acquiredAt: new Date().toISOString(), pid: process.pid })
	return true
}

function releaseLock() {
	try { fsSync.unlinkSync(LOCK_FILE) } catch {}
}

function normalizeGlobalRegistry(data) {
	if (data?.projects) return data
	const registry = { version: data?.version || 1, projects: {} }
	for (const task of data?.tasks || []) {
		const project = task.project || CURRENT_PROJECT
		const agent = task.agent || "unknown"
		ensureBucket(registry, project, agent).push(stripRoutingFields(task))
	}
	return registry
}

function stripRoutingFields(task) {
	const { project, syncedAt, ...rest } = task
	return rest
}

function ensureBucket(registry, project, agent) {
	if (!registry.projects) registry.projects = {}
	if (!registry.projects[project]) registry.projects[project] = {}
	if (!Array.isArray(registry.projects[project][agent])) registry.projects[project][agent] = []
	return registry.projects[project][agent]
}

function allGlobalTasks(registry) {
	const tasks = []
	for (const [project, projectData] of Object.entries(registry.projects || {})) {
		for (const [agent, agentTasks] of Object.entries(projectData || {})) {
			if (agent === "updatedAt" || !Array.isArray(agentTasks)) continue
			for (const task of agentTasks) tasks.push({ ...task, project, agent })
		}
	}
	return tasks
}

function loadGlobal() {
	return normalizeGlobalRegistry(loadJson(GLOBAL_TASKS, { version: 1, projects: {} }))
}

function loadExtension(file) {
	const data = loadJson(file, { tasks: [] })
	if (!Array.isArray(data.tasks)) data.tasks = []
	return data
}

function syncExtensionToGlobal(registry, extensionData, agent) {
	let changed = false
	for (const task of extensionData.tasks || []) {
		if (task.agent && task.agent !== agent) continue
		const project = task.project || CURRENT_PROJECT
		const bucket = ensureBucket(registry, project, agent)
		const existing = bucket.find(t => t.id === task.id)
		const incoming = { ...stripRoutingFields(task), agent }
		if (!existing) {
			bucket.push({ ...incoming, updatedAt: incoming.updatedAt || new Date().toISOString() })
			changed = true
		} else if ((task.updatedAt || "") >= (existing.updatedAt || "") && JSON.stringify(existing) !== JSON.stringify(incoming)) {
			Object.assign(existing, incoming, { updatedAt: task.updatedAt || new Date().toISOString() })
			changed = true
		}
	}
	return changed
}

function syncGlobalToExtension(task, extensionData) {
	const existing = extensionData.tasks.find(t => t.id === task.id)
	const incoming = { ...task, syncedAt: new Date().toISOString() }
	if (!existing) {
		extensionData.tasks.push(incoming)
		return true
	}
	if ((task.updatedAt || "") > (existing.updatedAt || "")) {
		Object.assign(existing, incoming)
		return true
	}
	return false
}

function fullSync() {
	if (!acquireLock()) {
		log("Could not acquire lock; another sync is in progress")
		return
	}

	try {
		const registry = loadGlobal()
		let globalChanged = false

		log("Bidirectional task sync")
		log(`   Global tasks: ${allGlobalTasks(registry).length}`)

		for (const ext of EXTENSIONS) {
			const local = loadExtension(ext.file)
			log(`   ${ext.agent} tasks: ${local.tasks.length}`)
			if (syncExtensionToGlobal(registry, local, ext.agent)) globalChanged = true
		}

		if (globalChanged) {
			registry.updatedAt = new Date().toISOString()
			if (registry.projects[CURRENT_PROJECT]) registry.projects[CURRENT_PROJECT].updatedAt = registry.updatedAt
			saveJson(GLOBAL_TASKS, registry)
			log("   Synced extension tasks into global registry")
		}

		const globalTasks = allGlobalTasks(loadGlobal())
		for (const ext of EXTENSIONS) {
			const local = loadExtension(ext.file)
			let localChanged = false
			for (const task of globalTasks.filter(t => t.agent === ext.agent)) {
				if (syncGlobalToExtension(task, local)) localChanged = true
			}
			if (localChanged) {
				saveJson(ext.file, local)
				log(`   Synced global tasks to ${ext.agent}`)
			}
		}

		log("Sync complete")
	} finally {
		releaseLock()
	}
}

function showStatus() {
	const registry = loadGlobal()
	console.log("=== Task Sync Status ===")
	console.log(`Global: ${allGlobalTasks(registry).length} tasks`)
	for (const ext of EXTENSIONS) {
		console.log(`${ext.agent}: ${loadExtension(ext.file).tasks.length} tasks`)
	}
	const lock = fsSync.existsSync(LOCK_FILE) ? loadJson(LOCK_FILE, null) : null
	if (lock) console.log(`Lock: acquired at ${lock.acquiredAt} (pid ${lock.pid})`)
}

function watchMode() {
	log("Watching global-tasks.json for changes...")
	let pending = null
	const watcher = fs.watch(GLOBAL_TASKS, { persistent: true }, () => {
		if (pending) clearTimeout(pending)
		pending = setTimeout(() => fullSync(), DEBOUNCE_MS)
	})
	process.on("SIGINT", () => {
		watcher.close()
		releaseLock()
		process.exit(0)
	})
}

if (STATUS_ONLY) showStatus()
else if (WATCH_MODE) watchMode()
else fullSync()
