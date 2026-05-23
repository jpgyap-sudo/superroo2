/**
 * SwarmDebugger — Parallel Multi-Agent Debug Coordinator
 *
 * Runs multiple debug agents in parallel, collects findings, sorts by confidence,
 * and produces a final summary. Designed to be triggered by high-risk assessments
 * from PredictiveFailureEngine.
 *
 * Built-in agents:
 * - Logs Agent: Analyzes log output for error patterns
 * - Docker Agent: Checks Docker container health and build issues
 * - Database Agent: Checks database connection and migration issues
 * - Security Agent: Checks for security vulnerabilities
 * - Regression Agent: Checks for regression risks
 * - Memory Agent: Checks Central Brain memory for similar past issues
 *
 * Integration:
 * - Triggered by DeployGate when risk is high/critical
 * - Findings are stored in brain_swarm_runs table
 * - Results feed back into PredictiveFailureEngine as new failure patterns
 */

const crypto = require("crypto")
const { EventEmitter } = require("events")

const DEFAULT_AGENTS = Object.freeze([
	{
		name: "logs-agent",
		focus: "Log analysis — scan logs for error patterns, stack traces, and failure signatures",
	},
	{
		name: "docker-agent",
		focus: "Docker health — check container status, build issues, and compose configuration",
	},
	{
		name: "database-agent",
		focus: "Database integrity — check connection health, migration status, and query performance",
	},
	{
		name: "security-agent",
		focus: "Security audit — check for exposed secrets, vulnerable dependencies, and permission issues",
	},
	{
		name: "regression-agent",
		focus: "Regression analysis — check if changes could break existing functionality",
	},
	{
		name: "memory-agent",
		focus: "Memory recall — search Central Brain for similar past issues and their resolutions",
	},
])

class SwarmDebugger extends EventEmitter {
	/**
	 * @param {import('pg').Pool} pool - Postgres connection pool
	 * @param {object} [options]
	 * @param {Array<{name: string, focus: string, run: Function}>} [options.agents] - Custom agents
	 * @param {object} [options.ollamaClient] - Optional Ollama client for LLM-powered agents
	 * @param {object} [options.memoryService] - Optional MemoryService for memory-agent recall
	 */
	constructor(pool, options = {}) {
		super()
		this.pool = pool
		this.agents = options.agents || DEFAULT_AGENTS
		this.ollamaClient = options.ollamaClient || null
		this.memoryService = options.memoryService || null
	}

