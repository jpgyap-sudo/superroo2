/**
 * SuperRoo Cloud - Healing Metrics API Routes
 *
 * Exposes healing metrics, incidents, and escalated issues for the Cloud IDE
 * dashboard. Prefers live orchestrator/SQLite data and falls back to JSON files.
 */

const fs = require("fs")
const path = require("path")

const METRICS_PATH = path.resolve(__dirname, "..", "..", "..", "memory", "healing-metrics.json")
const INCIDENTS_PATH = path.resolve(__dirname, "..", "..", "..", "memory", "healing-incidents.json")
const DEFAULT_DB_PATH = path.resolve(__dirname, "..", "..", "orchestrator", "data", "orchestrator.db")

const TERMINAL_STATUSES = new Set(["verified", "resolved", "closed", "wont_fix", "escalated"])
const ESCALATED_STATUSES = new Set(["needs_human_approval", "blocked", "reopened", "escalated", "queued_for_fix"])

function readJSON(filePath) {
	try {
		if (!fs.existsSync(filePath)) return null
		return JSON.parse(fs.readFileSync(filePath, "utf-8"))
	} catch (err) {
		console.error(`[healing-metrics] Failed to read ${filePath}:`, err.message)
		return null
	}
}

function sendJson(res, status, payload) {
	res.writeHead(status, { "Content-Type": "application/json" })
	res.end(JSON.stringify(payload))
}

function formatTimestamp(ts) {
	if (!ts) return null
	const n = typeof ts === "string" ? Number(ts) : ts
	return Number.isFinite(n) ? new Date(n).toISOString() : null
}

function successRate(successCount, totalAttempts) {
	if (!totalAttempts || totalAttempts <= 0) return 0
	return Math.round((successCount / totalAttempts) * 100)
}

function parseJsonMaybe(value, fallback) {
	if (value === undefined || value === null || value === "") return fallback
	if (typeof value !== "string") return value
	try {
		return JSON.parse(value)
	} catch {
		return fallback
	}
}

function getOrchestratorBus() {
	const orchestrator = global.__orchestrator
	if (!orchestrator) return null
	return orchestrator.healingBus || orchestrator.healing || null
}

function openDatabase() {
	const dbPath = process.env.ORCHESTRATOR_DB_PATH || DEFAULT_DB_PATH
	if (!dbPath || !fs.existsSync(dbPath)) return null
	try {
		const Database = require("better-sqlite3")
		return { db: new Database(dbPath, { readonly: true, fileMustExist: true }), dbPath }
	} catch (err) {
		console.warn(`[healing-metrics] SQLite unavailable at ${dbPath}: ${err.message}`)
		return null
	}
}

function getColumns(db, tableName) {
	try {
		return new Set(
			db
				.prepare(`PRAGMA table_info(${tableName})`)
				.all()
				.map((c) => c.name),
		)
	} catch {
		return new Set()
	}
}

function hasTable(db, tableName) {
	try {
		const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName)
		return Boolean(row)
	} catch {
		return false
	}
}

function firstColumn(columns, candidates) {
	return candidates.find((candidate) => columns.has(candidate)) || null
}

