/**
 * SuperRoo Cloud — Monitoring API Routes
 *
 * Exposes log aggregation, system stats, health timeline data,
 * alert history, and alert rule management for the Monitoring Dashboard.
 *
 * Endpoints:
 *   GET  /api/monitoring/logs              — Query aggregated logs
 *   GET  /api/monitoring/stats             — System stats (CPU, memory, active agents, recent errors)
 *   GET  /api/monitoring/health-timeline   — Health check history
 *   GET  /api/monitoring/alerts            — Alert history
 *   GET  /api/monitoring/alerts/rules      — Alert rules
 *   PUT  /api/monitoring/alerts/rules/:id  — Update alert rule
 *   POST /api/monitoring/alerts/:id/ack    — Acknowledge alert
 *   POST /api/monitoring/alerts/:id/resolve — Resolve alert
 *   GET  /api/monitoring/alerts/stats      — Alert statistics
 */

const fs = require("fs")
const path = require("path")
const os = require("os")
const { exec } = require("child_process")
const { promisify } = require("util")

const execAsync = promisify(exec)

// ── Configuration ────────────────────────────────────────────────────────────────

/** Path to the logs directory (relative to project root) */
const LOGS_DIR = path.resolve(__dirname, "..", "..", "..", "logs")

/** Path to the healing metrics JSON file */
const METRICS_PATH = path.resolve(__dirname, "..", "..", "..", "memory", "healing-metrics.json")

/** Path to the commit-deploy-log JSON file */
const COMMIT_DEPLOY_LOG_PATH = path.resolve(
	__dirname,
	"..",
	"..",
	"..",
	"server",
	"src",
	"memory",
	"commit-deploy-log.json",
)

/** Path to the health check log file */
const HEALTH_LOG_PATH = path.resolve(__dirname, "..", "..", "data", "health-timeline.json")

// ── Helpers ──────────────────────────────────────────────────────────────────────

/**
 * Safely read and parse a JSON file.
 * Returns null if the file doesn't exist or is malformed.
 */
function readJSON(filePath) {
	try {
		if (!fs.existsSync(filePath)) {
			return null
		}
		const raw = fs.readFileSync(filePath, "utf-8")
		return JSON.parse(raw)
	} catch (err) {
		console.error(`[monitoring] Failed to read ${filePath}:`, err.message)
		return null
	}
}

/**
 * Safely write a JSON file.
 */
function writeJSON(filePath, data) {
	try {
		const dir = path.dirname(filePath)
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true })
		}
		fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8")
	} catch (err) {
		console.error(`[monitoring] Failed to write ${filePath}:`, err.message)
	}
}

/**
 * Format a Unix timestamp (ms) to ISO string.
 */
function formatTimestamp(ts) {
	if (!ts) return null
	return new Date(ts).toISOString()
}

/**
 * Send JSON response.
 */
function sendJson(res, status, payload) {
	res.writeHead(status, { "Content-Type": "application/json" })
	res.end(JSON.stringify(payload))
}

/**
 * Parse query parameters from URL.
 */
function parseQuery(url) {
	try {
		const parsed = new URL(url, "http://localhost")
		return Object.fromEntries(parsed.searchParams.entries())
	} catch {
		return {}
	}
}

// ── Route Handlers ───────────────────────────────────────────────────────────────

/**
 * GET /api/monitoring/logs
 *
 * Query aggregated logs from JSONL files.
 * Supports filtering by source, level, time range, and search text.
 *
 * Query params:
 *   source  — Filter by source (extension, cloud-api, cloud-worker, dashboard, healing, ml, agent, system)
 *   level   — Filter by level (debug, info, warn, error, success)
 *   from    — Start timestamp (Unix ms)
 *   to      — End timestamp (Unix ms)
 *   limit   — Max results (default: 100, max: 1000)
 *   offset  — Pagination offset
 *   search  — Search string in message
 */
