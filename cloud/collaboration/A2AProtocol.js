/**
 * A2AProtocol — Agent-to-Agent communication protocol.
 *
 * Implements the A2A (Agent-to-Agent) standard for inter-agent communication,
 * inspired by VoltAgent's A2A protocol. Allows SuperRoo2 agents to discover,
 * communicate with, and delegate work to other agents — both local and remote.
 *
 * Protocol messages follow the A2A specification:
 *   - `a2a.discover` — Agent capability discovery
 *   - `a2a.task` — Task delegation to another agent
 *   - `a2a.status` — Status update from a delegated task
 *   - `a2a.result` — Result delivery from a completed task
 *   - `a2a.error` — Error reporting from a delegated task
 *   - `a2a.ping` / `a2a.pong` — Heartbeat / liveness check
 *
 * @see https://github.com/voltagent/voltagent/blob/main/packages/a2a/
 *
 * @module cloud/collaboration/A2AProtocol
 */

const EventEmitter = require("node:events")
const crypto = require("crypto")

/**
 * @typedef {Object} AgentCapability
 * @property {string} agentId — Unique agent identifier
 * @property {string} agentName — Human-readable agent name
 * @property {string[]} skills — List of skills/capabilities
 * @property {string[]} models — Supported model types
 * @property {Object} [metadata] — Additional agent metadata
 */

/**
 * @typedef {Object} A2AMessage
 * @property {string} id — Unique message identifier
 * @property {string} type — Message type (a2a.*)
 * @property {string} source — Source agent ID
 * @property {string} target — Target agent ID (or "*" for broadcast)
 * @property {Object} [payload] — Message payload
 * @property {number} timestamp — When the message was created
 * @property {string} [correlationId] — For request/response correlation
 */

/**
 * @typedef {Object} A2ATask
 * @property {string} taskId — Unique task identifier
 * @property {string} type — Task type (e.g., "code", "debug", "review")
 * @property {Object} input — Task input parameters
 * @property {string} sourceAgent — Agent that created the task
 * @property {string} targetAgent — Agent that should execute the task
 * @property {'pending'|'running'|'completed'|'failed'|'cancelled'} status
 * @property {Object} [result] — Task result (when completed)
 * @property {string} [error] — Error message (when failed)
 * @property {number} createdAt — When the task was created
 * @property {number} [completedAt] — When the task was completed
 */

class A2AProtocol extends EventEmitter {
	constructor() {
		super()

		/** @type {Map<string, AgentCapability>} */
		this._agents = new Map()

		/** @type {Map<string, A2ATask>} */
		this._tasks = new Map()

		/** @type {Map<string, Function>} */
		this._taskHandlers = new Map()

		/** @type {Map<string, {resolve: Function, reject: Function, timer: NodeJS.Timeout}>} */
		this._pendingRequests = new Map()

		/** @type {string} */
		this._localAgentId = `agent_${crypto.randomUUID().slice(0, 8)}`

		/** @type {number} */
		this._requestTimeout = 30000 // 30s default timeout
	}

	// ── Agent registration ─────────────────────────────────────────────────

	/**
	 * Register the local agent with its capabilities.
	 * @param {Object} opts
	 * @param {string} [opts.agentId] — Override default agent ID
	 * @param {string} opts.agentName — Human-readable name
	 * @param {string[]} opts.skills — List of skills
	 * @param {string[]} [opts.models] — Supported models
	 * @param {Object} [opts.metadata] — Additional metadata
	 */
	registerLocalAgent({ agentId, agentName, skills, models = [], metadata = {} }) {
		if (agentId) this._localAgentId = agentId

		const capability = {
			agentId: this._localAgentId,
			agentName: agentName || this._localAgentId,
			skills: [...skills],
			models: [...models],
			metadata: { ...metadata },
		}

		this._agents.set(this._localAgentId, capability)
		this.emit("agent:registered", { agentId: this._localAgentId, capability })
		return this._localAgentId
	}

	/**
	 * Register a remote agent's capabilities (received via discovery).
	 * @param {AgentCapability} capability
	 */
	registerRemoteAgent(capability) {
		this._agents.set(capability.agentId, capability)
		this.emit("agent:discovered", { agentId: capability.agentId, capability })
	}

	/**
	 * Unregister an agent.
	 * @param {string} agentId
	 */
	unregisterAgent(agentId) {
		this._agents.delete(agentId)
		this.emit("agent:unregistered", { agentId })
	}

