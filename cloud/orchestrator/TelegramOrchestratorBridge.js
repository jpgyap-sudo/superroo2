/**
 * TelegramOrchestratorBridge — Connects the Telegram bot to the Cloud Orchestrator.
 *
 * The Telegram bot currently manages tasks in-memory via a Map<chatId, CodingTask[]>.
 * This bridge replaces that in-memory approach with the orchestrator's SQLite-backed
 * task queue, while maintaining backward compatibility with the existing telegramBot API.
 *
 * Integration points:
 *   - telegramBot.handleUpdate() → orchestrator.submit() for task creation
 *   - telegramBot.userTasks → orchestrator.taskQueue.list() for task listing
 *   - Task status updates → orchestrator.taskQueue.update()
 *   - Event logging → orchestrator.eventLog.record()
 *   - TaskStateMachine → validated status transitions with event bus fan-out
 */

const { assertTransition, isTerminal } = require("./modules/TaskStateMachine")
const { eventBus } = require("./modules/SuperRooEventBus")

class TelegramOrchestratorBridge {
	/**
	 * @param {import('./CloudOrchestrator')} orchestrator
	 */
	constructor(orchestrator) {
		this.orchestrator = orchestrator
	}

	/**
	 * Submit a Telegram task to the orchestrator.
	 * Returns a task object compatible with the telegramBot's CodingTask format.
	 *
	 * @param {object} input
	 * @param {number|string} input.chatId
	 * @param {string} input.instruction
	 * @param {string} [input.agentId='coder']
	 * @param {string} [input.agentType] - Fallback if agentId is not provided
	 * @param {string} [input.tgTaskId] - Pre-generated Telegram task ID (preserves provenance)
	 * @param {string} [input.source] - Source of the task (e.g. "/code", "nlp")
	 * @param {string} [input.branchName]
	 * @returns {object} Task in telegramBot-compatible format
	 */
	createTask(input) {
		const rawAgent = input.agentId || input.agentType || "coder"
		// Map orchestrator agent to "orchestrator" type so CloudOrchestrator.processNext()
		// routes it through TaskExecutor for multi-agent breakdown planning.
		const resolvedAgent = rawAgent === "superroo-orchestrator-agent" ? "orchestrator" : rawAgent
		const taskId =
			input.tgTaskId ||
			"TG-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).slice(2, 6).toUpperCase()
		const branchName = input.branchName || "tg/" + taskId.toLowerCase()

		// Submit to orchestrator's task queue
		const task = this.orchestrator.submit({
			type: resolvedAgent,
			input: { instruction: input.instruction, chatId: input.chatId },
			agent: rawAgent,
			sessionId: String(input.chatId),
			metadata: {
				source: input.source || "telegram",
				chatId: input.chatId,
				taskId,
				branchName,
				tgTaskId: input.tgTaskId || null,
			},
		})

		// Emit task creation event to SuperRooEventBus (SSE subscribers + EventLog)
		eventBus.emit(taskId, "user_message", {
			goal: input.instruction,
			source: "telegram",
			chatId: input.chatId,
			agentId: resolvedAgent,
		})

		// Return in telegramBot-compatible format
		return {
			id: taskId,
			orchestratorTaskId: task.id,
			instruction: input.instruction,
			status: "queued",
			agentId: resolvedAgent,
			branchName: branchName,
			changedFiles: 0,
			linesAdded: 0,
			createdAt: new Date().toISOString(),
		}
	}

	/**
	 * submitDirect — Lightweight fallback that calls orchestrator.submit() directly
	 * without eventBus emissions. Used when createTask() fails (e.g., eventBus down).
	 * This ensures the fallback path still routes through the orchestrator's SQLite
	 * task queue and TaskExecutor, rather than bypassing to a raw BullMQ queue.
	 *
	 * @param {Object} input
	 * @param {string} [input.tgTaskId] - Telegram task ID
	 * @param {number|string} input.chatId - Telegram chat ID
	 * @param {string} input.instruction - Coding instruction
	 * @param {string} [input.agentId] - Agent ID (default: "superroo-orchestrator-agent")
	 * @param {string} [input.branchName] - Git branch name
	 * @param {string} [input.source] - Source label (default: "telegram")
	 * @returns {Object} Task result with orchestratorTaskId
	 */
	submitDirect(input) {
		const rawAgent = input.agentId || input.agentType || "superroo-orchestrator-agent"
		const resolvedAgent = rawAgent === "superroo-orchestrator-agent" ? "orchestrator" : rawAgent
		const taskId =
			input.tgTaskId ||
			"TG-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).slice(2, 6).toUpperCase()
		const branchName = input.branchName || "tg/" + taskId.toLowerCase()

		const task = this.orchestrator.submit({
			type: resolvedAgent,
			input: { instruction: input.instruction, chatId: input.chatId },
			agent: rawAgent,
			sessionId: String(input.chatId),
			metadata: {
				source: input.source || "telegram",
				chatId: input.chatId,
				taskId,
				branchName,
				tgTaskId: input.tgTaskId || null,
				fallback: true,
			},
		})

		return {
			id: taskId,
			orchestratorTaskId: task.id,
			instruction: input.instruction,
			status: "queued",
			agentId: resolvedAgent,
			branchName: branchName,
			changedFiles: 0,
			linesAdded: 0,
			createdAt: new Date().toISOString(),
		}
	}

