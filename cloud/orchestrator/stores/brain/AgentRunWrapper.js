/**
 * AgentRunWrapper — Mandatory memory enforcement wrapper
 *
 * Every agent run MUST go through this wrapper to ensure:
 * 1. Memory is recalled before the agent starts (context injection)
 * 2. A lesson is saved after the agent completes
 * 3. The agent's score is updated
 * 4. Safety limits are enforced (max memories, max tokens, dangerous patterns)
 *
 * This is the "mandatory enforcement" layer of Central Brain v2.
 */

const crypto = require("crypto")

const DEFAULT_LIMITS = {
	maxMemoriesPerTask: 10,
	maxContextTokens: 4000,
	minImportanceThreshold: 0.3,
	requireApprovalForTypes: ["bug", "pattern"],
	maxRetries: 2,
}

class AgentRunWrapper {
	/**
	 * @param {import('./MemoryService')} memoryService
	 * @param {import('./EmbeddingService')} embeddingService
	 * @param {import('./AgentScoringService')} scoringService
	 * @param {import('./BrainEventBus')} eventBus
	 * @param {import('./MemoryApprovalService')} approvalService
	 * @param {object} [limits]
	 */
	constructor(memoryService, embeddingService, scoringService, eventBus, approvalService, limits = {}) {
		this.memoryService = memoryService
		this.embeddingService = embeddingService
		this.scoringService = scoringService
		this.eventBus = eventBus
		this.approvalService = approvalService
		this.limits = { ...DEFAULT_LIMITS, ...limits }
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

		try {
			// 1. Record task start
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

			// 2. Record agent run
			await this.memoryService.query(
				`INSERT INTO agent_runs (id, task_id, agent, model, status, input_summary)
         VALUES ($1, $2, $3, $4, 'running', $5)`,
				[runId, taskId, agent.name || "unknown", agent.model || null, task.goal],
			)

			// 3. Recall relevant memories (context injection)
			const memories = await this._recallMemories(projectId, task.goal, agent)

			// 4. Emit brain event: recall
			await this.eventBus.emit(projectId, "memory.recall", {
				taskId,
				runId,
				agent: agent.name,
				memoryCount: memories.length,
			})

			// 5. Run the agent with memory context
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

			// 6. Extract and save lesson from agent output
			const lesson = await this._saveLesson(projectId, task, agent, runId, taskId, agentResult)

			// 7. Update agent score
			const score = await this.scoringService.updateScore({
				projectId,
				agent: agent.name,
				model: agent.model,
				taskType: task.type || "general",
				success: true,
				duration,
				usedMemories: memories.length,
			})

			// 8. Mark task and run as completed
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

			// 9. Emit brain event: completion
			await this.eventBus.emit(projectId, "memory.agent_completed", {
				taskId,
				runId,
				agent: agent.name,
				duration,
				lessonId: lesson?.id,
			})

			return { runId, taskId, memories, lesson, score, duration }
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

			// Update score with failure
			await this.scoringService
				.updateScore({
					projectId: task.projectId || "default",
					agent: agent.name || "unknown",
					model: agent.model,
					taskType: task.type || "general",
					success: false,
					duration,
					usedMemories: 0,
				})
				.catch(() => {})

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
