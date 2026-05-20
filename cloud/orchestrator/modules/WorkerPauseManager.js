/**
 * SuperRoo Cloud — Worker Pause Manager
 *
 * Manages the lifecycle of VPS workers by pausing and resuming them based on
 * RAM pressure. Integrates with:
 *
 *   - AgentRegistry: to know which agents/workers exist and their criticality
 *   - ParallelExecutor: to pause/resume task dispatch
 *   - CPUGuard: to leverage existing backpressure mechanisms
 *   - BullMQ workers: to pause/resume queue consumption
 *
 * Worker criticality levels:
 *   - ESSENTIAL: Never paused (health checks, RAM monitor itself, orchestrator)
 *   - CRITICAL: Paused only in DANGER state (deployments, user-facing tasks)
 *   - NORMAL: Paused in CRITICAL state (standard coding agents)
 *   - BACKGROUND: Paused in WARNING state (crawlers, indexers, cleanup)
 *
 * When a worker is paused, its current task is allowed to finish (graceful),
 * but no new tasks are dispatched to it.
 */

const EventEmitter = require("events")

// ── Worker criticality levels ──────────────────────────────────────────────────

const WORKER_CRITICALITY = Object.freeze({
	ESSENTIAL: "essential", // Never paused
	CRITICAL: "critical", // Paused only in DANGER
	NORMAL: "normal", // Paused in CRITICAL
	BACKGROUND: "background", // Paused in WARNING
})

// ── Default worker criticality assignments ─────────────────────────────────────

const DEFAULT_WORKER_CRITICALITY = Object.freeze({
	// ESSENTIAL — never paused
	"superroo-orchestrator-agent": WORKER_CRITICALITY.ESSENTIAL,
	"ram-monitor": WORKER_CRITICALITY.ESSENTIAL,
	"health-checker": WORKER_CRITICALITY.ESSENTIAL,

	// CRITICAL — paused only in DANGER
	"superroo-deployer-agent": WORKER_CRITICALITY.CRITICAL,
	"superroo-consultant-agent": WORKER_CRITICALITY.CRITICAL,

	// NORMAL — paused in CRITICAL
	"superroo-debugger-agent": WORKER_CRITICALITY.NORMAL,
	"superroo-tester-agent": WORKER_CRITICALITY.NORMAL,

	// BACKGROUND — paused in WARNING
	"superroo-crawler-agent": WORKER_CRITICALITY.BACKGROUND,
	"code-indexer": WORKER_CRITICALITY.BACKGROUND,
	"lesson-syncer": WORKER_CRITICALITY.BACKGROUND,
	"log-rotator": WORKER_CRITICALITY.BACKGROUND,
	"analytics-collector": WORKER_CRITICALITY.BACKGROUND,
})

// ── RAM state → pause mapping ──────────────────────────────────────────────────

/**
 * Which RAM states cause which criticality levels to be paused.
 * @type {Object<string, string[]>}
 */
const RAM_STATE_PAUSE_MAP = Object.freeze({
	warning: [WORKER_CRITICALITY.BACKGROUND],
	critical: [WORKER_CRITICALITY.BACKGROUND, WORKER_CRITICALITY.NORMAL],
	danger: [WORKER_CRITICALITY.BACKGROUND, WORKER_CRITICALITY.NORMAL, WORKER_CRITICALITY.CRITICAL],
})

// ── Worker Pause Manager ───────────────────────────────────────────────────────