function handleGetLogs(req, res, url) {
	const params = parseQuery(url)
	const source = params.source || null
	const level = params.level || null
	const from = params.from ? parseInt(params.from, 10) : null
	const to = params.to ? parseInt(params.to, 10) : null
	const limit = Math.min(parseInt(params.limit || "100", 10), 1000)
	const offset = parseInt(params.offset || "0", 10)
	const search = params.search || null

	const entries = []

	// Read all JSONL files in the logs directory
	try {
		if (!fs.existsSync(LOGS_DIR)) {
			return sendJson(res, 200, { entries: [], total: 0, filtered: 0, hasMore: false })
		}

		const files = fs
			.readdirSync(LOGS_DIR)
			.filter((f) => f.startsWith("superroo-") && f.endsWith(".jsonl"))
			.sort()
			.reverse() // Newest files first

		for (const file of files) {
			if (entries.length >= offset + limit) break

			const filePath = path.join(LOGS_DIR, file)
			try {
				const content = fs.readFileSync(filePath, "utf-8")
				const lines = content.split("\n").filter((l) => l.trim().length > 0)

				for (const line of lines) {
					try {
						const entry = JSON.parse(line)

						// Apply filters
						if (source && entry.source !== source) continue
						if (level && entry.level !== level) continue
						if (from !== null && entry.timestamp < from) continue
						if (to !== null && entry.timestamp > to) continue
						if (search) {
							const q = search.toLowerCase()
							const msg = (entry.message || "").toLowerCase()
							const src = (entry.source || "").toLowerCase()
							const lvl = (entry.level || "").toLowerCase()
							if (!msg.includes(q) && !src.includes(q) && !lvl.includes(q)) continue
						}

						entries.push(entry)
					} catch {
						// Skip malformed lines
						continue
					}
				}
			} catch {
				// Skip unreadable files
				continue
			}
		}
	} catch (err) {
		console.error("[monitoring] Error reading logs:", err.message)
		return sendJson(res, 500, { error: "Failed to read logs" })
	}

	// Sort by timestamp descending (newest first)
	entries.sort((a, b) => b.timestamp - a.timestamp)

	const total = entries.length
	const sliced = entries.slice(offset, offset + limit)

	sendJson(res, 200, {
		entries: sliced,
		total,
		filtered: sliced.length,
		hasMore: offset + limit < total,
	})
}

/**
 * GET /api/monitoring/stats
 *
 * Returns system stats including CPU, memory, active agents, recent errors.
 */
async function handleGetStats(req, res) {
	try {
		// System CPU and memory info
		const cpus = os.cpus()
		const totalMem = os.totalmem()
		const freeMem = os.freemem()
		const usedMem = totalMem - freeMem
		const memUsagePercent = totalMem > 0 ? Math.round((usedMem / totalMem) * 100) : 0

		// CPU load averages (1, 5, 15 min) — os.loadavg() is Unix-only
		let cpuLoad = null
		let cpuCount = cpus.length
		try {
			if (typeof os.loadavg === "function") {
				const loads = os.loadavg()
				cpuLoad = {
					"1min": loads[0],
					"5min": loads[1],
					"15min": loads[2],
				}
			}
		} catch {
			// loadavg not available on Windows
		}

		// Uptime
		const uptime = os.uptime()

		// Count recent errors from log files (last 24h)
		let recentErrors = 0
		const now = Date.now()
		const last24h = now - 24 * 60 * 60 * 1000

		try {
			if (fs.existsSync(LOGS_DIR)) {
				const files = fs
					.readdirSync(LOGS_DIR)
					.filter((f) => f.startsWith("superroo-") && f.endsWith(".jsonl"))
					.sort()
					.reverse()
					.slice(0, 3) // Check last 3 files

				for (const file of files) {
					const filePath = path.join(LOGS_DIR, file)
					const content = fs.readFileSync(filePath, "utf-8")
					const lines = content.split("\n").filter((l) => l.trim().length > 0)

					for (const line of lines) {
						try {
							const entry = JSON.parse(line)
							if (entry.level === "error" && entry.timestamp >= last24h) {
								recentErrors++
							}
						} catch {
							continue
						}
					}
				}
			}
		} catch {
			// Ignore log reading errors for stats
		}

		// Count active agents from healing metrics
		let activeAgents = 0
		const metrics = readJSON(METRICS_PATH)
		if (metrics && metrics.overall) {
			activeAgents = metrics.overall.totalAttempts || 0
		}

		// Count active incidents
		let activeIncidents = 0
		const incidentsPath = path.resolve(__dirname, "..", "..", "..", "memory", "healing-incidents.json")
		const incidents = readJSON(incidentsPath)
		if (incidents && Array.isArray(incidents)) {
			const terminalStatuses = ["verified", "closed", "resolved"]
			activeIncidents = incidents.filter((inc) => !terminalStatuses.includes(inc.status)).length
		}

		sendJson(res, 200, {
			system: {
				hostname: os.hostname(),
				platform: os.platform(),
				arch: os.arch(),
				uptime,
				cpu: {
					count: cpuCount,
					load: cpuLoad,
					model: cpus.length > 0 ? cpus[0].model : null,
				},
				memory: {
					total: totalMem,
					free: freeMem,
					used: usedMem,
					usagePercent: memUsagePercent,
				},
			},
			agents: {
				activeAgents,
				activeIncidents,
			},
			logs: {
				recentErrors24h: recentErrors,
			},
			timestamp: new Date().toISOString(),
		})
	} catch (err) {
		console.error("[monitoring] Error getting stats:", err.message)
		sendJson(res, 500, { error: "Failed to get system stats" })
	}
}

