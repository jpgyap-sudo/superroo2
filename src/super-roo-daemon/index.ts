/**
 * SuperRoo headless daemon.
 *
 * This is the VPS-friendly runtime wrapper around the SuperRoo orchestrator.
 * It intentionally exposes only a small HTTP surface: health, status, and task
 * submission. Bind to localhost behind SSH/VPN/reverse proxy unless you have a
 * clear reason to expose it.
 */

import * as http from "node:http"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

import { parseTaskSubmission } from "../core/SuperRooTask"
import { SafetyMode, SuperRooOrchestrator } from "../super-roo"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

interface DaemonConfig {
	host: string
	port: number
	dbPath: string
	workspaceRoot: string
	initialMode: SafetyMode
	selfImprove: boolean
	crawlerEnabled: boolean
	token?: string
}

const startedAt = Date.now()

function readConfig(): DaemonConfig {
	const workspaceRoot = process.env.SUPERROO_WORKSPACE_ROOT || process.cwd()
	return {
		host: process.env.SUPERROO_DAEMON_HOST || "127.0.0.1",
		port: Number(process.env.SUPERROO_DAEMON_PORT || "3417"),
		dbPath: process.env.SUPERROO_DB_PATH || path.join(workspaceRoot, ".super-roo", "superroo.sqlite"),
		workspaceRoot,
		initialMode: parseSafetyMode(process.env.SUPERROO_SAFETY_MODE),
		selfImprove: process.env.SUPERROO_SELF_IMPROVE === "true",
		crawlerEnabled: process.env.SUPERROO_CRAWLER_ENABLED === "true",
		token: process.env.SUPERROO_DAEMON_TOKEN || undefined,
	}
}

function parseSafetyMode(value: string | undefined): SafetyMode {
	const modes = Object.values(SafetyMode)
	return modes.includes(value as SafetyMode) ? (value as SafetyMode) : SafetyMode.SAFE
}

function json(res: http.ServerResponse, statusCode: number, body: unknown): void {
	const payload = JSON.stringify(body)
	res.writeHead(statusCode, {
		"content-type": "application/json; charset=utf-8",
		"content-length": Buffer.byteLength(payload),
	})
	res.end(payload)
}

function readBody(req: http.IncomingMessage, maxBytes = 128 * 1024): Promise<string> {
	return new Promise((resolve, reject) => {
		let size = 0
		let body = ""
		req.setEncoding("utf8")
		req.on("data", (chunk) => {
			size += Buffer.byteLength(chunk)
			if (size > maxBytes) {
				reject(new Error("request_body_too_large"))
				req.destroy()
				return
			}
			body += chunk
		})
		req.on("end", () => resolve(body))
		req.on("error", reject)
	})
}

function isAuthorized(req: http.IncomingMessage, token?: string): boolean {
	if (!token) return true
	const auth = req.headers.authorization
	return auth === `Bearer ${token}`
}

function queueCounts(orch: SuperRooOrchestrator) {
	const tasks = orch.queue.list({ limit: 10_000 })
	return tasks.reduce<Record<string, number>>((acc, task) => {
		acc[task.status] = (acc[task.status] ?? 0) + 1
		return acc
	}, {})
}

async function main(): Promise<void> {
	const config = readConfig()
	const orch = new SuperRooOrchestrator({
		dbPath: config.dbPath,
		initialMode: config.initialMode,
		selfImprove: config.selfImprove,
		workspaceRoot: config.workspaceRoot,
		crawlerEnabled: config.crawlerEnabled,
		githubToken: process.env.GITHUB_TOKEN,
		repoOwner: process.env.SUPERROO_REPO_OWNER,
		repoName: process.env.SUPERROO_REPO_NAME,
		vpsHost: process.env.SUPERROO_VPS_HOST,
		vpsUser: process.env.SUPERROO_VPS_USER,
		vpsDeployPath: process.env.SUPERROO_VPS_DEPLOY_PATH,
		vpsSshKeyPath: process.env.SUPERROO_VPS_SSH_KEY_PATH,
		healthUrl: process.env.SUPERROO_HEALTH_URL,
	})

	orch.start()
	orch.runLoop({ idleSleepMs: Number(process.env.SUPERROO_IDLE_SLEEP_MS || "1000") })

	const server = http.createServer(async (req, res) => {
		try {
			const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)

			if (req.method === "GET" && url.pathname === "/health") {
				json(res, 200, {
					ok: orch.isRunning(),
					uptimeMs: Date.now() - startedAt,
					mode: orch.safety.getMode(),
					selfImprove: orch.safety.getSelfImprove(),
				})
				return
			}

			if (req.method === "GET" && url.pathname === "/status") {
				if (!isAuthorized(req, config.token)) {
					json(res, 401, { ok: false, error: "unauthorized" })
					return
				}
				json(res, 200, {
					ok: true,
					running: orch.isRunning(),
					uptimeMs: Date.now() - startedAt,
					mode: orch.safety.getMode(),
					selfImprove: orch.safety.getSelfImprove(),
					queue: queueCounts(orch),
					ml: orch.mlLoop.getStats(),
					crawler: Boolean(orch.crawler),
					deploy: Boolean(orch.deploy),
				})
				return
			}

			if (req.method === "POST" && url.pathname === "/tasks") {
				if (!isAuthorized(req, config.token)) {
					json(res, 401, { ok: false, error: "unauthorized" })
					return
				}
				const body = await readBody(req)
				const input = parseTaskSubmission(JSON.parse(body))
				const task = orch.submit(input)
				json(res, 202, { ok: true, task })
				return
			}

			json(res, 404, { ok: false, error: "not_found" })
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err)
			json(res, 500, { ok: false, error: message })
		}
	})

	await new Promise<void>((resolve) => server.listen(config.port, config.host, resolve))
	console.log(`[superroo-daemon] listening on http://${config.host}:${config.port}`)
	console.log(`[superroo-daemon] db=${config.dbPath}`)

	const shutdown = async () => {
		console.log("[superroo-daemon] shutting down")
		server.close()
		await orch.stop()
		orch.close()
		process.exit(0)
	}

	process.on("SIGINT", shutdown)
	process.on("SIGTERM", shutdown)
}

main().catch((err) => {
	console.error("[superroo-daemon] fatal", err)
	process.exit(1)
})
