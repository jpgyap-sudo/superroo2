#!/usr/bin/env node
import fs from "fs/promises"
import fsSync from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..", "..")
const OUT_DIR = path.join(ROOT, "memory", "context")
const OUT_FILE = path.join(OUT_DIR, "latest-agent-context.md")

// ── Lightweight .env loader (no dotenv dependency) ──
function loadEnvFile(filePath) {
	try {
		const content = fsSync.readFileSync(filePath, "utf8")
		for (const line of content.split(/\r?\n/)) {
			const trimmed = line.trim()
			if (!trimmed || trimmed.startsWith("#")) continue
			const eqIdx = trimmed.indexOf("=")
			if (eqIdx === -1) continue
			const key = trimmed.slice(0, eqIdx).trim()
			let value = trimmed.slice(eqIdx + 1).trim()
			// Strip surrounding quotes if present
			if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
				value = value.slice(1, -1)
			}
			if (!process.env[key]) {
				process.env[key] = value
			}
		}
	} catch {
		// File not found or unreadable — skip silently
	}
}
// Load .env files — root first, then cloud (cloud overrides root)
loadEnvFile(path.join(ROOT, ".env"))
loadEnvFile(path.join(ROOT, "cloud", ".env"))

// ── DeepSeek API configuration ──
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || ""
const DEEPSEEK_API_URL = process.env.DEEPSEEK_API_URL || "https://api.deepseek.com/v1/chat/completions"
const SUMMARIZE_MODEL = process.env.SUMMARIZE_MODEL || "deepseek-chat"
const DEEPSEEK_TIMEOUT_MS = parseInt(process.env.DEEPSEEK_TIMEOUT || "30000", 10)
const MAX_FILE_SUMMARIES = parseInt(process.env.MAX_FILE_SUMMARIES || "2", 10)

async function readText(relativePath) {
	try {
		return await fs.readFile(path.join(ROOT, relativePath), "utf8")
	} catch {
		return ""
	}
}

function parseJsonl(content) {
	return content
		.split(/\r?\n/)
		.filter(Boolean)
		.map((line) => JSON.parse(line))
}

function scoreLesson(lesson, task) {
	const haystack = `${lesson.title} ${lesson.rule_summary} ${lesson.lesson_summary} ${(lesson.tags || []).join(" ")} ${(lesson.files || []).join(" ")}`.toLowerCase()
	return task
		.toLowerCase()
		.split(/\W+/)
		.filter(Boolean)
		.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), lesson.relevance_score || 0)
}

function isDurableLesson(lesson) {
	const combined = `${lesson.rule_summary || ""} ${lesson.lesson_summary || ""}`
	return lesson.policy_status !== "draft" && !/TODO|To be determined|Document the durable insight/i.test(combined)
}

function inferTaskTags(task) {
	const lower = task.toLowerCase()
	const tags = []
	if (/test|spec|coverage/.test(lower)) tags.push("testing")
	if (/api|endpoint|route/.test(lower)) tags.push("api")
	if (/dashboard|ui|view|frontend/.test(lower)) tags.push("ui")
	if (/lesson|learning|memory/.test(lower)) tags.push("learning")
	if (/deploy|release/.test(lower)) tags.push("deployment")
	return tags
}

function extractRelevantWorkingTreeLines(workingTree, taskTags) {
	if (!workingTree || taskTags.length === 0) return workingTree.split("\n").slice(0, 28).join("\n")
	const lines = workingTree.split("\n")
	const matched = lines.filter((line) => taskTags.some((tag) => line.toLowerCase().includes(tag)))
	return matched.slice(0, 18).join("\n") || workingTree.split("\n").slice(0, 28).join("\n")
}

/**
 * Call DeepSeek API to generate a compact summary of text content.
 * Uses fetch() (standard HTTPS, works fine — no Tailscale IP involved).
 * Returns the summary string, or null on failure.
 * Has a configurable timeout (default 30s).
 */
