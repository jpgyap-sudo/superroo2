/**
 * AgentScoringService — Tracks agent/model performance over time
 *
 * Features:
 * - Score calculation based on success rate, recency, and complexity
 * - Per-agent, per-model, per-task-type tracking
 * - Decay factor for older scores
 * - Leaderboard queries
 */

const crypto = require("crypto")

class AgentScoringService {
	/**
	 * @param {import('./MemoryService')} memoryService
	 * @param {object} [options]
	 * @param {number} [options.decayHalfLifeDays=30] - Score half-life in days
	 * @param {number} [options.successWeight=0.6] - Weight of success rate in score
	 * @param {number} [options.recencyWeight=0.2] - Weight of recency
	 * @param {number} [options.volumeWeight=0.2] - Weight of task volume
	 */
	constructor(memoryService, options = {}) {
		this.memoryService = memoryService
		this.decayHalfLifeDays = options.decayHalfLifeDays || 30
		this.successWeight = options.successWeight || 0.6
		this.recencyWeight = options.recencyWeight || 0.2
		this.volumeWeight = options.volumeWeight || 0.2
	}

	/**
	 * Update an agent's score after a task completion.
	 *
	 * @param {object} params
	 * @param {string} params.projectId
	 * @param {string} params.agent
	 * @param {string} [params.model]
	 * @param {string} [params.taskType]
	 * @param {boolean} params.success
	 * @param {number} [params.duration] - Duration in ms
	 * @param {number} [params.usedMemories] - Number of memories used
	 * @param {number} [params.costUsd] - Cost in USD (v4)
	 * @param {number} [params.latencyMs] - Response latency in ms (v4)
	 * @param {boolean} [params.hallucinated] - Whether the agent hallucinated (v4)
	 * @returns {Promise<object>} The updated score record
	 */
	async updateScore(params) {
		const {
			projectId, agent, model = null, taskType = "general", success,
			duration = 0, usedMemories = 0,
			costUsd = null, latencyMs = null, hallucinated = false,
		} = params

		// Get or create the score record
		let scoreRecord = await this._getScoreRecord(projectId, agent, model, taskType)

		if (!scoreRecord) {
			// Create new record
			const id = crypto.randomUUID()
			await this.memoryService.query(
				`INSERT INTO agent_scores (id, project_id, agent, model, task_type, score, total_tasks,
	               success_count, failure_count, avg_duration_ms, hallucination_count, avg_cost_usd, avg_latency_ms, last_task_at)
	        VALUES ($1, $2, $3, $4, $5, 0, 0, 0, 0, 0, 0, $6, $7, NOW())`,
				[id, projectId, agent, model, taskType, costUsd, latencyMs],
			)
			scoreRecord = {
				id,
				project_id: projectId,
				agent,
				model,
				task_type: taskType,
				score: 0,
				total_tasks: 0,
				success_count: 0,
				failure_count: 0,
				avg_duration_ms: 0,
				hallucination_count: 0,
				avg_cost_usd: costUsd,
				avg_latency_ms: latencyMs,
			}
		}

		// Update counters
		const newTotal = scoreRecord.total_tasks + 1
		const newSuccesses = scoreRecord.success_count + (success ? 1 : 0)
		const newFailures = scoreRecord.failure_count + (success ? 0 : 1)
		const newAvgDuration =
			scoreRecord.total_tasks === 0
				? duration
				: Math.round((scoreRecord.avg_duration_ms * scoreRecord.total_tasks + duration) / newTotal)

		// v4: Update hallucination count
		const newHallucinationCount = scoreRecord.hallucination_count + (hallucinated ? 1 : 0)

		// v4: Update running averages for cost and latency
		const newAvgCostUsd =
			costUsd != null
				? scoreRecord.total_tasks === 0
					? costUsd
					: Math.round(((scoreRecord.avg_cost_usd || 0) * scoreRecord.total_tasks + costUsd) / newTotal * 10000) / 10000
				: scoreRecord.avg_cost_usd

		const newAvgLatencyMs =
			latencyMs != null
				? scoreRecord.total_tasks === 0
					? latencyMs
					: Math.round(((scoreRecord.avg_latency_ms || 0) * scoreRecord.total_tasks + latencyMs) / newTotal)
				: scoreRecord.avg_latency_ms

		// Calculate new score
		const newScore = this._calculateScore({
			successRate: newSuccesses / newTotal,
			totalTasks: newTotal,
			avgDuration: newAvgDuration,
			usedMemories,
		})

		// Update the record
		await this.memoryService.query(
			`UPDATE agent_scores
	      SET score = $1, total_tasks = $2, success_count = $3, failure_count = $4,
	          avg_duration_ms = $5, hallucination_count = $6, avg_cost_usd = $7, avg_latency_ms = $8,
	          last_task_at = NOW(), updated_at = NOW()
	      WHERE id = $9`,
			[newScore, newTotal, newSuccesses, newFailures, newAvgDuration, newHallucinationCount, newAvgCostUsd, newAvgLatencyMs, scoreRecord.id],
		)

		return {
			id: scoreRecord.id,
			agent,
			model,
			taskType,
			score: newScore,
			totalTasks: newTotal,
			successCount: newSuccesses,
			failureCount: newFailures,
			avgDurationMs: newAvgDuration,
			hallucinationCount: newHallucinationCount,
			avgCostUsd: newAvgCostUsd,
			avgLatencyMs: newAvgLatencyMs,
			successRate: newSuccesses / newTotal,
		}
	}

