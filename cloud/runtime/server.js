/**
 * SuperRoo Runtime Server — Sandboxed command execution.
 *
 * Exposes a single POST /runtime/exec endpoint that runs shell commands
 * inside a policy-validated sandbox and emits events to SuperRooEventBus.
 *
 * Port: SUPERROO_RUNTIME_PORT (default 3418)
 * Start: node cloud/runtime/server.js
 * Or via PM2: pm2 start cloud/runtime/server.js --name superroo-runtime
 */

const http = require("http")
const { exec } = require("child_process")
const { validateCommand } = require("./policy")

let eventBus = null
try {
	eventBus = require("../orchestrator/modules/SuperRooEventBus").eventBus
} catch {
	// graceful fallback when running in isolation
}

/**
 * Read the full request body as a string.
 * @param {http.IncomingMessage} req
 * @returns {Promise<string>}
 */
function readBody(req) {
	return new Promise((resolve, reject) => {
		let body = ""
		req.on("data", (chunk) => (body += chunk))
		req.on("end", () => resolve(body))
		req.on("error", reject)
	})
}

/**
 * Send a JSON response.
 * @param {http.ServerResponse} res
 * @param {number} status
 * @param {unknown} payload
 */
function sendJson(res, status, payload) {
	const body = JSON.stringify(payload)
	res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) })
	res.end(body)
}

const server = http.createServer(async (req, res) => {
	try {
		// Health check
		if (req.method === "GET" && req.url === "/runtime/health") {
			return sendJson(res, 200, { ok: true, pid: process.pid })
		}

		if (req.method !== "POST" || req.url !== "/runtime/exec") {
			return sendJson(res, 404, { ok: false, error: "Not found" })
		}

		const payload = JSON.parse(await readBody(req))
		const { taskId, command, cwd, timeoutMs = 120000, allowNetwork = false } = payload

		if (!command) {
			return sendJson(res, 400, { ok: false, error: "command is required" })
		}

		// Policy check — throws on violation
		validateCommand(command, { allowNetwork })

		// Emit action event
		eventBus?.emit(taskId, "runtime_action", { command, cwd })

		exec(
			command,
			{ cwd: cwd ?? process.cwd(), timeout: timeoutMs, maxBuffer: 1024 * 1024 * 10 },
			(error, stdout, stderr) => {
				const observation = {
					exitCode: error && "code" in error ? error.code : 0,
					stdout: stdout ?? "",
					stderr: stderr ?? "",
					ok: !error,
				}
				// Emit observation event
				eventBus?.emit(taskId, "runtime_observation", observation)

				sendJson(res, error ? 500 : 200, observation)
			},
		)
	} catch (err) {
		sendJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) })
	}
})

const port = Number(process.env.SUPERROO_RUNTIME_PORT ?? 3418)
server.listen(port, "127.0.0.1", () => {
	console.log(`[superroo-runtime] Listening on 127.0.0.1:${port}`)
})

module.exports = server
