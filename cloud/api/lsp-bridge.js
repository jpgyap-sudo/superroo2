/**
 * LSP Bridge — Language Server Protocol proxy for the Cloud IDE
 *
 * Spawns language servers (e.g. typescript-language-server) and bridges
 * WebSocket messages from the dashboard to JSON-RPC over stdio.
 *
 * Supported languages:
 *   - typescript, javascript, tsx, jsx → typescript-language-server
 *   - json, css, scss, less, html → vscode-langservers-extracted
 *   - python → pyright-langserver
 *   - go → gopls
 *   - rust → rust-analyzer
 *
 * Frontend protocol (WebSocket JSON):
 *   { type: "completion", lang: "typescript", uri: "src/foo.ts", line: 10, column: 5, id: 1 }
 *   { type: "hover",      lang: "typescript", uri: "src/foo.ts", line: 10, column: 5, id: 2 }
 *   { type: "definition", lang: "typescript", uri: "src/foo.ts", line: 10, column: 5, id: 3 }
 *   { type: "references", lang: "typescript", uri: "src/foo.ts", line: 10, column: 5, id: 4 }
 *   { type: "open",       lang: "typescript", uri: "src/foo.ts", text: "...", version: 1, id: 5 }
 *   { type: "change",     lang: "typescript", uri: "src/foo.ts", text: "...", version: 2, id: 6 }
 *
 * Response:
 *   { id: 1, result: [...] }  or  { id: 1, error: "..." }
 */

const { spawn } = require("child_process")
const path = require("path")

const WORKSPACE_ROOT =
	process.env.WORKSPACE_ROOT || (require("fs").existsSync("/opt/superroo2") ? "/opt/superroo2" : process.cwd())

/**
 * Parse JSON-RPC messages from a byte stream with Content-Length headers.
 */
class JsonRpcStream {
	constructor() {
		this.buffer = Buffer.alloc(0)
		this.contentLength = -1
	}

	feed(chunk) {
		this.buffer = Buffer.concat([this.buffer, chunk])
		const messages = []
		while (true) {
			if (this.contentLength === -1) {
				const headerEnd = this.buffer.indexOf("\r\n\r\n")
				if (headerEnd === -1) break
				const header = this.buffer.slice(0, headerEnd).toString("utf8")
				const match = header.match(/Content-Length:\s*(\d+)/i)
				if (!match) {
					// Corrupt header — discard up to double CRLF and try again
					this.buffer = this.buffer.slice(headerEnd + 4)
					continue
				}
				this.contentLength = parseInt(match[1], 10)
				this.buffer = this.buffer.slice(headerEnd + 4)
			}
			if (this.buffer.length < this.contentLength) break
			const raw = this.buffer.slice(0, this.contentLength).toString("utf8")
			this.buffer = this.buffer.slice(this.contentLength)
			this.contentLength = -1
			try {
				messages.push(JSON.parse(raw))
			} catch {
				// Invalid JSON, skip
			}
		}
		return messages
	}
}

class LanguageServerProcess {
	constructor(lang, cwd, cmd, args = ["--stdio"]) {
		this.lang = lang
		this.cwd = cwd
		this.cmd = cmd
		this.args = args
		this.process = null
		this.stream = new JsonRpcStream()
		this.pending = new Map() // id -> { resolve, reject, timer }
		this.requestId = 0
		this.initialized = false
		this.initializing = false
		this.initPromise = null
		this.documents = new Set() // track which URIs are open
		this.diagnosticsCallbacks = new Set()
	}

	async ensureStarted() {
		if (this.process) return
		if (this.initializing) return this.initPromise
		this.initializing = true
		this.initPromise = this._start()
		return this.initPromise
	}

