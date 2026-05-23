/**
 * Cloud Orchestrator — Parallel Executor.
 *
 * Manages concurrent task execution across agents with a configurable
 * concurrency pool and token budget. Each agent has a max concurrency
 * limit, and the executor tracks running slots.
 *
 * Ported from src/super-roo/parallel/ParallelExecutor.ts for the cloud runtime.
 */

const EventEmitter = require("events")

const DEFAULT_AGENT_TOKEN_COSTS = Object.freeze({
	coder: 10,
	debugger: 8,
	tester: 5,
	"product-manager": 6,
	"self-healing": 4,
})

class ParallelExecutor extends EventEmitter {
	/**
	 * @param {Object} opts
	 * @param {number} [opts.maxConcurrency=5] - Global max concurrent tasks.
	 * @param {number} [opts.maxTokens=100000] - Global token budget.
	 * @param {Object} [opts.agentRegistry] - Optional AgentRegistry for agent lookups.
	 * @param {Object} [opts.agentTokenCosts] - Optional per-agent token cost overrides.
	 * @param {number} [opts.taskTimeoutMs=300000] - Task timeout (5 min default).
	 */
	constructor(opts = {}) {
		super()
		this.maxConcurrency = opts.maxConcurrency || 5
		this.maxTokens = opts.maxTokens || 100000
		this.agentRegistry = opts.agentRegistry || null
		this.agentTokenCosts = { ...DEFAULT_AGENT_TOKEN_COSTS, ...(opts.agentTokenCosts || {}) }
		this.taskTimeoutMs = opts.taskTimeoutMs || 300000

		this._slots = new Map() // taskId -> { task, agent, startTime, timeoutHandle }
		this._tokenUsage = new Map() // agentId -> current tokens
		this._running = false
		this._totalSubmitted = 0
		this._totalCompleted = 0
		this._totalFailed = 0
		this._totalCancelled = 0
	}

	/**
	 * Start the executor.
	 */
	start() {
		if (this._running) return
		this._running = true
		console.log(
			`[orchestrator/parallel-executor] Started (maxConcurrency=${this.maxConcurrency}, maxTokens=${this.maxTokens})`,
		)
		this.emit("engineStarted", {
			maxConcurrency: this.maxConcurrency,
			maxTokens: this.maxTokens,
			timestamp: Date.now(),
		})
	}

	/**
	 * Stop the executor and cancel all running tasks.
	 */
	stop() {
		if (!this._running) return
		this._running = false
		for (const [taskId, slot] of this._slots) {
			this.cancel(taskId)
		}
		console.log("[orchestrator/parallel-executor] Stopped")
		this.emit("engineStopped", { timestamp: Date.now() })
	}

	/**
	 * Check if the executor is running.
	 * @returns {boolean}
	 */
	isRunning() {
		return this._running
	}

	/**
	 * Check if a task can be dispatched given current constraints.
	 * @param {Object} task
	 * @param {Object} agent
	 * @returns {{ allowed: boolean, reason?: string }}
	 */
	canDispatch(task, agent) {
		if (!this._running) {
			return { allowed: false, reason: "Executor not running" }
		}

		if (this._slots.size >= this.maxConcurrency) {
			return { allowed: false, reason: "Global concurrency limit reached" }
		}

		if (this._isRunningTask(task.id)) {
			return { allowed: false, reason: "Task is already running" }
		}

		// Check agent-level concurrency (fallback to registry lookup)
		const agentMax = this._resolveAgentMaxConcurrency(agent)
		const agentRunning = this._countAgentSlots(agent.id)
		if (agentRunning >= agentMax) {
			return { allowed: false, reason: `Agent ${agent.id} concurrency limit (${agentMax}) reached` }
		}

		// Check token budget
		const estimatedTokens = this._estimateTokens(task, agent)
		const currentTokens = this._currentTokenUsage()
		if (currentTokens + estimatedTokens > this.maxTokens) {
			return { allowed: false, reason: "Token budget would be exceeded" }
		}

		return { allowed: true }
	}

