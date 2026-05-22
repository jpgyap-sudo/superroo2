/**
 * AgentRunWrapper — Mandatory memory enforcement wrapper
 *
 * Every agent run MUST go through this wrapper to ensure:
 * 1. Memory is recalled before the agent starts (context injection)
 * 2. A lesson is saved after the agent completes
 * 3. The agent's score is updated
 * 4. Safety limits are enforced (max memories, max tokens, dangerous patterns)
 * 5. (v4) Model routing selects the best agent/model based on performance scores
 * 6. (v4) Consensus voting gates high-risk operations
 *
 * This is the "mandatory enforcement" layer of Central Brain v2/v4.
 */

const crypto = require("crypto")

const DEFAULT_LIMITS = {
	maxMemoriesPerTask: 10,
	maxContextTokens: 4000,
	minImportanceThreshold: 0.3,
	requireApprovalForTypes: ["bug", "pattern"],
	maxRetries: 2,
}

// Task types that trigger consensus voting before execution
const HIGH_RISK_TASK_TYPES = new Set(["deployment", "compliance", "security"])

class AgentRunWrapper {
	/**
	 * @param {import('./MemoryService')} memoryService
	 * @param {import('./EmbeddingService')} embeddingService
	 * @param {import('./AgentScoringService')} scoringService
	 * @param {import('./BrainEventBus')} eventBus
	 * @param {import('./MemoryApprovalService')} approvalService
	 * @param {object} [limits]
	 * @param {import('./ModelRouter')} [modelRouter] - v4: performance-tracking model router
	 * @param {import('./ConsensusService')} [consensus] - v4: multi-agent consensus voting
	 */
	constructor(memoryService, embeddingService, scoringService, eventBus, approvalService, limits = {}) {
		this.memoryService = memoryService
		this.embeddingService = embeddingService
		this.scoringService = scoringService
		this.eventBus = eventBus
		this.approvalService = approvalService
		this.limits = { ...DEFAULT_LIMITS, ...limits }
		this.modelRouter = null  // Set via setModelRouter()
		this.consensus = null    // Set via setConsensus()
	}

	/**
	 * Set the model router service (v4).
	 * @param {import('./ModelRouter')} modelRouter
	 */
	setModelRouter(modelRouter) {
		this.modelRouter = modelRouter
	}

	/**
	 * Set the consensus service (v4).
	 * @param {import('./ConsensusService')} consensus
	 */
	setConsensus(consensus) {
		this.consensus = consensus
	}

