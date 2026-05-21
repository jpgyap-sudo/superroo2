/**
 * QueueManager — Shared base class for queue-based orchestrators.
 *
 * Eliminates the duplicated queue pattern between DeployOrchestrator and
 * GlobalBuildOrchestrator. Provides:
 *
 * 1. Unified RAM state checking (single endpoint, configurable thresholds)
 * 2. Concurrent operation limiting (per-project or global)
 * 3. SQLite-backed queue with insert/dequeue/process lifecycle
 * 4. Event emission for queue lifecycle events
 * 5. Cross-orchestrator awareness (build ↔ deploy coordination)
 * 6. Database helper methods (_query, _run, _getOne, _getDb)
 */

const crypto = require("crypto")

// ── Constants ────────────────────────────────────────────────────────────────

const RAM_STATE = Object.freeze({
	NORMAL: "normal",
	WARNING: "warning",
	DANGER: "danger",
	CRITICAL: "critical",
})

const QUEUE_PRIORITY = Object.freeze({
	LOW: 0,
	NORMAL: 1,
	HIGH: 2,
	CRITICAL: 3,
})

// ── Helpers ──────────────────────────────────────────────────────────────────

function safeJsonParse(str, fallback) {
	if (!str) return fallback
	try {
		return JSON.parse(str)
	} catch {
		return fallback
	}
}

function now() {
	return Date.now()
}

// ── QueueManager ─────────────────────────────────────────────────────────────

class QueueManager {
	/**
	 * @param {object} opts
	 * @param {object} opts.memory - MemoryStore instance for SQLite persistence
	 * @param {object} opts.eventLog - EventLog instance
	 * @param {string} [opts.name='queue-manager'] - Instance name (for logging/events)
	 * @param {string} [opts.queueTable='queue_manager_tasks'] - SQLite table name for queue
	 * @param {number} [opts.maxConcurrent=1] - Max concurrent operations
	 * @param {boolean} [opts.perProjectConcurrency=false] - If true, concurrency is per-project
	 * @param {string} [opts.ramOrchestratorUrl='http://127.0.0.1:3456'] - RAM orchestrator URL
	 * @param {number} [opts.ramCheckTimeoutMs=3000] - RAM check timeout
	 * @param {number} [opts.maxRamPercent=80] - Max RAM % before deferring
	 * @param {string[]} [opts.ramDeferOnStates] - RAM states that trigger deferral
	 * @param {object} [opts.siblingOrchestrators] - Map of name -> orchestrator for cross-awareness
	 */
	constructor(opts) {
		this.memory = opts.memory
		this.eventLog = opts.eventLog
		this.name = opts.name || "queue-manager"
		this.queueTable = opts.queueTable || "queue_manager_tasks"
		this.maxConcurrent = opts.maxConcurrent || 1
		this.perProjectConcurrency = opts.perProjectConcurrency || false

		// RAM orchestrator config
		this.ramOrchestratorUrl = opts.ramOrchestratorUrl || "http://127.0.0.1:3456"
		this.ramCheckTimeoutMs = opts.ramCheckTimeoutMs || 3000
		this.maxRamPercent = opts.maxRamPercent || 80
		this.ramDeferOnStates = opts.ramDeferOnStates || null // null = use percentage-based

		// Cross-orchestrator awareness
		this.siblingOrchestrators = opts.siblingOrchestrators || {} // { name: orchestratorInstance }

		// In-memory active tracking (fast lookup, SQLite is source of truth)
		this._activeOperations = new Map() // projectName -> operationId (if perProject) or operationId -> true (if global)
		this._initialized = false
	}

	/**
	 * Initialize SQLite table.
	 */
	async initialize() {
		if (this._initialized) return
		if (!this.memory) return

		const db = await this.memory.getDb()

		await db.exec(`
			CREATE TABLE IF NOT EXISTS ${this.queueTable} (
				id TEXT PRIMARY KEY,
				project_name TEXT,
				operation_type TEXT NOT NULL DEFAULT 'generic',
				priority INTEGER NOT NULL DEFAULT ${QUEUE_PRIORITY.NORMAL},
				status TEXT NOT NULL DEFAULT 'pending',
				input TEXT,
				agent TEXT,
				agent_source TEXT,
				description TEXT,
				output TEXT,
				error TEXT,
				metadata TEXT,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL,
				started_at INTEGER,
				completed_at INTEGER
			)
		`)

		await db.exec(`
			CREATE INDEX IF NOT EXISTS idx_${this.queueTable}_status ON ${this.queueTable} (status)
		`)

		await db.exec(`
			CREATE INDEX IF NOT EXISTS idx_${this.queueTable}_project ON ${this.queueTable} (project_name)
		`)

		this._initialized = true
	}

