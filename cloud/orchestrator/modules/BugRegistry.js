/**
 * Cloud Orchestrator — Bug Registry.
 *
 * Tracks bugs, their fixes, and resolution status.
 * Ported from src/super-roo/bugs/BugRegistry.ts for the cloud runtime.
 *
 * Uses the MemoryStore (SQLite) for persistence.
 */

// ─── Constants ──────────────────────────────────────────────────────────────

const BugStatus = Object.freeze({
	OPEN: "open",
	INVESTIGATING: "investigating",
	FIXING: "fixing",
	FIX_READY: "fix_ready",
	VERIFYING: "verifying",
	VERIFIED: "verified",
	CLOSED: "closed",
	WONT_FIX: "wont_fix",
})

const BugSeverity = Object.freeze({
	CRITICAL: "critical",
	HIGH: "high",
	MEDIUM: "medium",
	LOW: "low",
})

class BugRegistry {
	/**
	 * @param {Object} opts
	 * @param {Object} opts.memoryStore - MemoryStore instance (SQLite).
	 */
	constructor(opts = {}) {
		if (!opts.memoryStore) {
			throw new Error("BugRegistry requires a memoryStore")
		}
		this.memory = opts.memoryStore
		this._initialized = false
	}

	async initialize() {
		if (this._initialized) return
		this._initialized = true
		const db = this.memory.getDb()
		db.exec(`
			CREATE TABLE IF NOT EXISTS bugs (
				id TEXT PRIMARY KEY,
				title TEXT NOT NULL,
				description TEXT DEFAULT '',
				status TEXT DEFAULT 'open',
				severity TEXT DEFAULT 'medium',
				source TEXT DEFAULT '',
				feature_id TEXT DEFAULT '',
				fingerprint TEXT DEFAULT '',
				stack_trace TEXT DEFAULT '',
				reproduction_steps TEXT DEFAULT '',
				assigned_to TEXT DEFAULT '',
				tags TEXT DEFAULT '[]',
				metadata TEXT DEFAULT '{}',
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			)
		`)
		db.exec(`
			CREATE TABLE IF NOT EXISTS bug_fixes (
				id TEXT PRIMARY KEY,
				bug_id TEXT NOT NULL,
				description TEXT NOT NULL,
				fix_type TEXT DEFAULT 'code_change',
				changed_files TEXT DEFAULT '[]',
				diff_summary TEXT DEFAULT '',
				applied_by TEXT DEFAULT '',
				verified INTEGER DEFAULT 0,
				created_at INTEGER NOT NULL,
				FOREIGN KEY (bug_id) REFERENCES bugs(id)
			)
		`)
		console.log("[orchestrator/bug-registry] Initialized")
	}

	// ── Helpers ───────────────────────────────────────────────────────────

	_rowToBug(r) {
		return {
			id: r.id,
			title: r.title,
			description: r.description || "",
			status: r.status,
			severity: r.severity,
			source: r.source || "",
			featureId: r.feature_id || "",
			fingerprint: r.fingerprint || "",
			stackTrace: r.stack_trace || "",
			reproductionSteps: r.reproduction_steps || "",
			assignedTo: r.assigned_to || "",
			tags: this._safeJsonParse(r.tags, []),
			metadata: this._safeJsonParse(r.metadata, {}),
			createdAt: r.created_at,
			updatedAt: r.updated_at,
		}
	}

	_rowToFix(r) {
		return {
			id: r.id,
			bugId: r.bug_id,
			description: r.description,
			fixType: r.fix_type || "code_change",
			changedFiles: this._safeJsonParse(r.changed_files, []),
			diffSummary: r.diff_summary || "",
			appliedBy: r.applied_by || "",
			verified: !!r.verified,
			createdAt: r.created_at,
		}
	}

	_safeJsonParse(json, fallback) {
		try {
			return JSON.parse(json)
		} catch {
			return fallback
		}
	}

	_generateId() {
		return "bug-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8)
	}

	_generateFixId() {
		return "fix-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8)
	}

	// ── CRUD: Bugs ────────────────────────────────────────────────────────

