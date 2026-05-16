/**
 * Terminal Brain — API Routes
 *
 * Express router that exposes the Terminal Brain Layer as REST endpoints.
 * Integrates with the existing cloud API server.
 *
 * Endpoints:
 *   POST /api/terminal-brain/process — Main entry point
 *   GET  /api/terminal-brain/context  — Get project context
 *   GET  /api/terminal-brain/memory   — Get terminal memory
 *   POST /api/terminal-brain/execute  — Execute a command
 *   POST /api/terminal-brain/plan     — Plan commands from NL
 *   POST /api/terminal-brain/analyze  — Analyze output for errors
 *   POST /api/terminal-brain/fix      — Suggest fix for errors
 *   GET  /api/terminal-brain/stats    — Get memory stats
 */

const express = require("express")
const router = express.Router()
const { loadTerminalCore } = require("../lib/terminalCore")

// ─── Persistent memory setup ─────────────────────────────────────────────

let pgStore = null
try {
	const { PgTerminalStore } = loadTerminalCore()
	if (process.env.DATABASE_URL && PgTerminalStore) {
		pgStore = new PgTerminalStore({ connectionString: process.env.DATABASE_URL })
	}
} catch {
	// PostgreSQL not available — fall back to in-memory
}

// ─── In-memory brain instances (one per session) ─────────────────────────

const brains = new Map()

function getOrCreateBrain(sessionId, workspaceRoot, userId) {
	if (!brains.has(sessionId)) {
		const { TerminalBrain, getPersistentTerminalMemory, getTerminalMemory } = loadTerminalCore()
		const memory = pgStore ? getPersistentTerminalMemory(pgStore) : getTerminalMemory()
		const brain = new TerminalBrain({ workspaceRoot, sessionId, memory, userId })
		brains.set(sessionId, brain)
	}
	return brains.get(sessionId)
}

// ─── Middleware ───────────────────────────────────────────────────────────

router.use((req, res, next) => {
	const sessionId = req.headers["x-session-id"] || req.query.sessionId || `session-${Date.now()}`
	const workspaceRoot = req.headers["x-workspace-root"] || process.env.WORKSPACE_ROOT || process.cwd()
	const userId = req.headers["x-user-id"] || req.query.userId || undefined
	req.brain = getOrCreateBrain(sessionId, workspaceRoot, userId)
	req.sessionId = sessionId
	next()
})

// ─── POST /process — Main entry point ────────────────────────────────────

router.post("/process", async (req, res) => {
	try {
		const { action, command, nlQuery, sessionId, workspaceId } = req.body
		const result = await req.brain.process({
			action: action || "execute",
			command,
			nlQuery,
			sessionId: sessionId || req.sessionId,
			workspaceId,
		})
		res.json(result)
	} catch (err) {
		res.status(500).json({ ok: false, error: err.message })
	}
})

// ─── GET /context — Get project context ──────────────────────────────────

router.get("/context", async (req, res) => {
	try {
		const result = await req.brain.process({ action: "context" })
		res.json(result)
	} catch (err) {
		res.status(500).json({ ok: false, error: err.message })
	}
})

// ─── GET /memory — Get terminal memory ───────────────────────────────────

router.get("/memory", async (req, res) => {
	try {
		const result = await req.brain.process({ action: "memory" })
		res.json(result)
	} catch (err) {
		res.status(500).json({ ok: false, error: err.message })
	}
})

// ─── POST /execute — Execute a command ───────────────────────────────────

router.post("/execute", async (req, res) => {
	try {
		const { command } = req.body
		if (!command) {
			return res.status(400).json({ ok: false, error: "No command provided" })
		}
		const result = await req.brain.process({ action: "execute", command })
		res.json(result)
	} catch (err) {
		res.status(500).json({ ok: false, error: err.message })
	}
})

// ─── POST /plan — Plan commands from natural language ────────────────────

router.post("/plan", async (req, res) => {
	try {
		const { query } = req.body
		if (!query) {
			return res.status(400).json({ ok: false, error: "No query provided" })
		}
		const result = await req.brain.process({ action: "plan", nlQuery: query })
		res.json(result)
	} catch (err) {
		res.status(500).json({ ok: false, error: err.message })
	}
})

// ─── POST /analyze — Analyze output for errors ───────────────────────────

router.post("/analyze", async (req, res) => {
	try {
		const { output } = req.body
		if (!output) {
			return res.status(400).json({ ok: false, error: "No output provided" })
		}
		const result = await req.brain.process({ action: "analyze", command: output })
		res.json(result)
	} catch (err) {
		res.status(500).json({ ok: false, error: err.message })
	}
})

// ─── POST /fix — Suggest fix for errors ──────────────────────────────────

router.post("/fix", async (req, res) => {
	try {
		const { output } = req.body
		if (!output) {
			return res.status(400).json({ ok: false, error: "No output provided" })
		}
		const result = await req.brain.process({ action: "fix", command: output })
		res.json(result)
	} catch (err) {
		res.status(500).json({ ok: false, error: err.message })
	}
})

// ─── POST /snippets — Discover smart snippets ────────────────────────────

router.post("/snippets", async (req, res) => {
	try {
		const { workspaceId } = req.body
		const result = await req.brain.process({ action: "snippets", workspaceId })
		res.json(result)
	} catch (err) {
		res.status(500).json({ ok: false, error: err.message })
	}
})

// ─── GET /stats — Get memory stats ───────────────────────────────────────

router.get("/stats", (req, res) => {
	try {
		const stats = req.brain.getStats()
		res.json({ ok: true, stats })
	} catch (err) {
		res.status(500).json({ ok: false, error: err.message })
	}
})

module.exports = router
