#!/usr/bin/env node
/**
 * Codex Brain CLI
 *
 * Local multi-agent wrapper for Codex that mirrors the Claude brain workflow:
 * Codex plans/reviews -> Hermes-style local agents gather context -> Ollama
 * coders draft implementation -> Codex applies and verifies -> memory records
 * the reusable lesson.
 *
 * This script is intentionally dependency-free. It stores memory in
 * memory/codex-brain/memory.json and uses local Ollama first, with optional
 * fallback to the Tailscale VPS.
 */

import fs from "node:fs"
import http from "node:http"
import https from "node:https"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")
const BRAIN_DIR = path.join(ROOT, "memory", "codex-brain")
const MEMORY_PATH = path.join(BRAIN_DIR, "memory.json")

const LOCAL_OLLAMA = "http://127.0.0.1:11434"
const VPS_OLLAMA = "http://100.64.175.88:11434"
const OLLAMA_HOSTS = unique([
	process.env.OLLAMA_HOST,
	process.env.OLLAMA_URL,
	LOCAL_OLLAMA,
	VPS_OLLAMA,
].filter(Boolean))

const DEFAULTS = {
	hermesModel: process.env.CODEX_BRAIN_HERMES_MODEL || "hermes3",
	fastCoderModel: process.env.CODEX_BRAIN_FAST_CODER_MODEL || "qwen2.5-coder:7b",
	proCoderModel: process.env.CODEX_BRAIN_PRO_CODER_MODEL || "qwen3:14b",
	fallbackProCoderModel: process.env.CODEX_BRAIN_FALLBACK_PRO_MODEL || "qwen2.5-coder:7b",
	reasoningModel: process.env.CODEX_BRAIN_REASONING_MODEL || "phi4",
	embedModel: process.env.CODEX_BRAIN_EMBED_MODEL || "nomic-embed-text",
}

