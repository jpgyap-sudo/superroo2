/**
 * Coding Trajectory Recorder
 *
 * Records every action (tool call, LLM response, file change, test result)
 * during a coding session as a structured trajectory for replay, analysis,
 * and debugging. Inspired by SWE-agent's trajectory recording system.
 *
 * Each trajectory is a chronological sequence of steps:
 *   { type, timestamp, input, output, success, durationMs, metadata }
 *
 * Trajectories are stored in-memory with optional Redis persistence
 * (24h TTL) and can be exported for analysis or replay.
 *
 * @module telegramCodingTrajectory
 */

const crypto = require("crypto")

// ─── Configuration ──────────────────────────────────────────────────────────

/** Maximum number of steps per trajectory before auto-finalization */
const MAX_STEPS_PER_TRAJECTORY = 200

/** Maximum number of trajectories to keep in memory */
const MAX_TRAJECTORIES = 100

/** Default TTL for Redis persistence (24 hours) */
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000

// ─── In-Memory Store ────────────────────────────────────────────────────────

/** @type {Map<string, CodingTrajectory>} */
const _trajectories = new Map()

// ─── Trajectory Class ───────────────────────────────────────────────────────

class CodingTrajectory {
	/**
	 * @param {string} taskId - Unique identifier for this coding session
	 * @param {Object} [meta] - Optional metadata
	 * @param {string} [meta.userId] - Telegram user ID
	 * @param {string} [meta.chatId] - Telegram chat ID
	 * @param {string} [meta.projectName] - Project being worked on
	 * @param {string} [meta.instruction] - Original coding instruction
	 * @param {string} [meta.agentId] - Agent handling the task
	 */
	constructor(taskId, meta = {}) {
		this.taskId = taskId
		this.metadata = {
			startedAt: Date.now(),
			userId: meta.userId || null,
			chatId: meta.chatId || null,
			projectName: meta.projectName || null,
			instruction: meta.instruction || null,
			agentId: meta.agentId || "superroo-coder-agent",
			...meta,
		}
		/** @type {Array<Object>} */
		this.steps = []
		/** @type {string} "active" | "completed" | "failed" | "cancelled" */
		this.status = "active"
		/** @type {string|null} */
		this.error = null
		/** @type {number|null} */
		this.completedAt = null
	}

	/**
	 * Record a step in the trajectory.
	 * @param {string} type - Step type: "tool_call" | "llm_response" | "file_change" | "test_result" | "error" | "user_input" | "approval"
	 * @param {Object} data - Step data
	 * @param {*} data.input - Input to the step (command, prompt, etc.)
	 * @param {*} [data.output] - Output from the step
	 * @param {boolean} [data.success=true] - Whether the step succeeded
	 * @param {number} [data.durationMs] - Duration of the step in ms
	 * @param {Object} [data.metadata] - Additional metadata
	 * @returns {Object} The recorded step
	 */
	recordStep(type, data) {
		if (this.status !== "active") {
			console.warn("[CodingTrajectory] Cannot record step on " + this.status + " trajectory " + this.taskId)
			return null
		}

		if (this.steps.length >= MAX_STEPS_PER_TRAJECTORY) {
			console.warn(
				"[CodingTrajectory] Max steps (" +
					MAX_STEPS_PER_TRAJECTORY +
					") reached for " +
					this.taskId +
					" — auto-finalizing",
			)
			this.finalize("completed", "Max steps reached")
			return null
		}

		var step = {
			id: this.steps.length + 1,
			type: type,
			timestamp: Date.now(),
			input: data.input,
			output: data.output !== undefined ? data.output : null,
			success: data.success !== undefined ? data.success : true,
			durationMs: data.durationMs || null,
			metadata: data.metadata || {},
		}

		this.steps.push(step)
		return step
	}

