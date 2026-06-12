#!/usr/bin/env node

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

const ROOT = process.env.PROJECT_ROOT || path.resolve(import.meta.dirname, "..")
const SUPERROO_HOME = process.env.SUPERROO_HOME || path.join(os.homedir(), ".superroo")
const MEMORY_DIR = process.env.MEMORY_DIR || process.env.SUPERROO_MEMORY_DIR || path.join(SUPERROO_HOME, "memory")
const INDEX_DIR = process.env.SUPERROO_INDEXING_DIR || path.join(SUPERROO_HOME, "indexing")
const STATUS_JSON = path.join(INDEX_DIR, "extension-index-status.json")
const STATUS_JSONL = path.join(INDEX_DIR, "extension-index-status.jsonl")

const CANONICAL_JSONL = path.join(MEMORY_DIR, "lesson-index.jsonl")
const CANONICAL_MD = path.join(MEMORY_DIR, "lessons-learned.md")
const BRAIN_MCP = path.join(MEMORY_DIR, "brain-mcp", "memory.json")
const CODEX_BRAIN = path.join(MEMORY_DIR, "codex-brain", "memory.json")
const CLAUDE_BRAIN = path.join(MEMORY_DIR, "claude-brain", "knowledge.jsonl")
const KILO_MCP = path.join(os.homedir(), ".config", "kilo", ".mcp.json")
const CODEX_CONFIG = path.join(os.homedir(), ".codex", "config.toml")
const CLAUDE_SETTINGS = path.join(os.homedir(), ".claude", "settings.json")

const args = process.argv.slice(2)
const json = args.includes("--json")
const noWrite = args.includes("--no-write")
const sync = args.includes("--sync")
const dryRun = args.includes("--dry-run")
const syncCentral = args.includes("--sync-central")
const statusOnly = args.includes("--status") || (!sync && !syncCentral)
const force = args.includes("--force")
const promote = args.includes("--promote") || args.includes("--include-promote")

function readJson(file, fallback) {
	try { return JSON.parse(fs.readFileSync(file, "utf8")) } catch { return fallback }
}

function readJsonl(file) {
	if (!fs.existsSync(file)) return []
	return fs.readFileSync(file, "utf8")
		.split(/\r?\n/)
		.filter(Boolean)
		.map((line, index) => {
			try { return JSON.parse(line) } catch (error) { return { parseError: error.message, line: index + 1 } }
		})
}

function fileInfo(file) {
	try {
		const stat = fs.statSync(file)
		return { exists: true, path: file, bytes: stat.size, modifiedAt: stat.mtime.toISOString() }
	} catch {
		return { exists: false, path: file, bytes: 0, modifiedAt: null }
	}
}

function canonicalIds(entries) {
	return new Set(entries.map((entry) => entry.id).filter(Boolean))
}

function canonicalAliases(entries) {
	const aliases = new Map()
	for (const entry of entries) {
		if (!entry.id) continue
		aliases.set(entry.id, [
			entry.id,
			entry.brain_entry_id,
			entry.brain_id,
			entry.canonical_id,
			entry.metadata?.canonicalId,
			entry.metadata?.lessonId,
		].filter(Boolean))
	}
	return aliases
}

function titleKey(text) {
	return String(text || "")
		.toLowerCase()
		.replace(/\s+/g, " ")
		.trim()
}

function duplicateTitleStats(entries) {
	const seen = new Map()
	const groups = []
	for (const entry of entries) {
		const key = titleKey(entry.title)
		if (!key) continue
		if (!seen.has(key)) {
			seen.set(key, [])
		}
		seen.get(key).push({ id: entry.id, title: entry.title, source: entry.source })
	}
	for (const items of seen.values()) {
		if (items.length > 1) groups.push(items)
	}
	return {
		groups: groups.length,
		duplicates: groups.reduce((sum, items) => sum + items.length - 1, 0),
		sample: groups.slice(0, 10).map((items) => ({
			title: items[0].title,
			count: items.length,
			ids: items.map((item) => item.id).filter(Boolean).slice(0, 10),
			sources: [...new Set(items.map((item) => item.source).filter(Boolean))].slice(0, 10),
		})),
	}
}

function mirrorIds(entries, getters) {
	const ids = new Set()
	for (const entry of entries) {
		for (const getter of getters) {
			const value = getter(entry)
			if (value) ids.add(value)
		}
	}
	return ids
}

