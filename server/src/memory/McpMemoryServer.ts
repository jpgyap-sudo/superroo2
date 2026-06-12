/**
 * McpMemoryServer — MCP server that Claude Code and Codex connect to.
 *
 * This implements the Model Context Protocol (MCP) so that any MCP-compatible
 * client (Claude Code, Codex, Cursor, etc.) can query SuperRoo's Central Brain
 * memory. It exposes:
 *
 *   Tools:
 *     - query_memory(query, project?, maxResults?, offset?) — Search memory with RAG context
 *     - get_project_info(project?) — Get project namespace details
 *     - list_projects() — List all registered projects
 *     - register_project(name, directory) — Register a new project
 *     - get_active_task(project?) — Get current active task for a project
 *     - get_recent_bugs(project?, limit?) — Get recent bugs for a project
 *     - search_code(query, project?, file_pattern?) — Search indexed code
 *     - submit_task(goal, project?, agent?) — Submit a new task
 *     - hermes_recall(query, limit?) — Semantic memory search via Hermes Claw
 *     - hermes_learn(topic, content) — Store a lesson via Hermes Claw
 *     - hermes_learn_batch(lessons) — Store multiple lessons in bulk
 *     - hermes_list_skills() — List all created skills
 *     - hermes_list_resources() — List all knowledge resources
 *     - hermes_stats() — Get Hermes Claw statistics
 *     - commit_deploy_status(limit?) — Get commit/deploy history
 *     - sync_status() — Get Central Brain sync status and health
 *     - codex_task_upsert(...) — Create or update persistent Codex task memory
 *     - codex_task_list(limit?) — List recent Codex tasks
 *     - codex_task_get(id) — Fetch one Codex task
 *     - codex_task_get_active() — Fetch the current active Codex task
 *     - brain_search_memory(query, projectId?, limit?, minSimilarity?, status?) — Semantic search pgvector
 *     - brain_get_scores(projectId?, limit?) — Agent scores leaderboard
 *     - brain_get_events(projectId?, limit?, eventType?) — Brain events log
 *     - brain_get_approvals(projectId?, limit?) — Pending memory approvals
 *     - brain_approve_memory(approvalId, reviewedBy?) — Approve a pending memory
 *     - brain_reject_memory(approvalId, reviewedBy?) — Reject a pending memory
 *     - brain_store_lesson(title, content, agent?, projectId?, tags?, files?, summary?, confidence?) — Store a lesson in pgvector (MANDATORY: every coding agent MUST call this before disconnecting)
 *     - brain_register_lesson_intent(agent, projectId?, task?) — Register intent to contribute a lesson (call at session start)
 *     - brain_lesson_status(agent?) — Check pending lesson obligations for an agent
 *     - brain_get_workflow_rules() — Get the mandated workflow rules (DeepSeek coder + Ollama embeddings)
 *
 *   Resources:
 *     - memory://{project}/context — Full RAG context for a project
 *     - memory://{project}/tasks — Task list for a project
 *     - memory://{project}/bugs — Bug list for a project
 *
 *   Lesson Obligation Policy:
 *     Every coding agent that connects to this MCP server MUST contribute at
 *     least one lesson before disconnecting. The server tracks lesson obligations
 *     per agent. Agents call brain_register_lesson_intent at session start and
 *     brain_store_lesson when they have a lesson to contribute. The server logs
 *     warnings for agents that disconnect without fulfilling their obligation.
 *
 *   Mandated Workflow:
 *     All coding agents connecting to this MCP server MUST follow the mandated
 *     workflow:
 *       1. DeepSeek is the DEFAULT coder for all implementation tasks
 *       2. Ollama is the DEFAULT embeddings provider for semantic search and lesson summarization
 *       3. Central Brain (pgvector) is the DEFAULT memory store
 *       4. Every agent MUST contribute at least one lesson per session
 *     The initialize response includes workflowRules that clients can parse
 *     to auto-configure their tooling. Use brain_get_workflow_rules to retrieve
 *     the full ruleset at any time.
 *
 * Architecture:
 *   Claude Code / Codex Extension
 *        ↓  (MCP Protocol via stdio or HTTP)
 *   McpMemoryServer (this file)
 *        ↓  (HTTP to Central Brain daemon OR REST API fallback OR Brain v2 API)
 *   Central Brain Daemon (port 3417) ← Primary
 *   REST API (port 8787) ← Fallback
 *   Central Brain v2 API (port 3456) ← pgvector memory, scores, events, approvals, lesson storage
 *        ↓
 *   ProjectMemoryManager → Qdrant / PostgreSQL / JSON Memory
 *
 * The MCP server can run as:
 *   1. A sidecar process alongside the Central Brain daemon
 *   2. An embedded endpoint in the daemon itself
 *   3. A standalone process for local development
 */

import * as http from "node:http"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as crypto from "node:crypto"
import * as os from "node:os"

// ── Configuration ──

const CENTRAL_BRAIN_URL = process.env.CENTRAL_BRAIN_URL || "http://127.0.0.1:3417"
const REST_API_FALLBACK_URL = process.env.REST_API_FALLBACK_URL || "http://127.0.0.1:8787"
const BRAIN_V2_API_URL = process.env.BRAIN_V2_API_URL || "http://127.0.0.1:3456/api/brain"
const MCP_SERVER_PORT = Number(process.env.MCP_SERVER_PORT || "3419")
const MCP_SERVER_HOST = process.env.MCP_SERVER_HOST || "127.0.0.1"
const DAEMON_TOKEN = process.env.SUPERROO_DAEMON_TOKEN || ""
const CODEX_TASK_LOG_PATH =
	process.env.CODEX_TASK_LOG_PATH || path.resolve(process.cwd(), "server/src/memory/codextask.json")
const KIMI_TASK_LOG_PATH = process.env.KIMI_TASK_LOG_PATH || path.resolve(process.cwd(), "server/src/memory/kimi.json")
const CLAUDE_TASK_LOG_PATH =
	process.env.CLAUDE_TASK_LOG_PATH || path.resolve(process.cwd(), "server/src/memory/claudetask.json")
const SUPERCONTINUE_TASK_LOG_PATH =
	process.env.SUPERCONTINUE_TASK_LOG_PATH || path.resolve(process.cwd(), "server/src/memory/supercontinue-task.json")
const MEMORY_DIR = path.resolve(process.cwd(), "server/src/memory")
const HEALING_DIR = path.resolve(process.cwd(), "memory")
const SUPERROO_CONFIG_PATH = path.resolve(os.homedir(), ".superroo", "config.json")
const LESSONS_LEARNED_PATH = path.resolve(process.cwd(), "memory", "lessons-learned.md")
const LESSON_INDEX_PATH = path.resolve(process.cwd(), "memory", "lesson-index.jsonl")

// Rate limiting config
const RATE_LIMIT_WINDOW_MS = Number(process.env.MCP_RATE_LIMIT_WINDOW_MS || "60000") // 1 minute
const RATE_LIMIT_MAX_CALLS = Number(process.env.MCP_RATE_LIMIT_MAX_CALLS || "120") // 120 calls/minute

// ── MCP Protocol Types ──

interface McpRequest {
	jsonrpc: "2.0"
	id: string | number
	method: string
	params?: Record<string, unknown>
}

interface McpResponse {
	jsonrpc: "2.0"
	id: string | number
	result?: unknown
	error?: { code: number; message: string; data?: unknown }
}

interface McpToolDefinition {
	name: string
	description: string
	inputSchema: {
		type: "object"
		properties: Record<string, unknown>
		required?: string[]
	}
}

interface McpResourceDefinition {
	uri: string
	name: string
	description?: string
	mimeType?: string
}

interface CodexTaskRecord {
	id: string
	title: string
	summary: string
	status: string
	project: string
	agent: string
	filesChanged: string[]
	featuresAffected: string[]
	notes: string[]
	startedAt: string
	updatedAt: string
	completedAt: string | null
}

interface CodexTaskLogFile {
	tasks: CodexTaskRecord[]
}

interface KimiTaskRecord extends CodexTaskRecord {}
interface KimiTaskLogFile {
	tasks: KimiTaskRecord[]
}

interface ClaudeTaskRecord extends CodexTaskRecord {}
interface ClaudeTaskLogFile {
	tasks: ClaudeTaskRecord[]
}

interface SuperContinueTaskRecord extends CodexTaskRecord {}
interface SuperContinueTaskLogFile {
	tasks: SuperContinueTaskRecord[]
}

// ── Rate Limiter ──

interface RateLimitEntry {
	count: number
	resetAt: number
}

class RateLimiter {
	private store = new Map<string, RateLimitEntry>()

	check(key: string): { allowed: boolean; remaining: number; resetAt: number } {
		const now = Date.now()
		const entry = this.store.get(key)
		if (!entry || now >= entry.resetAt) {
			this.store.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
			return { allowed: true, remaining: RATE_LIMIT_MAX_CALLS - 1, resetAt: now + RATE_LIMIT_WINDOW_MS }
		}
		if (entry.count >= RATE_LIMIT_MAX_CALLS) {
			return { allowed: false, remaining: 0, resetAt: entry.resetAt }
		}
		entry.count++
		return { allowed: true, remaining: RATE_LIMIT_MAX_CALLS - entry.count, resetAt: entry.resetAt }
	}

	/** Clean up expired entries periodically */
	cleanup(): void {
		const now = Date.now()
		for (const [key, entry] of this.store) {
			if (now >= entry.resetAt) this.store.delete(key)
		}
	}
}

// ── Lesson Obligation Tracker ──

interface LessonObligation {
	agent: string
	projectId: string
	task: string
	registeredAt: number
	fulfilled: boolean
	lessonId?: string
}

/**
 * Tracks lesson obligations for coding agents connected via MCP.
 * Every coding agent MUST contribute at least one lesson before disconnecting.
 * The tracker logs warnings for agents that disconnect without fulfilling.
 */
class LessonObligationTracker {
	private obligations = new Map<string, LessonObligation>()

	/**
	 * Register an agent's intent to contribute a lesson.
	 * Call this at the start of an agent session.
	 */
	register(agent: string, projectId: string, task: string): LessonObligation {
		const existing = this.obligations.get(agent)
		if (existing && !existing.fulfilled) {
			// Agent already has a pending obligation — return it
			return existing
		}
		const obligation: LessonObligation = {
			agent,
			projectId,
			task,
			registeredAt: Date.now(),
			fulfilled: false,
		}
		this.obligations.set(agent, obligation)
		console.log(`[LessonObligation] Registered lesson intent for agent "${agent}" (project: ${projectId}, task: "${task.slice(0, 60)}")`)
		return obligation
	}

	/**
	 * Mark an agent's lesson obligation as fulfilled.
	 * Returns true if the obligation was found and fulfilled.
	 */
	fulfill(agent: string, lessonId: string): boolean {
		const obligation = this.obligations.get(agent)
		if (!obligation) {
			console.log(`[LessonObligation] No pending obligation for agent "${agent}" — lesson stored anyway`)
			return false
		}
		obligation.fulfilled = true
		obligation.lessonId = lessonId
		console.log(`[LessonObligation] Agent "${agent}" fulfilled lesson obligation (lessonId: ${lessonId})`)
		return true
	}

	/**
	 * Get the current obligation status for an agent.
	 */
	getStatus(agent: string): { registered: boolean; fulfilled: boolean; obligation: LessonObligation | null } {
		const obligation = this.obligations.get(agent) || null
		return {
			registered: obligation !== null,
			fulfilled: obligation?.fulfilled ?? false,
			obligation,
		}
	}

	/**
	 * Get all pending (unfulfilled) obligations.
	 */
	getPending(): LessonObligation[] {
		const pending: LessonObligation[] = []
		for (const obligation of this.obligations.values()) {
			if (!obligation.fulfilled) {
				pending.push(obligation)
			}
		}
		return pending
	}

	/**
	 * Log warnings for all agents that have pending obligations.
	 * Call this periodically or on server shutdown.
	 */
	warnPending(): void {
		const pending = this.getPending()
		if (pending.length > 0) {
			console.warn(`[LessonObligation] WARNING: ${pending.length} agent(s) have unfulfilled lesson obligations:`)
			for (const ob of pending) {
				console.warn(
					`  - Agent "${ob.agent}" (project: ${ob.projectId}, task: "${ob.task.slice(0, 60)}", registered: ${new Date(ob.registeredAt).toISOString()})`,
				)
			}
		}
	}

	/**
	 * Get summary stats for the tracker.
	 */
	getStats(): { total: number; fulfilled: number; pending: number } {
		let fulfilled = 0
		for (const ob of this.obligations.values()) {
			if (ob.fulfilled) fulfilled++
		}
		return {
			total: this.obligations.size,
			fulfilled,
			pending: this.obligations.size - fulfilled,
		}
	}
}

