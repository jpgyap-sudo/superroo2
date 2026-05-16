/**
 * LSP Bridge — Language Server Protocol over WebSocket
 *
 * Spawns language server processes (typescript-language-server, pyright, etc.)
 * and pipes LSP messages between the Monaco Editor (via WebSocket) and the
 * language server process (via stdio).
 *
 * Usage:
 *   const lspBridge = require("./lsp-bridge")
 *   lspBridge.init()  // starts language servers
 *   lspBridge.handleWebSocket(ws, message)  // route LSP messages
 */

const { spawn } = require("child_process")
const path = require("path")
const fs = require("fs")

// ── Configuration ──────────────────────────────────────────────
const LSP_CONFIG = {
	typescript: {
		command: "typescript-language-server",
		args: ["--stdio"],
		languageId: "typescript",
		fileExtensions: [".ts", ".tsx", ".js", ".jsx"],
	},
	python: {
		command: "pyright-langserver",
		args: ["--stdio"],
		languageId: "python",
		fileExtensions: [".py"],
	},
}

// ── State ──────────────────────────────────────────────────────
const servers = new Map() // language -> { process, pending }
let initialized = false

// ── Logging ────────────────────────────────────────────────────
function log(level, msg, meta) {
	const entry = {
		timestamp: Date.now(),
		source: "lsp-bridge",
		level,
		message: msg,
		metadata: meta || {},
	}
	console.log(`[lsp] ${level}: ${msg}`)
	// Also write to API log if available
	try {
		const logDir = process.env.LOGS_DIR || path.resolve(__dirname, "..", "..", "logs")
		const dateStr = new Date().toISOString().slice(0, 10)
		const logFile = path.join(logDir, `superroo-${dateStr}.jsonl`)
		if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true })
		fs.appendFileSync(logFile, JSON.stringify(entry) + "\n", "utf-8")
	} catch {
		// silent
	}
}

// ── Initialize Language Servers ────────────────────────────────
function init() {
	if (initialized) return
	initialized = true

	for (const [lang, config] of Object.entries(LSP_CONFIG)) {
		startServer(lang, config)
	}

	const started = Array.from(servers.keys())
	if (started.length > 0) {
		log("info", "LSP Bridge initialized", { languages: started })
	} else {
		log("debug", "LSP Bridge initialized — no language servers available", {})
	}
}