	/**
	 * Get the local agent ID.
	 * @returns {string}
	 */
	getLocalAgentId() {
		return this._localAgentId
	}

	/**
	 * Get all registered agents.
	 * @returns {AgentCapability[]}
	 */
	getAgents() {
		return Array.from(this._agents.values())
	}

	/**
	 * Find agents with a specific skill.
	 * @param {string} skill
	 * @returns {AgentCapability[]}
	 */
	findAgentsBySkill(skill) {
		return this.getAgents().filter((a) => a.skills.includes(skill))
	}

	// ── Task handler registration ──────────────────────────────────────────

	/**
	 * Register a handler for a specific task type.
	 * @param {string} taskType — e.g., "code", "debug", "review"
	 * @param {Function} handler — Async function(task) => result
	 */
	registerTaskHandler(taskType, handler) {
		this._taskHandlers.set(taskType, handler)
		this.emit("handler:registered", { taskType })
	}

	/**
	 * Unregister a task handler.
	 * @param {string} taskType
	 */
	unregisterTaskHandler(taskType) {
		this._taskHandlers.delete(taskType)
		this.emit("handler:unregistered", { taskType })
	}

	/**
	 * Check if a handler exists for a task type.
	 * @param {string} taskType
	 * @returns {boolean}
	 */
	hasHandler(taskType) {
		return this._taskHandlers.has(taskType)
	}

	// ── Message creation ───────────────────────────────────────────────────

	/**
	 * Create an A2A message.
	 * @param {Object} opts
	 * @param {string} opts.type — Message type
	 * @param {string} opts.target — Target agent ID
	 * @param {Object} [opts.payload]
	 * @param {string} [opts.correlationId]
	 * @returns {A2AMessage}
	 */
	_createMessage({ type, target, payload, correlationId }) {
		return {
			id: `msg_${crypto.randomUUID().slice(0, 12)}`,
			type,
			source: this._localAgentId,
			target,
			payload: payload || {},
			timestamp: Date.now(),
			correlationId,
		}
	}

	// ── Message sending ────────────────────────────────────────────────────

