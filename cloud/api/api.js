/**
 * SuperRoo Cloud — Job API
 *
 * Minimal HTTP API that enqueues jobs into the BullMQ queue.
 * The worker picks them up and runs them inside the Docker sandbox.
 * Adds agent runtime routes.
 */

const http = require("http")
const { Queue } = require("bullmq")
const IORedis = require("ioredis")
const { exec } = require("child_process")
const { promisify } = require("util")
const fs = require("fs").promises
const path = require("path")

const execAsync = promisify(exec)

let listAgents, getAgent, setAgentEnabled, toggleAgent
try {
	const agentRegistry = require("../agent-runtime/agentRegistry")
	listAgents = agentRegistry.listAgents
	getAgent = agentRegistry.getAgent
	setAgentEnabled = agentRegistry.setAgentEnabled
	toggleAgent = agentRegistry.toggleAgent
} catch (e) {
	console.warn("[api] agentRegistry not found, using fallback")
	listAgents = async () => []
	getAgent = async () => null
	setAgentEnabled = async () => {
		throw new Error("agentRegistry not available")
	}
	toggleAgent = async () => {
		throw new Error("agentRegistry not available")
	}
}

const PORT = process.env.API_PORT || "8787"
const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379"
const QUEUE_NAME = process.env.SUPERROO_QUEUE_NAME || "superroo-jobs"
const LOGS_DIR = process.env.LOGS_DIR || "/opt/superroo2/cloud/logs"

const connection = new IORedis(REDIS_URL, {
	maxRetriesPerRequest: null,
})

const queue = new Queue(QUEUE_NAME, { connection })

function parseBody(req) {
	return new Promise((resolve, reject) => {
		let body = ""
		req.on("data", (chunk) => {
			body += chunk
		})
		req.on("end", () => {
			try {
				resolve(body ? JSON.parse(body) : {})
			} catch (e) {
				reject(e)
			}
		})
		req.on("error", reject)
	})
}

function sendJson(res, status, payload) {
	res.writeHead(status, { "Content-Type": "application/json" })
	res.end(JSON.stringify(payload))
}

// System monitoring
async function getSystemStats() {
	try {
		const [dfOut, freeOut, cpuOut] = await Promise.all([
			execAsync("df -h / | tail -1 | awk '{print $5}'").catch(() => ({ stdout: "0%" })),
			execAsync("free | grep Mem | awk '{print ($3/$2) * 100.0}'").catch(() => ({ stdout: "0" })),
			execAsync(
				"top -bn1 | grep 'Cpu(s)' | sed 's/.*, *\\([0-9.]*\\)%* id.*/\\1/' | awk '{print 100 - $1}'",
			).catch(() => ({ stdout: "0" })),
		])

		return {
			cpu: Math.round(parseFloat(cpuOut.stdout.trim()) || 0),
			ram: Math.round(parseFloat(freeOut.stdout.trim()) || 0),
			disk: parseInt((dfOut.stdout.trim() || "0%").replace("%", "")) || 0,
		}
	} catch (err) {
		console.error("[api] Error getting system stats:", err.message)
		return { cpu: 0, ram: 0, disk: 0 }
	}
}

// Docker stats
async function getDockerStats() {
	try {
		const [psOut, imagesOut] = await Promise.all([
			execAsync("docker ps -a --format '{{.ID}}|{{.Status}}' 2>/dev/null || echo ''").catch(() => ({
				stdout: "",
			})),
			execAsync("docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null || echo ''").catch(() => ({
				stdout: "",
			})),
		])

		const containers = psOut.stdout
			.trim()
			.split("\n")
			.filter((l) => l)
			.map((line) => {
				const [id, status] = line.split("|")
				return { id, status, running: status.toLowerCase().includes("up") }
			})

		const images = imagesOut.stdout
			.trim()
			.split("\n")
			.filter((l) => l && !l.includes("<none>"))

		return {
			containers: containers.length,
			running: containers.filter((c) => c.running).length,
			exited: containers.filter((c) => !c.running).length,
			images: images.length,
			imageList: images.slice(0, 5),
			sandboxReady: images.some((img) => img.includes("superroo-sandbox")),
		}
	} catch (err) {
		console.error("[api] Error getting docker stats:", err.message)
		return { containers: 0, running: 0, exited: 0, images: 0, imageList: [], sandboxReady: false }
	}
}

