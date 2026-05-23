/**
 * TaskQueueBullMQ — Priority task queue with BullMQ bridge for the Cloud Orchestrator.
 * Ported from src/super-roo/queue/TaskQueue.ts
 *
 * Provides SQLite-backed task lifecycle management with BullMQ integration
 * for distributed worker processing. Tasks flow through:
 *   SQLite (persistence) → BullMQ (dispatch) → Worker (execution) → SQLite (result)
 */

const crypto = require("crypto")

class TaskQueueBullMQ {
	/**
	 * @param {import('../stores/MemoryStore')} memory - MemoryStore instance
	 * @param {object} [options]
	 * @param {import('bullmq').Queue} [options.bullQueue] - Optional BullMQ Queue instance
	 * @param {number} [options.defaultPriority=5] - Default priority (1=highest, 10=lowest)
	 */
	constructor(memory, options = {}) {
		this.memory = memory
		this.bullQueue = options.bullQueue || null
		this.defaultPriority = options.defaultPriority || 5
	}

	/**
	 * Set the BullMQ Queue instance (called after construction when Redis is available).
	 * @param {import('bullmq').Queue} queue
	 */
	setBullQueue(queue) {
		this.bullQueue = queue
	}

	/**
	 * Add a task to the queue.
	 * @param {object} input
	 * @param {string} input.type - Task type (e.g., 'code', 'debug', 'deploy')
	 * @param {unknown} input.input - Task input data
	 * @param {number} [input.priority] - Priority (1=highest, 10=lowest)
	 * @param {string} [input.agent] - Preferred agent
	 * @param {string} [input.sessionId]
	 * @param {string} [input.parentTaskId]
	 * @param {object} [input.metadata]
	 * @returns {object} The created task
	 */
	add(input) {
		const db = this.memory.getDb()
		const id = crypto.randomUUID()
		const now = Date.now()
		const priority = input.priority !== undefined ? input.priority : this.defaultPriority

		const stmt = db.prepare(`
      INSERT INTO tasks (id, type, status, priority, input, agent, session_id, parent_task_id, metadata, created_at, updated_at)
      VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)
    `)

		stmt.run(
			id,
			input.type,
			priority,
			JSON.stringify(input.input),
			input.agent || null,
			input.sessionId || null,
			input.parentTaskId || null,
			JSON.stringify(input.metadata || {}),
			now,
			now,
		)

		// Dispatch to BullMQ if available
		if (this.bullQueue) {
			this._dispatchToBull(id, input, priority).catch((err) => {
				console.error(`[TaskQueueBullMQ] BullMQ dispatch failed for task ${id}:`, err.message)
			})
		}

		return {
			id,
			type: input.type,
			status: "pending",
			priority,
			input: input.input,
			agent: input.agent || null,
			sessionId: input.sessionId || null,
			parentTaskId: input.parentTaskId || null,
			metadata: input.metadata || {},
			createdAt: now,
			updatedAt: now,
		}
	}

	/**
	 * Dispatch a task to BullMQ for worker processing.
	 * @param {string} taskId
	 * @param {object} input
	 * @param {number} priority
	 */
	async _dispatchToBull(taskId, input, priority) {
		if (!this.bullQueue) return

		await this.bullQueue.add(
			input.type,
			{
				taskId,
				type: input.type,
				input: input.input,
				agent: input.agent,
				sessionId: input.sessionId,
				parentTaskId: input.parentTaskId,
				metadata: input.metadata,
			},
			{
				jobId: taskId,
				priority: Math.max(1, Math.min(10, priority)),
				attempts: 3,
				backoff: {
					type: "exponential",
					delay: 2000,
				},
				removeOnComplete: 100,
				removeOnFail: 50,
			},
		)
	}