	/**
	 * Run an agent task with full memory enforcement.
	 *
	 * @param {object} agent - The agent object (must have .name, .model, .run(task))
	 * @param {object} task - { id?, projectId, goal, priority?, tags?, files? }
	 * @returns {Promise<{runId: string, taskId: string, memories: Array, lesson: object|null, score: object|null, duration: number}>}
	 */
	async run(agent, task) {
		const startTime = Date.now()
		const taskId = task.id || crypto.randomUUID()
		const projectId = task.projectId || "default"
		const runId = crypto.randomUUID()
		const taskType = task.type || "general"

		// Track routing info for outcome recording
		let routingInfo = null

		try {
			// 1. (v4) Model routing: select best agent/model based on performance
			if (this.modelRouter && taskType !== "general") {
				try {
					const route = await this.modelRouter.route({
						projectId,
						taskType,
						taskId,
						runId,
					})
					routingInfo = route
					// Override agent with the routed selection
					agent = {
						...agent,
						name: route.agent,
						model: route.model,
					}
				} catch (err) {
					// Fall through with original agent if routing fails
				}
			}

			// 2. (v4) Consensus check for high-risk tasks
			if (this.consensus && HIGH_RISK_TASK_TYPES.has(taskType)) {
				try {
					const consensusResult = await this.consensus.decide({
						projectId,
						decisionType: "task_approval",
						contextId: taskId,
						votes: [
							{
								agent: agent.name || "unknown",
								model: agent.model || null,
								decision: "approve",
								confidence: 0.8,
								reason: `Auto-approve task: ${task.goal?.substring(0, 100)}`,
							},
						],
						createdBy: "agent-run-wrapper",
					})

					if (consensusResult.finalDecision === "block") {
						throw new Error(`Consensus blocked task "${task.goal}": ${consensusResult.reasons.join("; ")}`)
					}
				} catch (err) {
					if (err.message?.includes("Consensus blocked")) {
						throw err
					}
					// Fall through if consensus service is unavailable
				}
			}

			// 3. Record task start
			await this.memoryService.query(
				`INSERT INTO agent_tasks (id, project_id, goal, agent, model, status, priority, tags, files)
	        VALUES ($1, $2, $3, $4, $5, 'running', $6, $7, $8)
	        ON CONFLICT (id) DO UPDATE SET status = 'running', updated_at = NOW()`,
				[
					taskId,
					projectId,
					task.goal,
					agent.name || "unknown",
					agent.model || null,
					task.priority || 0,
					task.tags || [],
					task.files || [],
				],
			)

			// 4. Record agent run
			await this.memoryService.query(
				`INSERT INTO agent_runs (id, task_id, agent, model, status, input_summary)
	        VALUES ($1, $2, $3, $4, 'running', $5)`,
				[runId, taskId, agent.name || "unknown", agent.model || null, task.goal],
			)

			// 5. Recall relevant memories (context injection)
			const memories = await this._recallMemories(projectId, task.goal, agent)

			// 6. Emit brain event: recall
			await this.eventBus.emit(projectId, "memory.recall", {
				taskId,
				runId,
				agent: agent.name,
				memoryCount: memories.length,
			})

			// 7. Run the agent with memory context
			const agentInput = {
				...task,
				memories, // injected context
			}

			let agentResult
			let lastError = null

			for (let attempt = 0; attempt <= this.limits.maxRetries; attempt++) {
				try {
					agentResult = await agent.run(agentInput)
					break
				} catch (err) {
					lastError = err
					if (attempt < this.limits.maxRetries) {
						// Wait briefly before retry (exponential backoff)
						await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)))
					}
				}
			}

			if (!agentResult && lastError) {
				throw lastError
			}

			const duration = Date.now() - startTime

			// 8. Extract and save lesson from agent output
			const lesson = await this._saveLesson(projectId, task, agent, runId, taskId, agentResult)

			// 9. Update agent score (v4: includes hallucination, cost, latency)
			const score = await this.scoringService.updateScore({
				projectId,
				agent: agent.name,
				model: agent.model,
				taskType,
				success: true,
				duration,
				usedMemories: memories.length,
				costUsd: agentResult?.costUsd || null,
				latencyMs: duration,
				hallucinated: agentResult?.hallucinated || false,
			})

			// 10. (v4) Record routing outcome
			if (this.modelRouter && routingInfo) {
				try {
					await this.modelRouter.recordOutcome({
						projectId,
						taskType,
						agent: agent.name,
						model: agent.model,
						success: true,
						costUsd: agentResult?.costUsd || null,
						latencyMs: duration,
						hallucinated: agentResult?.hallucinated || false,
						taskId,
						runId,
						logId: routingInfo._logId,
					})
				} catch (err) {
					// Non-blocking
				}
			}

			// 11. Mark task and run as completed
			await this.memoryService.query(
				`UPDATE agent_tasks SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = $1`,
				[taskId],
			)
			await this.memoryService.query(
				`UPDATE agent_runs SET status = 'completed', output_summary = $1, lesson_id = $2,
	               completed_at = NOW(), duration_ms = $3
	        WHERE id = $4`,
				[agentResult?.summary || task.goal, lesson?.id || null, duration, runId],
			)

			// 12. Emit brain event: completion
			await this.eventBus.emit(projectId, "memory.agent_completed", {
				taskId,
				runId,
				agent: agent.name,
				duration,
				lessonId: lesson?.id,
				routingAgent: routingInfo?.agent,
				routingModel: routingInfo?.model,
			})

			return { runId, taskId, memories, lesson, score, duration, routingInfo }
		} catch (error) {
			const duration = Date.now() - startTime

			// Mark as failed
			await this.memoryService
				.query(`UPDATE agent_tasks SET status = 'failed', updated_at = NOW() WHERE id = $1`, [taskId])
				.catch(() => {})

			await this.memoryService
				.query(
					`UPDATE agent_runs SET status = 'failed', completed_at = NOW(), duration_ms = $1 WHERE id = $2`,
					[duration, runId],
				)
				.catch(() => {})

			// Update score with failure (v4: includes hallucination, cost, latency)
			await this.scoringService
				.updateScore({
					projectId: task.projectId || "default",
					agent: agent.name || "unknown",
					model: agent.model,
					taskType,
					success: false,
					duration,
					usedMemories: 0,
				})
				.catch(() => {})

			// (v4) Record routing outcome as failure
			if (this.modelRouter && routingInfo) {
				try {
					await this.modelRouter.recordOutcome({
						projectId,
						taskType,
						agent: agent.name,
						model: agent.model,
						success: false,
						error: error.message,
						taskId,
						runId,
						logId: routingInfo._logId,
					})
				} catch (err) {
					// Non-blocking
				}
			}

			// Emit failure event
			await this.eventBus
				.emit(task.projectId || "default", "memory.agent_failed", {
					taskId,
					runId,
					agent: agent.name,
					error: error.message,
					duration,
				})
				.catch(() => {})

			throw error
		}
	}

	/**
	 * Recall memories relevant to the task goal.
	 * Enforces maxMemoriesPerTask and minImportanceThreshold limits.
	 */
	async _recallMemories(projectId, goal, agent) {
		try {
			const results = await this.memoryService.searchMemory({
				projectId,
				query: goal,
				limit: this.limits.maxMemoriesPerTask,
				minImportance: this.limits.minImportanceThreshold,
				status: "approved",
			})

			// Log each recall
			for (const mem of results) {
				await this.memoryService.logRecall({
					memoryId: mem.id,
					projectId,
					agent: agent.name || "unknown",
					model: agent.model,
					similarity: mem.similarity,
				})
			}

			return results
		} catch (err) {
			// If pgvector is unavailable, return empty (graceful degradation)
			return []
		}
	}

	/**
	 * Extract and save a lesson from the agent's output.
	 * Uses MemoryApprovalService to check if approval is needed.
	 */
	async _saveLesson(projectId, task, agent, runId, taskId, agentResult) {
		if (!agentResult || !agentResult.lesson) {
			return null
		}

		const lessonData = {
			projectId,
			agent: agent.name || "unknown",
			model: agent.model,
			title: agentResult.lesson.title || `Lesson from: ${task.goal}`,
			summary: agentResult.lesson.summary || task.goal,
			content:
				typeof agentResult.lesson.content === "string"
					? agentResult.lesson.content
					: JSON.stringify(agentResult.lesson.content),
			memoryType: agentResult.lesson.memoryType || "lesson",
			tags: agentResult.lesson.tags || task.tags || [],
			files: agentResult.lesson.files || task.files || [],
			importance: agentResult.lesson.importance || 0.5,
			confidence: agentResult.lesson.confidence || 0.7,
			sourceTaskId: taskId,
			sourceRunId: runId,
		}

		// Sanitize content (redact secrets, API keys, etc.)
		const sanitized = this.approvalService.sanitizeLesson(lessonData.content)
		lessonData.content = sanitized

		// Check if approval is required
		const needsApproval = this.approvalService.shouldRequireApproval(lessonData)

		// Create the memory
		const memoryId = await this.memoryService.createMemory(lessonData)

		if (needsApproval) {
			// Queue for approval
			await this.memoryService.query(
				`INSERT INTO memory_approval_queue (id, memory_id, project_id, requested_by, reason)
         VALUES ($1, $2, $3, $4, $5)`,
				[
					crypto.randomUUID(),
					memoryId,
					projectId,
					agent.name || "unknown",
					`Auto-queued: memory_type=${lessonData.memoryType}, confidence=${lessonData.confidence}`,
				],
			)

			await this.eventBus.emit(projectId, "memory.approval_required", {
				memoryId,
				agent: agent.name,
				reason: `Memory type "${lessonData.memoryType}" requires approval`,
			})
		}

		return { id: memoryId, ...lessonData }
	}
}

module.exports = { AgentRunWrapper, DEFAULT_LIMITS }