// Get logs from files
async function getLogs(limit = 50) {
	try {
		const logFiles = ["api-combined.log", "worker-combined.log", "dashboard-combined.log"]
		const allLogs = []

		for (const file of logFiles) {
			const filePath = path.join(LOGS_DIR, file)
			try {
				const content = await fs.readFile(filePath, "utf-8")
				const lines = content.split("\n").filter((l) => l.trim())
				allLogs.push(...lines.slice(-limit).map((line) => ({ file, line })))
			} catch (err) {
				// File doesn't exist yet, skip
			}
		}

		// Sort by timestamp if possible, otherwise just return as-is
		return allLogs.slice(-limit).map((l) => l.line)
	} catch (err) {
		console.error("[api] Error reading logs:", err.message)
		return []
	}
}

// Get job counts by status
async function getJobCounts() {
	try {
		const [waiting, active, completed, failed, delayed] = await Promise.all([
			queue.getWaitingCount(),
			queue.getActiveCount(),
			queue.getCompletedCount(),
			queue.getFailedCount(),
			queue.getDelayedCount(),
		])

		return { waiting, active, completed, failed, delayed, total: waiting + active + completed + failed + delayed }
	} catch (err) {
		console.error("[api] Error getting job counts:", err.message)
		return { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, total: 0 }
	}
}

