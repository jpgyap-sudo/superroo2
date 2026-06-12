#!/usr/bin/env node
/**
 * Guard the canonical learning layer from edits, deletes, and rewrites.
 *
 * Protected files may only be appended to. Existing bytes from HEAD must remain
 * an exact prefix of the staged or working-tree version being checked.
 */

import { execFileSync } from "node:child_process"
import fs from "node:fs"

const PROTECTED = [
	"memory/lessons-learned.md",
	"memory/lesson-index.jsonl",
]

const args = new Set(process.argv.slice(2))
const staged = args.has("--staged")

function git(args, options = {}) {
	return execFileSync("git", args, {
		encoding: options.encoding || "buffer",
		stdio: ["ignore", "pipe", "pipe"],
	})
}

function gitText(args) {
	return git(args, { encoding: "utf8" }).trim()
}

function getHeadFile(file) {
	try {
		return git(["show", `HEAD:${file}`])
	} catch {
		return Buffer.alloc(0)
	}
}

function getCandidateFile(file) {
	try {
		if (staged) return git(["show", `:${file}`])
		return fs.readFileSync(file)
	} catch {
		try {
			return git(["show", `HEAD:${file}`])
		} catch {
			return null
		}
	}
}

function changedProtectedFiles() {
	const diffArgs = staged
		? ["diff", "--cached", "--name-only", "--", ...PROTECTED]
		: ["diff", "--name-only", "--", ...PROTECTED]
	const out = gitText(diffArgs)
	return out ? out.split(/\r?\n/).filter(Boolean) : []
}

function startsWithBuffer(candidate, prefix) {
	if (candidate.length < prefix.length) return false
	for (let i = 0; i < prefix.length; i++) {
		if (candidate[i] !== prefix[i]) return false
	}
	return true
}

function checkDuplicateJsonlIds(file, content, failures) {
	const seen = new Map()
	const seenTitles = new Map()
	const lines = content.toString("utf8").split(/\r?\n/)
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index].trim()
		if (!line) continue
		let entry
		try {
			entry = JSON.parse(line)
		} catch (error) {
			failures.push(`${file}:${index + 1}: invalid JSONL (${error.message})`)
			continue
		}
		if (!entry.id) {
			failures.push(`${file}:${index + 1}: missing lesson id`)
			continue
		}
		if (seen.has(entry.id)) {
			failures.push(`${file}:${index + 1}: duplicate lesson id "${entry.id}" first seen on line ${seen.get(entry.id)}`)
			continue
		}
		seen.set(entry.id, index + 1)
		const titleKey = String(entry.title || "").toLowerCase().replace(/\s+/g, " ").trim()
		if (!titleKey) continue
		if (seenTitles.has(titleKey)) {
			failures.push(`${file}:${index + 1}: duplicate lesson title "${entry.title}" first seen on line ${seenTitles.get(titleKey)}`)
			continue
		}
		seenTitles.set(titleKey, index + 1)
	}
}

function parseJsonl(content) {
	return content
		.toString("utf8")
		.split(/\r?\n/)
		.filter((line) => line.trim())
		.map((line) => JSON.parse(line))
}

function idsWithDuplicates(entries) {
	const seen = new Set()
	const duplicates = new Set()
	for (const entry of entries) {
		if (!entry.id) continue
		if (seen.has(entry.id)) duplicates.add(entry.id)
		seen.add(entry.id)
	}
	return duplicates
}

function titleKey(entry) {
	return String(entry.title || "").toLowerCase().replace(/\s+/g, " ").trim()
}

function normalizeEntryForRepairCompare(entry, fallbackId) {
	const normalized = { ...entry }
	if (normalized.previous_duplicate_id === fallbackId) {
		normalized.id = fallbackId
		delete normalized.previous_duplicate_id
	}
	return normalized
}

function isDuplicateIdRepair(oldContent, newContent) {
	let oldEntries
	let newEntries
	try {
		oldEntries = parseJsonl(oldContent)
		newEntries = parseJsonl(newContent)
	} catch {
		return false
	}
	if (newEntries.length < oldEntries.length) return false

	const oldDuplicateIds = idsWithDuplicates(oldEntries)
	if (oldDuplicateIds.size === 0) return false

	let repaired = 0
	for (let index = 0; index < oldEntries.length; index += 1) {
		const oldEntry = oldEntries[index]
		const newEntry = newEntries[index]
		if (JSON.stringify(oldEntry) === JSON.stringify(newEntry)) continue
		if (!oldDuplicateIds.has(oldEntry.id)) return false
		if (newEntry.previous_duplicate_id !== oldEntry.id) return false

		const normalizedNew = { ...newEntry, id: oldEntry.id }
		delete normalizedNew.previous_duplicate_id
		if (JSON.stringify(oldEntry) !== JSON.stringify(normalizedNew)) return false
		repaired += 1
	}

	return repaired > 0 && idsWithDuplicates(newEntries).size === 0
}

function isDuplicateTitleRepair(oldContent, newContent) {
	let oldEntries
	let newEntries
	try {
		oldEntries = parseJsonl(oldContent)
		newEntries = parseJsonl(newContent)
	} catch {
		return false
	}

	const oldByTitle = new Map()
	const oldTitleCounts = new Map()
	for (const entry of oldEntries) {
		const key = titleKey(entry)
		if (!key) continue
		oldTitleCounts.set(key, (oldTitleCounts.get(key) || 0) + 1)
		if (!oldByTitle.has(key)) oldByTitle.set(key, entry)
	}
	if (![...oldTitleCounts.values()].some((count) => count > 1)) return false

	const newTitles = new Set()
	for (const entry of newEntries) {
		const key = titleKey(entry)
		if (!key) return false
		if (newTitles.has(key)) return false
		newTitles.add(key)
		const oldEntry = oldByTitle.get(key)
		if (!oldEntry) continue
		const normalized = normalizeEntryForRepairCompare(entry, oldEntry.id)
		if (JSON.stringify(oldEntry) !== JSON.stringify(normalized)) return false
	}

	for (const [key, count] of oldTitleCounts) {
		if (count === 1 && !newTitles.has(key)) return false
	}
	return true
}

function main() {
	const changed = changedProtectedFiles()
	const failures = []

	for (const file of changed) {
		const oldContent = getHeadFile(file)
		const newContent = getCandidateFile(file)
		if (!newContent) {
			failures.push(`${file}: deletion is blocked`)
			continue
		}
		if (
			!startsWithBuffer(newContent, oldContent) &&
			!(file === "memory/lesson-index.jsonl" && (isDuplicateIdRepair(oldContent, newContent) || isDuplicateTitleRepair(oldContent, newContent)))
		) {
			failures.push(`${file}: existing lesson content was edited, removed, reordered, or rewritten`)
		}
		if (file === "memory/lesson-index.jsonl") {
			checkDuplicateJsonlIds(file, newContent, failures)
		}
	}

	if (!changed.includes("memory/lesson-index.jsonl")) {
		const indexContent = getCandidateFile("memory/lesson-index.jsonl")
		if (indexContent) {
			checkDuplicateJsonlIds("memory/lesson-index.jsonl", indexContent, failures)
		}
	}

	if (failures.length) {
		console.error("Append-only learning-layer guard failed:")
		for (const failure of failures) console.error(`  - ${failure}`)
		console.error("")
		console.error("Only append new lessons to memory/lessons-learned.md and memory/lesson-index.jsonl.")
		process.exit(1)
	}

	if (changed.length) {
		console.log(`Append-only learning-layer guard passed (${changed.length} protected file(s)).`)
	}
}

main()
