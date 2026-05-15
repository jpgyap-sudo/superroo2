/**
 * PTY Server — Real pseudo-terminal shell integration via node-pty + WebSocket
 *
 * Spawns persistent shell processes per session and streams I/O over WebSocket.
 * Supports:
 *   - Real bash/zsh/powershell shell processes
 *   - Live streaming output (not batch after command completes)
 *   - Ctrl+C, tab completion, shell prompts
 *   - Multi-session support (multiple terminal tabs)
 *   - Resize events (cols/rows)
 *   - Environment variable awareness
 *
 * Usage:
 *   const ptyServer = require("./pty-server")
 *   ptyServer.init(wss)  // attach to a WebSocketServer
 */

const { spawn } = require("child_process")
const path = require("path")
const fs = require("fs")
const os = require("os")

// ── Configuration ──────────────────────────────────────────────

const PTY_SESSIONS_DIR = process.env.PTY_SESSIONS_DIR || path.join(os.tmpdir(), "superroo-pty-sessions")

// ── State ──────────────────────────────────────────────────────

/** Map<sessionId, { process, ws, shell, cwd, createdAt, lastActivity }> */
const sessions = new Map()
let initialized = false

// ── Logging ────────────────────────────────────────────────────

function log(level, msg, meta = {}) {
	const entry = { timestamp: Date.now(), source: "pty-server", level, message: msg, metadata: meta }
	console.log(`[pty] ${level}: ${msg}`)
	try {
		const logDir = process.env.LOGS_DIR || path.resolve(__dirname, "..", "..", "logs")
		const dateStr = new Date().toISOString().slice(0, 10)
		const logFile = path.join(logDir, `superroo-${dateStr}.jsonl`)
		if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true })
		fs.appendFileSync(logFile, JSON.stringify(entry) + "\n", "utf-8")
	} catch {
		/* silent */
	}
}

// ── Detect available shell ─────────────────────────────────────

function detectShell() {
	if (process.platform === "win32") {
		return process.env.COMSPEC || "cmd.exe"
	}
	// Try common shells in order of preference
	const shells = ["/bin/zsh", "/bin/bash", "/bin/sh"]
	for (const s of shells) {
		if (fs.existsSync(s)) return s
	}
	return "/bin/sh"
}

// ── Create a PTY session ───────────────────────────────────────

function createSession(sessionId, ws, options = {}) {
	if (sessions.has(sessionId)) {
		log("warn", `Session ${sessionId} already exists, reusing`, { sessionId })
		return sessions.get(sessionId)
	}

	const shell = options.shell || detectShell()
	const cwd = options.cwd || process.env.HOME || os.homedir()
	const cols = options.cols || 80
	const rows = options.rows || 24

	let ptyProcess
	try {
		// Try node-pty first (preferred for real PTY)
		const pty = require("node-pty")
		ptyProcess = pty.spawn(shell, [], {
			name: "xterm-256color",
			cols,
			rows,
			cwd,
			env: {
				...process.env,
				TERM: "xterm-256color",
				SUPERROO_PTY_SESSION: sessionId,
				SUPERROO_PTY: "1",
			},
		})
	} catch (err) {
		// Fallback: spawn a regular child process with pipes (no real PTY but still live streaming)
		log("warn", "node-pty not available, falling back to child_process.spawn", { error: err.message })
		ptyProcess = spawn(shell, [], {
			stdio: ["pipe", "pipe", "pipe"],
			cwd,
			env: {
				...process.env,
				TERM: "xterm-256color",
				SUPERROO_PTY_SESSION: sessionId,
				SUPERROO_PTY: "1",
			},
		})
		// Add a fake resize method for API compatibility
		ptyProcess.resize = () => {}
	}

	const session = {
		id: sessionId,
		process: ptyProcess,
		ws,
		shell,
		cwd,
		cols,
		rows,
		createdAt: Date.now(),
		lastActivity: Date.now(),
		buffer: "",
	}

	// ── PTY stdout → WebSocket ──────────────────────────────
	ptyProcess.onData((data) => {
		session.lastActivity = Date.now()
		session.buffer += data
		// Keep buffer manageable (last 100KB)
		if (session.buffer.length > 102400) {
			session.buffer = session.buffer.slice(-102400)
		}

		if (ws.readyState === ws.OPEN) {
			try {
				ws.send(
					JSON.stringify({
						type: "pty:output",
						sessionId,
						data,
						timestamp: Date.now(),
					}),
				)
			} catch {
				/* ws closed */
			}
		}
	})

	// ── Handle process exit ─────────────────────────────────
	ptyProcess.onExit(({ exitCode, signal }) => {
		log("info", `PTY session ${sessionId} exited`, { sessionId, exitCode, signal })
		if (ws.readyState === ws.OPEN) {
			try {
				ws.send(
					JSON.stringify({
						type: "pty:exit",
						sessionId,
						exitCode,
						signal,
						timestamp: Date.now(),
					}),
				)
			} catch {
				/* ws closed */
			}
		}
		sessions.delete(sessionId)
	})

	sessions.set(sessionId, session)
	log("info", `PTY session created`, { sessionId, shell, cwd, cols, rows })
	return session
}