function countWhere(db, table, where, params) {
	const safeWhere = where || "1=1"
	try {
		const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${safeWhere}`).get(params || {})
		return row && Number.isFinite(row.count) ? row.count : 0
	} catch {
		return 0
	}
}

function groupCounts(db, table, column, where) {
	if (!column) return []
	try {
		return db
			.prepare(
				`SELECT ${column} AS key, COUNT(*) AS count FROM ${table} WHERE ${where || "1=1"} GROUP BY ${column}`,
			)
			.all()
	} catch {
		return []
	}
}

function buildDbContext() {
	const opened = openDatabase()
	if (!opened) return null
	const db = opened.db
	if (!hasTable(db, "healing_incidents")) {
		db.close()
		return null
	}

	const incidentColumns = getColumns(db, "healing_incidents")
	const actionColumns = hasTable(db, "healing_actions") ? getColumns(db, "healing_actions") : new Set()
	return {
		db,
		dbPath: opened.dbPath,
		incidentColumns,
		actionColumns,
		idCol: firstColumn(incidentColumns, ["id", "incident_id"]),
		titleCol: firstColumn(incidentColumns, ["title", "message", "description"]),
		descriptionCol: firstColumn(incidentColumns, ["symptom", "message", "description", "root_cause_summary"]),
		categoryCol: firstColumn(incidentColumns, ["root_cause_category", "category", "type"]),
		severityCol: firstColumn(incidentColumns, ["severity"]),
		statusCol: firstColumn(incidentColumns, ["status"]),
		sourceCol: firstColumn(incidentColumns, ["source_agent", "source", "assigned_to"]),
		fixAttemptsCol: firstColumn(incidentColumns, ["fix_attempts", "fix_count", "failure_count"]),
		createdAtCol: firstColumn(incidentColumns, ["created_at", "timestamp"]),
		updatedAtCol: firstColumn(incidentColumns, ["updated_at", "created_at", "timestamp"]),
		resolvedAtCol: firstColumn(incidentColumns, ["resolved_at"]),
		escalatedCol: firstColumn(incidentColumns, ["escalated"]),
		escalatedAtCol: firstColumn(incidentColumns, ["escalated_at"]),
		recommendedActionCol: firstColumn(incidentColumns, ["recommended_action", "repair_plan", "escalation_reason"]),
		affectedFilesCol: firstColumn(incidentColumns, ["affected_files"]),
	}
}

function normalizeIncidentRow(row, ctx) {
	const metadata = parseJsonMaybe(row.metadata, {})
	const suggested = ctx.recommendedActionCol
		? parseJsonMaybe(row[ctx.recommendedActionCol], row[ctx.recommendedActionCol])
		: null
	let suggestedAction = null
	if (typeof suggested === "string") suggestedAction = suggested
	else if (suggested && typeof suggested === "object")
		suggestedAction = suggested.summary || suggested.description || null

	return {
		id: row[ctx.idCol] || row.id,
		title: row[ctx.titleCol] || row.title || row.message || "Untitled Incident",
		description: ctx.descriptionCol ? row[ctx.descriptionCol] || null : null,
		category: ctx.categoryCol ? row[ctx.categoryCol] || null : null,
		severity: ctx.severityCol ? row[ctx.severityCol] || "medium" : "medium",
		status: ctx.statusCol ? row[ctx.statusCol] || "new" : "new",
		affectedFiles: ctx.affectedFilesCol
			? parseJsonMaybe(row[ctx.affectedFilesCol], [])
			: metadata.affectedFiles || [],
		sourceAgent: ctx.sourceCol ? row[ctx.sourceCol] || "unknown" : "unknown",
		fixAttempts: ctx.fixAttemptsCol ? row[ctx.fixAttemptsCol] || 0 : 0,
		suggestedAction,
		escalated: Boolean(
			(ctx.escalatedCol && row[ctx.escalatedCol]) || (ctx.escalatedAtCol && row[ctx.escalatedAtCol]),
		),
		createdAt: formatTimestamp(ctx.createdAtCol ? row[ctx.createdAtCol] : null),
		updatedAt: formatTimestamp(ctx.updatedAtCol ? row[ctx.updatedAtCol] : null),
	}
}

function getDbIncidents(ctx, limit, statusFilter) {
	const params = { limit: limit || 50 }
	const where = []
	if (statusFilter && ctx.statusCol) {
		const statuses = statusFilter
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean)
		if (statuses.length > 0) {
			where.push(`${ctx.statusCol} IN (${statuses.map((_, i) => `@status${i}`).join(", ")})`)
			statuses.forEach((status, i) => {
				params[`status${i}`] = status
			})
		}
	}
	const orderCol = ctx.updatedAtCol || ctx.createdAtCol || ctx.idCol || "id"
	const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""
	const rows = ctx.db
		.prepare(`SELECT * FROM healing_incidents ${whereSql} ORDER BY ${orderCol} DESC LIMIT @limit`)
		.all(params)
	return rows.map((row) => normalizeIncidentRow(row, ctx))
}

function getDbRecentTrend(ctx) {
	if (!ctx.createdAtCol) return []
	const now = Date.now()
	return [1, 7, 30].map((day) => {
		const since = now - day * 24 * 60 * 60 * 1000
		return {
			period: day === 1 ? "last_24_hours" : `last_${day}_days`,
			incidents: countWhere(ctx.db, "healing_incidents", `${ctx.createdAtCol} >= @since`, { since }),
			verified: ctx.statusCol
				? countWhere(
						ctx.db,
						"healing_incidents",
						`${ctx.createdAtCol} >= @since AND ${ctx.statusCol} = 'verified'`,
						{ since },
					)
				: 0,
			failed: ctx.statusCol
				? countWhere(
						ctx.db,
						"healing_incidents",
						`${ctx.createdAtCol} >= @since AND ${ctx.statusCol} IN ('blocked', 'reopened', 'escalated')`,
						{ since },
					)
				: 0,
		}
	})
}

function getDbMetrics() {
	const ctx = buildDbContext()
	if (!ctx) return null
	try {
		const total = countWhere(ctx.db, "healing_incidents")
		const verified = ctx.statusCol
			? countWhere(ctx.db, "healing_incidents", `${ctx.statusCol} IN ('verified', 'resolved', 'closed')`)
			: ctx.resolvedAtCol
				? countWhere(ctx.db, "healing_incidents", `${ctx.resolvedAtCol} IS NOT NULL`)
				: 0
		const failures = ctx.statusCol
			? countWhere(
					ctx.db,
					"healing_incidents",
					`${ctx.statusCol} IN ('blocked', 'reopened', 'escalated', 'wont_fix')`,
				)
			: Math.max(total - verified, 0)
		const activeIncidents = ctx.statusCol
			? countWhere(
					ctx.db,
					"healing_incidents",
					`${ctx.statusCol} NOT IN ('verified', 'resolved', 'closed', 'wont_fix', 'escalated')`,
				)
			: Math.max(total - verified, 0)

		const byCategory = groupCounts(ctx.db, "healing_incidents", ctx.categoryCol)
			.map((row) => {
				const category = row.key || "unknown"
				const categoryTotal = row.count
				const categorySuccess =
					ctx.statusCol && ctx.categoryCol
						? countWhere(
								ctx.db,
								"healing_incidents",
								`${ctx.categoryCol} = @category AND ${ctx.statusCol} IN ('verified', 'resolved', 'closed')`,
								{ category },
							)
						: 0
				return {
					category,
					successRate: successRate(categorySuccess, categoryTotal),
					successCount: categorySuccess,
					failureCount: Math.max(categoryTotal - categorySuccess, 0),
					totalAttempts: categoryTotal,
				}
			})
			.sort((a, b) => b.totalAttempts - a.totalAttempts)

		const actionTypeCol = firstColumn(ctx.actionColumns, ["action_type", "type"])
		const resultCol = firstColumn(ctx.actionColumns, ["result", "status"])
		const repairActions = hasTable(ctx.db, "healing_actions") ? countWhere(ctx.db, "healing_actions") : 0
		const repairExecutions = actionTypeCol
			? countWhere(
					ctx.db,
					"healing_actions",
					`${actionTypeCol} LIKE '%repair%' OR ${actionTypeCol} LIKE '%fix%' OR ${actionTypeCol} LIKE '%patch%' OR ${actionTypeCol} LIKE '%execute%'`,
				)
			: repairActions
		const repairSuccesses = resultCol
			? countWhere(ctx.db, "healing_actions", `${resultCol} IN ('success', 'successful', 'verified')`)
			: verified
		const repairFailures = resultCol
			? countWhere(ctx.db, "healing_actions", `${resultCol} IN ('failure', 'failed', 'error')`)
			: failures
		const escalationCount =
			(ctx.escalatedCol ? countWhere(ctx.db, "healing_incidents", `${ctx.escalatedCol} = 1`) : 0) +
			(ctx.escalatedAtCol ? countWhere(ctx.db, "healing_incidents", `${ctx.escalatedAtCol} IS NOT NULL`) : 0) +
			(ctx.statusCol
				? countWhere(
						ctx.db,
						"healing_incidents",
						`${ctx.statusCol} IN ('needs_human_approval', 'blocked', 'escalated')`,
					)
				: 0)
		const repeatedFailures = ctx.fixAttemptsCol
			? countWhere(ctx.db, "healing_incidents", `${ctx.fixAttemptsCol} >= 2`)
			: ctx.statusCol
				? countWhere(ctx.db, "healing_incidents", `${ctx.statusCol} = 'reopened'`)
				: 0

		return {
			dataSource: "sqlite",
			dbPath: ctx.dbPath,
			overall: {
				successRate: successRate(verified, total),
				successCount: verified,
				failureCount: failures,
				totalAttempts: total,
			},
			byCategory,
			byPlanType: byCategory.map((entry) => ({
				planType: entry.category,
				successRate: entry.successRate,
				successCount: entry.successCount,
				failureCount: entry.failureCount,
				totalAttempts: entry.totalAttempts,
			})),
			activeIncidents,
			repairExecutions: { total: repairExecutions, successCount: repairSuccesses, failureCount: repairFailures },
			repairActions,
			escalationCount,
			repeatedFailures,
			recentTrend: getDbRecentTrend(ctx),
			lastUpdated: new Date().toISOString(),
		}
	} finally {
		ctx.db.close()
	}
}

function getBusMetrics() {
	const bus = getOrchestratorBus()
	if (!bus || typeof bus.getHealingMetrics !== "function") return null
	try {
		const raw = bus.getHealingMetrics()
		const total = raw.totalIncidents || raw.total || (raw.overall && raw.overall.totalAttempts) || 0
		const verified = raw.verifiedIncidents || raw.verified || (raw.overall && raw.overall.successCount) || 0
		const failures =
			raw.blockedIncidents || (raw.overall && raw.overall.failureCount) || Math.max(total - verified, 0)
		const categoryMap = raw.successRateByCategory || raw.incidentsByCategory || {}
		return Object.assign({}, raw, {
			dataSource: "orchestrator",
			overall: raw.overall || {
				successRate: raw.autoFixSuccessRate || raw.successRate || successRate(verified, total),
				successCount: verified,
				failureCount: failures,
				totalAttempts: total,
			},
			byCategory:
				raw.byCategory ||
				Object.entries(categoryMap).map(([category, value]) => ({
					category,
					successRate: typeof value === "number" && value <= 1 ? Math.round(value * 100) : value,
					successCount: 0,
					failureCount: 0,
					totalAttempts: 0,
				})),
			byPlanType: raw.byPlanType || [],
			activeIncidents: raw.openIncidents || raw.open || 0,
			repairExecutions: raw.repairExecutions || {
				total: raw.totalRepairAttempts || 0,
				successCount: raw.successfulRepairs || 0,
				failureCount: raw.failedRepairs || 0,
			},
			repairActions: raw.totalActions || raw.repairActions || 0,
			escalationCount: raw.escalatedIncidents || raw.escalationCount || 0,
			repeatedFailures: raw.repeatedFailures || 0,
			recentTrend: raw.recentTrend || [],
			lastUpdated: new Date().toISOString(),
		})
	} catch (err) {
		console.warn(`[healing-metrics] Orchestrator metrics unavailable: ${err.message}`)
		return null
	}
}

function getJsonMetrics() {
	const metrics = readJSON(METRICS_PATH)
	const incidents = readJSON(INCIDENTS_PATH)
	const incidentList = Array.isArray(incidents) ? incidents : []
	const overall =
		metrics && metrics.overall ? metrics.overall : { successCount: 0, failureCount: 0, totalAttempts: 0 }
	const activeIncidents = incidentList.filter(
		(inc) => !TERMINAL_STATUSES.has(String(inc.status || "").toLowerCase()),
	).length
	const repeatedFailures = incidentList.filter(
		(inc) =>
			(inc.fixAttempts || inc.fix_count || inc.failureCount || inc.failure_count || 0) >= 2 ||
			inc.status === "reopened",
	).length
	const escalationCount = incidentList.filter(
		(inc) =>
			Boolean(inc.escalated || inc.escalatedAt || inc.escalated_at) ||
			ESCALATED_STATUSES.has(String(inc.status || "").toLowerCase()),
	).length
	return {
		dataSource: "json_fallback",
		overall: {
			successRate: successRate(overall.successCount || 0, overall.totalAttempts || 0),
			successCount: overall.successCount || 0,
			failureCount: overall.failureCount || 0,
			totalAttempts: overall.totalAttempts || 0,
		},
		byCategory: Object.entries((metrics && metrics.byCategory) || {})
			.map(([category, data]) => ({
				category,
				successRate: successRate(data.successCount, data.totalAttempts),
				successCount: data.successCount || 0,
				failureCount: data.failureCount || 0,
				totalAttempts: data.totalAttempts || 0,
			}))
			.sort((a, b) => b.totalAttempts - a.totalAttempts),
		byPlanType: Object.entries((metrics && metrics.byPlanType) || {})
			.map(([planType, data]) => ({
				planType,
				successRate: successRate(data.successCount, data.totalAttempts),
				successCount: data.successCount || 0,
				failureCount: data.failureCount || 0,
				totalAttempts: data.totalAttempts || 0,
			}))
			.sort((a, b) => b.totalAttempts - a.totalAttempts),
		activeIncidents,
		repairExecutions: {
			total: overall.totalAttempts || 0,
			successCount: overall.successCount || 0,
			failureCount: overall.failureCount || 0,
		},
		repairActions: 0,
		escalationCount,
		repeatedFailures,
		recentTrend: metrics && metrics.recentTrend ? metrics.recentTrend : [],
		lastUpdated: metrics ? formatTimestamp(metrics.lastUpdated) : null,
	}
}

function getMetrics() {
	return getBusMetrics() || getDbMetrics() || getJsonMetrics()
}

function getIncidents(rawUrl) {
	const params = new URL(rawUrl, "http://localhost").searchParams
	const limit = Math.min(parseInt(params.get("limit") || "50", 10), 200)
	const statusFilter = params.get("status")
	const ctx = buildDbContext()
	if (ctx) {
		try {
			return {
				dataSource: "sqlite",
				incidents: getDbIncidents(ctx, limit, statusFilter),
				total: countWhere(ctx.db, "healing_incidents"),
			}
		} finally {
			ctx.db.close()
		}
	}

	const incidents = readJSON(INCIDENTS_PATH)
	let filtered = Array.isArray(incidents) ? incidents : []
	if (statusFilter) {
		const statuses = statusFilter.split(",").map((s) => s.trim().toLowerCase())
		filtered = filtered.filter((inc) => statuses.includes(String(inc.status || "").toLowerCase()))
	}
	filtered = filtered
		.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
		.slice(0, limit)
	return {
		dataSource: "json_fallback",
		incidents: filtered.map((inc) => ({
			id: inc.id,
			title: inc.title || "Untitled Incident",
			category: inc.rootCauseCategory || inc.category || null,
			severity: inc.severity || "medium",
			status: inc.status || "new",
			affectedFiles: inc.affectedFiles || [],
			sourceAgent: inc.sourceAgent || inc.source || "unknown",
			fixAttempts: inc.fixAttempts || inc.fix_count || inc.failureCount || 0,
			createdAt: formatTimestamp(inc.createdAt || inc.created_at),
			updatedAt: formatTimestamp(inc.updatedAt || inc.updated_at || inc.createdAt || inc.created_at),
		})),
		total: Array.isArray(incidents) ? incidents.length : 0,
	}
}

function getEscalated() {
	const ctx = buildDbContext()
	if (ctx) {
		try {
			const all = getDbIncidents(ctx, 200, null)
			const escalated = all.filter(
				(inc) =>
					inc.escalated ||
					ESCALATED_STATUSES.has(String(inc.status || "").toLowerCase()) ||
					(inc.fixAttempts || 0) >= 3,
			)
			return { dataSource: "sqlite", escalated, total: escalated.length }
		} finally {
			ctx.db.close()
		}
	}

	const incidents = getIncidents("/healing/incidents?limit=200")
	const escalated = incidents.incidents.filter(
		(inc) => ESCALATED_STATUSES.has(String(inc.status || "").toLowerCase()) || (inc.fixAttempts || 0) >= 3,
	)
	return { dataSource: incidents.dataSource, escalated, total: escalated.length }
}

function handleGetMetrics(req, res) {
	sendJson(res, 200, getMetrics())
}

function handleGetIncidents(req, res, rawUrl) {
	const payload = getIncidents(rawUrl)
	sendJson(res, 200, Object.assign({}, payload, { filtered: payload.incidents.length }))
}

function handleGetEscalated(req, res) {
	sendJson(res, 200, getEscalated())
}

async function handleHealingRoute(method, url, req, res) {
	const parsedUrl = new URL(url, "http://localhost")
	const pathname = parsedUrl.pathname
	const normalizedPath = pathname.startsWith("/api") ? pathname.slice(4) || "/" : pathname

	if (method === "GET" && (pathname === "/api/healing/metrics" || normalizedPath === "/healing/metrics")) {
		handleGetMetrics(req, res)
		return true
	}
	if (method === "GET" && (pathname === "/api/healing/incidents" || normalizedPath === "/healing/incidents")) {
		handleGetIncidents(req, res, url)
		return true
	}
	if (method === "GET" && (pathname === "/api/healing/escalated" || normalizedPath === "/healing/escalated")) {
		handleGetEscalated(req, res)
		return true
	}
	return false
}

module.exports = { handleHealingRoute }
