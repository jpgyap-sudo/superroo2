/**
 * DeployGate — 3-Stage Pre-Deploy Gate (Risk → Swarm → Consensus)
 *
 * Orchestrates the full pre-deploy safety pipeline:
 *   Stage 1: PredictiveFailureEngine — assess risk score
 *   Stage 2: SwarmDebugger — if risk is high/critical, run parallel debug agents
 *   Stage 3: ConsensusService — weighted vote for deploy approval
 *
 * Integration:
 * - Wires into DeployOrchestrator.deploy() as a pre-deploy gate
 * - Complements the existing consensus gate with predictive risk assessment
 * - Auto-records failure patterns when swarm debug finds issues
 *
 * Flow:
 *   Low risk      → auto-allow (no friction)
 *   Medium risk   → consensus vote required
 *   High risk     → swarm debug + consensus vote + human approval
 *   Critical risk → immediate block (no bypass)
 */

const RISK_LEVELS = Object.freeze({
	LOW: "low",
	MEDIUM: "medium",
	HIGH: "high",
	CRITICAL: "critical",
})

class DeployGate {
	/**
	 * @param {object} deps
	 * @param {import('./PredictiveFailureEngine').PredictiveFailureEngine} deps.riskEngine - Predictive failure engine
	 * @param {import('./SwarmDebugger').SwarmDebugger} deps.swarmDebugger - Swarm debug coordinator
	 * @param {import('./ConsensusService').ConsensusService} deps.consensus - Consensus voting service
	 * @param {object} [options]
	 * @param {boolean} [options.requireHumanApproval=true] - Require human approval for high risk
	 * @param {boolean} [options.autoRecordPatterns=true] - Auto-record failure patterns from swarm findings
	 */
	constructor(deps, options = {}) {
		if (!deps.riskEngine) throw new Error("DeployGate requires a riskEngine (PredictiveFailureEngine)")
		if (!deps.swarmDebugger) throw new Error("DeployGate requires a swarmDebugger (SwarmDebugger)")
		if (!deps.consensus) throw new Error("DeployGate requires a consensus (ConsensusService)")

		this.riskEngine = deps.riskEngine
		this.swarmDebugger = deps.swarmDebugger
		this.consensus = deps.consensus
		this.requireHumanApproval = options.requireHumanApproval !== false
		this.autoRecordPatterns = options.autoRecordPatterns !== false
	}

