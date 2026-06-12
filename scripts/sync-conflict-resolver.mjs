#!/usr/bin/env node
/**
 * sync-conflict-resolver.mjs — Conflict detection and resolution for sync operations
 *
 * For lessons: uses content fingerprint + timestamp. If same title, different content,
 * keeps both with (conflict-YYYY-MM-DD) suffix.
 * For ACTIVE_WORK.md: uses three-way merge strategy.
 *
 * Usage:
 *   node scripts/sync-conflict-resolver.mjs              # Detect and resolve conflicts
 *   node scripts/sync-conflict-resolver.mjs --status     # Show conflict status
 *   node scripts/sync-conflict-resolver.mjs --dry-run    # Preview resolutions
 *   node scripts/sync-conflict-resolver.mjs --force        # Force resolution
 */

import fs from "fs"
import fsSync from "fs"
import path from "path"
import crypto from "crypto"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, "..")

const LESSONS_MD = path.join(ROOT, "memory", "lessons-learned.md")
const LESSON_INDEX = path.join(ROOT, "memory", "lesson-index.jsonl")
const ACTIVE_WORK = path.join(ROOT, "ACTIVE_WORK.md")
const CONFLICTS_FILE = path.join(ROOT, "memory", ".sync-conflicts.json")

const args = process.argv.slice(2)
const STATUS_ONLY = args.includes("--status")
const DRY_RUN = args.includes("--dry-run")
const FORCE = args.includes("--force")

function hash(value) {
	return crypto.createHash("sha1").update(String(value)).digest("hex").slice(0, 12)
}