	/**
	 * Record a tool call step.
	 * @param {string} toolName - Tool name (e.g., "search_file", "edit_file", "view_file")
	 * @param {Object} args - Tool arguments
	 * @param {Object} [result] - Tool result
	 * @param {number} [durationMs] - Duration in ms
	 * @returns {Object} The recorded step
	 */
	recordToolCall(toolName, args, result, durationMs) {
		return this.recordStep("tool_call", {
			input: { tool: toolName, args: args },
			output: result,
			success: result && !result.error,
			durationMs: durationMs,
			metadata: { toolName: toolName },
		})
	}

	/**
	 * Record a file change.
	 * @param {string} filePath - Path to the changed file
	 * @param {"create"|"modify"|"delete"} changeType - Type of change
	 * @param {string} [diff] - Unified diff of the change
	 * @param {number} [linesAdded] - Lines added
	 * @param {number} [linesRemoved] - Lines removed
	 * @returns {Object} The recorded step
	 */
	recordFileChange(filePath, changeType, diff, linesAdded, linesRemoved) {
		return this.recordStep("file_change", {
			input: { filePath: filePath, changeType: changeType },
			output: {
				diff: diff ? diff.slice(0, 5000) : null,
				linesAdded: linesAdded || 0,
				linesRemoved: linesRemoved || 0,
			},
			success: true,
			metadata: { filePath: filePath, changeType: changeType },
		})
	}

	/**
	 * Record a test result.
	 * @param {string} testFramework - Framework name (e.g., "vitest", "jest")
	 * @param {Object} result - Test result object
	 * @param {number} result.passed - Number of passed tests
	 * @param {number} result.failed - Number of failed tests
	 * @param {number} result.total - Total tests
	 * @param {string} [result.output] - Raw test output
	 * @returns {Object} The recorded step
	 */
	recordTestResult(testFramework, result) {
		var success = result.failed === 0
		return this.recordStep("test_result", {
			input: { framework: testFramework },
			output: {
				passed: result.passed || 0,
				failed: result.failed || 0,
				total: result.total || 0,
				output: result.output ? result.output.slice(0, 3000) : null,
			},
			success: success,
			metadata: { framework: testFramework },
		})
	}

	/**
	 * Record an error.
	 * @param {string} source - Error source
	 * @param {string} message - Error message
	 * @param {Object} [details] - Additional error details
	 * @returns {Object} The recorded step
	 */
	recordError(source, message, details) {
		return this.recordStep("error", {
			input: { source: source, message: message },
			output: details || null,
			success: false,
			metadata: { source: source },
		})
	}

	/**
	 * Finalize the trajectory.
	 * @param {"completed"|"failed"|"cancelled"} status - Final status
	 * @param {string} [reason] - Optional reason for finalization
	 */
	finalize(status, reason) {
		this.status = status
		this.completedAt = Date.now()
		if (reason) {
			this.error = reason
		}
	}

	/**
	 * Get a summary of the trajectory.
	 * @returns {Object} Summary object
	 */
	getSummary() {
		var toolCalls = this.steps.filter(function (s) {
			return s.type === "tool_call"
		})
		var fileChanges = this.steps.filter(function (s) {
			return s.type === "file_change"
		})
		var testResults = this.steps.filter(function (s) {
			return s.type === "test_result"
		})
		var errors = this.steps.filter(function (s) {
			return s.type === "error"
		})

		var totalDuration = this.completedAt
			? this.completedAt - this.metadata.startedAt
			: Date.now() - this.metadata.startedAt

		return {
			taskId: this.taskId,
			status: this.status,
			durationMs: totalDuration,
			totalSteps: this.steps.length,
			toolCalls: toolCalls.length,
			fileChanges: fileChanges.length,
			testResults: testResults.length,
			errors: errors.length,
			error: this.error,
			startedAt: this.metadata.startedAt,
			completedAt: this.completedAt,
			instruction: this.metadata.instruction,
			projectName: this.metadata.projectName,
		}
	}