/**
 * GET /api/monitoring/health-timeline
 *
 * Returns health check history from the health timeline log.
 * If no timeline file exists, returns an empty array.
 */
function handleGetHealthTimeline(req, res) {
	const params = parseQuery(req.url)
	const limit = Math.min(parseInt(params.limit || "50", 10), 200)

	let timeline = readJSON(HEALTH_LOG_PATH)

	if (!timeline || !Array.isArray(timeline)) {
		// Try to build from commit-deploy-log as fallback
		const deployLog = readJSON(COMMIT_DEPLOY_LOG_PATH)
		if (deployLog && Array.isArray(deployLog.deploys)) {
			timeline = deployLog.deploys
				.filter((d) => d.status)
				.map((d) => ({
					timestamp: d.timestamp || d.deployedAt,
					status: d.status === "healthy" ? "healthy" : d.status === "unhealthy" ? "failed" : "warning",
					version: d.version,
					commit: d.commitSha || d.commit,
					agent: d.agent,
					message: d.message || `Deploy ${d.version}`,
				}))
		} else {
			timeline = []
		}
	}

	// Sort by timestamp descending
	timeline.sort((a, b) => {
		const ta = a.timestamp || a.deployedAt || 0
		const tb = b.timestamp || b.deployedAt || 0
		return tb - ta
	})

	const sliced = timeline.slice(0, limit)

	sendJson(res, 200, {
		entries: sliced,
		total: timeline.length,
		filtered: sliced.length,
	})
}

/**
 * POST /api/monitoring/health-timeline/record
 *
 * Record a health check result (called by the health check system).
 * Body: { status: "healthy"|"warning"|"failed", message?: string, component?: string }
 */
async function handleRecordHealthCheck(req, res, body) {
	if (!body || !body.status) {
		return sendJson(res, 400, { error: "status is required" })
	}

	const validStatuses = ["healthy", "warning", "failed"]
	if (!validStatuses.includes(body.status)) {
		return sendJson(res, 400, { error: `status must be one of: ${validStatuses.join(", ")}` })
	}

	let timeline = readJSON(HEALTH_LOG_PATH)
	if (!timeline || !Array.isArray(timeline)) {
		timeline = []
	}

	timeline.push({
		timestamp: Date.now(),
		status: body.status,
		message: body.message || "",
		component: body.component || "api",
	})

	// Keep only last 1000 entries
	if (timeline.length > 1000) {
		timeline = timeline.slice(-1000)
	}

	writeJSON(HEALTH_LOG_PATH, timeline)

	sendJson(res, 200, { success: true, recorded: true })
}

// ── Router ───────────────────────────────────────────────────────────────────────

/**
 * Main entry point for monitoring routes.
 * Returns true if the route was handled, false otherwise.
 *
 * @param {string} method - HTTP method (GET, POST, etc.)
 * @param {string} url - Full request URL
 * @param {object} req - Node HTTP request object
 * @param {object} res - Node HTTP response object
 * @returns {boolean} Whether the route was handled
 */
