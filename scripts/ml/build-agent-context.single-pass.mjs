#!/usr/bin/env node
import fs from "fs/promises"
import fsSync from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { execSync } from "child_process"
import os from "os"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..", "..")
const OUT_DIR = path.join(ROOT, "memory", "context")
const OUT_FILE = path.join(OUT_DIR, "latest-agent-context.md")
const HELPER_SCRIPT = path.join(__dirname, "ollama-curl-helper.cmd")
const TMP_DIR = fsSync.mkdtempSync(path.join(os.tmpdir(), "sr-ollama-"))

// ── Ollama configuration ──
const LOCAL_OLLAMA_URL = "http://127.0.0.1:11434"
const VPS_OLLAMA_URL = "http://100.64.175.88:11434"
// Use 0.5B by default — 1.5B doesn't fit in VPS RAM (3.8GB total, 588MB free)
const SUMMARIZE_MODEL = process.env.OLLAMA_SUMMARIZE_MODEL || "hermes3"
const OLLAMA_GEN_TIMEOUT_MS = parseInt(process.env.OLLAMA_TIMEOUT || "60000", 10)
const OLLAMA_CONNECT_TIMEOUT_MS = 3_000 // 3s timeout for connectivity check
const OLLAMA_MAX_FILE_SUMMARIES = parseInt(process.env.OLLAMA_MAX_FILE_SUMMARIES || "2", 10)

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
 * Run a curl command via the batch helper script and return the parsed JSON result.
 * Uses a .cmd helper because Node.js child_process hangs on Tailscale IPs on Windows,
 * but cmd.exe -> curl.exe works fine.
 */
function curlOllama(url, bodyJson, timeoutMs) {
	const outFile = path.join(TMP_DIR, `resp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.json`)
	try {
		if (bodyJson) {
			// Write body to temp file, then call helper with body file path
			const bodyFile = path.join(TMP_DIR, `body_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.json`)
			fsSync.writeFileSync(bodyFile, bodyJson, "utf8")
			execSync(`"${HELPER_SCRIPT}" "${url}" "${outFile}" "${bodyFile}"`, {
				timeout: (timeoutMs || OLLAMA_GEN_TIMEOUT_MS) + 5000,
				stdio: ["pipe", "pipe", "ignore"],
				windowsHide: true,
			})
			try { fsSync.unlinkSync(bodyFile) } catch {}
		} else {
			execSync(`"${HELPER_SCRIPT}" "${url}" "${outFile}"`, {
				timeout: (timeoutMs || OLLAMA_CONNECT_TIMEOUT_MS) + 5000,
				stdio: ["pipe", "pipe", "ignore"],
				windowsHide: true,
			})
		}
		const raw = fsSync.readFileSync(outFile, "utf8")
		return JSON.parse(raw)
	} catch {
		return null
	} finally {
		try { fsSync.unlinkSync(outFile) } catch {}
	}
}

/**
 * Check if Ollama is reachable (timeout-safe).
 * Uses a .cmd helper script because Node.js child_process hangs on Tailscale IPs on Windows.
 * Tries localhost first, then falls back to VPS Ollama via Tailscale.
 * Returns the reachable URL or null.
 */
function isOllamaReachable() {
	const urlsToTry = [
		...(process.env.OLLAMA_URL ? [{ url: process.env.OLLAMA_URL, name: "env" }] : []),
		{ url: LOCAL_OLLAMA_URL, name: "local" },
		{ url: VPS_OLLAMA_URL, name: "VPS (100.64.175.88)" },
	]
	for (const { url, name } of urlsToTry) {
		const data = curlOllama(`${url}/api/tags`, null, OLLAMA_CONNECT_TIMEOUT_MS)
		if (data && data.models) {
			process.env.OLLAMA_URL = url
			return url
		}
	}
	return null
}

/**
 * Call Ollama to generate a compact summary of text content.
 * Uses a .cmd helper script because Node.js child_process hangs on Tailscale IPs on Windows.
 * Returns the summary string, or null on failure.
 * Has a configurable timeout (default 120s) to prevent hanging on slow models.
 * Uses a small input slice (800 chars) to keep generation fast on CPU-bound models.
 */
