#!/usr/bin/env node
/**
 * Central Brain MCP Server for Kilo Code
 *
 * Model Context Protocol server that provides:
 * - Lesson storage and retrieval (PostgreSQL/pgvector or local JSONL fallback)
 * - Lesson obligation tracking (brain_register_lesson_intent, brain_store_lesson)
 * - Workflow rules enforcement
 * - Project memory management
 *
 * Architecture:
 *   PostgreSQL + pgvector (primary) ← Central Brain v2
 *   ↓
 *   JSONL fallback (when DB unavailable)
 */

import fs from "fs"
import path from "path"
import os from "os"
import { fileURLToPath } from "url"
import readline from "readline"
import { execSync } from "child_process"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── Configuration ─────────────────────────────────────────────────────────────

const MEMORY_DIR = process.env.MEMORY_DIR || path.resolve(process.cwd(), "memory")
const LESSONS_LEARNED_PATH = path.join(MEMORY_DIR, "lessons-learned.md")
const LESSON_INDEX_PATH = path.join(MEMORY_DIR, "lesson-index.jsonl")
const LESSON_SUMMARIES_PATH = path.join(MEMORY_DIR, "lesson-summaries.json")
const PROJECT_ID = process.env.PROJECT_ID || "kilo-code"

// ── Product Memory (global, shared with VS Code extension) ────────────────────
const PRODUCT_MEMORY_DIR = process.env.SUPERROO_PRODUCT_MEMORY_DIR
	|| path.join(os.homedir(), ".superroo", "product-memory")
const DEFAULT_LOCAL_DATABASE_URL = "postgresql://superroo:superroo@localhost:5432/superroo_brain"
const DEFAULT_VPS_DATABASE_URL = "postgresql://superroo:superroo@100.64.175.88:5432/superroo_brain"

function databaseUrlsFromEnv() {
	const explicitList = process.env.DATABASE_URLS || process.env.SUPERROO_DATABASE_URLS
	if (explicitList) {
		return explicitList
			.split(/[,\n;]/)
			.map((url) => url.trim())
			.filter(Boolean)
	}

	const urls = [
		process.env.DATABASE_URL || DEFAULT_LOCAL_DATABASE_URL,
		process.env.DATABASE_FALLBACK_URL || process.env.SUPERROO_DATABASE_FALLBACK_URL || DEFAULT_VPS_DATABASE_URL,
	]
	return [...new Set(urls.filter(Boolean))]
}

const DATABASE_URLS = databaseUrlsFromEnv()
let activeDatabaseUrl = DATABASE_URLS[0] || DEFAULT_VPS_DATABASE_URL
const OLLAMA_URL = process.env.OLLAMA_URL || process.env.OLLAMA_HOST || "http://127.0.0.1:11434"
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text"

// ── Logging ───────────────────────────────────────────────────────────────────

function log(msg) {
	console.error(`[central-brain-mcp] ${msg}`)
}

// ── PostgreSQL/pgvector Client (optional) ─────────────────────────────────────

let pgClient = null
function withTimeout(promise, ms, label) {
	let timer
	return Promise.race([
		promise,
		new Promise((_, reject) => {
			timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
		}),
	]).finally(() => clearTimeout(timer))
}

