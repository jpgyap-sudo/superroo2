/**
 * SuperRoo Task State Machine — OpenHands-style 11-state task lifecycle.
 *
 * States mirror the task lifecycle from Telegram message → code → tests → repair → done.
 * Use assertTransition() before every status update to catch invalid flows early.
 *
 * State diagram (abridged):
 *   queued → preparing → loading_context → planning → running
 *   running → testing → reviewing → completed
 *   Any state → repairing → running | testing | failed
 *   Any non-terminal → needs_user_approval → running | failed
 *   failed → queued  (retry)
 */

/** @typedef {'queued'|'preparing'|'loading_context'|'planning'|'running'|'testing'|'reviewing'|'repairing'|'completed'|'failed'|'needs_user_approval'} TaskStatus */

/** @type {Record<TaskStatus, TaskStatus[]>} */
const ALLOWED = {
	queued: ["preparing", "failed"],
	preparing: ["loading_context", "needs_user_approval", "failed"],
	loading_context: ["planning", "failed"],
	planning: ["running", "needs_user_approval", "failed"],
	running: ["testing", "repairing", "completed", "failed"],
	testing: ["reviewing", "repairing", "completed", "failed"],
	reviewing: ["completed", "repairing", "needs_user_approval", "failed"],
	repairing: ["running", "testing", "failed", "needs_user_approval"],
	completed: [],
	failed: ["queued"],
	needs_user_approval: ["running", "failed"],
}

/** Terminal states — no further transitions allowed. */
const TERMINAL = new Set(["completed", "failed"])

/**
 * Assert that a transition from `from` → `to` is valid.
 * Throws a descriptive error on invalid transitions.
 *
 * @param {TaskStatus} from
 * @param {TaskStatus} to
 * @throws {Error}
 */
function assertTransition(from, to) {
	if (!ALLOWED[from]) {
		throw new Error(`[TaskStateMachine] Unknown status: "${from}"`)
	}
	if (!ALLOWED[from].includes(to)) {
		throw new Error(`[TaskStateMachine] Invalid transition: ${from} → ${to}`)
	}
}

/**
 * Returns the allowed next states from a given status.
 * @param {TaskStatus} status
 * @returns {TaskStatus[]}
 */
function nextAllowed(status) {
	return (ALLOWED[status] ?? []).slice()
}

/**
 * Returns true if the status is a terminal state.
 * @param {TaskStatus} status
 * @returns {boolean}
 */
function isTerminal(status) {
	return TERMINAL.has(status)
}

/**
 * Apply a transition to a task object (mutates and returns the task).
 * Emits an event to eventBus if provided.
 *
 * @param {object} task - Task object with at least { id, status }
 * @param {TaskStatus} to - Target status
 * @param {object} [eventBus] - Optional SuperRooEventBus instance
 * @param {Record<string, unknown>} [meta] - Optional extra metadata
 * @returns {object} The mutated task
 */
function transition(task, to, eventBus, meta = {}) {
	assertTransition(task.status, to)
	const from = task.status
	task.status = to
	task.updatedAt = new Date().toISOString()

	if (eventBus) {
		eventBus.emit(task.id, "task_transition", { from, to, ...meta })
	}

	return task
}

module.exports = { ALLOWED, TERMINAL, assertTransition, nextAllowed, isTerminal, transition }
