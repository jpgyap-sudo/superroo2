/**
 * SuperRoo Cloud — Monitoring Engine
 *
 * Provides:
 *   - Configurable alert rules with thresholds
 *   - Periodic health checks across all services
 *   - Alert evaluation and notification dispatch
 *   - Alert history persistence
 *
 * Integrates with:
 *   - dashboardWebSocket.js — broadcasts alerts in real-time
 *   - telegramBot.js — sends alert notifications to Telegram
 *   - routes/monitoring.js — serves alert history via API
 */

const fs = require("fs")
const path = require("path")
const os = require("os")

// ── Configuration ────────────────────────────────────────────────────────────────

const ALERTS_PATH = path.resolve(__dirname, "..", "data", "monitoring-alerts.json")
const ALERT_RULES_PATH = path.resolve(__dirname, "..", "data", "monitoring-rules.json")

const DEFAULT_RULES = [
	{
		id: "cpu-high",
		name: "High CPU Load",
		description: "CPU load average (1m) exceeds threshold",
		metric: "cpu.load.1min",
		condition: "gt",
		threshold: 2.0,
		severity: "warning",
		enabled: true,
		cooldownMs: 300000, // 5 min between alerts
	},
	{
		id: "memory-high",
		name: "High Memory Usage",
		description: "Memory usage exceeds threshold",
		metric: "memory.usagePercent",
		condition: "gt",
		threshold: 85,
		severity: "warning",
		enabled: true,
		cooldownMs: 300000,
	},
	{
		id: "memory-critical",
		name: "Critical Memory Usage",
		description: "Memory usage exceeds critical threshold",
		metric: "memory.usagePercent",
		condition: "gt",
		threshold: 95,
		severity: "critical",
		enabled: true,
		cooldownMs: 120000,
	},
	{
		id: "errors-high",
		name: "High Error Rate",
		description: "More than 50 errors in the last 24 hours",
		metric: "logs.recentErrors24h",
		condition: "gt",
		threshold: 50,
		severity: "warning",
		enabled: true,
		cooldownMs: 600000,
	},
	{
		id: "errors-critical",
		name: "Critical Error Rate",
		description: "More than 200 errors in the last 24 hours",
		metric: "logs.recentErrors24h",
		condition: "gt",
		threshold: 200,
		severity: "critical",
		enabled: true,
		cooldownMs: 300000,
	},
	{
		id: "disk-high",
		name: "High Disk Usage",
		description: "Disk usage exceeds threshold",
		metric: "disk.usagePercent",
		condition: "gt",
		threshold: 85,
		severity: "warning",
		enabled: true,
		cooldownMs: 600000,
	},
	{
		id: "api-down",
		name: "API Unreachable",
		description: "API health endpoint returns non-200",
		metric: "health.api",
		condition: "eq",
		threshold: 0,
		severity: "critical",
		enabled: true,
		cooldownMs: 60000,
	},
	{
		id: "worker-down",
		name: "Worker Unreachable",
		description: "Worker health endpoint returns non-200",
		metric: "health.worker",
		condition: "eq",
		threshold: 0,
		severity: "critical",
		enabled: true,
		cooldownMs: 60000,
	},
]

// ── State ────────────────────────────────────────────────────────────────────────

let alertHistory = []
let rules = []
let lastAlertTime = {}
let checkInterval = null
let broadcastFn = null
let telegramNotifyFn = null
let writeLogFn = null

// ── Persistence ──────────────────────────────────────────────────────────────────

function loadAlerts() {
	try {
		if (fs.existsSync(ALERTS_PATH)) {
			const raw = fs.readFileSync(ALERTS_PATH, "utf-8")
			alertHistory = JSON.parse(raw)
		}
	} catch (err) {
		console.error("[monitoring-engine] Failed to load alerts:", err.message)
		alertHistory = []
	}
}

function saveAlerts() {
	try {
		const dir = path.dirname(ALERTS_PATH)
		if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
		fs.writeFileSync(ALERTS_PATH, JSON.stringify(alertHistory, null, 2), "utf-8")
	} catch (err) {
		console.error("[monitoring-engine] Failed to save alerts:", err.message)
	}
}

