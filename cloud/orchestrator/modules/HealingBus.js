/**
 * Cloud Orchestrator — Healing Bus.
 *
 * Central incident management system: report, track, update, and query
 * healing incidents and their associated actions.
 *
 * Ported from src/super-roo/healing/HealingBus.ts for the cloud runtime.
 * Uses the MemoryStore (SQLite) for persistence.
 */

// ─── Constants ──────────────────────────────────────────────────────────────

const IncidentStatus = Object.freeze({
	NEW: "new",
	INVESTIGATING: "investigating",
	QUEUED_FOR_FIX: "queued_for_fix",
	FIXING: "fixing",
	FIX_READY: "fix_ready",
	DEPLOYED: "deployed",
	VERIFYING: "verifying",
	VERIFIED: "verified",
	REOPENED: "reopened",
	WONT_FIX: "wont_fix",
	ESCALATED: "escalated",
})

const RootCauseCategory = Object.freeze({
	CODE_BUG: "code_bug",
	CONFIG_ERROR: "config_error",
	DEPENDENCY_FAILURE: "dependency_failure",
	INFRASTRUCTURE: "infrastructure",
	PERFORMANCE: "performance",
	SECURITY: "security",
	UNKNOWN: "unknown",
})

const HealingActionType = Object.freeze({
	INVESTIGATE: "investigate",
	AUTO_FIX: "auto_fix",
	MANUAL_FIX: "manual_fix",
	ROLLBACK: "rollback",
	RESTART: "restart",
	ESCALATE: "escalate",
	VERIFY: "verify",
	REOPEN: "reopen",
	CLOSE: "close",
})

const DEFAULT_ACTION_CLEANUP_DAYS = 90

// ─── Valid state transitions ────────────────────────────────────────────────

const VALID_TRANSITIONS = {
	[IncidentStatus.NEW]: [IncidentStatus.INVESTIGATING, IncidentStatus.WONT_FIX, IncidentStatus.ESCALATED],
	[IncidentStatus.INVESTIGATING]: [
		IncidentStatus.QUEUED_FOR_FIX,
		IncidentStatus.WONT_FIX,
		IncidentStatus.ESCALATED,
		IncidentStatus.NEW,
	],
	[IncidentStatus.QUEUED_FOR_FIX]: [IncidentStatus.FIXING, IncidentStatus.WONT_FIX, IncidentStatus.ESCALATED],
	[IncidentStatus.FIXING]: [IncidentStatus.FIX_READY, IncidentStatus.REOPENED, IncidentStatus.ESCALATED],
	[IncidentStatus.FIX_READY]: [IncidentStatus.DEPLOYED, IncidentStatus.FIXING, IncidentStatus.REOPENED],
	[IncidentStatus.DEPLOYED]: [IncidentStatus.VERIFYING, IncidentStatus.REOPENED, IncidentStatus.ESCALATED],
	[IncidentStatus.VERIFYING]: [IncidentStatus.VERIFIED, IncidentStatus.REOPENED, IncidentStatus.ESCALATED],
	[IncidentStatus.VERIFIED]: [IncidentStatus.REOPENED],
	[IncidentStatus.REOPENED]: [IncidentStatus.INVESTIGATING, IncidentStatus.WONT_FIX, IncidentStatus.ESCALATED],
	[IncidentStatus.WONT_FIX]: [],
	[IncidentStatus.ESCALATED]: [IncidentStatus.NEW, IncidentStatus.INVESTIGATING],
}

function isValidTransition(from, to) {
	const allowed = VALID_TRANSITIONS[from]
	return allowed ? allowed.includes(to) : false
}

// ─── Fingerprint helper ─────────────────────────────────────────────────────

