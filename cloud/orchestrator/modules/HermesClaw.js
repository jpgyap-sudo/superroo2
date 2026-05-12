/**
 * SuperRoo Cloud — HermesClaw (Memory & Context Agent)
 *
 * HermesClaw is the MEMORY & CONTEXT agent for the Cloud Orchestrator.
 * It uses the OpenAI API for natural language understanding, memory recall,
 * pattern recognition, and skill generation.
 *
 * This is the cloud port of src/super-roo/debug-team/adapters/HermesClawAdapter.ts
 * with ADDITIONAL capabilities:
 *   - Disk persistence (survives PM2 restarts — VS Code local version is in-memory only)
 *   - Cross-job pattern analysis across ALL orchestrator tasks
 *   - Skill file generation for repeated failures
 *   - Knowledge base querying via API endpoint
 *
 * Strengths & Responsibilities:
 *   - SKILL CREATION: Generates .roo/skills/ files from repeated failures and lessons
 *   - MEMORY SUMMARIES: Creates concise summaries of what was tried, what failed, what worked
 *   - PROJECT CONTEXT RECALL: Remembers past debugging sessions and their outcomes
 *   - IMPROVEMENT SUGGESTIONS: Analyzes failure patterns and suggests process improvements
 *   - KNOWLEDGE BASE: Maintains a searchable knowledge base of past solutions
 *   - PATTERN RECOGNITION: Identifies recurring failure patterns across different jobs
 *   - BEST PRACTICES: Extracts and documents best practices from successful attempts
 *
 * Operations:
 *   create_skill        — Generate .roo/skills/ files from failures
 *   memory_summary      — Summarize what happened during a task
 *   context_recall      — Recall relevant past experiences
 *   improvement_suggestion — Suggest process improvements
 *   pattern_analysis    — Cross-job pattern recognition
 *   knowledge_query     — Search knowledge base
 *   best_practices      — Extract best practices
 *   lesson_extraction   — Extract structured lessons
 */

const fs = require("fs/promises")
const path = require("path")
const crypto = require("crypto")
const { EventEmitter } = require("events")

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * @typedef {"create_skill"|"memory_summary"|"context_recall"|"improvement_suggestion"|"pattern_analysis"|"knowledge_query"|"best_practices"|"lesson_extraction"} HermesOperation
 */

/**
 * @typedef {Object} HermesRequest
 * @property {HermesOperation} operation
 * @property {string} topic
 * @property {Record<string, unknown>} data
 */

/**
 * @typedef {Object} HermesResult
 * @property {string} output
 * @property {number} durationMs
 * @property {boolean} success
 * @property {string} [error]
 * @property {Record<string, unknown>} [structuredData]
 */

/**
 * @typedef {Object} HermesMemoryEntry
 * @property {string} key
 * @property {string} operation
 * @property {string} topic
 * @property {string} summary
 * @property {number} timestamp
 */

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
	// Primary provider (OpenAI by default — best for structured output)
	apiKey: process.env.OPENAI_API_KEY || "",
	model: "gpt-4o-mini",
	baseUrl: "https://api.openai.com/v1",
	// Fallback provider (DeepSeek — cheaper, good enough for simple ops)
	fallbackApiKey: process.env.DEEPSEEK_API_KEY || "",
	fallbackModel: "deepseek-chat",
	fallbackBaseUrl: "https://api.deepseek.com/v1",
	// Per-operation model overrides
	// Simple ops use DeepSeek (cheaper), complex ops use OpenAI (better reasoning)
	operationModels: {
		memory_summary: "deepseek-chat", // Simple summarization
		lesson_extraction: "deepseek-chat", // Pattern extraction
		knowledge_query: "deepseek-chat", // Simple Q&A
		best_practices: "deepseek-chat", // Pattern extraction
		context_recall: "gpt-4o-mini", // Needs cross-reference reasoning
		create_skill: "gpt-4o-mini", // Needs structured YAML output
		pattern_analysis: "gpt-4o-mini", // Needs cross-job reasoning
		improvement_suggestion: "gpt-4o-mini", // Needs nuanced analysis
	},
	timeoutMs: 120_000,
	maxTokens: 2048,
	temperature: 0.3,
	maxMemoryEntries: 2000,
	memoryFilePath: path.join(process.env.SUPERROO_ROOT || "/opt/superroo2", "cloud/data/hermes-memory.json"),
	skillsDir: path.join(process.env.SUPERROO_ROOT || "/opt/superroo2", ".roo/skills"),
}