const server = http.createServer(async (req, res) => {
	const url = req.url || ""
	const method = req.method || "GET"

	try {
		// Health
		if (method === "GET" && url === "/health") {
			sendJson(res, 200, { status: "online", redis: true, worker: true })
			return
		}

		// System stats
		if (method === "GET" && url === "/system") {
			const stats = await getSystemStats()
			sendJson(res, 200, stats)
			return
		}

		// Docker stats
		if (method === "GET" && url === "/docker/status") {
			const stats = await getDockerStats()
			sendJson(res, 200, { success: true, ...stats })
			return
		}

		// Logs
		if (method === "GET" && url.startsWith("/logs")) {
			const urlObj = new URL(url, `http://localhost:${PORT}`)
			const limit = parseInt(urlObj.searchParams.get("limit") || "50")
			const logs = await getLogs(limit)
			sendJson(res, 200, { success: true, logs })
			return
		}

		// Queue stats
		if (method === "GET" && url === "/queue/stats") {
			const counts = await getJobCounts()
			sendJson(res, 200, { success: true, ...counts })
			return
		}

		// List jobs
		if (method === "GET" && url.startsWith("/jobs")) {
			const urlObj = new URL(url, `http://localhost:${PORT}`)
			const status = urlObj.searchParams.get("status") || "all"
			const limit = parseInt(urlObj.searchParams.get("limit") || "50")

			let jobs = []
			if (status === "all" || status === "waiting") {
				const waiting = await queue.getWaiting(0, limit)
				jobs.push(...waiting.map((j) => ({ ...j, status: "waiting" })))
			}
			if (status === "all" || status === "active") {
				const active = await queue.getActive(0, limit)
				jobs.push(...active.map((j) => ({ ...j, status: "active" })))
			}
			if (status === "all" || status === "completed") {
				const completed = await queue.getCompleted(0, limit)
				jobs.push(...completed.map((j) => ({ ...j, status: "completed" })))
			}
			if (status === "all" || status === "failed") {
				const failed = await queue.getFailed(0, limit)
				jobs.push(...failed.map((j) => ({ ...j, status: "failed" })))
			}

			// Format jobs for dashboard
			const formatted = jobs.slice(0, limit).map((j) => ({
				id: j.id,
				name: j.name,
				data: j.data,
				status: j.status,
				progress: j.progress || 0,
				timestamp: j.timestamp,
				processedOn: j.processedOn,
				finishedOn: j.finishedOn,
				failedReason: j.failedReason,
			}))

			sendJson(res, 200, { success: true, jobs: formatted, count: formatted.length })
			return
		}

		// Get job by ID
		if (method === "GET" && url.match(/^\/jobs\/[^/]+$/)) {
			const jobId = url.split("/")[2]
			const job = await queue.getJob(jobId)
			if (!job) {
				sendJson(res, 404, { success: false, error: "Job not found" })
				return
			}

			const state = await job.getState()
			sendJson(res, 200, {
				success: true,
				job: {
					id: job.id,
					name: job.name,
					data: job.data,
					status: state,
					progress: job.progress || 0,
					timestamp: job.timestamp,
					processedOn: job.processedOn,
					finishedOn: job.finishedOn,
					failedReason: job.failedReason,
					returnvalue: job.returnvalue,
				},
			})
			return
		}

		// Cancel job
		if (method === "POST" && url.match(/^\/jobs\/[^/]+\/cancel$/)) {
			const jobId = url.split("/")[2]
			const job = await queue.getJob(jobId)
			if (!job) {
				sendJson(res, 404, { success: false, error: "Job not found" })
				return
			}

			await job.remove()
			sendJson(res, 200, { success: true, jobId, message: "Job cancelled" })
			return
		}

		// Retry job
		if (method === "POST" && url.match(/^\/jobs\/[^/]+\/retry$/)) {
			const jobId = url.split("/")[2]
			const job = await queue.getJob(jobId)
			if (!job) {
				sendJson(res, 404, { success: false, error: "Job not found" })
				return
			}

			await job.retry()
			sendJson(res, 200, { success: true, jobId, message: "Job retried" })
			return
		}

		// List agents
		if (method === "GET" && url === "/agents") {
			const agents = await listAgents()
			sendJson(res, 200, { success: true, agents })
			return
		}

		// Get agent
		if (method === "GET" && url.startsWith("/agents/") && !url.includes("/run") && !url.includes("/toggle")) {
			const id = url.replace("/agents/", "").replace(/\/$/, "")
			const agent = await getAgent(id)
			sendJson(res, 200, { success: true, agent })
			return
		}

		// Toggle agent enabled/disabled
		if (method === "POST" && url.startsWith("/agents/") && url.endsWith("/toggle")) {
			const id = url.replace("/agents/", "").replace("/toggle", "").replace(/\/$/, "")
			try {
				const newState = await toggleAgent(id)
				sendJson(res, 200, { success: true, agentId: id, enabled: newState })
			} catch (e) {
				sendJson(res, 404, { success: false, error: e.message || "Agent not found" })
			}
			return
		}

		// Set agent enabled/disabled state idempotently.
		if (method === "POST" && url.startsWith("/agents/") && url.endsWith("/enabled")) {
			const id = url.replace("/agents/", "").replace("/enabled", "").replace(/\/$/, "")
			try {
				const data = await parseBody(req)
				if (typeof data.enabled !== "boolean") {
					sendJson(res, 400, { success: false, error: "enabled must be a boolean" })
					return
				}

				const enabled = await setAgentEnabled(id, data.enabled)
				sendJson(res, 200, { success: true, agentId: id, enabled })
			} catch (e) {
				sendJson(res, 404, { success: false, error: e.message || "Agent not found" })
			}
			return
		}

		// Run agent
		if (method === "POST" && url.startsWith("/agents/") && url.endsWith("/run")) {
			const id = url.replace("/agents/", "").replace("/run", "").replace(/\/$/, "")
			const data = await parseBody(req)
			const agent = await getAgent(id)
			if (!agent.enabled) {
				sendJson(res, 409, { success: false, error: `Agent disabled: ${id}` })
				return
			}

			const job = await queue.add(data.task || `${id}-run`, {
				task: data.task || `${id}-run`,
				agentId: id,
				commands: Array.isArray(data.commands) ? data.commands : undefined,
				network: data.network || "none",
				inputs: data.inputs || {},
			})
			sendJson(res, 200, { success: true, jobId: job.id, agentId: id })
			return
		}

		// Approvals list
		if (method === "GET" && url === "/approvals") {
			sendJson(res, 200, { success: true, approvals: [] })
			return
		}

		// Approve
		if (method === "POST" && url.match(/^\/approvals\/[^/]+\/approve$/)) {
			const id = url.split("/")[2]
			sendJson(res, 200, { success: true, approvalId: id, status: "approved" })
			return
		}

		// Reject
		if (method === "POST" && url.match(/^\/approvals\/[^/]+\/reject$/)) {
			const id = url.split("/")[2]
			sendJson(res, 200, { success: true, approvalId: id, status: "rejected" })
			return
		}

		// Existing job enqueue
		if (method === "POST" && url === "/job") {
			const data = await parseBody(req)
			const job = await queue.add(data.task || "untitled", {
				task: data.task || "untitled",
				commands: Array.isArray(data.commands) ? data.commands : [],
				network: data.network || "none",
				agentId: data.agentId || undefined,
			})
			sendJson(res, 200, { success: true, jobId: job.id })
			return
		}

		sendJson(res, 404, { error: "not_found", detail: `No route for ${method} ${url}` })
	} catch (err) {
		console.error(`[api] Error handling ${method} ${url}:`, err.message)
		sendJson(res, err.message && err.message.includes("not found") ? 404 : 500, {
			success: false,
			error: err.message || "internal_error",
		})
	}
})

server.listen(PORT, () => {
	console.log(`[api] Listening on port ${PORT} | queue=${QUEUE_NAME} | redis=${REDIS_URL}`)
})