function makeIncidentFingerprint(input) {
	const parts = [input.source || "", input.type || "", input.message || ""]
	return parts.join("::").toLowerCase().replace(/\s+/g, " ").trim()
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function safeJsonParse(json, fallback) {
	try {
		return JSON.parse(json)
	} catch {
		return fallback
	}
}

class HealingBus {
	/**
	 * @param {Object} opts
	 * @param {Object} opts.memoryStore - MemoryStore instance (SQLite).
	 */
	constructor(opts = {}) {
		if (!opts.memoryStore) {
			throw new Error("HealingBus requires a memoryStore")
		}
		this.memory = opts.memoryStore
		this._initialized = false
	}

	async initialize() {
		if (this._initialized) return
		this._initialized = true
		const db = this.memory.getDb()
		db.exec(`
			CREATE TABLE IF NOT EXISTS healing_incidents (
				id TEXT PRIMARY KEY,
				source TEXT NOT NULL DEFAULT '',
				type TEXT NOT NULL DEFAULT '',
				severity TEXT NOT NULL DEFAULT 'medium',
				status TEXT NOT NULL DEFAULT 'new',
				title TEXT NOT NULL DEFAULT '',
				message TEXT NOT NULL DEFAULT '',
				stack_trace TEXT DEFAULT '',
				fingerprint TEXT DEFAULT '',
				root_cause_category TEXT DEFAULT 'unknown',
				root_cause_summary TEXT DEFAULT '',
				assigned_to TEXT DEFAULT '',
				task_id TEXT DEFAULT '',
				feature_id TEXT DEFAULT '',
				metadata TEXT DEFAULT '{}',
				escalated INTEGER DEFAULT 0,
				escalation_reason TEXT DEFAULT '',
				fix_count INTEGER DEFAULT 0,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			)
		`)
		db.exec(`
			CREATE TABLE IF NOT EXISTS healing_actions (
				id TEXT PRIMARY KEY,
				incident_id TEXT NOT NULL,
				action_type TEXT NOT NULL,
				description TEXT NOT NULL DEFAULT '',
				actor TEXT DEFAULT '',
				details TEXT DEFAULT '{}',
				created_at INTEGER NOT NULL,
				FOREIGN KEY (incident_id) REFERENCES healing_incidents(id)
			)
		`)
		console.log("[orchestrator/healing-bus] Initialized")
	}

	// ── Helpers ───────────────────────────────────────────────────────────

	_generateId() {
		return "inc-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8)
	}

	_generateActionId() {
		return "act-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8)
	}

	_rowToIncident(r) {
		return {
			id: r.id,
			source: r.source || "",
			type: r.type || "",
			severity: r.severity || "medium",
			status: r.status,
			title: r.title || "",
			message: r.message || "",
			stackTrace: r.stack_trace || "",
			fingerprint: r.fingerprint || "",
			rootCauseCategory: r.root_cause_category || RootCauseCategory.UNKNOWN,
			rootCauseSummary: r.root_cause_summary || "",
			assignedTo: r.assigned_to || "",
			taskId: r.task_id || "",
			featureId: r.feature_id || "",
			metadata: safeJsonParse(r.metadata, {}),
			escalated: !!r.escalated,
			escalationReason: r.escalation_reason || "",
			fixCount: r.fix_count || 0,
			createdAt: r.created_at,
			updatedAt: r.updated_at,
		}
	}

	_rowToHealingAction(r) {
		return {
			id: r.id,
			incidentId: r.incident_id,
			actionType: r.action_type,
			description: r.description || "",
			actor: r.actor || "",
			details: safeJsonParse(r.details, {}),
			createdAt: r.created_at,
		}
	}

	// ── Incident CRUD ─────────────────────────────────────────────────────

	/**
	 * Report a new incident.
	 * @param {Object} input
	 * @returns {Object} The created incident record.
	 */
	async reportIncident(input) {
		// Validate required fields
		if (!input.message && !input.title) {
			throw new Error("Incident must have a 'message' or 'title'")
		}

		const fingerprint = input.fingerprint || makeIncidentFingerprint(input)

		// Check for duplicate by fingerprint
		const existing = this.getByFingerprint(fingerprint)
		if (existing && existing.status !== IncidentStatus.VERIFIED && existing.status !== IncidentStatus.WONT_FIX) {
			// Update existing incident instead of creating duplicate
			this.updateIncident(existing.id, {
				message: input.message || existing.message,
				stackTrace: input.stackTrace || existing.stackTrace,
				updatedAt: Date.now(),
			})
			return this.get(existing.id)
		}

		const now = Date.now()
		const id = this._generateId()
		const db = this.memory.getDb()

		db.run(
			`INSERT INTO healing_incidents (id, source, type, severity, status, title, message, stack_trace,
			 fingerprint, root_cause_category, root_cause_summary, assigned_to, task_id, feature_id,
			 metadata, escalated, escalation_reason, fix_count, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				id,
				input.source || "",
				input.type || "",
				input.severity || "medium",
				IncidentStatus.NEW,
				input.title || "",
				input.message || "",
				input.stackTrace || "",
				fingerprint,
				input.rootCauseCategory || RootCauseCategory.UNKNOWN,
				input.rootCauseSummary || "",
				input.assignedTo || "",
				input.taskId || "",
				input.featureId || "",
				JSON.stringify(input.metadata || {}),
				0,
				"",
				0,
				now,
				now,
			],
		)

		// Log the creation action
		await this.logHealingAction(id, HealingActionType.INVESTIGATE, "Incident reported", "system", {
			source: input.source,
			severity: input.severity,
		})

		return this.get(id)
	}

	/**
	 * Get an incident by ID.
	 * @param {string} id
	 * @returns {Object|null}
	 */
	get(id) {
		const db = this.memory.getDb()
		const row = db.prepare("SELECT * FROM healing_incidents WHERE id = ?").get(id)
		return row ? this._rowToIncident(row) : null
	}

	/**
	 * Get an incident by fingerprint.
	 * @param {string} fingerprint
	 * @returns {Object|null}
	 */
	getByFingerprint(fingerprint) {
		if (!fingerprint) return null
		const db = this.memory.getDb()
		const row = db
			.prepare("SELECT * FROM healing_incidents WHERE fingerprint = ? ORDER BY created_at DESC LIMIT 1")
			.get(fingerprint)
		return row ? this._rowToIncident(row) : null
	}

	/**
	 * List incidents with optional filters.
	 * @param {Object} [filter]
	 * @param {string} [filter.status]
	 * @param {string} [filter.severity]
	 * @param {string} [filter.source]
	 * @param {string} [filter.type]
	 * @param {string} [filter.featureId]
	 * @param {number} [filter.limit=50]
	 * @returns {Object[]}
	 */
	list(filter = {}) {
		const db = this.memory.getDb()
		let sql = "SELECT * FROM healing_incidents WHERE 1=1"
		const params = []
		if (filter.status) {
			sql += " AND status = ?"
			params.push(filter.status)
		}
		if (filter.severity) {
			sql += " AND severity = ?"
			params.push(filter.severity)
		}
		if (filter.source) {
			sql += " AND source = ?"
			params.push(filter.source)
		}
		if (filter.type) {
			sql += " AND type = ?"
			params.push(filter.type)
		}
		if (filter.featureId) {
			sql += " AND feature_id = ?"
			params.push(filter.featureId)
		}
		sql += " ORDER BY created_at DESC"
		const limit = filter.limit || 50
		sql += " LIMIT ?"
		params.push(limit)
		const rows = db.prepare(sql).all(...params)
		return rows.map((r) => this._rowToIncident(r))
	}

	/**
	 * List open (non-terminal) incidents.
	 * @param {number} [limit=50]
	 * @returns {Object[]}
	 */
	listOpen(limit = 50) {
		const db = this.memory.getDb()
		const terminal = [IncidentStatus.VERIFIED, IncidentStatus.WONT_FIX, IncidentStatus.ESCALATED]
		const placeholders = terminal.map(() => "?").join(",")
		const rows = db
			.prepare(
				`SELECT * FROM healing_incidents WHERE status NOT IN (${placeholders}) ORDER BY created_at DESC LIMIT ?`,
			)
			.all(...terminal, limit)
		return rows.map((r) => this._rowToIncident(r))
	}

	/**
	 * Update an incident.
	 * @param {string} id
	 * @param {Object} patch
	 * @returns {Object|null}
	 */
	updateIncident(id, patch) {
		const existing = this.get(id)
		if (!existing) return null

		const now = patch.updatedAt || Date.now()
		const db = this.memory.getDb()
		const fields = []
		const params = []

		if (patch.status !== undefined) {
			if (!isValidTransition(existing.status, patch.status)) {
				console.warn(`[orchestrator/healing-bus] Invalid transition: ${existing.status} -> ${patch.status}`)
			}
			fields.push("status = ?")
			params.push(patch.status)
		}
		if (patch.severity !== undefined) {
			fields.push("severity = ?")
			params.push(patch.severity)
		}
		if (patch.title !== undefined) {
			fields.push("title = ?")
			params.push(patch.title)
		}
		if (patch.message !== undefined) {
			fields.push("message = ?")
			params.push(patch.message)
		}
		if (patch.stackTrace !== undefined) {
			fields.push("stack_trace = ?")
			params.push(patch.stackTrace)
		}
		if (patch.rootCauseCategory !== undefined) {
			fields.push("root_cause_category = ?")
			params.push(patch.rootCauseCategory)
		}
		if (patch.rootCauseSummary !== undefined) {
			fields.push("root_cause_summary = ?")
			params.push(patch.rootCauseSummary)
		}
		if (patch.assignedTo !== undefined) {
			fields.push("assigned_to = ?")
			params.push(patch.assignedTo)
		}
		if (patch.taskId !== undefined) {
			fields.push("task_id = ?")
			params.push(patch.taskId)
		}
		if (patch.featureId !== undefined) {
			fields.push("feature_id = ?")
			params.push(patch.featureId)
		}
		if (patch.metadata !== undefined) {
			fields.push("metadata = ?")
			params.push(JSON.stringify(patch.metadata))
		}
		if (patch.escalated !== undefined) {
			fields.push("escalated = ?")
			params.push(patch.escalated ? 1 : 0)
		}
		if (patch.escalationReason !== undefined) {
			fields.push("escalation_reason = ?")
			params.push(patch.escalationReason)
		}
		if (patch.fixCount !== undefined) {
			fields.push("fix_count = ?")
			params.push(patch.fixCount)
		}

		if (fields.length === 0) return existing

		fields.push("updated_at = ?")
		params.push(now)
		params.push(id)

		db.run(`UPDATE healing_incidents SET ${fields.join(", ")} WHERE id = ?`, params)
		return this.get(id)
	}

	/**
	 * Check if auto-fix is allowed for an incident.
	 * @param {Object} incident
	 * @returns {boolean}
	 */
	isAutoFixAllowed(incident) {
		if (incident.fixCount >= 3) return false
		if (incident.escalated) return false
		if (incident.rootCauseCategory === RootCauseCategory.UNKNOWN) return false
		if (incident.rootCauseCategory === RootCauseCategory.SECURITY) return false
		return true
	}

	// ── Healing Actions ───────────────────────────────────────────────────

	/**
	 * Log a healing action for an incident.
	 * @param {string} incidentId
	 * @param {string} actionType
	 * @param {string} description
	 * @param {string} [actor="system"]
	 * @param {Object} [details={}]
	 * @returns {Object}
	 */
	async logHealingAction(incidentId, actionType, description, actor = "system", details = {}) {
		const now = Date.now()
		const id = this._generateActionId()
		const db = this.memory.getDb()
		db.run(
			`INSERT INTO healing_actions (id, incident_id, action_type, description, actor, details, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[id, incidentId, actionType, description, actor, JSON.stringify(details), now],
		)
		return this._rowToHealingAction(db.prepare("SELECT * FROM healing_actions WHERE id = ?").get(id))
	}

	/**
	 * Get all healing actions for an incident.
	 * @param {string} incidentId
	 * @returns {Object[]}
	 */
	getHealingActions(incidentId) {
		const db = this.memory.getDb()
		const rows = db
			.prepare("SELECT * FROM healing_actions WHERE incident_id = ? ORDER BY created_at ASC")
			.all(incidentId)
		return rows.map((r) => this._rowToHealingAction(r))
	}

	/**
	 * Clean up old healing actions.
	 * @param {number} [maxAgeDays=90]
	 * @returns {number} Number of deleted actions.
	 */
	cleanupOldHealingActions(maxAgeDays = DEFAULT_ACTION_CLEANUP_DAYS) {
		const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
		const db = this.memory.getDb()
		const result = db.run("DELETE FROM healing_actions WHERE created_at < ?", [cutoff])
		return result.changes
	}

	// ── Metrics ───────────────────────────────────────────────────────────

	/**
	 * Get healing metrics.
	 * @returns {Object}
	 */
	getHealingMetrics() {
		const db = this.memory.getDb()

		const total = db.prepare("SELECT COUNT(*) as count FROM healing_incidents").get().count
		const open = db
			.prepare(
				"SELECT COUNT(*) as count FROM healing_incidents WHERE status NOT IN ('verified', 'wont_fix', 'escalated')",
			)
			.get().count
		const byStatus = db.prepare("SELECT status, COUNT(*) as count FROM healing_incidents GROUP BY status").all()
		const bySeverity = db
			.prepare("SELECT severity, COUNT(*) as count FROM healing_incidents GROUP BY severity")
			.all()
		const byCategory = db
			.prepare(
				"SELECT root_cause_category, COUNT(*) as count FROM healing_incidents GROUP BY root_cause_category",
			)
			.all()

		// Action counts
		const totalActions = db.prepare("SELECT COUNT(*) as count FROM healing_actions").get().count
		const actionsByType = db
			.prepare("SELECT action_type, COUNT(*) as count FROM healing_actions GROUP BY action_type")
			.all()

		// Success rate (incidents that reached verified)
		const verified = db
			.prepare("SELECT COUNT(*) as count FROM healing_incidents WHERE status = 'verified'")
			.get().count
		const successRate = total > 0 ? (verified / total) * 100 : 0

		return {
			total,
			open,
			verified,
			successRate: Math.round(successRate * 100) / 100,
			byStatus,
			bySeverity,
			byCategory,
			totalActions,
			actionsByType,
		}
	}

	/**
	 * Transition an incident's state with validation and action logging.
	 * @param {string} id
	 * @param {string} newStatus
	 * @param {string} [actor="system"]
	 * @param {string} [reason=""]
	 * @returns {Object|null}
	 */
	async transitionState(id, newStatus, actor = "system", reason = "") {
		const incident = this.get(id)
		if (!incident) return null

		if (!isValidTransition(incident.status, newStatus)) {
			throw new Error(
				`Invalid state transition: ${incident.status} -> ${newStatus}. ` +
					`Allowed: ${(VALID_TRANSITIONS[incident.status] || []).join(", ")}`,
			)
		}

		const updated = this.updateIncident(id, { status: newStatus })
		await this.logHealingAction(id, `state:${newStatus}`, reason || `Transitioned to ${newStatus}`, actor)
		return updated
	}

	/**
	 * Store a repair plan for an incident.
	 * @param {string} incidentId
	 * @param {Object} plan
	 * @param {string} actor
	 */
	async storeRepairPlan(incidentId, plan, actor) {
		await this.logHealingAction(incidentId, HealingActionType.AUTO_FIX, "Repair plan created", actor, { plan })
	}
}

module.exports = {
	HealingBus,
	IncidentStatus,
	RootCauseCategory,
	HealingActionType,
	makeIncidentFingerprint,
	isValidTransition,
}