	/**
	 * Dispatch a task to an agent for execution.
	 * @param {Object} task
	 * @param {Object} agent
	 * @param {Function} executeFn - Async function that performs the work.
	 * @param {number} [timeoutMs] - Task timeout (defaults to constructor config).
	 * @returns {string|null} Task ID if dispatched, null if cannot dispatch.
	 */
	dispatch(task, agent, executeFn, timeoutMs) {
		const check = this.canDispatch(task, agent)
		if (!check.allowed) {
			console.warn(`[orchestrator/parallel-executor] Cannot dispatch task ${task.id}: ${check.reason}`)
			return null
		}

		const effectiveTimeout = timeoutMs ?? this.taskTimeoutMs
		const estimatedTokens = this._estimateTokens(task, agent)
		this._tokenUsage.set(agent.id, (this._tokenUsage.get(agent.id) || 0) + estimatedTokens)

		const timeoutHandle = setTimeout(() => {
			console.warn(`[orchestrator/parallel-executor] Task ${task.id} timed out after ${effectiveTimeout}ms`)
			this.emit("slotTimeout", { taskId: task.id, agentId: agent.id, elapsedMs: effectiveTimeout })
			this.cancel(task.id)
		}, effectiveTimeout)

		const slot = {
			task,
			agent,
			startTime: Date.now(),
			timeoutHandle,
			promise: null,
			estimatedTokens,
		}

		this._slots.set(task.id, slot)
		this._totalSubmitted++

		// Execute the task
		slot.promise = executeFn(task, agent)
			.then((result) => {
				this._totalCompleted++
				this._cleanupSlot(task.id)
				this.emit("slotCompleted", {
					taskId: task.id,
					agentId: agent.id,
					success: true,
					result,
					timestamp: Date.now(),
				})
				return result
			})
			.catch((err) => {
				this._totalFailed++
				this._cleanupSlot(task.id)
				this.emit("slotFailed", {
					taskId: task.id,
					agentId: agent.id,
					error: err.message,
					timestamp: Date.now(),
				})
				throw err
			})

		this.emit("slotAllocated", {
			taskId: task.id,
			agentId: agent.id,
			startTime: slot.startTime,
			estimatedTokens,
			concurrencyUsed: this._slots.size,
			tokenUsage: this._currentTokenUsage(),
		})

		console.log(`[orchestrator/parallel-executor] Dispatched task ${task.id} to agent ${agent.id}`)
		return task.id
	}

	/**
	 * Cancel a running task.
	 * @param {string} taskId
	 * @returns {boolean}
	 */
	cancel(taskId) {
		const slot = this._slots.get(taskId)
		if (!slot) return false

		clearTimeout(slot.timeoutHandle)
		this._totalCancelled++
		this._cleanupSlot(taskId)
		this.emit("slotCancelled", { taskId, agentId: slot.agent.id, timestamp: Date.now() })
		return true
	}

	_cleanupSlot(taskId) {
		const slot = this._slots.get(taskId)
		if (!slot) return

		clearTimeout(slot.timeoutHandle)
		const current = this._tokenUsage.get(slot.agent.id) || 0
		this._tokenUsage.set(slot.agent.id, Math.max(0, current - slot.estimatedTokens))
		this._slots.delete(taskId)
		this.emit("slotFreed", {
			taskId,
			agentId: slot.agent.id,
			remainingSlots: this._slots.size,
			tokenUsage: this._currentTokenUsage(),
		})
	}

	/**
	 * Wait for all running tasks to complete.
	 * @returns {Promise<void>}
	 */
	async drain() {
		const promises = []
		for (const [taskId, slot] of this._slots) {
			if (slot.promise) {
				promises.push(slot.promise.catch(() => {}))
			}
		}
		if (promises.length > 0) {
			await Promise.all(promises)
		}
	}