	/**
	 * Export the full trajectory as a plain object.
	 * @returns {Object} Serializable trajectory
	 */
	toJSON() {
		return {
			taskId: this.taskId,
			metadata: this.metadata,
			status: this.status,
			error: this.error,
			startedAt: this.metadata.startedAt,
			completedAt: this.completedAt,
			steps: this.steps,
			summary: this.getSummary(),
		}
	}
}

// ─── Trajectory Manager ─────────────────────────────────────────────────────

/**
 * Create a new trajectory for a coding session.
 * @param {string} taskId - Unique task identifier
 * @param {Object} [meta] - Optional metadata
 * @returns {CodingTrajectory}
 */
function createTrajectory(taskId, meta) {
	// Enforce max trajectories limit — evict oldest completed/failed
	if (_trajectories.size >= MAX_TRAJECTORIES) {
		var oldestKey = null
		var oldestTime = Infinity
		for (var entry of _trajectories.entries()) {
			var t = entry[1]
			if (t.status !== "active" && t.metadata.startedAt < oldestTime) {
				oldestTime = t.metadata.startedAt
				oldestKey = entry[0]
			}
		}
		if (oldestKey) {
			_trajectories.delete(oldestKey)
			console.log("[CodingTrajectory] Evicted old trajectory " + oldestKey)
		}
	}

	var trajectory = new CodingTrajectory(taskId, meta)
	_trajectories.set(taskId, trajectory)
	return trajectory
}

/**
 * Get an existing trajectory by task ID.
 * @param {string} taskId
 * @returns {CodingTrajectory|undefined}
 */
function getTrajectory(taskId) {
	return _trajectories.get(taskId)
}

/**
 * Get all trajectories, optionally filtered by status.
 * @param {string} [status] - Filter by status: "active" | "completed" | "failed" | "cancelled"
 * @returns {Array<CodingTrajectory>}
 */
function listTrajectories(status) {
	var result = []
	for (var entry of _trajectories.values()) {
		if (!status || entry.status === status) {
			result.push(entry)
		}
	}
	// Sort by startedAt descending (newest first)
	result.sort(function (a, b) {
		return b.metadata.startedAt - a.metadata.startedAt
	})
	return result
}

/**
 * Get trajectory summaries (lightweight, no full steps).
 * @param {string} [status] - Filter by status
 * @returns {Array<Object>}
 */
function getTrajectorySummaries(status) {
	return listTrajectories(status).map(function (t) {
		return t.getSummary()
	})
}

/**
 * Finalize a trajectory.
 * @param {string} taskId
 * @param {"completed"|"failed"|"cancelled"} status
 * @param {string} [reason]
 * @returns {boolean} Whether the trajectory was found and finalized
 */
function finalizeTrajectory(taskId, status, reason) {
	var t = _trajectories.get(taskId)
	if (!t) return false
	t.finalize(status, reason)
	return true
}

/**
 * Get aggregate stats across all trajectories.
 * @returns {Object}
 */
function getTrajectoryStats() {
	var total = _trajectories.size
	var byStatus = {}
	var totalSteps = 0
	var totalErrors = 0
	var totalFileChanges = 0
	var totalDurationMs = 0

	for (var entry of _trajectories.values()) {
		var t = entry
		byStatus[t.status] = (byStatus[t.status] || 0) + 1
		totalSteps += t.steps.length
		totalErrors += t.steps.filter(function (s) {
			return s.type === "error"
		}).length
		totalFileChanges += t.steps.filter(function (s) {
			return s.type === "file_change"
		}).length
		if (t.completedAt) {
			totalDurationMs += t.completedAt - t.metadata.startedAt
		}
	}

	return {
		total: total,
		byStatus: byStatus,
		totalSteps: totalSteps,
		totalErrors: totalErrors,
		totalFileChanges: totalFileChanges,
		totalDurationMs: totalDurationMs,
		averageDurationMs: total > 0 ? Math.round(totalDurationMs / total) : 0,
	}
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
	CodingTrajectory,
	createTrajectory,
	getTrajectory,
	listTrajectories,
	getTrajectorySummaries,
	finalizeTrajectory,
	getTrajectoryStats,
}
