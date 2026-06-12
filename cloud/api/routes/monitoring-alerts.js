/**
 * SuperRoo Cloud — Monitoring Alerts & Notification Routes
 *
 * Manages alert threshold configuration and sends Telegram notifications
 * when metrics cross thresholds (error rate spikes, healing failures,
 * stale data sources, escalating incidents).
 *
 * Endpoints:
 *   GET    /api/monitoring/alerts              — List all configured alerts
 *   POST   /api/monitoring/alerts              — Create or update an alert rule
 *   DELETE /api/monitoring/alerts/:id          — Remove an alert rule
 *   GET    /api/monitoring/alerts/history      — Recent alert firings
 *   POST   /api/monitoring/alerts/test         — Test-fire an alert notification
 */

const fs = require("fs")
const path = require("path")

// ── Persistence ─────────────────────────────────────────────────────────────────

const ALERTS_PATH = path.resolve(__dirname, "..", "..", "data", "monitoring-alerts.json")
const HISTORY_PATH = path.resolve(__dirname, "..", "..", "data", "alert-history.json")

function readJson(filePath, fallback) {
	try {
		if (fs.existsSync(filePath)) {
			return JSON.parse(fs.readFileSync(filePath, "utf-8"))
		}
	} catch { /* corrupt file — return fallback */ }
	return fallback
}

function writeJson(filePath, data) {
	const tmp = filePath + ".tmp"
	fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8")
	fs.renameSync(tmp, filePath)
}

function loadAlerts() {
	return readJson(ALERTS_PATH, [])
}

function saveAlerts(alerts) {
	writeJson(ALERTS_PATH, alerts)
}

function loadHistory() {
	return readJson(HISTORY_PATH, [])
}

function saveHistory(history) {
	writeJson(HISTORY_PATH, history.slice(-200)) // keep last 200 entries
}

// ── Alert Rule Schema ───────────────────────────────────────────────────────────

/**
 * @typedef {Object} AlertRule
 * @property {string} id
 * @property {string} name             - Human-readable label
 * @property {string} metric           - Metric to watch: "error_rate", "healing_failures",
 *                                       "open_incidents", "stale_metrics", "api_latency"
 * @property {string} condition        - Comparison: "gt" | "lt" | "gte" | "lte"
 * @property {number} threshold        - Value to compare against
 * @property {number} [windowMinutes]  - Evaluation window (default 5)
 * @property {string} [severity]       - "info" | "warning" | "critical" (default "warning")
 * @property {string[]} channels       - Notification channels: ["telegram"]
 * @property {boolean} enabled         - Whether the rule is active
 * @property {string} createdAt        - ISO timestamp
 * @property {string} [lastFiredAt]    - ISO timestamp of last trigger
 * @property {number} [cooldownMinutes]- Min minutes between re-fires (default 15)
 */

// ── Router ──────────────────────────────────────────────────────────────────────

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ""
const BOSS_CHAT_ID = process.env.BOSS_TELEGRAM_CHAT_ID || ""

/**
 * Main dispatch — called from api.js
 * Returns true if the route was handled.
 */
/**
 * Main dispatch — called from api.js
 * `path` is the normalized URL path (already stripped of /api prefix).
 * Returns true if the route was handled.
 */
async function handleAlertRoute(method, path, req, res) {
	// path is already normalized — strip query string if present
	const pathname = path.split("?")[0]

	// GET /monitoring/alerts
	if (method === "GET" && pathname === "/monitoring/alerts") {
		return sendJson(res, { success: true, alerts: loadAlerts() })
	}

	// GET /monitoring/alerts/history
	if (method === "GET" && pathname === "/monitoring/alerts/history") {
		return sendJson(res, { success: true, history: loadHistory() })
	}

	// POST /monitoring/alerts
	if (method === "POST" && pathname === "/monitoring/alerts") {
		return handleCreateAlert(req, res)
	}

	// DELETE /monitoring/alerts/:id
	const deleteMatch = pathname.match(/^\/monitoring\/alerts\/([^/]+)$/)
	if (method === "DELETE" && deleteMatch) {
		return handleDeleteAlert(deleteMatch[1], res)
	}

	// POST /monitoring/alerts/test
	if (method === "POST" && pathname === "/monitoring/alerts/test") {
		return handleTestAlert(req, res)
	}

	return false
}

