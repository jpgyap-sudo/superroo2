/**
 * MCPServer — Wraps a single MCP server process with lifecycle management.
 *
 * Supports two transport modes:
 * - stdio: spawns a child process and communicates via stdin/stdout
 * - sse/streamable-http: connects to a remote URL
 *
 * Inspired by Theia's MCPServerManager which manages individual server instances.
 *
 * @see https://github.com/eclipse-theia/theia/blob/master/packages/ai-mcp/src/node/mcp-server-manager-impl.ts
 */

const { spawn } = require("child_process")
const EventEmitter = require("node:events")

/**
 * @typedef {import("./types").MCPServerDescription} MCPServerDescription
 * @typedef {import("./types").MCPServerTool} MCPServerTool
 * @typedef {import("./types").MCPCallToolResult} MCPCallToolResult
 * @typedef {import("./types").MCPResourceContent} MCPResourceContent
 * @typedef {import("./types").ServerStatus} ServerStatus
 */

class MCPServer extends EventEmitter {
	/**
	 * @param {MCPServerDescription} description
	 */
	constructor(description) {
		super()

		/** @type {MCPServerDescription} */
		this.description = { ...description, status: description.status || "stopped" }

		/** @type {import("child_process").ChildProcess|null} */
		this._process = null

		/** @type {Buffer[]} */
		this._stdoutBuffer = []

		/** @type {Buffer[]} */
		this._stderrBuffer = []

		/** @type {number|null} */
		this._startTime = null

		/** @type {number} */
		this._requestId = 0

		/** @type {Map<number, {resolve: Function, reject: Function, timer: NodeJS.Timeout}>} */
		this._pendingRequests = new Map()

		/** @type {string} */
		this._partialLine = ""

		/** @type {number} */
		this._requestTimeout = 30000 // 30s default timeout

		/** @type {MCPServerTool[]} */
		this._tools = description.tools || []
	}

	// ──────────────────────────────────────────────────────────────────────────
	// Properties
	// ──────────────────────────────────────────────────────────────────────────

	/** @returns {string} */
	get name() {
		return this.description.name
	}

	/** @returns {ServerStatus} */
	get status() {
		return this.description.status
	}

	/** @returns {MCPServerTool[]} */
	get tools() {
		return this._tools
	}

	/** @returns {number|null} */
	get uptime() {
		if (!this._startTime) return null
		return Date.now() - this._startTime
	}

	/** @returns {boolean} */
	get isRunning() {
		return this.description.status === "running"
	}

	// ──────────────────────────────────────────────────────────────────────────
	// Lifecycle
	// ──────────────────────────────────────────────────────────────────────────

	/**
	 * Start the MCP server.
	 * @returns {Promise<void>}
	 */
	async start() {
		if (this.isRunning) {
			return
		}

		this._setStatus("starting")
		this._startTime = Date.now()

		try {
			if (
				this.description.transport === "sse" ||
				this.description.transport === "streamable-http" ||
				this.description.url
			) {
				await this._startRemote()
			} else {
				await this._startStdio()
			}

			this._setStatus("running")
			this.emit("started", { name: this.name })
		} catch (err) {
			this._setStatus("error", err.message)
			this.emit("error", { name: this.name, error: err.message })
			throw err
		}
	}

	/**
	 * Stop the MCP server gracefully.
	 * @param {boolean} [force=false] — Force kill if graceful shutdown fails
	 * @returns {Promise<void>}
	 */
	async stop(force = false) {
		if (!this._process && this.description.transport !== "sse") {
			this._setStatus("stopped")
			return
		}

		// Reject all pending requests
		for (const [id, pending] of this._pendingRequests) {
			clearTimeout(pending.timer)
			pending.reject(new Error("Server stopped"))
			this._pendingRequests.delete(id)
		}

		if (this._process) {
			return new Promise((resolve) => {
				const killTimeout = setTimeout(() => {
					if (this._process) {
						this._process.kill("SIGKILL")
					}
				}, 5000)

				this._process.on("exit", () => {
					clearTimeout(killTimeout)
					this._process = null
					this._setStatus("stopped")
					this.emit("stopped", { name: this.name })
					resolve()
				})

				if (force) {
					this._process.kill("SIGKILL")
				} else {
					this._process.kill("SIGTERM")
					// If not stopped after 3s, force kill
					setTimeout(() => {
						if (this._process) {
							this._process.kill("SIGKILL")
						}
					}, 3000)
				}
			})
		}

		this._setStatus("stopped")
		this.emit("stopped", { name: this.name })
	}