function loadRules() {
	try {
		if (fs.existsSync(ALERT_RULES_PATH)) {
			const raw = fs.readFileSync(ALERT_RULES_PATH, "utf-8")
			rules = JSON.parse(raw)
		} else {
			rules = JSON.parse(JSON.stringify(DEFAULT_RULES))
			saveRules()
		}
	} catch (err) {
		console.error("[monitoring-engine] Failed to load rules:", err.message)
		rules = JSON.parse(JSON.stringify(DEFAULT_RULES))
	}
}

function saveRules() {
	try {
		const dir = path.dirname(ALERT_RULES_PATH)
		if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
		fs.writeFileSync(ALERT_RULES_PATH, JSON.stringify(rules, null, 2), "utf-8")
	} catch (err) {
		console.error("[monitoring-engine] Failed to save rules:", err.message)
	}
}

// ── Alert Evaluation ─────────────────────────────────────────────────────────────

function evaluateCondition(actualValue, condition, threshold) {
	switch (condition) {
		case "gt":
			return actualValue > threshold
		case "lt":
			return actualValue < threshold
		case "gte":
			return actualValue >= threshold
		case "lte":
			return actualValue <= threshold
		case "eq":
			return actualValue === threshold
		case "neq":
			return actualValue !== threshold
		default:
			return false
	}
}

function getMetricValue(metrics, metricPath) {
	const parts = metricPath.split(".")
	let value = metrics
	for (const part of parts) {
		if (value === null || value === undefined || typeof value !== "object") {
			return undefined
		}
		value = value[part]
	}
	return value
}

function evaluateRules(metrics) {
	const now = Date.now()
	const triggered = []

	for (const rule of rules) {
		if (!rule.enabled) continue

		const actualValue = getMetricValue(metrics, rule.metric)
		if (actualValue === undefined) continue

		const isTriggered = evaluateCondition(actualValue, rule.condition, rule.threshold)
		if (!isTriggered) continue

		// Check cooldown
		const lastTime = lastAlertTime[rule.id] || 0
		if (now - lastTime < rule.cooldownMs) continue

		lastAlertTime[rule.id] = now

		const alert = {
			id: `${rule.id}-${now}`,
			ruleId: rule.id,
			ruleName: rule.name,
			severity: rule.severity,
			metric: rule.metric,
			actualValue,
			threshold: rule.threshold,
			condition: rule.condition,
			timestamp: now,
			message: `${rule.name}: ${actualValue} ${conditionSymbol(rule.condition)} ${rule.threshold}`,
			acknowledged: false,
			resolved: false,
			resolvedAt: null,
		}

		triggered.push(alert)
		alertHistory.push(alert)

		// Notify
		if (broadcastFn) {
			broadcastFn("monitoring:alert", alert)
		}
		if (telegramNotifyFn) {
			telegramNotifyFn(alert)
		}
		if (writeLogFn) {
			writeLogFn(rule.severity === "critical" ? "error" : "warn", "monitoring-engine", alert.message, {
				ruleId: rule.id,
				metric: rule.metric,
				actualValue,
				threshold: rule.threshold,
			})
		}
	}

	// Prune old alerts (keep last 1000)
	if (alertHistory.length > 1000) {
		alertHistory = alertHistory.slice(-1000)
	}

	if (triggered.length > 0) {
		saveAlerts()
	}

	return triggered
}

function conditionSymbol(condition) {
	switch (condition) {
		case "gt":
			return ">"
		case "lt":
			return "<"
		case "gte":
			return ">="
		case "lte":
			return "<="
		case "eq":
			return "=="
		case "neq":
			return "!="
		default:
			return condition
	}
}

// ── Metrics Collection ───────────────────────────────────────────────────────────

async function collectMetrics() {
	const cpus = os.cpus()
	const totalMem = os.totalmem()
	const freeMem = os.freemem()
	const usedMem = totalMem - freeMem

	let cpuLoad = null
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

	return {
		cpu: {
			count: cpus.length,
			load: cpuLoad || { "1min": 0, "5min": 0, "15min": 0 },
		},
		memory: {
			total: totalMem,
			free: freeMem,
			used: usedMem,
			usagePercent: totalMem > 0 ? Math.round((usedMem / totalMem) * 100) : 0,
		},
		disk: {
			usagePercent: 0, // Populated by health check
		},
		logs: {
			recentErrors24h: 0, // Populated by health check
		},
		health: {
			api: 1,
			worker: 1,
		},
		timestamp: Date.now(),
	}
}

