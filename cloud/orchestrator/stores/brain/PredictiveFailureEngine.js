/**
 * PredictiveFailureEngine — Risk Scoring with Historical Pattern Matching
 *
 * Scores actions (deploy, db_migration, delete, etc.) based on:
 * - Action type (base risk)
 * - Files changed (sensitive patterns like docker, auth, payment, billing)
 * - Log keywords (timeout, OOM, exception, permission denied)
 * - Historical failure patterns from brain_failure_patterns table
 *
 * Integration:
 * - Wires into DeployOrchestrator as a pre-consensus risk gate
 * - Wires into SelfHealingLoop to auto-record failure patterns from incidents
 * - Complements ConsensusService by providing risk-based voting input
 *
 * Risk thresholds:
 *   score < 0.4   → low    (auto-allow, no friction)
 *   score 0.4-0.75 → medium (consensus vote required)
 *   score >= 0.75  → high   (block + swarm debug + human approval)
 *   score >= 0.9   → critical (immediate block, no bypass)
 */

const crypto = require("crypto")

const ACTION_BASE_RISKS = Object.freeze({
	deploy: 0.2,
	docker_build: 0.15,
	db_migration: 0.25,
	send_message: 0.05,
	delete: 0.7,
	large_refactor: 0.3,
	config_change: 0.15,
	restart: 0.1,
})

const VALID_ACTION_TYPES = new Set(Object.keys(ACTION_BASE_RISKS))

// File patterns that increase risk
const SENSITIVE_FILE_PATTERNS = [
	{ pattern: /docker|compose|Dockerfile/i, risk: 0.2, reason: "Docker-related files changed" },
	{ pattern: /auth|secret|credential|token|password/i, risk: 0.25, reason: "Auth/secret-related files changed" },
	{ pattern: /env|\.env/i, risk: 0.15, reason: "Environment configuration changed" },
	{ pattern: /payment|billing|stripe|checkout|invoice/i, risk: 0.3, reason: "Payment/billing files changed" },
	{ pattern: /migration|schema|migrate/i, risk: 0.2, reason: "Database schema/migration files changed" },
	{ pattern: /deploy|release|ci|cd|pipeline/i, risk: 0.15, reason: "Deployment/CI pipeline files changed" },
	{ pattern: /config|configuration|settings/i, risk: 0.1, reason: "Configuration files changed" },
	{ pattern: /api|route|endpoint|controller/i, risk: 0.1, reason: "API/route files changed" },
	{ pattern: /admin|sudo|root|privilege/i, risk: 0.2, reason: "Privilege-related files changed" },
]

// Log keywords that indicate failures
const FAILURE_LOG_KEYWORDS = [
	{ pattern: /timeout|timed?\s*out/i, risk: 0.2, reason: "Logs contain timeout keywords" },
	{ pattern: /out\s*of\s*memory|oom|memory\s*exhausted/i, risk: 0.25, reason: "Logs contain OOM keywords" },
	{ pattern: /failed|failure|error\s*occurred/i, risk: 0.15, reason: "Logs contain failure keywords" },
	{ pattern: /exception|uncaught|unhandled/i, risk: 0.2, reason: "Logs contain exception keywords" },
	{
		pattern: /permission\s*denied|access\s*denied|forbidden|unauthorized/i,
		risk: 0.2,
		reason: "Logs contain permission denied keywords",
	},
	{ pattern: /crash|segfault|abort|panic/i, risk: 0.3, reason: "Logs contain crash keywords" },
	{ pattern: /disk\s*full|no\s*space|quota\s*exceeded/i, risk: 0.2, reason: "Logs contain disk space keywords" },
	{
		pattern: /connection\s*refused|econnrefused|cannot\s*connect/i,
		risk: 0.15,
		reason: "Logs contain connection refused keywords",
	},
	{ pattern: /rate\s*limit|too\s*many\s*requests|429/i, risk: 0.1, reason: "Logs contain rate limit keywords" },
]

