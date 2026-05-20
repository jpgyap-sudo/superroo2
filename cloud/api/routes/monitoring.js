/**
 * SuperRoo Cloud — Monitoring API Routes
 *
 * Exposes log aggregation, system stats, and health timeline data
 * for the Monitoring Dashboard.
 *
 * Endpoints:
 *   GET /api/monitoring/logs              — Query aggregated logs
 *   GET /api/monitoring/stats             — System stats (CPU, memory, active agents, recent errors)
 *   GET /api/monitoring/health-timeline   — Health check history
 *   GET /api/monitoring/aggregated-logs   — Query pgvector aggregated logs
 *   GET /api/monitoring/aggregated-stats  — Stats about aggregated logs
 */

const fs = require("fs")
const path = require("path")
const os = require("os")
const { exec } = require("child_process")
const { promisify } = require("util")

const execAsync = promisify(exec)

// -- Configuration ----------------------------------------------------------------

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

// -- Helpers ----------------------------------------------------------------------

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

// -- Route Handlers ---------------------------------------------------------------

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

		// Swap + RAM orchestrator state
		let swap = null
		let ramOrch = null
		try {
			const ramRes = await fetch("http://127.0.0.1:3456/health", { signal: AbortSignal.timeout(2000) })
			if (ramRes.ok) {
				const rd = await ramRes.json()
				swap = rd.swapUsage || rd.swap || null
				ramOrch = {
					state: rd.ramState || "unknown",
					ramPercent: rd.snapshot?.ramPercent ?? null,
					trend: rd.trend?.trend || "unknown",
					ratePerMinute: rd.trend?.ratePerMinute ?? null,
				}
			}
		} catch {}

		// Disk usage
		let disk = null
		try {
			const { stdout } = await execAsync("df -k / | tail -1")
			const parts = stdout.trim().split(/\s+/)
			const totalKb = parseInt(parts[1], 10)
			const usedKb = parseInt(parts[2], 10)
			const usedPercent = parseInt((parts[4] || "0").replace("%", ""), 10)
			disk = { totalBytes: totalKb * 1024, usedBytes: usedKb * 1024, usedPercent }
		} catch {}

		const serviceHealth = await getServiceHealth()

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
				swap,
				disk,
			},
			agents: {
				activeAgents,
				activeIncidents,
			},
			logs: {
				recentErrors24h: recentErrors,
			},
			ramOrch,
			services: serviceHealth,
			timestamp: new Date().toISOString(),
		})
	} catch (err) {
		console.error("[monitoring] Error getting stats:", err.message)
		sendJson(res, 500, { error: "Failed to get system stats" })
	}
}