function compareMirror(name, entries, ids, getters, extra = {}, aliases = new Map()) {
	const mirrored = mirrorIds(entries, getters)
	const missing = [...ids].filter((id) => !(aliases.get(id) || [id]).some((alias) => mirrored.has(alias)))
	const knownAliases = new Set([...aliases.values()].flat())
	const extraIds = [...mirrored].filter((id) => !ids.has(id) && !knownAliases.has(id))
	const matched = ids.size - missing.length
	return {
		name,
		entries: entries.length,
		indexedCanonicalIds: mirrored.size,
		matchedCanonicalIds: matched,
		missing: missing.length,
		extra: extraIds.length,
		coverage: ids.size ? Number(((matched / ids.size) * 100).toFixed(2)) : 100,
		missingSample: missing.slice(0, 10),
		extraSample: extraIds.slice(0, 10),
		...extra,
	}
}

function parseMcpServers(file) {
	const data = readJson(file, {})
	return data.mcpServers || {}
}

function runScript(script, scriptArgs = [], timeout = 120000) {
	const result = spawnSync(process.execPath, [path.join(ROOT, script), ...scriptArgs], {
		cwd: ROOT,
		encoding: "utf8",
		timeout,
		windowsHide: true,
		env: { ...process.env, SUPERROO_HOME, MEMORY_DIR, SUPERROO_MEMORY_DIR: MEMORY_DIR },
	})
	return {
		script,
		args: scriptArgs,
		status: result.status,
		ok: result.status === 0,
		stdout: (result.stdout || "").trim().slice(0, 6000),
		stderr: (result.stderr || "").trim().slice(0, 3000),
	}
}

function skippedResult(script, reason) {
	return {
		script,
		args: ["skipped"],
		status: 0,
		ok: true,
		stdout: reason,
		stderr: "",
	}
}

async function centralMcpStatus() {
	const url = process.env.SUPERROO_MCP_HEALTH_URL || "http://127.0.0.1:3419/health"
	try {
		const response = await fetch(url, { signal: AbortSignal.timeout(3000) })
		const text = await response.text()
		let body = null
		try { body = JSON.parse(text) } catch { body = { text } }
		return { reachable: response.ok, url, status: response.status, body }
	} catch (error) {
		return { reachable: false, url, error: error.message }
	}
}

async function buildReport(syncResults = []) {
	const canonical = readJsonl(CANONICAL_JSONL)
	const ids = canonicalIds(canonical)
	const aliases = canonicalAliases(canonical)
	const duplicateTitles = duplicateTitleStats(canonical)
	const brainMcp = readJson(BRAIN_MCP, { entries: [] }).entries || []
	const codexBrain = readJson(CODEX_BRAIN, { entries: [] }).entries || []
	const claudeBrain = readJsonl(CLAUDE_BRAIN)
	const kiloServers = parseMcpServers(KILO_MCP)
	const claudeServers = parseMcpServers(CLAUDE_SETTINGS)

	const mirrors = [
		compareMirror("brain-mcp", brainMcp, ids, [
			(entry) => entry.metadata?.canonicalId,
			(entry) => entry.metadata?.lessonId,
		], { file: fileInfo(BRAIN_MCP) }, aliases),
		compareMirror("codex-brain", codexBrain, ids, [
			(entry) => entry.metadata?.canonicalId,
			(entry) => entry.metadata?.lessonId,
		], { file: fileInfo(CODEX_BRAIN), config: fileInfo(CODEX_CONFIG) }, aliases),
		compareMirror("claude-brain", claudeBrain, ids, [
			(entry) => entry.canonical_id,
			(entry) => entry.brain_entry_id,
			(entry) => ids.has(entry.id) ? entry.id : null,
			(entry) => entry.id?.startsWith("cb-dist-") ? null : entry.id,
		], { file: fileInfo(CLAUDE_BRAIN), config: fileInfo(CLAUDE_SETTINGS) }, aliases),
	]

	const kiloStatus = {
		name: "kilo-code",
		file: fileInfo(KILO_MCP),
		hasCentralBrain: Boolean(kiloServers["central-brain"]),
		hasCodexBrain: Boolean(kiloServers["codex-brain"]),
		centralBrainArgs: kiloServers["central-brain"]?.args || [],
		codexBrainArgs: kiloServers["codex-brain"]?.args || [],
	}

	const central = await centralMcpStatus()
	const totalMissing = mirrors.reduce((sum, mirror) => sum + mirror.missing, 0)
	const totalExtra = mirrors.reduce((sum, mirror) => sum + mirror.extra, 0)
	const disconnected = [
		!kiloStatus.hasCentralBrain ? "kilo central-brain MCP missing" : "",
		!kiloStatus.hasCodexBrain ? "kilo codex-brain MCP missing" : "",
		!central.reachable ? "central HTTP MCP unreachable" : "",
	].filter(Boolean)

	return {
		version: 1,
		status: totalMissing === 0 && totalExtra === 0 && disconnected.length === 0 ? "healthy" : "warning",
		generatedAt: new Date().toISOString(),
		projectId: process.env.PROJECT_ID || path.basename(ROOT),
		memoryDir: MEMORY_DIR,
		canonical: {
			entries: canonical.length,
			uniqueIds: ids.size,
			parseErrors: canonical.filter((entry) => entry.parseError).length,
			duplicateTitles,
			files: {
				jsonl: fileInfo(CANONICAL_JSONL),
				markdown: fileInfo(CANONICAL_MD),
			},
		},
		extensions: {
			mirrors,
			kilo: kiloStatus,
			claude: { config: fileInfo(CLAUDE_SETTINGS), hasCodexBrain: Boolean(claudeServers["codex-brain"]), hasCentralBrain: Boolean(claudeServers["central-brain"]) },
			codex: { config: fileInfo(CODEX_CONFIG) },
		},
		centralMcp: central,
		sync: {
			mode: sync ? "sync" : syncCentral ? "sync-central" : "status",
			dryRun,
			promote,
			force,
			results: syncResults,
		},
		issues: {
			totalMissing,
			totalExtra,
			disconnected,
		},
	}
}