function ollamaSummarize(text, instruction, ollamaUrl) {
	if (!text || text.length < 50) return null
	try {
		const prompt = `${instruction}\n\n${text.slice(0, 800)}`
		const body = JSON.stringify({
			model: SUMMARIZE_MODEL,
			prompt,
			stream: false,
			options: { num_predict: 150 },
		})
		const data = curlOllama(`${ollamaUrl}/api/generate`, body, OLLAMA_GEN_TIMEOUT_MS)
		return data?.response?.trim() || null
	} catch (error) {
		console.error(`  ⚠️  Ollama summarization failed: ${error.message?.split("\n")[0] || error}`)
		return null
	}
}

/**
 * Multi-pass summarization — chains 2-3 Ollama calls to produce higher quality output
 * from a small model (0.5B) by breaking the task into stages:
 *
 * Pass 1 — Extract: Pull key sentences/entities from raw text
 * Pass 2 — Condense: Merge extracted items, remove duplicates, group related concepts
 * Pass 3 — Format: Structure into final bullet-point summary
 *
 * Each pass stays within the 0.5B model's capability (short input, short output),
 * but the chaining produces a much better result than a single pass.
 * Falls back to single-pass if any intermediate step fails.
 */

/**
 * Benchmark Ollama response time with a tiny prompt.
 * Uses a .cmd helper script because Node.js child_process hangs on Tailscale IPs on Windows.
 * If the model takes >15s for a trivial prompt, it's too slow for real-time use.
 */