function safeIsoTimestamp(value: unknown): string {
	const date = new Date(value as string | number | Date)
	return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

// ── SuperRoo Config (from ~/.superroo/config.json) ──

interface SuperrooProjectConfig {
	name?: string
	directory?: string
	registeredAt?: string
	registered?: string
	firstSeen?: string
}

interface SuperrooConfig {
	projects?: Record<string, SuperrooProjectConfig>
}

// ── MCP Server ──

class McpMemoryServer {
	private server: http.Server
	private tools: McpToolDefinition[] = []
	private resources: McpResourceDefinition[] = []
	private rateLimiter = new RateLimiter()
	private lessonTracker = new LessonObligationTracker()
	private startTime = Date.now()

	constructor() {
		this.server = http.createServer((req, res) => this._handleRequest(req, res))
		this._registerTools()
		this._registerResources()
		// Clean up rate limiter entries every 5 minutes
		setInterval(() => this.rateLimiter.cleanup(), 5 * 60 * 1000)
		// Log warnings for agents with unfulfilled lesson obligations every 30 minutes
		setInterval(() => this.lessonTracker.warnPending(), 30 * 60 * 1000)
	}

	/**
	 * Register all MCP tools.
	 */
	private _registerTools(): void {
		this.tools = [
			{
				name: "query_memory",
				description:
					"Search the Central Brain memory for context relevant to your task. Returns RAG context with relevant files, tasks, bugs, and feature memory. Use this FIRST before starting any coding task.",
				inputSchema: {
					type: "object",
					properties: {
						query: {
							type: "string",
							description: "The search query describing what you need context about",
						},
						project: {
							type: "string",
							description:
								"Project ID (default: auto-detect from query). Options: superroo2, productgenerator, trading-bot",
						},
						maxResults: {
							type: "number",
							description: "Maximum number of results to return (default: 10)",
						},
						offset: {
							type: "number",
							description: "Number of results to skip for pagination (default: 0)",
						},
					},
					required: ["query"],
				},
			},
			{
				name: "register_project",
				description:
					"Register a new project with the Central Brain. Adds the project to ~/.superroo/config.json so it appears in list_projects and cross-project queries.",
				inputSchema: {
					type: "object",
					properties: {
						name: {
							type: "string",
							description: "Project name/ID (e.g., my-project)",
						},
						directory: {
							type: "string",
							description: "Optional absolute path to the project directory",
						},
					},
					required: ["name"],
				},
			},
			{
				name: "get_project_info",
				description:
					"Get detailed information about a project namespace, including its Qdrant collection, memory directory, and configuration.",
				inputSchema: {
					type: "object",
					properties: {
						project: {
							type: "string",
							description:
								"Project ID (default: superroo2). Options: superroo2, productgenerator, trading-bot",
						},
					},
				},
			},
			{
				name: "list_projects",
				description: "List all registered projects in the Central Brain with their memory summaries.",
				inputSchema: {
					type: "object",
					properties: {},
				},
			},
			{
				name: "get_active_task",
				description: "Get the current active task for a project, including its status, goal, and progress.",
				inputSchema: {
					type: "object",
					properties: {
						project: {
							type: "string",
							description: "Project ID (default: superroo2)",
						},
					},
				},
			},
			{
				name: "get_recent_bugs",
				description:
					"Get recent bugs and incidents for a project to understand what's broken or being worked on.",
				inputSchema: {
					type: "object",
					properties: {
						project: {
							type: "string",
							description: "Project ID (default: superroo2)",
						},
						limit: {
							type: "number",
							description: "Maximum number of bugs to return (default: 10)",
						},
					},
				},
			},
			{
				name: "search_code",
				description:
					"Search indexed code chunks in a project's Qdrant vector store. Returns relevant code snippets with file paths and line numbers.",
				inputSchema: {
					type: "object",
					properties: {
						query: {
							type: "string",
							description: "The code search query describing what you're looking for",
						},
						project: {
							type: "string",
							description: "Project ID (default: auto-detect)",
						},
						filePattern: {
							type: "string",
							description: "Optional file glob pattern to filter results (e.g., *.ts, *.py)",
						},
						maxResults: {
							type: "number",
							description: "Maximum number of results (default: 8)",
						},
					},
					required: ["query"],
				},
			},
			{
				name: "submit_task",
				description:
					"Submit a new task to the Central Brain for execution. The brain will route it to the appropriate agent.",
				inputSchema: {
					type: "object",
					properties: {
						goal: {
							type: "string",
							description: "The task goal/description",
						},
						project: {
							type: "string",
							description: "Project ID (default: auto-detect)",
						},
						agent: {
							type: "string",
							description: "Agent to use (default: coder). Options: coder, debugger, architect, deployer",
						},
					},
					required: ["goal"],
				},
			},
			// ── Hermes Claw Tools ──
			{
				name: "hermes_recall",
				description:
					"Search Hermes Claw memory with semantic vector search. Returns relevant lessons, bug fixes, and patterns stored in the pgvector knowledge base.",
				inputSchema: {
					type: "object",
					properties: {
						query: {
							type: "string",
							description: "The search query for semantic memory recall",
						},
						limit: {
							type: "number",
							description: "Maximum number of results (default: 5)",
						},
					},
					required: ["query"],
				},
			},
			{
				name: "hermes_learn",
				description:
					"Store a new lesson or knowledge in Hermes Claw memory. The content is embedded and stored in pgvector for future semantic recall.",
				inputSchema: {
					type: "object",
					properties: {
						topic: {
							type: "string",
							description: "The topic or subject of the lesson",
						},
						content: {
							type: "string",
							description: "The lesson content or knowledge to store",
						},
					},
					required: ["topic", "content"],
				},
			},
			{
				name: "hermes_learn_batch",
				description:
					"Store multiple lessons in bulk. Each lesson has a topic and content. More efficient than calling hermes_learn repeatedly.",
				inputSchema: {
					type: "object",
					properties: {
						lessons: {
							type: "array",
							description: "Array of lessons to store",
							items: {
								type: "object",
								properties: {
									topic: { type: "string", description: "The topic or subject of the lesson" },
									content: {
										type: "string",
										description: "The lesson content or knowledge to store",
									},
								},
								required: ["topic", "content"],
							},
						},
					},
					required: ["lessons"],
				},
			},
			{
				name: "hermes_list_skills",
				description: "List all reusable skills that have been created from recurring patterns and solutions.",
				inputSchema: {
					type: "object",
					properties: {},
				},
			},
			{
				name: "hermes_list_resources",
				description: "List all knowledge resources stored in Hermes Claw memory.",
				inputSchema: {
					type: "object",
					properties: {},
				},
			},
			{
				name: "hermes_stats",
				description:
					"Get Hermes Claw statistics including total operations, memory entries, skills, and lessons stored.",
				inputSchema: {
					type: "object",
					properties: {},
				},
			},
			// ── Commit/Deploy & Sync Tools ──
			{
				name: "commit_deploy_status",
				description:
					"Get the recent commit and deployment history across all coding agents. Returns SHA, agent, type, status, and timestamps.",
				inputSchema: {
					type: "object",
					properties: {
						limit: {
							type: "number",
							description: "Maximum number of commits and deploys to return (default: 5)",
						},
					},
				},
			},
			{
				name: "sync_status",
				description:
					"Get Central Brain sync status and health. Returns daemon connectivity, REST API status, local fallback availability, and sync state.",
				inputSchema: {
					type: "object",
					properties: {},
				},
			},
			{
				name: "codex_task_upsert",
				description:
					"Create or update persistent Codex task memory so future sessions can recover recent work.",
				inputSchema: {
					type: "object",
					properties: {
						id: { type: "string", description: "Existing task ID to update" },
						title: { type: "string", description: "Short task title" },
						summary: { type: "string", description: "What happened or what is being done" },
						status: {
							type: "string",
							description: "Task status: active, completed, blocked, or cancelled",
						},
						project: { type: "string", description: "Project ID (default: superroo2)" },
						agent: { type: "string", description: "Agent name (default: Codex)" },
						filesChanged: { type: "array", items: { type: "string" } },
						featuresAffected: { type: "array", items: { type: "string" } },
						notes: { type: "array", items: { type: "string" } },
					},
					required: ["title"],
				},
			},
			{
				name: "codex_task_list",
				description: "List recent persistent Codex tasks, newest first.",
				inputSchema: {
					type: "object",
					properties: {
						limit: { type: "number", description: "Maximum number of tasks to return (default: 20)" },
					},
				},
			},
			{
				name: "codex_task_get",
				description: "Get one persistent Codex task by ID.",
				inputSchema: {
					type: "object",
					properties: {
						id: { type: "string", description: "Task ID" },
					},
					required: ["id"],
				},
			},
			{
				name: "codex_task_get_active",
				description: "Get the current active persistent Codex task, if one exists.",
				inputSchema: {
					type: "object",
					properties: {},
				},
			},
			// ── Kimi Task Memory Tools ──
			{
				name: "kimi_task_upsert",
				description: "Create or update persistent Kimi task memory so future sessions can recover recent work.",
				inputSchema: {
					type: "object",
					properties: {
						id: { type: "string", description: "Existing task ID to update" },
						title: { type: "string", description: "Short task title" },
						summary: { type: "string", description: "What happened or what is being done" },
						status: {
							type: "string",
							description: "Task status: active, completed, blocked, or cancelled",
						},
						project: { type: "string", description: "Project ID (default: superroo2)" },
						agent: { type: "string", description: "Agent name (default: Kimi)" },
						filesChanged: { type: "array", items: { type: "string" } },
						featuresAffected: { type: "array", items: { type: "string" } },
						notes: { type: "array", items: { type: "string" } },
					},
					required: ["title"],
				},
			},
			{
				name: "kimi_task_list",
				description: "List recent persistent Kimi tasks, newest first.",
				inputSchema: {
					type: "object",
					properties: {
						limit: { type: "number", description: "Maximum number of tasks to return (default: 20)" },
					},
				},
			},
			{
				name: "kimi_task_get",
				description: "Get one persistent Kimi task by ID.",
				inputSchema: {
					type: "object",
					properties: {
						id: { type: "string", description: "Task ID" },
					},
					required: ["id"],
				},
			},
			{
				name: "kimi_task_get_active",
				description: "Get the current active persistent Kimi task, if one exists.",
				inputSchema: {
					type: "object",
					properties: {},
				},
			},
			// ── Claude Task Memory Tools ──
			{
				name: "claude_task_upsert",
				description:
					"Create or update persistent Claude task memory so future sessions can recover recent work.",
				inputSchema: {
					type: "object",
					properties: {
						id: { type: "string", description: "Existing task ID to update" },
						title: { type: "string", description: "Short task title" },
						summary: { type: "string", description: "What happened or what is being done" },
						status: {
							type: "string",
							description: "Task status: active, completed, blocked, or cancelled",
						},
						project: { type: "string", description: "Project ID (default: superroo2)" },
						agent: { type: "string", description: "Agent name (default: Claude)" },
						filesChanged: { type: "array", items: { type: "string" } },
						featuresAffected: { type: "array", items: { type: "string" } },
						notes: { type: "array", items: { type: "string" } },
					},
					required: ["title"],
				},
			},
			{
				name: "claude_task_list",
				description: "List recent persistent Claude tasks, newest first.",
				inputSchema: {
					type: "object",
					properties: {
						limit: { type: "number", description: "Maximum number of tasks to return (default: 20)" },
					},
				},
			},
			{
				name: "claude_task_get",
				description: "Get one persistent Claude task by ID.",
				inputSchema: {
					type: "object",
					properties: {
						id: { type: "string", description: "Task ID" },
					},
					required: ["id"],
				},
			},
			{
				name: "claude_task_get_active",
				description: "Get the current active persistent Claude task, if one exists.",
				inputSchema: {
					type: "object",
					properties: {},
				},
			},
			// ── SuperContinue Task Memory Tools ──
			{
				name: "supercontinue_task_upsert",
				description:
					"Create or update persistent SuperContinue task memory so future sessions can recover recent work.",
				inputSchema: {
					type: "object",
					properties: {
						id: { type: "string", description: "Existing task ID to update" },
						title: { type: "string", description: "Short task title" },
						summary: { type: "string", description: "What happened or what is being done" },
						status: {
							type: "string",
							description: "Task status: active, completed, blocked, or cancelled",
						},
						project: { type: "string", description: "Project ID (default: superroo2)" },
						agent: { type: "string", description: "Agent name (default: SuperContinue)" },
						filesChanged: { type: "array", items: { type: "string" } },
						featuresAffected: { type: "array", items: { type: "string" } },
						notes: { type: "array", items: { type: "string" } },
					},
					required: ["title"],
				},
			},
			{
				name: "supercontinue_task_list",
				description: "List recent persistent SuperContinue tasks, newest first.",
				inputSchema: {
					type: "object",
					properties: {
						limit: { type: "number", description: "Maximum number of tasks to return (default: 20)" },
					},
				},
			},
			{
				name: "supercontinue_task_get",
				description: "Get one persistent SuperContinue task by ID.",
				inputSchema: {
					type: "object",
					properties: {
						id: { type: "string", description: "Task ID" },
					},
					required: ["id"],
				},
			},
			{
				name: "supercontinue_task_get_active",
				description: "Get the current active persistent SuperContinue task, if one exists.",
				inputSchema: {
					type: "object",
					properties: {},
				},
			},
			// ── Central Brain v2 Tools (pgvector memory, scores, events, approvals) ──
			{
				name: "brain_search_memory",
				description:
					"Semantic search across pgvector memory using the Central Brain v2 API. Returns relevant memories ranked by cosine similarity. Use this to find lessons, bug fixes, and patterns stored in the pgvector knowledge base.",
				inputSchema: {
					type: "object",
					properties: {
						query: {
							type: "string",
							description: "The semantic search query describing what you're looking for",
						},
						projectId: {
							type: "string",
							description: "Optional project ID to scope the search (default: all projects)",
						},
						limit: {
							type: "number",
							description: "Maximum number of results (default: 10)",
						},
						minSimilarity: {
							type: "number",
							description: "Minimum similarity threshold 0-1 (default: 0.3)",
						},
						status: {
							type: "string",
							description: "Filter by memory status: candidate, approved, archived (default: approved)",
						},
					},
					required: ["query"],
				},
			},
			{
				name: "brain_get_scores",
				description:
					"Get the agent scores leaderboard from the Central Brain v2. Returns agent performance metrics including success rate, recency, volume, and composite score.",
				inputSchema: {
					type: "object",
					properties: {
						projectId: {
							type: "string",
							description: "Optional project ID to scope the leaderboard (default: all projects)",
						},
						limit: {
							type: "number",
							description: "Maximum number of agents to return (default: 20)",
						},
					},
				},
			},
			{
				name: "brain_get_events",
				description:
					"Get the brain events log from the Central Brain v2. Returns a chronological log of memory operations including creation, recall, merge, decay, and approval events.",
				inputSchema: {
					type: "object",
					properties: {
						projectId: {
							type: "string",
							description: "Optional project ID to scope the events (default: all projects)",
						},
						limit: {
							type: "number",
							description: "Maximum number of events to return (default: 50)",
						},
						eventType: {
							type: "string",
							description: "Optional filter by event type (e.g., memory.created, memory.recall, memory.merged)",
						},
					},
				},
			},
			{
				name: "brain_get_approvals",
				description:
					"Get pending memory approvals from the Central Brain v2. Returns memories that require human review before being committed to the knowledge base.",
				inputSchema: {
					type: "object",
					properties: {
						projectId: {
							type: "string",
							description: "Optional project ID to scope the approvals (default: all projects)",
						},
						limit: {
							type: "number",
							description: "Maximum number of pending approvals to return (default: 50)",
						},
					},
				},
			},
			{
				name: "brain_approve_memory",
				description:
					"Approve a pending memory in the Central Brain v2. Moves a candidate memory to approved status so it becomes available for semantic search.",
				inputSchema: {
					type: "object",
					properties: {
						approvalId: {
							type: "string",
							description: "The approval queue ID (from brain_get_approvals)",
						},
						reviewedBy: {
							type: "string",
							description: "Name of the reviewer (agent or human)",
						},
					},
					required: ["approvalId"],
				},
			},
			{
				name: "brain_reject_memory",
				description:
					"Reject a pending memory in the Central Brain v2. Moves a candidate memory to rejected status so it is excluded from semantic search.",
				inputSchema: {
					type: "object",
					properties: {
						approvalId: {
							type: "string",
							description: "The approval queue ID (from brain_get_approvals)",
						},
						reviewedBy: {
							type: "string",
							description: "Name of the reviewer (agent or human)",
						},
					},
					required: ["approvalId"],
				},
			},

			// ── Lesson Obligation Tools ──
			{
				name: "brain_store_lesson",
				description:
					"MANDATORY: Store a lesson in the Central Brain v2 pgvector memory. EVERY coding agent MUST call this tool before disconnecting to contribute a lesson about what was learned. This creates a searchable memory entry that future agents can retrieve via brain_search_memory. Call brain_register_lesson_intent at session start, then call this when you have a lesson to contribute.",
				inputSchema: {
					type: "object",
					properties: {
						title: {
							type: "string",
							description: "Short descriptive title for the lesson (e.g., 'Fixed WebSocket reconnection bug')",
						},
						content: {
							type: "string",
							description: "Full lesson content describing what was learned, the bug cause, fix applied, and reusable insight",
						},
						agent: {
							type: "string",
							description: "Your agent name (e.g., 'claude-code', 'codex', 'deepseek-coder')",
						},
						projectId: {
							type: "string",
							description: "Project ID (default: 'default')",
						},
						tags: {
							type: "array",
							items: { type: "string" },
							description: "Optional tags for categorization (e.g., ['bugfix', 'deployment', 'docker'])",
						},
						files: {
							type: "array",
							items: { type: "string" },
							description: "Optional file paths related to this lesson",
						},
						summary: {
							type: "string",
							description: "Optional one-line summary (default: auto-generated from title)",
						},
						confidence: {
							type: "number",
							description: "Confidence score 0-1 (default: 0.7)",
						},
					},
					required: ["title", "content", "agent"],
				},
			},
			{
				name: "brain_register_lesson_intent",
				description:
					"Register your intent to contribute a lesson. Call this at the START of your session to declare that you will store a lesson before disconnecting. The server tracks obligations and warns if agents disconnect without fulfilling them.",
				inputSchema: {
					type: "object",
					properties: {
						agent: {
							type: "string",
							description: "Your agent name (e.g., 'claude-code', 'codex', 'deepseek-coder')",
						},
						projectId: {
							type: "string",
							description: "Project ID (default: 'default')",
						},
						task: {
							type: "string",
							description: "Brief description of the task you're working on",
						},
					},
					required: ["agent"],
				},
			},
			{
				name: "brain_lesson_status",
				description:
					"Check your pending lesson obligation status. Returns whether you have registered intent and whether it has been fulfilled. Use this to verify you've met the lesson contribution requirement before disconnecting.",
				inputSchema: {
					type: "object",
					properties: {
						agent: {
							type: "string",
							description: "Your agent name (optional — returns all pending if omitted)",
						},
					},
				},
			},
			// ── Workflow Enforcement Tools ──
			{
				name: "brain_get_workflow_rules",
				description:
					"Get the mandated workflow rules for agents connecting to this MCP server. Returns the full ruleset including: (1) DeepSeek is the DEFAULT coder for all implementation tasks, (2) Ollama is the DEFAULT embeddings provider, (3) Central Brain (pgvector) is the DEFAULT memory store, (4) Every agent MUST contribute at least one lesson per session. Call this at session start to understand the required workflow.",
				inputSchema: {
					type: "object",
					properties: {},
				},
			},

			// ── Memory Evolution v3 Tools (versioning, feedback, propose, diff) ──
			{
				name: "brain_evolve_memory",
				description:
					"Evolve a memory by creating a new version with updated content. This preserves the full version history while updating the current content, embedding, and boosting confidence by +0.05. Use this when a memory needs to be refined or corrected.",
				inputSchema: {
					type: "object",
					properties: {
						memoryId: {
							type: "string",
							description: "The memory ID to evolve",
						},
						content: {
							type: "string",
							description: "The new/updated content for this memory",
						},
						reason: {
							type: "string",
							description: "Reason for the evolution (e.g., 'corrected bug analysis', 'added new insight')",
						},
						agent: {
							type: "string",
							description: "Agent name making the evolution (default: 'mcp-agent')",
						},
						projectId: {
							type: "string",
							description: "Project ID (default: 'default')",
						},
					},
					required: ["memoryId", "content", "reason"],
				},
			},
			{
				name: "brain_memory_versions",
				description:
					"Get the full version history for a memory. Returns all versions with content, change reason, agent, and timestamp. Use this to audit how a memory has evolved over time.",
				inputSchema: {
					type: "object",
					properties: {
						memoryId: {
							type: "string",
							description: "The memory ID to get version history for",
						},
						limit: {
							type: "number",
							description: "Maximum number of versions to return (default: 50)",
						},
					},
					required: ["memoryId"],
				},
			},
			{
				name: "brain_memory_diff",
				description:
					"Compare two versions of a memory and get a line-by-line diff. Shows what changed between any two version numbers, including the content, change reason, and timestamps for both versions.",
				inputSchema: {
					type: "object",
					properties: {
						memoryId: {
							type: "string",
							description: "The memory ID to diff",
						},
						fromVersion: {
							type: "number",
							description: "The source version number (e.g., 1)",
						},
						toVersion: {
							type: "number",
							description: "The target version number (e.g., 3)",
						},
					},
					required: ["memoryId", "fromVersion", "toVersion"],
				},
			},
			{
				name: "brain_memory_feedback",
				description:
					"Submit outcome-based feedback for a memory. This adjusts the memory's usefulness score: success feedback increases it, failure decreases it. Use this to train the brain which memories are actually useful in practice.",
				inputSchema: {
					type: "object",
					properties: {
						memoryId: {
							type: "string",
							description: "The memory ID to provide feedback for",
						},
						outcome: {
							type: "string",
							enum: ["success", "failure", "neutral"],
							description: "The outcome: 'success' (memory was helpful), 'failure' (memory was misleading), 'neutral' (no strong signal)",
						},
						score: {
							type: "number",
							description: "Score magnitude 0-1 (default: 0.1). Positive for success, negative applied for failure.",
						},
						agentName: {
							type: "string",
							description: "Agent providing the feedback (default: 'mcp-agent')",
						},
						taskId: {
							type: "string",
							description: "Optional task ID associated with this feedback",
						},
						note: {
							type: "string",
							description: "Optional note explaining the feedback",
						},
					},
					required: ["memoryId", "outcome"],
				},
			},
			{
				name: "brain_memory_usefulness",
				description:
					"Get the aggregated usefulness score for a memory. Returns the current usefulness (0-1), total feedback count, success/failure breakdown, and last feedback timestamp. Higher usefulness means the memory has proven valuable in practice.",
				inputSchema: {
					type: "object",
					properties: {
						memoryId: {
							type: "string",
							description: "The memory ID to get usefulness for",
						},
					},
					required: ["memoryId"],
				},
			},
			{
				name: "brain_propose_memory",
				description:
					"Propose a new memory with auto-trust logic. If confidence >= 0.82 and risk is low, the memory is auto-approved. Otherwise it enters the approval queue. Use this to suggest new knowledge for the brain with automatic quality gating.",
				inputSchema: {
					type: "object",
					properties: {
						projectId: {
							type: "string",
							description: "Project ID",
						},
						title: {
							type: "string",
							description: "Title for the memory",
						},
						content: {
							type: "string",
							description: "The memory content",
						},
						summary: {
							type: "string",
							description: "Optional one-line summary",
						},
						memoryType: {
							type: "string",
							enum: ["lesson", "bug", "pattern", "decision", "insight", "reference"],
							description: "Type of memory (default: 'lesson')",
						},
						tags: {
							type: "array",
							items: { type: "string" },
							description: "Optional tags for categorization",
						},
						files: {
							type: "array",
							items: { type: "string" },
							description: "Optional file paths related to this memory",
						},
						agent: {
							type: "string",
							description: "Agent name (default: 'mcp-agent')",
						},
						model: {
							type: "string",
							description: "Model used to generate this memory",
						},
						confidence: {
							type: "number",
							description: "Confidence score 0-1 (default: 0.75). >= 0.82 triggers auto-trust",
						},
						importance: {
							type: "number",
							description: "Importance score 0-1 (default: 0.5)",
						},
						riskLevel: {
							type: "string",
							enum: ["low", "medium", "high"],
							description: "Risk level (default: 'low'). Only 'low' risk + high confidence triggers auto-trust",
						},
					},
					required: ["projectId", "content"],
					},
				},
				{
					name: "brain_confidence_trend",
					description:
						"Get the confidence trend timeline for a memory. Returns data points showing how confidence has changed over time due to versions and feedback. Useful for understanding if a memory is improving or degrading.",
					inputSchema: {
						type: "object",
						properties: {
							memoryId: {
								type: "string",
								description: "The memory ID to get the confidence trend for",
							},
						},
						required: ["memoryId"],
					},
				},
				{
					name: "brain_memory_health",
					description:
						"Get a comprehensive memory health dashboard for a project. Returns 7 key metrics: total count, status breakdown, type breakdown, usage stats, decay count, version count, feedback count, and a health score (0-100).",
					inputSchema: {
						type: "object",
						properties: {
							projectId: {
								type: "string",
								description: "Project ID to get health metrics for",
							},
						},
						required: ["projectId"],
					},
				},
				{
					name: "brain_merge_suggestions",
					description:
						"Find memory pairs that are similar enough to suggest merging. Uses cosine similarity on embeddings to detect duplicates or near-duplicates. Returns pairs sorted by merge priority (0-100).",
					inputSchema: {
						type: "object",
						properties: {
							projectId: {
								type: "string",
								description: "Project ID to search for merge candidates",
							},
							threshold: {
								type: "number",
								description: "Similarity threshold 0-1 (default: 0.85). Higher = stricter matching",
							},
							limit: {
								type: "number",
								description: "Maximum number of suggestions (default: 20)",
							},
						},
						required: ["projectId"],
					},
				},
			]
		}
	
		/**
			* Register all MCP resources.
	 */
	private _registerResources(): void {
		this.resources = [
			{
				uri: "memory://context",
				name: "Full RAG Context",
				description:
					"Complete RAG context for the current project including relevant files, tasks, bugs, and feature memory",
				mimeType: "text/plain",
			},
			{
				uri: "memory://tasks",
				name: "Task List",
				description: "Current tasks and their statuses",
				mimeType: "application/json",
			},
			{
				uri: "memory://bugs",
				name: "Bug List",
				description: "Recent bugs and incidents",
				mimeType: "application/json",
			},
			{
				uri: "memory://projects",
				name: "Project List",
				description: "All registered projects and their memory summaries",
				mimeType: "application/json",
			},
			{
				uri: "memory://codex/tasks",
				name: "Codex Task Memory",
				description: "Persistent Codex task history",
				mimeType: "application/json",
			},
			{
				uri: "memory://kimi/tasks",
				name: "Kimi Task Memory",
				description: "Persistent Kimi task history",
				mimeType: "application/json",
			},
			{
				uri: "memory://supercontinue/tasks",
				name: "SuperContinue Task Memory",
				description: "Persistent SuperContinue task history",
				mimeType: "application/json",
			},
		]
	}

	/**
	 * Handle incoming HTTP requests (MCP over HTTP).
	 */
	private async _handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		res.setHeader("Access-Control-Allow-Origin", "*")
		res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
		res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if (req.method === "OPTIONS") {
			res.writeHead(204)
			res.end()
			return
		}

		// Health check — rich diagnostics
		if (req.method === "GET" && req.url === "/health") {
			const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000)
			const health = {
				ok: true,
				server: "mcp-memory",
				version: "2.0.0",
				uptime: {
					seconds: uptimeSeconds,
					human: `${Math.floor(uptimeSeconds / 60)}m ${uptimeSeconds % 60}s`,
					startedAt: new Date(this.startTime).toISOString(),
				},
				backends: {
					daemon: CENTRAL_BRAIN_URL,
					restApi: REST_API_FALLBACK_URL,
				},
				tools: {
					count: this.tools.length,
					names: this.tools.map((t) => t.name),
				},
				rateLimiter: {
					windowMs: RATE_LIMIT_WINDOW_MS,
					maxCalls: RATE_LIMIT_MAX_CALLS,
				},
				config: {
					port: MCP_SERVER_PORT,
					host: MCP_SERVER_HOST,
					memoryDir: MEMORY_DIR,
					healingDir: HEALING_DIR,
				},
			}
			this._json(res, 200, health)
			return
		}

		// MCP endpoint
		if (req.method === "POST" && req.url === "/mcp") {
			await this._handleMcpRequest(req, res)
			return
		}

		// List tools (for non-MCP clients)
		if (req.method === "GET" && req.url === "/tools") {
			this._json(res, 200, { tools: this.tools })
			return
		}

		// List resources
		if (req.method === "GET" && req.url === "/resources") {
			this._json(res, 200, { resources: this.resources })
			return
		}

		this._json(res, 404, { error: "not_found" })
	}

	/**
	 * Handle a single MCP JSON-RPC request.
	 */
	private async _handleMcpRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		let body = ""
		req.on("data", (chunk) => (body += chunk))
		req.on("end", async () => {
			let request: McpRequest
			try {
				request = JSON.parse(body)
			} catch {
				this._json(res, 400, {
					jsonrpc: "2.0",
					id: null,
					error: { code: -32700, message: "Parse error" },
				})
				return
			}

			if (request.jsonrpc !== "2.0") {
				this._json(res, 400, {
					jsonrpc: "2.0",
					id: request.id ?? null,
					error: { code: -32600, message: "Invalid Request" },
				})
				return
			}

			try {
				const result = await this._dispatch(request)
				this._json(res, 200, {
					jsonrpc: "2.0",
					id: request.id,
					result,
				})
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err)
				this._json(res, 200, {
					jsonrpc: "2.0",
					id: request.id,
					error: { code: -32603, message },
				})
			}
		})
	}

	/**
	 * Dispatch an MCP method call to the appropriate handler.
	 */
	private async _dispatch(request: McpRequest): Promise<unknown> {
		const { method, params } = request

		switch (method) {
			// ── MCP Required Methods ──
			case "initialize":
				return {
					protocolVersion: "2024-11-05",
					capabilities: {
						tools: {},
						resources: {},
					},
					serverInfo: {
						name: "superroo-mcp-memory",
						version: "1.1.0",
					},
					// ── Mandated Workflow Rules ──
					// All MCP clients MUST follow these rules. The workflowRules field
					// is an extension to the standard MCP initialize response that
					// SuperRoo agents can parse to auto-configure their tooling.
					workflowRules: {
						version: "1.0.0",
						defaultCoder: "deepseek",
						defaultEmbeddings: "ollama",
						defaultMemory: "central-brain-pgvector",
						lessonObligation: true,
						rules: [
							{
								id: "wf-001",
								description:
									"DeepSeek is the DEFAULT coder for all implementation tasks. Use the deepseek-coder MCP server for code generation, refactoring, and debugging.",
								severity: "mandatory",
							},
							{
								id: "wf-002",
								description:
									"Ollama is the DEFAULT embeddings provider for semantic search, lesson summarization, and vector generation. Use the ollama MCP server for embedding operations.",
								severity: "mandatory",
							},
							{
								id: "wf-003",
								description:
									"Central Brain (pgvector) is the DEFAULT memory store. Use brain_search_memory for semantic search and brain_store_lesson for persisting lessons.",
								severity: "mandatory",
							},
							{
								id: "wf-004",
								description:
									"Every coding agent MUST contribute at least one lesson per session. Call brain_register_lesson_intent at session start and brain_store_lesson before disconnecting.",
								severity: "mandatory",
							},
							{
								id: "wf-005",
								description:
									"When submitting tasks via submit_task, the 'agent' parameter should default to 'deepseek-coder' for implementation work.",
								severity: "recommended",
							},
							{
								id: "wf-006",
								description:
									"Use brain_search_memory (pgvector semantic search) instead of hermes_recall for memory retrieval. hermes_recall is deprecated for new agents.",
								severity: "recommended",
							},
						],
					},
				}

			case "ping":
				return { ok: true }

			// ── Tool Methods ──
			case "tools/list":
				return { tools: this.tools }

			case "tools/call":
				return this._handleToolCall(params as { name: string; arguments?: Record<string, unknown> })

			// ── Resource Methods ──
			case "resources/list":
				return { resources: this.resources }

			case "resources/read":
				return this._handleResourceRead(params as { uri: string })

			default:
				throw new Error(`Unknown method: ${method}`)
		}
	}

	/**
	 * Handle a tool call from an MCP client.
	 */
	private async _handleToolCall(params: { name: string; arguments?: Record<string, unknown> }): Promise<unknown> {
		const { name, arguments: args } = params
		const project = (args?.project as string) || "superroo2"
		const query = (args?.query as string) || ""
		const limit = Number(args?.maxResults || args?.limit || 10)
		const offset = Number(args?.offset || 0)

		// ── Rate limiting ──
		const rateCheck = this.rateLimiter.check(name)
		if (!rateCheck.allowed) {
			throw new Error(
				`Rate limit exceeded for tool '${name}'. Try again after ${safeIsoTimestamp(rateCheck.resetAt)}. Limit: ${RATE_LIMIT_MAX_CALLS} calls per ${RATE_LIMIT_WINDOW_MS / 1000}s window.`,
			)
		}

		switch (name) {
			// ── Daemon-proxied tools ──
			case "query_memory": {
				return await this._proxyWithFallback("query_memory", {
					query,
					project,
					maxResults: limit,
					offset,
				})
			}

			case "register_project": {
				const projName = (args?.name as string) || ""
				if (!projName) throw new Error("'name' is required")
				return await this._registerProject(projName, (args?.directory as string) || "")
			}

			case "get_project_info": {
				return await this._proxyWithFallback("get_project_info", { project })
			}

			case "list_projects": {
				return await this._proxyWithFallback("list_projects", {})
			}

			case "get_active_task": {
				return await this._proxyWithFallback("get_active_task", { project })
			}

			case "get_recent_bugs": {
				return await this._proxyWithFallback("get_recent_bugs", { project, limit })
			}

			case "search_code": {
				return await this._proxyWithFallback("search_code", {
					query,
					project,
					filePattern: args?.filePattern || undefined,
					maxResults: limit,
				})
			}

			case "submit_task": {
				const taskAgent = (args?.agent as string) || "coder"
				// Workflow enforcement: warn if agent is not deepseek-coder
				const workflowWarnings: string[] = []
				if (taskAgent !== "deepseek-coder" && taskAgent !== "deepseek") {
					workflowWarnings.push(
						`Workflow Rule wf-001: DeepSeek is the DEFAULT coder. Consider using agent="deepseek-coder" instead of "${taskAgent}".`,
					)
				}
				const result = await this._proxyWithFallback("submit_task", {
					goal: args?.goal || query,
					project,
					agent: taskAgent,
				})
				// Attach workflow warnings to the result
				if (workflowWarnings.length > 0) {
					const resultObj = (result as Record<string, unknown>) || {}
					resultObj.workflowWarnings = workflowWarnings
					return resultObj
				}
				return result
			}

			// ── Hermes Claw tools (try daemon first, fall back to REST API) ──
			case "hermes_recall": {
				const hermesLimit = Number(args?.limit || 5)
				return await this._proxyWithFallback("hermes_recall", {
					query,
					limit: hermesLimit,
				})
			}

			case "hermes_learn": {
				const topic = (args?.topic as string) || ""
				const content = (args?.content as string) || ""
				if (!topic || !content) {
					throw new Error("Both 'topic' and 'content' are required")
				}
				// Deduplication: check if a lesson with the same topic already exists locally
				const existing = await this._findDuplicateLesson(topic)
				if (existing) {
					return {
						success: true,
						deduplicated: true,
						existingLesson: existing,
						note: `Lesson with topic "${topic}" already exists. Use a different topic or update the existing lesson.`,
						source: "dedup_check",
					}
				}
				return await this._proxyWithFallback("hermes_learn", {
					topic,
					content,
				})
			}

			case "hermes_learn_batch": {
				const lessons = args?.lessons as Array<{ topic: string; content: string }> | undefined
				if (!Array.isArray(lessons) || lessons.length === 0) {
					throw new Error("'lessons' must be a non-empty array of { topic, content } objects")
				}
				const results: Array<{ topic: string; status: string; error?: string }> = []
				for (const lesson of lessons) {
					try {
						if (!lesson.topic || !lesson.content) {
							results.push({
								topic: lesson.topic || "(untitled)",
								status: "skipped",
								error: "Missing topic or content",
							})
							continue
						}
						// Dedup check for each lesson
						const existing = await this._findDuplicateLesson(lesson.topic)
						if (existing) {
							results.push({ topic: lesson.topic, status: "deduplicated" })
							continue
						}
						const resp = await this._proxyWithFallback("hermes_learn", {
							topic: lesson.topic,
							content: lesson.content,
						})
						results.push({ topic: lesson.topic, status: "stored" })
					} catch (err) {
						results.push({
							topic: lesson.topic,
							status: "error",
							error: err instanceof Error ? err.message : String(err),
						})
					}
				}
				return {
					success: true,
					results,
					total: lessons.length,
					stored: results.filter((r) => r.status === "stored").length,
				}
			}

			case "hermes_list_skills": {
				return await this._proxyWithFallback("hermes_list_skills", {})
			}

			case "hermes_list_resources": {
				return await this._proxyWithFallback("hermes_list_resources", {})
			}

			case "hermes_stats": {
				return await this._proxyWithFallback("hermes_stats", {})
			}

			// ── Commit/Deploy & Sync tools ──
			case "commit_deploy_status": {
				const cdLimit = Number(args?.limit || 5)
				return await this._proxyWithFallback("commit_deploy_status", {
					limit: cdLimit,
				})
			}

			case "sync_status": {
				return await this._getSyncStatus()
			}

			case "codex_task_upsert": {
				return await this._upsertCodexTask({
					id: args?.id || undefined,
					title: args?.title || "",
					summary: args?.summary || "",
					status: args?.status || "active",
					project,
					agent: args?.agent || "Codex",
					filesChanged: args?.filesChanged || [],
					featuresAffected: args?.featuresAffected || [],
					notes: args?.notes || [],
				})
			}

			case "codex_task_list": {
				return { success: true, tasks: await this._listCodexTasks(limit), source: "codex_task_log" }
			}

			case "codex_task_get": {
				return {
					success: true,
					task: await this._getCodexTask((args?.id as string) || ""),
					source: "codex_task_log",
				}
			}

			case "codex_task_get_active": {
				return { success: true, task: await this._getActiveCodexTask(), source: "codex_task_log" }
			}

			// ── Kimi Task Memory Tools ──
			case "kimi_task_upsert": {
				return await this._upsertKimiTask({
					id: args?.id || undefined,
					title: args?.title || "",
					summary: args?.summary || "",
					status: args?.status || "active",
					project,
					agent: args?.agent || "Kimi",
					filesChanged: args?.filesChanged || [],
					featuresAffected: args?.featuresAffected || [],
					notes: args?.notes || [],
				})
			}

			case "kimi_task_list": {
				return { success: true, tasks: await this._listKimiTasks(limit), source: "kimi_task_log" }
			}

			case "kimi_task_get": {
				return {
					success: true,
					task: await this._getKimiTask((args?.id as string) || ""),
					source: "kimi_task_log",
				}
			}

			case "kimi_task_get_active": {
				return { success: true, task: await this._getActiveKimiTask(), source: "kimi_task_log" }
			}

			// ── Claude Task Memory Tools ──
			case "claude_task_upsert": {
				return await this._upsertClaudeTask({
					id: args?.id || undefined,
					title: args?.title || "",
					summary: args?.summary || "",
					status: args?.status || "active",
					project,
					agent: args?.agent || "Claude",
					filesChanged: args?.filesChanged || [],
					featuresAffected: args?.featuresAffected || [],
					notes: args?.notes || [],
				})
			}

			case "claude_task_list": {
				return { success: true, tasks: await this._listClaudeTasks(limit), source: "claude_task_log" }
			}

			case "claude_task_get": {
				return {
					success: true,
					task: await this._getClaudeTask((args?.id as string) || ""),
					source: "claude_task_log",
				}
			}

			case "claude_task_get_active": {
				return { success: true, task: await this._getActiveClaudeTask(), source: "claude_task_log" }
			}

			// ── SuperContinue Task Memory Tools ──
			case "supercontinue_task_upsert": {
				return await this._upsertSuperContinueTask({
					id: args?.id || undefined,
					title: args?.title || "",
					summary: args?.summary || "",
					status: args?.status || "active",
					project,
					agent: args?.agent || "SuperContinue",
					filesChanged: args?.filesChanged || [],
					featuresAffected: args?.featuresAffected || [],
					notes: args?.notes || [],
				})
			}

			case "supercontinue_task_list": {
				return { success: true, tasks: await this._listSuperContinueTasks(limit), source: "supercontinue_task_log" }
			}

			case "supercontinue_task_get": {
				return {
					success: true,
					task: await this._getSuperContinueTask((args?.id as string) || ""),
					source: "supercontinue_task_log",
				}
			}

			case "supercontinue_task_get_active": {
				return { success: true, task: await this._getActiveSuperContinueTask(), source: "supercontinue_task_log" }
			}

			// ── Central Brain v2 Tools (pgvector memory, scores, events, approvals) ──
			case "brain_search_memory": {
				const searchQuery = (args?.query as string) || ""
				if (!searchQuery) throw new Error("'query' is required")
				const searchBody: Record<string, unknown> = {
					query: searchQuery,
					limit: Number(args?.limit || 10),
					minSimilarity: Number(args?.minSimilarity || 0.3),
				}
				if (args?.projectId) searchBody.projectId = args.projectId
				if (args?.status) searchBody.status = args.status
				return await this._proxyToBrainV2("POST", "/v2/memory/search", searchBody)
			}

			case "brain_get_scores": {
				const scoresParams: Record<string, unknown> = {
					limit: Number(args?.limit || 20),
				}
				if (args?.projectId) scoresParams.projectId = args.projectId
				const queryString = scoresParams.projectId
					? `?limit=${scoresParams.limit}&projectId=${encodeURIComponent(scoresParams.projectId as string)}`
					: `?limit=${scoresParams.limit}`
				return await this._proxyToBrainV2("GET", `/v2/scores${queryString}`)
			}

			case "brain_get_events": {
				const eventsParams: Record<string, unknown> = {
					limit: Number(args?.limit || 50),
				}
				if (args?.projectId) eventsParams.projectId = args.projectId
				if (args?.eventType) eventsParams.eventType = args.eventType
				let eventsQuery = `?limit=${eventsParams.limit}`
				if (eventsParams.projectId) eventsQuery += `&projectId=${encodeURIComponent(eventsParams.projectId as string)}`
				if (eventsParams.eventType) eventsQuery += `&eventType=${encodeURIComponent(eventsParams.eventType as string)}`
				return await this._proxyToBrainV2("GET", `/v2/events${eventsQuery}`)
			}

			case "brain_get_approvals": {
				const approvalsParams: Record<string, unknown> = {
					limit: Number(args?.limit || 50),
				}
				if (args?.projectId) approvalsParams.projectId = args.projectId
				const approvalsQuery = approvalsParams.projectId
					? `?limit=${approvalsParams.limit}&projectId=${encodeURIComponent(approvalsParams.projectId as string)}`
					: `?limit=${approvalsParams.limit}`
				return await this._proxyToBrainV2("GET", `/v2/approvals${approvalsQuery}`)
			}

			case "brain_approve_memory": {
				const approvalId = (args?.approvalId as string) || ""
				if (!approvalId) throw new Error("'approvalId' is required")
				return await this._proxyToBrainV2("POST", "/v2/approve", {
					approvalId,
					reviewedBy: (args?.reviewedBy as string) || "mcp-agent",
				})
			}

			case "brain_reject_memory": {
				const rejectId = (args?.approvalId as string) || ""
				if (!rejectId) throw new Error("'approvalId' is required")
				return await this._proxyToBrainV2("POST", "/v2/reject", {
					approvalId: rejectId,
					reviewedBy: (args?.reviewedBy as string) || "mcp-agent",
				})
			}

			case "brain_store_lesson": {
				const title = (args?.title as string) || ""
				if (!title) throw new Error("'title' is required")
				const content = (args?.content as string) || ""
				if (!content) throw new Error("'content' is required")
				const agent = (args?.agent as string) || "unknown-agent"
				const projectId = (args?.projectId as string) || "default"
				const tags = args?.tags as string[] | undefined
				const files = args?.files as string[] | undefined
				const summary = (args?.summary as string) || ""
				const confidence = args?.confidence as number | undefined

				const memoryBody: Record<string, unknown> = {
					title,
					content,
					agent,
					projectId,
					memoryType: "lesson",
					status: "candidate",
				}
				if (tags && Array.isArray(tags)) memoryBody.tags = tags
				if (files && Array.isArray(files)) memoryBody.files = files
				if (summary) memoryBody.summary = summary
				if (confidence !== undefined) memoryBody.importance = confidence

				const result = (await this._proxyToBrainV2("POST", "/v2/memory", memoryBody)) as Record<string, unknown>

				// Fulfill the lesson obligation for this agent
				const data = result?.data as Record<string, unknown> | undefined
				const memoryId = data?.id as string | undefined
				if (memoryId) {
					this.lessonTracker.fulfill(agent, memoryId)
				}

				return result
			}

			case "brain_register_lesson_intent": {
				const agent = (args?.agent as string) || ""
				if (!agent) throw new Error("'agent' is required")
				const projectId = (args?.projectId as string) || "default"
				const task = (args?.task as string) || "unspecified task"
				const obligation = this.lessonTracker.register(agent, projectId, task)
				return {
					success: true,
					message: `Lesson intent registered for agent "${agent}"`,
					obligation: {
						agent: obligation.agent,
						projectId: obligation.projectId,
						task: obligation.task.slice(0, 100),
						registeredAt: new Date(obligation.registeredAt).toISOString(),
						fulfilled: obligation.fulfilled,
					},
				}
			}

			case "brain_lesson_status": {
				const agent = (args?.agent as string) || ""
				if (!agent) {
					// Return summary for all agents
					const stats = this.lessonTracker.getStats()
					const pending = this.lessonTracker.getPending().map((ob) => ({
						agent: ob.agent,
						projectId: ob.projectId,
						task: ob.task.slice(0, 100),
						registeredAt: new Date(ob.registeredAt).toISOString(),
					}))
					return {
						success: true,
						stats,
						pending,
					}
				}
				const status = this.lessonTracker.getStatus(agent)
				return {
					success: true,
					agent,
					registered: status.registered,
					fulfilled: status.fulfilled,
					obligation: status.obligation
						? {
								agent: status.obligation.agent,
								projectId: status.obligation.projectId,
								task: status.obligation.task.slice(0, 100),
								registeredAt: new Date(status.obligation.registeredAt).toISOString(),
								fulfilled: status.obligation.fulfilled,
								lessonId: status.obligation.lessonId,
							}
						: null,
				}
			}

			// ── Memory Evolution v3 Tools (versioning, feedback, propose, diff) ──
			case "brain_evolve_memory": {
				const memoryId = (args?.memoryId as string) || ""
				if (!memoryId) throw new Error("'memoryId' is required")
				const content = (args?.content as string) || ""
				if (!content) throw new Error("'content' is required")
				const reason = (args?.reason as string) || "update"
				const agent = (args?.agent as string) || "mcp-agent"
				return await this._proxyToBrainV2("POST", `/v2/memory/${memoryId}/evolve`, {
					content,
					reason,
					agent,
					projectId: (args?.projectId as string) || "default",
				})
			}

			case "brain_memory_versions": {
				const memId = (args?.memoryId as string) || ""
				if (!memId) throw new Error("'memoryId' is required")
				const limit = Number(args?.limit || 50)
				return await this._proxyToBrainV2("GET", `/v2/memory/${memId}/versions?limit=${limit}`)
			}

			case "brain_memory_diff": {
				const diffMemId = (args?.memoryId as string) || ""
				if (!diffMemId) throw new Error("'memoryId' is required")
				const fromVersion = Number(args?.fromVersion || 0)
				const toVersion = Number(args?.toVersion || 0)
				if (!fromVersion || !toVersion) throw new Error("'fromVersion' and 'toVersion' are required")
				return await this._proxyToBrainV2(
					"GET",
					`/v2/memory/${diffMemId}/diff?from=${fromVersion}&to=${toVersion}`,
				)
			}

			case "brain_memory_feedback": {
				const fbMemId = (args?.memoryId as string) || ""
				if (!fbMemId) throw new Error("'memoryId' is required")
				const outcome = (args?.outcome as string) || ""
				if (!["success", "failure", "neutral"].includes(outcome))
					throw new Error("'outcome' must be 'success', 'failure', or 'neutral'")
				const score = Number(args?.score || 0.1)
				return await this._proxyToBrainV2("POST", `/v2/memory/${fbMemId}/feedback`, {
					outcome,
					score,
					agentName: (args?.agentName as string) || "mcp-agent",
					taskId: (args?.taskId as string) || undefined,
					note: (args?.note as string) || undefined,
				})
			}

			case "brain_memory_usefulness": {
				const uMemId = (args?.memoryId as string) || ""
				if (!uMemId) throw new Error("'memoryId' is required")
				return await this._proxyToBrainV2("GET", `/v2/memory/${uMemId}/usefulness`)
			}

			case "brain_propose_memory": {
				const projectId = (args?.projectId as string) || ""
				if (!projectId) throw new Error("'projectId' is required")
				const proposeContent = (args?.content as string) || ""
				if (!proposeContent) throw new Error("'content' is required")
				// Validate memoryType against allowed values
				const VALID_MEMORY_TYPES = ["lesson", "bug", "pattern", "decision", "insight", "reference"]
				const rawMemoryType = (args?.memoryType as string) || "lesson"
				const memoryType = VALID_MEMORY_TYPES.includes(rawMemoryType) ? rawMemoryType : "lesson"
				if (rawMemoryType !== memoryType) {
					console.warn(`[McpMemoryServer] Invalid memoryType "${rawMemoryType}", defaulting to "lesson"`)
				}
				const proposeBody: Record<string, unknown> = {
					projectId,
					title: (args?.title as string) || "",
					content: proposeContent,
					summary: (args?.summary as string) || "",
					memoryType,
					tags: args?.tags as string[] | undefined,
					agent: (args?.agent as string) || "mcp-agent",
					model: (args?.model as string) || undefined,
					confidence: args?.confidence !== undefined ? Number(args.confidence) : 0.75,
					importance: args?.importance !== undefined ? Number(args.importance) : 0.5,
					riskLevel: (args?.riskLevel as string) || "low",
				}
				if (args?.files) proposeBody.files = args.files
				return await this._proxyToBrainV2("POST", "/v2/memory", proposeBody)
			}

			// ── Memory Evolution Innovative Tools ──
			case "brain_confidence_trend": {
				const ctMemId = (args?.memoryId as string) || ""
				if (!ctMemId) throw new Error("'memoryId' is required")
				return await this._proxyToBrainV2("GET", `/v2/memory/${ctMemId}/confidence-trend`)
			}

			case "brain_memory_health": {
				const mhProjectId = (args?.projectId as string) || ""
				if (!mhProjectId) throw new Error("'projectId' is required")
				return await this._proxyToBrainV2("GET", `/v2/memory/health?project=${encodeURIComponent(mhProjectId)}`)
			}

			case "brain_merge_suggestions": {
				const msProjectId = (args?.projectId as string) || ""
				if (!msProjectId) throw new Error("'projectId' is required")
				const msThreshold = args?.threshold !== undefined ? Number(args.threshold) : 0.85
				const msLimit = args?.limit !== undefined ? Number(args.limit) : 20
				return await this._proxyToBrainV2(
					"GET",
					`/v2/memory/merge-suggestions?project=${encodeURIComponent(msProjectId)}&threshold=${msThreshold}&limit=${msLimit}`,
				)
			}

			// ── Consensus & Model Routing Tools ──
			case "brain_consensus_decide": {
				const cdProjectId = (args?.projectId as string) || "default"
				const cdDecisionType = args?.decisionType as string
				if (!cdDecisionType) throw new Error("'decisionType' is required (deploy|memory_approval|task_approval|model_selection|custom)")
				const cdContextId = args?.contextId as string
				const cdVotes = args?.votes as Array<{ agent: string; vote: string; confidence: number; reason?: string }>
				if (!cdVotes || !Array.isArray(cdVotes) || cdVotes.length === 0)
					throw new Error("'votes' is required and must be a non-empty array")
				const cdCreatedBy = (args?.createdBy as string) || "mcp"
				return await this._proxyToBrainV2("POST", "/v2/consensus/decide", {
					projectId: cdProjectId,
					decisionType: cdDecisionType,
					contextId: cdContextId,
					votes: cdVotes,
					createdBy: cdCreatedBy,
				})
			}

			case "brain_consensus_list": {
				const clProjectId = args?.projectId as string
				const clDecisionType = args?.decisionType as string
				const clFinalDecision = args?.finalDecision as string
				const clLimit = args?.limit !== undefined ? Number(args.limit) : 50
				const clOffset = args?.offset !== undefined ? Number(args.offset) : 0
				const queryParams = new URLSearchParams()
				if (clProjectId) queryParams.set("projectId", clProjectId)
				if (clDecisionType) queryParams.set("decisionType", clDecisionType)
				if (clFinalDecision) queryParams.set("finalDecision", clFinalDecision)
				queryParams.set("limit", String(clLimit))
				queryParams.set("offset", String(clOffset))
				return await this._proxyToBrainV2("GET", `/v2/consensus/decisions?${queryParams.toString()}`)
			}

			case "brain_consensus_stats": {
				const csProjectId = (args?.projectId as string) || "default"
				return await this._proxyToBrainV2("GET", `/v2/consensus/stats?projectId=${encodeURIComponent(csProjectId)}`)
			}

			case "brain_router_select": {
				const rsProjectId = (args?.projectId as string) || "default"
				const rsTaskType = args?.taskType as string
				if (!rsTaskType) throw new Error("'taskType' is required")
				const rsTaskId = args?.taskId as string
				const rsRunId = args?.runId as string
				return await this._proxyToBrainV2("POST", "/v2/router/route", {
					projectId: rsProjectId,
					taskType: rsTaskType,
					taskId: rsTaskId,
					runId: rsRunId,
				})
			}

			case "brain_router_outcome": {
				const roProjectId = (args?.projectId as string) || "default"
				const roTaskType = args?.taskType as string
				if (!roTaskType) throw new Error("'taskType' is required")
				const roAgent = args?.agent as string
				if (!roAgent) throw new Error("'agent' is required")
				const roModelSelected = args?.modelSelected as string
				if (!roModelSelected) throw new Error("'modelSelected' is required")
				const roSuccess = args?.success as boolean
				if (roSuccess === undefined) throw new Error("'success' is required")
				return await this._proxyToBrainV2("POST", "/v2/router/outcome", {
					projectId: roProjectId,
					taskType: roTaskType,
					taskId: args?.taskId as string,
					runId: args?.runId as string,
					agent: roAgent,
					modelSelected: roModelSelected,
					fallbackChain: args?.fallbackChain,
					attempt: args?.attempt !== undefined ? Number(args.attempt) : 1,
					success: roSuccess,
					durationMs: args?.durationMs !== undefined ? Number(args.durationMs) : undefined,
					costUsd: args?.costUsd !== undefined ? Number(args.costUsd) : undefined,
					hallucinated: args?.hallucinated === true,
					error: args?.error as string,
				})
			}

			case "brain_router_logs": {
				const rlProjectId = args?.projectId as string
				const rlTaskType = args?.taskType as string
				const rlAgent = args?.agent as string
				const rlLimit = args?.limit !== undefined ? Number(args.limit) : 50
				const rlOffset = args?.offset !== undefined ? Number(args.offset) : 0
				const queryParams = new URLSearchParams()
				if (rlProjectId) queryParams.set("projectId", rlProjectId)
				if (rlTaskType) queryParams.set("taskType", rlTaskType)
				if (rlAgent) queryParams.set("agent", rlAgent)
				queryParams.set("limit", String(rlLimit))
				queryParams.set("offset", String(rlOffset))
				return await this._proxyToBrainV2("GET", `/v2/router/logs?${queryParams.toString()}`)
			}

			case "brain_router_performance": {
				const rpProjectId = (args?.projectId as string) || "default"
				return await this._proxyToBrainV2("GET", `/v2/router/performance?projectId=${encodeURIComponent(rpProjectId)}`)
			}

			// ── Workflow Enforcement Tools ──
			case "brain_get_workflow_rules": {
				return {
					success: true,
					version: "1.0.0",
					defaultCoder: "deepseek",
					defaultEmbeddings: "ollama",
					defaultMemory: "central-brain-pgvector",
					lessonObligation: true,
					rules: [
						{
							id: "wf-001",
							description:
								"DeepSeek is the DEFAULT coder for all implementation tasks. Use the deepseek-coder MCP server for code generation, refactoring, and debugging.",
							severity: "mandatory",
						},
						{
							id: "wf-002",
							description:
								"Ollama is the DEFAULT embeddings provider for semantic search, lesson summarization, and vector generation. Use the ollama MCP server for embedding operations.",
							severity: "mandatory",
						},
						{
							id: "wf-003",
							description:
								"Central Brain (pgvector) is the DEFAULT memory store. Use brain_search_memory for semantic search and brain_store_lesson for persisting lessons.",
							severity: "mandatory",
						},
						{
							id: "wf-004",
							description:
								"Every coding agent MUST contribute at least one lesson per session. Call brain_register_lesson_intent at session start and brain_store_lesson before disconnecting.",
							severity: "mandatory",
						},
						{
							id: "wf-005",
							description:
								"When submitting tasks via submit_task, the 'agent' parameter should default to 'deepseek-coder' for implementation work.",
							severity: "recommended",
						},
						{
							id: "wf-006",
							description:
								"Use brain_search_memory (pgvector semantic search) instead of hermes_recall for memory retrieval. hermes_recall is deprecated for new agents.",
							severity: "recommended",
						},
					],
				}
			}

			default:
				throw new Error(`Unknown tool: ${name}`)
		}
	}

	/**
	 * Handle a resource read request.
	 */
	private async _handleResourceRead(params: { uri: string }): Promise<unknown> {
		const { uri } = params

		switch (uri) {
			case "memory://context":
				return await this._proxyWithFallback("get_context", { project: "superroo2" })

			case "memory://tasks":
				return await this._proxyWithFallback("get_tasks", { project: "superroo2" })

			case "memory://bugs":
				return await this._proxyWithFallback("get_bugs", { project: "superroo2" })

			case "memory://projects":
				return await this._proxyWithFallback("list_projects", {})

			case "memory://codex/tasks":
				return { success: true, tasks: await this._listCodexTasks(20), source: "codex_task_log" }

			case "memory://kimi/tasks":
				return { success: true, tasks: await this._listKimiTasks(20), source: "kimi_task_log" }

			case "memory://claude/tasks":
				return { success: true, tasks: await this._listClaudeTasks(20), source: "claude_task_log" }

			case "memory://supercontinue/tasks":
				return { success: true, tasks: await this._listSuperContinueTasks(20), source: "supercontinue_task_log" }

			default:
				// Try project-specific URIs: memory://{project}/context
				const match = uri.match(/^memory:\/\/([^/]+)\/(.+)$/)
				if (match) {
					const projectId = match[1]
					const resource = match[2]
					return await this._proxyWithFallback(`get_${resource}`, { project: projectId })
				}
				throw new Error(`Unknown resource: ${uri}`)
		}
	}

	/**
	 * Proxy a request with fallback chain:
	 *   1. Try Central Brain daemon (CENTRAL_BRAIN_URL)
	 *   2. If daemon succeeds but returns { success: false }, also fall through
	 *   3. If daemon fails, try REST API fallback (REST_API_FALLBACK_URL)
	 *   4. If both fail, use local JSON file fallback
	 */
	private async _proxyWithFallback(action: string, params: Record<string, unknown>): Promise<unknown> {
		// Try daemon first
		try {
			const result = await this._proxyToDaemon(action, params)
			// CRITICAL FIX: Check if daemon returned success: false (e.g., HermesClaw not initialized)
			// If so, treat it as a failure and fall through to REST API / local fallback
			if (result && typeof result === "object" && "success" in (result as Record<string, unknown>)) {
				const r = result as Record<string, unknown>
				if (r.success === false) {
					console.log(
						`[mcp-memory] Daemon returned success:false for '${action}', trying fallback: ${(r.error as string) || "unknown error"}`,
					)
					throw new Error(`Daemon returned success:false: ${(r.error as string) || "unknown error"}`)
				}
			}
			return result
		} catch (daemonErr) {
			console.log(
				`[mcp-memory] Daemon proxy failed for '${action}', trying REST API fallback: ${daemonErr instanceof Error ? daemonErr.message : String(daemonErr)}`,
			)
			// Fall back to REST API
			try {
				const restResult = await this._proxyToRestApi(action, params)
				// Also check REST API for success:false
				if (
					restResult &&
					typeof restResult === "object" &&
					"success" in (restResult as Record<string, unknown>)
				) {
					const r = restResult as Record<string, unknown>
					if (r.success === false) {
						throw new Error(`REST API returned success:false: ${(r.error as string) || "unknown error"}`)
					}
				}
				return restResult
			} catch (restErr) {
				console.log(
					`[mcp-memory] REST fallback failed for '${action}', using local JSON fallback: ${restErr instanceof Error ? restErr.message : String(restErr)}`,
				)
				// Final fallback: local files
				return this._handleLocalFallback(action, params)
			}
		}
	}

	/**
	 * Local JSON file fallback when both daemon and REST API are unreachable.
	 */
	private async _handleLocalFallback(action: string, params: Record<string, unknown>): Promise<unknown> {
		const project = (params.project as string) || "superroo2"
		const limit = Number(params.limit || params.maxResults || 10)
		const query = (params.query as string) || ""
		const offset = Number(params.offset || 0)

		switch (action) {
			case "query_memory": {
				const results = await this._searchLocalMemory(query, limit + offset)
				// Apply pagination: slice from offset to offset+limit
				const paginated = results.slice(offset, offset + limit)
				return {
					success: true,
					results: paginated,
					total: results.length,
					offset,
					limit,
					source: "local_json_fallback",
					note: "Central Brain offline — serving from local JSON files",
				}
			}

			case "get_project_info": {
				return {
					success: true,
					project,
					workspaceRoot: process.cwd(),
					memoryDir: MEMORY_DIR,
					healingDir: HEALING_DIR,
					source: "local_json_fallback",
				}
			}

			case "list_projects": {
				// Scan ~/.superroo/config.json for registered projects
				const configProjects = await this._readSuperrooConfig()
				const projects = Object.keys(configProjects).length > 0 ? Object.keys(configProjects) : ["superroo2"]
				return {
					success: true,
					projects,
					projectDetails: configProjects,
					source: "local_json_fallback",
				}
			}

			case "get_active_task": {
				const task = await this._getActiveCodexTask()
				return { success: true, task, source: "local_json_fallback" }
			}

			case "get_recent_bugs": {
				const bugs = await this._readLocalBugs(limit)
				return { success: true, bugs, source: "local_json_fallback" }
			}

			case "search_code": {
				return {
					success: true,
					results: [],
					source: "local_json_fallback",
					note: "Local code search requires Qdrant index (not available in offline mode)",
				}
			}

			case "submit_task": {
				const goal = (params.goal as string) || query || "Untitled task"
				return await this._upsertCodexTask({
					title: goal.slice(0, 120),
					summary: goal,
					status: "active",
					project,
					agent: params.agent || "coder",
				})
			}

			case "hermes_recall":
			case "hermes_learn":
			case "hermes_list_skills":
			case "hermes_list_resources":
			case "hermes_stats": {
				return {
					success: true,
					results: [],
					source: "local_json_fallback",
					note: "Hermes Claw requires pgvector / PostgreSQL (not available in offline mode)",
				}
			}

			case "commit_deploy_status": {
				const log = await this._readLocalCommitDeployLog(limit)
				return {
					success: true,
					commits: log.commits || [],
					deploys: log.deploys || [],
					source: "local_json_fallback",
				}
			}

			case "get_context": {
				const results = await this._searchLocalMemory("project context", limit)
				return { success: true, context: results, source: "local_json_fallback" }
			}

			case "get_tasks": {
				const tasks = await this._listCodexTasks(limit)
				return { success: true, tasks, source: "local_json_fallback" }
			}

			case "get_bugs": {
				const bugs = await this._readLocalBugs(limit)
				return { success: true, bugs, source: "local_json_fallback" }
			}

			case "supercontinue_task_upsert": {
				const goal = (params.goal as string) || query || "Untitled task"
				return await this._upsertSuperContinueTask({
					title: goal.slice(0, 120),
					summary: goal,
					status: "active",
					project,
					agent: params.agent || "SuperContinue",
				})
			}

			default:
				throw new Error(`Local fallback not implemented for action: ${action}`)
		}
	}

	private async _readJsonFile<T>(filePath: string, defaultValue: T): Promise<T> {
		try {
			const raw = await fs.readFile(filePath, "utf8")
			return JSON.parse(raw) as T
		} catch (err) {
			if (isNodeError(err) && err.code === "ENOENT") {
				return defaultValue
			}
			throw err
		}
	}

	private async _readLocalBugs(limit: number): Promise<unknown[]> {
		try {
			const incidents = await this._readJsonFile<{ incidents?: unknown[] }>(
				path.join(HEALING_DIR, "healing-incidents.json"),
				{ incidents: [] },
			)
			return (incidents.incidents || []).slice(0, limit)
		} catch {
			return []
		}
	}

	private async _readLocalCommitDeployLog(limit: number): Promise<{ commits?: unknown[]; deploys?: unknown[] }> {
		try {
			const log = await this._readJsonFile<{ commits?: unknown[]; deploys?: unknown[] }>(
				path.join(MEMORY_DIR, "commit-deploy-log.json"),
				{ commits: [], deploys: [] },
			)
			return {
				commits: (log.commits || []).slice(-limit),
				deploys: (log.deploys || []).slice(-limit),
			}
		} catch {
			return { commits: [], deploys: [] }
		}
	}

	private async _searchLocalMemory(query: string, limit: number): Promise<unknown[]> {
		const results: Array<{ file: string; matches: unknown[] }> = []
		const q = query.toLowerCase()

		const files = [
			{ path: path.join(MEMORY_DIR, "commit-deploy-log.json"), key: "commits" },
			{ path: path.join(MEMORY_DIR, "bug-feature-map.json"), key: "bugs" },
			{ path: path.join(MEMORY_DIR, "product-features.json"), key: "features" },
			{ path: path.join(MEMORY_DIR, "codextask.json"), key: "tasks" },
			{ path: path.join(MEMORY_DIR, "kimi.json"), key: "tasks" },
			{ path: path.join(MEMORY_DIR, "claudetask.json"), key: "tasks" },
			{ path: path.join(HEALING_DIR, "healing-incidents.json"), key: "incidents" },
		]

		for (const f of files) {
			try {
				const data = await this._readJsonFile<Record<string, unknown>>(f.path, {})
				const arr = data[f.key] as unknown[] | undefined
				if (!Array.isArray(arr)) continue
				const matches = arr.filter((item) => JSON.stringify(item).toLowerCase().includes(q)).slice(0, limit)
				if (matches.length > 0) {
					results.push({ file: path.basename(f.path), matches })
				}
			} catch {
				// skip unreadable files
			}
		}

		// Also search lesson-index.jsonl (JSONL format — one JSON object per line)
		try {
			const raw = await fs.readFile(LESSON_INDEX_PATH, "utf8")
			const lines = raw.split("\n").filter((l) => l.trim())
			const lessonMatches: unknown[] = []
			for (const line of lines) {
				try {
					const entry = JSON.parse(line) as Record<string, unknown>
					if (JSON.stringify(entry).toLowerCase().includes(q)) {
						lessonMatches.push(entry)
						if (lessonMatches.length >= limit) break
					}
				} catch {
					// skip malformed JSON lines
				}
			}
			if (lessonMatches.length > 0) {
				results.push({ file: "lesson-index.jsonl", matches: lessonMatches })
			}
		} catch {
			// skip unreadable files
		}

		// Also search lessons-learned.md (markdown with ### Lesson: blocks)
		try {
			const raw = await fs.readFile(LESSONS_LEARNED_PATH, "utf8")
			const lessonBlocks = raw.split("### ")
			const mdMatches: unknown[] = []
			for (const block of lessonBlocks) {
				if (!block.trim()) continue
				if (block.toLowerCase().includes(q)) {
					const titleLine = block.split("\n")[0]?.trim() || "(untitled)"
					mdMatches.push({
						title: titleLine,
						content: block.slice(0, 500).trim(),
						source: "lessons-learned.md",
					})
					if (mdMatches.length >= limit) break
				}
			}
			if (mdMatches.length > 0) {
				results.push({ file: "lessons-learned.md", matches: mdMatches })
			}
		} catch {
			// skip unreadable files
		}

		return results.slice(0, limit)
	}

	// ── New Helper Methods ──

	/**
	 * Read the ~/.superroo/config.json file and return registered projects.
	 * Returns an empty object if the file doesn't exist or is invalid.
	 */
	private async _readSuperrooConfig(): Promise<Record<string, SuperrooProjectConfig>> {
		try {
			const raw = await fs.readFile(SUPERROO_CONFIG_PATH, "utf8")
			const parsed = JSON.parse(raw) as { projects?: Record<string, SuperrooProjectConfig> }
			if (parsed && typeof parsed === "object" && parsed.projects && typeof parsed.projects === "object") {
				return parsed.projects as Record<string, SuperrooProjectConfig>
			}
			return {}
		} catch (err) {
			if (isNodeError(err) && (err.code === "ENOENT" || err.code === "ENOTDIR")) {
				return {}
			}
			// Log unexpected errors but don't crash
			console.warn(
				`[mcp-memory] Failed to read superroo config at ${SUPERROO_CONFIG_PATH}:`,
				err instanceof Error ? err.message : String(err),
			)
			return {}
		}
	}

	/**
	 * Register a project in ~/.superroo/config.json.
	 * Creates the file and parent directories if they don't exist.
	 */
	private async _registerProject(name: string, directory: string): Promise<unknown> {
		if (!name) {
			throw new Error("Project name is required")
		}

		const configDir = path.dirname(SUPERROO_CONFIG_PATH)
		await fs.mkdir(configDir, { recursive: true })

		let config: { projects: Record<string, SuperrooProjectConfig> }
		try {
			const raw = await fs.readFile(SUPERROO_CONFIG_PATH, "utf8")
			const parsed = JSON.parse(raw) as Partial<{ projects: Record<string, SuperrooProjectConfig> }>
			config = { projects: (parsed?.projects as Record<string, SuperrooProjectConfig>) || {} }
		} catch {
			config = { projects: {} }
		}

		const resolvedDir = directory || process.cwd()
		config.projects[name] = {
			name,
			directory: resolvedDir,
			registeredAt: new Date().toISOString(),
		}

		// Atomic write
		const tempPath = `${SUPERROO_CONFIG_PATH}.tmp`
		await fs.writeFile(tempPath, JSON.stringify(config, null, 2), "utf8")
		await fs.rename(tempPath, SUPERROO_CONFIG_PATH)

		return {
			success: true,
			project: config.projects[name],
			source: "local_config",
		}
	}

	/**
	 * Find a duplicate lesson by searching local lesson files for a matching topic.
	 * Checks both lessons-learned.md and lesson-index.jsonl.
	 */
	private async _findDuplicateLesson(
		topic: string,
	): Promise<{ topic: string; content?: string; source: string } | null> {
		if (!topic) return null

		const normalizedTopic = topic.toLowerCase().trim()

		// Check lesson-index.jsonl first (faster)
		try {
			const raw = await fs.readFile(LESSON_INDEX_PATH, "utf8")
			const lines = raw.split("\n").filter((l) => l.trim())
			for (const line of lines) {
				try {
					const entry = JSON.parse(line) as { topic?: string; title?: string }
					const entryTopic = (entry.topic || entry.title || "").toLowerCase().trim()
					if (entryTopic === normalizedTopic || entryTopic.includes(normalizedTopic)) {
						return { topic: entry.topic || entry.title || topic, source: "lesson_index" }
					}
				} catch {
					// Skip malformed JSON lines
				}
			}
		} catch (err) {
			if (!isNodeError(err) || err.code !== "ENOENT") {
				console.warn(
					`[mcp-memory] Failed to read lesson index: ${err instanceof Error ? err.message : String(err)}`,
				)
			}
		}

		// Fall back to lessons-learned.md
		try {
			const raw = await fs.readFile(LESSONS_LEARNED_PATH, "utf8")
			const lessonBlocks = raw.split("### ")
			for (const block of lessonBlocks) {
				if (!block.trim()) continue
				const titleLine = block.split("\n")[0]?.trim() || ""
				if (titleLine.toLowerCase().includes(normalizedTopic)) {
					return { topic: titleLine, content: block.slice(0, 500), source: "lessons_learned_md" }
				}
			}
		} catch (err) {
			if (!isNodeError(err) || err.code !== "ENOENT") {
				console.warn(
					`[mcp-memory] Failed to read lessons file: ${err instanceof Error ? err.message : String(err)}`,
				)
			}
		}

		return null
	}

	/**
	 * Get sync status by testing connectivity to all available backends.
	 * Tests daemon, REST API fallback, and local fallback.
	 */
	private async _getSyncStatus(): Promise<unknown> {
		const status: Record<string, unknown> = {
			server: {
				uptime: Date.now() - this.startTime,
				uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
				startedAt: new Date(this.startTime).toISOString(),
			},
			rateLimiter: {
				windowMs: RATE_LIMIT_WINDOW_MS,
				maxCalls: RATE_LIMIT_MAX_CALLS,
			},
			backends: {} as Record<string, unknown>,
		}

		// Test daemon connectivity
		try {
			const daemonResult = await this._proxyToDaemon("ping", {})
			;(status.backends as Record<string, unknown>).daemon = {
				reachable: true,
				url: CENTRAL_BRAIN_URL,
				response: daemonResult,
			}
		} catch (err) {
			;(status.backends as Record<string, unknown>).daemon = {
				reachable: false,
				url: CENTRAL_BRAIN_URL,
				error: err instanceof Error ? err.message : String(err),
			}
		}

		// Test REST API fallback connectivity
		try {
			const restResult = await this._proxyToRestApi("ping", {})
			;(status.backends as Record<string, unknown>).restApi = {
				reachable: true,
				url: REST_API_FALLBACK_URL,
				response: restResult,
			}
		} catch (err) {
			;(status.backends as Record<string, unknown>).restApi = {
				reachable: false,
				url: REST_API_FALLBACK_URL,
				error: err instanceof Error ? err.message : String(err),
			}
		}

		// Test local fallback
		try {
			const localResult = await this._handleLocalFallback("list_projects", {})
			;(status.backends as Record<string, unknown>).localFallback = {
				reachable: true,
				source: (localResult as Record<string, unknown>)?.source || "unknown",
			}
		} catch (err) {
			;(status.backends as Record<string, unknown>).localFallback = {
				reachable: false,
				error: err instanceof Error ? err.message : String(err),
			}
		}

		// Determine overall health
		const backends = status.backends as Record<string, { reachable: boolean }>
		const reachableCount = Object.values(backends).filter((b) => b.reachable).length
		status.overall = reachableCount >= 2 ? "healthy" : reachableCount === 1 ? "degraded" : "offline"
		status.reachableBackends = reachableCount
		status.totalBackends = Object.keys(backends).length

		return { success: true, status, source: "sync_status_check" }
	}

	/**
	 * Proxy a request to the Central Brain daemon.
	 */
	private async _proxyToDaemon(action: string, params: Record<string, unknown>): Promise<unknown> {
		const headers: Record<string, string> = {
			"content-type": "application/json",
		}
		if (DAEMON_TOKEN) {
			headers["authorization"] = `Bearer ${DAEMON_TOKEN}`
		}

		const res = await fetch(`${CENTRAL_BRAIN_URL}/brain/mcp`, {
			method: "POST",
			headers,
			body: JSON.stringify({ action, params }),
			signal: AbortSignal.timeout(10_000),
		})

		if (!res.ok) {
			const text = await res.text()
			throw new Error(`Daemon proxy error (${res.status}): ${text}`)
		}

		const json = await res.json()
		return json
	}

	/**
	 * Proxy a request to the REST API fallback (port 8787 /brain/mcp endpoint).
	 */
	private async _proxyToRestApi(action: string, params: Record<string, unknown>): Promise<unknown> {
		const res = await fetch(`${REST_API_FALLBACK_URL}/brain/mcp`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
			},
			body: JSON.stringify({ action, params }),
			signal: AbortSignal.timeout(15_000),
		})

		if (!res.ok) {
			const text = await res.text()
			throw new Error(`REST API fallback error (${res.status}): ${text}`)
		}

		const json = await res.json()
		return json
	}

	/**
	 * Proxy a request to the Central Brain v2 REST API (port 3456 /api/brain/v2/*).
	 * Used by brain_search_memory, brain_get_scores, brain_get_events,
	 * brain_get_approvals, brain_approve_memory, brain_reject_memory.
	 */
	private async _proxyToBrainV2(method: string, path: string, body?: Record<string, unknown>): Promise<unknown> {
		const url = `${BRAIN_V2_API_URL}${path}`
		const fetchOptions: RequestInit = {
			method,
			headers: {
				"content-type": "application/json",
			},
			signal: AbortSignal.timeout(10_000),
		}
		if (body && (method === "POST" || method === "PATCH")) {
			fetchOptions.body = JSON.stringify(body)
		}

		const res = await fetch(url, fetchOptions)

		if (!res.ok) {
			const text = await res.text()
			throw new Error(`Brain v2 API error (${res.status}): ${text}`)
		}

		const json = await res.json()
		return json
	}

	private async _readCodexTaskLog(): Promise<CodexTaskLogFile> {
		try {
			const raw = await fs.readFile(CODEX_TASK_LOG_PATH, "utf8")
			const parsed = JSON.parse(raw) as Partial<CodexTaskLogFile>
			return { tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [] }
		} catch (err) {
			if (isNodeError(err) && err.code === "ENOENT") {
				return { tasks: [] }
			}
			throw err
		}
	}

	private async _writeCodexTaskLog(data: CodexTaskLogFile): Promise<void> {
		await fs.mkdir(path.dirname(CODEX_TASK_LOG_PATH), { recursive: true })
		const tempPath = `${CODEX_TASK_LOG_PATH}.tmp`
		await fs.writeFile(tempPath, JSON.stringify(data, null, 2), "utf8")
		await fs.rename(tempPath, CODEX_TASK_LOG_PATH)
	}

	private async _upsertCodexTask(input: Record<string, unknown>): Promise<unknown> {
		const now = new Date().toISOString()
		const data = await this._readCodexTaskLog()
		const requestedId = typeof input.id === "string" ? input.id : undefined
		const existing = requestedId ? data.tasks.find((task) => task.id === requestedId) : undefined
		const status = typeof input.status === "string" && input.status ? input.status : existing?.status || "active"
		const task: CodexTaskRecord = {
			id: existing?.id || requestedId || `codex_task_${crypto.randomUUID()}`,
			title: typeof input.title === "string" && input.title ? input.title : existing?.title || "Untitled task",
			summary: typeof input.summary === "string" ? input.summary : existing?.summary || "",
			status,
			project:
				typeof input.project === "string" && input.project ? input.project : existing?.project || "superroo2",
			agent: typeof input.agent === "string" && input.agent ? input.agent : existing?.agent || "Codex",
			filesChanged: Array.isArray(input.filesChanged)
				? (input.filesChanged as string[])
				: existing?.filesChanged || [],
			featuresAffected: Array.isArray(input.featuresAffected)
				? (input.featuresAffected as string[])
				: existing?.featuresAffected || [],
			notes: Array.isArray(input.notes) ? (input.notes as string[]) : existing?.notes || [],
			startedAt: existing?.startedAt || now,
			updatedAt: now,
			completedAt: ["completed", "blocked", "cancelled"].includes(status) ? now : existing?.completedAt || null,
		}

		if (existing) {
			Object.assign(existing, task)
		} else {
			data.tasks.unshift(task)
		}
		data.tasks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
		await this._writeCodexTaskLog({ tasks: data.tasks.slice(0, 500) })
		return { success: true, task, source: "codex_task_log" }
	}

	private async _listCodexTasks(limit: number): Promise<CodexTaskRecord[]> {
		const data = await this._readCodexTaskLog()
		return data.tasks.slice(0, Number(limit))
	}

	private async _getCodexTask(id: string): Promise<CodexTaskRecord | null> {
		const data = await this._readCodexTaskLog()
		return data.tasks.find((task) => task.id === id) || null
	}

	private async _getActiveCodexTask(): Promise<CodexTaskRecord | null> {
		const data = await this._readCodexTaskLog()
		return data.tasks.find((task) => task.status === "active") || null
	}

	// ── Kimi Task Log Helpers ──

	private async _readKimiTaskLog(): Promise<KimiTaskLogFile> {
		try {
			const raw = await fs.readFile(KIMI_TASK_LOG_PATH, "utf8")
			const parsed = JSON.parse(raw) as Partial<KimiTaskLogFile>
			return { tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [] }
		} catch (err) {
			if (isNodeError(err) && err.code === "ENOENT") {
				return { tasks: [] }
			}
			throw err
		}
	}

	private async _writeKimiTaskLog(data: KimiTaskLogFile): Promise<void> {
		await fs.mkdir(path.dirname(KIMI_TASK_LOG_PATH), { recursive: true })
		const tempPath = `${KIMI_TASK_LOG_PATH}.tmp`
		await fs.writeFile(tempPath, JSON.stringify(data, null, 2), "utf8")
		await fs.rename(tempPath, KIMI_TASK_LOG_PATH)
	}

	private async _upsertKimiTask(input: Record<string, unknown>): Promise<unknown> {
		const now = new Date().toISOString()
		const data = await this._readKimiTaskLog()
		const requestedId = typeof input.id === "string" ? input.id : undefined
		const existing = requestedId ? data.tasks.find((task) => task.id === requestedId) : undefined
		const status = typeof input.status === "string" && input.status ? input.status : existing?.status || "active"
		const task: KimiTaskRecord = {
			id: existing?.id || requestedId || `kimi_task_${crypto.randomUUID()}`,
			title: typeof input.title === "string" && input.title ? input.title : existing?.title || "Untitled task",
			summary: typeof input.summary === "string" ? input.summary : existing?.summary || "",
			status,
			project:
				typeof input.project === "string" && input.project ? input.project : existing?.project || "superroo2",
			agent: typeof input.agent === "string" && input.agent ? input.agent : existing?.agent || "Kimi",
			filesChanged: Array.isArray(input.filesChanged)
				? (input.filesChanged as string[])
				: existing?.filesChanged || [],
			featuresAffected: Array.isArray(input.featuresAffected)
				? (input.featuresAffected as string[])
				: existing?.featuresAffected || [],
			notes: Array.isArray(input.notes) ? (input.notes as string[]) : existing?.notes || [],
			startedAt: existing?.startedAt || now,
			updatedAt: now,
			completedAt: ["completed", "blocked", "cancelled"].includes(status) ? now : existing?.completedAt || null,
		}

		if (existing) {
			Object.assign(existing, task)
		} else {
			data.tasks.unshift(task)
		}
		data.tasks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
		await this._writeKimiTaskLog({ tasks: data.tasks.slice(0, 500) })
		return { success: true, task, source: "kimi_task_log" }
	}

	private async _listKimiTasks(limit: number): Promise<KimiTaskRecord[]> {
		const data = await this._readKimiTaskLog()
		return data.tasks.slice(0, Number(limit))
	}

	private async _getKimiTask(id: string): Promise<KimiTaskRecord | null> {
		const data = await this._readKimiTaskLog()
		return data.tasks.find((task) => task.id === id) || null
	}

	private async _getActiveKimiTask(): Promise<KimiTaskRecord | null> {
		const data = await this._readKimiTaskLog()
		return data.tasks.find((task) => task.status === "active") || null
	}

	// ── Claude Task Log Helpers ──

	private async _readClaudeTaskLog(): Promise<ClaudeTaskLogFile> {
		try {
			const raw = await fs.readFile(CLAUDE_TASK_LOG_PATH, "utf8")
			const parsed = JSON.parse(raw) as Partial<ClaudeTaskLogFile>
			return { tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [] }
		} catch (err) {
			if (isNodeError(err) && err.code === "ENOENT") {
				return { tasks: [] }
			}
			throw err
		}
	}

	private async _writeClaudeTaskLog(data: ClaudeTaskLogFile): Promise<void> {
		await fs.mkdir(path.dirname(CLAUDE_TASK_LOG_PATH), { recursive: true })
		const tempPath = `${CLAUDE_TASK_LOG_PATH}.tmp`
		await fs.writeFile(tempPath, JSON.stringify(data, null, 2), "utf8")
		await fs.rename(tempPath, CLAUDE_TASK_LOG_PATH)
	}

	private async _upsertClaudeTask(input: Record<string, unknown>): Promise<unknown> {
		const now = new Date().toISOString()
		const data = await this._readClaudeTaskLog()
		const requestedId = typeof input.id === "string" ? input.id : undefined
		const existing = requestedId ? data.tasks.find((task) => task.id === requestedId) : undefined
		const status = typeof input.status === "string" && input.status ? input.status : existing?.status || "active"
		const task: ClaudeTaskRecord = {
			id: existing?.id || requestedId || `claude_task_${crypto.randomUUID()}`,
			title: typeof input.title === "string" && input.title ? input.title : existing?.title || "Untitled task",
			summary: typeof input.summary === "string" ? input.summary : existing?.summary || "",
			status,
			project:
				typeof input.project === "string" && input.project ? input.project : existing?.project || "superroo2",
			agent: typeof input.agent === "string" && input.agent ? input.agent : existing?.agent || "Claude",
			filesChanged: Array.isArray(input.filesChanged)
				? (input.filesChanged as string[])
				: existing?.filesChanged || [],
			featuresAffected: Array.isArray(input.featuresAffected)
				? (input.featuresAffected as string[])
				: existing?.featuresAffected || [],
			notes: Array.isArray(input.notes) ? (input.notes as string[]) : existing?.notes || [],
			startedAt: existing?.startedAt || now,
			updatedAt: now,
			completedAt: ["completed", "blocked", "cancelled"].includes(status) ? now : existing?.completedAt || null,
		}

		if (existing) {
			Object.assign(existing, task)
		} else {
			data.tasks.unshift(task)
		}
		data.tasks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
		await this._writeClaudeTaskLog({ tasks: data.tasks.slice(0, 500) })
		return { success: true, task, source: "claude_task_log" }
	}

	private async _listClaudeTasks(limit: number): Promise<ClaudeTaskRecord[]> {
		const data = await this._readClaudeTaskLog()
		return data.tasks.slice(0, Number(limit))
	}

	private async _getClaudeTask(id: string): Promise<ClaudeTaskRecord | null> {
		const data = await this._readClaudeTaskLog()
		return data.tasks.find((task) => task.id === id) || null
	}

	private async _getActiveClaudeTask(): Promise<ClaudeTaskRecord | null> {
		const data = await this._readClaudeTaskLog()
		return data.tasks.find((task) => task.status === "active") || null
	}

	// ── SuperContinue Task Log Helpers ──

	private async _readSuperContinueTaskLog(): Promise<SuperContinueTaskLogFile> {
		try {
			const raw = await fs.readFile(SUPERCONTINUE_TASK_LOG_PATH, "utf8")
			const parsed = JSON.parse(raw) as Partial<SuperContinueTaskLogFile>
			return { tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [] }
		} catch (err) {
			if (isNodeError(err) && err.code === "ENOENT") {
				return { tasks: [] }
			}
			throw err
		}
	}

	private async _writeSuperContinueTaskLog(data: SuperContinueTaskLogFile): Promise<void> {
		await fs.mkdir(path.dirname(SUPERCONTINUE_TASK_LOG_PATH), { recursive: true })
		const tempPath = `${SUPERCONTINUE_TASK_LOG_PATH}.tmp`
		await fs.writeFile(tempPath, JSON.stringify(data, null, 2), "utf8")
		await fs.rename(tempPath, SUPERCONTINUE_TASK_LOG_PATH)
	}

	private async _upsertSuperContinueTask(input: Record<string, unknown>): Promise<unknown> {
		const now = new Date().toISOString()
		const data = await this._readSuperContinueTaskLog()
		const requestedId = typeof input.id === "string" ? input.id : undefined
		const existing = requestedId ? data.tasks.find((task) => task.id === requestedId) : undefined
		const status = typeof input.status === "string" && input.status ? input.status : existing?.status || "active"
		const task: SuperContinueTaskRecord = {
			id: existing?.id || requestedId || `sc_task_${crypto.randomUUID()}`,
			title: typeof input.title === "string" && input.title ? input.title : existing?.title || "Untitled task",
			summary: typeof input.summary === "string" ? input.summary : existing?.summary || "",
			status,
			project:
				typeof input.project === "string" && input.project ? input.project : existing?.project || "superroo2",
			agent: typeof input.agent === "string" && input.agent ? input.agent : existing?.agent || "SuperContinue",
			filesChanged: Array.isArray(input.filesChanged)
				? (input.filesChanged as string[])
				: existing?.filesChanged || [],
			featuresAffected: Array.isArray(input.featuresAffected)
				? (input.featuresAffected as string[])
				: existing?.featuresAffected || [],
			notes: Array.isArray(input.notes) ? (input.notes as string[]) : existing?.notes || [],
			startedAt: existing?.startedAt || now,
			updatedAt: now,
			completedAt: ["completed", "blocked", "cancelled"].includes(status) ? now : existing?.completedAt || null,
		}

		if (existing) {
			Object.assign(existing, task)
		} else {
			data.tasks.unshift(task)
		}
		data.tasks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
		await this._writeSuperContinueTaskLog({ tasks: data.tasks.slice(0, 500) })
		return { success: true, task, source: "supercontinue_task_log" }
	}

	private async _listSuperContinueTasks(limit: number): Promise<SuperContinueTaskRecord[]> {
		const data = await this._readSuperContinueTaskLog()
		return data.tasks.slice(0, Number(limit))
	}

	private async _getSuperContinueTask(id: string): Promise<SuperContinueTaskRecord | null> {
		const data = await this._readSuperContinueTaskLog()
		return data.tasks.find((task) => task.id === id) || null
	}

	private async _getActiveSuperContinueTask(): Promise<SuperContinueTaskRecord | null> {
		const data = await this._readSuperContinueTaskLog()
		return data.tasks.find((task) => task.status === "active") || null
	}

	/**
	 * Send a JSON response.
	 */
	private _json(res: http.ServerResponse, statusCode: number, body: unknown): void {
		const payload = JSON.stringify(body)
		res.writeHead(statusCode, {
			"content-type": "application/json; charset=utf-8",
			"content-length": Buffer.byteLength(payload),
		})
		res.end(payload)
	}

	/**
	 * Start the MCP server.
	 */
	async start(): Promise<void> {
		return new Promise((resolve) => {
			this.server.listen(MCP_SERVER_PORT, MCP_SERVER_HOST, () => {
				console.log(`[mcp-memory] Server listening on http://${MCP_SERVER_HOST}:${MCP_SERVER_PORT}`)
				console.log(`[mcp-memory] Primary: Central Brain Daemon at ${CENTRAL_BRAIN_URL}`)
				console.log(`[mcp-memory] Fallback: REST API at ${REST_API_FALLBACK_URL}`)
				console.log(`[mcp-memory] Tools available: ${this.tools.map((t) => t.name).join(", ")}`)
				resolve()
			})
		})
	}

	/**
	 * Stop the MCP server.
	 */
	async stop(): Promise<void> {
		return new Promise((resolve) => {
			this.server.close(() => resolve())
		})
	}
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
	return err instanceof Error && "code" in err
}

// ── Main ──

async function main(): Promise<void> {
	const server = new McpMemoryServer()
	await server.start()

	// Graceful shutdown
	const shutdown = async () => {
		console.log("[mcp-memory] Shutting down")
		await server.stop()
		process.exit(0)
	}
	process.on("SIGINT", shutdown)
	process.on("SIGTERM", shutdown)
}

main().catch((err) => {
	console.error("[mcp-memory] Fatal:", err)
	process.exit(1)
})