	/**
	 * Run the full 3-stage deploy gate.
	 *
	 * @param {object} input
	 * @param {string} input.projectId - Project identifier
	 * @param {string} [input.taskId] - Optional task ID
	 * @param {string} [input.deploymentId] - Deployment ID (for consensus context)
	 * @param {string} input.actionType - Action type (deploy, docker_build, etc.)
	 * @param {string[]} [input.filesChanged] - Files changed in this operation
	 * @param {string} [input.logs] - Recent log output
	 * @param {object} [input.environment] - Environment context
	 * @param {string} [input.agent='system'] - Agent initiating the deploy
	 * @returns {Promise<{allowed: boolean, reason: string, assessment: object|null, swarmResult: object|null, decision: object|null}>}
	 */
	async check(input) {
		const {
			projectId = "default",
			taskId = null,
			deploymentId = null,
			actionType = "deploy",
			filesChanged = [],
			logs = "",
			environment = {},
			agent = "system",
		} = input

		// ── Stage 1: Risk Assessment ──────────────────────────────────────
		const assessment = await this.riskEngine.assess({
			projectId,
			taskId,
			actionType,
			filesChanged,
			logs,
			environment,
		})

		// ── Stage 2: Swarm Debug (if high/critical risk) ──────────────────
		let swarmResult = null

		if (assessment.riskLevel === RISK_LEVELS.CRITICAL) {
			// Critical risk → immediate block, no bypass
			return {
				allowed: false,
				reason: `Critical risk (${Math.round(assessment.riskScore * 100)}%): ${assessment.reasons.join("; ")}. Action blocked — critical risk cannot be bypassed.`,
				assessment,
				swarmResult: null,
				decision: null,
			}
		}

		if (assessment.riskLevel === RISK_LEVELS.HIGH) {
			// High risk → run swarm debug
			swarmResult = await this.swarmDebugger.debug({
				projectId,
				taskId,
				riskAssessmentId: assessment.id,
				problem: `High-risk ${actionType}: ${assessment.reasons.join("; ")}`,
				context: { filesChanged, logs, environment },
			})

			// Auto-record failure patterns from swarm findings
			if (this.autoRecordPatterns && swarmResult.findings) {
				for (const finding of swarmResult.findings) {
					if (finding.confidence >= 0.7 && finding.finding && finding.finding !== "No finding") {
						try {
							await this.riskEngine.recordFailurePattern({
								projectId,
								patternType: `swarm-${finding.agent}`,
								signature: finding.finding.substring(0, 200),
								description: `Swarm debug finding from ${finding.agent}: ${finding.finding.substring(0, 300)}`,
								severity: "high",
								suggestedFix: finding.suggestedFix,
								source: "swarm-debug",
							})
						} catch {
							// Non-critical — pattern recording is best-effort
						}
					}
				}
			}

			if (this.requireHumanApproval) {
				return {
					allowed: false,
					reason: `High risk (${Math.round(assessment.riskScore * 100)}%): ${assessment.reasons.join("; ")}. Swarm debugging completed. Human approval required before proceeding.`,
					assessment,
					swarmResult,
					decision: null,
				}
			}
		}

		// ── Stage 3: Consensus Vote ───────────────────────────────────────
		// Medium risk → consensus vote
		// High risk (if human approval not required) → consensus vote with risk flags
		const consensusVotes = [
			{
				agent: "predictive-failure-engine",
				model: "rules+memory",
				decision: assessment.riskLevel === RISK_LEVELS.LOW ? "approve" : "needs_human",
				confidence: 1 - assessment.riskScore,
				reason: `Risk assessment: ${assessment.riskLevel} (${Math.round(assessment.riskScore * 100)}%). ${assessment.reasons.join("; ")}`,
				riskFlags: assessment.riskLevel === RISK_LEVELS.HIGH || assessment.riskLevel === RISK_LEVELS.MEDIUM
					? [`risk:${assessment.riskLevel}`, `score:${Math.round(assessment.riskScore * 100)}`]
					: [],
			},
		]

		// Add swarm debug result as a vote if available
		if (swarmResult && swarmResult.findings) {
			const highConfFindings = swarmResult.findings.filter((f) => f.confidence >= 0.5)
			if (highConfFindings.length > 0) {
				consensusVotes.push({
					agent: "swarm-debugger",
					model: "multi-agent",
					decision: highConfFindings.some((f) => f.confidence >= 0.8) ? "needs_human" : "approve",
					confidence: highConfFindings.reduce((sum, f) => sum + f.confidence, 0) / highConfFindings.length,
					reason: `Swarm debug found ${highConfFindings.length} high-confidence finding(s)`,
					riskFlags: highConfFindings.map((f) => `swarm:${f.agent}`),
				})
			}
		}

		const decision = await this.consensus.decide({
			projectId,
			decisionType: "deploy",
			contextId: deploymentId,
			votes: consensusVotes,
			createdBy: agent,
		})

		const allowed = decision.finalDecision === "approve"

		return {
			allowed,
			reason: allowed
				? `Gate passed: ${assessment.riskLevel} risk (${Math.round(assessment.riskScore * 100)}%), consensus: ${decision.finalDecision}`
				: `Gate blocked: ${assessment.riskLevel} risk (${Math.round(assessment.riskScore * 100)}%), consensus: ${decision.finalDecision}. Reasons: ${decision.reasons.join("; ")}`,
			assessment,
			swarmResult,
			decision,
		}
	}
}

module.exports = { DeployGate, RISK_LEVELS }
