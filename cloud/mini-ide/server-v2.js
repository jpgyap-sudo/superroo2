/**
 * SuperRoo Mini IDE — Backend Server v2
 *
 * Improvements copied from openvscode-server:
 * 1. Connection-token auth (serverConnectionToken.ts pattern)
 * 2. Secure static file serving with ETag caching (webClientServer.ts pattern)
 * 3. Typed RPC over WebSocket with req/response correlation (remoteAgentConnection.ts pattern)
 * 4. Graceful shutdown with connection draining (remoteExtensionHostAgentServer.ts pattern)
 * 5. Path traversal protection on all file operations
 */

const express = require("express")
const cors = require("cors")
const crypto = require("crypto")
const fs = require("fs").promises
const path = require("path")
const os = require("os")
const multer = require("multer")
const http = require("http")
const { WebSocketServer } = require("ws")
const url = require("url")

// ── Adapted from openvscode-server ────────────────────────────────────────────
const {
	MandatoryConnectionToken,
	loadOrCreateToken,
	requestHasValidConnectionToken,
	setConnectionTokenCookie,
} = require("./lib/ConnectionToken")
const { RpcChannel } = require("./lib/RpcChannel")
const { serveFile, serveError, CacheControl } = require("./lib/serveFile")

// ── Terminal Brain integration ───────────────────────────────────────────────
let terminalBrainRouter
try {
	terminalBrainRouter = require("../api/routes/terminal-brain")
} catch {
	terminalBrainRouter = null
}

// ── Config ───────────────────────────────────────────────────────────────────
const PORT = process.env.MINI_IDE_PORT || 8081
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ""
const CORS_ORIGIN = process.env.CORS_ORIGIN || "https://dev.abcx124.xyz"
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || ""
const SUPERROO_API_URL = process.env.SUPERROO_API_URL || ""
const SUPERROO_API_KEY = process.env.SUPERROO_API_KEY || ""
const SESSION_TTL_MINUTES = Number(process.env.SESSION_TTL_MINUTES || 30)
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, "uploads")
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, ".data")

// ── Connection Token (copied pattern from openvscode-server) ──────────────────
const connectionToken = (() => {
	const explicit = process.env.CONNECTION_TOKEN
	if (explicit) return new MandatoryConnectionToken(explicit)
	const auto = loadOrCreateToken(DATA_DIR)
	return new MandatoryConnectionToken(auto)
})()

console.log(`[Mini IDE] Connection token: ${connectionToken.value.substring(0, 8)}...`)

// ── Auth module ──────────────────────────────────────────────────────────────
let auth
try {
	auth = require("../api/auth")
} catch {
	auth = null
}

// ── Multer setup ─────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
	destination: async (req, file, cb) => {
		const workspaceId = req.params.id || "shared"
		const dest = path.join(UPLOAD_DIR, workspaceId)
		try {
			await fs.mkdir(dest, { recursive: true })
		} catch {}
		cb(null, dest)
	},
	filename: (req, file, cb) => {
		const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")
		cb(null, `${Date.now()}-${safeName}`)
	},
})

const upload = multer({
	storage,
	limits: { fileSize: 50 * 1024 * 1024, files: 10 },
})

// ── Telegram initData validation ─────────────────────────────────────────────
function verifyTelegramInitData(initData) {
	if (!initData) {
		if (process.env.NODE_ENV !== "production") {
			return { ok: true, user: { id: 0, username: "dev", first_name: "Dev" } }
		}
		return { ok: false, error: "Missing Telegram initData" }
	}

	const params = new URLSearchParams(initData)
	const hash = params.get("hash")
	if (!hash) return { ok: false, error: "Missing hash" }
	params.delete("hash")

	const dataCheckString = Array.from(params.entries())
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([key, value]) => `${key}=${value}`)
		.join("\n")

	const secretKey = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest()
	const calculatedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex")

	try {
		const valid = crypto.timingSafeEqual(Buffer.from(calculatedHash, "hex"), Buffer.from(hash, "hex"))
		if (!valid) return { ok: false, error: "Invalid Telegram signature" }
	} catch {
		return { ok: false, error: "Hash comparison failed" }
	}

	const userRaw = params.get("user")
	const user = userRaw ? JSON.parse(userRaw) : null
	return { ok: true, user }
}