async function deepseekSummarize(text, instruction) {
	if (!text || text.length < 50) return null
	if (!DEEPSEEK_API_KEY) {
		console.warn("  ⚠️  DEEPSEEK_API_KEY not set — skipping summarization")
		return null
	}
	try {
		const messages = [
			{ role: "system", content: "You are a precise context compressor. Summarize the provided content concisely while preserving all key facts. Output only the summary, no preamble." },
			{ role: "user", content: `${instruction}\n\n${text.slice(0, 3000)}` },
		]
		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), DEEPSEEK_TIMEOUT_MS)
		const response = await fetch(DEEPSEEK_API_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
			},
			body: JSON.stringify({
				model: SUMMARIZE_MODEL,
				messages,
				max_tokens: 300,
				temperature: 0.3,
			}),
			signal: controller.signal,
		})
		clearTimeout(timeout)
		if (!response.ok) {
			console.warn(`  ⚠️  DeepSeek API error: ${response.status} ${response.statusText}`)
			return null
		}
		const data = await response.json()
		return data?.choices?.[0]?.message?.content?.trim() || null
	} catch (error) {
		if (error.name === "AbortError") {
			console.warn("  ⚠️  DeepSeek API request timed out")
		} else {
			console.warn(`  ⚠️  DeepSeek API request failed: ${error.message?.split("\n")[0] || error}`)
		}
		return null
	}
}

/**
 * Resolve a file path from a lesson's files array to an absolute path.
 * Handles both absolute paths and repo-relative paths.
 */
function resolveLessonFilePath(filePath) {
	if (path.isAbsolute(filePath)) {
		// Check if it's inside the repo
		if (filePath.startsWith(ROOT)) return filePath
		// External file — skip
		return null
	}
	// Relative path — resolve from repo root
	const resolved = path.join(ROOT, filePath)
	return resolved
}

/**
 * Read a source file, returning its content or null if unreadable.
 * Skips binary-like extensions and files > 50KB.
 */
async function readSourceFile(filePath) {
	try {
		const stat = await fs.stat(filePath)
		if (stat.size > 50_000) return null // skip large files
		const ext = path.extname(filePath).toLowerCase()
		if (/\.(png|jpg|jpeg|gif|bmp|ico|svg|woff|woff2|ttf|eot|zip|tar|gz|exe|dll|obj|bin|vsix)$/i.test(ext)) return null
		return await fs.readFile(filePath, "utf8")
	} catch {
		return null
	}
}

/**
 * Parse CLI flags from process.argv.
 * Returns { task, skipOllama }.
 */
function parseArgs() {
	const args = process.argv.slice(2)
	const skipIndex = args.indexOf("--skip-ollama")
	const skipOllama = skipIndex !== -1
	if (skipIndex !== -1) args.splice(skipIndex, 1)
	const task = args.join(" ").trim() || "general task"
	return { task, skipOllama }
}