class PredictiveFailureEngine {
	/**
	 * @param {import('pg').Pool} pool - Postgres connection pool
	 * @param {object} [options]
	 * @param {number} [options.lowThreshold=0.4] - Score threshold for low risk
	 * @param {number} [options.highThreshold=0.75] - Score threshold for high risk
	 * @param {number} [options.criticalThreshold=0.9] - Score threshold for critical risk
	 * @param {number} [options.maxPatterns=20] - Max historical patterns to match against
	 */
	constructor(pool, options = {}) {
		this.pool = pool
		this.lowThreshold = options.lowThreshold ?? 0.4
		this.highThreshold = options.highThreshold ?? 0.75
		this.criticalThreshold = options.criticalThreshold ?? 0.9
		this.maxPatterns = options.maxPatterns ?? 20
	}

	/**
	 * Assess risk for a given action.
	 *
	 * @param {object} input
	 * @param {string} input.projectId - Project identifier
	 * @param {string} [input.taskId] - Optional task ID
	 * @param {string} input.actionType - Type of action (deploy, docker_build, db_migration, etc.)
	 * @param {string[]} [input.filesChanged] - List of files changed
	 * @param {string} [input.logs] - Recent log output
	 * @param {object} [input.environment] - Optional environment context
	 * @returns {Promise<{id: string, projectId: string, taskId: string|null, actionType: string, riskScore: number, riskLevel: string, reasons: string[], matchedPatterns: object[], swarmRunId: string|null, createdAt: string}>}
	 */
	async assess(input) {
		const {
			projectId = "default",
			taskId = null,
			actionType,
			filesChanged = [],
			logs = "",
			environment = {},
		} = input

		if (!VALID_ACTION_TYPES.has(actionType)) {
			throw new Error(
				`Invalid actionType "${actionType}". Must be one of: ${Array.from(VALID_ACTION_TYPES).join(", ")}`,
			)
		}

		const reasons = []
		let score = 0

		// 1. Base risk from action type
		score += ACTION_BASE_RISKS[actionType]
		reasons.push(`Action type "${actionType}" has base risk ${ACTION_BASE_RISKS[actionType]}`)

		// 2. File pattern matching
		const fileHaystack = (filesChanged || []).join("\n")
		for (const fp of SENSITIVE_FILE_PATTERNS) {
			if (fp.pattern.test(fileHaystack)) {
				score += fp.risk
				reasons.push(fp.reason)
			}
		}

		// 3. Log keyword matching
		if (logs) {
			for (const lk of FAILURE_LOG_KEYWORDS) {
				if (lk.pattern.test(logs)) {
					score += lk.risk
					reasons.push(lk.reason)
				}
			}
		}

		// 4. Historical failure pattern matching
		const matchedPatterns = []
		try {
			const patternRows = await this.pool.query(
				`SELECT * FROM brain_failure_patterns WHERE project_id = $1 ORDER BY occurrences DESC, last_seen_at DESC LIMIT $2`,
				[projectId, this.maxPatterns],
			)

			const haystack = `${fileHaystack}\n${logs || ""}`.toLowerCase()
			for (const p of patternRows.rows) {
				const signature = String(p.signature).toLowerCase()
				if (haystack.includes(signature)) {
					const patternRisk =
						p.severity === "critical"
							? 0.35
							: p.severity === "high"
								? 0.25
								: p.severity === "medium"
									? 0.15
									: 0.05
					score += patternRisk
					reasons.push(
						`Matched historical failure pattern: ${p.description} (severity: ${p.severity}, occurrences: ${p.occurrences})`,
					)
					matchedPatterns.push({
						id: p.id,
						pattern_type: p.pattern_type,
						signature: p.signature,
						description: p.description,
						severity: p.severity,
						occurrences: p.occurrences,
					})
				}
			}
		} catch (err) {
			// If pattern matching fails (e.g., table doesn't exist yet), continue without it
			console.warn(`[PredictiveFailureEngine] Pattern matching failed: ${err.message}`)
		}

		// Clamp score to [0, 1]
		score = Math.max(0, Math.min(1, score))

		// Determine risk level
		let riskLevel
		if (score >= this.criticalThreshold) {
			riskLevel = "critical"
		} else if (score >= this.highThreshold) {
			riskLevel = "high"
		} else if (score >= this.lowThreshold) {
			riskLevel = "medium"
		} else {
			riskLevel = "low"
		}

		// Persist assessment
		const id = crypto.randomUUID()
		await this.pool.query(
			`INSERT INTO brain_risk_assessments (id, project_id, task_id, action_type, risk_score, risk_level, reasons, matched_patterns)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			[
				id,
				projectId,
				taskId,
				actionType,
				score,
				riskLevel,
				JSON.stringify(reasons),
				JSON.stringify(matchedPatterns),
			],
		)

		return {
			id,
			projectId,
			taskId,
			actionType,
			riskScore: score,
			riskLevel,
			reasons,
			matchedPatterns,
			swarmRunId: null,
			createdAt: new Date().toISOString(),
		}
	}

	/**
	 * Record a new failure pattern from an incident.
	 * Used by SelfHealingLoop to auto-populate the pattern database.
	 *
	 * @param {object} input
	 * @param {string} input.projectId - Project identifier
	 * @param {string} input.patternType - Type of pattern (e.g., 'deploy-failure', 'oom', 'timeout')
	 * @param {string} input.signature - Keyword/signature to match against future actions
	 * @param {string} input.description - Human-readable description
	 * @param {string} [input.severity='medium'] - Severity level (low, medium, high, critical)
	 * @param {string} [input.suggestedFix] - Optional suggested fix
	 * @param {string} [input.source='self-healing'] - Source of the pattern
	 */
	async recordFailurePattern(input) {
		const {
			projectId = "default",
			patternType,
			signature,
			description,
			severity = "medium",
			suggestedFix = null,
			source = "self-healing",
		} = input

		if (!patternType || !signature || !description) {
			throw new Error("recordFailurePattern requires patternType, signature, and description")
		}

		if (!["low", "medium", "high", "critical"].includes(severity)) {
			throw new Error(`Invalid severity "${severity}". Must be one of: low, medium, high, critical`)
		}

		const id = crypto.randomUUID()
		await this.pool.query(
			`INSERT INTO brain_failure_patterns (id, project_id, pattern_type, signature, description, severity, suggested_fix, source)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			[id, projectId, patternType, signature, description, severity, suggestedFix, source],
		)

		return { id }
	}

