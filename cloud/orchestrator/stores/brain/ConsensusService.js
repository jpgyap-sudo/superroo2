/**
 * ConsensusService — Multi-Agent Weighted Voting System
 *
 * Provides weighted consensus decision-making for critical operations:
 * - Deploy approvals (pre-deployment gate)
 * - Memory approval (additional pre-gate before MemoryApprovalService)
 * - Task approval (high-risk task validation)
 * - Model selection (multi-agent model routing validation)
 *
 * Integration with existing systems:
 * - Wires into DeployOrchestrator as a pre-deploy gate
 * - Complements MemoryApprovalService as an additional consensus layer
 * - Records decisions to brain_consensus_decisions for audit trail
 *
 * Decision weights:
 *   approve      = +1.0
 *   revise       = -0.2
 *   needs_human  = -0.5
 *   block        = -1.0
 *
 * Thresholds:
 *   >= 0.45  → approve
 *   <= -0.45 → block
 *   else     → revise (needs changes)
 *
 * Risk flag override:
 *   If decision_type = 'deploy' and ANY vote has riskFlags,
 *   the final decision is automatically 'block'.
 */

const crypto = require("crypto")

const DECISION_WEIGHTS = Object.freeze({
	approve: 1.0,
	revise: -0.2,
	needs_human: -0.5,
	block: -1.0,
})

const VALID_DECISIONS = new Set(Object.keys(DECISION_WEIGHTS))
const VALID_DECISION_TYPES = new Set(["deploy", "memory_approval", "task_approval", "model_selection", "custom"])
const VALID_FINAL_DECISIONS = new Set(["approve", "revise", "needs_human", "block"])

const APPROVE_THRESHOLD = 0.45
const BLOCK_THRESHOLD = -0.45

class ConsensusService {
	/**
	 * @param {import('pg').Pool} pool - Postgres connection pool
	 * @param {object} [options]
	 * @param {number} [options.approveThreshold=0.45] - Score threshold for approval
	 * @param {number} [options.blockThreshold=-0.45] - Score threshold for blocking
	 * @param {number} [options.minVoters=1] - Minimum number of voters required
	 */
	constructor(pool, options = {}) {
		this.pool = pool
		this.approveThreshold = options.approveThreshold ?? APPROVE_THRESHOLD
		this.blockThreshold = options.blockThreshold ?? BLOCK_THRESHOLD
		this.minVoters = options.minVoters ?? 1
	}

