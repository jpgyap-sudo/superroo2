/**
 * McpMemoryServer — MCP server that Claude Code and Codex connect to.
 *
 * This implements the Model Context Protocol (MCP) so that any MCP-compatible
 * client (Claude Code, Codex, Cursor, etc.) can query SuperRoo's Central Brain
 * memory. It exposes:
 *
 *   Tools:
 *     - query_memory(query, project?) — Search memory with RAG context
 *     - get_project_info(project?) — Get project namespace details
 *     - list_projects() — List all registered projects
 *     - get_active_task(project?) — Get current active task for a project
 *     - get_recent_bugs(project?, limit?) — Get recent bugs for a project
 *     - search_code(query, project?, file_pattern?) — Search indexed code
 *     - submit_task(goal, project?, agent?) — Submit a new task
 *     - hermes_recall(query, limit?) — Semantic memory search via Hermes Claw
 *     - hermes_learn(topic, content) — Store a lesson via Hermes Claw
 *     - hermes_list_skills() — List all created skills
 *     - hermes_list_resources() — List all knowledge resources
 *     - hermes_stats() — Get Hermes Claw statistics
 *     - commit_deploy_status(limit?) — Get commit/deploy history
 *     - codex_task_upsert(...) — Create or update persistent Codex task memory
 *     - codex_task_list(limit?) — List recent Codex tasks
 *     - codex_task_get(id) — Fetch one Codex task
 *     - codex_task_get_active() — Fetch the current active Codex task
 *
 *   Resources:
 *     - memory://{project}/context — Full RAG context for a project
 *     - memory://{project}/tasks — Task list for a project
 *     - memory://{project}/bugs — Bug list for a project
 *
 * Architecture:
 *   Claude Code / Codex Extension
 *        ↓  (MCP Protocol via stdio or HTTP)
 *   McpMemoryServer (this file)
 *        ↓  (HTTP to Central Brain daemon OR REST API fallback)
 *   Central Brain Daemon (port 3417) ← Primary
 *   REST API (port 8787) ← Fallback
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

// ── Configuration ──

const CENTRAL_BRAIN_URL = process.env.CENTRAL_BRAIN_URL || "http://127.0.0.1:3417"
const REST_API_FALLBACK_URL = process.env.REST_API_FALLBACK_URL || "http://127.0.0.1:8787"
const MCP_SERVER_PORT = Number(process.env.MCP_SERVER_PORT || "3419")
const MCP_SERVER_HOST = process.env.MCP_SERVER_HOST || "127.0.0.1"
const DAEMON_TOKEN = process.env.SUPERROO_DAEMON_TOKEN || ""
const CODEX_TASK_LOG_PATH =
	process.env.CODEX_TASK_LOG_PATH || path.resolve(process.cwd(), "server/src/memory/codextask.json")
const KIMI_TASK_LOG_PATH = process.env.KIMI_TASK_LOG_PATH || path.resolve(process.cwd(), "server/src/memory/kimi.json")
const CLAUDE_TASK_LOG_PATH =
	process.env.CLAUDE_TASK_LOG_PATH || path.resolve(process.cwd(), "server/src/memory/claudetask.json")
const MEMORY_DIR = path.resolve(process.cwd(), "server/src/memory")
const HEALING_DIR = path.resolve(process.cwd(), "memory")

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

// ── MCP Server ──

class McpMemoryServer {
	private server: http.Server
	private tools: McpToolDefinition[] = []
	private resources: McpResourceDefinition[] = []

	constructor() {
		this.server = http.createServer((req, res) => this._handleRequest(req, res))
		this._registerTools()
		this._registerResources()
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
					},
					required: ["query"],
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
			// ── Commit/Deploy Tool ──
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

		// Health check
		if (req.method === "GET" && req.url === "/health") {
			this._json(res, 200, {
				ok: true,
				server: "mcp-memory",
				brainUrl: CENTRAL_BRAIN_URL,
				restFallback: REST_API_FALLBACK_URL,
			})
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

		switch (name) {
			// ── Daemon-proxied tools ──
			case "query_memory": {
				return await this._proxyWithFallback("query_memory", {
					query,
					project,
					maxResults: limit,
				})
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
				return await this._proxyWithFallback("submit_task", {
					goal: args?.goal || query,
					project,
					agent: args?.agent || "coder",
				})
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
				return await this._proxyWithFallback("hermes_learn", {
					topic,
					content,
				})
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

			// ── Commit/Deploy tool ──
			case "commit_deploy_status": {
				const cdLimit = Number(args?.limit || 5)
				return await this._proxyWithFallback("commit_deploy_status", {
					limit: cdLimit,
				})
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
	 *   2. If daemon fails, try REST API fallback (REST_API_FALLBACK_URL)
	 *   3. If both fail, use local JSON file fallback
	 */
	private async _proxyWithFallback(action: string, params: Record<string, unknown>): Promise<unknown> {
		// Try daemon first
		try {
			return await this._proxyToDaemon(action, params)
		} catch (daemonErr) {
			console.log(
				`[mcp-memory] Daemon proxy failed for '${action}', trying REST API fallback: ${daemonErr instanceof Error ? daemonErr.message : String(daemonErr)}`,
			)
			// Fall back to REST API
			try {
				return await this._proxyToRestApi(action, params)
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

		switch (action) {
			case "query_memory": {
				const results = await this._searchLocalMemory(query, limit)
				return {
					success: true,
					results,
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
				return { success: true, projects: ["superroo2"], source: "local_json_fallback" }
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

		return results.slice(0, limit)
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