const SYSTEM_PROMPTS = {
	researcher: `You are Codex Brain's research agent. Find technical facts, summarize relevant evidence, and separate reliable facts from uncertainty.
Output:
1. Key findings
2. Practical recommendations
3. Caveats
4. Sources or memory used`,

	analyst: `You are Codex Brain's project analyst. Analyze tasks against an existing codebase.
Output:
1. Relevant files and modules
2. Existing patterns to follow
3. Risks and edge cases
4. Suggested implementation approach
5. Verification plan`,

	retriever: `You are Codex Brain's memory retriever. Rank prior lessons for the current task.
Output:
1. Most relevant memories
2. Known pitfalls
3. Established patterns
4. Confidence`,

	collector: `You are Codex Brain's context collector. Build a concise pre-coding brief.
Output:
TASK
PROJECT CONTEXT
RELEVANT MEMORY
TECHNICAL REQUIREMENTS
IMPLEMENTATION APPROACH
WARNINGS
VERIFICATION`,

	coder: `You are a local coding agent. Produce clear, minimal, production-grade code.
Rules:
- Follow existing project conventions.
- Prefer simple functions and explicit error handling.
- Avoid broad rewrites unless asked.
- Return code first. Explain only non-obvious choices.`,

	coder_pro: `You are a senior software engineer. Write correct, complete, production-grade code for complex tasks.

## Before Writing Code — Think First
1. Restate what is being asked — list each requirement explicitly
2. Identify every file and function that needs to change
3. Spot edge cases: null inputs, empty arrays, async failures, type mismatches
4. Check integration points — what does this code depend on, and what depends on it
5. Then write the code

## Code Standards
- TypeScript-first: explicit types on every parameter and return value, no \`any\`
- Async/await consistently — never mix with .then() in the same function
- Error handling: wrap all I/O, DB calls, network requests in try/catch with descriptive messages
- Modular: extract repeated or complex logic into named helper functions
- Immutable inputs: never mutate function parameters
- Guard every external boundary: user input, API responses, file reads — validate before use
- Imports: only import what is used, no wildcard imports

## Output Format
- Single file: one fenced code block with \`// FILE: path/to/file\` as first comment
- Multiple files: separate fenced blocks each starting with \`// FILE: path/to/file\`
- Never truncate — complete every function fully
- If the task is large: finish the core logic, then list remaining parts explicitly

## Common Bugs to Prevent
- Missing \`await\` on async calls
- Variable used before it is assigned
- Off-by-one in loops, slice(), and array indexing
- Forgetting to export types needed by other modules
- Not handling the empty array / null case before .find() / [0] / .map()
- Race conditions when multiple awaits share state
- Non-void function that forgets to return a value`,

	coder_verified: `You are a senior software engineer writing code for production. Correctness is the highest priority.

## Thinking Process — Required Before Writing
Work through each step before writing any code:
1. Restate the exact expected behavior in your own words
2. List every file and function that changes
3. For each change: what breaks if this is wrong?
4. Identify all async operations, null cases, and type boundaries
5. Only then write the implementation

## Code Standards
- TypeScript strict: every parameter, local variable, and return value explicitly typed
- Zero \`any\` — use \`unknown\` + type narrowing when the type is truly dynamic
- Every async function wrapped in try/catch with specific, actionable error messages
- No partial implementations — every function complete and correct
- Named exports only — no default exports
- \`const\` by default, \`let\` only when reassignment is genuinely needed
- Guard all external inputs before use

## Output Format
- Each file in its own fenced block: \`// FILE: path/to/file\` as first line
- Complete files — no truncation, no ellipsis, no "rest stays the same"
- After the code: one sentence on what to test first

## Pre-Submit Checklist — Verify Before Responding
- [ ] Every function call has the correct number and type of arguments
- [ ] No variable used before assignment — check initialization order
- [ ] Async/await used consistently — no mixed .then() patterns
- [ ] All imports refer to things that exist and are spelled correctly
- [ ] All brackets, parentheses, and braces match
- [ ] No accidental mutation of inputs or shared state
- [ ] Edge cases handled: empty array, null response, network failure`,

	reviewer: `You are a local code review agent for Codex. Prioritize concrete bugs, security issues, regressions, missing tests, and unclear behavior.
Output findings first, with severity and file/function references when available.`,
}

function unique(values) {
	return [...new Set(values)]
}

function ensureBrainDir() {
	fs.mkdirSync(BRAIN_DIR, { recursive: true })
}

function loadMemory() {
	ensureBrainDir()
	if (!fs.existsSync(MEMORY_PATH)) {
		return { version: 1, entries: [] }
	}
	try {
		const parsed = JSON.parse(fs.readFileSync(MEMORY_PATH, "utf8"))
		if (!Array.isArray(parsed.entries)) {
			return { version: 1, entries: [] }
		}
		return parsed
	} catch {
		return { version: 1, entries: [] }
	}
}

