/**
 * SuperRoo Telegram Mini IDE — Backend Server
 *
 * Express server that provides:
 * - Telegram initData validation (HMAC-SHA256)
 * - Workspace file CRUD (read/write/list)
 * - File upload support (images, PDFs, text, Word, MD, etc.)
 * - AI command routing to SuperRoo orchestrator
 * - Live logs
 * - Session management via existing auth system
 *
 * Runs on port 8081, proxied by nginx at /tg/
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

// ── Terminal Brain integration ─────────────────────────────────────────────────

let terminalBrainRouter
try {
	terminalBrainRouter = require("../api/routes/terminal-brain")
} catch {
	// Terminal Brain not available — Mini IDE runs standalone
	terminalBrainRouter = null
}

// ── Config ─────────────────────────────────────────────────────────────────────

const PORT = process.env.MINI_IDE_PORT || 8081
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ""
const CORS_ORIGIN = process.env.CORS_ORIGIN || "https://dev.abcx124.xyz"
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || ""
const SUPERROO_API_URL = process.env.SUPERROO_API_URL || ""
const SUPERROO_API_KEY = process.env.SUPERROO_API_KEY || ""
const SESSION_TTL_MINUTES = Number(process.env.SESSION_TTL_MINUTES || 30)
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, "uploads")

// ── Auth module (for session checking) ─────────────────────────────────────────

let auth
try {
	auth = require("../api/auth")
} catch {
	// Fallback if auth module not available
	auth = null
}

// ── Multer setup for file uploads ──────────────────────────────────────────────

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
		// Preserve original filename but prefix with timestamp to avoid collisions
		const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")
		cb(null, `${Date.now()}-${safeName}`)
	},
})

const upload = multer({
	storage,
	limits: {
		fileSize: 50 * 1024 * 1024, // 50MB max
		files: 10, // Max 10 files at once
	},
	fileFilter: (req, file, cb) => {
		// Allow all file types
		cb(null, true)
	},
})

// ── Telegram initData validation ───────────────────────────────────────────────

function verifyTelegramInitData(initData) {
	if (!initData) {
		// In dev mode, allow without initData
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

// ── Demo data ──────────────────────────────────────────────────────────────────

const DEMO_WORKSPACES = [
	{
		id: "productgenerator",
		name: "Product Generator",
		repo: "jpgyap-sudo/productgenerator",
		status: "Running",
		branch: "main",
		agents: 4,
		bugs: 2,
	},
	{
		id: "superroo2",
		name: "SuperRoo2",
		repo: "jpgyap-sudo/superroo2",
		status: "Running",
		branch: "dev",
		agents: 6,
		bugs: 5,
	},
	{
		id: "xsjprd55",
		name: "Trading Signals",
		repo: "jpgyap-sudo/xsjprd55",
		status: "Idle",
		branch: "main",
		agents: 3,
		bugs: 1,
	},
]

const DEMO_FILES = [
	"src/app/render-queue/page.tsx",
	"src/components/CompletedRenders.tsx",
	"src/server/queueWorker.ts",
	"src/lib/geminiFixer.ts",
	"docker-compose.yml",
	".env.example",
]

const DEMO_LOGS = [
	{ type: "ok", text: "Telegram session verified", time: "10:42" },
	{ type: "ok", text: "Workspace mounted", time: "10:43" },
	{ type: "warn", text: "Gemini fixer retry rate above normal", time: "10:44" },
	{ type: "ok", text: "AI agent prepared code diff", time: "10:45" },
]

// ── Workspace helpers ──────────────────────────────────────────────────────────

function getWorkspaces() {
	return DEMO_WORKSPACES
}

async function getWorkspaceFiles(workspaceId) {
	if (!WORKSPACE_ROOT) return DEMO_FILES

	const workspacePath = path.join(WORKSPACE_ROOT, workspaceId)
	try {
		const files = []
		async function walk(dir) {
			const entries = await fs.readdir(dir, { withFileTypes: true })
			for (const entry of entries) {
				if (
					entry.name === "node_modules" ||
					entry.name === ".git" ||
					entry.name === "dist" ||
					entry.name === ".next"
				)
					continue
				const full = path.join(dir, entry.name)
				if (entry.isDirectory()) await walk(full)
				else files.push(path.relative(workspacePath, full))
			}
		}
		await walk(workspacePath)
		return files.slice(0, 500)
	} catch {
		return DEMO_FILES
	}
}

async function readWorkspaceFile(workspaceId, relPath) {
	if (!WORKSPACE_ROOT) return null
	const workspacePath = path.resolve(WORKSPACE_ROOT, workspaceId)
	const fullPath = path.resolve(workspacePath, relPath)
	if (!fullPath.startsWith(workspacePath)) throw new Error("Invalid path")
	return fs.readFile(fullPath, "utf8")
}

async function writeWorkspaceFile(workspaceId, relPath, content) {
	if (!WORKSPACE_ROOT) return { ok: true, demo: true }
	const workspacePath = path.resolve(WORKSPACE_ROOT, workspaceId)
	const fullPath = path.resolve(workspacePath, relPath)
	if (!fullPath.startsWith(workspacePath)) throw new Error("Invalid path")
	await fs.mkdir(path.dirname(fullPath), { recursive: true })
	await fs.writeFile(fullPath, content, "utf8")
	return { ok: true }
}

async function getWorkspaceLogs(workspaceId) {
	// In production, read from actual log files
	return DEMO_LOGS
}

// ── Express app ────────────────────────────────────────────────────────────────

const app = express()
const server = http.createServer(app)

app.use(cors({ origin: CORS_ORIGIN || true }))
app.use(express.json({ limit: "10mb" }))
app.use(express.urlencoded({ extended: true, limit: "10mb" }))

// Serve static frontend files
app.use(express.static(path.join(__dirname, "public")))

// ── Auth middleware ────────────────────────────────────────────────────────────

app.use("/api", (req, res, next) => {
	// Skip auth for health check
	if (req.path === "/health") return next()

	const initData = String(req.headers["x-telegram-init-data"] || req.query.initData || "")
	const result = verifyTelegramInitData(initData)

	if (!result.ok) {
		// Also try checking via auth module session
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

// ── Terminal Brain routes (mounted under /api/terminal-brain) ──────────────────

if (terminalBrainRouter) {
	app.use(
		"/api/terminal-brain",
		(req, res, next) => {
			// Forward Telegram user info as session headers
			if (req.telegramUser) {
				req.headers["x-session-id"] = `tg-${req.telegramUser.id || "anon"}-${Date.now()}`
			}
			req.headers["x-workspace-root"] = WORKSPACE_ROOT || process.cwd()
			next()
		},
		terminalBrainRouter,
	)
}

// ── API Routes ─────────────────────────────────────────────────────────────────

// Health check
app.get("/api/health", (req, res) => {
	res.json({ status: "online", uptime: process.uptime(), timestamp: new Date().toISOString() })
})

// Session info
app.get("/api/session", (req, res) => {
	res.json({
		user: req.telegramUser,
		ttlMinutes: SESSION_TTL_MINUTES,
		server: os.hostname(),
	})
})

// List workspaces
app.get("/api/workspaces", (req, res) => {
	res.json({ workspaces: getWorkspaces() })
})

// List workspace files
app.get("/api/workspaces/:id/files", async (req, res) => {
	try {
		const files = await getWorkspaceFiles(req.params.id)
		res.json({ files })
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})

// Read a file
app.get("/api/workspaces/:id/file", async (req, res) => {
	try {
		const filePath = String(req.query.path || "")
		if (!filePath) return res.status(400).json({ error: "Missing path query param" })
		const content = await readWorkspaceFile(req.params.id, filePath)
		if (content === null) {
			return res.json({
				path: filePath,
				content: `// Demo content for ${filePath}\n// Connect WORKSPACE_ROOT to read real files.`,
			})
		}
		res.json({ path: filePath, content })
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})

// Write a file
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

// Upload files (images, PDFs, docs, etc.)
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

		// Also accept base64-encoded file data
		const base64Files = req.body.files ? (Array.isArray(req.body.files) ? req.body.files : [req.body.files]) : []

		for (const b64File of base64Files) {
			try {
				const { name, data, type } = typeof b64File === "string" ? JSON.parse(b64File) : b64File
				if (data) {
					const buffer = Buffer.from(data, "base64")
					const safeName = name.replace(/[^a-zA-Z0-9._-]/g, "_")
					const filename = `${Date.now()}-${safeName}`
					const filePath = path.join(UPLOAD_DIR, req.params.id, filename)
					await fs.mkdir(path.dirname(filePath), { recursive: true })
					await fs.writeFile(filePath, buffer)
					uploaded.push({
						originalName: name,
						filename,
						path: filePath,
						size: buffer.length,
						mimetype: type || "application/octet-stream",
						url: `/api/uploads/${req.params.id}/${filename}`,
					})
				}
			} catch {}
		}

		res.json({ ok: true, files: uploaded })
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})

// Serve uploaded files
app.use("/api/uploads/:id", async (req, res, next) => {
	const filePath = path.join(UPLOAD_DIR, req.params.id, req.path)
	try {
		if (!filePath.startsWith(UPLOAD_DIR)) return res.status(403).send("Forbidden")
		res.sendFile(filePath)
	} catch {
		next()
	}
})

// Get workspace logs
app.get("/api/workspaces/:id/logs", async (req, res) => {
	try {
		const logs = await getWorkspaceLogs(req.params.id)
		res.json({ logs })
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})

// Send AI command
app.post("/api/workspaces/:id/command", async (req, res) => {
	try {
		const { prompt, attachments } = req.body
		if (!prompt) return res.status(400).json({ error: "Missing prompt" })

		// If SuperRoo API is configured, forward the command
		// Allow forwarding even when SUPERROO_API_URL is localhost (same-server setup)
		if (SUPERROO_API_URL) {
			const headers = {
				"Content-Type": "application/json",
			}
			// Only add auth header if API key is set (not required for local API)
			if (SUPERROO_API_KEY) {
				headers["Authorization"] = `Bearer ${SUPERROO_API_KEY}`
			}
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

		// Demo mode
		res.json({
			message: `✅ Command queued for ${req.params.id}: "${prompt.substring(0, 50)}${prompt.length > 50 ? "..." : ""}"`,
			demo: true,
		})
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})

// ── Task Sync (cross-platform task memory) ─────────────────────────────────────
//
// These endpoints sync tasks across VS Code extension, Cloud Dashboard,
// and Telegram Mini IDE. Tasks are stored via the auth module so they
// appear in all three platforms.

// In-memory task store (persisted alongside auth tasks)
const miniIdeTasks = []

// Sync a task from Mini IDE to the cloud
app.post("/api/tasks/sync", async (req, res) => {
	try {
		const { workspaceId, action, description, files, status } = req.body
		const user = req.telegramUser
		if (!user) return res.status(401).json({ error: "Unauthorized" })

		const task = {
			id: `miniide-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			workspaceId: workspaceId || "unknown",
			action: action || "command",
			description: description || "",
			files: files || [],
			status: status || "pending",
			source: "telegram-miniide",
			userId: user.id?.toString() || user.username || "unknown",
			userName: user.first_name || user.username || "User",
			timestamp: new Date().toISOString(),
		}

		miniIdeTasks.unshift(task)

		// Also sync to the main auth module if available
		if (auth) {
			try {
				const email = user.username || `${user.id}@telegram.miniide`
				await auth.handleTaskSync(email, {
					tasks: [
						{
							id: task.id,
							title: `${action}: ${description.substring(0, 100)}`,
							description,
							workspaceId,
							source: "telegram-miniide",
							status: "pending",
						},
					],
				})
			} catch {}
		}

		res.json({ ok: true, task })
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})

// Get recent tasks (from Mini IDE + auth module)
app.get("/api/tasks", async (req, res) => {
	try {
		const user = req.telegramUser
		const limit = Math.min(Number(req.query.limit) || 20, 100)

		let cloudTasks = []

		// Try to get tasks from auth module
		if (auth) {
			try {
				const email = user?.username || `${user?.id}@telegram.miniide`
				const result = auth.handleGetTasks(email)
				if (result && result.tasks) {
					cloudTasks = result.tasks.map((t) => ({
						...t,
						source: t.source || "cloud",
					}))
				}
			} catch {}
		}

		// Merge and sort by timestamp
		const allTasks = [...cloudTasks, ...miniIdeTasks]
			.sort((a, b) => new Date(b.timestamp || b.createdAt || 0) - new Date(a.timestamp || a.createdAt || 0))
			.slice(0, limit)

		res.json({ tasks: allTasks })
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})

// Delete a task
app.delete("/api/tasks/:id", async (req, res) => {
	try {
		const idx = miniIdeTasks.findIndex((t) => t.id === req.params.id)
		if (idx !== -1) {
			miniIdeTasks.splice(idx, 1)
		}

		// Also try deleting from auth module
		if (auth) {
			try {
				const user = req.telegramUser
				const email = user?.username || `${user?.id}@telegram.miniide`
				await auth.handleDeleteTask(email, req.params.id)
			} catch {}
		}

		res.json({ ok: true })
	} catch (err) {
		res.status(500).json({ error: err.message })
	}
})

// ── WebSocket server for real-time terminal output streaming ───────────────────

const wss = new WebSocketServer({ server, path: "/ws" })

// Track connected clients per workspace
const wsClients = new Map() // workspaceId -> Set<WebSocket>

wss.on("connection", (ws, req) => {
	const url = new URL(req.url, `http://${req.headers.host}`)
	const workspaceId = url.searchParams.get("workspace") || "global"

	if (!wsClients.has(workspaceId)) {
		wsClients.set(workspaceId, new Set())
	}
	wsClients.get(workspaceId).add(ws)
	ws.workspaceId = workspaceId

	console.log(`[Mini IDE WS] Client connected for workspace: ${workspaceId}`)

	// Send a welcome message
	ws.send(JSON.stringify({ type: "connected", workspaceId, timestamp: new Date().toISOString() }))

	ws.on("close", () => {
		const clients = wsClients.get(workspaceId)
		if (clients) {
			clients.delete(ws)
			if (clients.size === 0) {
				wsClients.delete(workspaceId)
			}
		}
		console.log(`[Mini IDE WS] Client disconnected for workspace: ${workspaceId}`)
	})

	ws.on("error", (err) => {
		console.error(`[Mini IDE WS] Error for workspace ${workspaceId}:`, err.message)
	})
})

// Broadcast a message to all clients connected to a specific workspace
function broadcastToWorkspace(workspaceId, message) {
	const clients = wsClients.get(workspaceId)
	if (!clients) return
	const data = typeof message === "string" ? message : JSON.stringify(message)
	for (const ws of clients) {
		try {
			ws.send(data)
		} catch (err) {
			console.error("[Mini IDE WS] Broadcast error:", err.message)
		}
	}
}

// Broadcast a terminal output line to all workspace clients
function broadcastTerminalOutput(workspaceId, line) {
	broadcastToWorkspace(workspaceId, {
		type: "terminal-output",
		workspaceId,
		line,
		timestamp: new Date().toISOString(),
	})
}

// Broadcast a pipeline update to all workspace clients
function broadcastPipelineUpdate(workspaceId, pipeline) {
	broadcastToWorkspace(workspaceId, {
		type: "pipeline-update",
		workspaceId,
		pipeline,
		timestamp: new Date().toISOString(),
	})
}

// Broadcast a log entry to all workspace clients
function broadcastLogEntry(workspaceId, logEntry) {
	broadcastToWorkspace(workspaceId, {
		type: "log-entry",
		workspaceId,
		log: logEntry,
		timestamp: new Date().toISOString(),
	})
}

// ── Error handler ──────────────────────────────────────────────────────────────

app.use((err, req, res, next) => {
	console.error("[Mini IDE Error]", err)
	res.status(err.status || 500).json({
		error: err.message || "Internal server error",
	})
})

// ── Start server ───────────────────────────────────────────────────────────────

server.listen(PORT, () => {
	console.log(`[Mini IDE] SuperRoo Telegram Mini IDE API listening on port ${PORT}`)
	console.log(`[Mini IDE] WebSocket available at ws://0.0.0.0:${PORT}/ws`)
	console.log(`[Mini IDE] Upload dir: ${UPLOAD_DIR}`)
	console.log(`[Mini IDE] Workspace root: ${WORKSPACE_ROOT || "(not set, using demo data)"}`)
	console.log(`[Mini IDE] NODE_ENV: ${process.env.NODE_ENV || "development"}`)
})

// ── Graceful shutdown ──────────────────────────────────────────────────────────

process.on("SIGINT", () => {
	console.log("[Mini IDE] Shutting down...")
	wss.close(() => {
		console.log("[Mini IDE] WebSocket server closed")
		process.exit(0)
	})
})

process.on("SIGTERM", () => {
	console.log("[Mini IDE] Shutting down...")
	wss.close(() => {
		console.log("[Mini IDE] WebSocket server closed")
		process.exit(0)
	})
})