class WorkerPauseManager extends EventEmitter {
	/**
	 * @param {Object} options
	 * @param {import('./RAMMonitor')} options.ramMonitor - RAMMonitor instance
	 * @param {import('./AgentRegistry')} [options.agentRegistry] - Optional AgentRegistry
	 * @param {import('./ParallelExecutor')} [options.parallelExecutor] - Optional ParallelExecutor
	 * @param {Object} [options.workerCriticality] - Custom worker criticality map
	 * @param {number} [options.gracePeriodMs=30000] - Grace period for workers to finish current task
	 * @param {number} [options.cooldownMs=60000] - Min time between pause/resume cycles for same worker
	 * @param {Console} [options.logger=console]
	 */
	constructor(options = {}) {
		super()
		if (!options.ramMonitor) throw new Error("WorkerPauseManager requires a ramMonitor instance")

		this.ramMonitor = options.ramMonitor
		this.agentRegistry = options.agentRegistry || null
		this.parallelExecutor = options.parallelExecutor || null
		this.gracePeriodMs = options.gracePeriodMs ?? 30000
		this.cooldownMs = options.cooldownMs ?? 60000
		this.logger = options.logger ?? console

		/** @type {Object<string, string>} workerId → criticality level */
		this._workerCriticality = { ...DEFAULT_WORKER_CRITICALITY, ...(options.workerCriticality || {}) }

		/** @type {Set<string>} Set of currently paused worker IDs */
		this._pausedWorkers = new Set()

		/** @type {Map<string, number>} workerId → timestamp of last pause/resume cycle */
		this._lastCycle = new Map()

		/** @type {Map<string, {taskId: string, agentId: string}>} workerId → currently running task */
		this._runningTasks = new Map()

		// Wire into RAMMonitor state changes
		this._onStateChange = (event) => this._handleStateChange(event)
		this.ramMonitor.on("stateChange", this._onStateChange)
	}

	// ── Worker criticality management ──────────────────────────────────────────

	/**
	 * Register or update a worker's criticality level.
	 * @param {string} workerId
	 * @param {string} criticality - One of WORKER_CRITICALITY values
	 */
	registerWorker(workerId, criticality) {
		if (!Object.values(WORKER_CRITICALITY).includes(criticality)) {
			throw new Error(
				`Invalid criticality "${criticality}". Must be one of: ${Object.values(WORKER_CRITICALITY).join(", ")}`,
			)
		}
		this._workerCriticality[workerId] = criticality
		this.logger.info(`[WorkerPauseManager] Registered worker "${workerId}" as ${criticality}`)
		this.emit("workerRegistered", { workerId, criticality })
	}

	/**
	 * Unregister a worker.
	 * @param {string} workerId
	 */
	unregisterWorker(workerId) {
		delete this._workerCriticality[workerId]
		this._pausedWorkers.delete(workerId)
		this._lastCycle.delete(workerId)
		this._runningTasks.delete(workerId)
		this.logger.info(`[WorkerPauseManager] Unregistered worker "${workerId}"`)
		this.emit("workerUnregistered", { workerId })
	}

	/**
	 * Get a worker's criticality level.
	 * @param {string} workerId
	 * @returns {string|null}
	 */
	getWorkerCriticality(workerId) {
		return this._workerCriticality[workerId] || null
	}

	/**
	 * Check if a worker is currently paused.
	 * @param {string} workerId
	 * @returns {boolean}
	 */
	isWorkerPaused(workerId) {
		return this._pausedWorkers.has(workerId)
	}

	/**
	 * Get all currently paused workers.
	 * @returns {Array<{workerId: string, criticality: string, pausedAt: number}>}
	 */
	getPausedWorkers() {
		return Array.from(this._pausedWorkers).map((workerId) => ({
			workerId,
			criticality: this._workerCriticality[workerId] || "unknown",
			pausedAt: this._lastCycle.get(workerId) || 0,
		}))
	}

	// ── Track running tasks ────────────────────────────────────────────────────

	/**
	 * Register a task as running on a specific worker.
	 * @param {string} workerId
	 * @param {string} taskId
	 * @param {string} agentId
	 */
	trackTaskStart(workerId, taskId, agentId) {
		this._runningTasks.set(workerId, { taskId, agentId })
	}

	/**
	 * Unregister a completed/cancelled task from a worker.
	 * @param {string} workerId
	 */
	trackTaskEnd(workerId) {
		this._runningTasks.delete(workerId)
	}

	/**
	 * Get currently running tasks per worker.
	 * @returns {Map<string, {taskId: string, agentId: string}>}
	 */
	getRunningTasks() {
		return new Map(this._runningTasks)
	}

	// ── Pause / Resume logic ───────────────────────────────────────────────────