async function getServiceHealth() {
	const serviceNames = [
		"superroo-api",
		"superroo-dashboard",
		"superroo-worker",
		"superroo-auto-deployer",
		"superroo-mcp-memory",
		"superroo-ram-orchestrator",
	]
	let pm2Services = {}

	try {
		const { stdout } = await execAsync("pm2 jlist")
		const processes = JSON.parse(stdout)
		pm2Services = Object.fromEntries(
			processes
				.filter((proc) => serviceNames.includes(proc.name))
				.map((proc) => [
					proc.name,
					{
						status: proc.pm2_env?.status || "unknown",
						restarts: proc.pm2_env?.restart_time || 0,
						uptimeMs: proc.pm2_env?.pm_uptime ? Date.now() - proc.pm2_env.pm_uptime : null,
					},
				]),
		)
	} catch (err) {
		console.error("[monitoring] Failed to read PM2 status:", err.message)
	}

	const SERVICE_PROBES = [
		["superroo-api", "http://127.0.0.1:8787/api/health"],
		["superroo-dashboard", "http://127.0.0.1:3001"],
		["superroo-worker", null],
		["superroo-auto-deployer", "http://127.0.0.1:8790/api/auto-deploy/status"],
		["superroo-mcp-memory", "http://127.0.0.1:3419/mcp"],
		["superroo-ram-orchestrator", "http://127.0.0.1:3456/health"],
	]

	const probes = await Promise.all(
		SERVICE_PROBES.map(async ([name, url]) => {
			if (!url) {
				return [name, { listening: pm2Services[name]?.status === "online", httpStatus: null, latencyMs: 0 }]
			}
			const start = Date.now()
			try {
				const response = await fetch(url, { signal: AbortSignal.timeout(3000) })
				return [name, { listening: response.ok, httpStatus: response.status, latencyMs: Date.now() - start }]
			} catch {
				return [name, { listening: false, httpStatus: null, latencyMs: Date.now() - start }]
			}
		}),
	)

	return probes.map(([name, probe]) => ({
		name,
		process: pm2Services[name] || null,
		...probe,
		healthy:
			pm2Services[name]?.status === "online" &&
			(probe.httpStatus !== null ? probe.listening : pm2Services[name]?.status === "online"),
	}))
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

// -- Error Rate Buckets -----------------------------------------------------------

/**
 * GET /api/monitoring/error-rate-buckets
 *
 * Returns 24 hourly error/warn/total buckets in a single pass over log files.
 * Replaces the 24-request loop the frontend was doing.
 */
function handleGetErrorRateBuckets(req, res) {
	const now = Date.now()
	const windowMs = 24 * 60 * 60 * 1000
	const bucketMs = 60 * 60 * 1000
	const numBuckets = 24
	const cutoff = now - windowMs

	const buckets = Array.from({ length: numBuckets }, (_, i) => {
		const from = cutoff + i * bucketMs
		return {
			from,
			label: new Date(from).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }),
			errors: 0,
			warns: 0,
			total: 0,
		}
	})

	try {
		if (fs.existsSync(LOGS_DIR)) {
			const files = fs
				.readdirSync(LOGS_DIR)
				.filter((f) => f.startsWith("superroo-") && f.endsWith(".jsonl"))
				.sort()
				.reverse()

			for (const file of files) {
				try {
					const content = fs.readFileSync(path.join(LOGS_DIR, file), "utf-8")
					for (const line of content.split("\n")) {
						if (!line.trim()) continue
						try {
							const entry = JSON.parse(line)
							if (entry.timestamp < cutoff || entry.timestamp > now) continue
							const idx = Math.floor((entry.timestamp - cutoff) / bucketMs)
							if (idx < 0 || idx >= numBuckets) continue
							buckets[idx].total++
							if (entry.level === "error") buckets[idx].errors++
							else if (entry.level === "warn") buckets[idx].warns++
						} catch {}
					}
				} catch {}
			}
		}
	} catch (err) {
		console.error("[monitoring] Error building error rate buckets:", err.message)
	}

	sendJson(res, 200, { buckets, generatedAt: new Date().toISOString() })
}

// -- Aggregated Logs (pgvector) ---------------------------------------------------

const DB_CONTAINER = "d2081035b419"

/**
 * GET /api/monitoring/aggregated-logs
 *
 * Query aggregated logs from the pgvector aggregated_logs table.
 * Supports filtering by level, source, search text, and time range.
 *
 * Query params:
 *   level   — Filter by level (debug, info, warn, error)
 *   source  — Filter by source
 *   search  — Search string in message (ILIKE)
 *   since   — ISO timestamp to filter from
 *   limit   — Max results (default: 50)
 *   offset  — Pagination offset
 */