function startServer(lang, config) {
	// Check if the LSP binary exists before attempting to spawn
	const commandExists = (() => {
		try {
			require("child_process").execSync(
				process.platform === "win32" ? `where ${config.command}` : `which ${config.command}`,
				{ stdio: "ignore" },
			)
			return true
		} catch {
			return false
		}
	})()
	if (!commandExists) {
		log("debug", `LSP binary not found for ${lang} (${config.command}) — skipping`, {})
		return
	}

	try {
		const proc = spawn(config.command, config.args, {
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...process.env },
		})

		const serverState = {
			process: proc,
			config,
			pending: new Map(), // requestId -> { resolve, reject, timer }
			requestId: 0,
			buffer: "",
			capabilities: null,
			documents: new Map(), // uri -> { version, text }
		}

		// ── Handle stdout (LSP responses) ──────────────────────
		proc.stdout.on("data", (chunk) => {
			serverState.buffer += chunk.toString()

			// Parse LSP messages (Content-Length: ...\r\n\r\n<body>)
			while (true) {
				const headerEnd = serverState.buffer.indexOf("\r\n\r\n")
				if (headerEnd === -1) break

				const header = serverState.buffer.slice(0, headerEnd)
				const match = header.match(/Content-Length:\s*(\d+)/i)
				if (!match) {
					serverState.buffer = serverState.buffer.slice(headerEnd + 4)
					continue
				}

				const contentLength = parseInt(match[1], 10)
				const bodyStart = headerEnd + 4
				if (serverState.buffer.length < bodyStart + contentLength) break

				const body = serverState.buffer.slice(bodyStart, bodyStart + contentLength)
				serverState.buffer = serverState.buffer.slice(bodyStart + contentLength)

				try {
					const msg = JSON.parse(body)
					handleLspMessage(lang, serverState, msg)
				} catch (e) {
					log("warn", `Failed to parse LSP message from ${lang}`, { error: e.message })
				}
			}
		})

		// ── Handle stderr ──────────────────────────────────────
		proc.stderr.on("data", (chunk) => {
			log("debug", `[${lang}] ${chunk.toString().trim()}`)
		})

		// ── Handle exit ────────────────────────────────────────
		proc.on("exit", (code, signal) => {
			log("warn", `${lang} language server exited`, { code, signal })
			servers.delete(lang)
			// Auto-restart after 2s
			setTimeout(() => {
				if (!servers.has(lang)) {
					log("info", `Restarting ${lang} language server...`)
					startServer(lang, config)
				}
			}, 2000)
		})

		proc.on("error", (err) => {
			log("error", `Failed to start ${lang} language server`, { error: err.message })
			servers.delete(lang)
		})

		servers.set(lang, serverState)

		// ── Send initialize request ────────────────────────────
		sendLspRequest(lang, "initialize", {
			processId: process.pid,
			clientInfo: { name: "superroo-cloud-ide", version: "1.0.0" },
			capabilities: {
				textDocument: {
					synchronization: {
						didOpen: true,
						didChange: true,
						willSave: true,
						willSaveWaitUntil: false,
						didClose: true,
					},
					completion: {
						completionItem: {
							snippetSupport: true,
							commitCharactersSupport: true,
							documentationFormat: ["markdown", "plaintext"],
						},
						contextSupport: true,
					},
					hover: {
						contentFormat: ["markdown", "plaintext"],
					},
					signatureHelp: {
						signatureInformation: {
							documentationFormat: ["markdown", "plaintext"],
							parameterInformation: { labelOffsetSupport: true },
						},
					},
					references: {},
					definition: {},
					typeDefinition: {},
					implementation: {},
					codeAction: {
						codeActionLiteralSupport: {
							codeActionKind: {
								valueSet: [
									"",
									"quickfix",
									"refactor",
									"refactor.extract",
									"refactor.inline",
									"refactor.rewrite",
									"source",
									"source.organizeImports",
								],
							},
						},
						isPreferredSupport: true,
					},
					documentSymbol: {},
					documentFormatting: {},
					rename: { prepareSupport: true },
				},
				workspace: {
					symbol: {},
					didChangeConfiguration: {},
				},
			},
			initializationOptions: {},
			rootUri: null,
			workspaceFolders: null,
		})
			.then((result) => {
				serverState.capabilities = result.capabilities
				log("info", `${lang} language server initialized`, {
					capabilities: Object.keys(result.capabilities || {}),
				})

				// Send initialized notification
				sendLspNotification(lang, "initialized", {})
			})
			.catch((err) => {
				log("error", `Failed to initialize ${lang} language server`, { error: err.message })
			})
	} catch (err) {
		log("error", `Error starting ${lang} language server`, { error: err.message })
	}
}

// ── Send LSP Request ───────────────────────────────────────────
function sendLspRequest(lang, method, params) {
	return new Promise((resolve, reject) => {
		const server = servers.get(lang)
		if (!server) {
			reject(new Error(`No language server for ${lang}`))
			return
		}

		const id = ++server.requestId
		const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params })

		server.pending.set(id, {
			resolve,
			reject,
			timer: setTimeout(() => {
				server.pending.delete(id)
				reject(new Error(`LSP request ${method} timed out`))
			}, 10000),
		})

		const header = `Content-Length: ${Buffer.byteLength(msg, "utf-8")}\r\n\r\n`
		server.process.stdin.write(header + msg)
	})
}

// ── Send LSP Notification ──────────────────────────────────────
function sendLspNotification(lang, method, params) {
	const server = servers.get(lang)
	if (!server) return

	const msg = JSON.stringify({ jsonrpc: "2.0", method, params })
	const header = `Content-Length: ${Buffer.byteLength(msg, "utf-8")}\r\n\r\n`
	server.process.stdin.write(header + msg)
}

