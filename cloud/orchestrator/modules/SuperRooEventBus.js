/**
 * SuperRoo Event Bus — In-memory pub/sub with EventLog persistence and SSE fan-out.
 *
 * Innovations over the base zip:
 *   1. Bridges to the existing EventLog (SQLite) so events survive process restarts.
 *   2. SSE subscriber registry — dashboard panels subscribe to a task's event stream
 *      via GET /orchestrator/tasks/:id/events and receive real-time updates.
 *   3. task_transition events carry from/to status so the timeline panel can render
 *      the full state machine history.
 *   4. Max-history cap per task (TASK_EVENT_CAP) prevents unbounded memory use on
 *      long-running autonomous loops.
 *
 * Usage:
 *   const { eventBus } = require('./SuperRooEventBus')
 *   eventBus.emit(taskId, 'runtime_action', { command: 'git status' })
 *   eventBus.subscribe(taskId, res)   // SSE ServerResponse
 *   eventBus.unsubscribe(taskId, res)
 */

const crypto = require("crypto")

const TASK_EVENT_CAP = 500 // max events retained per task in memory

/**
 * @typedef {'user_message'|'brain_context'|'agent_plan'|'runtime_action'|'runtime_observation'|'test_result'|'repair_result'|'final_report'|'task_transition'} EventType
 */

/**
 * @typedef {object} SuperRooEvent
 * @property {string} id
 * @property {string} taskId
 * @property {EventType} type
 * @property {string} timestamp
 * @property {Record<string, unknown>} payload
 */

class SuperRooEventBus {
	constructor() {
		/** @type {Map<string, SuperRooEvent[]>} taskId → events */
		this._events = new Map()
		/** @type {Map<string, Set<import('http').ServerResponse>>} taskId → SSE subscribers */
		this._subscribers = new Map()
		/** @type {import('./EventLog')|null} */
		this._eventLog = null
	}

	/**
	 * Wire to the existing EventLog for SQLite persistence.
	 * Called by CloudOrchestrator after it creates its EventLog.
	 * @param {import('./EventLog')} eventLog
	 */
	attachEventLog(eventLog) {
		this._eventLog = eventLog
	}

	/**
	 * Emit an event.
	 * @param {string} taskId
	 * @param {EventType} type
	 * @param {Record<string, unknown>} payload
	 * @returns {SuperRooEvent}
	 */
	emit(taskId, type, payload = {}) {
		/** @type {SuperRooEvent} */
		const event = {
			id: crypto.randomUUID(),
			taskId,
			type,
			timestamp: new Date().toISOString(),
			payload,
		}

		// In-memory store with cap
		if (!this._events.has(taskId)) this._events.set(taskId, [])
		const list = this._events.get(taskId)
		list.push(event)
		if (list.length > TASK_EVENT_CAP) list.splice(0, list.length - TASK_EVENT_CAP)

		// JSONL console output (structured log for Pino/log aggregator pickup)
		console.log(JSON.stringify(event))

		// Bridge to EventLog (SQLite)
		if (this._eventLog) {
			try {
				this._eventLog.record({
					type: `superroo.${type}`,
					source: "SuperRooEventBus",
					payload: { taskId, ...payload },
					severity: type === "final_report" ? "info" : "info",
					taskId,
				})
			} catch {
				// never let EventLog failures crash the bus
			}
		}

		// SSE fan-out
		const subs = this._subscribers.get(taskId)
		if (subs?.size) {
			const sseData = `data: ${JSON.stringify(event)}\n\n`
			for (const res of subs) {
				try {
					res.write(sseData)
				} catch {
					subs.delete(res)
				}
			}
		}

		return event
	}

	/**
	 * List events for a task (or all tasks if taskId is omitted).
	 * @param {string} [taskId]
	 * @returns {SuperRooEvent[]}
	 */
	list(taskId) {
		if (taskId) return [...(this._events.get(taskId) ?? [])]
		const all = []
		for (const events of this._events.values()) all.push(...events)
		return all
	}

	/**
	 * Subscribe an SSE ServerResponse to a task's event stream.
	 * Replays all buffered events immediately, then streams future ones.
	 *
	 * @param {string} taskId
	 * @param {import('http').ServerResponse} res - SSE-mode ServerResponse
	 */
	subscribe(taskId, res) {
		res.writeHead(200, {
			"content-type": "text/event-stream",
			"cache-control": "no-cache",
			connection: "keep-alive",
			"x-accel-buffering": "no",
		})

		// Replay buffered history
		const history = this._events.get(taskId) ?? []
		for (const event of history) {
			res.write(`data: ${JSON.stringify(event)}\n\n`)
		}

		if (!this._subscribers.has(taskId)) this._subscribers.set(taskId, new Set())
		this._subscribers.get(taskId).add(res)

		// Heartbeat every 25s to stay under nginx's 60s proxy_read_timeout.
		// Sends an SSE comment line (": ping") which browsers ignore but keeps
		// the TCP connection alive through proxies and load balancers.
		const heartbeat = setInterval(() => {
			try {
				res.write(": ping\n\n")
			} catch {
				clearInterval(heartbeat)
				this.unsubscribe(taskId, res)
			}
		}, 25000)

		res.on("close", () => {
			clearInterval(heartbeat)
			this.unsubscribe(taskId, res)
		})
	}

	/**
	 * Remove an SSE subscriber.
	 * @param {string} taskId
	 * @param {import('http').ServerResponse} res
	 */
	unsubscribe(taskId, res) {
		this._subscribers.get(taskId)?.delete(res)
	}

	/**
	 * Clear all in-memory events for a task (e.g. after archival).
	 * @param {string} taskId
	 */
	clear(taskId) {
		this._events.delete(taskId)
		this._subscribers.delete(taskId)
	}
}

// Singleton shared across the process
const eventBus = new SuperRooEventBus()

module.exports = { SuperRooEventBus, eventBus }
