#!/usr/bin/env node
/**
 * Consolidate local extension lessons into the canonical SuperRoo learning layer.
 *
 * Canonical authoring store:
 *   memory/lessons-learned.md
 *
 * Machine index used for retrieval/VPS sync:
 *   memory/lesson-index.jsonl
 *
 * This script never rewrites or deletes existing lessons. It only appends new,
 * deduped lessons from known local extension stores.
 */

import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")
const HOME = process.env.USERPROFILE || process.env.HOME || ""

const LESSONS_MD = path.join(ROOT, "memory", "lessons-learned.md")
const LESSON_INDEX = path.join(ROOT, "memory", "lesson-index.jsonl")

const args = new Set(process.argv.slice(2))
const dryRun = args.has("--dry-run")
const statusOnly = args.has("--status")
const syncVps = args.has("--sync-vps")

function rel(file) {
	return path.relative(ROOT, file).replaceAll("\\", "/")
}

function exists(file) {
	try {
		return fs.existsSync(file)
	} catch {
		return false
	}
}

function read(file) {
	return fs.readFileSync(file, "utf8")
}

function loadJson(file, fallback) {
	if (!exists(file)) return fallback
	try {
		return JSON.parse(read(file))
	} catch {
		return fallback
	}
}

function loadJsonl(file) {
	if (!exists(file)) return []
	return read(file)
		.split(/\r?\n/)
		.filter(Boolean)
		.map((line) => {
			try {
				return JSON.parse(line)
			} catch {
				return null
			}
		})
		.filter(Boolean)
}