async function main() {
	const { task, skipOllama } = parseArgs()
	const [workingTree, lessonIndexRaw, featureKnowledge, bugLog, modelDecisions, codexTasksRaw] = await Promise.all([
		readText("docs/resources/working-tree.md"),
		readText("memory/lesson-index.jsonl"),
		readText("memory/feature-knowledge.md"),
		readText("memory/bugs-fixed.md"),
		readText("memory/model-decisions.md"),
		readText("server/src/memory/codextask.json"),
	])
	const lessons = lessonIndexRaw ? parseJsonl(lessonIndexRaw) : []
	const taskTags = inferTaskTags(task)
	let relevantLessons = lessons
		.filter(isDurableLesson)
		.map((lesson) => ({ ...lesson, score: scoreLesson(lesson, task) }))
		.sort((a, b) => b.score - a.score)
		.slice(0, 5)
	if (relevantLessons.length === 0) {
		relevantLessons = lessons
			.filter(isDurableLesson)
			.sort((a, b) => (b.relevance_score || 0) - (a.relevance_score || 0))
			.slice(0, 5)
	}
	let activeTasks = []
	try {
		const parsed = JSON.parse(codexTasksRaw || '{"tasks":[]}')
		activeTasks = (parsed.tasks || []).filter((entry) => entry.status === "active").slice(0, 5)
	} catch {
		activeTasks = []
	}

	// ── Summarization phase ──
	let ollamaLessonSummary = ""
	let ollamaFileSummaries = ""
	let ollamaWorkingTreeSummary = ""
	let ollamaBugSummary = ""
	let ollamaFeatureSummary = ""
	let ollamaModelDecisionSummary = ""

	if (!skipOllama) {
		if (!DEEPSEEK_API_KEY) {
			console.log("⚠️  DEEPSEEK_API_KEY not set — skipping summarization (context built from raw files)")
		} else {
			console.log(`🔍 Using DeepSeek API (model: ${SUMMARIZE_MODEL}) for context compression...`)

			// Note: Lesson compression is skipped — pre-computed summaries from
			// memory/lesson-summaries.json are injected directly in the context sections below.
			// The rule_summary and lesson_summary fields in lesson-index.jsonl are already concise.

			// 1. Summarize source files referenced by relevant lessons (parallel — DeepSeek API handles concurrency fine)
			const filesToSummarize = new Set()
			for (const lesson of relevantLessons) {
				if (lesson.files) {
					for (const f of lesson.files) {
						const resolved = resolveLessonFilePath(f)
						if (resolved) filesToSummarize.add(resolved)
					}
				}
			}
			if (filesToSummarize.size > 0) {
				const filePaths = [...filesToSummarize].slice(0, Math.max(0, MAX_FILE_SUMMARIES))
				console.log(`📄 Reading ${filePaths.length} source files referenced by lessons...`)
				const fileContents = await Promise.all(
					filePaths.map(async (fp) => {
						const content = await readSourceFile(fp)
						return { filePath: fp, content }
					}),
				)
				const readableFiles = fileContents.filter((f) => f.content)
				if (readableFiles.length > 0) {
					console.log(`  Summarizing ${readableFiles.length} files via DeepSeek (parallel)...`)
					const results = await Promise.all(
						readableFiles.map(async ({ filePath, content }, idx) => {
							const relPath = path.relative(ROOT, filePath)
							const summary = await deepseekSummarize(
								content,
								`You are a code analyst. Summarize this source file in 2-3 sentences for a developer working on: "${task}". Focus on: what the file exports, its main purpose, and any patterns or conventions relevant to the task. File: ${relPath}`,
							)
							console.log(`  [${idx + 1}/${readableFiles.length}] ${relPath}${summary ? " ✅" : " ⚠️ failed"}`)
							return { relPath, summary }
						}),
					)
					const successful = results.filter((r) => r.summary)
					if (successful.length > 0) {
						ollamaFileSummaries = `\n### DeepSeek File Summaries\n\n${successful.map((r) => `- **${r.relPath}**: ${r.summary}`).join("\n")}\n`
						console.log(`  ✅ ${successful.length}/${readableFiles.length} files summarized`)
					}
				}
			}

			// 2. Summarize relevant working tree sections
			const relevantWorkingTree = workingTree ? extractRelevantWorkingTreeLines(workingTree, taskTags) : ""
			if (relevantWorkingTree && relevantWorkingTree.length > 200) {
				console.log(`🏗️  Summarizing working tree sections...`)
				const summary = await deepseekSummarize(
					relevantWorkingTree,
					`You are an architecture analyst. Summarize these working tree sections in 2-3 sentences for a developer working on: "${task}". Focus on: which modules are affected, their connections, and any relevant architecture constraints.`,
				)
				if (summary) {
					ollamaWorkingTreeSummary = `\n### DeepSeek Architecture Summary\n\n${summary}\n`
					console.log(`  ✅ Working tree summarized`)
				}
			}

			// 3. Summarize relevant bug log entries
			if (bugLog && bugLog.length > 200) {
				const bugPreview = bugLog.split("\n").slice(0, 30).join("\n")
				console.log(`🐛 Summarizing recent bug memory...`)
				const summary = await deepseekSummarize(
					bugPreview,
					`You are a bug analyst. Summarize these bug entries in 2-3 sentences for a developer working on: "${task}". Focus on: recurring bug patterns, root causes, and fixes that are relevant.`,
				)
				if (summary) {
					ollamaBugSummary = `\n### DeepSeek Bug Memory Summary\n\n${summary}\n`
					console.log(`  ✅ Bug memory summarized`)
				}
			}

			// 4. Summarize feature knowledge
			if (featureKnowledge && featureKnowledge.length > 200) {
				const featurePreview = featureKnowledge.split("\n").slice(0, 20).join("\n")
				console.log(`💡 Summarizing feature knowledge...`)
				const summary = await deepseekSummarize(
					featurePreview,
					`You are a feature analyst. Summarize these feature knowledge entries in 2-3 sentences for a developer working on: "${task}". Focus on: relevant feature capabilities and constraints.`,
				)
				if (summary) {
					ollamaFeatureSummary = `\n### DeepSeek Feature Knowledge Summary\n\n${summary}\n`
					console.log(`  ✅ Feature knowledge summarized`)
				}
			}

			// 5. Summarize model decisions
			if (modelDecisions && modelDecisions.length > 200) {
				const modelPreview = modelDecisions.split("\n").slice(0, 20).join("\n")
				console.log(`🧠 Summarizing model decisions...`)
				const summary = await deepseekSummarize(
					modelPreview,
					`You are a technology analyst. Summarize these model/API decisions in 2-3 sentences for a developer working on: "${task}". Focus on: which models or APIs were chosen and why.`,
				)
				if (summary) {
					ollamaModelDecisionSummary = `\n### DeepSeek Model Decision Summary\n\n${summary}\n`
					console.log(`  ✅ Model decisions summarized`)
				}
			}
		}
	} else {
		console.log("⏩ --skip-ollama flag set — skipping summarization")
	}

	// ── Build context sections (only include non-empty Ollama sections) ──
	const sections = [
		"# Latest Agent Context",
		"",
		`Generated: ${new Date().toISOString()}`,
		`Task: ${task}`,
		"",
		"## Relevant Lessons",
		relevantLessons.length
			? relevantLessons
					.map(
						(lesson, index) =>
							`${index + 1}. **${lesson.title}**\n   - Rule: ${lesson.rule_summary}\n   - Why: ${lesson.lesson_summary}`,
					)
					.join("\n")
			: "No matching lessons found.",
		ollamaLessonSummary || "",
		"",
		"## Active Codex Tasks",
		activeTasks.length ? activeTasks.map((entry) => `- ${entry.title} (${entry.id})`).join("\n") : "No active Codex tasks.",
		"",
		"## Architecture Reminder",
		workingTree ? extractRelevantWorkingTreeLines(workingTree, taskTags) : "Working Tree unavailable.",
		ollamaWorkingTreeSummary || "",
		"",
		"## Task Signals",
		taskTags.length ? `Inferred tags: ${taskTags.join(", ")}` : "No strong task tags inferred.",
		"",
		"## Feature Knowledge",
		featureKnowledge ? featureKnowledge.split("\n").slice(0, 40).join("\n") : "No feature knowledge recorded.",
		ollamaFeatureSummary || "",
		"",
		"## Recent Bug Memory",
		bugLog ? bugLog.split("\n").slice(0, 40).join("\n") : "No bug memory recorded.",
		ollamaBugSummary || "",
		"",
		"## Model Decisions",
		modelDecisions ? modelDecisions.split("\n").slice(0, 40).join("\n") : "No model decisions recorded.",
		ollamaModelDecisionSummary || "",
		"",
		ollamaFileSummaries || "",
		"",
	]
	await fs.mkdir(OUT_DIR, { recursive: true })
	await fs.writeFile(OUT_FILE, sections.join("\n"), "utf8")
	console.log(`Wrote ${path.relative(ROOT, OUT_FILE)}`)
}

main().catch((error) => {
	console.error(error)
	process.exit(1)
})