	/**
	 * Run a weighted consensus vote.
	 *
	 * @param {object} input
	 * @param {string} input.projectId - Project identifier
	 * @param {string} input.decisionType - Type of decision (deploy, memory_approval, task_approval, model_selection, custom)
	 * @param {string} [input.contextId] - ID of the thing being decided
	 * @param {Array<{agent: string, model?: string, decision: string, confidence: number, reason?: string, riskFlags?: string[]}>} input.votes
	 * @param {string} [input.createdBy='system'] - Who initiated the vote
	 * @returns {Promise<{id: string, score: number, finalDecision: string, riskFlags: string[], reasons: string[], agentCount: number}>}
	 */
	async decide(input) {
		const { projectId = "default", decisionType, contextId = null, votes = [], createdBy = "system" } = input

		// Validate decision type
		if (!VALID_DECISION_TYPES.has(decisionType)) {
			throw new Error(
				`Invalid decisionType "${decisionType}". Must be one of: ${Array.from(VALID_DECISION_TYPES).join(", ")}`,
			)
		}

		// Validate votes
		if (!Array.isArray(votes) || votes.length === 0) {
			throw new Error("At least one vote is required")
		}

		for (const vote of votes) {
			if (!vote.agent) throw new Error("Each vote must have an 'agent' field")
			if (!VALID_DECISIONS.has(vote.decision)) {
				throw new Error(
					`Invalid decision "${vote.decision}" for agent "${vote.agent}". Must be one of: ${Array.from(VALID_DECISIONS).join(", ")}`,
				)
			}
			if (typeof vote.confidence !== "number" || vote.confidence < 0 || vote.confidence > 1) {
				throw new Error(`Vote confidence for "${vote.agent}" must be a number between 0 and 1`)
			}
		}

		if (votes.length < this.minVoters) {
			throw new Error(`At least ${this.minVoters} voter(s) required, got ${votes.length}`)
		}

		// Calculate weighted score
		let score = 0
		let totalWeight = 0
		const reasons = []
		const riskFlags = new Set()

		for (const vote of votes) {
			const weight = DECISION_WEIGHTS[vote.decision]
			const confidence = Math.max(0, Math.min(1, vote.confidence))
			score += weight * confidence
			totalWeight += confidence

			const reasonStr = `${vote.agent}${vote.model ? `/${vote.model}` : ""}: ${vote.decision} (confidence: ${confidence.toFixed(2)})${vote.reason ? ` — ${vote.reason}` : ""}`
			reasons.push(reasonStr)

			if (vote.riskFlags && Array.isArray(vote.riskFlags)) {
				vote.riskFlags.forEach((f) => riskFlags.add(f))
			}
		}

		// Normalize score to [-1, 1]
		const normalizedScore = totalWeight > 0 ? score / totalWeight : 0

		// Determine final decision
		let finalDecision
		if (riskFlags.size > 0 && decisionType === "deploy") {
			// Risk flag override: deploy decisions with risk flags are automatically blocked
			finalDecision = "block"
		} else if (normalizedScore >= this.approveThreshold) {
			finalDecision = "approve"
		} else if (normalizedScore <= this.blockThreshold) {
			finalDecision = "block"
		} else {
			finalDecision = "revise"
		}

		// Persist decision
		const id = crypto.randomUUID()
		const sanitizedVotes = votes.map((v) => ({
			agent: v.agent,
			model: v.model || null,
			decision: v.decision,
			confidence: Math.max(0, Math.min(1, v.confidence)),
			reason: v.reason || null,
			riskFlags: v.riskFlags || [],
		}))

		await this.pool.query(
			`INSERT INTO brain_consensus_decisions
				(id, project_id, decision_type, context_id, votes, score, final_decision, risk_flags, agent_count, created_by, created_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
			[
				id,
				projectId,
				decisionType,
				contextId,
				JSON.stringify(sanitizedVotes),
				normalizedScore,
				finalDecision,
				Array.from(riskFlags),
				votes.length,
				createdBy,
			],
		)

		return {
			id,
			score: normalizedScore,
			finalDecision,
			riskFlags: Array.from(riskFlags),
			reasons,
			agentCount: votes.length,
		}
	}

	/**
	 * Get a consensus decision by ID.
	 * @param {string} id
	 * @returns {Promise<object|null>}
	 */
	async getDecision(id) {
		const result = await this.pool.query(
			"SELECT * FROM brain_consensus_decisions WHERE id = $1",
			[id],
		)
		return result.rows[0] || null
	}

	/**
	 * List consensus decisions with optional filters.
	 * @param {object} [filters]
	 * @param {string} [filters.projectId]
	 * @param {string} [filters.decisionType]
	 * @param {string} [filters.finalDecision]
	 * @param {string} [filters.contextId]
	 * @param {number} [filters.limit=50]
	 * @param {number} [filters.offset=0]
	 * @returns {Promise<{rows: object[], total: number}>}
	 */
	async listDecisions(filters = {}) {
		const { projectId, decisionType, finalDecision, contextId, limit = 50, offset = 0 } = filters

		const conditions = []
		const params = []
		let paramIndex = 1

		if (projectId) {
			conditions.push(`project_id = $${paramIndex++}`)
			params.push(projectId)
		}
		if (decisionType) {
			conditions.push(`decision_type = $${paramIndex++}`)
			params.push(decisionType)
		}
		if (finalDecision) {
			conditions.push(`final_decision = $${paramIndex++}`)
			params.push(finalDecision)
		}
		if (contextId) {
			conditions.push(`context_id = $${paramIndex++}`)
			params.push(contextId)
		}

		const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""

		const countResult = await this.pool.query(
			`SELECT COUNT(*) as total FROM brain_consensus_decisions ${whereClause}`,
			params,
		)
		const total = parseInt(countResult.rows[0].total, 10)

		const dataResult = await this.pool.query(
			`SELECT * FROM brain_consensus_decisions ${whereClause} ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
			[...params, limit, offset],
		)

		return { rows: dataResult.rows, total }
	}

	/**
	 * Get consensus statistics.
	 * @param {string} [projectId]
	 * @returns {Promise<object>}
	 */
	async getStats(projectId) {
		const conditions = projectId ? "WHERE project_id = $1" : ""
		const params = projectId ? [projectId] : []

		const result = await this.pool.query(
			`SELECT
				COUNT(*) as total_decisions,
				COUNT(*) FILTER (WHERE final_decision = 'approve') as approved,
				COUNT(*) FILTER (WHERE final_decision = 'block') as blocked,
				COUNT(*) FILTER (WHERE final_decision = 'revise') as revised,
				COUNT(*) FILTER (WHERE final_decision = 'needs_human') as needs_human,
				ROUND(AVG(score)::numeric, 4) as avg_score,
				ROUND(AVG(agent_count)::numeric, 1) as avg_voters
			 FROM brain_consensus_decisions ${conditions}`,
			params,
		)

		return result.rows[0] || { total_decisions: 0, approved: 0, blocked: 0, revised: 0, needs_human: 0, avg_score: 0, avg_voters: 0 }
	}
}

module.exports = { ConsensusService }