// ── System prompts per operation ──────────────────────────────────────────────

const SYSTEM_PROMPTS = {
	create_skill:
		"You are a skill generation expert. Given a failure or lesson from a debugging session, " +
		"create a structured skill definition in YAML frontmatter markdown format. " +
		"The skill should be reusable for future debugging sessions. " +
		"Output ONLY the skill file content with: name, description, failurePattern, " +
		"rootCause, solution, verificationSteps, relatedFiles, and tags.",

	memory_summary:
		"You are a memory summarization expert. Given a task's history, " +
		"create a concise but comprehensive summary covering: the goal, what was attempted, " +
		"key decisions made, what worked and what didn't, and lessons learned. " +
		"Focus on actionable insights for future tasks.",

	context_recall:
		"You are a context recall specialist. Given a query and relevant memory entries, " +
		"find and present the most relevant past experiences, solutions, and patterns. " +
		"For each suggestion, indicate confidence level and explain why it's relevant.",

	improvement_suggestion:
		"You are a process improvement analyst. Given failure patterns and job statistics, " +
		"suggest concrete improvements to the orchestrator process. " +
		"Prioritize suggestions by impact and effort required. " +
		"Consider tooling, automation, knowledge gaps, and workflow changes.",

	pattern_analysis:
		"You are a pattern recognition expert. Given data from multiple tasks, " +
		"identify recurring failure patterns, common root causes, and systemic issues. " +
		"Provide recommendations for systemic fixes that would prevent entire classes of failures.",

	knowledge_query:
		"You are a knowledge base query specialist. Given a question about the codebase or " +
		"feature implementation, search your knowledge and provide relevant solutions, " +
		"best practices, and references to existing skill files or resources.",

	best_practices:
		"You are a best practices curator. Given successful task completions, " +
		"extract and document best practices that can be applied to future work. " +
		"Focus on patterns that generalize across different types of problems.",

	lesson_extraction:
		"You are a lessons learned specialist. Given a completed or failed task, " +
		"extract structured lessons covering: what went wrong, root cause, " +
		"prevention strategies, early detection methods, and recommended skill/resource creation.",
}

// ═══════════════════════════════════════════════════════════════════════════════
// HermesClaw
// ═══════════════════════════════════════════════════════════════════════════════

class HermesClaw extends EventEmitter {
	/**
	 * @param {Partial<typeof DEFAULT_CONFIG>} [config]
	 */
	constructor(config = {}) {
		super()
		/** @type {typeof DEFAULT_CONFIG} */
		this.config = { ...DEFAULT_CONFIG, ...config }
		this.operationCount = 0
		this.totalDurationMs = 0
		/** @type {Map<string, HermesMemoryEntry>} */
		this.memoryStore = new Map()
		this._initialized = false
	}

	/**
	 * Initialize HermesClaw — load persisted memory from disk.
	 * Must be called before use.
	 */
	async init() {
		if (this._initialized) return

		try {
			await fs.mkdir(path.dirname(this.config.memoryFilePath), { recursive: true })
			const raw = await fs.readFile(this.config.memoryFilePath, "utf8")
			const entries = JSON.parse(raw)
			if (Array.isArray(entries)) {
				for (const entry of entries) {
					this.memoryStore.set(entry.key, entry)
				}
			}
			console.log(
				`[HermesClaw] Initialized with ${this.memoryStore.size} memory entries from ${this.config.memoryFilePath}`,
			)
		} catch (err) {
			if (err.code !== "ENOENT") {
				console.error(`[HermesClaw] Failed to load memory: ${err.message}`)
			} else {
				console.log("[HermesClaw] No existing memory file — starting fresh")
			}
		}

		this._initialized = true
	}