async function handleMonitoringRoute(method, url, req, res) {
	const parsedUrl = new URL(url, "http://localhost")
	const pathname = parsedUrl.pathname

	// GET /api/monitoring/logs
	if (method === "GET" && pathname === "/api/monitoring/logs") {
		handleGetLogs(req, res, url)
		return true
	}

	// GET /api/monitoring/stats
	if (method === "GET" && pathname === "/api/monitoring/stats") {
		await handleGetStats(req, res)
		return true
	}

	// GET /api/monitoring/health-timeline
	if (method === "GET" && pathname === "/api/monitoring/health-timeline") {
		handleGetHealthTimeline(req, res)
		return true
	}

	// POST /api/monitoring/health-timeline/record
	if (method === "POST" && pathname === "/api/monitoring/health-timeline/record") {
		const body = req.body || {}
		await handleRecordHealthCheck(req, res, body)
		return true
	}

	// GET /api/monitoring/alerts — Alert history
	if (method === "GET" && pathname === "/api/monitoring/alerts") {
		const params = parseQuery(url)
		const limit = Math.min(parseInt(params.limit || "100", 10), 500)
		const offset = parseInt(params.offset || "0", 10)
		const monitoringEngine = safeRequire("../monitoringEngine")
		if (monitoringEngine) {
			const result = monitoringEngine.getAlertHistory(limit, offset)
			sendJson(res, 200, result)
		} else {
			sendJson(res, 200, { alerts: [], total: 0, hasMore: false })
		}
		return true
	}

	// GET /api/monitoring/alerts/stats — Alert statistics
	if (method === "GET" && pathname === "/api/monitoring/alerts/stats") {
		const monitoringEngine = safeRequire("../monitoringEngine")
		if (monitoringEngine) {
			const stats = monitoringEngine.getStats()
			sendJson(res, 200, stats)
		} else {
			sendJson(res, 200, { totalAlerts: 0, recent24h: 0, critical24h: 0, unacknowledged: 0 })
		}
		return true
	}

	// GET /api/monitoring/alerts/rules — Alert rules
	if (method === "GET" && pathname === "/api/monitoring/alerts/rules") {
		const monitoringEngine = safeRequire("../monitoringEngine")
		if (monitoringEngine) {
			const rules = monitoringEngine.getRules()
			sendJson(res, 200, { rules })
		} else {
			sendJson(res, 200, { rules: [] })
		}
		return true
	}

	// PUT /api/monitoring/alerts/rules/:id — Update alert rule
	const rulesMatch = pathname.match(/^\/api\/monitoring\/alerts\/rules\/(.+)$/)
	if (method === "PUT" && rulesMatch) {
		const ruleId = rulesMatch[1]
		const body = req.body || {}
		const monitoringEngine = safeRequire("../monitoringEngine")
		if (monitoringEngine) {
			const updated = monitoringEngine.updateRule(ruleId, body)
			if (updated) {
				sendJson(res, 200, { rule: updated })
			} else {
				sendJson(res, 404, { error: "Rule not found" })
			}
		} else {
			sendJson(res, 500, { error: "Monitoring engine not available" })
		}
		return true
	}

	// POST /api/monitoring/alerts/:id/ack — Acknowledge alert
	const ackMatch = pathname.match(/^\/api\/monitoring\/alerts\/(.+)\/ack$/)
	if (method === "POST" && ackMatch) {
		const alertId = ackMatch[1]
		const monitoringEngine = safeRequire("../monitoringEngine")
		if (monitoringEngine) {
			const ok = monitoringEngine.acknowledgeAlert(alertId)
			sendJson(res, ok ? 200 : 404, { success: ok })
		} else {
			sendJson(res, 500, { error: "Monitoring engine not available" })
		}
		return true
	}

	// POST /api/monitoring/alerts/:id/resolve — Resolve alert
	const resolveMatch = pathname.match(/^\/api\/monitoring\/alerts\/(.+)\/resolve$/)
	if (method === "POST" && resolveMatch) {
		const alertId = resolveMatch[1]
		const monitoringEngine = safeRequire("../monitoringEngine")
		if (monitoringEngine) {
			const ok = monitoringEngine.resolveAlert(alertId)
			sendJson(res, ok ? 200 : 404, { success: ok })
		} else {
			sendJson(res, 500, { error: "Monitoring engine not available" })
		}
		return true
	}

	return false
}

/**
 * Safe require that returns null instead of throwing.
 */
function safeRequire(modulePath) {
	try {
		return require(modulePath)
	} catch {
		return null
	}
}

module.exports = { handleMonitoringRoute }