function saveMemory(db) {
	ensureBrainDir()
	const tmp = `${MEMORY_PATH}.${process.pid}.tmp`
	fs.writeFileSync(tmp, JSON.stringify(db, null, 2), "utf8")
	fs.renameSync(tmp, MEMORY_PATH)
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withMemoryLock(fn) {
	ensureBrainDir()
	const lockPath = path.join(BRAIN_DIR, ".memory.lock")
	const started = Date.now()
	while (true) {
		try {
			const fd = fs.openSync(lockPath, "wx")
			try {
				fs.writeFileSync(fd, String(process.pid))
				return await fn()
			} finally {
				fs.closeSync(fd)
				try {
					fs.unlinkSync(lockPath)
				} catch {
					// Another process may have cleaned up a stale lock.
				}
			}
		} catch (error) {
			if (error.code !== "EEXIST") throw error
			if (Date.now() - started > 30000) {
				throw new Error("Timed out waiting for Codex Brain memory lock")
			}
			await sleep(50)
		}
	}
}

function printHelp() {
	console.log(`Codex Brain CLI

Usage:
  node scripts/codex-brain.mjs <command> [args] [options]

Status:
  status
  warmup

Memory:
  remember <content> [--collection code] [--tags tag1,tag2]
  recall <query> [--collection code] [--limit 5]
  list [--collection code]
  collections
  seed-lessons [--limit 80] [--all]

Agents:
  retrieve <task> [--collection code] [--limit 8]
  collect <task> [--code-context "..."] [--research-topic "..."] [--no-web]
  research <topic>
  analyze <task> [--code-context "..."]
  ask <prompt>
  review <code-or-path> [--context "..."]

Coders:
  smart <prompt> [--context "..."]          ← ML-guided routing (auto-picks tool)
  code <prompt> [--context "..."]
  code-pro <prompt> [--context "..."]
  code-verified <prompt> [--context "..."] [--retries 3]
  code-with-memory <prompt> [--collection code] [--limit 5] [--fast]

Examples:
  node scripts/codex-brain.mjs status
  node scripts/codex-brain.mjs retrieve "fix webview blank panel"
  node scripts/codex-brain.mjs collect "add codex task memory route"
  node scripts/codex-brain.mjs code-pro "write a TypeScript helper" --context "..."
  node scripts/codex-brain.mjs remember "Lesson text" --collection code --tags codex,ollama
`)
}

function parseArgs(argv) {
	const positional = []
	const named = {}
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]
		if (arg.startsWith("--")) {
			const key = arg.slice(2)
			const next = argv[i + 1]
			if (next !== undefined && !next.startsWith("--")) {
				named[key] = next
				i++
			} else {
				named[key] = true
			}
		} else {
			positional.push(arg)
		}
	}
	return { positional, named }
}