	/**
	 * Persist memory to disk.
	 */
	async _persist() {
		try {
			await fs.mkdir(path.dirname(this.config.memoryFilePath), { recursive: true })
			const entries = Array.from(this.memoryStore.values())
			await fs.writeFile(this.config.memoryFilePath, JSON.stringify(entries, null, 2), "utf8")
		} catch (err) {
			console.error(`[HermesClaw] Failed to persist memory: ${err.message}`)
		}
	}

	/**
	 * Execute a HermesClaw operation using OpenAI API.
	 *
	 * @param {HermesRequest} request
	 * @returns {Promise<HermesResult>}
	 */
	async execute(request) {
		const startTime = Date.now()
		this.operationCount++
		const opId = `hermesclaw_${Date.now()}_${this.operationCount}`

		this.emit("operation:start", { opId, operation: request.operation, topic: request.topic })

		try {
			if (!this.config.apiKey && !this.config.fallbackApiKey) {
				throw new Error(
					"No AI provider configured. Set OPENAI_API_KEY or DEEPSEEK_API_KEY environment variable.",
				)
			}

			const systemPrompt = SYSTEM_PROMPTS[request.operation]
			if (!systemPrompt) {
				throw new Error(`Unknown operation: ${request.operation}`)
			}

			const userPrompt = this._buildUserPrompt(request)
			const response = await this._callOpenAI(systemPrompt, userPrompt, request.operation)

			const durationMs = Date.now() - startTime
			this.totalDurationMs += durationMs

			const output = response || "(no output)"
			const structuredData = this._extractStructuredData(output)

			// Store in memory for context recall
			this._storeMemory(request.operation, request.topic, output)

			const result = {
				output,
				durationMs,
				success: true,
				structuredData,
			}

			this.emit("operation:complete", { opId, ...result })
			return result
		} catch (err) {
			const durationMs = Date.now() - startTime
			this.totalDurationMs += durationMs
			const errorMsg = err instanceof Error ? err.message : String(err)

			this.emit("operation:error", { opId, error: errorMsg })

			return {
				output: "",
				durationMs,
				success: false,
				error: errorMsg,
			}
		}
	}

	// ── High-level convenience methods ─────────────────────────────────────

	/**
	 * Create a skill file from a failure or lesson.
	 * This is HermesClaw's PRIMARY strength — turning failures into reusable knowledge.
	 *
	 * @param {Object} params
	 * @param {string} params.failureType
	 * @param {string} params.goal
	 * @param {string} params.rootCause
	 * @param {string} params.solution
	 * @param {string[]} params.verificationSteps
	 * @param {string[]} params.relatedFiles
	 * @param {string[]} params.tags
	 * @returns {Promise<HermesResult>}
	 */
	async createSkill(params) {
		return this.execute({
			operation: "create_skill",
			topic: `Create skill from failure: ${params.failureType}`,
			data: params,
		})
	}

	/**
	 * Generate a memory summary of what happened during a task.
	 *
	 * @param {Object} params
	 * @param {string} params.taskId
	 * @param {string} params.goal
	 * @param {number} params.phases
	 * @param {Array<{description: string, status: string}>} params.phaseResults
	 * @param {string} params.finalStatus
	 * @returns {Promise<HermesResult>}
	 */
	async generateMemorySummary(params) {
		return this.execute({
			operation: "memory_summary",
			topic: `Memory summary for task ${params.taskId}: ${params.goal}`,
			data: params,
		})
	}

	/**
	 * Recall relevant context from past tasks.
	 *
	 * @param {string} query - What to recall context about
	 * @param {number} [limit=5] - Max results
	 * @returns {Promise<HermesResult>}
	 */
	async recallContext(query, limit = 5) {
		const localResults = this._searchMemory(query, limit)

		return this.execute({
			operation: "context_recall",
			topic: `Recall context: ${query}`,
			data: {
				query,
				limit,
				localMemoryResults: localResults,
			},
		})
	}