	async _start() {
		try {
			this.process = spawn(this.cmd, this.args, { cwd: this.cwd })
		} catch (err) {
			this.initializing = false
			throw new Error(`Failed to spawn ${this.cmd}: ${err.message}`)
		}

		this.process.on("error", (err) => {
			console.error(`[LSP ${this.lang}] process error:`, err.message)
		})
		this.process.on("exit", (code) => {
			console.log(`[LSP ${this.lang}] process exited with code ${code}`)
			this.process = null
			this.initialized = false
			this.initializing = false
		})

		this.process.stdout.on("data", (chunk) => {
			const messages = this.stream.feed(chunk)
			for (const msg of messages) {
				this._handleMessage(msg)
			}
		})

		this.process.stderr.on("data", (chunk) => {
			// LSP servers often log non-fatal info to stderr
			const text = chunk.toString().trim()
			if (text) console.error(`[LSP ${this.lang}] stderr:`, text.slice(0, 200))
		})

		// Send initialize request
		const initId = ++this.requestId
		const initPayload = {
			jsonrpc: "2.0",
			id: initId,
			method: "initialize",
			params: {
				processId: process.pid,
				rootUri: `file://${this.cwd}`,
				capabilities: {
					textDocument: {
						completion: {
							completionItem: {
								snippetSupport: true,
								commitCharactersSupport: true,
								documentationFormat: ["markdown", "plaintext"],
							},
						},
						hover: { contentFormat: ["markdown", "plaintext"] },
						definition: { linkSupport: true },
						references: {},
					},
				},
				workspaceFolders: [{ uri: `file://${this.cwd}`, name: path.basename(this.cwd) }],
			},
		}
		await this._sendRaw(initPayload)

		// Wait for initialize response
		await this._waitForResponse(initId, 10000)

		// Send initialized notification
		this._sendRaw({ jsonrpc: "2.0", method: "initialized", params: {} })
		this.initialized = true
		this.initializing = false
		console.log(`[LSP ${this.lang}] initialized for ${this.cwd}`)
	}

	_sendRaw(msg) {
		if (!this.process || this.process.killed) {
			throw new Error(`LSP process for ${this.lang} is not running`)
		}
		const payload = JSON.stringify(msg)
		const data = `Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`
		this.process.stdin.write(data)
	}

	async sendRequest(method, params, timeoutMs = 5000) {
		await this.ensureStarted()
		const id = ++this.requestId
		this._sendRaw({ jsonrpc: "2.0", id, method, params })
		return this._waitForResponse(id, timeoutMs)
	}

	sendNotification(method, params) {
		if (!this.process || this.process.killed) return
		this._sendRaw({ jsonrpc: "2.0", method, params })
	}

	_waitForResponse(id, timeoutMs) {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id)
				reject(new Error(`LSP request ${id} timed out`))
			}, timeoutMs)
			this.pending.set(id, { resolve, reject, timer })
		})
	}

	_handleMessage(msg) {
		if (msg.id !== undefined && this.pending.has(msg.id)) {
			const { resolve, reject, timer } = this.pending.get(msg.id)
			clearTimeout(timer)
			this.pending.delete(msg.id)
			if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)))
			else resolve(msg.result)
		} else if (msg.method === "textDocument/publishDiagnostics") {
			for (const cb of this.diagnosticsCallbacks) {
				try {
					cb(msg.params)
				} catch {}
			}
		}
	}

	shutdown() {
		if (!this.process) return
		try {
			this._sendRaw({ jsonrpc: "2.0", method: "shutdown", id: ++this.requestId })
			this._sendRaw({ jsonrpc: "2.0", method: "exit" })
			setTimeout(() => {
				if (this.process && !this.process.killed) this.process.kill()
			}, 2000)
		} catch {
			if (this.process && !this.process.killed) this.process.kill()
		}
	}
}

class LspBridge {
	constructor(workspaceDir) {
		this.workspaceDir = workspaceDir
		/** @type {Map<string, LanguageServerProcess>} */
		this.servers = new Map()
		this.wsClients = new Set()
	}

	getLangKey(lang) {
		const map = {
			typescript: "typescript",
			javascript: "typescript",
			tsx: "typescript",
			jsx: "typescript",
			json: "json",
			css: "css",
			scss: "css",
			less: "css",
			html: "html",
			python: "python",
			go: "go",
			rust: "rust",
		}
		return map[lang] || lang
	}

	async getServer(lang) {
		const key = this.getLangKey(lang)
		if (this.servers.has(key)) return this.servers.get(key)

		// Map language keys to language server commands
		const serverConfig = {
			typescript: { cmd: "typescript-language-server", args: ["--stdio"] },
			json: { cmd: "vscode-json-language-server", args: ["--stdio"] },
			css: { cmd: "vscode-css-language-server", args: ["--stdio"] },
			html: { cmd: "vscode-html-language-server", args: ["--stdio"] },
			python: { cmd: "pyright-langserver", args: ["--stdio"] },
			go: { cmd: "gopls" },
			rust: { cmd: "rust-analyzer" },
		}

		const config = serverConfig[key]
		if (!config) {
			return null
		}

		const server = new LanguageServerProcess(key, this.workspaceDir, config.cmd, config.args)
		// Forward diagnostics from language server to all WebSocket clients
		server.diagnosticsCallbacks.add((params) => {
			const payload = JSON.stringify({ type: "diagnostics", uri: params.uri, diagnostics: params.diagnostics })
			for (const client of this.wsClients) {
				if (client.readyState === 1) {
					// WebSocket.OPEN
					client.send(payload)
				}
			}
		})
		this.servers.set(key, server)
		return server
	}

