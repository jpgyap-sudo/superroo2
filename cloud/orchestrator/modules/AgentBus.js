/**
 * Cloud Orchestrator — Agent Bus.
 *
 * In-memory message bus for inter-agent communication. Agents can send
 * directed messages, broadcast to all subscribers, or make request/reply
 * exchanges. Messages are persisted to the MemoryStore for durability.
 *
 * Ported from src/super-roo/parallel/AgentBus.ts for the cloud runtime.
 */

class AgentBus {
	/**
	 * @param {Object} opts
	 * @param {Object} [opts.memoryStore] - Optional MemoryStore for persistence.
	 */
	constructor(opts = {}) {
		this.memoryStore = opts.memoryStore || null
		this._agents = new Map() // agentName -> { subscriptions: Map<messageType, Set<handler>> }
		this._pendingMessages = [] // undelivered messages
		this._initialized = false

		this.stats = {
			totalMessagesSent: 0,
			totalMessagesDelivered: 0,
			totalBroadcasts: 0,
			totalRequests: 0,
			totalReplies: 0,
			activeAgents: 0,
		}
	}

	async initialize() {
		if (this._initialized) return
		this._initialized = true

		// Load pending messages from MemoryStore
		if (this.memoryStore) {
			try {
				const stored = this.memoryStore.get("agent_bus_pending")
				if (stored) {
					const data = typeof stored === "string" ? JSON.parse(stored) : stored
					this._pendingMessages = Array.isArray(data) ? data : []
					console.log(`[orchestrator/agent-bus] Loaded ${this._pendingMessages.length} pending messages`)
				}
			} catch (err) {
				console.warn("[orchestrator/agent-bus] Failed to load pending messages:", err.message)
			}
		}

		console.log("[orchestrator/agent-bus] Initialized")
	}

	async _persistPending() {
		if (this.memoryStore) {
			try {
				this.memoryStore.set("agent_bus_pending", this._pendingMessages.slice(-100), "orchestrator")
			} catch (err) {
				console.warn("[orchestrator/agent-bus] Failed to persist pending messages:", err.message)
			}
		}
	}

	_generateId() {
		return "msg-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8)
	}

	// ── Agent Registration ───────────────────────────────────────────────

	/**
	 * Register an agent on the bus.
	 * @param {string} agentName
	 */
	registerAgent(agentName) {
		if (!this._agents.has(agentName)) {
			this._agents.set(agentName, new Map())
			this.stats.activeAgents = this._agents.size
		}
	}

	/**
	 * Unregister an agent from the bus.
	 * @param {string} agentName
	 */
	unregisterAgent(agentName) {
		this._agents.delete(agentName)
		this.stats.activeAgents = this._agents.size
	}

	/**
	 * Check if an agent is registered.
	 * @param {string} agentName
	 * @returns {boolean}
	 */
	isRegistered(agentName) {
		return this._agents.has(agentName)
	}

	// ── Sending ───────────────────────────────────────────────────────────

	/**
	 * Send a directed message to a specific agent.
	 * @param {Object} msg
	 * @param {string} msg.type - Message type (e.g. "task_assigned", "status_update").
	 * @param {string} msg.from - Sender agent name.
	 * @param {string} msg.to - Recipient agent name.
	 * @param {*} msg.payload - Message payload.
	 * @param {string} [msg.replyTo] - Optional message ID this is a reply to.
	 * @returns {Promise<string|null>} Message ID if sent, null if recipient not found.
	 */
	async send(msg) {
		const message = {
			id: this._generateId(),
			type: msg.type,
			from: msg.from,
			to: msg.to,
			payload: msg.payload,
			replyTo: msg.replyTo || null,
			timestamp: Date.now(),
		}

		this.stats.totalMessagesSent++

		const delivered = await this._deliver(message)
		if (!delivered) {
			// Queue as pending for later delivery
			this._pendingMessages.push(message)
			await this._persistPending()
		} else {
			this.stats.totalMessagesDelivered++
		}

		return message.id
	}

	/**
	 * Broadcast a message to all agents subscribed to the given type.
	 * @param {Object} msg
	 * @param {string} msg.type
	 * @param {string} msg.from
	 * @param {*} msg.payload
	 * @returns {Promise<number>} Number of agents the message was delivered to.
	 */
	async broadcast(msg) {
		const message = {
			id: this._generateId(),
			type: msg.type,
			from: msg.from,
			to: "*",
			payload: msg.payload,
			replyTo: null,
			timestamp: Date.now(),
		}

		this.stats.totalMessagesSent++
		this.stats.totalBroadcasts++

		let deliveredCount = 0
		for (const [agentName, subscriptions] of this._agents) {
			if (agentName === msg.from) continue // Don't send to self
			const handlers = subscriptions.get(msg.type)
			if (handlers) {
				for (const handler of handlers) {
					try {
						handler(message)
						deliveredCount++
					} catch (err) {
						console.error(`[orchestrator/agent-bus] Handler error for ${agentName}:`, err.message)
					}
				}
			}
		}

		this.stats.totalMessagesDelivered += deliveredCount
		return deliveredCount
	}