	/**
	 * Get improvement suggestions based on failure patterns.
	 *
	 * @param {Object} params
	 * @param {string} params.taskId
	 * @param {Array<{type: string, count: number}>} params.failurePatterns
	 * @param {number} params.recentAttempts
	 * @param {number} params.successRate
	 * @returns {Promise<HermesResult>}
	 */
	async suggestImprovements(params) {
		return this.execute({
			operation: "improvement_suggestion",
			topic: `Improvement suggestions for task ${params.taskId}`,
			data: params,
		})
	}

	/**
	 * Analyze failure patterns across multiple tasks.
	 *
	 * @param {Object} params
	 * @param {Array<{id: string, goal: string, failureTypes: string[], phases: number, status: string}>} params.tasks
	 * @returns {Promise<HermesResult>}
	 */
	async analyzePatterns(params) {
		return this.execute({
			operation: "pattern_analysis",
			topic: "Cross-task pattern analysis",
			data: params,
		})
	}

	/**
	 * Query the knowledge base for solutions to similar problems.
	 *
	 * @param {string} query
	 * @returns {Promise<HermesResult>}
	 */
	async queryKnowledge(query) {
		return this.execute({
			operation: "knowledge_query",
			topic: query,
			data: { query },
		})
	}

	/**
	 * Extract lessons from a completed or failed task.
	 *
	 * @param {Object} params
	 * @param {string} params.taskId
	 * @param {string} params.goal
	 * @param {Array<{number: number, phase: string, result: string, error?: string}>} params.phases
	 * @param {string} params.finalStatus
	 * @returns {Promise<HermesResult>}
	 */
	async extractLessons(params) {
		return this.execute({
			operation: "lesson_extraction",
			topic: `Extract lessons from task ${params.taskId}`,
			data: params,
		})
	}

	// ── Stats ──────────────────────────────────────────────────────────────

	/**
	 * Get HermesClaw statistics.
	 * @returns {{operationCount: number, totalDurationMs: number, averageDurationMs: number, memoryEntries: number}}
	 */
	getStats() {
		return {
			operationCount: this.operationCount,
			totalDurationMs: this.totalDurationMs,
			averageDurationMs: this.operationCount > 0 ? Math.round(this.totalDurationMs / this.operationCount) : 0,
			memoryEntries: this.memoryStore.size,
		}
	}

	/**
	 * Reset all stats and clear memory.
	 */
	resetStats() {
		this.operationCount = 0
		this.totalDurationMs = 0
		this.memoryStore.clear()
		this._persist()
	}

	// ── Private ────────────────────────────────────────────────────────────

	/**
	 * Call OpenAI API.
	 * @param {string} systemPrompt
	 * @param {string} userPrompt
	 * @returns {Promise<string>}
	 */
	async _callOpenAI(systemPrompt, userPrompt, operation) {
		const controller = new AbortController()
		const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs)

		// Resolve provider based on operation type
		const opModel = operation ? this.config.operationModels[operation] : null
		let provider

		if (opModel && opModel.includes("deepseek") && this.config.fallbackApiKey) {
			// Simple ops → DeepSeek (cheaper)
			provider = {
				apiKey: this.config.fallbackApiKey,
				baseUrl: this.config.fallbackBaseUrl,
				model: opModel,
			}
		} else if (opModel && opModel.includes("gpt") && this.config.apiKey) {
			// Complex ops → OpenAI (better reasoning)
			provider = {
				apiKey: this.config.apiKey,
				baseUrl: this.config.baseUrl,
				model: opModel,
			}
		} else if (this.config.apiKey) {
			// Fallback to primary provider
			provider = {
				apiKey: this.config.apiKey,
				baseUrl: this.config.baseUrl,
				model: this.config.model,
			}
		} else if (this.config.fallbackApiKey) {
			// Fallback to secondary provider
			provider = {
				apiKey: this.config.fallbackApiKey,
				baseUrl: this.config.fallbackBaseUrl,
				model: this.config.fallbackModel,
			}
		} else {
			throw new Error("No AI provider configured for HermesClaw.")
		}

