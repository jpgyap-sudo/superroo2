/**
 * ModelRouter — Performance-Tracking Model Selection Layer
 *
 * Builds on top of the existing model router (api.js DEFAULT_AGENT_ROUTES)
 * by adding:
 * - Performance-based model selection using agent_scores table
 * - Fallback chains with estimated costs
 * - Outcome recording (success/failure, cost, latency, hallucination)
 * - Audit trail via brain_model_routing_logs
 *
 * Scoring formula:
 *   score = successRate * 0.5
 *         + (1 - hallucinationRate) * 0.2
 *         - costPenalty * 0.15
 *         - latencyPenalty * 0.15
 *
 * Where:
 *   successRate = success_count / MAX(total_tasks, 1)
 *   hallucinationRate = hallucination_count / MAX(total_tasks, 1)
 *   costPenalty = MIN(avg_cost_usd / maxCost, 1) where maxCost = $1.00
 *   latencyPenalty = MIN(avg_latency_ms / maxLatency, 1) where maxLatency = 60000ms
 *
 * Fallback chains per task type (from the upgrade package's FALLBACKS map):
 *   planning:    planner/gpt-5.5 ($0.08) → planner/claude ($0.06) → planner/ollama ($0.00)
 *   coding:      coder/claude ($0.10) → coder/gpt-5.5 ($0.12) → coder/deepseek ($0.02)
 *   debugging:   debugger/claude ($0.12) → debugger/gpt-5.5 ($0.14) → debugger/ollama ($0.00)
 *   qa:          qa/ollama ($0.00) → qa/gpt-5.5 ($0.06)
 *   deployment:  deploy-checker/gpt-5.5 ($0.05) → deploy-checker/claude ($0.04) → deploy-checker/ollama ($0.00)
 *   research:    researcher/gpt-5.5 ($0.07) → researcher/claude ($0.05) → researcher/deepseek ($0.01)
 *   compliance:  compliance/ollama ($0.00) → compliance/gpt-5.5 ($0.04)
 *
 * Integration:
 * - Uses existing agent_scores table (extended in v4 with hallucination_count, avg_cost_usd, avg_latency_ms)
 * - Reads from existing /model-router/routes API for dynamic route configuration
 * - Records outcomes to brain_model_routing_logs for audit trail
 */

const crypto = require("crypto")

// Default fallback chains with estimated costs
const DEFAULT_FALLBACKS = {
	planning: [
		{ agent: "planner", model: "gpt-5.5", estCost: 0.08 },
		{ agent: "planner", model: "claude", estCost: 0.06 },
		{ agent: "planner", model: "ollama", estCost: 0.00 },
	],
	coding: [
		{ agent: "coder", model: "claude", estCost: 0.10 },
		{ agent: "coder", model: "gpt-5.5", estCost: 0.12 },
		{ agent: "coder", model: "deepseek", estCost: 0.02 },
	],
	debugging: [
		{ agent: "debugger", model: "claude", estCost: 0.12 },
		{ agent: "debugger", model: "gpt-5.5", estCost: 0.14 },
		{ agent: "debugger", model: "ollama", estCost: 0.00 },
	],
	qa: [
		{ agent: "qa", model: "ollama", estCost: 0.00 },
		{ agent: "qa", model: "gpt-5.5", estCost: 0.06 },
	],
	deployment: [
		{ agent: "deploy-checker", model: "gpt-5.5", estCost: 0.05 },
		{ agent: "deploy-checker", model: "claude", estCost: 0.04 },
		{ agent: "deploy-checker", model: "ollama", estCost: 0.00 },
	],
	research: [
		{ agent: "researcher", model: "gpt-5.5", estCost: 0.07 },
		{ agent: "researcher", model: "claude", estCost: 0.05 },
		{ agent: "researcher", model: "deepseek", estCost: 0.01 },
	],
	compliance: [
		{ agent: "compliance", model: "ollama", estCost: 0.00 },
		{ agent: "compliance", model: "gpt-5.5", estCost: 0.04 },
	],
}

// Scoring weights
const SCORE_WEIGHTS = {
	successRate: 0.5,
	hallucinationRate: 0.2,
	cost: 0.15,
	latency: 0.15,
}

// Normalization caps
const MAX_COST_USD = 1.0
const MAX_LATENCY_MS = 60000