async function httpJson(url, body = null, timeoutMs = 120000) {
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), timeoutMs)
	try {
		const response = await fetch(url, {
			method: body ? "POST" : "GET",
			headers: body ? { "Content-Type": "application/json" } : undefined,
			body: body ? JSON.stringify(body) : undefined,
			signal: controller.signal,
		})
		const text = await response.text()
		let data = null
		try {
			data = text ? JSON.parse(text) : null
		} catch {
			data = { text }
		}
		if (!response.ok) {
			throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 200)}`)
		}
		return data
	} finally {
		clearTimeout(timer)
	}
}

async function findOllamaHost() {
	for (const host of OLLAMA_HOSTS) {
		try {
			const data = await httpJson(`${host}/api/tags`, null, 5000)
			if (Array.isArray(data?.models)) {
				return { host, models: data.models.map((m) => m.name) }
			}
		} catch {
			// Try the next configured endpoint.
		}
	}
	return { host: OLLAMA_HOSTS[0], models: [], error: "No Ollama endpoint responded" }
}

async function ollamaChat({ model, messages, system, prompt, temperature = 0.2, numCtx = 8192 }) {
	const { host } = await findOllamaHost()
	const finalMessages = messages || [
		...(system ? [{ role: "system", content: system }] : []),
		{ role: "user", content: prompt },
	]
	const data = await httpJson(`${host}/api/chat`, {
		model,
		stream: false,
		keep_alive: "24h",
		options: { temperature, num_ctx: numCtx },
		messages: finalMessages,
	})
	return data?.message?.content?.trim() || ""
}

async function ollamaEmbed(text) {
	const { host } = await findOllamaHost()
	const input = String(text).slice(0, 8000)
	try {
		const data = await httpJson(`${host}/api/embed`, {
			model: DEFAULTS.embedModel,
			input,
		})
		const embedding = data?.embeddings?.[0] || data?.embedding
		if (Array.isArray(embedding)) return embedding
	} catch {
		// Fall through to legacy endpoint.
	}
	const data = await httpJson(`${host}/api/embeddings`, {
		model: DEFAULTS.embedModel,
		prompt: input,
	})
	if (!Array.isArray(data?.embedding)) {
		throw new Error("Ollama did not return an embedding")
	}
	return data.embedding
}

function tokenize(text) {
	return String(text)
		.toLowerCase()
		.replace(/[^\w\s]/g, " ")
		.split(/\s+/)
		.filter((token) => token.length > 1)
}

function cosineSimilarity(a, b) {
	if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0
	let dot = 0
	let magA = 0
	let magB = 0
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i]
		magA += a[i] * a[i]
		magB += b[i] * b[i]
	}
	return dot / (Math.sqrt(magA) * Math.sqrt(magB) + 1e-10)
}

function bm25Scores(query, entries) {
	const queryTokens = tokenize(query)
	if (!entries.length || !queryTokens.length) return entries.map(() => 0)

	const tokenized = entries.map((entry) => tokenize(entry.content))
	const avgdl = tokenized.reduce((sum, tokens) => sum + tokens.length, 0) / entries.length || 1
	const df = {}
	for (const tokens of tokenized) {
		for (const token of new Set(tokens)) {
			df[token] = (df[token] || 0) + 1
		}
	}

	const k1 = 1.5
	const b = 0.75
	return tokenized.map((tokens) => {
		const tf = {}
		for (const token of tokens) tf[token] = (tf[token] || 0) + 1
		let score = 0
		for (const term of queryTokens) {
			if (!tf[term]) continue
			const termDf = df[term] || 0
			const idf = Math.log((entries.length - termDf + 0.5) / (termDf + 0.5) + 1)
			score += idf * (tf[term] * (k1 + 1)) / (tf[term] + k1 * (1 - b + (b * tokens.length) / avgdl))
		}
		return score
	})
}

function rrfCombine(vectorScores, keywordScores, entries, limit) {
	const k = 60
	const orderBy = (scores) => [...entries.keys()].sort((a, b) => scores[b] - scores[a])
	const vectorOrder = orderBy(vectorScores)
	const keywordOrder = orderBy(keywordScores)
	const vectorRank = new Array(entries.length)
	const keywordRank = new Array(entries.length)
	vectorOrder.forEach((index, rank) => {
		vectorRank[index] = rank
	})
	keywordOrder.forEach((index, rank) => {
		keywordRank[index] = rank
	})
	return entries
		.map((entry, index) => ({
			...entry,
			score: 1 / (k + vectorRank[index]) + 1 / (k + keywordRank[index]),
		}))
		.sort((a, b) => b.score - a.score)
		.slice(0, limit)
}

async function remember(content, collection = "general", metadata = {}) {
	const embedding = await ollamaEmbed(content)
	const id = `codex-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
	const entry = {
		id,
		content,
		collection,
		metadata,
		embedding,
		createdAt: new Date().toISOString(),
	}
	await withMemoryLock(async () => {
		const db = loadMemory()
		db.entries.push(entry)
		saveMemory(db)
	})
	return id
}

async function recall(query, collection = null, limit = 5) {
	const db = loadMemory()
	const entries = collection ? db.entries.filter((entry) => entry.collection === collection) : db.entries
	if (!entries.length) return []
	const queryEmbedding = await ollamaEmbed(query)
	const vectorScores = entries.map((entry) => cosineSimilarity(queryEmbedding, entry.embedding))
	const keywordScores = bm25Scores(query, entries)
	return rrfCombine(vectorScores, keywordScores, entries, limit).map(({ embedding, ...entry }) => entry)
}

function listMemories(collection = null) {
	const db = loadMemory()
	const entries = collection ? db.entries.filter((entry) => entry.collection === collection) : db.entries
	return entries.map((entry) => ({
		id: entry.id,
		collection: entry.collection,
		content: entry.content.length > 160 ? `${entry.content.slice(0, 160)}...` : entry.content,
		metadata: entry.metadata || {},
		createdAt: entry.createdAt,
	}))
}

function listCollections() {
	const db = loadMemory()
	const counts = {}
	for (const entry of db.entries) {
		counts[entry.collection] = (counts[entry.collection] || 0) + 1
	}
	return Object.entries(counts).map(([name, count]) => ({ name, count }))
}