	// ──────────────────────────────────────────────────────────────────────────
	// MCP Protocol
	// ──────────────────────────────────────────────────────────────────────────

	/**
	 * Initialize the MCP connection (sends initialize request).
	 * @returns {Promise<Object>}
	 */
	async initialize() {
		return this._sendRequest("initialize", {
			protocolVersion: "2024-11-05",
			capabilities: {},
			clientInfo: {
				name: "superroo-mcp-manager",
				version: "1.0.0",
			},
		})
	}

	/**
	 * List available tools from this server.
	 * @returns {Promise<MCPServerTool[]>}
	 */
	async listTools() {
		const result = await this._sendRequest("tools/list", {})
		if (result && result.tools) {
			this._tools = result.tools.map((/** @type {any} */ t) => ({
				name: t.name,
				description: t.description || "",
				inputSchema: t.inputSchema || {},
			}))
		}
		return this._tools
	}

	/**
	 * Call a tool on this server.
	 * @param {string} toolName
	 * @param {Object} [args={}]
	 * @returns {Promise<MCPCallToolResult>}
	 */
	async callTool(toolName, args = {}) {
		try {
			const result = await this._sendRequest("tools/call", {
				name: toolName,
				arguments: args,
			})

			if (!result) {
				return { success: false, error: "No response from server" }
			}

			if (result.isError) {
				const content = this._extractTextContent(result.content)
				return { success: false, error: content || "Tool returned error", isError: true }
			}

			const content = this._extractTextContent(result.content)
			return {
				success: true,
				content: content || undefined,
				contentParts: result.content || undefined,
			}
		} catch (err) {
			return { success: false, error: err.message }
		}
	}

	/**
	 * Read a resource from this server.
	 * @param {string} resourceId
	 * @returns {Promise<MCPResourceContent|null>}
	 */
	async readResource(resourceId) {
		try {
			const result = await this._sendRequest("resources/read", {
				uri: resourceId,
			})

			if (!result || !result.contents || result.contents.length === 0) {
				return null
			}

			const content = result.contents[0]
			return {
				uri: content.uri,
				mimeType: content.mimeType || "text/plain",
				text: content.text || "",
			}
		} catch (err) {
			return null
		}
	}

	/**
	 * Ping the server to check liveness.
	 * @returns {Promise<boolean>}
	 */
	async ping() {
		try {
			await this._sendRequest("ping", {}, 5000)
			return true
		} catch {
			return false
		}
	}

	// ──────────────────────────────────────────────────────────────────────────
	// Internal — stdio transport
	// ──────────────────────────────────────────────────────────────────────────

	/**
	 * Start the server via stdio child process.
	 * @private
	 */
	async _startStdio() {
		const { command, args = [] } = this.description

		if (!command) {
			throw new Error(`No command specified for server "${this.name}"`)
		}

		const env = {
			...process.env,
			...this.description.env,
		}

		this._process = spawn(command, args, {
			env,
			stdio: ["pipe", "pipe", "pipe"],
			shell: process.platform === "win32",
		})

		this._process.stdout.on("data", (data) => {
			this._stdoutBuffer.push(data)
			this._processStdioData(data.toString())
		})

		this._process.stderr.on("data", (data) => {
			this._stderrBuffer.push(data)
		})

		this._process.on("error", (err) => {
			this._setStatus("error", err.message)
			this.emit("error", { name: this.name, error: err.message })
		})

		this._process.on("exit", (code, signal) => {
			this._process = null
			if (this.description.status === "running") {
				this._setStatus("error", `Process exited with code ${code}, signal ${signal}`)
				this.emit("crashed", { name: this.name, code, signal })
			} else {
				this._setStatus("stopped")
			}
		})

		// Wait a brief moment for the process to start
		await new Promise((resolve) => setTimeout(resolve, 500))

		if (this._process && !this._process.pid) {
			throw new Error(`Failed to start process for server "${this.name}"`)
		}
	}