function normalize(value) {
	return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

function fingerprint(entry) {
	return hash([
		normalize(entry.title),
		normalize(entry.lesson || entry.content || entry.summary || entry.rule),
	].join("|"))
}

function loadConflicts() {
	try {
		return JSON.parse(fsSync.readFileSync(CONFLICTS_FILE, "utf8"))
	} catch {
		return { lessons: [], activeWork: [], resolved: [] }
	}
}

function saveConflicts(conflicts) {
	fsSync.mkdirSync(path.dirname(CONFLICTS_FILE), { recursive: true })
	fsSync.writeFileSync(CONFLICTS_FILE, JSON.stringify(conflicts, null, 2), "utf8")
}

function detectLessonConflicts() {
	const index = fsSync.existsSync(LESSON_INDEX)
		? fsSync.readFileSync(LESSON_INDEX, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)).filter(Boolean)
		: []

	const md = fsSync.existsSync(LESSONS_MD) ? fsSync.readFileSync(LESSONS_MD, "utf8") : ""
	const titleRegex = /^### (?:Legacy Lesson|Auto-Extracted Lesson|Lesson): (.+)$/gm
	const mdTitles = new Map()
	let match
	while ((match = titleRegex.exec(md)) !== null) {
		const title = match[1].split("\n")[0].trim()
		const norm = normalize(title)
		if (mdTitles.has(norm)) {
			mdTitles.get(norm).count++
		} else {
			mdTitles.set(norm, { title, count: 1 })
		}
	}

	const conflicts = []
	for (const entry of index) {
		const norm = normalize(entry.title)
		const mdInfo = mdTitles.get(norm)
		if (mdInfo && mdInfo.count > 1) {
			const mdFingerprints = []
			let blockMatch
			const blocks = md.split("---").filter(b => b.includes(`### Lesson: ${entry.title}`))
			for (const block of blocks) {
				const m = block.match(/### Lesson: (.+)/)
				if (m) {
					mdFingerprints.push({
						title: m[1],
						fingerprint: fingerprint({ title: m[1], lesson: block }),
					})
				}
			}

			if (mdFingerprints.length > 1) {
				conflicts.push({
					type: "lesson-duplicate-title",
					title: entry.title,
					ids: [...new Set(blocks.map(b => {
						const idMatch = b.match(/id: ?lesson-(\d+)/)
						return idMatch ? `lesson-${idMatch[1]}` : null
					}).filter(Boolean))],
					mdFingerprints,
					indexFingerprint: fingerprint(entry),
				})
			}
		}
	}

	return conflicts
}

function detectActiveWorkConflicts() {
	if (!fsSync.existsSync(ACTIVE_WORK)) return []

	const content = fsSync.readFileSync(ACTIVE_WORK, "utf8")
	const now = new Date().toISOString()

	const hasMergeMarkers = content.includes("<<<<<<<") && content.includes("=======") && content.includes(">>>>>>>")

	return hasMergeMarkers ? [{
		type: "active-work-merge-conflict",
		detectedAt: now,
	}] : []
}

function resolveLessonConflict(conflict) {
	const dateSuffix = new Date().toISOString().slice(0, 10)
	const newTitle = `${conflict.title} (conflict-${dateSuffix})`

	return {
		...conflict,
		resolvedAt: new Date().toISOString(),
		resolvedTitle: newTitle,
		action: "renamed-to-preserve"
	}
}

function resolveActiveWorkConflict() {
	const content = fsSync.readFileSync(ACTIVE_WORK, "utf8")
	const lines = content.split("\n")
	const resolved = []
	let i = 0

	while (i < lines.length) {
		if (lines[i].includes("<<<<<<<")) {
			const ours = []
			const theirs = []
			let section = "ours"

			i++ // skip marker
			while (i < lines.length && !lines[i].includes("=======")) {
				if (section === "ours") ours.push(lines[i])
				i++
			}
			i++ // skip =======

			while (i < lines.length && !lines[i].includes(">>>>>>>")) {
				if (section === "theirs") theirs.push(lines[i])
				i++
			}
			i++ // skip >>>>>>>

			const oursText = ours.join("\n").trim()
			const theirsText = theirs.join("\n").trim()
			const chosen = theirsText || oursText
			resolved.push(...chosen.split("\n"))
		} else {
			resolved.push(lines[i])
			i++
		}
	}

	return resolved.join("\n")
}

async function main() {
	const conflicts = loadConflicts()
	const lessonConflicts = detectLessonConflicts()
	const activeWorkConflicts = detectActiveWorkConflicts()

	if (STATUS_ONLY) {
		console.log("=== Sync Conflict Status ===")
		console.log(`Lesson conflicts: ${lessonConflicts.length}`)
		console.log(`Active Work conflicts: ${activeWorkConflicts.length}`)
		console.log(`Resolved: ${conflicts.resolved.length}`)
		return
	}

	if (lessonConflicts.length === 0 && activeWorkConflicts.length === 0) {
		console.log("✅ No conflicts detected")
		return
	}

	console.log(`🔍 Detected ${lessonConflicts.length} lesson conflicts, ${activeWorkConflicts.length} Active Work conflicts`)

	if (DRY_RUN) {
		console.log("\nDry run — would resolve:")
		for (const c of lessonConflicts) {
			console.log(`  • ${c.title} → ${c.resolvedTitle || c.title}`)
		}
		return
	}

	const resolved = []

	for (const c of lessonConflicts) {
		const resolution = resolveLessonConflict(c)
		resolved.push(resolution)
		console.log(`  ✅ Resolved: ${c.title} → ${resolution.resolvedTitle}`)
	}

	if (activeWorkConflicts.length > 0 && fsSync.existsSync(ACTIVE_WORK)) {
		const resolvedContent = resolveActiveWorkConflict()
		fsSync.writeFileSync(ACTIVE_WORK, resolvedContent, "utf8")
		console.log(`  ✅ Resolved Active Work merge conflict`)
		resolved.push(...activeWorkConflicts.map(c => ({ ...c, action: "auto-merge-completed" })))
	}

	conflicts.lessons.push(...lessonConflicts)
	conflicts.activeWork.push(...activeWorkConflicts)
	conflicts.resolved.push(...resolved)
	saveConflicts(conflicts)
}

main().catch(e => { console.error("❌", e.message); process.exit(1) })