	/**
	 * Increment occurrence count for a failure pattern.
	 * Called when a pattern is matched again.
	 *
	 * @param {string} patternId - ID of the pattern to increment
	 */
	async incrementPatternOccurrence(patternId) {
		await this.pool.query(
			`UPDATE brain_failure_patterns SET occurrences = occurrences + 1, last_seen_at = NOW() WHERE id = $1`,
			[patternId],
		)
	}

	/**
	 * Get recent risk assessments.
	 *
	 * @param {object} [filters]
	 * @param {string} [filters.projectId]
	 * @param {string} [filters.riskLevel]
	 * @param {string} [filters.actionType]
	 * @param {number} [filters.limit=50]
	 * @param {number} [filters.offset=0]
	 * @returns {Promise<{rows: object[], total: number}>}
	 */
	async getAssessments(filters = {}) {
		const { projectId, riskLevel, actionType, limit = 50, offset = 0 } = filters

		const conditions = []
		const params = []
		let paramIndex = 1

		if (projectId) {
			conditions.push(`project_id = $${paramIndex++}`)
			params.push(projectId)
		}
		if (riskLevel) {
			conditions.push(`risk_level = $${paramIndex++}`)
			params.push(riskLevel)
		}
		if (actionType) {
			conditions.push(`action_type = $${paramIndex++}`)
			params.push(actionType)
		}

		const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""

		const countResult = await this.pool.query(
			`SELECT COUNT(*) as total FROM brain_risk_assessments ${whereClause}`,
			params,
		)
		const total = parseInt(countResult.rows[0].total, 10)

		const dataResult = await this.pool.query(
			`SELECT * FROM brain_risk_assessments ${whereClause} ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
			[...params, limit, offset],
		)

		return { rows: dataResult.rows, total }
	}

	/**
	 * Get failure patterns with optional filters.
	 *
	 * @param {object} [filters]
	 * @param {string} [filters.projectId]
	 * @param {string} [filters.severity]
	 * @param {string} [filters.patternType]
	 * @param {number} [filters.limit=50]
	 * @param {number} [filters.offset=0]
	 * @returns {Promise<{rows: object[], total: number}>}
	 */
	async getFailurePatterns(filters = {}) {
		const { projectId, severity, patternType, limit = 50, offset = 0 } = filters

		const conditions = []
		const params = []
		let paramIndex = 1

		if (projectId) {
			conditions.push(`project_id = $${paramIndex++}`)
			params.push(projectId)
		}
		if (severity) {
			conditions.push(`severity = $${paramIndex++}`)
			params.push(severity)
		}
		if (patternType) {
			conditions.push(`pattern_type = $${paramIndex++}`)
			params.push(patternType)
		}

		const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""

		const countResult = await this.pool.query(
			`SELECT COUNT(*) as total FROM brain_failure_patterns ${whereClause}`,
			params,
		)
		const total = parseInt(countResult.rows[0].total, 10)

		const dataResult = await this.pool.query(
			`SELECT * FROM brain_failure_patterns ${whereClause} ORDER BY occurrences DESC, last_seen_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
			[...params, limit, offset],
		)

		return { rows: dataResult.rows, total }
	}