async function webSearch(query, limit = 5) {
	const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1&no_redirect=1`
	const data = await httpJson(url, null, 10000)
	const results = []
	if (data.AbstractText) {
		results.push({
			title: data.Heading || query,
			snippet: data.AbstractText,
			url: data.AbstractURL || "",
			source: data.AbstractSource || "DuckDuckGo",
		})
	}
	for (const topic of data.RelatedTopics || []) {
		if (results.length >= limit) break
		if (topic.Text && topic.FirstURL) {
			results.push({
				title: topic.Text.slice(0, 100),
				snippet: topic.Text.slice(0, 400),
				url: topic.FirstURL,
				source: "DuckDuckGo",
			})
		}
	}
	return results.slice(0, limit)
}

function httpText(url, timeoutMs = 10000) {
	return new Promise((resolve, reject) => {
		const lib = url.startsWith("https") ? https : http
		const req = lib.get(url, { headers: { "User-Agent": "Codex-Brain/1.0" } }, (res) => {
			let body = ""
			res.on("data", (chunk) => {
				body += chunk
			})
			res.on("end", () => {
				if (res.statusCode < 200 || res.statusCode >= 300) {
					reject(new Error(`HTTP ${res.statusCode}`))
					return
				}
				resolve(body)
			})
		})
		req.on("error", reject)
		req.setTimeout(timeoutMs, () => {
			req.destroy()
			reject(new Error("Request timeout"))
		})
	})
}

async function fetchPage(url, maxChars = 4000) {
	const body = await httpText(url)
	return body
		.replace(/<script[\s\S]*?<\/script>/gi, " ")
		.replace(/<style[\s\S]*?<\/style>/gi, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, maxChars)
}

function formatMemories(memories) {
	if (!memories.length) return "No relevant memories found."
	return memories
		.map((memory, index) => `[${index + 1}] (${memory.collection}, ${memory.score.toFixed(3)}) ${memory.content}`)
		.join("\n\n")
}

async function runAgent(agent, prompt, options = {}) {
	const system = SYSTEM_PROMPTS[agent] || SYSTEM_PROMPTS.analyst
	return ollamaChat({
		model: options.model || DEFAULTS.hermesModel,
		system,
		prompt,
		temperature: options.temperature ?? 0.2,
		numCtx: options.numCtx || 8192,
	})
}

async function retrieveContext(task, collection, limit) {
	const memories = await recall(task, collection || null, limit)
	if (!memories.length) return "No relevant memories found."
	return runAgent(
		"retriever",
		`Current task:\n${task}\n\nCandidate memories:\n${formatMemories(memories)}`,
		{ temperature: 0.1 },
	)
}

async function collectContext(task, opts) {
	const memories = await recall(task, opts.collection || "code", opts.memoryLimit || 6)
	const parts = [`Task:\n${task}`]
	if (opts.codeContext) parts.push(`Code context:\n${opts.codeContext.slice(0, 6000)}`)
	if (opts.doWeb) {
		try {
			const results = await webSearch(opts.researchTopic || task, 4)
			if (results.length) {
				parts.push(
					`Web research:\n${results
						.map((result, index) => `[${index + 1}] ${result.title}\n${result.snippet}\n${result.url}`)
						.join("\n\n")}`,
				)
			}
		} catch (error) {
			parts.push(`Web research unavailable: ${error.message}`)
		}
	}
	parts.push(`Relevant memory:\n${formatMemories(memories)}`)
	return runAgent("collector", parts.join("\n\n---\n\n"), { numCtx: 16384 })
}

async function coder(prompt, opts = {}) {
	const context = opts.context ? `Context:\n${opts.context}\n\n---\n\n` : ""
	const model = opts.model || DEFAULTS.fastCoderModel
	const isPro = model.includes("14b") || model.includes("32b") || model.includes("pro")
	const system = opts.system || (isPro ? SYSTEM_PROMPTS.coder_pro : SYSTEM_PROMPTS.coder)
	return ollamaChat({
		model,
		system,
		prompt: `${context}${prompt}`,
		temperature: 0.1,
		numCtx: 16384,
	})
}

function extractLargestCodeBlock(text) {
	const matches = [...String(text).matchAll(/```(?:javascript|typescript|js|ts|jsx|tsx|mjs|cjs)?\n?([\s\S]*?)```/g)]
	if (!matches.length) return null
	return matches.reduce((longest, current) => (current[1].length > longest[1].length ? current : longest))[1]
}

function syntaxCheckJavaScript(code) {
	const tmpFile = path.join(os.tmpdir(), `codex_brain_check_${Date.now()}.mjs`)
	try {
		fs.writeFileSync(tmpFile, code, "utf8")
		const result = spawnSync(process.execPath, ["--check", tmpFile], {
			timeout: 10000,
			encoding: "utf8",
		})
		return {
			ok: result.status === 0,
			error: (result.stderr || "").replaceAll(tmpFile, "<code>").trim(),
		}
	} finally {
		try {
			fs.unlinkSync(tmpFile)
		} catch {
			// Best effort cleanup.
		}
	}
}

function smartRoute(prompt, contextStr = "") {
	const text = (prompt + " " + contextStr).toLowerCase()
	const fileCount = (text.match(/\.(ts|tsx|js|jsx|mjs|py|go|rs)\b/g) || []).length
	const complexKw = ["refactor", "architecture", "migration", "redesign", "multi-file",
		"integration", "module", "service", "pipeline", "system", "implement"]
	const criticalKw = ["production", "critical", "security", "auth", "payment", "deploy",
		"database", "schema", "race condition", "memory leak"]
	const complexScore = complexKw.filter((k) => text.includes(k)).length
	const criticalScore = criticalKw.filter((k) => text.includes(k)).length
	const lineCount = prompt.split("\n").length

	if (criticalScore > 0) return { tool: "code_pro_verified", reason: "critical/production keywords", confidence: 0.85 }
	if (fileCount > 2 || complexScore > 1 || lineCount > 30)
		return { tool: "code_pro", reason: "multi-file or complex task", confidence: 0.75 }
	return { tool: "code", reason: "simple task", confidence: 0.80 }
}

async function codeVerified(prompt, opts = {}) {
	let currentPrompt = prompt
	let lastResponse = ""
	const retries = opts.retries || 3
	for (let attempt = 1; attempt <= retries; attempt++) {
		lastResponse = await coder(currentPrompt, {
			...opts,
			model: opts.model || DEFAULTS.proCoderModel,
			system: attempt === 1 ? SYSTEM_PROMPTS.coder_verified : SYSTEM_PROMPTS.coder_pro,
		})
		const code = extractLargestCodeBlock(lastResponse)
		if (!code) return lastResponse
		const check = syntaxCheckJavaScript(code)
		if (check.ok) return lastResponse
		if (attempt < retries) {
			currentPrompt = `The previous code has a JavaScript/TypeScript syntax error. Fix it and return the corrected code block only.

Error:
${check.error}

Broken code:
\`\`\`
${code}
\`\`\`

Original task:
${prompt}`
		}
	}
	return lastResponse
}

