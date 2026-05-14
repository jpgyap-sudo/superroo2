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
 *        ↓  (HTTP to Central Brain daemon)
 *   Central Brain Daemon (port 3100)
 *        ↓
 *   ProjectMemoryManager → Qdrant / PostgreSQL / JSON Memory
 *
 * The MCP server can run as:
 *   1. A sidecar process alongside the Central Brain daemon
 *   2. An embedded endpoint in the daemon itself
 *   3. A standalone process for local development
 */

import * as http from "node:http"

// ── Configuration ──

const CENTRAL_BRAIN_URL = process.env.CENTRAL_BRAIN_URL || "http://127.0.0.1:3100"
const MCP_SERVER_PORT = Number(process.env.MCP_SERVER_PORT || "3419")
const MCP_SERVER_HOST = process.env.MCP_SERVER_HOST || "127.0.0.1"
const DAEMON_TOKEN = process.env.SUPERROO_DAEMON_TOKEN || ""

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
				description: "Search the Central Brain memory for context relevant to your task. Returns RAG context with relevant files, tasks, bugs, and feature memory. Use this FIRST before starting any coding task.",
				inputSchema: {
					type: "object",
					properties: {
						query: {
							type: "string",
							description: "The search query describing what you need context about",
						},
						project: {
							type: "string",
							description: "Project ID (default: auto-detect from query). Options: superroo2, productgenerator, trading-bot",
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
				description: "Get detailed information about a project namespace, including its Qdrant collection, memory directory, and configuration.",
				inputSchema: {
					type: "object",
					properties: {
						project: {
							type: "string",
							description: "Project ID (default: superroo2). Options: superroo2, productgenerator, trading-bot",
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
				description: "Get recent bugs and incidents for a project to understand what's broken or being worked on.",
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
				description: "Search indexed code chunks in a project's Qdrant vector store. Returns relevant code snippets with file paths and line numbers.",
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
				description: "Submit a new task to the Central Brain for execution. The brain will route it to the appropriate agent.",
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
				description: "Complete RAG context for the current project including relevant files, tasks, bugs, and feature memory",
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
			this._json(res, 200, { ok: true, server: "mcp-memory", brainUrl: CENTRAL_BRAIN_URL })
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
						version: "1.0.0",
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
			case "query_memory": {
				return await this._proxyToBrain("query_memory", {
					query,
					project,
					maxResults: limit,
				})
			}

			case "get_project_info": {
				return await this._proxyToBrain("get_project_info", { project })
			}

			case "list_projects": {
				return await this._proxyToBrain("list_projects", {})
			}

			case "get_active_task": {
				return await this._proxyToBrain("get_active_task", { project })
			}

			case "get_recent_bugs": {
				return await this._proxyToBrain("get_recent_bugs", { project, limit })
			}

			case "search_code": {
				return await this._proxyToBrain("search_code", {
					query,
					project,
					filePattern: args?.filePattern || undefined,
					maxResults: limit,
				})
			}

			case "submit_task": {
				return await this._proxyToBrain("submit_task", {
					goal: args?.goal || query,
					project,
					agent: args?.agent || "coder",
				})
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
				return await this._proxyToBrain("get_context", { project: "superroo2" })

			case "memory://tasks":
				return await this._proxyToBrain("get_tasks", { project: "superroo2" })

			case "memory://bugs":
				return await this._proxyToBrain("get_bugs", { project: "superroo2" })

			case "memory://projects":
				return await this._proxyToBrain("list_projects", {})

			default:
				// Try project-specific URIs: memory://{project}/context
				const match = uri.match(/^memory:\/\/([^/]+)\/(.+)$/)
				if (match) {
					const projectId = match[1]
					const resource = match[2]
					return await this._proxyToBrain(`get_${resource}`, { project: projectId })
				}
				throw new Error(`Unknown resource: ${uri}`)
		}
	}

	/**
	 * Proxy a request to the Central Brain daemon.
	 */
	private async _proxyToBrain(action: string, params: Record<string, unknown>): Promise<unknown> {
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
			signal: AbortSignal.timeout(15_000),
		})

		if (!res.ok) {
			const text = await res.text()
			throw new Error(`Brain proxy error (${res.status}): ${text}`)
		}

		const json = await res.json()
		return json
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
				console.log(`[mcp-memory] Proxying to Central Brain at ${CENTRAL_BRAIN_URL}`)
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