// ── Handle Incoming LSP Message ────────────────────────────────
function handleLspMessage(lang, server, msg) {
	// Response to a request
	if (msg.id !== undefined && msg.id !== null) {
		const pending = server.pending.get(msg.id)
		if (pending) {
			clearTimeout(pending.timer)
			server.pending.delete(msg.id)
			if (msg.error) {
				pending.reject(new Error(msg.error.message))
			} else {
				pending.resolve(msg.result)
			}
		}
		return
	}

	// Notification (e.g., publishDiagnostics)
	if (msg.method === "textDocument/publishDiagnostics") {
		handleDiagnostics(lang, msg.params)
	}
}

// ── Diagnostics Handler ────────────────────────────────────────
const diagnosticCallbacks = new Set()

function onDiagnostics(callback) {
	diagnosticCallbacks.add(callback)
	return () => diagnosticCallbacks.delete(callback)
}

function handleDiagnostics(lang, params) {
	for (const cb of diagnosticCallbacks) {
		try {
			cb(lang, params)
		} catch {
			// silent
		}
	}
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Open a document in the language server.
 */
function openDocument(lang, uri, text, version = 1) {
	const server = servers.get(lang)
	if (!server) return

	server.documents.set(uri, { version, text })
	sendLspNotification(lang, "textDocument/didOpen", {
		textDocument: {
			uri,
			languageId: server.config.languageId,
			version,
			text,
		},
	})
}

/**
 * Update a document in the language server.
 */
function updateDocument(lang, uri, text, version) {
	const server = servers.get(lang)
	if (!server) return

	const doc = server.documents.get(uri)
	const newVersion = version || (doc ? doc.version + 1 : 1)
	server.documents.set(uri, { version: newVersion, text })

	sendLspNotification(lang, "textDocument/didChange", {
		textDocument: { uri, version: newVersion },
		contentChanges: [{ text }],
	})
}

/**
 * Close a document in the language server.
 */
function closeDocument(lang, uri) {
	const server = servers.get(lang)
	if (!server) return

	server.documents.delete(uri)
	sendLspNotification(lang, "textDocument/didClose", {
		textDocument: { uri },
	})
}

/**
 * Get completions at a position.
 */
async function getCompletions(lang, uri, line, column) {
	const server = servers.get(lang)
	if (!server) throw new Error(`No language server for ${lang}`)

	return sendLspRequest(lang, "textDocument/completion", {
		textDocument: { uri },
		position: { line, character: column },
		context: { triggerKind: 1 },
	})
}

/**
 * Get hover info at a position.
 */
async function getHover(lang, uri, line, column) {
	const server = servers.get(lang)
	if (!server) throw new Error(`No language server for ${lang}`)

	return sendLspRequest(lang, "textDocument/hover", {
		textDocument: { uri },
		position: { line, character: column },
	})
}

/**
 * Get code actions at a position.
 */
async function getCodeActions(lang, uri, line, column, diagnostics) {
	const server = servers.get(lang)
	if (!server) throw new Error(`No language server for ${lang}`)

	return sendLspRequest(lang, "textDocument/codeAction", {
		textDocument: { uri },
		range: {
			start: { line, character: column },
			end: { line, character: column + 1 },
		},
		context: {
			diagnostics: diagnostics || [],
			only: ["quickfix", "refactor", "source"],
		},
	})
}

/**
 * Get document symbols.
 */
async function getDocumentSymbols(lang, uri) {
	const server = servers.get(lang)
	if (!server) throw new Error(`No language server for ${lang}`)

	return sendLspRequest(lang, "textDocument/documentSymbol", {
		textDocument: { uri },
	})
}

/**
 * Get definition at a position.
 */
async function getDefinition(lang, uri, line, column) {
	const server = servers.get(lang)
	if (!server) throw new Error(`No language server for ${lang}`)

	return sendLspRequest(lang, "textDocument/definition", {
		textDocument: { uri },
		position: { line, character: column },
	})
}

/**
 * Get references at a position.
 */
async function getReferences(lang, uri, line, column) {
	const server = servers.get(lang)
	if (!server) throw new Error(`No language server for ${lang}`)

	return sendLspRequest(lang, "textDocument/references", {
		textDocument: { uri },
		position: { line, character: column },
		context: { includeDeclaration: true },
	})
}

/**
 * Format a document.
 */
async function formatDocument(lang, uri) {
	const server = servers.get(lang)
	if (!server) throw new Error(`No language server for ${lang}`)

	return sendLspRequest(lang, "textDocument/formatting", {
		textDocument: { uri },
		options: { tabSize: 2, insertSpaces: true },
	})
}

/**
 * Rename symbol at position.
 */
async function rename(lang, uri, line, column, newName) {
	const server = servers.get(lang)
	if (!server) throw new Error(`No language server for ${lang}`)

	return sendLspRequest(lang, "textDocument/rename", {
		textDocument: { uri },
		position: { line, character: column },
		newName,
	})
}

/**
 * Handle an incoming WebSocket message from the Monaco Editor.
 * Routes LSP requests to the appropriate language server.
 */
async function handleWebSocketMessage(ws, message) {
	try {
		const { type, lang, uri, line, column, text, version, diagnostics, newName } = message

		switch (type) {
			case "open":
				openDocument(lang, uri, text, version)
				ws.send(JSON.stringify({ type: "open", success: true }))
				break

			case "change":
				updateDocument(lang, uri, text, version)
				ws.send(JSON.stringify({ type: "change", success: true }))
				break

			case "close":
				closeDocument(lang, uri)
				ws.send(JSON.stringify({ type: "close", success: true }))
				break

			case "completion": {
				const result = await getCompletions(lang, uri, line, column)
				ws.send(JSON.stringify({ type: "completion", id: message.id, result }))
				break
			}

			case "hover": {
				const result = await getHover(lang, uri, line, column)
				ws.send(JSON.stringify({ type: "hover", id: message.id, result }))
				break
			}

			case "codeAction": {
				const result = await getCodeActions(lang, uri, line, column, diagnostics)
				ws.send(JSON.stringify({ type: "codeAction", id: message.id, result }))
				break
			}

			case "definition": {
				const result = await getDefinition(lang, uri, line, column)
				ws.send(JSON.stringify({ type: "definition", id: message.id, result }))
				break
			}

			case "references": {
				const result = await getReferences(lang, uri, line, column)
				ws.send(JSON.stringify({ type: "references", id: message.id, result }))
				break
			}

			case "format": {
				const result = await formatDocument(lang, uri)
				ws.send(JSON.stringify({ type: "format", id: message.id, result }))
				break
			}

			case "rename": {
				const result = await rename(lang, uri, line, column, newName)
				ws.send(JSON.stringify({ type: "rename", id: message.id, result }))
				break
			}

			case "symbols": {
				const result = await getDocumentSymbols(lang, uri)
				ws.send(JSON.stringify({ type: "symbols", id: message.id, result }))
				break
			}

			default:
				ws.send(JSON.stringify({ type: "error", message: `Unknown LSP request type: ${type}` }))
		}
	} catch (err) {
		log("error", "LSP WebSocket handler error", { error: err.message })
		ws.send(JSON.stringify({ type: "error", id: message?.id, message: err.message }))
	}
}

/**
 * Get the list of available language servers and their status.
 */
function getStatus() {
	const status = {}
	for (const [lang, server] of servers) {
		status[lang] = {
			running: server.process && !server.process.killed,
			documents: server.documents.size,
			pendingRequests: server.pending.size,
			capabilities: server.capabilities ? Object.keys(server.capabilities) : null,
		}
	}
	return status
}

// ── Exports ────────────────────────────────────────────────────
module.exports = {
	init,
	openDocument,
	updateDocument,
	closeDocument,
	getCompletions,
	getHover,
	getCodeActions,
	getDocumentSymbols,
	getDefinition,
	getReferences,
	formatDocument,
	rename,
	handleWebSocketMessage,
	onDiagnostics,
	getStatus,
}