	/**
	 * Pause a specific worker. Allows current task to finish gracefully.
	 * @param {string} workerId
	 * @param {string} [reason]
	 * @returns {boolean}
	 */
	async pauseWorker(workerId, reason) {
		if (this._pausedWorkers.has(workerId)) return false // Already paused

		// Check cooldown
		const lastCycle = this._lastCycle.get(workerId) || 0
		if (Date.now() - lastCycle < this.cooldownMs) {
			this.logger.info(
				`[WorkerPauseManager] Skipping pause for "${workerId}" — in cooldown (${Math.round((Date.now() - lastCycle) / 1000)}s since last cycle)`,
			)
			return false
		}

		this._pausedWorkers.add(workerId)
		this._lastCycle.set(workerId, Date.now())

		// If ParallelExecutor is available, cancel any running tasks for this worker
		if (this.parallelExecutor) {
			const running = this._runningTasks.get(workerId)
			if (running) {
				this.logger.info(
					`[WorkerPauseManager] Grace period for "${workerId}" — allowing task ${running.taskId} to finish (${this.gracePeriodMs}ms)`,
				)
				// We don't force-cancel — we let the current task finish
				// But we prevent new tasks from being dispatched
			}
		}

		// If AgentRegistry is available, disable the agent
		if (this.agentRegistry) {
			try {
				await this.agentRegistry.setEnabled(workerId, false)
			} catch (err) {
				this.logger.warn(`[WorkerPauseManager] Failed to disable agent "${workerId}": ${err.message}`)
			}
		}

		this.logger.warn(
			`[WorkerPauseManager] Paused worker "${workerId}" (${this._workerCriticality[workerId] || "unknown"}): ${reason || ""}`,
		)
		this.emit("workerPaused", { workerId, criticality: this._workerCriticality[workerId], reason })
		return true
	}

	/**
	 * Resume a previously paused worker.
	 * @param {string} workerId
	 * @returns {boolean}
	 */
	async resumeWorker(workerId) {
		if (!this._pausedWorkers.has(workerId)) return false // Not paused

		// Check cooldown
		const lastCycle = this._lastCycle.get(workerId) || 0
		if (Date.now() - lastCycle < this.cooldownMs) {
			this.logger.info(
				`[WorkerPauseManager] Skipping resume for "${workerId}" — in cooldown (${Math.round((Date.now() - lastCycle) / 1000)}s since last cycle)`,
			)
			return false
		}

		this._pausedWorkers.delete(workerId)
		this._lastCycle.set(workerId, Date.now())

		// If AgentRegistry is available, re-enable the agent
		if (this.agentRegistry) {
			try {
				await this.agentRegistry.setEnabled(workerId, true)
			} catch (err) {
				this.logger.warn(`[WorkerPauseManager] Failed to enable agent "${workerId}": ${err.message}`)
			}
		}

		this.logger.info(
			`[WorkerPauseManager] Resumed worker "${workerId}" (${this._workerCriticality[workerId] || "unknown"})`,
		)
		this.emit("workerResumed", { workerId, criticality: this._workerCriticality[workerId] })
		return true
	}

	/**
	 * Pause all workers at or below a given criticality level.
	 * @param {string} criticalityThreshold - Pause workers at this level and below
	 * @param {string} [reason]
	 * @returns {Promise<number>} Number of workers paused
	 */
	async pauseWorkersAtOrBelow(criticalityThreshold, reason) {
		const criticalityOrder = [
			WORKER_CRITICALITY.ESSENTIAL,
			WORKER_CRITICALITY.CRITICAL,
			WORKER_CRITICALITY.NORMAL,
			WORKER_CRITICALITY.BACKGROUND,
		]

		const thresholdIndex = criticalityOrder.indexOf(criticalityThreshold)
		if (thresholdIndex === -1) {
			this.logger.warn(`[WorkerPauseManager] Unknown criticality threshold: ${criticalityThreshold}`)
			return 0
		}

		let pausedCount = 0
		for (const [workerId, criticality] of Object.entries(this._workerCriticality)) {
			const workerIndex = criticalityOrder.indexOf(criticality)
			if (workerIndex >= thresholdIndex && !this._pausedWorkers.has(workerId)) {
				const paused = await this.pauseWorker(workerId, reason)
				if (paused) pausedCount++
			}
		}

		return pausedCount
	}