	/**
	 * Get executor statistics.
	 * @returns {Object}
	 */
	getStats() {
		const slots = Array.from(this._slots.values()).map((s) => ({
			taskId: s.task.id,
			agentId: s.agent.id,
			startTime: s.startTime,
			runningFor: Date.now() - s.startTime,
			estimatedTokens: s.estimatedTokens,
		}))

		return {
			running: this._slots.size,
			maxConcurrency: this.maxConcurrency,
			maxTokens: this.maxTokens,
			currentTokenUsage: this._currentTokenUsage(),
			totalSubmitted: this._totalSubmitted,
			totalCompleted: this._totalCompleted,
			totalFailed: this._totalFailed,
			totalCancelled: this._totalCancelled,
			slots,
			agentTokenUsage: Object.fromEntries(this._tokenUsage),
			isRunning: this._running,
		}
	}

	/**
	 * Get executor status (lightweight health snapshot).
	 * @returns {Object}
	 */
	getStatus() {
		return {
			status: this._running ? "healthy" : "stopped",
			activeTasks: this._slots.size,
			maxConcurrency: this.maxConcurrency,
			maxTokens: this.maxTokens,
			currentTokenUsage: this._currentTokenUsage(),
			isRunning: this._running,
		}
	}

	/**
	 * Update configuration at runtime.
	 * @param {Object} config
	 * @param {number} [config.maxConcurrency]
	 * @param {number} [config.maxTokens]
	 * @param {number} [config.taskTimeoutMs]
	 */
	updateConfig(config = {}) {
		if (config.maxConcurrency !== undefined) this.maxConcurrency = config.maxConcurrency
		if (config.maxTokens !== undefined) this.maxTokens = config.maxTokens
		if (config.taskTimeoutMs !== undefined) this.taskTimeoutMs = config.taskTimeoutMs
		this.emit("configUpdated", {
			maxConcurrency: this.maxConcurrency,
			maxTokens: this.maxTokens,
			taskTimeoutMs: this.taskTimeoutMs,
			timestamp: Date.now(),
		})
	}

	/**
	 * Get the promise for a running task.
	 * @param {string} taskId
	 * @returns {Promise|null}
	 */
	getSlotPromise(taskId) {
		const slot = this._slots.get(taskId)
		return slot ? slot.promise : null
	}

	/**
	 * Check if a task is currently running.
	 * @param {string} taskId
	 * @returns {boolean}
	 */
	isRunningTask(taskId) {
		return this._slots.has(taskId)
	}

	// ── Private ──────────────────────────────────────────────────────────

	_resolveAgentMaxConcurrency(agent) {
		if (agent && typeof agent.maxConcurrency === "number") {
			return agent.maxConcurrency
		}
		if (this.agentRegistry && this.agentRegistry.getAgent) {
			try {
				const registered = this.agentRegistry.getAgent(agent.id)
				if (registered && typeof registered.maxConcurrency === "number") {
					return registered.maxConcurrency
				}
			} catch {
				// Registry lookup failed — ignore
			}
		}
		return 1
	}

	_isRunningTask(taskId) {
		return this._slots.has(taskId)
	}

	_countAgentSlots(agentId) {
		let count = 0
		for (const slot of this._slots.values()) {
			if (slot.agent.id === agentId) count++
		}
		return count
	}

	_estimateTokens(task, agent) {
		// Prefer per-agent cost map if agent type is known
		const agentType = agent.type || agent.agentType || agent.name || "coder"
		if (this.agentTokenCosts[agentType]) {
			return this.agentTokenCosts[agentType]
		}
		// Fallback: rough estimation based on task content size
		const taskStr = JSON.stringify(task)
		return Math.ceil(taskStr.length / 4) // ~1 token per 4 chars
	}

	_currentTokenUsage() {
		let total = 0
		for (const tokens of this._tokenUsage.values()) {
			total += tokens
		}
		return total
	}
}

module.exports = { ParallelExecutor }
