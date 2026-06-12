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
 * ~/.superroo/memory/codex-brain/memory.json by default and uses local Ollama first, with optional
 * fallback to the Tailscale VPS.
 */

import fs from "node:fs"
import http from "node:http"
import https from "node:https"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { assessRisk, formatRiskAssessment, recordRiskPattern, riskStats } from "./shared-risk-engine.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// PROJECT_ROOT env var makes this CLI portable across projects
const ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, "..")
const SUPERROO_HOME = process.env.SUPERROO_HOME || path.join(os.homedir(), ".superroo")
const GLOBAL_MEMORY_DIR = process.env.SUPERROO_MEMORY_DIR || path.join(SUPERROO_HOME, "memory")
const BRAIN_DIR = process.env.CODEX_BRAIN_MEMORY_DIR || path.join(GLOBAL_MEMORY_DIR, "codex-brain")
const MEMORY_PATH = path.join(BRAIN_DIR, "memory.json")
const PROJECT_ID = process.env.PROJECT_ID || path.basename(ROOT)

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

function firstExistingPath(paths) {
	return paths.find((candidate) => candidate && fs.existsSync(candidate))
}

function migrateRepoMemoryIfNeeded() {
	const repoMemoryPath = path.join(ROOT, "memory", "codex-brain", "memory.json")
	if (MEMORY_PATH === repoMemoryPath || fs.existsSync(MEMORY_PATH) || !fs.existsSync(repoMemoryPath)) {
		return
	}
	ensureBrainDir()
	fs.copyFileSync(repoMemoryPath, MEMORY_PATH)
}