	/**
	 * Run a swarm debug session.
	 *
	 * @param {object} input
	 * @param {string} input.projectId - Project identifier
	 * @param {string} [input.taskId] - Optional task ID
	 * @param {string} [input.riskAssessmentId] - Linked risk assessment ID
	 * @param {string} input.problem - Problem description to debug
	 * @param {object} [input.context] - Additional context (filesChanged, logs, environment, etc.)
	 * @returns {Promise<{runId: string, findings: object[], finalSummary: string, status: string}>}
	 */
	async debug(input) {
		const { projectId = "default", taskId = null, riskAssessmentId = null, problem, context = {} } = input

		if (!problem) {
			throw new Error("SwarmDebugger.debug() requires a 'problem' description")
		}

		// Create swarm run record
		const runId = crypto.randomUUID()
		await this.pool.query(
			`INSERT INTO brain_swarm_runs (id, project_id, task_id, risk_assessment_id, problem, status, agents)
			 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
			[
				runId,
				projectId,
				taskId,
				riskAssessmentId,
				problem,
				"running",
				JSON.stringify(this.agents.map((a) => ({ name: a.name, focus: a.focus }))),
			],
		)

		this.emit("runStarted", { runId, projectId, riskAssessmentId, problem, agentCount: this.agents.length })

		// Run all agents in parallel
		const agentPromises = this.agents.map(async (agent) => {
			this.emit("agentStarted", { runId, agent: agent.name })
			try {
				let result
				if (typeof agent.run === "function") {
					// Custom agent with its own run function
					const runResult = await agent.run({ problem, context })
					result = {
						agent: agent.name,
						focus: agent.focus,
						finding: runResult.finding || "No finding",
						confidence: typeof runResult.confidence === "number" ? runResult.confidence : 0.5,
						suggestedFix: runResult.suggestedFix || null,
					}
				} else {
					// Built-in agent logic
					result = await this._runBuiltinAgent(agent, { problem, context })
				}
				this.emit("agentCompleted", { runId, agent: agent.name, confidence: result.confidence })
				return result
			} catch (err) {
				const failResult = {
					agent: agent.name,
					focus: agent.focus,
					finding: `Agent failed: ${err.message}`,
					confidence: 0,
					suggestedFix: null,
				}
				this.emit("agentFailed", { runId, agent: agent.name, error: err.message })
				return failResult
			}
		})

		const rawFindings = await Promise.all(agentPromises)

		// Sort by confidence descending
		const findings = rawFindings.sort((a, b) => b.confidence - a.confidence)

		// Build final summary
		const finalSummary = findings
			.map(
				(f) =>
					`- ${f.agent}: ${f.finding}${f.suggestedFix ? ` (suggested fix: ${f.suggestedFix})` : ""} (confidence: ${Math.round(f.confidence * 100)}%)`,
			)
			.join("\n")

		// Update swarm run record
		await this.pool.query(
			`UPDATE brain_swarm_runs SET status = 'completed', findings = $2, final_summary = $3, completed_at = NOW() WHERE id = $1`,
			[runId, JSON.stringify(findings), finalSummary],
		)

		// If linked to a risk assessment, update it with the swarm run ID
		if (riskAssessmentId) {
			try {
				await this.pool.query(`UPDATE brain_risk_assessments SET swarm_run_id = $1 WHERE id = $2`, [
					runId,
					riskAssessmentId,
				])
			} catch {
				// Non-critical — assessment already recorded
			}
		}

		this.emit("runCompleted", { runId, findings, status: "completed" })

		return { runId, id: runId, findings, finalSummary, status: "completed" }
	}

	/**
	 * Run a built-in agent based on its name.
	 * @private
	 */
	async _runBuiltinAgent(agent, { problem, context }) {
		const { filesChanged = [], logs = "", environment = {} } = context

		switch (agent.name) {
			case "logs-agent":
				return this._runLogsAgent(logs, problem)
			case "docker-agent":
				return this._runDockerAgent(filesChanged, problem)
			case "database-agent":
				return this._runDatabaseAgent(problem)
			case "security-agent":
				return this._runSecurityAgent(filesChanged, logs)
			case "regression-agent":
				return this._runRegressionAgent(filesChanged, problem)
			case "memory-agent":
				return await this._runMemoryAgent(problem, context)
			default:
				return {
					finding: `No built-in logic for agent "${agent.name}". Override with custom run().`,
					confidence: 0.1,
					suggestedFix: null,
				}
		}
	}

	/**
	 * Logs Agent — analyze log output for error patterns.
	 * @private
	 */
	_runLogsAgent(logs, problem) {
		if (!logs) {
			return { finding: "No logs provided for analysis", confidence: 0.3, suggestedFix: null }
		}

		const errorPatterns = [
			{ pattern: /error|exception|failed|failure/gi, label: "errors/exceptions", severity: 0.8 },
			{ pattern: /timeout|timed?\s*out/gi, label: "timeouts", severity: 0.7 },
			{ pattern: /out\s*of\s*memory|oom/gi, label: "OOM errors", severity: 0.9 },
			{ pattern: /permission\s*denied|access\s*denied/gi, label: "permission errors", severity: 0.7 },
			{ pattern: /connection\s*refused|econnrefused/gi, label: "connection errors", severity: 0.6 },
			{ pattern: /crash|segfault|abort|panic/gi, label: "crashes", severity: 0.9 },
			{ pattern: /disk\s*full|no\s*space/gi, label: "disk space", severity: 0.8 },
			{ pattern: /rate\s*limit|too\s*many\s*requests/gi, label: "rate limiting", severity: 0.5 },
		]

		const findings = []
		for (const ep of errorPatterns) {
			const matches = logs.match(ep.pattern)
			if (matches) {
				findings.push(`${matches.length} ${ep.label} detected in logs`)
			}
		}

		if (findings.length === 0) {
			return { finding: "No critical error patterns detected in logs", confidence: 0.6, suggestedFix: null }
		}

		return {
			finding: `Log analysis found ${findings.length} issue(s): ${findings.join("; ")}`,
			confidence: Math.min(0.9, 0.5 + findings.length * 0.1),
			suggestedFix: "Review log entries for the detected patterns and address each issue",
		}
	}

	/**
	 * Docker Agent — check Docker-related files for issues.
	 * @private
	 */
	_runDockerAgent(filesChanged, problem) {
		const dockerFiles = (filesChanged || []).filter((f) => /docker|compose|Dockerfile|container/i.test(f))

		if (dockerFiles.length === 0) {
			return { finding: "No Docker-related files changed in this operation", confidence: 0.5, suggestedFix: null }
		}

		return {
			finding: `${dockerFiles.length} Docker-related file(s) changed: ${dockerFiles.join(", ")}. Review for configuration issues.`,
			confidence: 0.7,
			suggestedFix:
				"Verify Dockerfile syntax, check compose file for port conflicts, and ensure image tags are correct",
		}
	}

	/**
	 * Database Agent — check for database-related risks.
	 * @private
	 */
	_runDatabaseAgent(problem) {
		const dbKeywords = /migration|schema|sql|query|database|pool|connection|pg|postgres/i
		if (dbKeywords.test(problem)) {
			return {
				finding:
					"Problem description references database operations. Check migration order, connection pool size, and query performance.",
				confidence: 0.7,
				suggestedFix:
					"Run migrations in a transaction, verify connection pool settings, and review slow queries",
			}
		}
		return {
			finding: "No database-specific issues detected in problem description",
			confidence: 0.4,
			suggestedFix: null,
		}
	}

	/**
	 * Security Agent — check for security-sensitive changes.
	 * @private
	 */
	_runSecurityAgent(filesChanged, logs) {
		const sensitiveFiles = (filesChanged || []).filter((f) =>
			/auth|secret|token|password|credential|key|\.env/i.test(f),
		)

		const securityLogs = /auth|login|token|permission|forbidden|unauthorized/i.test(logs || "")

		const issues = []
		if (sensitiveFiles.length > 0) issues.push(`${sensitiveFiles.length} sensitive file(s) changed`)
		if (securityLogs) issues.push("Security-related keywords in logs")

		if (issues.length === 0) {
			return { finding: "No security-sensitive changes detected", confidence: 0.6, suggestedFix: null }
		}

		return {
			finding: `Security audit found: ${issues.join("; ")}`,
			confidence: 0.75,
			suggestedFix:
				"Review sensitive files for exposed credentials, verify access controls, and check for hardcoded secrets",
		}
	}

	/**
	 * Regression Agent — check for regression risks.
	 * @private
	 */
	_runRegressionAgent(filesChanged, problem) {
		const criticalPaths = (filesChanged || []).filter((f) =>
			/api|route|controller|service|core|util|helper|middleware/i.test(f),
		)

		if (criticalPaths.length > 0) {
			return {
				finding: `${criticalPaths.length} critical path(s) modified: ${criticalPaths.join(", ")}. High regression risk.`,
				confidence: 0.7,
				suggestedFix: "Run full test suite, verify API contract compatibility, and check for breaking changes",
			}
		}

		return {
			finding: "No critical paths modified, regression risk appears low",
			confidence: 0.5,
			suggestedFix: null,
		}
	}

	/**
	 * Memory Agent — search Central Brain for similar past issues.
	 * @private
	 */
	async _runMemoryAgent(problem, context) {
		if (!this.memoryService) {
			return { finding: "Memory service not available for recall", confidence: 0.2, suggestedFix: null }
		}

		try {
			const memories = await this.memoryService.searchMemory({
				query: problem,
				limit: 5,
				memoryTypes: ["lesson", "bug", "pattern"],
			})

			if (!memories || memories.length === 0) {
				return {
					finding: "No similar past issues found in Central Brain memory",
					confidence: 0.4,
					suggestedFix: null,
				}
			}

			const topMemory = memories[0]
			return {
				finding: `Found ${memories.length} similar past issue(s). Top match: "${topMemory.title}" (confidence: ${Math.round((topMemory.similarity || 0.5) * 100)}%)`,
				confidence: Math.min(0.85, 0.5 + memories.length * 0.07),
				suggestedFix: topMemory.content ? topMemory.content.substring(0, 500) : null,
			}
		} catch (err) {
			return { finding: `Memory recall failed: ${err.message}`, confidence: 0.1, suggestedFix: null }
		}
	}

	/**
	 * Get a swarm run by ID.
	 *
	 * @param {string} id
	 * @returns {Promise<object|null>}
	 */
	async getRun(id) {
		const result = await this.pool.query("SELECT * FROM brain_swarm_runs WHERE id = $1", [id])
		return result.rows[0] || null
	}

	/**
	 * List swarm runs with optional filters.
	 *
	 * @param {object} [filters]
	 * @param {string} [filters.projectId]
	 * @param {string} [filters.status]
	 * @param {number} [filters.limit=50]
	 * @param {number} [filters.offset=0]
	 * @returns {Promise<{rows: object[], total: number}>}
	 */
	async listRuns(filters = {}) {
		const { projectId, status, limit = 50, offset = 0 } = filters

		const conditions = []
		const params = []
		let paramIndex = 1

		if (projectId) {
			conditions.push(`project_id = $${paramIndex++}`)
			params.push(projectId)
		}
		if (status) {
			conditions.push(`status = $${paramIndex++}`)
			params.push(status)
		}

		const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""

		const countResult = await this.pool.query(
			`SELECT COUNT(*) as total FROM brain_swarm_runs ${whereClause}`,
			params,
		)
		const total = parseInt(countResult.rows[0].total, 10)

		const dataResult = await this.pool.query(
			`SELECT * FROM brain_swarm_runs ${whereClause} ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
			[...params, limit, offset],
		)

		return { rows: dataResult.rows, total }
	}
}

module.exports = { SwarmDebugger }