async function initPgClient() {
	try {
		const { Client } = await import("pg").catch(() => null)
		if (!Client) {
			log("pg module not available, using JSONL fallback")
			return null
		}
		let lastError = null
		for (const databaseUrl of DATABASE_URLS) {
			try {
				pgClient = new Client({
					connectionString: databaseUrl,
					connectionTimeoutMillis: 3000,
					query_timeout: 5000,
					statement_timeout: 5000,
					application_name: "superroo-central-brain-mcp",
				})
				await withTimeout(pgClient.connect(), 3000, `PostgreSQL connect (${databaseUrl})`)
				activeDatabaseUrl = databaseUrl
				log(`Connected to PostgreSQL/pgvector: ${databaseUrl.replace(/:\/\/.*?:.*?@/, "://***:***@")}`)
				return pgClient
			} catch (err) {
				lastError = err
				log(`PostgreSQL candidate failed: ${databaseUrl.replace(/:\/\/.*?:.*?@/, "://***:***@")} (${err.message})`)
				if (pgClient) pgClient.end().catch(() => {})
				pgClient = null
			}
		}
		throw lastError || new Error("No PostgreSQL candidates configured")
	} catch (err) {
		log(`PostgreSQL connection failed, using JSONL fallback: ${err.message}`)
		if (pgClient) pgClient.end().catch(() => {})
		pgClient = null
		return null
	}
}

// ── Lesson Obligation Tracker ─────────────────────────────────────────────────

class LessonObligationTracker {
	constructor() {
		this.obligations = new Map()
	}

	register(agent, projectId, task) {
		const id = `${agent}-${Date.now()}`
		this.obligations.set(agent, {
			id,
			agent,
			projectId: projectId || PROJECT_ID,
			task,
			fulfilled: false,
			createdAt: new Date().toISOString(),
		})
		return this.obligations.get(agent)
	}

	fulfill(agent, lessonId) {
		const obligation = this.obligations.get(agent)
		if (obligation) {
			obligation.fulfilled = true
			obligation.lessonId = lessonId
			obligation.fulfilledAt = new Date().toISOString()
			return true
		}
		return false
	}

	getStatus(agent) {
		return this.obligations.get(agent) || null
	}

	getStats() {
		const total = this.obligations.size
		const fulfilled = Array.from(this.obligations.values()).filter((o) => o.fulfilled).length
		const pending = total - fulfilled
		return { total, fulfilled, pending }
	}
}

const obligationTracker = new LessonObligationTracker()

// ── Lesson Storage ────────────────────────────────────────────────────────────

async function loadLessons() {
	try {
		const content = await fs.promises.readFile(LESSON_INDEX_PATH, "utf8")
		return content
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line))
	} catch {
		return []
	}
}

function lessonText(lesson) {
	return [
		lesson.title,
		lesson.rule_summary,
		lesson.lesson_summary,
		lesson.summary,
		lesson.content,
		Array.isArray(lesson.tags) ? lesson.tags.join(" ") : "",
		Array.isArray(lesson.files) ? lesson.files.join(" ") : "",
	].filter(Boolean).join("\n")
}

function tokenize(text) {
	return String(text)
		.toLowerCase()
		.replace(/[^\w\s]/g, " ")
		.split(/\s+/)
		.filter((token) => token.length > 1)
}

