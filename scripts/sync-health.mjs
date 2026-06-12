#!/usr/bin/env node
/**
 * sync-health.mjs — Sync health dashboard reporter
 *
 * Outputs JSON health report:
 * - Per-extension sync status (last sync time, entry counts, error rates)
 * - VPS connectivity status
 * - Ollama availability
 * - Daemon health
 * - Conflict count
 *
 * Usage:
 *   node scripts/sync-health.mjs              # Full health report
 *   node scripts/sync-health.mjs --json     # JSON output
 *   node scripts/sync-health.mjs --status   # Quick status
 */

import fs from "fs"
import fsSync from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, "..")
const SUPERROO_HOME = process.env.SUPERROO_HOME || path.join(process.env.USERPROFILE || process.env.HOME, ".superroo")

const args = process.argv.slice(2)
const JSON_OUTPUT = args.includes("--json")
const STATUS_ONLY = args.includes("--status")

const API_URL = process.env.SUPERROO_API_URL || "https://dev.abcx124.xyz/api"
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434"

function loadJson(file, fallback = {}) {
	try { return JSON.parse(fsSync.readFileSync(file, "utf8")) } catch { return fallback }
}

function loadJsonl(file) {
	try {
		const content = fsSync.readFileSync(file, "utf8")
		return content.split("\n").filter(Boolean).map(l => {
			try { return JSON.parse(l) } catch { return null }
		}).filter(Boolean)
	} catch { return [] }
}

function latestTimestamp(entries, fields = ["updatedAt", "createdAt", "syncedAt", "date", "timestamp"]) {
	return entries.reduce((latest, entry) => {
		for (const field of fields) {
			const value = entry?.[field]
			if (value && String(value) > latest) return String(value)
		}
		return latest
	}, "") || null
}

async function checkVpsHealth() {
	try {
		const res = await fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(7000) })
		return { status: res.ok ? "healthy" : "unhealthy", statusCode: res.status }
	} catch {
		return { status: "unreachable", error: "connection failed" }
	}
}

async function checkOllamaHealth() {
	try {
		const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) })
		return { status: res.ok ? "available" : "error", statusCode: res.status }
	} catch {
		return { status: "unavailable", error: "Ollama not running" }
	}
}

function checkDaemonHealth() {
	const healthFile = path.join(SUPERROO_HOME, "sync-health.json")
	const health = loadJson(healthFile, { lastRun: null, lastStatus: "unknown", consecutiveFailures: 0 })
	return {
		lastRun: health.lastRun,
		lastStatus: health.lastStatus,
		consecutiveFailures: health.consecutiveFailures || 0,
		isHealthy: health.lastStatus === "ok",
	}
}

function getExtensionSyncStatus() {
	const extensions = {}

	// Claude Brain
	const claudeBrain = path.join(ROOT, "memory", "claude-brain", "knowledge.jsonl")
	const claudeEntries = loadJsonl(claudeBrain)
	extensions.claude = {
		entryCount: claudeEntries.length,
		lastSync: claudeEntries.slice(-1)[0]?.createdAt || null,
	}

	// Codex Brain
	const codexBrain = path.join(ROOT, "memory", "codex-brain", "memory.json")
	const codexDb = loadJson(codexBrain, { entries: [] })
	extensions.codex = {
		entryCount: codexDb.entries?.length || 0,
		lastSync: codexDb.entries?.slice(-1)[0]?.createdAt || null,
	}

	// Brain MCP
	const brainMcp = path.join(ROOT, "memory", "brain-mcp", "memory.json")
	const mcpDb = loadJson(brainMcp, { entries: [] })
	extensions.brainMcp = {
		entryCount: mcpDb.entries?.length || 0,
		lastSync: mcpDb.entries?.slice(-1)[0]?.createdAt || null,
	}

	// Kilo Code
	const home = process.env.USERPROFILE || process.env.HOME || ""
	const kiloLessons = path.join(home, ".kilo", "memory", "lessons.jsonl")
	const kiloTasks = loadJson(path.join(home, ".kilo", "memory", "tasks.json"), { tasks: [] }).tasks || []
	const kiloEntries = loadJsonl(kiloLessons)
	extensions.kilo = {
		entryCount: kiloEntries.length,
		lastSync: latestTimestamp(kiloEntries),
		taskCount: kiloTasks.length,
		lessonPath: kiloLessons,
	}

	const legacyKiloLessons = path.join(home, ".config", "kilo", "memory", "lessons.jsonl")
	const legacyKiloTasks = loadJson(path.join(home, ".config", "kilo", "memory", "tasks.json"), { tasks: [] }).tasks || []
	const legacyKiloEntries = loadJsonl(legacyKiloLessons)
	extensions.kiloLegacy = {
		entryCount: legacyKiloEntries.length,
		lastSync: latestTimestamp(legacyKiloEntries),
		taskCount: legacyKiloTasks.length,
		lessonPath: legacyKiloLessons,
	}

	const blackboxLessons = path.join(home, "Documents", ".blackbox", "memory", "lessons.jsonl")
	const blackboxTasks = loadJson(path.join(home, "Documents", ".blackbox", "tasks.json"), { tasks: [] }).tasks || []
	const blackboxEntries = loadJsonl(blackboxLessons)
	extensions.blackbox = {
		entryCount: blackboxEntries.length,
		lastSync: latestTimestamp(blackboxEntries),
		taskCount: blackboxTasks.length,
		lessonPath: blackboxLessons,
	}

	return extensions
}