	/**
	 * Get risk statistics.
	 *
	 * @param {string} [projectId]
	 * @returns {Promise<object>}
	 */
	async getStats(projectId) {
		const projectFilter = projectId ? "WHERE project_id = $1" : ""
		const params = projectId ? [projectId] : []

		const result = await this.pool.query(
			`SELECT
				COUNT(*)::int as total_assessments,
				COUNT(*) FILTER (WHERE risk_level = 'critical')::int as critical_count,
				COUNT(*) FILTER (WHERE risk_level = 'high')::int as high_count,
				COUNT(*) FILTER (WHERE risk_level = 'medium')::int as medium_count,
				COUNT(*) FILTER (WHERE risk_level = 'low')::int as low_count,
				ROUND(AVG(risk_score)::numeric, 3)::float as avg_risk_score,
				ROUND(MAX(risk_score)::numeric, 3)::float as max_risk_score
			FROM brain_risk_assessments ${projectFilter}`,
			params,
		)

		const patternResult = await this.pool.query(
			`SELECT
				COUNT(*)::int as total_patterns,
				SUM(occurrences)::int as total_occurrences
			FROM brain_failure_patterns ${projectFilter}`,
			params,
		)

		const byActionTypeResult = await this.pool.query(
			`SELECT action_type, COUNT(*)::int as count
			 FROM brain_risk_assessments ${projectFilter}
			 GROUP BY action_type`,
			params,
		)

		const patternsBySeverityResult = await this.pool.query(
			`SELECT severity, COUNT(*)::int as count
			 FROM brain_failure_patterns ${projectFilter}
			 GROUP BY severity`,
			params,
		)

		const patternsByTypeResult = await this.pool.query(
			`SELECT pattern_type, COUNT(*)::int as count
			 FROM brain_failure_patterns ${projectFilter}
			 GROUP BY pattern_type`,
			params,
		)

		const ra = result.rows[0] || {
			total_assessments: 0,
			critical_count: 0,
			high_count: 0,
			medium_count: 0,
			low_count: 0,
			avg_risk_score: 0,
			max_risk_score: 0,
		}
		const pr = patternResult.rows[0] || { total_patterns: 0, total_occurrences: 0 }

		const byActionType = {}
		for (const row of byActionTypeResult.rows) byActionType[row.action_type] = row.count

		const patternsBySeverity = {}
		for (const row of patternsBySeverityResult.rows) patternsBySeverity[row.severity] = row.count

		const patternsByType = {}
		for (const row of patternsByTypeResult.rows) patternsByType[row.pattern_type] = row.count

		return {
			totalAssessments: ra.total_assessments,
			byLevel: {
				critical: ra.critical_count,
				high: ra.high_count,
				medium: ra.medium_count,
				low: ra.low_count,
			},
			byActionType,
			totalPatterns: pr.total_patterns,
			patternsBySeverity,
			patternsByType,
			avgRiskScore: ra.avg_risk_score,
			maxRiskScore: ra.max_risk_score,
			totalOccurrences: pr.total_occurrences,
		}
	}
}

module.exports = { PredictiveFailureEngine }