	// ── Database helpers ───────────────────────────────────────────────────

	async _getDb() {
		if (!this.memory) return null
		return this.memory.getDb()
	}

	async _query(sql, params = []) {
		const db = await this._getDb()
		if (!db) return []
		return db.all(sql, params)
	}

	async _run(sql, params = []) {
		const db = await this._getDb()
		if (!db) return
		return db.run(sql, params)
	}

	async _getOne(sql, params = []) {
		const db = await this._getDb()
		if (!db) return null
		return db.get(sql, params)
	}

	// ── Event emission ────────────────────────────────────────────────────

	async _emitEvent(type, payload, severity = "info") {
		if (!this.eventLog) return
		try {
			await this.eventLog.record({
				type: `${this.name}.${type}`,
				severity,
				source: this.name,
				payload,
				timestamp: new Date().toISOString(),
			})
		} catch {
			// EventLog failure is non-fatal
		}
	}

	// ── Unified RAM state check ────────────────────────────────────────────

	/**
	 * Check RAM orchestrator health before queuing operations.
	 *
	 * Supports two modes:
	 * 1. State-based (ramDeferOnStates set): defers if RAM state is in the defer list
	 * 2. Percentage-based (ramDeferOnStates null): defers if RAM % exceeds maxRamPercent
	 *
	 * Falls back to sibling orchestrators if primary RAM orchestrator is unreachable.
	 *
	 * @returns {Promise<{ok: boolean, state?: string, ramPercent?: number}>}
	 */
	async _checkRamState() {
		const timeoutMs = this.ramCheckTimeoutMs
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), timeoutMs)

		try {
			const res = await fetch(`${this.ramOrchestratorUrl}/health`, {
				signal: controller.signal,
				timeout: timeoutMs,
			})
			clearTimeout(timer)

			if (!res.ok) {
				// RAM orchestrator unreachable — allow operation (fail open)
				return { ok: true }
			}

			const data = await res.json()
			const ramPercent = data.ram?.percentUsed || data.ramPercent || 0
			const state = data.ramState || RAM_STATE.NORMAL

			// State-based deferral
			if (this.ramDeferOnStates && this.ramDeferOnStates.includes(state)) {
				return { ok: false, state, ramPercent }
			}

			// Percentage-based deferral
			if (!this.ramDeferOnStates && ramPercent >= this.maxRamPercent) {
				return { ok: false, state: RAM_STATE.WARNING, ramPercent }
			}

			return { ok: true, state, ramPercent }
		} catch (err) {
			clearTimeout(timer)
			// RAM orchestrator unreachable — try sibling orchestrators
			for (const [name, sibling] of Object.entries(this.siblingOrchestrators)) {
				if (typeof sibling._checkRamState === "function") {
					try {
						const result = await sibling._checkRamState()
						if (!result.ok) return result
					} catch {
						continue
					}
				}
			}
			// All fallbacks failed — allow operation (fail open)
			return { ok: true }
		}
	}

	// ── Cross-orchestrator awareness ──────────────────────────────────────

	/**
	 * Check if any sibling orchestrator has active operations.
	 * This prevents builds from starting while deploys are running (and vice versa).
	 *
	 * @returns {Promise<{blocked: boolean, blockedBy?: string, details?: object}>}
	 */
	async _checkSiblingActivity() {
		const blockers = []

		for (const [name, sibling] of Object.entries(this.siblingOrchestrators)) {
			// Check active operations map (managed by QueueManager.markStarted/markCompleted)
			if (sibling._activeOperations && sibling._activeOperations.size > 0) {
				blockers.push({
					orchestrator: name,
					activeCount: sibling._activeOperations.size,
					operations: Array.from(sibling._activeOperations.entries()).map(([k, v]) => ({
						key: k,
						id: v,
					})),
				})
			}
		}

		if (blockers.length > 0) {
			return { blocked: true, blockedBy: blockers.map((b) => b.orchestrator).join(", "), details: blockers }
		}

		return { blocked: false }
	}

	// ── Queue management ──────────────────────────────────────────────────

	/**
	 * Insert an operation into the queue.
	 *
	 * @param {object} opts
	 * @param {string} [opts.projectName] - Project name (for per-project scoping)
	 * @param {string} [opts.operationType='generic'] - Type of operation
	 * @param {number} [opts.priority=QUEUE_PRIORITY.NORMAL] - Priority
	 * @param {object} [opts.input] - Input data for the operation
	 * @param {string} [opts.agent='unknown'] - Agent name
	 * @param {string} [opts.agentSource] - Agent source (claude, codex, etc.)
	 * @param {string} [opts.description] - Human-readable description
	 * @param {object} [opts.metadata] - Additional metadata
	 * @returns {Promise<{id: string, queued: boolean, reason?: string}>}
	 */
	async enqueue(opts) {
		await this.initialize()

		const {
			projectName,
			operationType = "generic",
			priority = QUEUE_PRIORITY.NORMAL,
			input = {},
			agent = "unknown",
			agentSource,
			description = "",
			metadata = {},
		} = opts

		const id = crypto.randomUUID()

		// Step 1: Check RAM state
		const ramCheck = await this._checkRamState()
		if (!ramCheck.ok) {
			await this._run(
				`INSERT INTO ${this.queueTable} (id, project_name, operation_type, priority, status, input, agent, agent_source, description, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					id,
					projectName || null,
					operationType,
					priority,
					"pending",
					JSON.stringify(input),
					agent,
					agentSource || null,
					description || null,
					JSON.stringify({
						...metadata,
						queuedReason: `RAM at ${ramCheck.ramPercent || "?"}% (limit: ${this.maxRamPercent}%)`,
					}),
					now(),
					now(),
				],
			)

			await this._emitEvent(
				"queued.ram",
				{
					operationId: id,
					project: projectName,
					type: operationType,
					agent,
					ramPercent: ramCheck.ramPercent,
					reason: `RAM state: ${ramCheck.state}`,
				},
				"warning",
			)

			return { id, queued: true, reason: `RAM at ${ramCheck.ramPercent}% — operation queued` }
		}

		// Step 2: Check sibling orchestrator activity (cross-awareness)
		const siblingCheck = await this._checkSiblingActivity()
		if (siblingCheck.blocked) {
			await this._run(
				`INSERT INTO ${this.queueTable} (id, project_name, operation_type, priority, status, input, agent, agent_source, description, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					id,
					projectName || null,
					operationType,
					priority,
					"pending",
					JSON.stringify(input),
					agent,
					agentSource || null,
					description || null,
					JSON.stringify({ ...metadata, queuedReason: `Blocked by sibling: ${siblingCheck.blockedBy}` }),
					now(),
					now(),
				],
			)

			await this._emitEvent(
				"queued.sibling",
				{
					operationId: id,
					project: projectName,
					type: operationType,
					agent,
					blockedBy: siblingCheck.blockedBy,
				},
				"info",
			)

			return { id, queued: true, reason: `Blocked by sibling orchestrator: ${siblingCheck.blockedBy}` }
		}

		// Step 3: Check concurrent operation limit
		const activeKey = this.perProjectConcurrency ? projectName : "_global"
		const activeCount = this.perProjectConcurrency
			? this._activeOperations.has(activeKey)
				? 1
				: 0
			: this._activeOperations.size

		if (activeCount >= this.maxConcurrent) {
			await this._run(
				`INSERT INTO ${this.queueTable} (id, project_name, operation_type, priority, status, input, agent, agent_source, description, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					id,
					projectName || null,
					operationType,
					priority,
					"pending",
					JSON.stringify(input),
					agent,
					agentSource || null,
					description || null,
					JSON.stringify({ ...metadata, queuedReason: `Max concurrent (${this.maxConcurrent}) reached` }),
					now(),
					now(),
				],
			)

			await this._emitEvent(
				"queued.concurrent",
				{
					operationId: id,
					project: projectName,
					type: operationType,
					agent,
					activeCount,
					maxConcurrent: this.maxConcurrent,
				},
				"info",
			)

			return { id, queued: true, reason: `Max concurrent operations (${this.maxConcurrent}) reached` }
		}

		// Not queued — ready for immediate execution
		return { id, queued: false }
	}

	/**
	 * Mark an operation as started (update status + started_at).
	 *
	 * @param {string} id - Operation ID
	 * @param {object} [opts]
	 * @param {string} [opts.projectName] - Project name (for active tracking)
	 */
	async markStarted(id, opts = {}) {
		const { projectName } = opts

		await this._run(`UPDATE ${this.queueTable} SET status = ?, started_at = ?, updated_at = ? WHERE id = ?`, [
			"running",
			now(),
			now(),
			id,
		])

		// Track in active operations
		if (this.perProjectConcurrency && projectName) {
			this._activeOperations.set(projectName, id)
		} else {
			this._activeOperations.set(id, true)
		}
	}

	/**
	 * Mark an operation as completed (success or failure).
	 *
	 * @param {string} id - Operation ID
	 * @param {object} opts
	 * @param {string} opts.status - 'success' | 'failed' | 'cancelled'
	 * @param {string} [opts.output] - Operation output
	 * @param {string} [opts.error] - Error message
	 * @param {string} [opts.projectName] - Project name (for active tracking cleanup)
	 */
	async markCompleted(id, opts) {
		const { status, output, error, projectName } = opts

		await this._run(
			`UPDATE ${this.queueTable} SET status = ?, output = ?, error = ?, updated_at = ?, completed_at = ? WHERE id = ?`,
			[status, output || null, error || null, now(), now(), id],
		)

		// Remove from active tracking
		if (this.perProjectConcurrency && projectName) {
			this._activeOperations.delete(projectName)
		} else {
			this._activeOperations.delete(id)
		}

		await this._emitEvent(
			"completed",
			{
				operationId: id,
				status,
				error,
			},
			status === "success" ? "info" : "error",
		)

		// Process next queued operation
		await this._processQueue()
	}

	/**
	 * Process the next queued operation.
	 * Subclasses should override _executeQueuedOperation() to provide custom execution logic.
	 */
	async _processQueue() {
		// Check RAM before dequeuing
		const ramCheck = await this._checkRamState()
		if (!ramCheck.ok) return

		// Check sibling activity
		const siblingCheck = await this._checkSiblingActivity()
		if (siblingCheck.blocked) return

		// Check concurrent limit
		if (this._activeOperations.size >= this.maxConcurrent) return

		const nextItem = await this._getOne(
			`SELECT * FROM ${this.queueTable} WHERE status = 'pending' ORDER BY priority DESC, created_at ASC LIMIT 1`,
		)

		if (!nextItem) return

		await this._emitEvent(
			"dequeued",
			{
				operationId: nextItem.id,
				project: nextItem.project_name,
				type: nextItem.operation_type,
			},
			"info",
		)

		// Execute the queued operation via subclass hook
		await this._executeQueuedOperation(nextItem)
	}

	/**
	 * Hook for subclasses to implement custom queued operation execution.
	 * Override this in DeployOrchestrator and GlobalBuildOrchestrator.
	 *
	 * @param {object} queueItem - The queued item from SQLite
	 * @protected
	 */
	async _executeQueuedOperation(queueItem) {
		// Default: just mark as running and complete immediately
		// Subclasses should override this
		await this.markStarted(queueItem.id, { projectName: queueItem.project_name })
		await this.markCompleted(queueItem.id, {
			status: "success",
			projectName: queueItem.project_name,
		})
	}

	// ── Queue query methods ───────────────────────────────────────────────

	/**
	 * Get queued operations.
	 * @param {object} [filter]
	 * @param {string} [filter.projectName]
	 * @param {string} [filter.status]
	 * @param {string} [filter.operationType]
	 * @param {number} [filter.limit=50]
	 * @param {number} [filter.offset=0]
	 * @returns {Promise<Array>}
	 */
	async getQueue(filter = {}) {
		await this.initialize()

		const { projectName, status, operationType, limit = 50, offset = 0 } = filter

		let sql = `SELECT * FROM ${this.queueTable} WHERE 1=1`
		const params = []

		if (projectName) {
			sql += " AND project_name = ?"
			params.push(projectName)
		}

		if (status) {
			sql += " AND status = ?"
			params.push(status)
		}

		if (operationType) {
			sql += " AND operation_type = ?"
			params.push(operationType)
		}

		sql += " ORDER BY priority DESC, created_at ASC LIMIT ? OFFSET ?"
		params.push(limit, offset)

		const rows = await this._query(sql, params)
		return rows.map((r) => ({
			id: r.id,
			projectName: r.project_name,
			operationType: r.operation_type,
			priority: r.priority,
			status: r.status,
			input: safeJsonParse(r.input, {}),
			agent: r.agent,
			agentSource: r.agent_source,
			description: r.description,
			output: r.output,
			error: r.error,
			metadata: safeJsonParse(r.metadata, {}),
			createdAt: r.created_at,
			updatedAt: r.updated_at,
			startedAt: r.started_at,
			completedAt: r.completed_at,
		}))
	}

	/**
	 * Get active operations.
	 * @returns {Promise<Array>}
	 */
	async getActiveOperations() {
		return this.getQueue({ status: "running" })
	}

	/**
	 * Get pending (queued) operations.
	 * @returns {Promise<Array>}
	 */
	async getPendingOperations() {
		return this.getQueue({ status: "pending" })
	}

	/**
	 * Get queue statistics.
	 * @returns {Promise<object>}
	 */
	async getStats() {
		await this.initialize()

		const total = await this._getOne(`SELECT COUNT(*) as count FROM ${this.queueTable}`)

		const byStatus = await this._query(`SELECT status, COUNT(*) as count FROM ${this.queueTable} GROUP BY status`)

		const byType = await this._query(
			`SELECT operation_type, COUNT(*) as count FROM ${this.queueTable} GROUP BY operation_type`,
		)

		const byProject = await this._query(
			`SELECT project_name, COUNT(*) as count FROM ${this.queueTable} WHERE project_name IS NOT NULL GROUP BY project_name ORDER BY count DESC LIMIT 10`,
		)

		const statusMap = {}
		for (const row of byStatus) {
			statusMap[row.status] = row.count
		}

		const typeMap = {}
		for (const row of byType) {
			typeMap[row.operation_type] = row.count
		}

		const projectMap = {}
		for (const row of byProject) {
			projectMap[row.project_name] = row.count
		}

		return {
			total: total?.count || 0,
			byStatus: statusMap,
			byType: typeMap,
			byProject: projectMap,
			activeCount: this._activeOperations.size,
			maxConcurrent: this.maxConcurrent,
			maxRamPercent: this.maxRamPercent,
			perProjectConcurrency: this.perProjectConcurrency,
		}
	}

	/**
	 * Cancel a queued or running operation.
	 * @param {string} operationId
	 * @returns {Promise<{success: boolean, error?: string}>}
	 */
	async cancelOperation(operationId) {
		await this.initialize()

		const item = await this._getOne(`SELECT * FROM ${this.queueTable} WHERE id = ?`, [operationId])

		if (!item) {
			return { success: false, error: "Operation not found" }
		}

		if (item.status === "success" || item.status === "failed") {
			return { success: false, error: `Cannot cancel operation with status: ${item.status}` }
		}

		await this._run(
			`UPDATE ${this.queueTable} SET status = 'cancelled', updated_at = ?, completed_at = ? WHERE id = ?`,
			[now(), now(), operationId],
		)

		// Remove from active tracking
		if (this.perProjectConcurrency && item.project_name) {
			this._activeOperations.delete(item.project_name)
		} else {
			this._activeOperations.delete(operationId)
		}

		await this._emitEvent(
			"cancelled",
			{
				operationId,
				project: item.project_name,
				type: item.operation_type,
				agent: item.agent,
			},
			"warning",
		)

		// Process next queued operation
		await this._processQueue()

		return { success: true }
	}
}

module.exports = { QueueManager, RAM_STATE, QUEUE_PRIORITY, safeJsonParse, now }