async function handleGetAggregatedLogs(req, res, url) {
	const parsedUrl = new URL(url, "http://localhost")
	const limit = parseInt(parsedUrl.searchParams.get("limit") || "50", 10)
	const level = parsedUrl.searchParams.get("level") || ""
	const source = parsedUrl.searchParams.get("source") || ""
	const search = parsedUrl.searchParams.get("search") || ""
	const since = parsedUrl.searchParams.get("since") || ""
	const offset = parseInt(parsedUrl.searchParams.get("offset") || "0", 10)

	try {
		const { execSync } = require("child_process")
		let sql =
			"SELECT id, timestamp, source, level, message, service, type, metric, value, container FROM aggregated_logs WHERE 1=1"

		if (level) {
			sql += " AND level = '" + level.replace(/'/g, "''") + "'"
		}
		if (source) {
			sql += " AND source = '" + source.replace(/'/g, "''") + "'"
		}
		if (search) {
			sql += " AND message ILIKE '%" + search.replace(/'/g, "''") + "%'"
		}
		if (since) {
			sql += " AND timestamp >= '" + since.replace(/'/g, "''") + "'"
		}

		// Get total count
		const countSql = sql.replace(/SELECT .* FROM/, "SELECT COUNT(*) FROM")
		const countResult = execSync(
			"docker exec -i " +
				DB_CONTAINER +
				' psql -U superroo -d superroo -t -A -c "' +
				countSql.replace(/"/g, '\\"') +
				'"',
			{ encoding: "utf-8", timeout: 10000 },
		).trim()
		const total = parseInt(countResult) || 0

		// Get paginated results using pipe delimiter (avoids shell escaping issues with tab)
		sql += " ORDER BY timestamp DESC LIMIT " + limit + " OFFSET " + offset
		const result = execSync(
			"docker exec -i " +
				DB_CONTAINER +
				" psql -U superroo -d superroo -t -A -F '|' -c \"" +
				sql.replace(/"/g, '\\"') +
				'"',
			{ encoding: "utf-8", timeout: 10000 },
		).trim()

		const rows = result
			? result
					.split("\n")
					.filter(Boolean)
					.map((line) => {
						const cols = line.split("|")
						return {
							id: parseInt(cols[0]) || 0,
							timestamp: cols[1] || null,
							source: cols[2] || null,
							level: cols[3] || null,
							message: cols[4] || null,
							service: cols[5] || null,
							type: cols[6] || null,
							metric: cols[7] || null,
							value: cols[8] ? parseFloat(cols[8]) : null,
							container: cols[9] || null,
						}
					})
			: []

		sendJson(res, 200, { rows, total, limit, offset })
	} catch (err) {
		sendJson(res, 500, { error: err.message })
	}
}

/**
 * GET /api/monitoring/aggregated-stats
 *
 * Returns summary statistics about the aggregated logs in pgvector.
 */
async function handleGetAggregatedStats(req, res) {
	try {
		const { execSync } = require("child_process")

		// Level distribution
		const levelResult = execSync(
			"docker exec -i " +
				DB_CONTAINER +
				" psql -U superroo -d superroo -t -A -F '|' -c \"SELECT level, COUNT(*) as cnt FROM aggregated_logs GROUP BY level ORDER BY cnt DESC\"",
			{ encoding: "utf-8", timeout: 10000 },
		).trim()
		const levelDist = levelResult
			? levelResult
					.split("\n")
					.filter(Boolean)
					.map((line) => {
						const [level, cnt] = line.split("|")
						return { level, count: parseInt(cnt) || 0 }
					})
			: []

		// Source distribution
		const sourceResult = execSync(
			"docker exec -i " +
				DB_CONTAINER +
				" psql -U superroo -d superroo -t -A -F '|' -c \"SELECT source, COUNT(*) as cnt FROM aggregated_logs GROUP BY source ORDER BY cnt DESC\"",
			{ encoding: "utf-8", timeout: 10000 },
		).trim()
		const sourceDist = sourceResult
			? sourceResult
					.split("\n")
					.filter(Boolean)
					.map((line) => {
						const [source, cnt] = line.split("|")
						return { source, count: parseInt(cnt) || 0 }
					})
			: []

		// Total count
		const totalResult = execSync(
			"docker exec -i " +
				DB_CONTAINER +
				' psql -U superroo -d superroo -t -A -c "SELECT COUNT(*) FROM aggregated_logs"',
			{ encoding: "utf-8", timeout: 10000 },
		).trim()
		const total = parseInt(totalResult) || 0

		// Last 24h count
		const dayResult = execSync(
			"docker exec -i " +
				DB_CONTAINER +
				" psql -U superroo -d superroo -t -A -c \"SELECT COUNT(*) FROM aggregated_logs WHERE timestamp > NOW() - INTERVAL '24 hours'\"",
			{ encoding: "utf-8", timeout: 10000 },
		).trim()
		const last24h = parseInt(dayResult) || 0

		// Error count last 24h
		const errorResult = execSync(
			"docker exec -i " +
				DB_CONTAINER +
				" psql -U superroo -d superroo -t -A -c \"SELECT COUNT(*) FROM aggregated_logs WHERE level = 'error' AND timestamp > NOW() - INTERVAL '24 hours'\"",
			{ encoding: "utf-8", timeout: 10000 },
		).trim()
		const errors24h = parseInt(errorResult) || 0

		sendJson(res, 200, { total, last24h, errors24h, levelDistribution: levelDist, sourceDistribution: sourceDist })
	} catch (err) {
		sendJson(res, 500, { error: err.message })
	}
}

// -- Router -----------------------------------------------------------------------

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
		// Body is already parsed by the caller
		const body = req.body || {}
		await handleRecordHealthCheck(req, res, body)
		return true
	}

	// GET /api/monitoring/error-rate-buckets
	if (method === "GET" && pathname === "/api/monitoring/error-rate-buckets") {
		handleGetErrorRateBuckets(req, res)
		return true
	}

	// GET /api/monitoring/aggregated-logs — query pgvector aggregated logs
	if (method === "GET" && pathname === "/api/monitoring/aggregated-logs") {
		await handleGetAggregatedLogs(req, res, url)
		return true
	}

	// GET /api/monitoring/aggregated-stats — stats about aggregated logs
	if (method === "GET" && pathname === "/api/monitoring/aggregated-stats") {
		await handleGetAggregatedStats(req, res)
		return true
	}

	return false
}

module.exports = { handleMonitoringRoute }
