/**
 * EventLog — Append-only event log for the Cloud Orchestrator.
 * Ported from src/super-roo/events/EventLog.ts
 *
 * Provides structured event recording with filtering, pagination, and
 * severity-based queries. All events are persisted to SQLite.
 */

const crypto = require("crypto")

class EventLog {
	/**
	 * @param {import('../stores/MemoryStore')} memory - MemoryStore instance
	 */
	constructor(memory) {
		this.memory = memory
	}

	/**
	 * Record an event.
	 * @param {object} input
	 * @param {string} input.type - Event type (e.g., 'task.created', 'healing.incident')
	 * @param {string} input.source - Source module name
	 * @param {unknown} [input.payload] - Event payload (will be JSON-serialized)
	 * @param {'info'|'warning'|'error'|'critical'} [input.severity='info']
	 * @param {string} [input.taskId]
	 * @param {string} [input.sessionId]
	 * @returns {object} The recorded event
	 */
	record(input) {
		const db = this.memory.getDb()
		const id = crypto.randomUUID()
		const now = Date.now()

		const stmt = db.prepare(`
      INSERT INTO events (id, type, source, payload, severity, task_id, session_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

		stmt.run(
			id,
			input.type,
			input.source,
			JSON.stringify(input.payload !== undefined ? input.payload : {}),
			input.severity || "info",
			input.taskId || null,
			input.sessionId || null,
			now,
		)

		return {
			id,
			type: input.type,
			source: input.source,
			payload: input.payload,
			severity: input.severity || "info",
			taskId: input.taskId || null,
			sessionId: input.sessionId || null,
			createdAt: now,
		}
	}

	/**
	 * List events with optional filters.
	 * @param {object} [filter]
	 * @param {string} [filter.type]
	 * @param {string} [filter.source]
	 * @param {'info'|'warning'|'error'|'critical'} [filter.severity]
	 * @param {string} [filter.taskId]
	 * @param {string} [filter.sessionId]
	 * @param {number} [filter.limit=100]
	 * @param {number} [filter.offset=0]
	 * @param {boolean} [filter.descending=true]
	 * @returns {Array<object>}
	 */
	list(filter = {}) {
		const db = this.memory.getDb()
		const conditions = []
		const params = []

		if (filter.type) {
			conditions.push("type = ?")
			params.push(filter.type)
		}
		if (filter.source) {
			conditions.push("source = ?")
			params.push(filter.source)
		}
		if (filter.severity) {
			conditions.push("severity = ?")
			params.push(filter.severity)
		}
		if (filter.taskId) {
			conditions.push("task_id = ?")
			params.push(filter.taskId)
		}
		if (filter.sessionId) {
			conditions.push("session_id = ?")
			params.push(filter.sessionId)
		}

		const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
		const order = filter.descending !== false ? "DESC" : "ASC"
		const limit = filter.limit || 100
		const offset = filter.offset || 0

		const rows = db
			.prepare(`SELECT * FROM events ${where} ORDER BY created_at ${order} LIMIT ? OFFSET ?`)
			.all(...params, limit, offset)

		return rows.map(this._rowToEvent)
	}

	/**
	 * Get events within a time range.
	 * @param {number} startTs - Start timestamp (ms)
	 * @param {number} endTs - End timestamp (ms)
	 * @param {object} [options]
	 * @param {number} [options.limit=500]
	 * @returns {Array<object>}
	 */
	getByTimeRange(startTs, endTs, options = {}) {
		const db = this.memory.getDb()
		const limit = options.limit || 500

		const rows = db
			.prepare("SELECT * FROM events WHERE created_at >= ? AND created_at <= ? ORDER BY created_at DESC LIMIT ?")
			.all(startTs, endTs, limit)

		return rows.map(this._rowToEvent)
	}

	/**
	 * Get the count of events matching a filter.
	 * @param {object} [filter]
	 * @returns {number}
	 */
	count(filter = {}) {
		const db = this.memory.getDb()
		const conditions = []
		const params = []

		if (filter.type) {
			conditions.push("type = ?")
			params.push(filter.type)
		}
		if (filter.severity) {
			conditions.push("severity = ?")
			params.push(filter.severity)
		}
		if (filter.source) {
			conditions.push("source = ?")
			params.push(filter.source)
		}

		const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
		const row = db.prepare(`SELECT COUNT(*) as count FROM events ${where}`).get(...params)
		return row.count
	}

	/**
	 * Get severity breakdown stats.
	 * @returns {object}
	 */
	getStats() {
		const db = this.memory.getDb()
		const rows = db.prepare("SELECT severity, COUNT(*) as count FROM events GROUP BY severity").all()

		const stats = { info: 0, warning: 0, error: 0, critical: 0, total: 0 }
		for (const row of rows) {
			stats[row.severity] = row.count
			stats.total += row.count
		}
		return stats
	}

	/**
	 * Delete events older than a given timestamp.
	 * @param {number} olderThan - Timestamp in ms
	 * @returns {number} Number of deleted rows
	 */
	cleanup(olderThan) {
		const db = this.memory.getDb()
		const result = db.prepare("DELETE FROM events WHERE created_at < ?").run(olderThan)
		return result.changes
	}

	/**
	 * Convert a database row to an event object.
	 * @param {object} row
	 * @returns {object}
	 */
	_rowToEvent(row) {
		const payload = safeJsonParse(row.payload, {})
		// Map DB severity values to frontend-standard values
		let severity = row.severity
		if (severity === "warning") severity = "warn"
		if (severity === "critical") severity = "error"

		return {
			id: row.id,
			type: row.type,
			source: row.source,
			payload,
			severity,
			message: payload.message || row.type || row.source || "Event",
			taskId: row.task_id,
			sessionId: row.session_id,
			createdAt: row.created_at,
			timestamp: new Date(row.created_at).toISOString(),
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

module.exports = EventLog