function bm25Scores(query, entries) {
	const queryTokens = tokenize(query)
	const docs = entries.map((entry) => tokenize(lessonText(entry)))
	if (!queryTokens.length || !docs.length) return entries.map(() => 0)
	const avgdl = docs.reduce((sum, tokens) => sum + tokens.length, 0) / docs.length || 1
	const df = {}
	for (const tokens of docs) {
		for (const token of new Set(tokens)) df[token] = (df[token] || 0) + 1
	}
	const k1 = 1.5
	const b = 0.75
	return docs.map((tokens) => {
		const tf = {}
		for (const token of tokens) tf[token] = (tf[token] || 0) + 1
		let score = 0
		for (const term of queryTokens) {
			if (!tf[term]) continue
			const termDf = df[term] || 0
			const idf = Math.log((docs.length - termDf + 0.5) / (termDf + 0.5) + 1)
			score += idf * (tf[term] * (k1 + 1)) / (tf[term] + k1 * (1 - b + (b * tokens.length) / avgdl))
		}
		return score
	})
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

function rrfCombine(vectorScores, keywordScores, entries, limit) {
	const k = 60
	const indexes = [...entries.keys()]
	const vectorOrder = [...indexes].sort((a, b) => vectorScores[b] - vectorScores[a])
	const keywordOrder = [...indexes].sort((a, b) => keywordScores[b] - keywordScores[a])
	const vectorRank = new Array(entries.length)
	const keywordRank = new Array(entries.length)
	vectorOrder.forEach((index, rank) => { vectorRank[index] = rank })
	keywordOrder.forEach((index, rank) => { keywordRank[index] = rank })
	return entries
		.map((entry, index) => ({
			...entry,
			_rag_score: 1 / (k + vectorRank[index]) + 1 / (k + keywordRank[index]),
			_keyword_score: keywordScores[index],
			_vector_score: vectorScores[index],
		}))
		.sort((a, b) => b._rag_score - a._rag_score)
		.slice(0, limit)
}

async function embed(text) {
	const input = String(text || "").slice(0, 8000)
	try {
		const response = await fetch(`${OLLAMA_URL}/api/embed`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ model: EMBED_MODEL, input }),
			signal: AbortSignal.timeout(5000),
		})
		if (response.ok) {
			const data = await response.json()
			const embedding = data?.embeddings?.[0] || data?.embedding
			if (Array.isArray(embedding)) return embedding
		}
	} catch {}
	try {
		const response = await fetch(`${OLLAMA_URL}/api/embeddings`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ model: EMBED_MODEL, prompt: input }),
			signal: AbortSignal.timeout(5000),
		})
		if (response.ok) {
			const data = await response.json()
			if (Array.isArray(data?.embedding)) return data.embedding
		}
	} catch {}
	return null
}

async function hybridSearchLessons(query, limit) {
	const lessons = await loadLessons()
	if (!lessons.length) return { query, results: [], count: 0, mode: "empty" }
	const keywordScores = bm25Scores(query, lessons)
	const candidateIndexes = [...lessons.keys()]
		.sort((a, b) => keywordScores[b] - keywordScores[a])
		.slice(0, Math.max(limit * 8, 80))
	const candidates = candidateIndexes.map((index) => lessons[index])
	const candidateKeywordScores = candidateIndexes.map((index) => keywordScores[index])
	const queryEmbedding = await embed(query)
	if (!queryEmbedding) {
		const results = candidates
			.map((lesson, index) => ({ ...lesson, _keyword_score: candidateKeywordScores[index] }))
			.sort((a, b) => b._keyword_score - a._keyword_score)
			.slice(0, limit)
		return { query, results, count: results.length, mode: "bm25-fallback" }
	}
	const embeddings = await Promise.all(candidates.map((lesson) => embed(lessonText(lesson))))
	const vectorScores = embeddings.map((embedding) => cosineSimilarity(queryEmbedding, embedding))
	const results = rrfCombine(vectorScores, candidateKeywordScores, candidates, limit)
	return { query, results, count: results.length, mode: "hybrid-bm25-vector-rrf" }
}

function getGitProvenance() {
	try {
		const sha    = execSync("git rev-parse HEAD", { encoding: "utf8", stdio: "pipe" }).trim()
		const branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8", stdio: "pipe" }).trim()
		const author = execSync("git log -1 --pretty=%an", { encoding: "utf8", stdio: "pipe" }).trim()
		return { git_commit: sha, git_branch: branch, git_author: author }
	} catch { return {} }
}

