/**
 * Central Brain Client — Shared HTTP client for the SuperRoo Central Brain daemon.
 *
 * All Cloud IDE and Telegram brain functions should use this client instead of
 * creating local in-memory TerminalBrain instances. This ensures every interface
 * (VS Code, Cloud IDE, Telegram, CLI) routes through the SAME Central Brain
 * pipeline: SharedContextPacket → RAG Memory → BrainRouter → Permission Gate →
 * Agent Execute → Memory Save → Audit Log.
 *
 * Usage:
 *   const brain = require("../lib/centralBrainClient")
 *   const result = await brain.run({ source: "telegram", goal: "fix the build", agent: "coder", chatId: 12345 })
 *
 * Environment variables:
 *   CENTRAL_BRAIN_URL  — Default: http://100.64.175.88:3417 (Tailscale IP)
 *   CENTRAL_BRAIN_TOKEN — Default: dev-brain-token
 */

const http = require("http")
const https = require("https")

// ─── Config ─────────────────────────────────────────────────────────────────────

const CENTRAL_BRAIN_URL = process.env.CENTRAL_BRAIN_URL || "http://100.64.175.88:3417"
const CENTRAL_BRAIN_TOKEN = process.env.CENTRAL_BRAIN_TOKEN || process.env.BRAIN_TOKEN || "dev-brain-token"

const parsedUrl = new URL(CENTRAL_BRAIN_URL)
const isHttps = parsedUrl.protocol === "https:"

// ─── Internal: HTTP request helper ──────────────────────────────────────────────

/**
 * Makes an HTTP(S) request to the Central Brain daemon.
 * @param {string} method - HTTP method
 * @param {string} pathname - URL path (e.g., "/brain/run")
 * @param {object|null} body - JSON body (null for GET)
 * @returns {Promise<object>} Parsed JSON response
 */
function request(method, pathname, body) {
	return new Promise((resolve, reject) => {
		const mod = isHttps ? https : http
		const bodyStr = body ? JSON.stringify(body) : null

		const options = {
			hostname: parsedUrl.hostname,
			port: parsedUrl.port || (isHttps ? 443 : 80),
			path: pathname,
			method,
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${CENTRAL_BRAIN_TOKEN}`,
			},
			timeout: 60000, // 60s timeout for brain operations
		}

		if (bodyStr) {
			options.headers["Content-Length"] = Buffer.byteLength(bodyStr)
		}

		const req = mod.request(options, (res) => {
			let data = ""
			res.on("data", (chunk) => {
				data += chunk
			})
			res.on("end", () => {
				try {
					const parsed = JSON.parse(data)
					resolve(parsed)
				} catch {
					resolve({ ok: false, error: `Invalid JSON response: ${data.slice(0, 200)}` })
				}
			})
		})

		req.on("error", (err) => {
			resolve({ ok: false, error: `Central Brain connection failed: ${err.message}` })
		})

		req.on("timeout", () => {
			req.destroy()
			resolve({ ok: false, error: "Central Brain request timed out after 60s" })
		})

		if (bodyStr) {
			req.write(bodyStr)
		}
		req.end()
	})
}

// ─── Public API ─────────────────────────────────────────────────────────────────

/**
 * Runs a task through the Central Brain.
 *
 * @param {object} opts
 * @param {"vscode"|"cloud"|"telegram"|"cli"} opts.source - Interface source
 * @param {string} opts.goal - The user's goal / message
 * @param {string} [opts.agent] - Agent name (coder, debugger, tester, etc.)
 * @param {number|string} [opts.chatId] - Telegram chat ID (for telegram source)
 * @param {number|string} [opts.userId] - Telegram user ID (for telegram source)
 * @param {number|string} [opts.messageId] - Telegram message ID (for telegram source)
 * @param {string} [opts.currentFile] - Current file path (for cloud source)
 * @param {string} [opts.selectedCode] - Selected code (for cloud source)
 * @param {string[]} [opts.openTabs] - Open tabs (for cloud source)
 * @param {string[]} [opts.terminalOutput] - Terminal output (for cloud source)
 * @param {string} [opts.gitBranch] - Git branch
 * @param {string} [opts.gitDiff] - Git diff
 * @param {string} [opts.buildStatus] - Build status
 * @param {string} [opts.testStatus] - Test status
 * @param {string} [opts.cloudSessionId] - Cloud session ID
 * @returns {Promise<{ok: boolean, summary?: string, route?: string, memorySaved?: boolean, error?: string}>}
 */
async function run(opts) {
	const body = {
		source: opts.source || "cli",
		goal: opts.goal || "",
		userMessage: opts.goal || "",
		agent: opts.agent || "coder",
	}

	// Telegram-specific fields
	if (opts.source === "telegram") {
		body.chatId = opts.chatId
		body.userId = opts.userId
		body.messageId = opts.messageId
	}

	// Cloud-specific fields
	if (opts.source === "cloud") {
		body.currentFile = opts.currentFile
		body.selectedCode = opts.selectedCode
		body.openTabs = opts.openTabs
		body.terminalOutput = opts.terminalOutput
		body.cloudSessionId = opts.cloudSessionId
	}

	// Shared fields
	if (opts.gitBranch) body.gitBranch = opts.gitBranch
	if (opts.gitDiff) body.gitDiff = opts.gitDiff
	if (opts.buildStatus) body.buildStatus = opts.buildStatus
	if (opts.testStatus) body.testStatus = opts.testStatus

	return request("POST", "/brain/run", body)
}

/**
 * Checks if the Central Brain daemon is reachable and healthy.
 * @returns {Promise<{ok: boolean, brain?: boolean, error?: string}>}
 */
async function health() {
	return request("GET", "/health", null)
}

/**
 * Submits a task to the legacy /tasks endpoint (still supported).
 * @param {object} opts
 * @param {string} opts.goal - Task goal
 * @param {string} [opts.agent] - Agent name
 * @param {string} [opts.source] - Source identifier
 * @param {object} [opts.payload] - Additional payload
 * @returns {Promise<object>}
 */
async function submitTask(opts) {
	return request("POST", "/tasks", {
		goal: opts.goal || "",
		agent: opts.agent || "coder",
		source: opts.source || "cli",
		payload: opts.payload || {},
	})
}

module.exports = {
	run,
	health,
	submitTask,
	CENTRAL_BRAIN_URL,
}