	/**
	 * Resume all paused workers at or above a given criticality level.
	 * @param {string} criticalityThreshold - Resume workers at this level and above
	 * @param {string} [reason]
	 * @returns {Promise<number>} Number of workers resumed
	 */
	async resumeWorkersAtOrAbove(criticalityThreshold, reason) {
		const criticalityOrder = [
			WORKER_CRITICALITY.ESSENTIAL,
			WORKER_CRITICALITY.CRITICAL,
			WORKER_CRITICALITY.NORMAL,
			WORKER_CRITICALITY.BACKGROUND,
		]

		const thresholdIndex = criticalityOrder.indexOf(criticalityThreshold)
		if (thresholdIndex === -1) {
			this.logger.warn(`[WorkerPauseManager] Unknown criticality threshold: ${criticalityThreshold}`)
			return 0
		}

		let resumedCount = 0
		for (const [workerId, criticality] of Object.entries(this._workerCriticality)) {
			const workerIndex = criticalityOrder.indexOf(criticality)
			if (workerIndex <= thresholdIndex && this._pausedWorkers.has(workerId)) {
				const resumed = await this.resumeWorker(workerId)
				if (resumed) resumedCount++
			}
		}

		return resumedCount
	}

	// ── RAM state handler ──────────────────────────────────────────────────────

	/**
	 * Handle RAMMonitor state change events — automatically pause/resume workers.
	 * @param {Object} event
	 */
	async _handleStateChange(event) {
		const { newState, prevState, ramPercent } = event

		try {
			const criticalitiesToPause = RAM_STATE_PAUSE_MAP[newState] || []

			if (criticalitiesToPause.length > 0) {
				// Pause workers at the affected criticality levels
				let pausedCount = 0
				for (const criticality of criticalitiesToPause) {
					const count = await this.pauseWorkersAtOrBelow(criticality, `RAM ${newState} (${ramPercent}%)`)
					pausedCount += count
				}

				if (pausedCount > 0) {
					this.logger.warn(
						`[WorkerPauseManager] RAM ${newState}: paused ${pausedCount} workers (${ramPercent}% RAM)`,
					)
				}
			}

			// When recovering from a higher state, resume workers
			if (prevState && this._isRecovery(prevState, newState)) {
				const criticalitiesToResume = RAM_STATE_PAUSE_MAP[prevState] || []
				let resumedCount = 0
				for (const criticality of criticalitiesToResume) {
					const count = await this.resumeWorkersAtOrAbove(
						criticality,
						`RAM recovered to ${newState} (${ramPercent}%)`,
					)
					resumedCount += count
				}

				if (resumedCount > 0) {
					this.logger.info(
						`[WorkerPauseManager] RAM recovered to ${newState}: resumed ${resumedCount} workers (${ramPercent}% RAM)`,
					)
				}
			}
		} catch (err) {
			this.logger.error(`[WorkerPauseManager] Error handling RAM state change: ${err.message}`)
		}
	}

	/**
	 * Check if a state transition is a recovery (pressure decreasing).
	 * @param {string} prevState
	 * @param {string} newState
	 * @returns {boolean}
	 */
	_isRecovery(prevState, newState) {
		const order = ["normal", "warning", "critical", "danger"]
		const prevIndex = order.indexOf(prevState)
		const newIndex = order.indexOf(newState)
		return newIndex < prevIndex
	}

	// ── Stats ──────────────────────────────────────────────────────────────────

	/**
	 * Get pause manager statistics.
	 * @returns {Object}
	 */
	getStats() {
		const pausedByCriticality = {}
		for (const workerId of this._pausedWorkers) {
			const c = this._workerCriticality[workerId] || "unknown"
			pausedByCriticality[c] = (pausedByCriticality[c] || 0) + 1
		}

		const workersByCriticality = {}
		for (const [workerId, criticality] of Object.entries(this._workerCriticality)) {
			workersByCriticality[criticality] = (workersByCriticality[criticality] || 0) + 1
		}

		return {
			totalWorkers: Object.keys(this._workerCriticality).length,
			pausedWorkers: this.getPausedWorkers(),
			runningTasks: this._runningTasks.size,
			workersByCriticality,
			pausedByCriticality,
			pausedWorkerIds: Array.from(this._pausedWorkers),
		}
	}

	/**
	 * Clean up resources. Call when shutting down.
	 */
	dispose() {
		this.ramMonitor.off("stateChange", this._onStateChange)
		this._pausedWorkers.clear()
		this._runningTasks.clear()
		this._lastCycle.clear()
	}
}

module.exports = { WorkerPauseManager, WORKER_CRITICALITY, DEFAULT_WORKER_CRITICALITY }