	/**
	 * List tasks for a given chat (session).
	 * @param {number|string} chatId
	 * @param {number} [limit=50]
	 * @returns {Array<object>} Tasks in telegramBot-compatible format
	 */
	listTasks(chatId, limit = 50) {
		const tasks = this.orchestrator.taskQueue.list({
			sessionId: String(chatId),
			limit,
		})

		return tasks.map((t) => ({
			id: t.metadata?.taskId || t.id,
			orchestratorTaskId: t.id,
			instruction: t.input?.instruction || JSON.stringify(t.input),
			status: this._mapStatus(t.status),
			agentId: t.agent || "coder",
			branchName: t.metadata?.branchName || "",
			changedFiles: 0,
			linesAdded: 0,
			createdAt: new Date(t.createdAt).toISOString(),
		}))
	}

	/**
	 * Get a specific task by its Telegram task ID.
	 * @param {string} tgTaskId
	 * @returns {object|null}
	 */
	getTask(tgTaskId) {
		// Search across all tasks (could optimize with a lookup index)
		const allTasks = this.orchestrator.taskQueue.list({ limit: 500 })
		const found = allTasks.find((t) => t.metadata?.taskId === tgTaskId)
		if (!found) return null

		return {
			id: tgTaskId,
			orchestratorTaskId: found.id,
			instruction: found.input?.instruction || JSON.stringify(found.input),
			status: this._mapStatus(found.status),
			agentId: found.agent || "coder",
			branchName: found.metadata?.branchName || "",
			changedFiles: 0,
			linesAdded: 0,
			createdAt: new Date(found.createdAt).toISOString(),
		}
	}

	/**
	 * Update a task's status.
	 * @param {string} tgTaskId
	 * @param {string} status
	 * @returns {boolean}
	 */
	updateTaskStatus(tgTaskId, status) {
		const allTasks = this.orchestrator.taskQueue.list({ limit: 500 })
		const found = allTasks.find((t) => t.metadata?.taskId === tgTaskId)
		if (!found) return false

		const mappedStatus = this._reverseMapStatus(status)

		// Validate transition via TaskStateMachine.
		// Map the current orchestrator status back to a SuperRoo TaskStatus for validation.
		const currentSuperRooStatus = this._toSuperRooStatus(found.status)
		const targetSuperRooStatus = this._toSuperRooStatus(mappedStatus)
		try {
			if (currentSuperRooStatus && targetSuperRooStatus) {
				assertTransition(currentSuperRooStatus, targetSuperRooStatus)
			}
		} catch (err) {
			console.warn(`[TelegramOrchestratorBridge] ${err.message} — proceeding anyway for legacy compat`)
		}

		// Skip update if already in a terminal state
		if (isTerminal(currentSuperRooStatus)) {
			console.warn(
				`[TelegramOrchestratorBridge] Task ${tgTaskId} is in terminal state "${currentSuperRooStatus}", ignoring status update to "${status}"`,
			)
			return false
		}

		this.orchestrator.taskQueue.update(found.id, { status: mappedStatus })

		// Emit transition event to SuperRooEventBus for real-time dashboard updates
		eventBus.emit(tgTaskId, "task_transition", {
			from: currentSuperRooStatus || found.status,
			to: targetSuperRooStatus || mappedStatus,
			orchestratorTaskId: found.id,
		})

		this.orchestrator.eventLog.record({
			type: "telegram.task_status_changed",
			source: "TelegramOrchestratorBridge",
			severity: "info",
			payload: { tgTaskId, status, orchestratorTaskId: found.id },
			taskId: found.id,
			sessionId: found.sessionId,
		})

		return true
	}

	/**
	 * Map an orchestrator task status string to a SuperRoo TaskStatus enum value.
	 * Returns null if no mapping exists (avoids crashing on unknown statuses).
	 * @param {string} status
	 * @returns {string|null}
	 */
	_toSuperRooStatus(status) {
		const map = {
			pending: "queued",
			queued: "queued",
			running: "running",
			completed: "completed",
			failed: "failed",
			cancelled: "failed",
			// SuperRoo-native statuses pass through unchanged
			preparing: "preparing",
			loading_context: "loading_context",
			planning: "planning",
			testing: "testing",
			reviewing: "reviewing",
			repairing: "repairing",
			needs_user_approval: "needs_user_approval",
		}
		return map[status] ?? null
	}

	/**
	 * Get orchestrator stats for the Telegram dashboard.
	 * @returns {object}
	 */
	getStats() {
		const taskStats = this.orchestrator.taskQueue.getStats()
		const eventStats = this.orchestrator.eventLog.getStats()
		const status = this.orchestrator.getStatus()

		return {
			tasks: taskStats,
			events: eventStats,
			orchestrator: {
				running: status.running,
				mode: status.mode,
				uptime: status.uptime,
				modules: Object.entries(status.modules)
					.filter(([, loaded]) => loaded)
					.map(([name]) => name),
			},
		}
	}

	/**
	 * Map orchestrator task status to telegramBot status.
	 * @param {string} status
	 * @returns {string}
	 */
	_mapStatus(status) {
		const map = {
			pending: "queued",
			running: "coding",
			completed: "approved",
			failed: "failed",
			cancelled: "cancelled",
		}
		return map[status] || status
	}

	/**
	 * Map telegramBot status back to orchestrator status.
	 * @param {string} status
	 * @returns {string}
	 */
	_reverseMapStatus(status) {
		const map = {
			queued: "pending",
			coding: "running",
			approved: "completed",
			review: "running",
			deployed: "completed",
			rejected: "cancelled",
		}
		return map[status] || status
	}
}

module.exports = TelegramOrchestratorBridge
