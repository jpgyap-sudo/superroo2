#!/usr/bin/env node

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

const repoRoot = path.resolve(import.meta.dirname, "..")
const superrooHome = process.env.SUPERROO_HOME || path.join(os.homedir(), ".superroo")
const memoryDir = process.env.MEMORY_DIR || process.env.SUPERROO_MEMORY_DIR || path.join(superrooHome, "memory")
const lessonIndex = path.join(memoryDir, "lesson-index.jsonl")
const lessonsMd = path.join(memoryDir, "lessons-learned.md")
const brainMcp = path.join(memoryDir, "brain-mcp", "memory.json")
const codexBrain = path.join(memoryDir, "codex-brain", "memory.json")
const claudeBrain = path.join(memoryDir, "claude-brain", "knowledge.jsonl")
const syncState = path.join(memoryDir, ".sync-state.json")
const repoSyncState = path.join(repoRoot, "memory", ".sync-state.json")

const roles = {
	auditor: "Check canonical lesson health, duplicates, schema gaps, and mirror consistency.",
	curator: "Find lessons that need enrichment, tags, files, summaries, or model metadata.",
	dedupe: "Detect duplicate IDs and normalized titles; with --repair, run safe dedupe tools.",
	mirror: "Verify Brain MCP, Codex Brain, and Claude Brain mirror canonical lesson IDs.",
	sentinel: "Run guardrails that block malformed, duplicate, or unsafe learning-layer edits.",
	sync: "Check Central Brain/VPS sync readiness and pending lesson counts.",
	coverage: "Show tag, source, model, type, and file coverage across lessons.",
	archivist: "List backup files and recent learning-layer repair artifacts.",
	reporter: "Write a JSON health report under ~/.superroo/reports.",
	doctor: "Run sentinel, dedupe, mirror checks, sync status, and optional repairs.",
}

function loadJsonl(file) {
	if (!fs.existsSync(file)) return []
	return fs.readFileSync(file, "utf8")
		.split(/\r?\n/)
		.filter(Boolean)
		.map((line, index) => {
			try {
				return JSON.parse(line)
			} catch (error) {
				return { id: null, title: null, parseError: error.message, line: index + 1 }
			}
		})
}

function loadJson(file, fallback) {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8"))
	} catch {
		return fallback
	}
}

function titleKey(value) {
	return String(value || "").toLowerCase().replace(/\s+/g, " ").trim()
}

function countBy(entries, getter) {
	const counts = new Map()
	for (const entry of entries) {
		const values = getter(entry)
		for (const value of Array.isArray(values) ? values : [values]) {
			if (!value) continue
			counts.set(value, (counts.get(value) || 0) + 1)
		}
	}
	return [...counts.entries()].sort((a, b) => b[1] - a[1])
}

function duplicateGroups(entries, getter) {
	const seen = new Map()
	for (const entry of entries) {
		const key = getter(entry)
		if (!key) continue
		const group = seen.get(key) || []
		group.push(entry)
		seen.set(key, group)
	}
	return [...seen.entries()]
		.filter(([, group]) => group.length > 1)
		.map(([key, group]) => ({ key, count: group.length, entries: group.map(e => ({ id: e.id, title: e.title, source: e.source })) }))
}

function canonicalStats(entries) {
	const parseErrors = entries.filter(e => e.parseError)
	const missingIds = entries.filter(e => !e.id)
	const missingTitles = entries.filter(e => !e.title)
	const duplicateIds = duplicateGroups(entries, e => e.id)
	const duplicateTitles = duplicateGroups(entries, e => titleKey(e.title))
	const noTags = entries.filter(e => !Array.isArray(e.tags) || e.tags.length === 0)
	const noFiles = entries.filter(e => !Array.isArray(e.files) || e.files.length === 0)
	const noSummary = entries.filter(e => !e.lesson_summary && !e.rule_summary)
	const unknownModel = entries.filter(e => !e.model || e.model === "unknown")
	const todo = entries.filter(e => /TODO|To be determined/i.test(`${e.lesson_summary || ""}\n${e.rule_summary || ""}`))
	const qualityLow = entries.filter(e => Number.isFinite(e.quality_score) && e.quality_score < 0.5)
	return {
		rows: entries.length,
		uniqueIds: new Set(entries.map(e => e.id).filter(Boolean)).size,
		uniqueTitles: new Set(entries.map(e => titleKey(e.title)).filter(Boolean)).size,
		parseErrors: parseErrors.length,
		missingIds: missingIds.length,
		missingTitles: missingTitles.length,
		duplicateIds,
		duplicateTitles,
		noTags: noTags.length,
		noFiles: noFiles.length,
		noSummary: noSummary.length,
		unknownModel: unknownModel.length,
		todo: todo.length,
		qualityLow: qualityLow.length,
	}
}