async function seedLessons({ limit = 80, all = false } = {}) {
	const lessonPath = path.join(ROOT, "memory", "lesson-index.jsonl")
	if (!fs.existsSync(lessonPath)) {
		throw new Error("memory/lesson-index.jsonl not found")
	}
	const lines = fs.readFileSync(lessonPath, "utf8").split(/\r?\n/).filter(Boolean)
	const selected = all ? lines : lines.slice(-limit)
	const db = loadMemory()
	const existingLessonIds = new Set(
		db.entries
			.map((entry) => entry.metadata?.lessonId)
			.filter((lessonId) => typeof lessonId === "string" && lessonId.length > 0),
	)
	let seeded = 0
	let skipped = 0
	for (const line of selected) {
		let lesson
		try {
			lesson = JSON.parse(line)
		} catch {
			continue
		}
		if (!lesson.id || existingLessonIds.has(lesson.id)) {
			skipped++
			continue
		}
		const content = [
			lesson.title,
			lesson.rule_summary ? `Rule: ${lesson.rule_summary}` : "",
			lesson.lesson_summary ? `Lesson: ${lesson.lesson_summary}` : "",
			lesson.files?.length ? `Files: ${lesson.files.join(", ")}` : "",
			lesson.tags?.length ? `Tags: ${lesson.tags.join(", ")}` : "",
		]
			.filter(Boolean)
			.join("\n")
		await remember(content, "code", {
			source: "superroo-lesson-index",
			lessonId: lesson.id,
			tags: lesson.tags || [],
		})
		existingLessonIds.add(lesson.id)
		seeded++
	}
	return { selected: selected.length, seeded, skipped }
}