function getConflictStatus() {
	const conflictsFile = path.join(ROOT, "memory", ".sync-conflicts.json")
	const conflicts = loadJson(conflictsFile, { lessons: [], activeWork: [] })
	return {
		lessonConflicts: conflicts.lessons?.length || 0,
		activeWorkConflicts: conflicts.activeWork?.length || 0,
		resolvedCount: conflicts.resolved?.length || 0,
	}
}

function getVpsQueueStatus() {
	const queueFile = path.join(SUPERROO_HOME, "sync-state", path.basename(ROOT) + "-vps-queue.json")
	const queue = loadJson(queueFile, { queued: [], failed: [] })
	return {
		queued: queue.queued?.length || 0,
		failed: queue.failed?.length || 0,
	}
}

async function main() {
	const health = {
		timestamp: new Date().toISOString(),
		vps: await checkVpsHealth(),
		ollama: await checkOllamaHealth(),
		daemon: checkDaemonHealth(),
		extensions: getExtensionSyncStatus(),
		conflicts: getConflictStatus(),
		queue: getVpsQueueStatus(),
	}

	if (JSON_OUTPUT) {
		console.log(JSON.stringify(health, null, 2))
	} else if (STATUS_ONLY) {
		console.log("=== Sync Health Status ===")
		console.log(`VPS: ${health.vps.status}`)
		console.log(`Ollama: ${health.ollama.status}`)
		console.log(`Daemon: ${health.daemon.lastStatus} (failures: ${health.daemon.consecutiveFailures})`)
		console.log(`Conflicts: ${health.conflicts.lessonConflicts + health.conflicts.activeWorkConflicts}`)
		console.log(`Queue: ${health.queue.queued} pending, ${health.queue.failed} failed`)
	} else {
		console.log("=== Sync Health Dashboard ===")
		console.log(`\n🌐 VPS: ${health.vps.status}${health.vps.statusCode ? ` (${health.vps.statusCode})` : ""}`)
		console.log(`💻 Ollama: ${health.ollama.status}`)
		console.log(`🔄 Daemon: ${health.daemon.lastStatus} (consecutive failures: ${health.daemon.consecutiveFailures})`)

		console.log("\n📊 Extensions:")
		for (const [name, status] of Object.entries(health.extensions)) {
			console.log(`  ${name}: ${status.entryCount} entries`)
		}

		console.log("\n⚠️ Conflicts:")
		console.log(`  Lessons: ${health.conflicts.lessonConflicts}`)
		console.log(`  Active Work: ${health.conflicts.activeWorkConflicts}`)
		console.log(`  Resolved: ${health.conflicts.resolvedCount}`)

		console.log("\n⏳ VPS Queue:")
		console.log(`  Pending: ${health.queue.queued}`)
		console.log(`  Failed: ${health.queue.failed}`)
	}

	// Save health report
	const healthFile = path.join(ROOT, "memory", ".sync-health-latest.json")
	fsSync.mkdirSync(path.dirname(healthFile), { recursive: true })
	fsSync.writeFileSync(healthFile, JSON.stringify(health, null, 2), "utf8")
}

main().catch(e => { console.error("❌", e.message); process.exit(1) })