// ── Workspace helpers (with path traversal protection) ───────────────────────
async function getWorkspaceFiles(workspaceId) {
	if (!WORKSPACE_ROOT) return []
	const workspacePath = path.resolve(WORKSPACE_ROOT, workspaceId)
	// Path traversal protection
	const resolvedRoot = path.resolve(WORKSPACE_ROOT)
	if (!workspacePath.startsWith(resolvedRoot + path.sep) && workspacePath !== resolvedRoot) {
		throw new Error("Invalid workspace path")
	}
	const files = []
	async function walk(dir) {
		const entries = await fs.readdir(dir, { withFileTypes: true })
		for (const entry of entries) {
			if (["node_modules", ".git", "dist", ".next"].includes(entry.name)) continue
			const full = path.join(dir, entry.name)
			if (entry.isDirectory()) await walk(full)
			else files.push(path.relative(workspacePath, full))
		}
	}
	await walk(workspacePath)
	return files.slice(0, 500)
}

async function readWorkspaceFile(workspaceId, relPath) {
	if (!WORKSPACE_ROOT) return null
	const workspacePath = path.resolve(WORKSPACE_ROOT, workspaceId)
	const fullPath = path.resolve(workspacePath, relPath)
	const resolvedRoot = path.resolve(WORKSPACE_ROOT)
	if (!fullPath.startsWith(resolvedRoot)) throw new Error("Invalid path")
	return fs.readFile(fullPath, "utf8")
}

async function writeWorkspaceFile(workspaceId, relPath, content) {
	if (!WORKSPACE_ROOT) return { ok: true, demo: true }
	const workspacePath = path.resolve(WORKSPACE_ROOT, workspaceId)
	const fullPath = path.resolve(workspacePath, relPath)
	const resolvedRoot = path.resolve(WORKSPACE_ROOT)
	if (!fullPath.startsWith(resolvedRoot)) throw new Error("Invalid path")
	await fs.mkdir(path.dirname(fullPath), { recursive: true })
	await fs.writeFile(fullPath, content, "utf8")
	return { ok: true }
}

// ── Express app ──────────────────────────────────────────────────────────────
const app = express()
const server = http.createServer(app)

app.use(cors({ origin: CORS_ORIGIN || true }))
app.use(express.json({ limit: "10mb" }))
app.use(express.urlencoded({ extended: true, limit: "10mb" }))

// ── Connection token validation middleware (copied pattern) ──────────────────
function validateConnectionToken(req, res, next) {
	// Skip for health checks and static assets
	if (req.path === "/api/health") return next()
	if (req.path.startsWith("/static/")) return next()

	const parsedUrl = url.parse(req.url, true)
	if (!requestHasValidConnectionToken(connectionToken, req, parsedUrl)) {
		return res.status(403).json({ error: "Forbidden. Invalid or missing connection token." })
	}
	next()
}

app.use(validateConnectionToken)

// ── Secure static file serving (copied from webClientServer.ts) ──────────────
const PUBLIC_ROOT = path.join(__dirname, "public")
app.get("/static/*", async (req, res) => {
	const resourcePath = decodeURIComponent(req.path.substring("/static/".length))
	const filePath = path.join(PUBLIC_ROOT, resourcePath)
	// Development: ETag caching. Production: no-expiry caching.
	const cacheMode = process.env.NODE_ENV === "production" ? CacheControl.NO_EXPIRY : CacheControl.ETAG
	await serveFile(filePath, cacheMode, req, res, {}, PUBLIC_ROOT)
})

// ── Auth middleware ──────────────────────────────────────────────────────────
app.use("/api", (req, res, next) => {
	if (req.path === "/health") return next()

	const initData = String(req.headers["x-telegram-init-data"] || req.query.initData || "")
	const result = verifyTelegramInitData(initData)

	if (!result.ok) {
		const authHeader = req.headers["authorization"] || ""
		if (authHeader.startsWith("Bearer ") && auth) {
			const token = authHeader.slice(7)
			const user = auth.authenticate({ headers: { authorization: authHeader } })
			if (user) {
				req.telegramUser = { id: user.email, username: user.email, first_name: user.name || user.email }
				return next()
			}
		}
		return res.status(401).json({ error: result.error || "Unauthorized" })
	}

	req.telegramUser = result.user
	next()
})