function loadMemory() {
	ensureBrainDir()
	migrateRepoMemoryIfNeeded()
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

Predictive Risk:
  risk-assess <task> [--action deploy] [--files a,b] [--logs "..."] [--commands "..."] [--no-persist]
  risk-record-pattern <signature> --description "..." [--severity high] [--pattern-type deploy]
  risk-stats [--project superroo2]

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

function csvList(value) {
	if (!value) return []
	return String(value)
		.split(/[\n,]/)
		.map((item) => item.trim())
		.filter(Boolean)
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

// ── Embedding Cache (7-day TTL, file-based) ──────────────────────────────────

const EMBED_CACHE_PATH = path.join(GLOBAL_MEMORY_DIR, "embed-cache.json")

function embedCacheLoad() {
	try { return JSON.parse(fs.readFileSync(EMBED_CACHE_PATH, "utf8")) }
	catch { return {} }
}

function embedCacheKey(text) {
	// Simple djb2 hash for cache key
	let h = 5381
	for (let i = 0; i < Math.min(text.length, 2000); i++) h = ((h << 5) + h) ^ text.charCodeAt(i)
	return (h >>> 0).toString(36)
}

let _embedCache = null
function getEmbedCache() { if (!_embedCache) _embedCache = embedCacheLoad(); return _embedCache }
function saveEmbedCache(cache) {
	try { fs.writeFileSync(EMBED_CACHE_PATH, JSON.stringify(cache), "utf8") } catch {}
}

async function ollamaEmbed(text) {
	const input = String(text).slice(0, 8000)
	const cacheKey = embedCacheKey(input)
	const cache = getEmbedCache()

	// Check cache (7-day TTL)
	if (cache[cacheKey]) {
		const { embedding, createdAt } = cache[cacheKey]
		const ageDays = (Date.now() - new Date(createdAt).getTime()) / 86400000
		if (ageDays < 7 && Array.isArray(embedding)) return embedding
		delete cache[cacheKey]
	}

	const { host } = await findOllamaHost()
	let embedding = null
	try {
		const data = await httpJson(`${host}/api/embed`, { model: DEFAULTS.embedModel, input })
		embedding = data?.embeddings?.[0] || data?.embedding
	} catch {}
	if (!Array.isArray(embedding)) {
		const data = await httpJson(`${host}/api/embeddings`, { model: DEFAULTS.embedModel, prompt: input })
		if (!Array.isArray(data?.embedding)) throw new Error("Ollama did not return an embedding")
		embedding = data.embedding
	}

	// Cache the result
	cache[cacheKey] = { embedding, createdAt: new Date().toISOString() }
	// Prune cache > 2000 entries (keep newest)
	const keys = Object.keys(cache)
	if (keys.length > 2000) {
		keys.sort((a, b) => (cache[a].createdAt || "").localeCompare(cache[b].createdAt || ""))
		keys.slice(0, keys.length - 2000).forEach(k => delete cache[k])
	}
	saveEmbedCache(cache)
	return embedding
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

// Helpfulness ledger cache — loaded once per process
let _helpfulnessCache = null
function getHelpfulnessLedger() {
	if (_helpfulnessCache) return _helpfulnessCache
	const ledgerPath = path.join(GLOBAL_MEMORY_DIR, "lesson-helpfulness.jsonl")
	const ledger = {}
	try {
		fs.readFileSync(ledgerPath, "utf8").trim().split("\n").filter(Boolean).forEach(l => {
			try {
				const e = JSON.parse(l)
				if (!ledger[e.lesson_id]) ledger[e.lesson_id] = { sum: 0, count: 0 }
				ledger[e.lesson_id].sum += e.helpful
				ledger[e.lesson_id].count++
			} catch {}
		})
	} catch {}
	_helpfulnessCache = ledger
	return ledger
}

function confidenceWeight(entry) {
	// 1. Confidence score from metadata
	const conf = entry.confidence || entry.metadata?.confidence || "medium"
	const confW = conf === "high" ? 1.0 : conf === "medium" ? 0.85 : 0.6

	// 2. Recency decay: lessons degrade after 90 days, floor at 0.4 after 365 days
	const created = entry.createdAt || entry.date || null
	let decayW = 1.0
	if (created) {
		const ageDays = (Date.now() - new Date(created).getTime()) / 86400000
		if (ageDays > 90) decayW = Math.max(0.4, 1 - (ageDays - 90) / 365)
	}

	// 3. Helpfulness ledger boost/penalty (from rate_lesson feedback)
	const ledger = getHelpfulnessLedger()
	const rating = ledger[entry.id]
	let helpfulW = 1.0
	if (rating && rating.count >= 2) {
		const avg = rating.sum / rating.count
		// avg=1.0 (all helpful) → 1.2 boost; avg=0 (all unhelpful) → 0.3 penalty
		helpfulW = 0.3 + avg * 0.9
	}

	return confW * decayW * helpfulW
}

function cosineSim(a, b) {
	if (!a || !b || a.length !== b.length) return 0
	let dot = 0, ma = 0, mb = 0
	for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; ma += a[i]*a[i]; mb += b[i]*b[i] }
	return dot / (Math.sqrt(ma) * Math.sqrt(mb) + 1e-10)
}

function rrfCombine(vectorScores, keywordScores, entries, limit) {
	const k = 60
	const orderBy = (scores) => [...entries.keys()].sort((a, b) => scores[b] - scores[a])
	const vectorOrder = orderBy(vectorScores)
	const keywordOrder = orderBy(keywordScores)
	const vectorRank = new Array(entries.length)
	const keywordRank = new Array(entries.length)
	vectorOrder.forEach((index, rank) => { vectorRank[index] = rank })
	keywordOrder.forEach((index, rank) => { keywordRank[index] = rank })
	return entries
		.map((entry, index) => ({
			...entry,
			score: (1 / (k + vectorRank[index]) + 1 / (k + keywordRank[index])) * confidenceWeight(entry),
		}))
		.sort((a, b) => b.score - a.score)
		.slice(0, limit)
}

async function remember(content, collection = "general", metadata = {}) {
	const embedding = await ollamaEmbed(content)

	// Semantic dedup: skip if a very similar entry already exists (cosine > 0.88)
	if (embedding) {
		const db = loadMemory()
		const sameCollection = db.entries.filter(e => e.collection === collection && e.embedding)
		const duplicate = sameCollection.find(e => cosineSim(e.embedding, embedding) > 0.88)
		if (duplicate) {
			process.stderr.write(`[remember] Skipping duplicate (similar to ${duplicate.id}, sim>${0.88})\n`)
			return duplicate.id
		}
	}

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
	let memories = await recall(task, collection || null, limit)
	if (!memories.length) return "No relevant memories found."

	// Helpfulness-weighted re-ranking from lesson ledger
	try {
		const ledgerPath = path.join(GLOBAL_MEMORY_DIR, "lesson-helpfulness.jsonl")
		if (fs.existsSync(ledgerPath)) {
			const ledger = {}
			fs.readFileSync(ledgerPath, "utf8").trim().split("\n").filter(Boolean).forEach(l => {
				try { const e = JSON.parse(l); if (!ledger[e.lesson_id]) ledger[e.lesson_id] = {sum:0,count:0}; ledger[e.lesson_id].sum+=e.helpful; ledger[e.lesson_id].count++ } catch {}
			})
			memories = memories.map(m => {
				const r = ledger[m.id]
				return r && r.count >= 2 ? { ...m, score: (m.score||1)*(0.4+0.6*(r.sum/r.count)) } : m
			}).sort((a,b) => (b.score||0)-(a.score||0))
		}
	} catch {}

	// Cross-project tagging: mark lessons from other projects as battle-tested
	const currentProject = process.env.PROJECT_ID || path.basename(ROOT)
	memories = memories.map(m => {
		const lp = m.project || m.metadata?.project
		return lp && lp !== currentProject ? {...m, cross_project: true, cross_project_source: lp} : m
	})
	const crossCount = memories.filter(m => m.cross_project).length
	const prefix = crossCount > 0 ? `[${crossCount} cross-project battle-tested lesson${crossCount>1?"s":""} included]\n\n` : ""

	// Persist the retrieved lesson ids (per agent) so record_outcome can
	// auto-rate them — task success is the helpfulness proxy. Also expose the
	// ids in the output so callers CAN use rate_lesson explicitly.
	const retrievedIds = memories.map(m => m.id).filter(Boolean)
	try {
		const agentId = process.env.AGENT_ID || currentProject
		fs.writeFileSync(
			path.join(GLOBAL_MEMORY_DIR, `last-retrieval-${agentId}.json`),
			JSON.stringify({ task, agent: agentId, ids: retrievedIds, timestamp: new Date().toISOString() }),
			"utf8",
		)
	} catch {}
	const idFooter = retrievedIds.length
		? `\n\n[retrieved-lesson-ids: ${retrievedIds.join(", ")}] — auto-rated on record_outcome; override with rate_lesson(lesson_id, helpful)`
		: ""

	return prefix + await runAgent(
		"retriever",
		`Current task:\n${task}\n\nCandidate memories:\n${formatMemories(memories)}`,
		{ temperature: 0.1 },
	) + idFooter
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

function extractFeaturesFromText(text, prompt) {
	const lower = (text + " " + prompt).toLowerCase()
	const fileCount = (lower.match(/\.(ts|tsx|js|jsx|mjs|py|go|rs|css|json|md)\b/g) || []).length
	const complexKw = ["refactor", "architecture", "migration", "redesign", "multi-file",
		"integration", "module", "service", "pipeline", "system", "implement", "feature", "add"]
	const criticalKw = ["production", "critical", "security", "auth", "payment", "deploy",
		"database", "schema", "race condition", "memory leak", "breaking", "urgent"]
	const complexScore = complexKw.filter(k => lower.includes(k)).length
	const criticalScore = criticalKw.filter(k => lower.includes(k)).length
	const lineCount = prompt.split("\n").length
	const hasCodeBlock = (lower.match(/```/g) || []).length / 2
	const wordCount = lower.split(/\s+/).length
	const avgWordLen = lower.replace(/\s+/g, "").length / Math.max(wordCount, 1)
	return [
		Math.min(fileCount / 5, 1),            // file count (normalized)
		Math.min(lineCount / 50, 1),           // line count
		Math.min(complexScore / 4, 1),         // complexity keywords
		criticalScore > 0 ? 1 : 0,            // critical flag
		Math.min(wordCount / 200, 1),          // prompt length
		Math.min(hasCodeBlock / 3, 1),         // code blocks
		Math.min(avgWordLen / 8, 1),           // technical vocabulary density
		0.5,                                    // neutral bias feature
	]
}

function smartRoute(prompt, contextStr = "") {
	const text = (prompt + " " + contextStr).toLowerCase()
	const features = extractFeaturesFromText(text, prompt)
	const criticalScore = features[3]  // direct critical flag
	const risk = assessRisk({
		projectId: PROJECT_ID,
		task: prompt,
		prompt,
		context: contextStr,
		source: "codex-brain-smart",
		persist: false,
	})
	const riskOrder = { code: 0, code_pro: 1, code_pro_verified: 2 }
	const applyRisk = (route) => {
		const riskTool = risk.routeHint || "code"
		if (riskOrder[riskTool] > riskOrder[route.tool]) {
			return {
				...route,
				tool: riskTool,
				reason: `${route.reason}; risk=${risk.riskLevel} ${risk.riskScore.toFixed(2)}`,
				risk,
			}
		}
		return { ...route, risk }
	}

	// Try ML model for routing if available
	try {
		const modelPath = path.join(SUPERROO_HOME, "models", "code-learner.json")
		if (fs.existsSync(modelPath)) {
			const model = JSON.parse(fs.readFileSync(modelPath, "utf8"))
			// Simple linear prediction from model weights (encoder layer 1 → quality head)
			const encoder = model.encoder
			if (encoder && encoder.W1 && encoder.W1.length === 8) {
				// Forward pass: features → encoder → quality score
				const W1 = encoder.W1, b1 = encoder.b1 || new Array(W1[0].length).fill(0)
				const hidden = b1.map((bias, j) => {
					let sum = bias
					for (let i = 0; i < features.length; i++) sum += features[i] * (W1[i]?.[j] || 0)
					return Math.max(0, sum)  // ReLU
				})
				// Quality head first dense layer gives complexity signal
				const qHead = model.heads?.quality
				if (qHead && qHead.W1) {
					const qScore = qHead.b1.map((b, j) => {
						let s = b
						for (let i = 0; i < hidden.length && i < qHead.W1.length; i++) s += hidden[i] * (qHead.W1[i]?.[j] || 0)
						return 1 / (1 + Math.exp(-s))  // sigmoid
					})
					const predictedQuality = qScore[0] || 0.5
					// High predicted quality need → use pro model; low → fast is fine
					if (criticalScore > 0 || predictedQuality > 0.8)
						return applyRisk({ tool: "code_pro_verified", reason: "ML: high complexity + critical", confidence: predictedQuality })
					if (predictedQuality > 0.55 || features[0] > 0.4 || features[2] > 0.5)
						return applyRisk({ tool: "code_pro", reason: "ML: medium complexity", confidence: predictedQuality })
					return applyRisk({ tool: "code", reason: "ML: simple task", confidence: 1 - predictedQuality })
				}
			}
		}
	} catch { /* fall through to heuristic */ }

	// Fallback heuristic
	if (criticalScore > 0) return applyRisk({ tool: "code_pro_verified", reason: "critical/production keywords", confidence: 0.85 })
	if (features[0] > 0.4 || features[2] > 0.5 || features[1] > 0.6)
		return applyRisk({ tool: "code_pro", reason: "multi-file or complex task", confidence: 0.75 })
	return applyRisk({ tool: "code", reason: "simple task", confidence: 0.80 })
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
	const lessonPath = firstExistingPath([
		process.env.SUPERROO_LESSON_INDEX,
		path.join(ROOT, "memory", "lesson-index.jsonl"),
		path.join(GLOBAL_MEMORY_DIR, "lesson-index.jsonl"),
	])
	if (!lessonPath || !fs.existsSync(lessonPath)) {
		throw new Error("lesson-index.jsonl not found")
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
		case "risk-assess": {
			if (!first) throw new Error("risk-assess requires a task")
			const assessment = assessRisk({
				projectId: args.named.project || PROJECT_ID,
				task: first,
				prompt: first,
				context: args.named.context || "",
				logs: args.named.logs || "",
				filesChanged: csvList(args.named.files),
				commands: csvList(args.named.commands),
				actionType: args.named.action || args.named["action-type"],
				source: "codex-brain-cli",
				persist: args.named["no-persist"] !== true,
			})
			console.log(formatRiskAssessment(assessment))
			break
		}
		case "risk-record-pattern": {
			if (!first) throw new Error("risk-record-pattern requires a signature")
			if (!args.named.description) throw new Error("risk-record-pattern requires --description")
			const pattern = recordRiskPattern({
				projectId: args.named.project || PROJECT_ID,
				signature: first,
				description: args.named.description,
				severity: args.named.severity || "medium",
				patternType: args.named["pattern-type"] || "general",
				suggestedFix: args.named["suggested-fix"] || "",
				source: "codex-brain-cli",
			})
			console.log(JSON.stringify(pattern, null, 2))
			break
		}
		case "risk-stats": {
			console.log(JSON.stringify(riskStats(args.named.project || null), null, 2))
			break
		}
		case "smart": {
			if (!first) throw new Error("smart requires a prompt")
			const { tool: routedTool, reason, confidence, risk } = smartRoute(first, args.named.context || "")
			const riskText = risk ? `${risk.riskLevel}:${risk.riskScore.toFixed(2)}` : "n/a"
			process.stderr.write(`[smart] -> ${routedTool} (${reason}, confidence=${confidence?.toFixed(2) ?? "n/a"}, risk=${riskText})\n`)
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