function readArgOrFile(value) {
	if (!value) return ""
	const full = path.resolve(process.cwd(), value)
	if (fs.existsSync(full) && fs.statSync(full).isFile()) {
		return fs.readFileSync(full, "utf8")
	}
	return value
}

async function main() {
	const [command, ...rest] = process.argv.slice(2)
	const args = parseArgs(rest)

	if (!command || command === "--help" || command === "-h" || command === "help") {
		printHelp()
		return
	}

	const first = args.positional[0]
	const collection = args.named.collection || null
	const limit = Number.parseInt(args.named.limit || "5", 10)

	switch (command) {
		case "status": {
			const status = await findOllamaHost()
			const collections = listCollections()
			console.log(
				JSON.stringify(
					{
						status: status.error ? "unreachable" : "healthy",
						ollamaHost: status.host,
						models: status.models,
						required: DEFAULTS,
						memoryPath: MEMORY_PATH,
						totalMemories: loadMemory().entries.length,
						collections,
					},
					null,
					2,
				),
			)
			break
		}
		case "warmup": {
			const models = unique([DEFAULTS.hermesModel, DEFAULTS.fastCoderModel, DEFAULTS.proCoderModel])
			const results = []
			for (const model of models) {
				try {
					await ollamaChat({ model, prompt: "hi", temperature: 0, numCtx: 512 })
					results.push(`${model}: warmed`)
				} catch (error) {
					results.push(`${model}: ${error.message}`)
				}
			}
			try {
				await ollamaEmbed("codex brain warmup")
				results.push(`${DEFAULTS.embedModel}: warmed`)
			} catch (error) {
				results.push(`${DEFAULTS.embedModel}: ${error.message}`)
			}
			console.log(results.join("\n"))
			break
		}
		case "remember": {
			const content = first
			if (!content) throw new Error("remember requires content")
			const tags = String(args.named.tags || "")
				.split(",")
				.map((tag) => tag.trim())
				.filter(Boolean)
			const id = await remember(content, collection || "general", { tags, source: "codex-brain-cli" })
			console.log(`Stored ${id}`)
			break
		}
		case "recall": {
			if (!first) throw new Error("recall requires a query")
			const results = await recall(first, collection, limit)
			console.log(formatMemories(results))
			break
		}
		case "list": {
			console.log(JSON.stringify(listMemories(collection), null, 2))
			break
		}
		case "collections": {
			console.log(JSON.stringify(listCollections(), null, 2))
			break
		}
		case "seed-lessons": {
			const result = await seedLessons({
				limit: Number.parseInt(args.named.limit || "80", 10),
				all: args.named.all === true,
			})
			console.log(
				`Seeded ${result.seeded} lessons into Codex brain memory (${result.skipped} already present, ${result.selected} selected)`,
			)
			break
		}
		case "retrieve": {
			if (!first) throw new Error("retrieve requires a task")
			console.log(await retrieveContext(first, collection, limit || 8))
			break
		}
		case "collect": {
			if (!first) throw new Error("collect requires a task")
			console.log(
				await collectContext(first, {
					collection,
					memoryLimit: limit || 6,
					codeContext: args.named["code-context"] || "",
					researchTopic: args.named["research-topic"] || "",
					doWeb: args.named.web !== false && args.named["no-web"] !== true,
				}),
			)
			break
		}
		case "research": {
			if (!first) throw new Error("research requires a topic")
			const memories = await recall(first, collection, Math.min(limit || 4, 8))
			let searchText = "No web results."
			try {
				const results = await webSearch(first, 5)
				if (results.length) {
					searchText = results.map((result, index) => `[${index + 1}] ${result.title}\n${result.snippet}\n${result.url}`).join("\n\n")
				}
			} catch (error) {
				searchText = `Web search failed: ${error.message}`
			}
			console.log(await runAgent("researcher", `Topic:\n${first}\n\nWeb:\n${searchText}\n\nMemory:\n${formatMemories(memories)}`))
			break
		}
		case "fetch-page": {
			if (!first) throw new Error("fetch-page requires a URL")
			console.log(await fetchPage(first, Number.parseInt(args.named["max-chars"] || "4000", 10)))
			break
		}
		case "analyze": {
			if (!first) throw new Error("analyze requires a task")
			const memories = await recall(first, collection || "code", limit || 5)
			console.log(
				await runAgent(
					"analyst",
					`Task:\n${first}\n\nCode context:\n${args.named["code-context"] || ""}\n\nMemory:\n${formatMemories(memories)}`,
				),
			)
			break
		}
		case "ask": {
			if (!first) throw new Error("ask requires a prompt")
			console.log(await runAgent("analyst", first))
			break
		}
		case "review": {
			const code = readArgOrFile(first)
			if (!code) throw new Error("review requires code text or a file path")
			console.log(await runAgent("reviewer", `Context:\n${args.named.context || ""}\n\nCode:\n${code}`, { model: DEFAULTS.hermesModel }))
			break
		}
		case "code": {
			if (!first) throw new Error("code requires a prompt")
			console.log(await coder(first, { context: args.named.context || "", model: DEFAULTS.fastCoderModel }))
			break
		}
		case "code-pro": {
			if (!first) throw new Error("code-pro requires a prompt")
			const status = await findOllamaHost()
			const model = status.models.some((name) => name === DEFAULTS.proCoderModel || name.startsWith(`${DEFAULTS.proCoderModel}:`))
				? DEFAULTS.proCoderModel
				: DEFAULTS.fallbackProCoderModel
			console.log(await coder(first, { context: args.named.context || "", model }))
			break
		}
		case "code-verified": {
			if (!first) throw new Error("code-verified requires a prompt")
			console.log(
				await codeVerified(first, {
					context: args.named.context || "",
					retries: Number.parseInt(args.named.retries || "3", 10),
				}),
			)
			break
		}
		case "code-with-memory": {
			if (!first) throw new Error("code-with-memory requires a prompt")
			const memories = await recall(first, collection || "code", limit || 5)
			const model = args.named.fast ? DEFAULTS.fastCoderModel : DEFAULTS.proCoderModel
			console.log(await coder(first, { context: formatMemories(memories), model }))
			break
		}
		case "smart": {
			if (!first) throw new Error("smart requires a prompt")
			const { tool: routedTool, reason, confidence } = smartRoute(first, args.named.context || "")
			process.stderr.write(`[smart] → ${routedTool} (${reason}, confidence=${confidence?.toFixed(2) ?? "n/a"})\n`)
			if (routedTool === "code_pro_verified") {
				console.log(await codeVerified(first, { context: args.named.context || "" }))
			} else if (routedTool === "code_pro") {
				const status = await findOllamaHost()
				const model = status.models.some((n) => n === DEFAULTS.proCoderModel || n.startsWith(`${DEFAULTS.proCoderModel}:`))
					? DEFAULTS.proCoderModel : DEFAULTS.fallbackProCoderModel
				console.log(await coder(first, { context: args.named.context || "", model }))
			} else {
				console.log(await coder(first, { context: args.named.context || "", model: DEFAULTS.fastCoderModel }))
			}
			break
		}
		default:
			throw new Error(`Unknown command: ${command}`)
	}
}

main().catch((error) => {
	console.error(`Error: ${error.message}`)
	process.exit(1)
})