	/**
	 * Process incoming JSON-RPC data from stdio.
	 * @private
	 * @param {string} chunk
	 */
	_processStdioData(chunk) {
		const lines = (this._partialLine + chunk).split("\n")
		this._partialLine = lines.pop() || ""

		for (const line of lines) {
			const trimmed = line.trim()
			if (!trimmed) continue

			try {
				const message = JSON.parse(trimmed)

				if (message.id !== undefined && this._pendingRequests.has(message.id)) {
					const pending = this._pendingRequests.get(message.id)
					clearTimeout(pending.timer)
					this._pendingRequests.delete(message.id)

					if (message.error) {
						pending.reject(new Error(message.error.message || "MCP error"))
					} else {
						pending.resolve(message.result || message)
					}
				} else if (message.method) {
					// Server-initiated notification
					this.emit("notification", {
						method: message.method,
						params: message.params,
					})
				}
			} catch {
				// Non-JSON output — ignore (could be startup logs)
			}
		}
	}

	// ──────────────────────────────────────────────────────────────────────────
	// Internal — remote transport
	// ──────────────────────────────────────────────────────────────────────────

	/**
	 * Start the server via remote URL (SSE or streamable HTTP).
	 * @private
	 */
	async _startRemote() {
		const url = this.description.url
		if (!url) {
			throw new Error(`No URL specified for server "${this.name}"`)
		}

		// For remote servers, we just verify connectivity
		try {
			const response = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					method: "ping",
					params: {},
				}),
				signal: AbortSignal.timeout(5000),
			})

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`)
			}
		} catch (err) {
			throw new Error(`Cannot connect to remote MCP server at ${url}: ${err.message}`)
		}
	}

	// ──────────────────────────────────────────────────────────────────────────
	// Internal — request/response
	// ──────────────────────────────────────────────────────────────────────────

	/**
	 * Send a JSON-RPC request to the server.
	 * @private
	 * @param {string} method
	 * @param {Object} params
	 * @param {number} [timeout]
	 * @returns {Promise<Object>}
	 */
	async _sendRequest(method, params, timeout) {
		const id = ++this._requestId
		const ttl = timeout || this._requestTimeout

		if (this.description.url) {
			return this._sendHttpRequest(id, method, params, ttl)
		}

		return this._sendStdioRequest(id, method, params, ttl)
	}

	/**
	 * Send a request via stdio.
	 * @private
	 */
	async _sendStdioRequest(id, method, params, timeout) {
		if (!this._process || !this._process.stdin) {
			throw new Error(`Server "${this.name}" is not running`)
		}

		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this._pendingRequests.delete(id)
				reject(new Error(`Request "${method}" timed out after ${timeout}ms`))
			}, timeout)

			this._pendingRequests.set(id, { resolve, reject, timer })

			const request = JSON.stringify({
				jsonrpc: "2.0",
				id,
				method,
				params,
			})

			this._process.stdin.write(request + "\n")
		})
	}

	/**
	 * Send a request via HTTP (for remote servers).
	 * @private
	 */
	async _sendHttpRequest(id, method, params, timeout) {
		const url = this.description.url
		const response = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				jsonrpc: "2.0",
				id,
				method,
				params,
			}),
			signal: AbortSignal.timeout(timeout),
		})

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`)
		}

		const data = await response.json()
		if (data.error) {
			throw new Error(data.error.message || "MCP error")
		}

		return data.result
	}

	// ──────────────────────────────────────────────────────────────────────────
	// Internal — helpers
	// ──────────────────────────────────────────────────────────────────────────

	/**
	 * @private
	 * @param {ServerStatus} status
	 * @param {string} [error]
	 */
	_setStatus(status, error) {
		this.description.status = status
		if (error) {
			this.description.error = error
		}
	}

	/**
	 * Extract text content from MCP content array.
	 * @private
	 * @param {Array<{type: string, text?: string}>} [content]
	 * @returns {string}
	 */
	_extractTextContent(content) {
		if (!content || !Array.isArray(content)) return ""
		return content
			.filter((c) => c.type === "text" && c.text)
			.map((c) => c.text)
			.join("\n")
	}

	/**
	 * Get the stderr log as a string.
	 * @returns {string}
	 */
	getStderrLog() {
		return Buffer.concat(this._stderrBuffer).toString()
	}

	/**
	 * Get the stdout log as a string.
	 * @returns {string}
	 */
	getStdoutLog() {
		return Buffer.concat(this._stdoutBuffer).toString()
	}

	/**
	 * Get a summary of this server.
	 * @returns {Object}
	 */
	getSummary() {
		return {
			name: this.name,
			description: this.description.description || "",
			status: this.description.status,
			transport: this.description.transport || "stdio",
			command: this.description.command || null,
			url: this.description.url || null,
			tools: this._tools.length,
			uptime: this.uptime,
			error: this.description.error || null,
		}
	}
}

module.exports = { MCPServer }