function isOllamaFastEnough(ollamaUrl) {
	try {
		const start = Date.now()
		const body = JSON.stringify({
			model: SUMMARIZE_MODEL,
			prompt: "Reply with exactly one word: hello",
			stream: false,
			options: { num_predict: 10 },
		})
		const data = curlOllama(`${ollamaUrl}/api/generate`, body, 20_000)
		if (!data?.response) return false
		const elapsed = Date.now() - start
		if (elapsed > 15_000) {
			console.warn(`  ⚠️  Ollama response time ${(elapsed / 1000).toFixed(1)}s — too slow for real-time use, skipping summarization`)
			return false
		}
		return true
	} catch {
		return false
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

	// ── Ollama summarization phase ──
	let ollamaLessonSummary = ""
	let ollamaFileSummaries = ""
	let ollamaWorkingTreeSummary = ""
	let ollamaBugSummary = ""
	let ollamaFeatureSummary = ""
	let ollamaModelDecisionSummary = ""

	if (!skipOllama) {
		console.log("🔍 Checking Ollama availability...")
		const ollamaUrl = isOllamaReachable()

		if (ollamaUrl) {
			console.log(`✅ Ollama reachable at ${ollamaUrl} (model: ${SUMMARIZE_MODEL})`)

			// Quick benchmark — skip if model is too slow (e.g., thrashing VPS)
			console.log("⚡ Benchmarking Ollama response time...")
			const fastEnough = isOllamaFastEnough(ollamaUrl)
			if (!fastEnough) {
				console.log("⚠️  Ollama too slow — skipping summarization (context built from raw files)")
			} else {
				console.log(`  ✅ Response time acceptable`)

				// 1. Summarize relevant lessons into compact form
				if (relevantLessons.length > 0) {
					console.log(`📚 Summarizing ${relevantLessons.length} relevant lessons...`)
					const lessonTexts = relevantLessons
						.map((l, i) => `${i + 1}. ${l.title}\n   Rule: ${l.rule_summary}\n   Why: ${l.lesson_summary}`)
						.join("\n\n")
					const summary = ollamaSummarize(
						lessonTexts,
						`You are a context compressor for a coding agent. Summarize these ${relevantLessons.length} engineering lessons into 3-4 concise bullet points. Focus on actionable rules and reusable insights relevant to the task: "${task}". Output only the bullet points.`,
						ollamaUrl,
					)
					if (summary) {
						ollamaLessonSummary = `\n### Ollama-Compressed Lesson Summary\n\n${summary}\n`
						console.log(`  ✅ Lessons compressed`)
					}
				}

				// 2. Summarize source files referenced by relevant lessons (sequential)
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
					const filePaths = [...filesToSummarize].slice(0, Math.max(0, OLLAMA_MAX_FILE_SUMMARIES))
					console.log(`📄 Reading ${filePaths.length} source files referenced by lessons...`)
					const fileContents = await Promise.all(
						filePaths.map(async (fp) => {
							const content = await readSourceFile(fp)
							return { filePath: fp, content }
						}),
					)
					const readableFiles = fileContents.filter((f) => f.content)
					if (readableFiles.length > 0) {
						// Sequential — remote Ollama processes one request at a time.
						// Parallel requests queue up server-side, each taking progressively longer.
						console.log(`  Summarizing ${readableFiles.length} files via Ollama (sequential)...`)
						const results = []
						for (let idx = 0; idx < readableFiles.length; idx++) {
							const { filePath, content } = readableFiles[idx]
							const relPath = path.relative(ROOT, filePath)
							const summary = ollamaSummarize(
								content,
								`You are a code analyst. Summarize this source file in 2-3 sentences for a developer working on: "${task}". Focus on: what the file exports, its main purpose, and any patterns or conventions relevant to the task. File: ${relPath}`,
								ollamaUrl,
							)
							console.log(`  [${idx + 1}/${readableFiles.length}] ${relPath}${summary ? " ✅" : " ⚠️ failed"}`)
							results.push({ relPath, summary })
						}
						const successful = results.filter((r) => r.summary)
						if (successful.length > 0) {
							ollamaFileSummaries = `\n### Ollama File Summaries\n\n${successful.map((r) => `- **${r.relPath}**: ${r.summary}`).join("\n")}\n`
							console.log(`  ✅ ${successful.length}/${readableFiles.length} files summarized`)
						}
					}
				}

				// 3. Summarize relevant working tree sections
				const relevantWorkingTree = workingTree ? extractRelevantWorkingTreeLines(workingTree, taskTags) : ""
				if (relevantWorkingTree && relevantWorkingTree.length > 200) {
					console.log(`🏗️  Summarizing working tree sections...`)
					const summary = ollamaSummarize(
						relevantWorkingTree,
						`You are an architecture analyst. Summarize these working tree sections in 2-3 sentences for a developer working on: "${task}". Focus on: which modules are affected, their connections, and any relevant architecture constraints.`,
						ollamaUrl,
					)
					if (summary) {
						ollamaWorkingTreeSummary = `\n### Ollama Architecture Summary\n\n${summary}\n`
						console.log(`  ✅ Working tree summarized`)
					}
				}

				// 4. Summarize relevant bug log entries
				if (bugLog && bugLog.length > 200) {
					const bugPreview = bugLog.split("\n").slice(0, 30).join("\n")
					console.log(`🐛 Summarizing recent bug memory...`)
					const summary = ollamaSummarize(
						bugPreview,
						`You are a bug analyst. Summarize these bug entries in 2-3 sentences for a developer working on: "${task}". Focus on: recurring bug patterns, root causes, and fixes that are relevant.`,
						ollamaUrl,
					)
					if (summary) {
						ollamaBugSummary = `\n### Ollama Bug Memory Summary\n\n${summary}\n`
						console.log(`  ✅ Bug memory summarized`)
					}
				}

				// 5. Summarize feature knowledge
				if (featureKnowledge && featureKnowledge.length > 200) {
					const featurePreview = featureKnowledge.split("\n").slice(0, 20).join("\n")
					console.log(`💡 Summarizing feature knowledge...`)
					const summary = ollamaSummarize(
						featurePreview,
						`You are a feature analyst. Summarize these feature knowledge entries in 2-3 sentences for a developer working on: "${task}". Focus on: relevant feature capabilities and constraints.`,
						ollamaUrl,
					)
					if (summary) {
						ollamaFeatureSummary = `\n### Ollama Feature Knowledge Summary\n\n${summary}\n`
						console.log(`  ✅ Feature knowledge summarized`)
					}
				}

				// 6. Summarize model decisions
				if (modelDecisions && modelDecisions.length > 200) {
					const modelPreview = modelDecisions.split("\n").slice(0, 20).join("\n")
					console.log(`🧠 Summarizing model decisions...`)
					const summary = ollamaSummarize(
						modelPreview,
						`You are a technology analyst. Summarize these model/API decisions in 2-3 sentences for a developer working on: "${task}". Focus on: which models or APIs were chosen and why.`,
						ollamaUrl,
					)
					if (summary) {
						ollamaModelDecisionSummary = `\n### Ollama Model Decision Summary\n\n${summary}\n`
						console.log(`  ✅ Model decisions summarized`)
					}
				}
			} // end else (fastEnough)
		} else {
			console.log("⚠️  Ollama not reachable — skipping summarization (context built from raw files)")
		}
	} else {
		console.log("⏩ --skip-ollama flag set — skipping Ollama summarization")
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
