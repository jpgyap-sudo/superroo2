#!/usr/bin/env node

import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dirname, "..")
const memoryDir = process.env.LESSON_MEMORY_DIR || process.env.MEMORY_DIR || path.join(repoRoot, "memory")
const lessonIndex = process.env.LESSON_INDEX_PATH || path.join(memoryDir, "lesson-index.jsonl")
const backupDir = process.env.LESSON_BACKUP_DIR || path.join(memoryDir, "backups")

function slugify(text) {
	return String(text || "lesson")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48) || "lesson"
}

function titleKey(text) {
	return String(text || "")
		.toLowerCase()
		.replace(/\s+/g, " ")
		.trim()
}

function readEntries(file) {
	const text = fs.readFileSync(file, "utf8")
	const trailingNewline = text.endsWith("\n")
	const entries = text
		.split(/\r?\n/)
		.filter(Boolean)
		.map((line, index) => ({ entry: JSON.parse(line), line: index + 1 }))
	return { entries, trailingNewline }
}

function uniqueId(entry, used) {
	const date = String(entry.date || new Date().toISOString().slice(0, 10)).replaceAll("-", "")
	const title = slugify(entry.title)
	const hash = crypto
		.createHash("sha1")
		.update(JSON.stringify({
			title: entry.title,
			source: entry.source,
			date: entry.date,
			files: entry.files,
			rule: entry.rule_summary,
		}))
		.digest("hex")
		.slice(0, 8)
	const base = `lesson-${date}-${title}-${hash}`
	let candidate = base
	let suffix = 2
	while (used.has(candidate)) {
		candidate = `${base}-${suffix}`
		suffix += 1
	}
	return candidate
}

function main() {
	const dryRun = process.argv.includes("--dry-run")
	const removeTitleDuplicates = process.argv.includes("--by-title")
	const { entries, trailingNewline } = readEntries(lessonIndex)
	const used = new Set()
	const usedTitles = new Set()
	const changes = []
	const kept = []
	const removed = []

	for (const item of entries) {
		const { entry, line } = item
		const normalizedTitle = titleKey(entry.title)
		if (removeTitleDuplicates && normalizedTitle && usedTitles.has(normalizedTitle)) {
			removed.push({ line, id: entry.id, title: entry.title, source: entry.source })
			continue
		}
		if (normalizedTitle) usedTitles.add(normalizedTitle)
		if (!entry.id) {
			const nextId = uniqueId(entry, used)
			changes.push({ line, oldId: "", newId: nextId, title: entry.title })
			entry.id = nextId
		} else if (used.has(entry.id)) {
			const oldId = entry.id
			entry.previous_duplicate_id = oldId
			entry.id = uniqueId(entry, used)
			changes.push({ line, oldId, newId: entry.id, title: entry.title })
		}
		used.add(entry.id)
		kept.push(item)
	}

	if (changes.length === 0 && removed.length === 0) {
		console.log(JSON.stringify({ ok: true, changed: 0, removed: 0, total: entries.length }, null, 2))
		return
	}

	if (!dryRun) {
		fs.mkdirSync(backupDir, { recursive: true })
		const stamp = new Date().toISOString().replace(/[:.]/g, "-")
		const backupPath = path.join(backupDir, `${stamp}-lesson-index-before-dedupe.jsonl`)
		fs.copyFileSync(lessonIndex, backupPath)
		const next = kept.map(({ entry }) => JSON.stringify(entry)).join("\n") + (trailingNewline ? "\n" : "")
		fs.writeFileSync(lessonIndex, next, "utf8")
		console.log(JSON.stringify({ ok: true, changed: changes.length, removed: removed.length, backupPath, changes, removed }, null, 2))
		return
	}

	console.log(JSON.stringify({ ok: true, dryRun: true, changed: changes.length, removed: removed.length, changes, removed }, null, 2))
}

main()
