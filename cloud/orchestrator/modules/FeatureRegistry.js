/**
 * Cloud Orchestrator — Feature Registry.
 *
 * Tracks product features, their health status, and ownership.
 * Ported from src/super-roo/features/FeatureRegistry.ts for the cloud runtime.
 *
 * Uses the MemoryStore (SQLite) for persistence.
 */

// ─── Constants ──────────────────────────────────────────────────────────────

const FeatureStatus = Object.freeze({
	ACTIVE: "active",
	DEPRECATED: "deprecated",
	REMOVED: "removed",
})

const FeatureHealth = Object.freeze({
	HEALTHY: "healthy",
	DEGRADED: "degraded",
	UNHEALTHY: "unhealthy",
	UNKNOWN: "unknown",
})

class FeatureRegistry {
	/**
	 * @param {Object} opts
	 * @param {Object} opts.memoryStore - MemoryStore instance (SQLite).
	 */
	constructor(opts = {}) {
		if (!opts.memoryStore) {
			throw new Error("FeatureRegistry requires a memoryStore")
		}
		this.memory = opts.memoryStore
		this._initialized = false
	}

	async initialize() {
		if (this._initialized) return
		this._initialized = true
		// Table is created by schema.sql; ensure it exists
		const db = this.memory.getDb()
		db.exec(`
			CREATE TABLE IF NOT EXISTS features (
				id TEXT PRIMARY KEY,
				name TEXT NOT NULL UNIQUE,
				description TEXT DEFAULT '',
				status TEXT DEFAULT 'active',
				health TEXT DEFAULT 'unknown',
				owner TEXT DEFAULT '',
				module_path TEXT DEFAULT '',
				dependencies TEXT DEFAULT '[]',
				metadata TEXT DEFAULT '{}',
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			)
		`)
		console.log("[orchestrator/feature-registry] Initialized")
	}

	// ── Helpers ───────────────────────────────────────────────────────────

	_rowToFeature(r) {
		return {
			id: r.id,
			name: r.name,
			description: r.description || "",
			status: r.status,
			health: r.health,
			owner: r.owner || "",
			modulePath: r.module_path || "",
			dependencies: this._safeJsonParse(r.dependencies, []),
			metadata: this._safeJsonParse(r.metadata, {}),
			createdAt: r.created_at,
			updatedAt: r.updated_at,
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
		return "feat-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8)
	}

	// ── CRUD ──────────────────────────────────────────────────────────────

	/**
	 * Create a new feature.
	 * @param {Object} input
	 * @param {string} input.name
	 * @param {string} [input.description]
	 * @param {string} [input.status="active"]
	 * @param {string} [input.health="unknown"]
	 * @param {string} [input.owner]
	 * @param {string} [input.modulePath]
	 * @param {string[]} [input.dependencies]
	 * @param {Object} [input.metadata]
	 * @returns {Object}
	 */
	create(input) {
		const now = Date.now()
		const id = this._generateId()
		const db = this.memory.getDb()
		db.run(
			`INSERT INTO features (id, name, description, status, health, owner, module_path, dependencies, metadata, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				id,
				input.name,
				input.description || "",
				input.status || FeatureStatus.ACTIVE,
				input.health || FeatureHealth.UNKNOWN,
				input.owner || "",
				input.modulePath || "",
				JSON.stringify(input.dependencies || []),
				JSON.stringify(input.metadata || {}),
				now,
				now,
			],
		)
		return this.get(id)
	}

	/**
	 * Get a feature by ID.
	 * @param {string} id
	 * @returns {Object|null}
	 */
	get(id) {
		const db = this.memory.getDb()
		const row = db.prepare("SELECT * FROM features WHERE id = ?").get(id)
		return row ? this._rowToFeature(row) : null
	}

	/**
	 * Get a feature by name.
	 * @param {string} name
	 * @returns {Object|null}
	 */
	getByName(name) {
		const db = this.memory.getDb()
		const row = db.prepare("SELECT * FROM features WHERE name = ?").get(name)
		return row ? this._rowToFeature(row) : null
	}

	/**
	 * List features with optional filters.
	 * @param {Object} [filter]
	 * @param {string} [filter.status]
	 * @param {string} [filter.health]
	 * @returns {Object[]}
	 */
	list(filter = {}) {
		const db = this.memory.getDb()
		let sql = "SELECT * FROM features WHERE 1=1"
		const params = []
		if (filter.status) {
			sql += " AND status = ?"
			params.push(filter.status)
		}
		if (filter.health) {
			sql += " AND health = ?"
			params.push(filter.health)
		}
		sql += " ORDER BY name ASC"
		const rows = db.prepare(sql).all(...params)
		return rows.map((r) => this._rowToFeature(r))
	}

	/**
	 * Update a feature.
	 * @param {string} id
	 * @param {Object} patch
	 * @returns {Object|null} The updated feature, or null if not found.
	 */
	update(id, patch) {
		const existing = this.get(id)
		if (!existing) return null

		const now = Date.now()
		const db = this.memory.getDb()
		const fields = []
		const params = []

		if (patch.name !== undefined) {
			fields.push("name = ?")
			params.push(patch.name)
		}
		if (patch.description !== undefined) {
			fields.push("description = ?")
			params.push(patch.description)
		}
		if (patch.status !== undefined) {
			fields.push("status = ?")
			params.push(patch.status)
		}
		if (patch.health !== undefined) {
			fields.push("health = ?")
			params.push(patch.health)
		}
		if (patch.owner !== undefined) {
			fields.push("owner = ?")
			params.push(patch.owner)
		}
		if (patch.modulePath !== undefined) {
			fields.push("module_path = ?")
			params.push(patch.modulePath)
		}
		if (patch.dependencies !== undefined) {
			fields.push("dependencies = ?")
			params.push(JSON.stringify(patch.dependencies))
		}
		if (patch.metadata !== undefined) {
			fields.push("metadata = ?")
			params.push(JSON.stringify(patch.metadata))
		}

		if (fields.length === 0) return existing

		fields.push("updated_at = ?")
		params.push(now)
		params.push(id)

		db.run(`UPDATE features SET ${fields.join(", ")} WHERE id = ?`, params)
		return this.get(id)
	}

	/**
	 * Delete a feature by ID.
	 * @param {string} id
	 * @returns {boolean}
	 */
	delete(id) {
		const db = this.memory.getDb()
		const result = db.run("DELETE FROM features WHERE id = ?", [id])
		return result.changes > 0
	}

	/**
	 * Get feature registry stats.
	 * @returns {Object}
	 */
	getStats() {
		const db = this.memory.getDb()
		const total = db.prepare("SELECT COUNT(*) as count FROM features").get().count
		const byStatus = db.prepare("SELECT status, COUNT(*) as count FROM features GROUP BY status").all()
		const byHealth = db.prepare("SELECT health, COUNT(*) as count FROM features GROUP BY health").all()
		return { total, byStatus, byHealth }
	}
}

module.exports = { FeatureRegistry, FeatureStatus, FeatureHealth }
