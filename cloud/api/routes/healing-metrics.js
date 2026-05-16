/**
 * SuperRoo Cloud — Healing Metrics API Routes
 *
 * Exposes the SuperRoo healing module's metrics, incidents, and escalated issues
 * as REST API endpoints for the Cloud IDE dashboard.
 *
 * Reads from the same JSON file that HealingMetrics.ts persists to
 * (memory/healing-metrics.json relative to project root).
 *
 * Endpoints:
 *   GET /api/healing/metrics    — Overall + per-category success rates, active incidents
 *   GET /api/healing/incidents   — Recent incidents with status
 *   GET /api/healing/escalated   — Escalated incidents needing human attention
 */

const fs = require("fs")
const path = require("path")

// ── Configuration ────────────────────────────────────────────────────────────────

/** Path to the healing metrics JSON file (relative to project root) */
const METRICS_PATH = path.resolve(__dirname, "..", "..", "..", "memory", "healing-metrics.json")

/** Path to the healing incidents JSON file (if persisted separately) */
const INCIDENTS_PATH = path.resolve(__dirname, "..", "..", "..", "memory", "healing-incidents.json")

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
		console.error(`[healing-metrics] Failed to read ${filePath}:`, err.message)
		return null
	}
}

/**
 * Compute success rate as a percentage (0-100).
 * Returns 0 if no attempts recorded.
 */
function successRate(successCount, totalAttempts) {
	if (!totalAttempts || totalAttempts === 0) return 0
	return Math.round((successCount / totalAttempts) * 100)
}

/**
 * Format a Unix timestamp (ms) to ISO string.
 */
function formatTimestamp(ts) {
	if (!ts) return null
	return new Date(ts).toISOString()
}

// ── Route Handlers ───────────────────────────────────────────────────────────────

/**
 * GET /api/healing/metrics
 *
 * Returns:
 *   - overall: { successRate, successCount, failureCount, totalAttempts }
 *   - byCategory: array of { category, successRate, successCount, failureCount, totalAttempts }
 *   - byPlanType: array of { planType, successRate, successCount, failureCount, totalAttempts }
 *   - activeIncidents: count of incidents with non-terminal status
 *   - lastUpdated: ISO timestamp
 */
function handleGetMetrics(req, res) {
	const metrics = readJSON(METRICS_PATH)

	if (!metrics) {
		// Return empty/default metrics when no data exists yet
		return sendJson(res, 200, {
			overall: { successRate: 0, successCount: 0, failureCount: 0, totalAttempts: 0 },
			byCategory: [],
			byPlanType: [],
			activeIncidents: 0,
			lastUpdated: null,
		})
	}

	const overall = metrics.overall || { successCount: 0, failureCount: 0, totalAttempts: 0 }

	// Convert category map to sorted array
	const byCategory = Object.entries(metrics.byCategory || {})
		.map(([category, data]) => ({
			category,
			successRate: successRate(data.successCount, data.totalAttempts),
			successCount: data.successCount,
			failureCount: data.failureCount,
			totalAttempts: data.totalAttempts,
		}))
		.sort((a, b) => b.totalAttempts - a.totalAttempts)

	// Convert plan type map to sorted array
	const byPlanType = Object.entries(metrics.byPlanType || {})
		.map(([planType, data]) => ({
			planType,
			successRate: successRate(data.successCount, data.totalAttempts),
			successCount: data.successCount,
			failureCount: data.failureCount,
			totalAttempts: data.totalAttempts,
		}))
		.sort((a, b) => b.totalAttempts - a.totalAttempts)

	// Count active incidents from the incidents file
	let activeIncidents = 0
	const incidents = readJSON(INCIDENTS_PATH)
	if (incidents && Array.isArray(incidents)) {
		const terminalStatuses = ["verified", "closed", "resolved"]
		activeIncidents = incidents.filter((inc) => !terminalStatuses.includes(inc.status)).length
	}

	sendJson(res, 200, {
		overall: {
			successRate: successRate(overall.successCount, overall.totalAttempts),
			successCount: overall.successCount,
			failureCount: overall.failureCount,
			totalAttempts: overall.totalAttempts,
		},
		byCategory,
		byPlanType,
		activeIncidents,
		lastUpdated: formatTimestamp(metrics.lastUpdated),
	})
}

/**
 * GET /api/healing/incidents
 *
 * Returns recent incidents with status, category, affected files.
 * Supports ?limit=N and ?status=open,closed query params.
 */