function mirrorIds(canonicalIds, entries, getter) {
	const ids = new Set(entries.map(getter).filter(Boolean))
	const missing = [...canonicalIds].filter(id => !ids.has(id))
	const extra = [...ids].filter(id => !canonicalIds.has(id))
	return { canonicalIds: ids.size, missing: missing.length, extra: extra.length, missingSample: missing.slice(0, 10), extraSample: extra.slice(0, 10) }
}

function mirrorStats(entries) {
	const canonicalIds = new Set(entries.map(e => e.id).filter(Boolean))
	const brain = loadJson(brainMcp, { entries: [] }).entries || []
	const codex = loadJson(codexBrain, { entries: [] }).entries || []
	const claude = loadJsonl(claudeBrain)
	return {
		brainMcp: {
			entries: brain.length,
			...mirrorIds(canonicalIds, brain, e => e.metadata?.canonicalId || e.metadata?.lessonId),
		},
		codexBrain: {
			entries: codex.length,
			...mirrorIds(canonicalIds, codex, e => e.metadata?.canonicalId || e.metadata?.lessonId),
		},
		claudeBrain: {
			entries: claude.length,
			...mirrorIds(canonicalIds, claude, e => e.canonical_id || e.brain_entry_id || (canonicalIds.has(e.id) ? e.id : null)),
		},
	}
}

function coverage(entries) {
	return {
		types: countBy(entries, e => e.type || "unknown").slice(0, 20),
		sources: countBy(entries, e => e.source || "unknown").slice(0, 20),
		models: countBy(entries, e => e.model || "unknown").slice(0, 20),
		tags: countBy(entries, e => e.tags || []).slice(0, 30),
		topFiles: countBy(entries, e => e.files || []).slice(0, 30),
	}
}

function syncStats(entries) {
	const statePath = fs.existsSync(syncState) ? syncState : repoSyncState
	const state = loadJson(statePath, {})
	const synced = new Set((state.syncedIds || []).filter(Boolean))
	const pending = entries.filter(e => e.id && !synced.has(e.id))
	const syncedCanonical = entries.filter(e => e.id && synced.has(e.id)).length
	return {
		total: entries.length,
		synced: syncedCanonical,
		syncedStateIds: synced.size || state.totalSynced || 0,
		pending: pending.length,
		lastSync: state.lastSync || state.lastSyncAt || null,
		statePath,
		pendingSample: pending.slice(0, 10).map(e => ({ id: e.id, title: e.title })),
	}
}

function backups() {
	const backupDir = path.join(repoRoot, "memory", "backups")
	if (!fs.existsSync(backupDir)) return []
	return fs.readdirSync(backupDir)
		.filter(name => /lesson|brain|dedupe|sync/i.test(name))
		.map(name => {
			const file = path.join(backupDir, name)
			const stat = fs.statSync(file)
			return { name, bytes: stat.size, modifiedAt: stat.mtime.toISOString() }
		})
		.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
		.slice(0, 30)
}

function runNodeScript(script, args = []) {
	const result = spawnSync(process.execPath, [path.join(repoRoot, script), ...args], {
		cwd: repoRoot,
		encoding: "utf8",
		env: { ...process.env, SUPERROO_HOME: superrooHome, MEMORY_DIR: memoryDir, SUPERROO_MEMORY_DIR: memoryDir },
	})
	return {
		script,
		args,
		status: result.status,
		stdout: result.stdout?.trim() || "",
		stderr: result.stderr?.trim() || "",
	}
}