		try {
			const response = await fetch(`${provider.baseUrl}/chat/completions`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${provider.apiKey}`,
				},
				body: JSON.stringify({
					model: provider.model,
					messages: [
						{ role: "system", content: systemPrompt },
						{ role: "user", content: userPrompt },
					],
					max_tokens: this.config.maxTokens,
					temperature: this.config.temperature,
				}),
				signal: controller.signal,
			})

			if (!response.ok) {
				const errorText = await response.text().catch(() => "unknown error")
				throw new Error(`AI API error ${response.status} from ${provider.baseUrl}: ${errorText}`)
			}

			const data = await response.json()
			return data.choices?.[0]?.message?.content ?? "(empty response)"
		} finally {
			clearTimeout(timeoutId)
		}
	}

	/**
	 * Build the user prompt from a request.
	 * @param {HermesRequest} request
	 * @returns {string}
	 */
	_buildUserPrompt(request) {
		const parts = [
			`## Operation: ${request.operation}`,
			`## Topic: ${request.topic}`,
			``,
			`### Data:`,
			"```json",
			JSON.stringify(request.data, null, 2),
			"```",
		]

		// Add relevant memory context if available
		const memoryResults = this._searchMemory(request.topic, 3)
		if (memoryResults.length > 0) {
			parts.push(
				``,
				`### Relevant Memory:`,
				...memoryResults.map(
					(m) => `- [${m.operation}] ${m.topic} (${new Date(m.timestamp).toISOString()}): ${m.summary}`,
				),
			)
		}

		return parts.join("\n")
	}

	/**
	 * Extract structured data from output (e.g., YAML frontmatter).
	 * @param {string} output
	 * @returns {Record<string, unknown>|undefined}
	 */
	_extractStructuredData(output) {
		/** @type {Record<string, unknown>} */
		const data = {}

		// Try to extract YAML frontmatter (for skill creation)
		const frontmatterMatch = output.match(/^---\n([\s\S]*?)\n---/)
		if (frontmatterMatch) {
			const frontmatter = frontmatterMatch[1]
			for (const line of frontmatter.split("\n")) {
				const colonIdx = line.indexOf(":")
				if (colonIdx > 0) {
					const key = line.slice(0, colonIdx).trim()
					const value = line.slice(colonIdx + 1).trim()
					data[key] = value
				}
			}
		}

		return Object.keys(data).length > 0 ? data : undefined
	}

	/**
	 * Store a memory entry and persist to disk.
	 * @param {string} operation
	 * @param {string} topic
	 * @param {string} output
	 */
	_storeMemory(operation, topic, output) {
		const key = `${operation}::${topic}`
		/** @type {HermesMemoryEntry} */
		const entry = {
			key,
			operation,
			topic,
			summary: output.slice(0, 500),
			timestamp: Date.now(),
		}

		this.memoryStore.set(key, entry)

		// Enforce max entries
		if (this.memoryStore.size > this.config.maxMemoryEntries) {
			const oldest = Array.from(this.memoryStore.entries())
				.sort(([, a], [, b]) => a.timestamp - b.timestamp)
				.slice(0, this.memoryStore.size - this.config.maxMemoryEntries)

			for (const [k] of oldest) {
				this.memoryStore.delete(k)
			}
		}

		// Persist to disk (fire-and-forget)
		this._persist()
	}

	/**
	 * Search memory for relevant entries.
	 * @param {string} query
	 * @param {number} limit
	 * @returns {HermesMemoryEntry[]}
	 */
	_searchMemory(query, limit) {
		const lowerQuery = query.toLowerCase()
		/** @type {HermesMemoryEntry[]} */
		const results = []

		for (const [, entry] of this.memoryStore) {
			if (
				entry.topic.toLowerCase().includes(lowerQuery) ||
				entry.summary.toLowerCase().includes(lowerQuery) ||
				entry.operation.toLowerCase().includes(lowerQuery)
			) {
				results.push(entry)
			}
		}

		return results.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit)
	}
}

module.exports = { HermesClaw }