	_toLspUri(uri) {
		if (uri.startsWith("file://")) return uri
		const abs = path.isAbsolute(uri) ? uri : path.join(this.workspaceDir, uri)
		return "file://" + abs.replace(/\\/g, "/")
	}

	_normalizeLanguageId(lang) {
		const map = {
			javascript: "javascript",
			typescript: "typescript",
			tsx: "typescriptreact",
			jsx: "javascriptreact",
			json: "json",
			css: "css",
			scss: "scss",
			less: "less",
			html: "html",
			python: "python",
			go: "go",
			rust: "rust",
		}
		return map[lang] || lang
	}

	async handleMessage(ws, msg) {
		const { type, lang, uri, line, column, id, text, version } = msg
		const server = await this.getServer(lang)
		if (!server) {
			ws.send(JSON.stringify({ id, error: `Language server for "${lang}" is not available` }))
			return
		}

		try {
			const lspUri = this._toLspUri(uri)
			let result = null

			switch (type) {
				case "open": {
					server.documents.add(lspUri)
					server.sendNotification("textDocument/didOpen", {
						textDocument: {
							uri: lspUri,
							languageId: this._normalizeLanguageId(lang),
							version: version || 1,
							text: text || "",
						},
					})
					result = { ok: true }
					break
				}
				case "change": {
					if (!server.documents.has(lspUri)) {
						// Auto-open if not already open
						server.documents.add(lspUri)
						server.sendNotification("textDocument/didOpen", {
							textDocument: {
								uri: lspUri,
								languageId: this._normalizeLanguageId(lang),
								version: version || 1,
								text: text || "",
							},
						})
					}
					server.sendNotification("textDocument/didChange", {
						textDocument: { uri: lspUri, version: version || 1 },
						contentChanges: [{ text: text || "" }],
					})
					result = { ok: true }
					break
				}
				case "close": {
					if (server.documents.has(lspUri)) {
						server.documents.delete(lspUri)
						server.sendNotification("textDocument/didClose", {
							textDocument: { uri: lspUri },
						})
					}
					result = { ok: true }
					break
				}
				case "completion": {
					result = await server.sendRequest("textDocument/completion", {
						textDocument: { uri: lspUri },
						position: { line: line || 0, character: column || 0 },
					})
					break
				}
				case "hover": {
					result = await server.sendRequest("textDocument/hover", {
						textDocument: { uri: lspUri },
						position: { line: line || 0, character: column || 0 },
					})
					break
				}
				case "definition": {
					result = await server.sendRequest("textDocument/definition", {
						textDocument: { uri: lspUri },
						position: { line: line || 0, character: column || 0 },
					})
					break
				}
				case "references": {
					result = await server.sendRequest("textDocument/references", {
						textDocument: { uri: lspUri },
						position: { line: line || 0, character: column || 0 },
						context: { includeDeclaration: true },
					})
					break
				}
				case "codeAction": {
					result = await server.sendRequest("textDocument/codeAction", {
						textDocument: { uri: lspUri },
						range: {
							start: { line: line || 0, character: column || 0 },
							end: { line: line || 0, character: (column || 0) + 1 },
						},
						context: { diagnostics: msg.diagnostics || [] },
					})
					break
				}
				default: {
					result = { error: `Unknown LSP request type: ${type}` }
				}
			}

			ws.send(JSON.stringify({ id, result }))
		} catch (err) {
			console.error(`[LSP Bridge] error handling ${type}:`, err.message)
			ws.send(JSON.stringify({ id, error: err.message }))
		}
	}

	addClient(ws) {
		this.wsClients.add(ws)
		ws.on("close", () => {
			this.wsClients.delete(ws)
			if (this.wsClients.size === 0) {
				// Optional: shutdown idle servers after a delay
			}
		})
	}

	shutdownAll() {
		for (const server of this.servers.values()) {
			server.shutdown()
		}
		this.servers.clear()
	}
}

module.exports = { LspBridge }
