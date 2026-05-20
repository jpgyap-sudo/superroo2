/**
 * SuperRoo Cloud — RAM-Aware Task Scheduler
 *
 * Schedules and throttles task execution based on current VPS RAM pressure.
 * Integrates with TaskQueueBullMQ to dynamically adjust queuing behavior:
 *
 *   - NORMAL state:   Full throughput, all priorities processed normally
 *   - WARNING state:  Only high-priority (1-3) tasks dispatched, low-priority deferred
 *   - CRITICAL state: Only critical-priority (1) tasks dispatched, all others queued
 *   - DANGER state:   No new tasks dispatched, existing tasks may be paused
 *
 * Also supports task priority boosting for RAM-critical operations and
 * task deferral with automatic resubmission when RAM recovers.
 */

const EventEmitter = require("events")

// ── Priority levels ───────────────────────────────────────────────────────────

const PRIORITY = Object.freeze({
	CRITICAL: 1, // System operations, health checks
	HIGH: 3, // User-facing tasks, deployments
	NORMAL: 5, // Standard tasks
	LOW: 8, // Background jobs, analytics
	BACKGROUND: 10, // Crawlers, indexing, cleanup
})

// ── RAM Scheduler ──────────────────────────────────────────────────────────────

class RAMScheduler extends EventEmitter {
	/**
	 * @param {Object} options
	 * @param {import('./TaskQueueBullMQ')} options.taskQueue - TaskQueueBullMQ instance
	 * @param {import('./RAMMonitor')} options.ramMonitor - RAMMonitor instance
	 * @param {Object} [options.priorityMap] - Custom priority mapping per RAM state
	 * @param {number} [options.maxDeferredTasks=100] - Max deferred tasks before dropping oldest
	 * @param {Console} [options.logger=console]
	 */
	constructor(options = {}) {
		super()
		if (!options.taskQueue) throw new Error("RAMScheduler requires a taskQueue instance")
		if (!options.ramMonitor) throw new Error("RAMScheduler requires a ramMonitor instance")

		this.taskQueue = options.taskQueue
		this.ramMonitor = options.ramMonitor
		this.maxDeferredTasks = options.maxDeferredTasks ?? 100
		this.logger = options.logger ?? console

		/** @type {Array<{task: Object, deferredAt: number, reason: string}>} */
		this._deferredTasks = []

		/** @type {Map<string, number>} taskId → original priority */
		this._boostedPriorities = new Map()

		// Wire into RAMMonitor state changes
		this._onStateChange = (event) => this._handleStateChange(event)
		this.ramMonitor.on("stateChange", this._onStateChange)
	}

	// ── Priority helpers ───────────────────────────────────────────────────────

	/**
	 * Get the effective priority threshold for the current RAM state.
	 * Tasks with priority >= threshold are allowed; lower priority tasks are deferred.
	 * @returns {{ minPriority: number|null, label: string }}
	 */
	getCurrentPriorityThreshold() {
		const state = this.ramMonitor.getCurrentState()

		switch (state) {
			case "normal":
				return { minPriority: null, label: "all" } // All tasks allowed
			case "warning":
				return { minPriority: PRIORITY.HIGH, label: "high+" } // Only priority 1-3
			case "critical":
				return { minPriority: PRIORITY.CRITICAL, label: "critical" } // Only priority 1
			case "danger":
				return { minPriority: Infinity, label: "none" } // No new tasks
			default:
				return { minPriority: null, label: "all" }
		}
	}

	/**
	 * Check if a task can be dispatched based on current RAM state.
	 * @param {Object} task
	 * @returns {{ allowed: boolean, reason?: string, deferred?: boolean }}
	 */
	canDispatch(task) {
		const threshold = this.getCurrentPriorityThreshold()

		// No threshold = all tasks allowed
		if (threshold.minPriority === null) {
			return { allowed: true }
		}

		// Check if task priority meets the threshold
		const taskPriority = task.priority ?? PRIORITY.NORMAL
		if (taskPriority <= threshold.minPriority) {
			return { allowed: true }
		}

		return {
			allowed: false,
			reason: `RAM state "${this.ramMonitor.getCurrentState()}" limits dispatch to ${threshold.label} priority (task priority: ${taskPriority})`,
		}
	}

	/**
	 * Boost a task's priority temporarily (for urgent operations).
	 * @param {string} taskId
	 * @param {number} newPriority - New priority (1=highest)
	 * @returns {boolean}
	 */
	boostPriority(taskId, newPriority) {
		const task = this.taskQueue.get(taskId)
		if (!task) return false

		const originalPriority = task.priority
		this._boostedPriorities.set(taskId, originalPriority)

		this.taskQueue.update(taskId, { priority: newPriority })
		this.logger.info(
			`[RAM-Scheduler] Boosted task ${taskId} priority: ${originalPriority} → ${newPriority}`,
		)
		this.emit("priorityBoosted", { taskId, originalPriority, newPriority })
		return true
	}

	/**
	 * Restore a previously boosted task to its original priority.
	 * @param {string} taskId
	 * @returns {boolean}
	 */
	restorePriority(taskId) {
		const originalPriority = this._boostedPriorities.get(taskId)
		if (originalPriority === undefined) return false

		this.taskQueue.update(taskId, { priority: originalPriority })
		this._boostedPriorities.delete(taskId)
		this.logger.info(`[RAM-Scheduler] Restored task ${taskId} priority to ${originalPriority}`)
		this.emit("priorityRestored", { taskId, originalPriority })
		return true
	}