	/**
	 * Calculate a composite score from metrics.
	 * Range: 0-100
	 */
	_calculateScore({ successRate, totalTasks, avgDuration, usedMemories }) {
		// Success component (0-60)
		const successComponent = successRate * 60

		// Recency component (0-20) - more tasks = more reliable
		const recencyComponent = Math.min(totalTasks / 50, 1) * 20

		// Volume component (0-20)
		const volumeComponent = Math.min(totalTasks / 100, 1) * 20

		// Bonus for using memories (up to 5 extra points)
		const memoryBonus = Math.min(usedMemories / 10, 1) * 5

		// Penalty for very slow tasks (duration > 5 min)
		const speedPenalty = avgDuration > 300000 ? 10 : 0

		const rawScore = successComponent + recencyComponent + volumeComponent + memoryBonus - speedPenalty

		return Math.max(0, Math.min(100, Math.round(rawScore * 10) / 10))
	}

	/**
	 * Get the leaderboard of agents by score.
	 */
	async getLeaderboard(projectId, limit = 20) {
		const result = await this.memoryService.query(
			`SELECT agent, model, task_type, score, total_tasks, success_count, failure_count,
              avg_duration_ms, last_task_at
       FROM agent_scores
       WHERE project_id = $1
       ORDER BY score DESC
       LIMIT $2`,
			[projectId, limit],
		)
		return result.rows || []
	}

	/**
	 * Get scores for a specific agent.
	 */
	async getAgentScores(projectId, agent) {
		const result = await this.memoryService.query(
			`SELECT * FROM agent_scores
       WHERE project_id = $1 AND agent = $2
       ORDER BY score DESC`,
			[projectId, agent],
		)
		return result.rows || []
	}

	/**
	 * Get the best model for a task type.
	 * v4: Also returns hallucination_count, avg_cost_usd, avg_latency_ms
	 */
	async getBestModelForTask(projectId, taskType) {
		const result = await this.memoryService.query(
			`SELECT agent, model, score, total_tasks, success_count, failure_count,
	             hallucination_count, avg_cost_usd, avg_latency_ms
	      FROM agent_scores
	      WHERE project_id = $1 AND task_type = $2 AND total_tasks >= 3
	      ORDER BY score DESC
	      LIMIT 1`,
			[projectId, taskType],
		)
		return result.rows[0] || null
	}

	/**
	 * Apply time-based decay to all scores.
	 * Scores decrease by half every `decayHalfLifeDays` days of inactivity.
	 */
	async applyDecay(projectId) {
		const result = await this.memoryService.query(
			`UPDATE agent_scores
       SET score = score * POWER(0.5, EXTRACT(EPOCH FROM (NOW() - last_task_at)) / ($2 * 86400)),
           updated_at = NOW()
       WHERE project_id = $1
       AND last_task_at IS NOT NULL
       AND last_task_at < NOW() - ($2 || ' days')::INTERVAL`,
			[projectId, this.decayHalfLifeDays],
		)
		return result.rowCount || 0
	}

	/**
	 * Get internal score record.
	 * v4: Returns all columns including hallucination_count, avg_cost_usd, avg_latency_ms
	 */
	async _getScoreRecord(projectId, agent, model, taskType) {
		const result = await this.memoryService.query(
			`SELECT * FROM agent_scores
	      WHERE project_id = $1 AND agent = $2
	      AND (model = $3 OR ($3 IS NULL AND model IS NULL))
	      AND task_type = $4`,
			[projectId, agent, model, taskType],
		)
		return result.rows[0] || null
	}
}

module.exports = { AgentScoringService }