// ── Handle incoming WebSocket messages ─────────────────────────

function handleMessage(ws, message) {
	try {
		const data = typeof message === "string" ? JSON.parse(message) : message
		const { type, sessionId, ...payload } = data

		switch (type) {
			case "pty:create": {
				const session = createSession(sessionId || `pty-${Date.now()}`, ws, payload)
				ws.send(
					JSON.stringify({
						type: "pty:created",
						sessionId: session.id,
						shell: session.shell,
						cwd: session.cwd,
						timestamp: Date.now(),
					}),
				)
				break
			}

			case "pty:input": {
				const session = sessions.get(sessionId)
				if (!session) {
					ws.send(
						JSON.stringify({
							type: "pty:error",
							sessionId,
							error: `Session ${sessionId} not found`,
							timestamp: Date.now(),
						}),
					)
					return
				}
				session.lastActivity = Date.now()
				session.process.write(payload.data || "")
				break
			}

			case "pty:resize": {
				const session = sessions.get(sessionId)
				if (!session) return
				const cols = payload.cols || session.cols
				const rows = payload.rows || session.rows
				session.cols = cols
				session.rows = rows
				try {
					session.process.resize(cols, rows)
				} catch {
					/* resize not supported in fallback mode */
				}
				break
			}

			case "pty:kill": {
				const session = sessions.get(sessionId)
				if (!session) return
				try {
					session.process.kill("SIGTERM")
					// Force kill after 3s if still alive
					setTimeout(() => {
						try {
							session.process.kill("SIGKILL")
						} catch {}
					}, 3000)
				} catch {
					/* already dead */
				}
				sessions.delete(sessionId)
				break
			}

			case "pty:list": {
				const sessionList = Array.from(sessions.entries()).map(([id, s]) => ({
					id,
					shell: s.shell,
					cwd: s.cwd,
					createdAt: s.createdAt,
					lastActivity: s.lastActivity,
					cols: s.cols,
					rows: s.rows,
				}))
				ws.send(
					JSON.stringify({
						type: "pty:list",
						sessions: sessionList,
						timestamp: Date.now(),
					}),
				)
				break
			}

			case "pty:getBuffer": {
				const session = sessions.get(sessionId)
				if (!session) return
				ws.send(
					JSON.stringify({
						type: "pty:buffer",
						sessionId,
						buffer: session.buffer,
						timestamp: Date.now(),
					}),
				)
				break
			}
		}
	} catch (err) {
		log("error", "Failed to handle PTY message", { error: err.message })
	}
}

// ── Initialize ────────────────────────────────────────────────

function init(wss) {
	if (initialized) return
	initialized = true

	// Ensure sessions directory exists
	try {
		fs.mkdirSync(PTY_SESSIONS_DIR, { recursive: true })
	} catch {}

	log("info", "PTY Server initialized", { platform: process.platform, shell: detectShell() })

	// Clean up stale sessions every 5 minutes
	setInterval(
		() => {
			const now = Date.now()
			const STALE_TIMEOUT = 30 * 60 * 1000 // 30 minutes
			for (const [id, session] of sessions.entries()) {
				if (now - session.lastActivity > STALE_TIMEOUT) {
					log("info", `Cleaning up stale PTY session`, { sessionId: id })
					try {
						session.process.kill("SIGTERM")
					} catch {}
					sessions.delete(id)
				}
			}
		},
		5 * 60 * 1000,
	)
}

// ── Cleanup on exit ───────────────────────────────────────────

function shutdown() {
	log("info", "Shutting down PTY server, killing all sessions")
	for (const [id, session] of sessions.entries()) {
		try {
			session.process.kill("SIGTERM")
		} catch {}
	}
	sessions.clear()
}

process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)

module.exports = { init, handleMessage, createSession, getSessions: () => sessions, shutdown }