	/**
	 * Send a request and wait for a reply.
	 * @param {Object} msg
	 * @param {string} msg.type
	 * @param {string} msg.from
	 * @param {string} msg.to
	 * @param {*} msg.payload
	 * @param {number} [timeoutMs=30000]
	 * @returns {Promise<Object|null>} Reply message or null on timeout.
	 */
	async request(msg, timeoutMs = 30000) {
		const message = {
			id: this._generateId(),
			type: msg.type,
			from: msg.from,
			to: msg.to,
			payload: msg.payload,
			replyTo: null,
			timestamp: Date.now(),
		}

		this.stats.totalMessagesSent++
		this.stats.totalRequests++

		return new Promise((resolve) => {
			const timeout = setTimeout(() => {
				this._unsubscribe(msg.to, `${msg.type}:reply`, replyHandler)
				resolve(null)
			}, timeoutMs)

			const replyHandler = (replyMsg) => {
				if (replyMsg.replyTo === message.id) {
					clearTimeout(timeout)
					this._unsubscribe(msg.to, `${msg.type}:reply`, replyHandler)
					resolve(replyMsg)
				}
			}

			this.subscribe(msg.from, `${msg.type}:reply`, replyHandler)

			this._deliver(message).then((delivered) => {
				if (!delivered) {
					clearTimeout(timeout)
					this._unsubscribe(msg.from, `${msg.type}:reply`, replyHandler)
					resolve(null)
				}
			})
		})
	}

	/**
	 * Send a reply to a previous message.
	 * @param {Object} original - The original message to reply to.
	 * @param {*} payload
	 * @returns {Promise<string|null>}
	 */
	async reply(original, payload) {
		this.stats.totalReplies++
		return this.send({
			type: original.type + ":reply",
			from: original.to,
			to: original.from,
			payload,
			replyTo: original.id,
		})
	}

	// ── Subscription ─────────────────────────────────────────────────────

	/**
	 * Subscribe to messages of a given type.
	 * @param {string} agentName
	 * @param {string} messageType
	 * @param {Function} handler - (message) => void
	 * @returns {Function} Unsubscribe function.
	 */
	subscribe(agentName, messageType, handler) {
		if (!this._agents.has(agentName)) {
			this._agents.set(agentName, new Map())
		}
		const subscriptions = this._agents.get(agentName)
		if (!subscriptions.has(messageType)) {
			subscriptions.set(messageType, new Set())
		}
		subscriptions.get(messageType).add(handler)
		return () => this._unsubscribe(agentName, messageType, handler)
	}

	/**
	 * Subscribe to multiple message types.
	 * @param {string} agentName
	 * @param {string[]} messageTypes
	 * @param {Function} handler
	 * @returns {Function} Unsubscribe function.
	 */
	subscribeMany(agentName, messageTypes, handler) {
		const unsubs = messageTypes.map((type) => this.subscribe(agentName, type, handler))
		return () => unsubs.forEach((fn) => fn())
	}

	_unsubscribe(agentName, messageType, handler) {
		const subscriptions = this._agents.get(agentName)
		if (!subscriptions) return
		const handlers = subscriptions.get(messageType)
		if (!handlers) return
		handlers.delete(handler)
		if (handlers.size === 0) {
			subscriptions.delete(messageType)
		}
	}

	// ── Delivery ─────────────────────────────────────────────────────────

	async _deliver(message) {
		const subscriptions = this._agents.get(message.to)
		if (!subscriptions) return false

		const handlers = subscriptions.get(message.type)
		if (!handlers || handlers.size === 0) return false

		for (const handler of handlers) {
			try {
				handler(message)
			} catch (err) {
				console.error(`[orchestrator/agent-bus] Delivery error to ${message.to}:`, err.message)
			}
		}
		return true
	}

	// ── Stats & Management ───────────────────────────────────────────────

	/**
	 * Get bus statistics.
	 * @returns {Object}
	 */
	getStats() {
		return {
			...this.stats,
			activeAgents: this._agents.size,
			pendingMessages: this._pendingMessages.length,
			registeredAgents: Array.from(this._agents.keys()),
		}
	}

	/**
	 * Get bus status (lightweight health snapshot).
	 * @returns {Object}
	 */
	getStatus() {
		return {
			status: this._initialized ? "healthy" : "initializing",
			activeAgents: this._agents.size,
			pendingMessages: this._pendingMessages.length,
			initialized: this._initialized,
		}
	}

	/**
	 * Drain pending messages (deliver to newly registered agents).
	 * @returns {Promise<number>} Number of messages drained.
	 */
	async drainPending() {
		const stillPending = []
		let drained = 0
		for (const msg of this._pendingMessages) {
			const delivered = await this._deliver(msg)
			if (delivered) {
				drained++
				this.stats.totalMessagesDelivered++
			} else {
				stillPending.push(msg)
			}
		}
		this._pendingMessages = stillPending
		await this._persistPending()
		return drained
	}

	/**
	 * Reset the bus (clear all agents and pending messages).
	 */
	reset() {
		this._agents.clear()
		this._pendingMessages = []
		this.stats = {
			totalMessagesSent: 0,
			totalMessagesDelivered: 0,
			totalBroadcasts: 0,
			totalRequests: 0,
			totalReplies: 0,
			activeAgents: 0,
		}
	}
}

module.exports = { AgentBus }