function normalize(value) {
	return String(value || "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim()
		.slice(0, 160)
}

function hash(value) {
	return crypto.createHash("sha1").update(String(value)).digest("hex").slice(0, 12)
}

function splitCsv(value) {
	return String(value || "")
		.split(/[,\n]/)
		.map((item) => item.trim())
		.filter(Boolean)
}

function getNextLessonNum(entries) {
	const nums = entries
		.map((entry) => {
			const match = String(entry.id || "").match(/^lesson-(\d+)$/)
			return match ? Number.parseInt(match[1], 10) : 0
		})
		.filter((num) => Number.isFinite(num))
	return nums.length ? Math.max(...nums) + 1 : 500
}

function existingKeys(indexEntries, markdown) {
	const keys = new Set()
	for (const entry of indexEntries) {
		if (entry.id) keys.add(`id:${entry.id}`)
		if (entry.extension_source_id) keys.add(`source:${entry.extension_source_id}`)
		if (entry.brain_id) keys.add(`source:${entry.brain_id}`)
		if (entry.brain_entry_id) keys.add(`source:${entry.brain_entry_id}`)
		keys.add(`title:${normalize(entry.title)}`)
		keys.add(`fingerprint:${fingerprint({
			title: entry.title,
			rule: entry.rule_summary,
			lesson: entry.lesson_summary,
		})}`)
	}

	const titleRegex = /^### (?:Legacy Lesson|Auto-Extracted Lesson|Lesson): (.+)$/gm
	let match
	while ((match = titleRegex.exec(markdown)) !== null) {
		keys.add(`title:${normalize(match[1])}`)
	}
	return keys
}

function fingerprint(candidate) {
	return hash([
		normalize(candidate.title),
		normalize(candidate.rule || candidate.lesson || candidate.summary || candidate.content),
	].join("|"))
}

function lessonMarkdown(candidate) {
	const files = candidate.files?.length ? candidate.files.join(", ") : "n/a"
	const tags = candidate.tags?.length ? candidate.tags.join(", ") : candidate.agent
	const task = candidate.task || `Imported from ${candidate.agent} local lesson source.`
	const lesson = candidate.lesson || candidate.content || candidate.summary || "No lesson summary recorded."
	const rule = candidate.rule || lesson.split(/\.\s+/)[0] || "No reusable rule recorded."
	return `
### Lesson: ${candidate.title}

Date: ${candidate.date || new Date().toISOString().slice(0, 10)}
Source: ${candidate.source || `${candidate.agent} local extension sync`}
Model/API used: ${candidate.model || "unknown"}
Confidence: ${candidate.confidence || "medium"}
Related files: ${files}

#### Task Summary

${task}

#### Files Changed

${candidate.files?.length ? candidate.files.map((file) => `- ${file}`).join("\n") : "- n/a"}

#### Bug Cause

${candidate.cause || "n/a"}

#### Fix Applied

${candidate.fix || "n/a"}

#### Test Result

${candidate.test || "unknown"}

#### Lesson Learned

${lesson}

#### Reusable Rule

${rule}

#### Tags

${tags}

---
`
}

function indexEntry(candidate, lessonId) {
	const lesson = candidate.lesson || candidate.content || candidate.summary || ""
	const rule = candidate.rule || lesson.split(/\.\s+/)[0] || ""
	return {
		id: lessonId,
		title: candidate.title,
		type: candidate.type || "lesson",
		date: candidate.date || new Date().toISOString().slice(0, 10),
		source: candidate.source || `${candidate.agent} local extension sync`,
		model: candidate.model || "unknown",
		confidence: candidate.confidence || "medium",
		project: candidate.project || "superroo2",
		files: candidate.files || [],
		tags: [...new Set([...(candidate.tags || []), candidate.agent, "local-extension-sync"].filter(Boolean))],
		relevance_score: candidate.relevance_score || 0.9,
		relevance_factors: {
			is_bug_fix: candidate.type === "bugfix" || candidate.type === "fix",
			has_tests: /pass|test/i.test(candidate.test || ""),
			affects_multiple_files: (candidate.files || []).length > 1,
			has_reusable_rule: Boolean(rule),
		},
		rule_summary: rule.slice(0, 300),
		lesson_summary: lesson.slice(0, 500),
		extension_agent: candidate.agent,
		extension_source: candidate.sourcePath ? rel(candidate.sourcePath) : undefined,
		extension_source_id: candidate.sourceId,
		extension_fingerprint: fingerprint(candidate),
	}
}

function parseMarkdownLessons(file, agent, sourceName) {
	if (!exists(file)) return []
	const normalized = read(file).replace(/\r\n/g, "\n")
	const regex = /### (?:Legacy Lesson|Auto-Extracted Lesson|Lesson): (.+?)(?=\n### (?:Legacy Lesson|Auto-Extracted Lesson|Lesson): |\s*$)/gs
	const candidates = []
	let match
	while ((match = regex.exec(normalized)) !== null) {
		const block = match[0].trim()
		const title = match[1].split("\n")[0].trim()
		const field = (label) => block.match(new RegExp(`^${label}:\\s*(.+)$`, "m"))?.[1]?.trim() || ""
		const section = (label) => block.match(new RegExp(`#### ${label}\\s*\\n([\\s\\S]*?)(?=\\n#### |\\n---|$)`))?.[1]?.trim() || ""
		candidates.push({
			agent,
			source: sourceName,
			sourcePath: file,
			sourceId: `${agent}:${rel(file)}:${hash(block)}`,
			title,
			type: "lesson",
			date: field("Date") || undefined,
			model: field("Model/API used") || undefined,
			confidence: field("Confidence") || undefined,
			files: splitCsv(field("Related files")),
			tags: splitCsv(section("Tags")),
			task: section("Task Summary"),
			cause: section("Bug Cause"),
			fix: section("Fix Applied"),
			test: section("Test Result"),
			lesson: section("Lesson Learned"),
			rule: section("Reusable Rule"),
		})
	}
	return candidates
}

function claudeBrainCandidates() {
	const file = path.join(ROOT, "memory", "claude-brain", "knowledge.jsonl")
	return loadJsonl(file).map((entry) => ({
		agent: "claude",
		source: "Claude Code brain",
		sourcePath: file,
		sourceId: `claude-brain:${entry.id || hash(JSON.stringify(entry))}`,
		title: entry.title || "Claude brain lesson",
		type: entry.type || "lesson",
		date: entry.date,
		model: "claude-sonnet-4-6",
		confidence: entry.confidence || "high",
		files: entry.relatedFiles || [],
		tags: [...(entry.tags || []), "claude-brain"],
		content: entry.content,
		lesson: entry.content,
		rule: String(entry.content || "").split(/\.\s+/)[0],
	}))
}

function codexBrainCandidates() {
	const file = path.join(ROOT, "memory", "codex-brain", "memory.json")
	const db = loadJson(file, { entries: [] })
	return (db.entries || [])
		.filter((entry) => entry.metadata?.source !== "superroo-lesson-index")
		.map((entry) => ({
			agent: "codex",
			source: "Codex Brain memory",
			sourcePath: file,
			sourceId: `codex-brain:${entry.id}`,
			title: entry.metadata?.title || String(entry.content || "").split("\n")[0].replace(/^#+\s*/, "").slice(0, 140) || "Codex brain memory",
			type: entry.metadata?.type || "lesson",
			date: String(entry.createdAt || new Date().toISOString()).slice(0, 10),
			model: "codex + local ollama",
			confidence: entry.metadata?.confidence || "medium",
			files: entry.metadata?.files || entry.metadata?.relatedFiles || [],
			tags: [...(entry.metadata?.tags || []), "codex-brain"],
			content: entry.content,
			lesson: entry.content,
			rule: entry.metadata?.rule || String(entry.content || "").split(/\.\s+/)[0],
		}))
}

function kiloCandidates() {
	const paths = [
		path.join(ROOT, ".kilo", "memory", "lessons.jsonl"),
		path.join(ROOT, ".kilo", "memory", "lesson-index.jsonl"),
		path.join(ROOT, ".kilo", "lessons.jsonl"),
		path.join(HOME, ".kilo", "memory", "lessons.jsonl"),
		path.join(HOME, ".kilo", "memory", "lesson-index.jsonl"),
	]
	const candidates = []
	for (const file of paths) {
		for (const entry of loadJsonl(file)) {
			candidates.push({
				agent: "kilo",
				source: "Kilo Code local lesson store",
				sourcePath: file,
				sourceId: `kilo:${entry.id || hash(JSON.stringify(entry))}`,
				title: entry.title || entry.task || "Kilo Code lesson",
				type: entry.type || entry.task_type || "lesson",
				date: entry.date,
				model: entry.model || entry.models?.[0] || "kilo-code",
				confidence: entry.confidence || "medium",
				files: entry.files || entry.relatedFiles || [],
				tags: [...(entry.tags || []), "kilo-code"],
				task: entry.task_summary || entry.task,
				lesson: entry.lesson_summary || entry.lesson || entry.root_cause || entry.content,
				rule: entry.rule_summary || entry.reusable_rule || entry.fix,
			})
		}
	}
	return candidates
}

function blackboxCandidates() {
	const paths = [
		path.join("C:", "Users", "user", "Documents", ".blackbox", "memory", "*.jsonl"),
		path.join("C:", "Users", "user", "Documents", ".blackbox", "lessons", "*.md"),
		path.join("C:", "Users", "user", "AppData", "Roaming", "Code", "User", "globalStorage", "blackboxapp.blackboxagent", "memory", "*.json"),
	]
	const candidates = []

	for (const pattern of paths) {
		try {
			const files = fsSync.existsSync(pattern)
				? [pattern]
				: globSync(pattern)
			for (const file of files || []) {
				if (!fsSync.existsSync(file)) continue

				const raw = fsSync.readFileSync(file, "utf8")
				const lines = raw.split(/\r?\n/).filter(Boolean)

				for (let i = 0; i < lines.length; i++) {
					try {
						const entry = JSON.parse(lines[i])
						candidates.push({
							agent: "blackbox",
							source: "Blackbox Agent local lesson store",
							sourcePath: file,
							sourceId: `blackbox:${entry.id || `${path.basename(file)}:${i}`}`,
							title: entry.title || entry.task || "Blackbox lesson",
							type: entry.type || "lesson",
							date: entry.date,
							model: entry.model || "blackbox",
							confidence: entry.confidence || "medium",
							files: entry.files || entry.relatedFiles || [],
							tags: [...(entry.tags || []), "blackbox-agent"],
							lesson: entry.lesson_summary || entry.lesson || entry.content || entry.summary,
							rule: entry.rule_summary || entry.reusable_rule || entry.rule,
						})
					} catch {}
				}
			}
		} catch {}
	}

	// Also check for markdown files in blackbox lessons directory
	const mdDir = path.join("C:", "Users", "user", "Documents", ".blackbox", "lessons")
	try {
		if (fsSync.existsSync(mdDir)) {
			const files = fsSync.readdirSync(mdDir).filter(f => f.endsWith(".md"))
			for (const file of files) {
				const fullPath = path.join(mdDir, file)
				candidates.push(...parseMarkdownLessons(fullPath, "blackbox", "Blackbox lessons markdown"))
			}
		}
	} catch {}

	return candidates
}

function globSync(pattern) {
	try {
		const basePath = pattern.replace(/\*.*$/, "")
		const files = fsSync.readdirSync(basePath)
		const regex = new RegExp(pattern.replace(/\*/g, ".*"))
		return files.filter(f => regex.test(f)).map(f => path.join(basePath, f))
	} catch { return [] }
}

function claudeProjectMemoryCandidates() {
	const projectMemory = path.join(HOME, ".claude", "projects", "c--Users-user-Documents-superroo2", "memory")
	const files = [
		path.join(projectMemory, "MEMORY.md"),
		path.join(projectMemory, "feedback_workflow.md"),
		path.join(projectMemory, "project_ollama_setup.md"),
		path.join(ROOT, "scripts", "claude-lessons-content.md"),
	]
	return files.flatMap((file) => parseMarkdownLessons(file, "claude", "Claude Code project memory"))
}

function allCandidates() {
	return [
		...claudeBrainCandidates(),
		...claudeProjectMemoryCandidates(),
		...codexBrainCandidates(),
		...kiloCandidates(),
		...blackboxCandidates(),
	].filter((candidate) => candidate.title && (candidate.lesson || candidate.content || candidate.summary || candidate.rule))
}

function main() {
	const indexEntries = loadJsonl(LESSON_INDEX)
	const markdown = exists(LESSONS_MD) ? read(LESSONS_MD) : ""
	const seen = existingKeys(indexEntries, markdown)
	const candidates = allCandidates()
	const accepted = []
	const skipped = []

	for (const candidate of candidates) {
		const keys = [
			`source:${candidate.sourceId}`,
			`title:${normalize(candidate.title)}`,
			`fingerprint:${fingerprint(candidate)}`,
		]
		if (keys.some((key) => seen.has(key))) {
			skipped.push(candidate)
			continue
		}
		for (const key of keys) seen.add(key)
		accepted.push(candidate)
	}

	console.log("Local extension lesson consolidation")
	console.log(`  Existing index rows: ${indexEntries.length}`)
	console.log(`  Source candidates:   ${candidates.length}`)
	console.log(`  New append-only:     ${accepted.length}`)
	console.log(`  Duplicates skipped:  ${skipped.length}`)

	if (statusOnly || dryRun) {
		for (const candidate of accepted.slice(0, 25)) {
			console.log(`  + [${candidate.agent}] ${candidate.title}`)
		}
		if (accepted.length > 25) console.log(`  ... and ${accepted.length - 25} more`)
		if (statusOnly || dryRun) return
	}

	if (!accepted.length) {
		console.log("No new local extension lessons to append.")
		if (syncVps) runVpsSync()
		return
	}

	let nextNum = getNextLessonNum(indexEntries)
	let mdAppend = ""
	const indexLines = []
	for (const candidate of accepted) {
		const lessonId = `lesson-${nextNum++}`
		mdAppend += lessonMarkdown(candidate)
		indexLines.push(JSON.stringify(indexEntry(candidate, lessonId)))
	}

	fs.appendFileSync(LESSONS_MD, mdAppend, "utf8")
	fs.appendFileSync(LESSON_INDEX, `${indexLines.join("\n")}\n`, "utf8")
	console.log(`Appended ${accepted.length} lessons to memory/lessons-learned.md and memory/lesson-index.jsonl.`)

	if (syncVps) runVpsSync()
}

function runVpsSync() {
	console.log("Syncing consolidated lesson index to SuperRoo VPS...")
	const result = spawnSync(process.execPath, ["scripts/sync-lessons-to-central-brain.mjs"], {
		cwd: ROOT,
		stdio: "inherit",
		windowsHide: true,
		env: process.env,
	})
	if (result.status !== 0) {
		process.exitCode = result.status || 1
	}
}

main()
