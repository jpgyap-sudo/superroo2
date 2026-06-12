#!/usr/bin/env node

import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dirname, "..")
const superrooHome = process.env.SUPERROO_HOME || path.join(os.homedir(), ".superroo")
const memoryDir = process.env.MEMORY_DIR || path.join(superrooHome, "memory")
const canonicalPath = path.join(memoryDir, "lesson-index.jsonl")
const brainMcpPath = path.join(memoryDir, "brain-mcp", "memory.json")
const codexBrainPath = path.join(memoryDir, "codex-brain", "memory.json")
const claudeBrainPath = path.join(memoryDir, "claude-brain", "knowledge.jsonl")
const backupDir = path.join(repoRoot, "memory", "backups")

function readCanonical() {
	const rows = fs.readFileSync(canonicalPath, "utf8").split(/\r?\n/).filter(Boolean).map(JSON.parse)
	return {
		rows,
		ids: new Set(rows.map((entry) => entry.id)),
		titleToId: new Map(rows.map((entry) => [entry.title, entry.id])),
	}
}

function backup(file, stamp) {
	if (!fs.existsSync(file)) return null
	fs.mkdirSync(backupDir, { recursive: true })
	const target = path.join(backupDir, `${stamp}-${path.basename(path.dirname(file))}-${path.basename(file)}`)
	fs.copyFileSync(file, target)
	return target
}

function canonicalKeyFromVector(entry, canonical) {
	const metadataId = entry.metadata?.canonicalId || entry.metadata?.lessonId
	if (metadataId && canonical.ids.has(metadataId)) return metadataId
	const title = entry.metadata?.title || String(entry.content || "").split("\n")[0]
	return canonical.titleToId.get(title) || null
}

function dedupeVectorBrain(file, canonical, stamp, dryRun) {
	if (!fs.existsSync(file)) return { file, changed: 0, removed: 0 }
	const db = JSON.parse(fs.readFileSync(file, "utf8"))
	const entries = db.entries || []
	const seen = new Set()
	const next = []
	let removed = 0
	let updated = 0

	for (const entry of entries) {
		const canonicalId = canonicalKeyFromVector(entry, canonical)
		if (!canonicalId) {
			next.push(entry)
			continue
		}
		if (seen.has(canonicalId)) {
			removed += 1
			continue
		}
		seen.add(canonicalId)
		entry.metadata = entry.metadata || {}
		if (entry.metadata.canonicalId !== canonicalId) {
			entry.metadata.canonicalId = canonicalId
			updated += 1
		}
		if (entry.metadata.lessonId && entry.metadata.lessonId !== canonicalId) {
			delete entry.metadata.lessonId
			updated += 1
		}
		next.push(entry)
	}

	if (!dryRun && (removed || updated)) {
		backup(file, stamp)
		db.entries = next
		fs.writeFileSync(file, `${JSON.stringify(db, null, 2)}\n`, "utf8")
	}

	return { file, updated, removed, total: next.length }
}

function canonicalKeyFromClaude(entry, canonical) {
	if (entry.canonical_id && canonical.ids.has(entry.canonical_id)) return entry.canonical_id
	if (entry.brain_entry_id && canonical.ids.has(entry.brain_entry_id)) return entry.brain_entry_id
	if (canonical.ids.has(entry.id)) return entry.id
	return canonical.titleToId.get(entry.title) || null
}

function dedupeClaude(file, canonical, stamp, dryRun) {
	if (!fs.existsSync(file)) return { file, changed: 0, removed: 0 }
	const entries = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map(JSON.parse)
	const seen = new Set()
	const next = []
	let removed = 0
	let updated = 0

	for (const entry of entries) {
		const canonicalId = canonicalKeyFromClaude(entry, canonical)
		if (!canonicalId) {
			next.push(entry)
			continue
		}
		if (seen.has(canonicalId)) {
			removed += 1
			continue
		}
		seen.add(canonicalId)
		if (entry.canonical_id !== canonicalId) {
			entry.canonical_id = canonicalId
			updated += 1
		}
		next.push(entry)
	}

	if (!dryRun && (removed || updated)) {
		backup(file, stamp)
		fs.writeFileSync(file, `${next.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8")
	}

	return { file, updated, removed, total: next.length }
}

function main() {
	const dryRun = process.argv.includes("--dry-run")
	const stamp = new Date().toISOString().replace(/[:.]/g, "-")
	const canonical = readCanonical()
	const results = [
		dedupeVectorBrain(brainMcpPath, canonical, stamp, dryRun),
		dedupeVectorBrain(codexBrainPath, canonical, stamp, dryRun),
		dedupeClaude(claudeBrainPath, canonical, stamp, dryRun),
	]
	console.log(JSON.stringify({ ok: true, dryRun, results }, null, 2))
}

main()