// ── Handlers ────────────────────────────────────────────────────────────────────

async function handleCreateAlert(req, res) {
	let body = ""
	try {
		for await (const chunk of req) body += chunk
		const data = JSON.parse(body)

		if (!data.name || !data.metric || data.threshold === undefined) {
			return sendJson(res, { success: false, error: "name, metric, and threshold are required" }, 400)
		}

		const VALID_METRICS = ["error_rate", "healing_failures", "open_incidents", "stale_metrics", "api_latency"]
		if (!VALID_METRICS.includes(data.metric)) {
			return sendJson(res, { success: false, error: `Invalid metric. Valid: ${VALID_METRICS.join(", ")}` }, 400)
		}

		const alerts = loadAlerts()
		const alert = {
			id: `alert_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
			name: data.name,
			metric: data.metric,
			condition: data.condition || "gt",
			threshold: data.threshold,
			windowMinutes: data.windowMinutes || 5,
			severity: data.severity || "warning",
			channels: data.channels || (TELEGRAM_BOT_TOKEN ? ["telegram"] : []),
			enabled: data.enabled !== false,
			createdAt: new Date().toISOString(),
			lastFiredAt: null,
			cooldownMinutes: data.cooldownMinutes || 15,
		}
		alerts.push(alert)
		saveAlerts(alerts)

		return sendJson(res, { success: true, alert })
	} catch (err) {
		return sendJson(res, { success: false, error: err.message }, 400)
	}
}

async function handleDeleteAlert(id, res) {
	const alerts = loadAlerts()
	const idx = alerts.findIndex((a) => a.id === id)
	if (idx === -1) {
		return sendJson(res, { success: false, error: "Alert not found" }, 404)
	}
	alerts.splice(idx, 1)
	saveAlerts(alerts)
	return sendJson(res, { success: true })
}

async function handleTestAlert(req, res) {
	if (!TELEGRAM_BOT_TOKEN || !BOSS_CHAT_ID) {
		return sendJson(res, {
			success: false,
			error: "TELEGRAM_BOT_TOKEN or BOSS_TELEGRAM_CHAT_ID not configured",
		}, 400)
	}

	try {
		const https = require("https")
		const message = encodeURIComponent("🚨 Test Alert from SuperRoo Monitoring\n\nThis is a test notification. If you receive this, Telegram alerts are configured correctly.")
		const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage?chat_id=${BOSS_CHAT_ID}&text=${message}&parse_mode=Markdown`

		await new Promise((resolve, reject) => {
			https.get(url, (res) => {
				let data = ""
				res.on("data", (c) => data += c)
				res.on("end", () => {
					try { resolve(JSON.parse(data)) } catch { resolve(data) }
				})
			}).on("error", reject)
		})

		// Record in history
		const history = loadHistory()
		history.push({
			id: `hist_${Date.now()}`,
			type: "test",
			alertName: "Test Notification",
			firedAt: new Date().toISOString(),
			channel: "telegram",
			success: true,
		})
		saveHistory(history)

		return sendJson(res, { success: true, message: "Test alert sent to Telegram" })
	} catch (err) {
		return sendJson(res, { success: false, error: err.message }, 500)
	}
}

// ── Evaluator (called by a timer or webhook in api.js) ─────────────────────────

/**
 * Evaluate all enabled alert rules against current system metrics.
 * Returns an array of fired alerts that should be notified.
 *
 * @param {Object} metrics - Current system metrics snapshot
 * @param {number} [metrics.errorRate] - Recent error rate (0-1)
 * @param {number} [metrics.healingFailureRate] - Healing failure rate (0-1)
 * @param {number} [metrics.openIncidentCount] - Currently open incidents
 * @param {boolean} [metrics.metricsStale] - Whether metrics source is stale
 * @param {number} [metrics.apiLatencyMs] - Average API latency in ms
 * @returns {Promise<Array<{alert: AlertRule, value: number}>>}
 */
async function evaluateAlerts(metrics) {
	if (!metrics) return []

	const alerts = loadAlerts()
	const history = loadHistory()
	const now = Date.now()
	const fired = []

	for (const alert of alerts) {
		if (!alert.enabled) continue

		// Get current value for this metric
		let currentValue
		switch (alert.metric) {
			case "error_rate": currentValue = metrics.errorRate; break
			case "healing_failures": currentValue = metrics.healingFailureRate; break
			case "open_incidents": currentValue = metrics.openIncidentCount; break
			case "stale_metrics": currentValue = metrics.metricsStale ? 1 : 0; break
			case "api_latency": currentValue = metrics.apiLatencyMs; break
			default: continue
		}

		if (currentValue === undefined) continue

		// Check condition
		let triggered = false
		switch (alert.condition) {
			case "gt": triggered = currentValue > alert.threshold; break
			case "lt": triggered = currentValue < alert.threshold; break
			case "gte": triggered = currentValue >= alert.threshold; break
			case "lte": triggered = currentValue <= alert.threshold; break
		}

		if (!triggered) continue

		// Cooldown check
		const cooldownMs = (alert.cooldownMinutes || 15) * 60 * 1000
		if (alert.lastFiredAt && (now - new Date(alert.lastFiredAt).getTime()) < cooldownMs) continue

		// Fire!
		alert.lastFiredAt = new Date().toISOString()
		fired.push({ alert, value: currentValue })

		history.push({
			id: `hist_${Date.now()}_${Math.random().toString(36).slice(2, 4)}`,
			type: alert.metric,
			alertName: alert.name,
			value: currentValue,
			threshold: alert.threshold,
			condition: alert.condition,
			severity: alert.severity,
			firedAt: alert.lastFiredAt,
			channel: alert.channels[0] || "unknown",
			success: true,
		})
	}

	if (fired.length > 0) {
		saveAlerts(alerts)
		saveHistory(history)

		// Send Telegram notifications for fired alerts
		if (TELEGRAM_BOT_TOKEN && BOSS_CHAT_ID) {
			await sendTelegramAlert(fired)
		}
	}

	return fired
}

/**
 * Send a batch of fired alerts via Telegram.
 */
async function sendTelegramAlert(firedAlerts) {
	try {
		const https = require("https")

		for (const { alert, value } of firedAlerts) {
			const emoji = alert.severity === "critical" ? "🔴" : alert.severity === "warning" ? "🟡" : "🔵"
			const message = encodeURIComponent(
				`${emoji} *Alert: ${alert.name}*\n\n` +
				`Metric: \`${alert.metric}\`\n` +
				`Condition: ${alert.condition} ${alert.threshold}\n` +
				`Current value: \`${typeof value === "number" ? value.toFixed(2) : value}\`\n` +
				`Severity: ${alert.severity}\n` +
				`Time: ${new Date().toISOString()}`
			)

			await new Promise((resolve, reject) => {
				https.get(
					`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage?chat_id=${BOSS_CHAT_ID}&text=${message}&parse_mode=Markdown`,
					(res) => { let d = ""; res.on("data", (c) => d += c); res.on("end", resolve) }
				).on("error", reject)
			})
		}
	} catch (err) {
		console.error("[monitoring-alerts] Telegram notify error:", err.message)
	}
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

function sendJson(res, data, status = 200) {
	res.writeHead(status, { "Content-Type": "application/json" })
	res.end(JSON.stringify(data))
	return true
}

module.exports = {
	handleAlertRoute,
	evaluateAlerts,
}