function saveReport(report) {
	if (noWrite || dryRun) return
	fs.mkdirSync(INDEX_DIR, { recursive: true })
	fs.writeFileSync(STATUS_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8")
	fs.appendFileSync(STATUS_JSONL, `${JSON.stringify(report)}\n`, "utf8")
}

function printReport(report) {
	console.log(`SuperRoo Extension Indexing Agent - ${report.status}`)
	console.log(`Canonical: ${report.canonical.entries} rows, ${report.canonical.uniqueIds} unique IDs`)
	if (report.canonical.duplicateTitles.groups) {
		console.log(`Canonical duplicate titles: ${report.canonical.duplicateTitles.groups} groups, ${report.canonical.duplicateTitles.duplicates} duplicate rows`)
	}
	for (const mirror of report.extensions.mirrors) {
		console.log(`${mirror.name}: ${mirror.entries} entries, ${mirror.coverage}% coverage, missing ${mirror.missing}, extra ${mirror.extra}`)
	}
	console.log(`Kilo MCP: central=${report.extensions.kilo.hasCentralBrain ? "yes" : "no"}, codex=${report.extensions.kilo.hasCodexBrain ? "yes" : "no"}`)
	console.log(`Claude MCP: central=${report.extensions.claude.hasCentralBrain ? "yes" : "no"}, codex=${report.extensions.claude.hasCodexBrain ? "yes" : "no"}`)
	console.log(`Central HTTP MCP: ${report.centralMcp.reachable ? "reachable" : "unreachable"}`)
	if (report.issues.disconnected.length) console.log(`Disconnected: ${report.issues.disconnected.join("; ")}`)
	if (report.sync.results.length) {
		console.log("Sync commands:")
		for (const result of report.sync.results) console.log(`- ${result.script} ${result.args.join(" ")} -> ${result.status}`)
	}
	if (!noWrite && !dryRun) console.log(`Report: ${STATUS_JSON}`)
}

async function main() {
	const syncResults = []
	if (sync) {
		if (promote) {
			syncResults.push(runScript("scripts/sync-local-extension-lessons.mjs"))
		} else {
			syncResults.push(skippedResult("scripts/sync-local-extension-lessons.mjs", "Mirror-to-canonical promotion skipped; pass --promote to import extension-only lessons."))
		}

		const canonical = readJsonl(CANONICAL_JSONL)
		const duplicateTitles = duplicateTitleStats(canonical)
		if (duplicateTitles.groups > 0 && !force) {
			syncResults.push({
				script: "scripts/sync-all-brains.mjs",
				args: ["blocked"],
				status: 1,
				ok: false,
				stdout: "",
				stderr: `Canonical lesson index has ${duplicateTitles.groups} duplicate title groups (${duplicateTitles.duplicates} duplicate rows). Run scripts/dedupe-lesson-index.mjs with the global memory dir, or pass --force.`,
			})
		} else {
			syncResults.push(runScript("scripts/sync-all-brains.mjs", [...(dryRun ? ["--dry-run"] : []), "--distribute", "--awareness"], 600000))
		}
	}
	if (syncCentral) {
		syncResults.push(runScript("scripts/sync-lessons-to-central-brain.mjs", dryRun ? ["--status"] : [], 120000))
	}
	if (statusOnly && dryRun) syncResults.push(runScript("scripts/sync-all-brains.mjs", ["--status"], 120000))
	const report = await buildReport(syncResults)
	saveReport(report)
	if (json) console.log(JSON.stringify(report, null, 2))
	else printReport(report)
}

main().catch((error) => {
	console.error(`Error: ${error.message}`)
	process.exit(1)
})