	/**
	 * Create a new bug report.
	 * @param {Object} input
	 * @returns {Object}
	 */
	create(input) {
		const now = Date.now()
		const id = this._generateId()
		const db = this.memory.getDb()
		db.run(
			`INSERT INTO bugs (id, title, description, status, severity, source, feature_id, fingerprint,
			 stack_trace, reproduction_steps, assigned_to, tags, metadata, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				id,
				input.title,
				input.description || "",
				input.status || BugStatus.OPEN,
				input.severity || BugSeverity.MEDIUM,
				input.source || "",
				input.featureId || "",
				input.fingerprint || "",
				input.stackTrace || "",
				input.reproductionSteps || "",
				input.assignedTo || "",
				JSON.stringify(input.tags || []),
				JSON.stringify(input.metadata || {}),
				now,
				now,
			],
		)
		return this.get(id)
	}

	/**
	 * Get a bug by ID.
	 * @param {string} id
	 * @returns {Object|null}
	 */
	get(id) {
		const db = this.memory.getDb()
		const row = db.prepare("SELECT * FROM bugs WHERE id = ?").get(id)
		return row ? this._rowToBug(row) : null
	}

	/**
	 * List bugs with optional filters.
	 * @param {Object} [filter]
	 * @param {string} [filter.status]
	 * @param {string} [filter.severity]
	 * @param {string} [filter.featureId]
	 * @param {number} [filter.limit=50]
	 * @returns {Object[]}
	 */
	list(filter = {}) {
		const db = this.memory.getDb()
		let sql = "SELECT * FROM bugs WHERE 1=1"
		const params = []
		if (filter.status) {
			sql += " AND status = ?"
			params.push(filter.status)
		}
		if (filter.severity) {
			sql += " AND severity = ?"
			params.push(filter.severity)
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
		return rows.map((r) => this._rowToBug(r))
	}

	/**
	 * Update a bug.
	 * @param {string} id
	 * @param {Object} patch
	 * @returns {Object|null}
	 */
	update(id, patch) {
		const existing = this.get(id)
		if (!existing) return null

		const now = Date.now()
		const db = this.memory.getDb()
		const fields = []
		const params = []

		if (patch.title !== undefined) {
			fields.push("title = ?")
			params.push(patch.title)
		}
		if (patch.description !== undefined) {
			fields.push("description = ?")
			params.push(patch.description)
		}
		if (patch.status !== undefined) {
			fields.push("status = ?")
			params.push(patch.status)
		}
		if (patch.severity !== undefined) {
			fields.push("severity = ?")
			params.push(patch.severity)
		}
		if (patch.source !== undefined) {
			fields.push("source = ?")
			params.push(patch.source)
		}
		if (patch.featureId !== undefined) {
			fields.push("feature_id = ?")
			params.push(patch.featureId)
		}
		if (patch.fingerprint !== undefined) {
			fields.push("fingerprint = ?")
			params.push(patch.fingerprint)
		}
		if (patch.stackTrace !== undefined) {
			fields.push("stack_trace = ?")
			params.push(patch.stackTrace)
		}
		if (patch.reproductionSteps !== undefined) {
			fields.push("reproduction_steps = ?")
			params.push(patch.reproductionSteps)
		}
		if (patch.assignedTo !== undefined) {
			fields.push("assigned_to = ?")
			params.push(patch.assignedTo)
		}
		if (patch.tags !== undefined) {
			fields.push("tags = ?")
			params.push(JSON.stringify(patch.tags))
		}
		if (patch.metadata !== undefined) {
			fields.push("metadata = ?")
			params.push(JSON.stringify(patch.metadata))
		}

		if (fields.length === 0) return existing

		fields.push("updated_at = ?")
		params.push(now)
		params.push(id)

		db.run(`UPDATE bugs SET ${fields.join(", ")} WHERE id = ?`, params)
		return this.get(id)
	}

	/**
	 * Delete a bug by ID.
	 * @param {string} id
	 * @returns {boolean}
	 */
	delete(id) {
		const db = this.memory.getDb()
		// Also delete associated fixes
		db.run("DELETE FROM bug_fixes WHERE bug_id = ?", [id])
		const result = db.run("DELETE FROM bugs WHERE id = ?", [id])
		return result.changes > 0
	}

	// ── CRUD: Fixes ───────────────────────────────────────────────────────

	/**
	 * Record a fix for a bug.
	 * @param {Object} input
	 * @param {string} input.bugId
	 * @param {string} input.description
	 * @param {string} [input.fixType="code_change"]
	 * @param {string[]} [input.changedFiles]
	 * @param {string} [input.diffSummary]
	 * @param {string} [input.appliedBy]
	 * @returns {Object}
	 */
	recordFix(input) {
		const now = Date.now()
		const id = this._generateFixId()
		const db = this.memory.getDb()

		const tx = db.transaction(() => {
			db.run(
				`INSERT INTO bug_fixes (id, bug_id, description, fix_type, changed_files, diff_summary, applied_by, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					id,
					input.bugId,
					input.description,
					input.fixType || "code_change",
					JSON.stringify(input.changedFiles || []),
					input.diffSummary || "",
					input.appliedBy || "",
					now,
				],
			)
			// Update bug status to fix_ready
			db.run("UPDATE bugs SET status = ?, updated_at = ? WHERE id = ?", [BugStatus.FIX_READY, now, input.bugId])
		})
		tx()

		return this._rowToFix(db.prepare("SELECT * FROM bug_fixes WHERE id = ?").get(id))
	}

	/**
	 * List fixes for a bug.
	 * @param {string} bugId
	 * @returns {Object[]}
	 */
	listFixes(bugId) {
		const db = this.memory.getDb()
		const rows = db.prepare("SELECT * FROM bug_fixes WHERE bug_id = ? ORDER BY created_at DESC").all(bugId)
		return rows.map((r) => this._rowToFix(r))
	}

	/**
	 * Get bug registry stats.
	 * @returns {Object}
	 */
	getStats() {
		const db = this.memory.getDb()
		const total = db.prepare("SELECT COUNT(*) as count FROM bugs").get().count
		const byStatus = db.prepare("SELECT status, COUNT(*) as count FROM bugs GROUP BY status").all()
		const bySeverity = db.prepare("SELECT severity, COUNT(*) as count FROM bugs GROUP BY severity").all()
		const openCount = db
			.prepare("SELECT COUNT(*) as count FROM bugs WHERE status NOT IN ('closed', 'wont_fix', 'verified')")
			.get().count
		return { total, open: openCount, byStatus, bySeverity }
	}
}

module.exports = { BugRegistry, BugStatus, BugSeverity }