class ModelRouter {
	/**
	 * @param {import('pg').Pool} pool - Postgres connection pool
	 * @param {object} [options]
	 * @param {object} [options.fallbacks] - Custom fallback chains (overrides defaults)
	 * @param {number} [options.maxFallbackAttempts=3] - Max fallback attempts before failure
	 */
	constructor(pool, options = {}) {
		this.pool = pool
		this.fallbacks = options.fallbacks || DEFAULT_FALLBACKS
		this.maxFallbackAttempts = options.maxFallbackAttempts ?? 3
	}

	/**
	 * Select the best model for a given task type based on performance scores.
	 *
	 * @param {object} req
	 * @param {string} req.projectId - Project identifier
	 * @param {string} req.taskType - Type of task (planning, coding, debugging, etc.)
	 * @param {string} [req.taskId] - Optional task ID for audit trail
	 * @param {string} [req.runId] - Optional run ID for audit trail
	 * @returns {Promise<{agent: string, model: string, estCost: number, score: number|null, fallbackChain: object[], attempt: number}>}
	 */
	async route(req) {
		const { projectId = "default", taskType, taskId = null, runId = null } = req

		// Get fallback chain for this task type
		const chain = this.fallbacks[taskType]
		if (!chain || chain.length === 0) {
			throw new Error(`No fallback chain configured for task type "${taskType}"`)
		}

		// Limit fallback attempts
		const attempts = chain.slice(0, this.maxFallbackAttempts)

		// Try to find the best model based on performance scores
		const bestScore = await this._getBestScore(projectId, taskType)

		if (bestScore) {
			// A scored entry exists — use it as the primary selection
			const logId = crypto.randomUUID()
			await this._logRouting(logId, projectId, taskType, taskId, runId, bestScore.agent, bestScore.model, attempts, 1)

			return {
				agent: bestScore.agent,
				model: bestScore.model,
				estCost: bestScore.avg_cost_usd || 0,
				score: bestScore.score,
				fallbackChain: attempts,
				attempt: 1,
				_logId: logId,
			}
		}

		// No scored data — use the first entry in the fallback chain
		const primary = attempts[0]
		const logId = crypto.randomUUID()
		await this._logRouting(logId, projectId, taskType, taskId, runId, primary.agent, primary.model, attempts, 1)

		return {
			agent: primary.agent,
			model: primary.model,
			estCost: primary.estCost,
			score: null,
			fallbackChain: attempts,
			attempt: 1,
			_logId: logId,
		}
	}

	/**
	 * Get the best-scored agent/model for a task type.
	 * @param {string} projectId
	 * @param {string} taskType
	 * @returns {Promise<object|null>}
	 */
	async _getBestScore(projectId, taskType) {
		const result = await this.pool.query(
			`SELECT agent, model, score, total_tasks, success_count, failure_count,
					hallucination_count, avg_cost_usd, avg_latency_ms
			 FROM agent_scores
			 WHERE project_id = $1 AND task_type = $2 AND total_tasks > 0
			 ORDER BY score DESC
			 LIMIT 1`,
			[projectId, taskType],
		)

		if (result.rows.length === 0) return null

		return result.rows[0]
	}

	/**
	 * Calculate a performance score for an agent/model combination.
	 * Uses the same formula as the scoring service but with additional factors.
	 *
	 * @param {object} params
	 * @param {number} params.successCount
	 * @param {number} params.totalTasks
	 * @param {number} params.hallucinationCount
	 * @param {number} [params.avgCostUsd]
	 * @param {number} [params.avgLatencyMs]
	 * @returns {number} Score between 0 and 1
	 */
	calculateScore({ successCount, totalTasks, hallucinationCount, avgCostUsd, avgLatencyMs }) {
		const tasks = Math.max(totalTasks, 1)
		const successRate = successCount / tasks
		const hallucinationRate = Math.min(hallucinationCount / tasks, 1)
		const costPenalty = avgCostUsd != null ? Math.min(avgCostUsd / MAX_COST_USD, 1) : 0
		const latencyPenalty = avgLatencyMs != null ? Math.min(avgLatencyMs / MAX_LATENCY_MS, 1) : 0

		return (
			successRate * SCORE_WEIGHTS.successRate +
			(1 - hallucinationRate) * SCORE_WEIGHTS.hallucinationRate -
			costPenalty * SCORE_WEIGHTS.cost -
			latencyPenalty * SCORE_WEIGHTS.latency
		)
	}

