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
import { fileURLToPath } from "url"
import readline from "readline"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── Configuration ─────────────────────────────────────────────────────────────

const MEMORY_DIR = path.resolve(process.cwd(), "memory")
const LESSONS_LEARNED_PATH = path.join(MEMORY_DIR, "lessons-learned.md")
const LESSON_INDEX_PATH = path.join(MEMORY_DIR, "lesson-index.jsonl")
const LESSON_SUMMARIES_PATH = path.join(MEMORY_DIR, "lesson-summaries.json")
const PROJECT_ID = process.env.PROJECT_ID || "kilo-code"
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://superroo:superroo@localhost:5432/superroo_brain"

// ── Logging ───────────────────────────────────────────────────────────────────

function log(msg) {
	console.error(`[central-brain-mcp] ${msg}`)
}

// ── PostgreSQL/pgvector Client (optional) ─────────────────────────────────────

let pgClient = null
async function initPgClient() {
	try {
		const { Client } = await import("pg").catch(() => null)
		if (!Client) {
			log("pg module not available, using JSONL fallback")
			return null
		}
		pgClient = new Client({ connectionString: DATABASE_URL })
		await pgClient.connect()
		log("Connected to PostgreSQL/pgvector")
		return pgClient
	} catch (err) {
		log(`PostgreSQL connection failed, using JSONL fallback: ${err.message}`)
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

async function storeLesson({ title, content, agent, projectId, tags, files, summary, confidence }) {
	const lessons = await loadLessons()
	const id = `lesson-${lessons.length + 1}`

	const lesson = {
		id,
		title,
		type: "lesson",
		date: new Date().toISOString().split("T")[0],
		source: `${agent} task completion`,
		model: "kilo-auto/free",
		confidence: confidence || "high",
		files: files || [],
		tags: tags || [],
		project: projectId || PROJECT_ID,
		relevance_score: 0.9,
		lesson_summary: summary || content.slice(0, 200),
	}

	// Try PostgreSQL first, fallback to JSONL
	if (pgClient) {
		try {
			await pgClient.query(
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
			)
			log(`Lesson stored in PostgreSQL: ${lesson.id}`)
		} catch (err) {
			log(`PostgreSQL insert failed, falling back to JSONL: ${err.message}`)
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
						{ id: "wf-002", rule: "Auto Free is used for planning and review tasks", severity: "mandatory" },
						{ id: "wf-003", rule: "Central Brain (pgvector) is the DEFAULT memory store", severity: "mandatory" },
						{ id: "wf-004", rule: "Every coding agent MUST contribute at least one lesson per session", severity: "mandatory" },
					],
				}),
			},
		],
	}
}

async function handleSearchMemory({ query, limit = 5 }) {
	const lessons = await loadLessons()
	const results = lessons
		.filter((l) => l.title?.toLowerCase().includes(query.toLowerCase()) || l.lesson_summary?.toLowerCase().includes(query.toLowerCase()))
		.slice(0, limit)
	return {
		content: [
			{
				type: "text",
				text: JSON.stringify({ query, results, count: results.length }, null, 2),
			},
		],
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
		default:
			return Promise.resolve({
				content: [{ type: "text", text: `Unknown tool: ${name}` }],
				isError: true,
			})
	}
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
	log(`Starting Central Brain MCP Server`)
	log(`Memory directory: ${MEMORY_DIR}`)
	log(`Project ID: ${PROJECT_ID}`)
	log(`Database URL: ${DATABASE_URL}`)

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
			console.log(JSON.stringify({ jsonrpc: "2.0", id, ...result }))
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