async function storeLesson({ title, content, agent, projectId, tags, files, summary, confidence }) {
	const lessons = await loadLessons()
	const id = `lesson-${lessons.length + 1}`
	const provenance = getGitProvenance()

	const lesson = {
		id,
		title,
		type: "lesson",
		date: new Date().toISOString().split("T")[0],
		source: `${agent} task completion`,
		model: "qwen3:14b",
		confidence: confidence || "high",
		files: files || [],
		tags: tags || [],
		project: projectId || PROJECT_ID,
		relevance_score: 0.9,
		lesson_summary: summary || content.slice(0, 200),
		...provenance,
	}

	// Try PostgreSQL first, fallback to JSONL
	if (pgClient) {
		try {
			await withTimeout(pgClient.query(
				`INSERT INTO agent_memory (id, project_id, agent, title, summary, content, memory_type, status, confidence, tags, files)
				 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
				[
					lesson.id,
					lesson.project,
					agent,
					lesson.title,
					lesson.lesson_summary,
					content,
					"lesson",
					"approved",
					parseFloat(lesson.confidence === "high" ? "0.9" : lesson.confidence === "medium" ? "0.7" : "0.5"),
					lesson.tags,
					lesson.files,
				],
			), 5000, "PostgreSQL lesson insert")
			log(`Lesson stored in PostgreSQL: ${lesson.id}`)
		} catch (err) {
			log(`PostgreSQL insert failed, falling back to JSONL: ${err.message}`)
			if (/timed out/i.test(err.message)) {
				pgClient.end().catch(() => {})
				pgClient = null
			}
		}
	}

	// Always append to JSONL as backup
	await fs.promises.appendFile(LESSON_INDEX_PATH, JSON.stringify(lesson) + "\n")

	// Append to markdown
	const mdEntry = `
### Lesson: ${title}

Date: ${lesson.date}
Source: ${lesson.source}
Model/API used: ${lesson.model}
Confidence: ${lesson.confidence}
Related files: ${lesson.files.join(", ")}

#### Task Summary

${content}

#### Files Changed

${lesson.files.map((f) => `- ${f}`).join("\n")}

#### Bug Cause

N/A — lesson storage via MCP

#### Fix Applied

N/A — lesson storage via MCP

#### Test Result

unknown

#### Lesson Learned

${lesson.lesson_summary}

#### Reusable Rule

${lesson.lesson_summary}

#### Tags

${lesson.tags.join(", ")}

---
`
	await fs.promises.appendFile(LESSONS_LEARNED_PATH, mdEntry)

	return { success: true, memoryId: id }
}

// ── MCP Protocol Types ──

const TOOLS = [
	{
		name: "brain_register_lesson_intent",
		description: "Register intent to write a lesson before starting work",
		inputSchema: {
			type: "object",
			properties: {
				agent: { type: "string", description: "Agent name" },
				projectId: { type: "string", description: "Project ID (optional)" },
				task: { type: "string", description: "Task description" },
			},
			required: ["agent", "task"],
		},
	},
	{
		name: "brain_store_lesson",
		description: "Store a lesson in the learning layer",
		inputSchema: {
			type: "object",
			properties: {
				title: { type: "string", description: "Lesson title" },
				content: { type: "string", description: "Lesson content" },
				agent: { type: "string", description: "Agent name" },
				projectId: { type: "string", description: "Project ID (optional)" },
				tags: { type: "array", items: { type: "string" } },
				files: { type: "array", items: { type: "string" } },
				summary: { type: "string", description: "Short summary" },
				confidence: { type: "string", enum: ["high", "medium", "low"] },
			},
			required: ["title", "content", "agent"],
		},
	},
	{
		name: "brain_lesson_status",
		description: "Check lesson obligation status for an agent",
		inputSchema: {
			type: "object",
			properties: {
				agent: { type: "string", description: "Agent name (optional, returns all if not specified)" },
			},
			required: [],
		},
	},
	{
		name: "brain_get_workflow_rules",
		description: "Get the mandated workflow rules for Kilo Code",
		inputSchema: {
			type: "object",
			properties: {},
			required: [],
		},
	},
	{
		name: "brain_search_memory",
		description: "Search lessons in the learning layer",
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string", description: "Search query" },
				limit: { type: "number", description: "Max results (default: 5)" },
			},
			required: ["query"],
		},
	},
	{
		name: "brain_analyze_image",
		description: "Analyze an image using vision model (llava:7b or cloud vision). Accepts image_path for local files or image_base64 for direct data.",
		inputSchema: {
			type: "object",
			properties: {
				image_path: { type: "string", description: "Path to local image file" },
				image_base64: { type: "string", description: "Base64 encoded image data (without data:image/png;base64, prefix)" },
				prompt: { type: "string", description: "Analysis prompt (optional)" },
			},
		},
	},

	// ── Product Memory Tools (global, shared with VS Code extension) ───────────
	{
		name: "product_get_features",
		description: "Get all product features from global product memory. Use before coding to understand which features are working, broken, or planned.",
		inputSchema: {
			type: "object",
			properties: {
				status: { type: "string", description: "Filter by status: working | needs_test | broken | planned | deprecated | all (default: all)" },
				files: { type: "array", items: { type: "string" }, description: "Filter features that reference these files" },
			},
		},
	},
	{
		name: "product_get_bugs",
		description: "Get open bugs from global product memory. Use before editing a feature to understand known issues.",
		inputSchema: {
			type: "object",
			properties: {
				status: { type: "string", description: "Filter by status: open | investigating | fixed | all (default: open)" },
				feature_id: { type: "string", description: "Filter bugs for a specific feature ID" },
			},
		},
	},
	{
		name: "product_update_feature",
		description: "Update a product feature's status in global product memory. Call after fixing or breaking a feature.",
		inputSchema: {
			type: "object",
			required: ["feature_id", "status"],
			properties: {
				feature_id: { type: "string", description: "Feature ID to update" },
				status: { type: "string", description: "New status: working | needs_test | broken | planned | deprecated" },
				note: { type: "string", description: "Optional note about what changed" },
				agent: { type: "string", description: "Agent making the update" },
			},
		},
	},
	{
		name: "product_add_bug",
		description: "Record a new bug in global product memory. Call when you discover a bug during coding or review.",
		inputSchema: {
			type: "object",
			required: ["title", "description"],
			properties: {
				title: { type: "string", description: "Short bug title" },
				description: { type: "string", description: "What the bug does" },
				feature_id: { type: "string", description: "Related feature ID (optional)" },
				severity: { type: "string", description: "low | medium | high | critical (default: medium)" },
				files: { type: "array", items: { type: "string" }, description: "Files involved" },
			},
		},
	},
	{
		name: "product_get_context",
		description: "Get enriched product context for a set of files — features, open bugs, recent tests, risk level. Use this before any Ollama coding task for smarter routing.",
		inputSchema: {
			type: "object",
			required: ["files"],
			properties: {
				files: { type: "array", items: { type: "string" }, description: "Files being edited" },
			},
		},
	},
]

// ── Tool Handlers ─────────────────────────────────────────────────────────────

async function handleRegisterLessonIntent({ agent, projectId, task }) {
	const obligation = obligationTracker.register(agent, projectId, task)
	return {
		content: [
			{
				type: "text",
				text: JSON.stringify({
					success: true,
					message: `Lesson intent registered for ${agent}`,
					obligation,
				}),
			},
		],
	}
}

async function handleStoreLesson({ title, content, agent, projectId, tags, files, summary, confidence }) {
	const result = await storeLesson({ title, content, agent, projectId, tags, files, summary, confidence })
	obligationTracker.fulfill(agent, result.memoryId)
	return {
		content: [
			{
				type: "text",
				text: JSON.stringify({
					success: true,
					message: "Lesson stored successfully",
					memoryId: result.memoryId,
				}),
			},
		],
	}
}

async function handleLessonStatus({ agent }) {
	const stats = obligationTracker.getStats()
	const result = agent
		? { [agent]: obligationTracker.getStatus(agent) }
		: { stats, obligations: Object.fromEntries(obligationTracker.obligations) }
	return {
		content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
	}
}

async function handleGetWorkflowRules() {
	return {
		content: [
			{
				type: "text",
				text: JSON.stringify({
					version: "1.0",
					defaultCoder: "ollama/qwen2.5-coder:7b",
					defaultEmbeddings: "ollama/nomic-embed-text",
					defaultMemory: "central-brain-pgvector",
					lessonObligation: true,
					rules: [
						{ id: "wf-001", rule: "Ollama models are the DEFAULT for all tasks (qwen2.5-coder:7b for coding, hermes3 for planning)", severity: "mandatory" },
						{ id: "wf-002", rule: "qwen3:14b is used for local planning and review tasks", severity: "mandatory" },
						{ id: "wf-003", rule: "Central Brain (pgvector) is the DEFAULT memory store", severity: "mandatory" },
						{ id: "wf-004", rule: "Every coding agent MUST contribute at least one lesson per session", severity: "mandatory" },
					],
				}),
			},
		],
	}
}

async function handleSearchMemory({ query, limit = 5 }) {
	const result = await hybridSearchLessons(query, limit)
	return {
		content: [
			{
				type: "text",
				text: JSON.stringify(result, null, 2),
			},
		],
	}
}

async function handleAnalyzeImage({ image_path, image_base64, prompt = "Analyze this image and extract all text, UI elements, and key information." }) {
	try {
		const ollamaUrl = process.env.OLLAMA_URL || "http://127.0.0.1:11434"
		const visionModel = "llava:7b"

		let base64Image

		// Handle base64 data directly (for chat attachments)
		if (image_base64) {
			base64Image = image_base64.replace(/^data:image\/[a-z]+;base64,/, "")
		} else if (image_path) {
			// Handle local file path
			if (image_path.startsWith("http://") || image_path.startsWith("https://")) {
				log(`Vision analysis for URL not yet implemented: ${image_path}`)
				return {
					content: [{ type: "text", text: JSON.stringify({
						success: false,
						message: "URL-based image analysis not yet implemented. Please use local image path or provide image_base64.",
						image_path
					}, null, 2) }],
				}
			}
			try {
				const imageData = await fs.promises.readFile(image_path)
				base64Image = imageData.toString("base64")
			} catch (readErr) {
				log(`Image read failed: ${readErr.message}`)
				return {
					content: [{ type: "text", text: JSON.stringify({
						success: false,
						message: `Could not read image file: ${readErr.message}`,
						image_path,
						note: "Ensure the image exists and llava:7b model is pulled (ollama pull llava:7b)"
					}, null, 2) }],
				}
			}
		} else {
			return {
				content: [{ type: "text", text: JSON.stringify({
					success: false,
					message: "Either image_path or image_base64 is required"
				}, null, 2) }],
			}
		}

		// Call Ollama vision API
		const response = await fetch(`${ollamaUrl}/api/chat`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model: visionModel,
				stream: false,
				messages: [
					{
						role: "user",
						content: prompt,
						images: [base64Image]
					}
				]
			})
		})

		if (!response.ok) {
			throw new Error(`Ollama API error: ${response.status} ${response.statusText}`)
		}

		const result = await response.json()
		log(`Vision analysis completed`)

		return {
			content: [{ type: "text", text: JSON.stringify({
				success: true,
				image_path: image_path || "(base64 data)",
				model: visionModel,
				analysis: result.message?.content || result.response || "No analysis result",
				usage: result.eval_count ? { eval_count: result.eval_count, eval_duration: result.eval_duration } : undefined
			}, null, 2) }],
		}
	} catch (err) {
		log(`Vision analysis error: ${err.message}`)
		return {
			content: [{ type: "text", text: JSON.stringify({
				success: false,
				error: err.message,
				note: "Vision analysis requires llava:7b model. Run: ollama pull llava:7b"
			}, null, 2) }],
			isError: true,
		}
	}
}

function handleToolCall(name, args) {
	switch (name) {
		case "brain_register_lesson_intent":
			return handleRegisterLessonIntent(args)
		case "brain_store_lesson":
			return handleStoreLesson(args)
		case "brain_lesson_status":
			return handleLessonStatus(args)
		case "brain_get_workflow_rules":
			return handleGetWorkflowRules()
		case "brain_search_memory":
			return handleSearchMemory(args)
		case "brain_analyze_image":
			return handleAnalyzeImage(args)
		case "product_get_features":
			return handleProductGetFeatures(args)
		case "product_get_bugs":
			return handleProductGetBugs(args)
		case "product_update_feature":
			return handleProductUpdateFeature(args)
		case "product_add_bug":
			return handleProductAddBug(args)
		case "product_get_context":
			return handleProductGetContext(args)
		default:
			return Promise.resolve({
				content: [{ type: "text", text: `Unknown tool: ${name}` }],
				isError: true,
			})
	}
}

// ── Product Memory Handlers ───────────────────────────────────────────────────

function loadProductFile(fileName) {
	const p = path.join(PRODUCT_MEMORY_DIR, fileName)
	try { return JSON.parse(fs.readFileSync(p, "utf8")) }
	catch { return null }
}

function saveProductFile(fileName, data) {
	fs.mkdirSync(PRODUCT_MEMORY_DIR, { recursive: true })
	fs.writeFileSync(path.join(PRODUCT_MEMORY_DIR, fileName), JSON.stringify(data, null, 2), "utf8")
}

async function handleProductGetFeatures({ status, files } = {}) {
	const data = loadProductFile("product-features.json")
	if (!data) return jsonResult({ features: [], note: "No product features yet — run the VS Code extension to populate" })
	let features = data.features || []
	if (status && status !== "all") features = features.filter(f => f.status === status)
	if (files?.length) features = features.filter(f => f.relatedFiles?.some(rf => files.some(file => rf.includes(file) || file.includes(rf))))
	return jsonResult({ features, total: features.length, productMemoryDir: PRODUCT_MEMORY_DIR })
}

async function handleProductGetBugs({ status, feature_id } = {}) {
	const data = loadProductFile("bug-feature-map.json")
	if (!data) return jsonResult({ bugs: [], note: "No bugs recorded yet" })
	let bugs = data.mappings || []
	const filterStatus = status || "open"
	if (filterStatus !== "all") bugs = bugs.filter(b => b.status === filterStatus)
	if (feature_id) bugs = bugs.filter(b => b.featureId === feature_id)
	return jsonResult({ bugs, total: bugs.length, openCount: (data.mappings||[]).filter(b=>b.status==="open").length })
}

async function handleProductUpdateFeature({ feature_id, status, note, agent } = {}) {
	const data = loadProductFile("product-features.json") || { features: [] }
	const idx = data.features.findIndex(f => f.id === feature_id)
	if (idx < 0) return jsonResult({ success: false, message: `Feature ${feature_id} not found` })
	const old = data.features[idx].status
	data.features[idx].status = status
	data.features[idx].lastUpdatedAt = new Date().toISOString()
	if (note) data.features[idx].lastNote = note
	saveProductFile("product-features.json", data)
	// Also record as a product update
	const updates = loadProductFile("product-updates.json") || { updates: [] }
	updates.updates.push({ id: `upd-${Date.now()}`, timestamp: new Date().toISOString(), type: "agent_updated",
		title: `Feature ${feature_id} status: ${old} → ${status}`, summary: note || "", filesChanged: [], status, linkedFeatures: [feature_id], rollbackAvailable: false })
	saveProductFile("product-updates.json", updates)
	return jsonResult({ success: true, message: `Feature ${feature_id} updated: ${old} → ${status}`, agent })
}

async function handleProductAddBug({ title, description, feature_id, severity, files } = {}) {
	const data = loadProductFile("bug-feature-map.json") || { mappings: [] }
	const bug = { id: `bug-${Date.now()}`, bugId: `bug-${Date.now()}`, featureId: feature_id || "unknown",
		severity: severity || "medium", title, description, logs: files || [], status: "open", createdAt: new Date().toISOString() }
	data.mappings.push(bug)
	saveProductFile("bug-feature-map.json", data)
	return jsonResult({ success: true, bugId: bug.id, message: `Bug recorded: ${title}` })
}

async function handleProductGetContext({ files } = {}) {
	const features = loadProductFile("product-features.json")?.features || []
	const bugs = loadProductFile("bug-feature-map.json")?.mappings || []
	const tests = loadProductFile("feature-test-history.json")?.tests || []

	// Find features touching these files
	const relatedFeatures = files?.length
		? features.filter(f => f.relatedFiles?.some(rf => files.some(file => rf.includes(file) || file.includes(rf))))
		: features.slice(-10)

	const openBugs = bugs.filter(b => b.status === "open" && relatedFeatures.some(f => f.id === b.featureId))
	const recentTests = tests.filter(t => relatedFeatures.some(f => f.id === t.featureId)).slice(-5)

	// Risk assessment
	const brokenFeatures = relatedFeatures.filter(f => f.status === "broken").length
	const criticalBugs = openBugs.filter(b => b.severity === "critical" || b.severity === "high").length
	const riskLevel = brokenFeatures > 0 || criticalBugs > 1 ? "high" : openBugs.length > 0 ? "medium" : "low"

	// Routing recommendation for Ollama
	const routingHint = riskLevel === "high" ? "Use code_pro_verified — broken features or critical bugs detected"
		: riskLevel === "medium" ? "Use code_pro — open bugs in affected area"
		: "Fast coder OK — features healthy"

	const summary = [
		relatedFeatures.length > 0 ? `Features: ${relatedFeatures.map(f => `${f.name}(${f.status})`).join(", ")}` : null,
		openBugs.length > 0 ? `Open bugs: ${openBugs.map(b => `[${b.severity}] ${b.title}`).join("; ")}` : null,
		recentTests.length > 0 ? `Last test: ${recentTests[0].result} (${recentTests[0].testedAt?.slice(0,10)})` : null,
	].filter(Boolean).join("\n")

	return jsonResult({ riskLevel, routingHint, summary, relatedFeatures, openBugs, recentTests, productMemoryDir: PRODUCT_MEMORY_DIR })
}

function jsonResult(data) {
	return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
	log(`Starting Central Brain MCP Server`)
	log(`Memory directory: ${MEMORY_DIR}`)
	log(`Project ID: ${PROJECT_ID}`)
	log(`Database URL: ${activeDatabaseUrl}`)

	// Try to connect to PostgreSQL/pgvector
	await initPgClient()

	const reader = readline.createInterface({ input: process.stdin })
	reader.on("line", async (line) => {
		let request
		try {
			request = JSON.parse(line)
		} catch {
			return
		}

		const { id, method, params } = request

		if (method === "tools/list") {
			console.log(JSON.stringify({ jsonrpc: "2.0", id, result: { tools: TOOLS } }))
		} else if (method === "tools/call") {
			const result = await handleToolCall(params.name, params.arguments || {})
			console.log(JSON.stringify({ jsonrpc: "2.0", id, result }))
		} else if (method === "initialize") {
			console.log(
				JSON.stringify({
					jsonrpc: "2.0",
					id,
					result: {
						protocolVersion: "2024-11-05",
						capabilities: { tools: {} },
						serverInfo: { name: "central-brain-mcp", version: "1.0.0" },
						workflowRules: {
							version: "1.0",
							defaultCoder: "ollama/qwen2.5-coder:7b",
							defaultEmbeddings: "ollama/nomic-embed-text",
							defaultMemory: "central-brain-pgvector",
							lessonObligation: true,
						},
					},
				}),
			)
		} else if (method === "notifications/initialized") {
			// no response needed
		} else {
			console.log(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } }))
		}
	})

	reader.on("close", () => {
		log("stdin closed, shutting down")
		if (pgClient) pgClient.end().catch(() => {})
	})
}

main()