	// ── Deferred task management ───────────────────────────────────────────────

	/**
	 * Defer a task for later execution when RAM recovers.
	 * @param {Object} task
	 * @param {string} [reason]
	 * @returns {boolean}
	 */
	deferTask(task, reason) {
		// Enforce max deferred tasks limit
		if (this._deferredTasks.length >= this.maxDeferredTasks) {
			const dropped = this._deferredTasks.shift()
			this.logger.warn(
				`[RAM-Scheduler] Deferred task queue full — dropping oldest task ${dropped.task.id}`,
			)
			this.emit("deferredTaskDropped", { taskId: dropped.task.id })
		}

		this._deferredTasks.push({
			task,
			deferredAt: Date.now(),
			reason: reason || `RAM state: ${this.ramMonitor.getCurrentState()}`,
		})

		this.logger.info(
			`[RAM-Scheduler] Deferred task ${task.id} (priority ${task.priority}): ${reason || ""}`,
		)
		this.emit("taskDeferred", { taskId: task.id, reason })
		return true
	}

	/**
	 * Re-submit all deferred tasks whose priority now meets the threshold.
	 * @returns {number} Number of tasks resubmitted
	 */
	resubmitDeferredTasks() {
		const threshold = this.getCurrentPriorityThreshold()
		if (threshold.minPriority === null) {
			// All tasks can be resubmitted
			const count = this._deferredTasks.length
			for (const deferred of this._deferredTasks) {
				this.taskQueue.add({
					type: deferred.task.type,
					input: deferred.task.input,
					priority: deferred.task.priority,
					agent: deferred.task.agent,
					sessionId: deferred.task.sessionId,
					parentTaskId: deferred.task.parentTaskId,
					metadata: {
						...deferred.task.metadata,
						wasDeferred: true,
						deferredAt: deferred.deferredAt,
					},
				})
			}
			this._deferredTasks = []
			if (count > 0) {
				this.logger.info(`[RAM-Scheduler] Resubmitted ${count} deferred tasks`)
				this.emit("deferredTasksResubmitted", { count })
			}
			return count
		}

		// Only resubmit tasks that meet the threshold
		const eligible = []
		const remaining = []

		for (const deferred of this._deferredTasks) {
			if ((deferred.task.priority ?? PRIORITY.NORMAL) <= threshold.minPriority) {
				eligible.push(deferred)
			} else {
				remaining.push(deferred)
			}
		}

		for (const deferred of eligible) {
			this.taskQueue.add({
				type: deferred.task.type,
				input: deferred.task.input,
				priority: deferred.task.priority,
				agent: deferred.task.agent,
				sessionId: deferred.task.sessionId,
				parentTaskId: deferred.task.parentTaskId,
				metadata: {
					...deferred.task.metadata,
					wasDeferred: true,
					deferredAt: deferred.deferredAt,
				},
			})
		}

		this._deferredTasks = remaining

		if (eligible.length > 0) {
			this.logger.info(
				`[RAM-Scheduler] Resubmitted ${eligible.length} eligible deferred tasks (${remaining.length} still deferred)`,
			)
			this.emit("deferredTasksResubmitted", { count: eligible.length, remaining: remaining.length })
		}

		return eligible.length
	}

	/**
	 * Get the list of currently deferred tasks.
	 * @returns {Array<{task: Object, deferredAt: number, reason: string}>}
	 */
	getDeferredTasks() {
		return [...this._deferredTasks]
	}

	/**
	 * Clear all deferred tasks (e.g., on shutdown).
	 * @returns {number} Number of cleared tasks
	 */
	clearDeferredTasks() {
		const count = this._deferredTasks.length
		this._deferredTasks = []
		if (count > 0) {
			this.logger.info(`[RAM-Scheduler] Cleared ${count} deferred tasks`)
			this.emit("deferredTasksCleared", { count })
		}
		return count
	}

	// ── RAM state handler ──────────────────────────────────────────────────────

	/**
	 * Handle RAMMonitor state change events.
	 * @param {Object} event
	 */
	_handleStateChange(event) {
		const { newState, ramPercent } = event

		switch (newState) {
			case "normal":
			case "warning":
				// RAM recovered — resubmit eligible deferred tasks
				const resubmitted = this.resubmitDeferredTasks()
				this.emit("schedulingResumed", {
					state: newState,
					ramPercent,
					deferredTasksResubmitted: resubmitted,
				})
				break

			case "critical":
			case "danger":
				// RAM pressure increasing — emit scheduling slowed/paused
				this.emit("schedulingPaused", {
					state: newState,
					ramPercent,
					threshold: this.getCurrentPriorityThreshold(),
				})
				break
		}
	}

	// ── Stats ──────────────────────────────────────────────────────────────────

	/**
	 * Get scheduler statistics.
	 * @returns {Object}
	 */
	getStats() {
		const threshold = this.getCurrentPriorityThreshold()
		return {
			ramState: this.ramMonitor.getCurrentState(),
			priorityThreshold: threshold,
			deferredTasks: this._deferredTasks.length,
			maxDeferredTasks: this.maxDeferredTasks,
			boostedTasks: this._boostedPriorities.size,
		}
	}

	/**
	 * Clean up resources. Call when shutting down.
	 */
	dispose() {
		this.ramMonitor.off("stateChange", this._onStateChange)
		this.clearDeferredTasks()
	}
}

module.exports = { RAMScheduler, PRIORITY }