function health(entries) {
	const canonical = canonicalStats(entries)
	const mirrors = mirrorStats(entries)
	const critical = canonical.parseErrors + canonical.missingIds + canonical.duplicateIds.length + canonical.duplicateTitles.length
	const mirrorMissing = Object.values(mirrors).reduce((sum, mirror) => sum + mirror.missing + mirror.extra, 0)
	return {
		status: critical === 0 && mirrorMissing === 0 ? "healthy" : critical === 0 ? "warning" : "critical",
		canonical,
		mirrors,
		sync: syncStats(entries),
		files: { lessonIndex, lessonsMd, memoryDir },
	}
}

function printText(report, role) {
	console.log(`SuperRoo Learning Layer Agent — ${role}`)
	console.log(`Status: ${report.status}`)
	console.log(`Canonical: ${report.canonical.rows} rows, ${report.canonical.uniqueIds} unique IDs, ${report.canonical.uniqueTitles} unique titles`)
	console.log(`Duplicates: ${report.canonical.duplicateIds.length} id group(s), ${report.canonical.duplicateTitles.length} title group(s)`)
	console.log(`Quality gaps: no tags ${report.canonical.noTags}, no files ${report.canonical.noFiles}, no summary ${report.canonical.noSummary}, unknown model ${report.canonical.unknownModel}, TODO ${report.canonical.todo}`)
	for (const [name, mirror] of Object.entries(report.mirrors)) {
		console.log(`${name}: ${mirror.entries} entries, canonical ${mirror.canonicalIds}, missing ${mirror.missing}, extra ${mirror.extra}`)
	}
	console.log(`Central sync: ${report.sync.synced}/${report.sync.total} synced, ${report.sync.pending} pending`)
}

function writeReport(report) {
	const reportDir = path.join(superrooHome, "reports")
	fs.mkdirSync(reportDir, { recursive: true })
	const file = path.join(reportDir, `learning-layer-${new Date().toISOString().replace(/[:.]/g, "-")}.json`)
	fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, "utf8")
	return file
}

function main() {
	const args = process.argv.slice(2)
	const role = args.find(arg => !arg.startsWith("--")) || "auditor"
	const json = args.includes("--json")
	const repair = args.includes("--repair")
	const entries = loadJsonl(lessonIndex)
	const report = health(entries)

	if (role === "help" || args.includes("--help")) {
		console.log("Usage: superroo-learning-agent [role] [--json] [--repair]")
		console.log("")
		for (const [name, description] of Object.entries(roles)) console.log(`  ${name.padEnd(10)} ${description}`)
		return
	}

	if (role === "curator") report.curator = canonicalStats(entries)
	if (role === "coverage") report.coverage = coverage(entries)
	if (role === "sync") report.syncCommand = runNodeScript("scripts/sync-lessons-to-central-brain.mjs", ["--status"])
	if (role === "archivist") report.backups = backups()
	if (role === "sentinel" || role === "doctor") report.guard = runNodeScript("scripts/guard-append-only-lessons.mjs")
	if (role === "dedupe" || role === "doctor") {
		report.dedupe = repair
			? [
				runNodeScript("scripts/dedupe-lesson-index.mjs", ["--by-title"]),
				runNodeScript("scripts/dedupe-brain-mirrors.mjs"),
			]
			: [
				runNodeScript("scripts/dedupe-lesson-index.mjs", ["--by-title", "--dry-run"]),
				runNodeScript("scripts/dedupe-brain-mirrors.mjs", ["--dry-run"]),
			]
	}
	if (role === "mirror" || role === "doctor") report.mirrorSync = repair ? runNodeScript("scripts/sync-all-brains.mjs", ["--distribute"]) : runNodeScript("scripts/sync-all-brains.mjs", ["--status"])
	if (role === "reporter") report.reportPath = writeReport(report)

	if (json) {
		console.log(JSON.stringify(report, null, 2))
		return
	}
	printText(report, role)
	if (report.reportPath) console.log(`Report: ${report.reportPath}`)
	if (role === "help") return
}

main()