function handleGetIncidents(req, res, parsedUrl) {
	const incidents = readJSON(INCIDENTS_PATH)

	if (!incidents || !Array.isArray(incidents)) {
		return sendJson(res, 200, { incidents: [], total: 0 })
	}

	// Parse query params
	const params = new URL(parsedUrl, "http://localhost").searchParams
	const limit = Math.min(parseInt(params.get("limit") || "50", 10), 200)
	const statusFilter = params.get("status")

	let filtered = incidents

	// Filter by status if provided
	if (statusFilter) {
		const statuses = statusFilter.split(",").map((s) => s.trim().toLowerCase())
		filtered = filtered.filter((inc) => statuses.includes((inc.status || "").toLowerCase()))
	}

	// Sort by updatedAt descending (most recent first)
	filtered = filtered.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))

	// Limit results
	filtered = filtered.slice(0, limit)

	// Map to a clean response format
	const mapped = filtered.map((inc) => ({
		id: inc.id,
		title: inc.title || "Untitled Incident",
		category: inc.rootCauseCategory || inc.category || null,
		severity: inc.severity || "medium",
		status: inc.status || "new",
		affectedFiles: inc.affectedFiles || [],
		sourceAgent: inc.sourceAgent || "unknown",
		fixAttempts: inc.fixAttempts || 0,
		createdAt: formatTimestamp(inc.createdAt),
		updatedAt: formatTimestamp(inc.updatedAt || inc.createdAt),
	}))

	sendJson(res, 200, {
		incidents: mapped,
		total: incidents.length,
		filtered: mapped.length,
	})
}

/**
 * GET /api/healing/escalated
 *
 * Returns escalated incidents that need human attention.
 * These are incidents with status "needs_human_approval" or "blocked",
 * or those with high fixAttempts count.
 */
function handleGetEscalated(req, res) {
	const incidents = readJSON(INCIDENTS_PATH)

	if (!incidents || !Array.isArray(incidents)) {
		return sendJson(res, 200, { escalated: [], total: 0 })
	}

	// Find escalated incidents
	const escalated = incidents.filter((inc) => {
		const status = (inc.status || "").toLowerCase()
		return (
			status === "needs_human_approval" ||
			status === "blocked" ||
			status === "reopened" ||
			(inc.fixAttempts || 0) >= 3
		)
	})

	// Sort by fixAttempts desc, then by updatedAt desc
	escalated.sort((a, b) => {
		const attemptDiff = (b.fixAttempts || 0) - (a.fixAttempts || 0)
		if (attemptDiff !== 0) return attemptDiff
		return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)
	})

	const mapped = escalated.map((inc) => ({
		id: inc.id,
		title: inc.title || "Untitled Incident",
		category: inc.rootCauseCategory || inc.category || null,
		severity: inc.severity || "medium",
		status: inc.status || "new",
		affectedFiles: inc.affectedFiles || [],
		sourceAgent: inc.sourceAgent || "unknown",
		fixAttempts: inc.fixAttempts || 0,
		suggestedAction: inc.recommendedAction || null,
		createdAt: formatTimestamp(inc.createdAt),
		updatedAt: formatTimestamp(inc.updatedAt || inc.createdAt),
	}))

	sendJson(res, 200, {
		escalated: mapped,
		total: escalated.length,
	})
}

// ── Response helper ──────────────────────────────────────────────────────────────

function sendJson(res, status, payload) {
	res.writeHead(status, { "Content-Type": "application/json" })
	res.end(JSON.stringify(payload))
}

// ── Router ───────────────────────────────────────────────────────────────────────

/**
 * Main entry point for healing metrics routes.
 * Returns true if the route was handled, false otherwise.
 *
 * @param {string} method - HTTP method (GET, POST, etc.)
 * @param {string} url - Full request URL
 * @param {object} req - Node HTTP request object
 * @param {object} res - Node HTTP response object
 * @returns {boolean} Whether the route was handled
 */
async function handleHealingRoute(method, url, req, res) {
	const parsedUrl = new URL(url, "http://localhost")
	const pathname = parsedUrl.pathname

	// GET /api/healing/metrics
	if (method === "GET" && pathname === "/api/healing/metrics") {
		handleGetMetrics(req, res)
		return true
	}

	// GET /api/healing/incidents
	if (method === "GET" && pathname === "/api/healing/incidents") {
		handleGetIncidents(req, res, url)
		return true
	}

	// GET /api/healing/escalated
	if (method === "GET" && pathname === "/api/healing/escalated") {
		handleGetEscalated(req, res)
		return true
	}

	return false
}

module.exports = { handleHealingRoute }