// ── Terminal Brain routes ────────────────────────────────────────────────────
if (terminalBrainRouter) {
	app.use(
		"/api/terminal-brain",
		(req, res, next) => {
			if (req.telegramUser) {
				req.headers["x-session-id"] = `tg-${req.telegramUser.id || "anon"}-${Date.now()}`
			}
			req.headers["x-workspace-root"] = WORKSPACE_ROOT || process.cwd()
			next()
		},
		terminalBrainRouter,
	)
}

// ── API Routes ───────────────────────────────────────────────────────────────

app.get("/api/health", (req, res) => {
	res.json({ status: "online", uptime: process.uptime(), timestamp: new Date().toISOString() })
})

app.get("/api/session", (req, res) => {
	res.json({
		user: req.telegramUser,
		ttlMinutes: SESSION_TTL_MINUTES,
		server: os.hostname(),
	})
})

app.get("/api/workspaces/:id/files", async (req, res) => {
	try {
		const files = await getWorkspaceFiles(req.params.id)
		res.json({ files })
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})

app.get("/api/workspaces/:id/file", async (req, res) => {
	try {
		const filePath = String(req.query.path || "")
		if (!filePath) return res.status(400).json({ error: "Missing path" })
		const content = await readWorkspaceFile(req.params.id, filePath)
		if (content === null) {
			return res.json({ path: filePath, content: `// Demo content for ${filePath}` })
		}
		res.json({ path: filePath, content })
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})

app.post("/api/workspaces/:id/file", async (req, res) => {
	try {
		const { path: filePath, content } = req.body
		if (!filePath) return res.status(400).json({ error: "Missing path" })
		const result = await writeWorkspaceFile(req.params.id, filePath, content)
		res.json(result)
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})

app.post("/api/workspaces/:id/upload", upload.array("files", 10), async (req, res) => {
	try {
		const files = req.files || []
		const uploaded = files.map((f) => ({
			originalName: f.originalname,
			filename: f.filename,
			path: f.path,
			size: f.size,
			mimetype: f.mimetype,
			url: `/api/uploads/${req.params.id}/${f.filename}`,
		}))
		res.json({ ok: true, files: uploaded })
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})

app.use("/api/uploads/:id", async (req, res, next) => {
	const filePath = path.join(UPLOAD_DIR, req.params.id, req.path)
	try {
		if (!filePath.startsWith(UPLOAD_DIR)) return res.status(403).send("Forbidden")
		res.sendFile(filePath)
	} catch {
		next()
	}
})

app.post("/api/workspaces/:id/command", async (req, res) => {
	try {
		const { prompt, attachments } = req.body
		if (!prompt) return res.status(400).json({ error: "Missing prompt" })
		if (SUPERROO_API_URL) {
			const headers = { "Content-Type": "application/json" }
			if (SUPERROO_API_KEY) headers["Authorization"] = `Bearer ${SUPERROO_API_KEY}`
			const response = await fetch(`${SUPERROO_API_URL}/api/workspaces/${req.params.id}/commands`, {
				method: "POST",
				headers,
				body: JSON.stringify({
					prompt,
					attachments: attachments || [],
					source: "telegram-miniide",
					telegramUser: req.telegramUser,
				}),
			})
			if (!response.ok) {
				const text = await response.text()
				return res.status(502).json({ error: `SuperRoo API error: ${text}` })
			}
			return res.json(await response.json())
		}
		res.json({ message: `✅ Command queued`, demo: true })
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})

// ── Typed WebSocket RPC Server (adapted from remoteAgentConnection.ts) ───────

const wss = new WebSocketServer({ server, path: "/ws" })
const wsClients = new Map() // workspaceId -> Set<WebSocket>
const rpcChannels = new Map() // ws -> RpcChannel

// RPC method handlers
const rpcMethods = {
	async "workspace:files"({ workspaceId }) {
		return { files: await getWorkspaceFiles(workspaceId) }
	},
	async "workspace:read"({ workspaceId, filePath }) {
		return { content: await readWorkspaceFile(workspaceId, filePath) }
	},
	async "workspace:write"({ workspaceId, filePath, content }) {
		return await writeWorkspaceFile(workspaceId, filePath, content)
	},
	async "terminal:plan"({ query }) {
		// Forward to terminal brain if available
		return { plan: [`echo "Plan for: ${query}"`] }
	},
}

wss.on("connection", (ws, req) => {
	const parsedUrl = url.parse(req.url || "", true)
	const workspaceId = parsedUrl.query.workspace || "global"

	// Validate connection token on WebSocket upgrade
	if (!requestHasValidConnectionToken(connectionToken, req, parsedUrl)) {
		ws.close(1008, "Invalid connection token")
		return
	}

	// Create typed RPC channel
	const channel = new RpcChannel(ws, { timeoutMs: 30000 })
	rpcChannels.set(ws, channel)

	if (!wsClients.has(workspaceId)) {
		wsClients.set(workspaceId, new Set())
	}
	wsClients.get(workspaceId).add(ws)
	ws.workspaceId = workspaceId

	console.log(`[Mini IDE WS] RPC client connected for workspace: ${workspaceId}`)

	// Handle incoming RPC requests
	channel._handleIncomingRequest = async (msg) => {
		const handler = rpcMethods[msg.method]
		if (!handler) {
			channel.sendResponse(msg.reqId, null, `Unknown method: ${msg.method}`)
			return
		}
		try {
			const result = await handler(msg.args || {})
			channel.sendResponse(msg.reqId, result, null)
		} catch (err) {
			channel.sendResponse(msg.reqId, null, err.message)
		}
	}

	// Send welcome
	channel.emitEvent("connected", { workspaceId, timestamp: new Date().toISOString() })

	ws.on("close", () => {
		const clients = wsClients.get(workspaceId)
		if (clients) {
			clients.delete(ws)
			if (clients.size === 0) wsClients.delete(workspaceId)
		}
		rpcChannels.delete(ws)
		channel.dispose()
		console.log(`[Mini IDE WS] Client disconnected for workspace: ${workspaceId}`)
	})

	ws.on("error", (err) => {
		console.error(`[Mini IDE WS] Error for workspace ${workspaceId}:`, err.message)
	})
})

// Broadcast helpers (now use RPC events)
function broadcastToWorkspace(workspaceId, event, payload) {
	const clients = wsClients.get(workspaceId)
	if (!clients) return
	for (const ws of clients) {
		const channel = rpcChannels.get(ws)
		if (channel) {
			try {
				channel.emitEvent(event, payload)
			} catch (err) {
				console.error("[Mini IDE WS] Broadcast error:", err.message)
			}
		}
	}
}

function broadcastTerminalOutput(workspaceId, line) {
	broadcastToWorkspace(workspaceId, "terminal-output", { line, timestamp: new Date().toISOString() })
}

function broadcastPipelineUpdate(workspaceId, pipeline) {
	broadcastToWorkspace(workspaceId, "pipeline-update", { pipeline, timestamp: new Date().toISOString() })
}

// ── Error handler ────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
	console.error("[Mini IDE Error]", err)
	res.status(err.status || 500).json({ error: err.message || "Internal server error" })
})

// ── Graceful shutdown (copied from remoteExtensionHostAgentServer.ts) ────────
let isShuttingDown = false

function shutdown() {
	if (isShuttingDown) return
	isShuttingDown = true
	console.log("[Mini IDE] Shutting down gracefully...")

	// Stop accepting new connections
	server.close(() => {
		console.log("[Mini IDE] HTTP server closed")
	})

	// Close all WebSocket connections gracefully
	wss.clients.forEach((ws) => {
		ws.close(1001, "Server shutting down")
	})

	wss.close(() => {
		console.log("[Mini IDE] WebSocket server closed")
		process.exit(0)
	})

	// Force exit after timeout
	setTimeout(() => {
		console.error("[Mini IDE] Forced shutdown")
		process.exit(1)
	}, 10000)
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)

// ── Start server ─────────────────────────────────────────────────────────────
server.listen(PORT, () => {
	console.log(`[Mini IDE] API listening on port ${PORT}`)
	console.log(`[Mini IDE] WebSocket RPC available at ws://0.0.0.0:${PORT}/ws`)
	console.log(`[Mini IDE] Upload dir: ${UPLOAD_DIR}`)
	console.log(`[Mini IDE] Workspace root: ${WORKSPACE_ROOT || "(not set)"}`)
	console.log(`[Mini IDE] Public files: /static/* (secure, ETag cached)`)
})
