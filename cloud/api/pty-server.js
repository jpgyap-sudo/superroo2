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
		const existing = sessions.get(sessionId)
		// Rebind WebSocket if the old one is closed
		if (ws && (!existing.ws || existing.ws.readyState !== ws.OPEN)) {
			existing.ws = ws
			log("info", `Rebound WebSocket for session ${sessionId}`, { sessionId })
		}
		return existing
	}

	const shell = options.shell || detectShell()
	const cwd = options.cwd || process.env.HOME || os.homedir()
	const cols = options.cols || 80
	const rows = options.rows || 24

	const pty = require("node-pty")
	const ptyProcess = pty.spawn(shell, [], {
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
		pendingOutput: "",
	}

	// ── PTY stdout → WebSocket ──────────────────────────────
	const handleOutput = (data) => {
		session.lastActivity = Date.now()
		const text = data.toString()
		session.buffer += text
		// Keep buffer manageable (last 1MB)
		const MAX_BUFFER_SIZE = parseInt(process.env.PTY_BUFFER_SIZE_MB || "1", 10) * 1024 * 1024
		if (session.buffer.length > MAX_BUFFER_SIZE) {
			session.buffer = session.buffer.slice(-MAX_BUFFER_SIZE)
		}

		const targetWs = session.ws
		if (targetWs && targetWs.readyState === targetWs.OPEN) {
			try {
				// Flush any pending output first
				if (session.pendingOutput) {
					targetWs.send(
						JSON.stringify({
							type: "pty:output",
							sessionId,
							data: session.pendingOutput,
							timestamp: Date.now(),
						}),
					)
					session.pendingOutput = ""
				}
				targetWs.send(
					JSON.stringify({
						type: "pty:output",
						sessionId,
						data: text,
						timestamp: Date.now(),
					}),
				)
			} catch {
				/* ws closed */
			}
		} else {
			// Buffer output while client is disconnected
			session.pendingOutput += text
			if (session.pendingOutput.length > 102400) {
				session.pendingOutput = session.pendingOutput.slice(-102400)
			}
		}
	}

	if (typeof ptyProcess.onData === "function") {
		ptyProcess.onData(handleOutput)
	} else {
		ptyProcess.stdout?.on("data", handleOutput)
		ptyProcess.stderr?.on("data", handleOutput)
	}

	// ── Handle process exit ─────────────────────────────────
	const handleExit = ({ exitCode, signal }) => {
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
	}

	if (typeof ptyProcess.onExit === "function") {
		ptyProcess.onExit(handleExit)
	} else {
		ptyProcess.on("exit", (exitCode, signal) => handleExit({ exitCode, signal }))
	}

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
			case "pty:attach": {
				const session = sessions.get(sessionId)
				if (session) {
					session.ws = ws
					ws.send(
						JSON.stringify({
							type: "pty:created",
							sessionId: session.id,
							shell: session.shell,
							cwd: session.cwd,
							timestamp: Date.now(),
						}),
					)
					if (session.pendingOutput) {
						ws.send(
							JSON.stringify({
								type: "pty:output",
								sessionId: session.id,
								data: session.pendingOutput,
								timestamp: Date.now(),
							}),
						)
						session.pendingOutput = ""
					}
					ws.send(
						JSON.stringify({
							type: "pty:buffer",
							sessionId: session.id,
							buffer: session.buffer,
							timestamp: Date.now(),
						}),
					)
				} else {
					ws.send(
						JSON.stringify({
							type: "pty:error",
							sessionId,
							error: `Session ${sessionId} not found`,
							timestamp: Date.now(),
						}),
					)
				}
				break
			}

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
				if (typeof session.process.write === "function") {
					session.process.write(payload.data || "")
				} else {
					session.process.stdin?.write(payload.data || "")
				}
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

			case "pty:scrollback": {
				const session = sessions.get(sessionId)
				if (!session) return
				const offset = payload.offset || 0
				const limit = payload.limit || 10000
				const lines = session.buffer.split("\n")
				const slice = lines.slice(Math.max(0, lines.length - offset - limit), lines.length - offset).join("\n")
				ws.send(
					JSON.stringify({
						type: "pty:scrollback",
						sessionId,
						data: slice,
						offset,
						limit,
						totalLines: lines.length,
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