	/**
	 * Record the outcome of a model routing.
	 *
	 * @param {object} outcome
	 * @param {string} outcome.projectId
	 * @param {string} outcome.taskType
	 * @param {string} outcome.agent
	 * @param {string} outcome.model
	 * @param {boolean} outcome.success
	 * @param {number} [outcome.costUsd]
	 * @param {number} [outcome.latencyMs]
	 * @param {boolean} [outcome.hallucinated=false]
	 * @param {string} [outcome.error]
	 * @param {string} [outcome.taskId]
	 * @param {string} [outcome.runId]
	 * @param {string} [outcome.logId] - The _logId from route() to update
	 * @returns {Promise<object>}
	 */
	async recordOutcome(outcome) {
		const {
			projectId = "default",
			taskType,
			agent,
			model,
			success,
			costUsd = null,
			latencyMs = null,
			hallucinated = false,
			error = null,
			taskId = null,
			runId = null,
			logId = null,
		} = outcome

		// Update the routing log entry if logId is provided
		if (logId) {
			await this.pool.query(
				`UPDATE brain_model_routing_logs
				 SET success = $1, duration_ms = $2, cost_usd = $3, hallucinated = $4, error = $5
				 WHERE id = $6`,
				[success, latencyMs, costUsd, hallucinated, error, logId],
			)
		} else {
			// Create a new log entry
			const id = crypto.randomUUID()
			await this._logRouting(id, projectId, taskType, taskId, runId, agent, model, [], 1)
			await this.pool.query(
				`UPDATE brain_model_routing_logs
				 SET success = $1, duration_ms = $2, cost_usd = $3, hallucinated = $4, error = $5
				 WHERE id = $6`,
				[success, latencyMs, costUsd, hallucinated, error, id],
			)
		}

		return { recorded: true }
	}

	/**
	 * Get routing statistics.
	 * @param {object} [filters]
	 * @param {string} [filters.projectId]
	 * @param {string} [filters.taskType]
	 * @param {string} [filters.agent]
	 * @param {number} [filters.limit=50]
	 * @returns {Promise<{rows: object[], total: number}>}
	 */
	async getRoutingLogs(filters = {}) {
		const { projectId, taskType, agent, limit = 50, offset = 0 } = filters

		const conditions = []
		const params = []
		let paramIndex = 1

		if (projectId) {
			conditions.push(`project_id = $${paramIndex++}`)
			params.push(projectId)
		}
		if (taskType) {
			conditions.push(`task_type = $${paramIndex++}`)
			params.push(taskType)
		}
		if (agent) {
			conditions.push(`agent = $${paramIndex++}`)
			params.push(agent)
		}

		const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""

		const countResult = await this.pool.query(
			`SELECT COUNT(*) as total FROM brain_model_routing_logs ${whereClause}`,
			params,
		)
		const total = parseInt(countResult.rows[0].total, 10)

		const dataResult = await this.pool.query(
			`SELECT * FROM brain_model_routing_logs ${whereClause} ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
			[...params, limit, offset],
		)

		return { rows: dataResult.rows, total }
	}

	/**
	 * Get routing performance summary.
	 * @param {string} [projectId]
	 * @returns {Promise<object[]>}
	 */
	async getPerformanceSummary(projectId) {
		const conditions = projectId ? "WHERE project_id = $1" : ""
		const params = projectId ? [projectId] : []

		const result = await this.pool.query(
			`SELECT
				agent, model_selected as model, task_type,
				COUNT(*) as total_routes,
				COUNT(*) FILTER (WHERE success = true) as success_count,
				COUNT(*) FILTER (WHERE success = false) as failure_count,
				COUNT(*) FILTER (WHERE hallucinated = true) as hallucination_count,
				ROUND(AVG(cost_usd)::numeric, 4) as avg_cost_usd,
				ROUND(AVG(duration_ms)::numeric, 0) as avg_latency_ms
			 FROM brain_model_routing_logs ${conditions}
			 GROUP BY agent, model_selected, task_type
			 ORDER BY success_count DESC`,
			params,
		)

		return result.rows
	}

	/**
	 * Internal: log a routing decision.
	 */
	async _logRouting(id, projectId, taskType, taskId, runId, agent, model, fallbackChain, attempt) {
		await this.pool.query(
			`INSERT INTO brain_model_routing_logs
				(id, project_id, task_type, task_id, run_id, agent, model_selected, fallback_chain, attempt, created_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
			[id, projectId, taskType, taskId, runId, agent, model, JSON.stringify(fallbackChain), attempt],
		)
	}
}

module.exports = { ModelRouter, DEFAULT_FALLBACKS }