	/**
	 * Send a message to an agent. If the agent is local, handle it directly.
	 * If remote, emit for transport layer to deliver.
	 * @param {A2AMessage} message
	 * @returns {Promise<Object>} — Response from the target agent
	 */
	async sendMessage(message) {
		// Check if target is the local agent
		if (message.target === this._localAgentId) {
			return this._handleLocalMessage(message)
		}

		// Remote agent — emit for transport layer
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this._pendingRequests.delete(message.id)
				reject(new Error(`A2A request timed out: ${message.type} -> ${message.target}`))
			}, this._requestTimeout)

			this._pendingRequests.set(message.id, { resolve, reject, timer })
			this.emit("message:outgoing", message)
		})
	}

	/**
	 * Handle an incoming message (from transport layer or local).
	 * @param {A2AMessage} message
	 * @returns {Promise<A2AMessage|null>} — Response message, if any
	 */
	async receiveMessage(message) {
		// Check if this is a response to a pending request
		if (message.correlationId && this._pendingRequests.has(message.correlationId)) {
			const pending = this._pendingRequests.get(message.correlationId)
			clearTimeout(pending.timer)
			this._pendingRequests.delete(message.correlationId)
			pending.resolve(message.payload || {})
			return null
		}

		// Handle based on message type
		switch (message.type) {
			case "a2a.discover":
				return this._handleDiscover(message)
			case "a2a.task":
				return this._handleTask(message)
			case "a2a.ping":
				return this._createMessage({
					type: "a2a.pong",
					target: message.source,
					correlationId: message.id,
				})
			case "a2a.register":
				if (message.payload?.capability) {
					this.registerRemoteAgent(message.payload.capability)
				}
				return null
			default:
				this.emit("message:unknown", message)
				return null
		}
	}

	// ── High-level operations ──────────────────────────────────────────────

	/**
	 * Discover agents by broadcasting a discovery message.
	 * @returns {Promise<AgentCapability[]>}
	 */
	async discoverAgents() {
		const msg = this._createMessage({
			type: "a2a.discover",
			target: "*",
			payload: {
				capability: this._agents.get(this._localAgentId),
			},
		})

		this.emit("message:outgoing", msg)
		return this.getAgents()
	}

	/**
	 * Delegate a task to another agent.
	 * @param {Object} opts
	 * @param {string} opts.targetAgent — Agent to execute the task
	 * @param {string} opts.taskType — Type of task
	 * @param {Object} opts.input — Task input
	 * @returns {Promise<Object>} — Task result
	 */
	async delegateTask({ targetAgent, taskType, input }) {
		const taskId = `task_${crypto.randomUUID().slice(0, 12)}`

		const task = {
			taskId,
			type: taskType,
			input,
			sourceAgent: this._localAgentId,
			targetAgent,
			status: "pending",
			createdAt: Date.now(),
		}

		this._tasks.set(taskId, task)
		this.emit("task:created", task)

		const msg = this._createMessage({
			type: "a2a.task",
			target: targetAgent,
			payload: { task },
			correlationId: taskId,
		})

		try {
			const response = await this.sendMessage(msg)
			// Unwrap A2A message to get the actual result payload
			const resultPayload = response && response.payload ? response.payload.result || response.payload : response
			task.status = "completed"
			task.result = resultPayload
			task.completedAt = Date.now()
			// _handleTask already emits task:completed, so we don't emit it here
			return resultPayload
		} catch (err) {
			task.status = "failed"
			task.error = err.message
			this.emit("task:failed", task)
			throw err
		}
	}

	/**
	 * Get the status of a delegated task.
	 * @param {string} taskId
	 * @returns {A2ATask|undefined}
	 */
	getTaskStatus(taskId) {
		return this._tasks.get(taskId)
	}

	/**
	 * List all tasks.
	 * @param {string} [status] — Filter by status
	 * @returns {A2ATask[]}
	 */
	listTasks(status) {
		const tasks = Array.from(this._tasks.values())
		return status ? tasks.filter((t) => t.status === status) : tasks
	}

	// ── Internal handlers ──────────────────────────────────────────────────

	/**
	 * Handle a message directed at a local agent.
	 * @param {A2AMessage} message
	 * @returns {Promise<Object>}
	 */
	async _handleLocalMessage(message) {
		switch (message.type) {
			case "a2a.discover":
				return this._handleDiscover(message)
			case "a2a.task":
				return this._handleTask(message)
			case "a2a.ping":
				return { pong: true, timestamp: Date.now() }
			default:
				throw new Error(`Unknown message type: ${message.type}`)
		}
	}

	/**
	 * Handle a discovery request.
	 * @param {A2AMessage} message
	 * @returns {Promise<A2AMessage>}
	 */
	async _handleDiscover(message) {
		// Register the requesting agent
		if (message.payload?.capability) {
			this.registerRemoteAgent(message.payload.capability)
		}

		return this._createMessage({
			type: "a2a.discover",
			target: message.source,
			payload: {
				agents: this.getAgents(),
				capability: this._agents.get(this._localAgentId),
			},
			correlationId: message.id,
		})
	}

	/**
	 * Handle a task delegation.
	 * @param {A2AMessage} message
	 * @returns {Promise<A2AMessage>}
	 */
	async _handleTask(message) {
		const { task } = message.payload
		if (!task) {
			throw new Error("No task in message")
		}

		// Store the task
		task.status = "running"
		this._tasks.set(task.taskId, task)
		this.emit("task:received", task)

		// Find handler
		const handler = this._taskHandlers.get(task.type)
		if (!handler) {
			task.status = "failed"
			task.error = `No handler for task type: ${task.type}`
			this.emit("task:failed", task)
			throw new Error(task.error)
		}

		try {
			const result = await handler(task)
			task.status = "completed"
			task.result = result
			task.completedAt = Date.now()
			this.emit("task:completed", task)

			return this._createMessage({
				type: "a2a.result",
				target: message.source,
				payload: { result, taskId: task.taskId },
				correlationId: message.id,
			})
		} catch (err) {
			task.status = "failed"
			task.error = err.message
			this.emit("task:failed", task)
			throw err
		}
	}

	// ── Cleanup ────────────────────────────────────────────────────────────

	/**
	 * Clear all state and pending requests.
	 */
	clear() {
		// Clear pending request timers
		for (const [, pending] of this._pendingRequests) {
			clearTimeout(pending.timer)
			pending.reject(new Error("A2A protocol cleared"))
		}
		this._pendingRequests.clear()
		this._agents.clear()
		this._tasks.clear()
		this._taskHandlers.clear()
		this.removeAllListeners()
	}
}

module.exports = { A2AProtocol }