	/**
	 * Get a task by ID.
	 * @param {string} id
	 * @returns {object|null}
	 */
	get(id) {
		const db = this.memory.getDb()
		const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id)
		return row ? this._rowToTask(row) : null
	}

	/**
	 * Update a task's status and output.
	 * @param {string} id
	 * @param {object} patch
	 * @param {string} [patch.status]
	 * @param {unknown} [patch.output]
	 * @param {string} [patch.error]
	 * @param {string} [patch.agent]
	 * @returns {object|null}
	 */
	update(id, patch) {
		const db = this.memory.getDb()
		const now = Date.now()
		const sets = ["updated_at = ?"]
		const params = [now]

		if (patch.status) {
			sets.push("status = ?")
			params.push(patch.status)
		}
		if (patch.output !== undefined) {
			sets.push("output = ?")
			params.push(JSON.stringify(patch.output))
		}
		if (patch.error !== undefined) {
			sets.push("error = ?")
			params.push(patch.error)
		}
		if (patch.agent) {
			sets.push("agent = ?")
			params.push(patch.agent)
		}
		if (patch.status === "running" && !patch.startedAt) {
			sets.push("started_at = ?")
			params.push(now)
		}
		if (patch.status === "completed" || patch.status === "failed") {
			sets.push("completed_at = ?")
			params.push(now)
		}

		params.push(id)
		db.prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`).run(...params)

		return this.get(id)
	}

	/**
	 * List tasks with optional filters.
	 * @param {object} [filter]
	 * @param {string} [filter.status]
	 * @param {string} [filter.type]
	 * @param {string} [filter.agent]
	 * @param {string} [filter.sessionId]
	 * @param {number} [filter.limit=50]
	 * @param {number} [filter.offset=0]
	 * @returns {Array<object>}
	 */
	list(filter = {}) {
		const db = this.memory.getDb()
		const conditions = []
		const params = []

		if (filter.status) {
			conditions.push("status = ?")
			params.push(filter.status)
		}
		if (filter.type) {
			conditions.push("type = ?")
			params.push(filter.type)
		}
		if (filter.agent) {
			conditions.push("agent = ?")
			params.push(filter.agent)
		}
		if (filter.sessionId) {
			conditions.push("session_id = ?")
			params.push(filter.sessionId)
		}

		const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
		const limit = filter.limit || 50
		const offset = filter.offset || 0

		const rows = db
			.prepare(`SELECT * FROM tasks ${where} ORDER BY priority ASC, created_at DESC LIMIT ? OFFSET ?`)
			.all(...params, limit, offset)

		return rows.map(this._rowToTask)
	}

	/**
	 * Get the next pending task by priority (oldest first, highest priority).
	 * @returns {object|null}
	 */
	nextPending() {
		const db = this.memory.getDb()
		const row = db
			.prepare("SELECT * FROM tasks WHERE status = 'pending' ORDER BY priority ASC, created_at ASC LIMIT 1")
			.get()
		return row ? this._rowToTask(row) : null
	}

	/**
	 * Atomically claim the next pending task for a given worker.
	 *
	 * Uses a single `UPDATE ... RETURNING *` statement to prevent the
	 * race condition inherent in the two-statement nextPending() + update()
	 * pattern. Only tasks with status = 'pending' and no worker_id are
	 * eligible. The caller's worker_id is written atomically, making the
	 * claim visible to all other workers.
	 *
	 * better-sqlite3 supports RETURNING * natively (SQLite 3.35+).
	 *
	 * @param {string} workerId - Unique identifier for the claiming worker
	 * @param {string[]} [typeFilter] - Optional list of task types to claim (e.g. ['coding', 'debug'])
	 * @returns {object|null} The claimed task, or null if no pending task
	 */
	claimNext(workerId, typeFilter = null) {
		const db = this.memory.getDb()
		let sql
		if (typeFilter && typeFilter.length > 0) {
			const placeholders = typeFilter.map(() => "?").join(",")
			sql = `
				UPDATE tasks
				SET status = 'running', worker_id = ?, started_at = ?, updated_at = ?
				WHERE id = (
					SELECT id FROM tasks
					WHERE status = 'pending' AND worker_id IS NULL AND type IN (${placeholders})
					ORDER BY priority ASC, created_at ASC
					LIMIT 1
				)
				RETURNING *
			`
			const row = db.prepare(sql).get(workerId, Date.now(), Date.now(), ...typeFilter)
			return row ? this._rowToTask(row) : null
		}
		sql = `
			UPDATE tasks
			SET status = 'running', worker_id = ?, started_at = ?, updated_at = ?
			WHERE id = (
				SELECT id FROM tasks
				WHERE status = 'pending' AND worker_id IS NULL
				ORDER BY priority ASC, created_at ASC
				LIMIT 1
			)
			RETURNING *
		`
		const row = db.prepare(sql).get(workerId, Date.now(), Date.now())
		return row ? this._rowToTask(row) : null
	}

	/**
	 * Get queue statistics.
	 * @returns {object}
	 */
	getStats() {
		const db = this.memory.getDb()
		const rows = db.prepare("SELECT status, COUNT(*) as count FROM tasks GROUP BY status").all()

		const stats = { pending: 0, running: 0, completed: 0, failed: 0, cancelled: 0, total: 0 }
		for (const row of rows) {
			if (stats[row.status] !== undefined) {
				stats[row.status] = row.count
			}
			stats.total += row.count
		}
		return stats
	}

	/**
	 * Cancel a task.
	 * @param {string} id
	 * @returns {boolean}
	 */
	cancel(id) {
		const result = this.update(id, { status: "cancelled" })
		return result !== null
	}

	/**
	 * Clean up old completed/failed tasks.
	 * @param {number} olderThan - Timestamp in ms
	 * @returns {number} Number of deleted rows
	 */
	cleanup(olderThan) {
		const db = this.memory.getDb()
		const result = db
			.prepare("DELETE FROM tasks WHERE (status = 'completed' OR status = 'failed') AND completed_at < ?")
			.run(olderThan)
		return result.changes
	}

	/**
	 * Convert a database row to a task object.
	 * @param {object} row
	 * @returns {object}
	 */
	_rowToTask(row) {
		return {
			id: row.id,
			type: row.type,
			status: row.status,
			priority: row.priority,
			input: safeJsonParse(row.input, {}),
			output: row.output ? safeJsonParse(row.output, null) : null,
			error: row.error || null,
			agent: row.agent || null,
			sessionId: row.session_id || null,
			parentTaskId: row.parent_task_id || null,
			metadata: safeJsonParse(row.metadata, {}),
			createdAt: row.created_at,
			updatedAt: row.updated_at,
			startedAt: row.started_at || null,
			completedAt: row.completed_at || null,
			workerId: row.worker_id || null,
		}
	}
}

function safeJsonParse(str, fallback) {
	try {
		return JSON.parse(str)
	} catch {
		return fallback
	}
}

module.exports = TaskQueueBullMQ
