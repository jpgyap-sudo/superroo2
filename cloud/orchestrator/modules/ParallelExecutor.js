/**
 * Cloud Orchestrator — Parallel Executor.
 *
 * Manages concurrent task execution across agents with a configurable
 * concurrency pool and token budget. Each agent has a max concurrency
 * limit, and the executor tracks running slots.
 *
 * Ported from src/super-roo/parallel/ParallelExecutor.ts for the cloud runtime.
 */

class ParallelExecutor {
	/**
	 * @param {Object} opts
	 * @param {number} [opts.maxConcurrency=5] - Global max concurrent tasks.
	 * @param {number} [opts.maxTokens=100000] - Global token budget.
	 * @param {Object} [opts.agentRegistry] - Optional AgentRegistry for agent lookups.
	 */
	constructor(opts = {}) {
		this.maxConcurrency = opts.maxConcurrency || 5
		this.maxTokens = opts.maxTokens || 100000
		this.agentRegistry = opts.agentRegistry || null

		this._slots = new Map() // taskId -> { task, agent, startTime, timeoutHandle }
		this._tokenUsage = new Map() // agentId -> current tokens
		this._running = false
	}

	/**
	 * Start the executor.
	 */
	start() {
		this._running = true
		console.log(
			`[orchestrator/parallel-executor] Started (maxConcurrency=${this.maxConcurrency}, maxTokens=${this.maxTokens})`,
		)
	}

	/**
	 * Stop the executor and cancel all running tasks.
	 */
	stop() {
		this._running = false
		for (const [taskId, slot] of this._slots) {
			this.cancel(taskId)
		}
		console.log("[orchestrator/parallel-executor] Stopped")
	}

	/**
	 * Check if a task can be dispatched given current constraints.
	 * @param {Object} task
	 * @param {Object} agent
	 * @returns {{ allowed: boolean, reason?: string }}
	 */
	canDispatch(task, agent) {
		if (this._slots.size >= this.maxConcurrency) {
			return { allowed: false, reason: "Global concurrency limit reached" }
		}

		if (this._isRunningTask(task.id)) {
			return { allowed: false, reason: "Task is already running" }
		}

		// Check agent-level concurrency
		const agentMax = agent.maxConcurrency || 1
		const agentRunning = this._countAgentSlots(agent.id)
		if (agentRunning >= agentMax) {
			return { allowed: false, reason: `Agent ${agent.id} concurrency limit (${agentMax}) reached` }
		}

		// Check token budget
		const estimatedTokens = this._estimateTokens(task)
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
	 * @param {number} [timeoutMs=300000] - Task timeout (5 min default).
	 * @returns {string|null} Task ID if dispatched, null if cannot dispatch.
	 */
	dispatch(task, agent, executeFn, timeoutMs = 300000) {
		const check = this.canDispatch(task, agent)
		if (!check.allowed) {
			console.warn(`[orchestrator/parallel-executor] Cannot dispatch task ${task.id}: ${check.reason}`)
			return null
		}

		const estimatedTokens = this._estimateTokens(task)
		this._tokenUsage.set(agent.id, (this._tokenUsage.get(agent.id) || 0) + estimatedTokens)

		const timeoutHandle = setTimeout(() => {
			console.warn(`[orchestrator/parallel-executor] Task ${task.id} timed out after ${timeoutMs}ms`)
			this.cancel(task.id)
		}, timeoutMs)

		const slot = {
			task,
			agent,
			startTime: Date.now(),
			timeoutHandle,
			promise: null,
		}

		this._slots.set(task.id, slot)

		// Execute the task
		slot.promise = executeFn(task, agent)
			.then((result) => {
				this._cleanupSlot(task.id)
				return result
			})
			.catch((err) => {
				this._cleanupSlot(task.id)
				throw err
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
		this._cleanupSlot(taskId)
		return true
	}

	_cleanupSlot(taskId) {
		const slot = this._slots.get(taskId)
		if (!slot) return

		clearTimeout(slot.timeoutHandle)
		const tokens = this._estimateTokens(slot.task)
		const current = this._tokenUsage.get(slot.agent.id) || 0
		this._tokenUsage.set(slot.agent.id, Math.max(0, current - tokens))
		this._slots.delete(taskId)
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
		}))

		return {
			running: this._slots.size,
			maxConcurrency: this.maxConcurrency,
			maxTokens: this.maxTokens,
			currentTokenUsage: this._currentTokenUsage(),
			slots,
			agentTokenUsage: Object.fromEntries(this._tokenUsage),
		}
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

	_estimateTokens(task) {
		// Rough estimation based on task content
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