// ── Health Check ─────────────────────────────────────────────────────────────────

async function runHealthChecks() {
	const results = []

	// Check API health
	try {
		const res = await fetch("http://127.0.0.1:8790/api/health", {
			signal: AbortSignal.timeout(5000),
		})
		const data = await res.json()
		results.push({
			component: "api",
			status: data.status === "online" ? "healthy" : "warning",
			message: `API ${data.status}`,
		})
	} catch (err) {
		results.push({
			component: "api",
			status: "failed",
			message: `API unreachable: ${err.message}`,
		})
	}

	// Check worker health
	try {
		const res = await fetch("http://127.0.0.1:8790/api/worker/health", {
			signal: AbortSignal.timeout(5000),
		})
		const data = await res.json()
		results.push({
			component: "worker",
			status: data.status === "healthy" ? "healthy" : "warning",
			message: `Worker ${data.status || "unknown"}`,
		})
	} catch {
		results.push({
			component: "worker",
			status: "failed",
			message: "Worker unreachable",
		})
	}

	// Check dashboard
	try {
		const res = await fetch("http://127.0.0.1:8790/", {
			signal: AbortSignal.timeout(5000),
		})
		results.push({
			component: "dashboard",
			status: res.status === 200 ? "healthy" : "warning",
			message: `Dashboard HTTP ${res.status}`,
		})
	} catch {
		results.push({
			component: "dashboard",
			status: "failed",
			message: "Dashboard unreachable",
		})
	}

	// Check PM2 processes
	try {
		const { exec } = require("child_process")
		const { promisify } = require("util")
		const execAsync = promisify(exec)
		const { stdout } = await execAsync("pm2 jlist", { timeout: 5000 })
		const processes = JSON.parse(stdout)
		const online = processes.filter((p) => p.pm2_env.status === "online").length
		const total = processes.length
		results.push({
			component: "pm2",
			status: online === total ? "healthy" : online > 0 ? "warning" : "failed",
			message: `${online}/${total} processes online`,
		})
	} catch {
		results.push({
			component: "pm2",
			status: "warning",
			message: "PM2 status unavailable",
		})
	}

	// Check disk usage
	try {
		const { exec } = require("child_process")
		const { promisify } = require("util")
		const execAsync = promisify(exec)
		const { stdout } = await execAsync("df -h / | tail -1", { timeout: 5000 })
		const parts = stdout.trim().split(/\s+/)
		const usagePercent = parseInt(parts[4]?.replace("%", "") || "0", 10)
		results.push({
			component: "disk",
			status: usagePercent < 85 ? "healthy" : usagePercent < 95 ? "warning" : "failed",
			message: `Disk ${usagePercent}% used`,
			usagePercent,
		})
	} catch {
		results.push({
			component: "disk",
			status: "warning",
			message: "Disk usage unavailable",
		})
	}

	// Count recent errors from log files
	let recentErrors = 0
	const LOGS_DIR = path.resolve(__dirname, "..", "..", "logs")
	const now = Date.now()
	const last24h = now - 24 * 60 * 60 * 1000
	try {
		if (fs.existsSync(LOGS_DIR)) {
			const files = fs
				.readdirSync(LOGS_DIR)
				.filter((f) => f.startsWith("superroo-") && f.endsWith(".jsonl"))
				.sort()
				.reverse()
				.slice(0, 3)

			for (const file of files) {
				const content = fs.readFileSync(path.join(LOGS_DIR, file), "utf-8")
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
		// Ignore
	}

	return { results, recentErrors }
}

// ── Main Check Cycle ─────────────────────────────────────────────────────────────

async function runCheckCycle() {
	try {
		const metrics = await collectMetrics()
		const healthResults = await runHealthChecks()

		// Merge health results into metrics
		for (const result of healthResults.results) {
			if (result.component === "disk" && result.usagePercent !== undefined) {
				metrics.disk.usagePercent = result.usagePercent
			}
		}
		metrics.logs.recentErrors24h = healthResults.recentErrors

		// Update health status in metrics
		for (const result of healthResults.results) {
			if (result.component === "api") {
				metrics.health.api = result.status === "healthy" ? 1 : 0
			}
			if (result.component === "worker") {
				metrics.health.worker = result.status === "healthy" ? 1 : 0
			}
		}

		// Evaluate alert rules
		const triggered = evaluateRules(metrics)

		// Broadcast health check results
		if (broadcastFn) {
			broadcastFn("monitoring:health-check", {
				timestamp: Date.now(),
				results: healthResults.results,
				metrics: {
					cpu: metrics.cpu,
					memory: metrics.memory,
					disk: metrics.disk,
					logs: metrics.logs,
				},
				alertsTriggered: triggered.length,
			})
		}

		return { metrics, healthResults, triggered }
	} catch (err) {
		console.error("[monitoring-engine] Check cycle failed:", err.message)
		if (writeLogFn) {
			writeLogFn("error", "monitoring-engine", `Check cycle failed: ${err.message}`)
		}
		return null
	}
}

// ── Public API ───────────────────────────────────────────────────────────────────

function start(intervalMs = 60000) {
	if (checkInterval) return

	loadAlerts()
	loadRules()

	console.log(`[monitoring-engine] Starting (interval: ${intervalMs}ms)`)

	// Run immediately
	runCheckCycle()

	// Then every interval
	checkInterval = setInterval(runCheckCycle, intervalMs)
}

function stop() {
	if (checkInterval) {
		clearInterval(checkInterval)
		checkInterval = null
	}
	saveAlerts()
	console.log("[monitoring-engine] Stopped")
}

function setBroadcast(fn) {
	broadcastFn = fn
}

function setTelegramNotify(fn) {
	telegramNotifyFn = fn
}

function setWriteLog(fn) {
	writeLogFn = fn
}

function getAlertHistory(limit = 100, offset = 0) {
	ensureLoaded()
	const sorted = [...alertHistory].sort((a, b) => b.timestamp - a.timestamp)
	return {
		alerts: sorted.slice(offset, offset + limit),
		total: sorted.length,
		hasMore: offset + limit < sorted.length,
	}
}

function ensureLoaded() {
	if (rules.length === 0) {
		loadRules()
	}
	if (alertHistory.length === 0) {
		loadAlerts()
	}
}

function getRules() {
	ensureLoaded()
	return JSON.parse(JSON.stringify(rules))
}

function updateRule(ruleId, updates) {
	ensureLoaded()
	const idx = rules.findIndex((r) => r.id === ruleId)
	if (idx === -1) return null
	rules[idx] = { ...rules[idx], ...updates }
	saveRules()
	return rules[idx]
}

function acknowledgeAlert(alertId) {
	ensureLoaded()
	const alert = alertHistory.find((a) => a.id === alertId)
	if (!alert) return false
	alert.acknowledged = true
	saveAlerts()
	return true
}

function resolveAlert(alertId) {
	ensureLoaded()
	const alert = alertHistory.find((a) => a.id === alertId)
	if (!alert) return false
	alert.resolved = true
	alert.resolvedAt = Date.now()
	saveAlerts()
	return true
}

function getStats() {
	ensureLoaded()
	const now = Date.now()
	const last24h = now - 24 * 60 * 60 * 1000
	const recentAlerts = alertHistory.filter((a) => a.timestamp >= last24h)
	const criticalAlerts = recentAlerts.filter((a) => a.severity === "critical")
	const unacknowledged = recentAlerts.filter((a) => !a.acknowledged)

	return {
		totalAlerts: alertHistory.length,
		recent24h: recentAlerts.length,
		critical24h: criticalAlerts.length,
		unacknowledged: unacknowledged.length,
		rulesEnabled: rules.filter((r) => r.enabled).length,
		rulesTotal: rules.length,
	}
}

module.exports = {
	start,
	stop,
	setBroadcast,
	setTelegramNotify,
	setWriteLog,
	getAlertHistory,
	getRules,
	updateRule,
	acknowledgeAlert,
	resolveAlert,
	getStats,
	runCheckCycle,
	collectMetrics,
	DEFAULT_RULES,
}
