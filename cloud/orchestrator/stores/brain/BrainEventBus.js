/**
 * BrainEventBus — Redis Pub/Sub + Postgres event log for Central Brain
 *
 * Features:
 * - Redis Pub/Sub for real-time event broadcasting (dashboard WebSocket updates)
 * - Postgres persistence for event history
 * - Event types: memory.created, memory.recall, memory.merged, memory.approval_required,
 *   memory.agent_completed, memory.agent_failed, memory.decay_applied
 * - Automatic cleanup of old events (configurable TTL)
 */

const crypto = require("crypto")

const DEFAULT_EVENT_TTL_DAYS = 90

class BrainEventBus {
	/**
	 * @param {import('./MemoryService')} memoryService
	 * @param {object} [redisClient] - Optional ioredis client for Pub/Sub
	 * @param {object} [options]
	 * @param {number} [options.eventTtlDays=90]
	 * @param {function} [options.onEvent] - Optional callback for real-time events
	 */
	constructor(memoryService, redisClient = null, options = {}) {
		this.memoryService = memoryService
		this.redis = redisClient
		this.eventTtlDays = options.eventTtlDays || DEFAULT_EVENT_TTL_DAYS
		this.onEvent = options.onEvent || null
		this._subscribed = false
	}

	/**
	 * Emit a brain event — persists to Postgres and publishes to Redis.
	 *
	 * @param {string} projectId
	 * @param {string} eventType - One of the supported event types
	 * @param {object} payload - Event payload data
	 * @param {string} [actor='system'] - Who/what triggered the event
	 * @returns {Promise<object>} The created event record
	 */
	async emit(projectId, eventType, payload, actor = "system") {
		const id = crypto.randomUUID()
		const event = {
			id,
			project_id: projectId,
			event_type: eventType,
			actor,
			payload: JSON.stringify(payload || {}),
			created_at: new Date().toISOString(),
		}

		try {
			// Persist to Postgres
			await this.memoryService.query(
				`INSERT INTO brain_events (id, project_id, event_type, actor, payload)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
				[event.id, event.project_id, event.event_type, event.actor, event.payload],
			)
		} catch (err) {
			// Non-critical: don't throw if event logging fails
			console.error(`[BrainEventBus] Failed to persist event: ${err.message}`)
		}

		// Publish to Redis if available
		if (this.redis && this.redis.status === "ready") {
			try {
				await this.redis.publish(
					"brain:events",
					JSON.stringify({
						id: event.id,
						type: eventType,
						projectId,
						actor,
						payload,
						timestamp: event.created_at,
					}),
				)
			} catch (err) {
				// Non-critical
				console.error(`[BrainEventBus] Redis publish failed: ${err.message}`)
			}
		}

		// Callback for real-time handling
		if (this.onEvent) {
			try {
				this.onEvent(event)
			} catch (err) {
				console.error(`[BrainEventBus] onEvent callback failed: ${err.message}`)
			}
		}

		return event
	}

	/**
	 * Subscribe to brain events via Redis Pub/Sub.
	 * Calls the provided handler for each event.
	 *
	 * @param {function} handler - (event) => void
	 */
	async subscribe(handler) {
		if (!this.redis) {
			console.warn("[BrainEventBus] No Redis client available for subscription")
			return
		}

		if (this._subscribed) {
			return
		}

		try {
			const subscriber = this.redis.duplicate()
			await subscriber.subscribe("brain:events")
			subscriber.on("message", (channel, message) => {
				if (channel === "brain:events") {
					try {
						const event = JSON.parse(message)
						handler(event)
					} catch (err) {
						console.error(`[BrainEventBus] Failed to parse event: ${err.message}`)
					}
				}
			})
			this._subscribed = true
			console.log("[BrainEventBus] Subscribed to brain:events")
		} catch (err) {
			console.error(`[BrainEventBus] Subscription failed: ${err.message}`)
		}
	}

	/**
	 * Get recent events for a project.
	 */
	async getEvents(projectId, limit = 50, eventType = null) {
		let query
		let params

		if (eventType) {
			query = `SELECT * FROM brain_events
               WHERE project_id = $1 AND event_type = $2
               ORDER BY created_at DESC LIMIT $3`
			params = [projectId, eventType, limit]
		} else {
			query = `SELECT * FROM brain_events
               WHERE project_id = $1
               ORDER BY created_at DESC LIMIT $2`
			params = [projectId, limit]
		}

		const result = await this.memoryService.query(query, params)
		return (result.rows || []).map((row) => ({
			...row,
			payload: typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload,
		}))
	}

	/**
	 * Get event summary counts by type.
	 */
	async getEventSummary(projectId) {
		const result = await this.memoryService.query(
			`SELECT event_type, COUNT(*) as count, MAX(created_at) as last_event
       FROM brain_events
       WHERE project_id = $1
       GROUP BY event_type
       ORDER BY count DESC`,
			[projectId],
		)
		return result.rows || []
	}

	/**
	 * Clean up old events beyond the TTL.
	 * Returns number of deleted events.
	 */
	async cleanup() {
		const result = await this.memoryService.query(
			`DELETE FROM brain_events
       WHERE created_at < NOW() - ($1 || ' days')::INTERVAL`,
			[this.eventTtlDays],
		)
		return result.rowCount || 0
	}

	/**
	 * Emit a memory.created event (convenience method).
	 */
	async emitMemoryCreated(projectId, memoryId, agent, title) {
		return this.emit(projectId, "memory.created", {
			memoryId,
			agent,
			title,
		})
	}

	/**
	 * Emit a memory.merged event (convenience method).
	 */
	async emitMemoryMerged(projectId, keptId, mergedId, agent) {
		return this.emit(projectId, "memory.merged", {
			keptId,
			mergedId,
			agent,
		})
	}

	/**
	 * Emit a memory.decay_applied event (convenience method).
	 */
	async emitDecayApplied(projectId, affectedCount) {
		return this.emit(projectId, "memory.decay_applied", {
			affectedCount,
		})
	}
}

module.exports = { BrainEventBus }
