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
 *   - **pgvector-backed RAG memory** via BugKnowledgeStore (PostgreSQL + Ollama embeddings)
 *
 * Strengths & Responsibilities:
 *   - SKILL CREATION: Generates .roo/skills/ files from repeated failures and lessons
 *   - MEMORY SUMMARIES: Creates concise summaries of what was tried, what failed, what worked
 *   - PROJECT CONTEXT RECALL: Remembers past debugging sessions and their outcomes
 *   - IMPROVEMENT SUGGESTIONS: Analyzes failure patterns and suggests process improvements
 *   - KNOWLEDGE BASE: Maintains a searchable knowledge base of past solutions
 *   - PATTERN RECOGNITION: Identifies recurring failure patterns across different jobs
 *   - BEST PRACTICES: Extracts and documents best practices from successful attempts
 *   - **RAG MEMORY**: Vector similarity search across all bug fixes via pgvector
 *   - **BUG FIX STORAGE**: Automatically stores DeepSeek/OpenAI fixes for Ollama RAG retrieval
 *
 * Operations:
 *   create_skill        — Generate .roo/skills/ files from failures
 *   memory_summary      — Summarize what happened during a task
 *   context_recall      — Recall relevant past experiences (now RAG-powered)
 *   improvement_suggestion — Suggest process improvements
 *   pattern_analysis    — Cross-job pattern recognition
 *   knowledge_query     — Search knowledge base
 *   best_practices      — Extract best practices
 *   lesson_extraction   — Extract structured lessons
 *   store_bug_fix       — Store a bug fix in pgvector knowledge base
 *   store_lesson        — Store a lesson in pgvector knowledge base
 *   build_rag_context   — Build RAG context string for prompt injection
 */

const fs = require("fs/promises")
const path = require("path")
const crypto = require("crypto")
const { EventEmitter } = require("events")
const { BugKnowledgeStore } = require("../stores/BugKnowledgeStore")

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
	// Primary provider (Ollama local — FREE, runs on VPS)
	// Canonical env vars: OLLAMA_BASE_URL, OLLAMA_MODEL
	// Legacy fallbacks: OLLAMA_HOST (for base URL), OLLAMA_HERMES_MODEL, OLLAMA_CHAT_MODEL (for model)
	ollamaBaseUrl: process.env.OLLAMA_BASE_URL || process.env.OLLAMA_HOST || "http://127.0.0.1:11434",
	ollamaModel:
		process.env.OLLAMA_MODEL || process.env.OLLAMA_HERMES_MODEL || process.env.OLLAMA_CHAT_MODEL || "hermes3",
	// Fallback provider (OpenAI — expensive, only when Ollama fails)
	apiKey: process.env.OPENAI_API_KEY || "",
	model: "gpt-4o-mini",
	baseUrl: "https://api.openai.com/v1",
	// Secondary fallback (DeepSeek — cheaper than OpenAI)
	fallbackApiKey: process.env.DEEPSEEK_API_KEY || "",
	fallbackModel: "deepseek-chat",
	fallbackBaseUrl: "https://api.deepseek.com/v1",
	// Per-operation model overrides
	// ALL operations use Ollama by default (FREE). Falls back to cloud only if Ollama fails.
	operationModels: {
		memory_summary: "ollama", // Simple summarization
		lesson_extraction: "ollama", // Pattern extraction
		knowledge_query: "ollama", // Simple Q&A
		best_practices: "ollama", // Pattern extraction
		context_recall: "ollama", // Cross-reference reasoning
		create_skill: "ollama", // Structured YAML output
		pattern_analysis: "ollama", // Cross-job reasoning
		improvement_suggestion: "ollama", // Nuanced analysis
	},
	timeoutMs: 120_000,
	maxTokens: 2048,
	temperature: 0.3,
	maxMemoryEntries: 2000,
	memoryFilePath: path.join(process.env.SUPERROO_ROOT || "/opt/superroo2", "cloud/data/hermes-memory.json"),
	skillsDir: path.join(process.env.SUPERROO_ROOT || "/opt/superroo2", ".roo/skills"),
	// Ollama Growth tracking — records readiness checks and growth events for dashboard
	ollamaGrowthDir: path.join(process.env.SUPERROO_ROOT || "/opt/superroo2", "memory", "ollama"),
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
		/** @type {BugKnowledgeStore|null} */
		this.bugKnowledgeStore = null
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

		// Initialize BugKnowledgeStore (pgvector RAG memory)
		await this.initBugKnowledgeStore()

		// Pre-warm Ollama model to avoid cold-start timeout on first request
		// Node.js 20's built-in fetch (undici) has a default headersTimeout of ~20s,
		// but Ollama takes ~30s to load the model on first request (cold start).
		// Warming the model here ensures it's ready when the first real request comes in.
		await this._warmOllamaModel()

		// Record initial readiness check for Ollama Growth dashboard
		await this._recordOllamaReadinessCheck()

		this._initialized = true
	}

	/**
	 * Pre-warm the Ollama model by sending a minimal chat request.
	 * This ensures the model is loaded in memory before any real requests arrive,
	 * avoiding the ~30s cold-start delay that causes Node.js fetch to time out.
	 */
	async _warmOllamaModel() {
		if (!this.config.ollamaBaseUrl) return
		try {
			const http = require("http")
			const start = Date.now()
			const postData = JSON.stringify({
				model: this.config.ollamaModel,
				messages: [{ role: "user", content: "hi" }],
				stream: false,
				options: { num_predict: 10 },
			})
			await new Promise((resolve, reject) => {
				const req = http.request(
					`${this.config.ollamaBaseUrl}/api/chat`,
					{
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							"Content-Length": Buffer.byteLength(postData),
						},
						timeout: 120_000,
					},
					(res) => {
						let body = ""
						res.on("data", (chunk) => (body += chunk))
						res.on("end", () => {
							const elapsed = Date.now() - start
							console.log(`[HermesClaw] Ollama model warmed in ${elapsed}ms (${this.config.ollamaModel})`)
							resolve()
						})
					},
				)
				req.on("error", (err) => {
					console.warn(`[HermesClaw] Ollama warm-up failed (non-critical): ${err.message}`)
					resolve() // Don't block startup on warm-up failure
				})
				req.on("timeout", () => {
					req.destroy()
					console.warn(`[HermesClaw] Ollama warm-up timed out (non-critical)`)
					resolve() // Don't block startup on warm-up failure
				})
				req.write(postData)
				req.end()
			})
		} catch (err) {
			// Warm-up is best-effort; don't block initialization
			console.warn(`[HermesClaw] Ollama warm-up failed (non-critical): ${err.message}`)
		}
	}

	/**
	 * Record an Ollama readiness check — writes to memory/ollama/readiness-checks.jsonl
	 * for the Ollama Growth dashboard view.
	 */
	async _recordOllamaReadinessCheck() {
		const ollamaDir = this.config.ollamaGrowthDir
		if (!ollamaDir) return
		try {
			await fs.mkdir(ollamaDir, { recursive: true })
			const http = require("http")

			let ok = false
			let modelCount = 0
			let latencyMs = null
			let models = []

			try {
				const t0 = Date.now()
				const body = await new Promise((resolve, reject) => {
					const req = http.get(`${this.config.ollamaBaseUrl}/api/tags`, { timeout: 10_000 }, (res) => {
						let data = ""
						res.on("data", (c) => (data += c))
						res.on("end", () => resolve(data))
					})
					req.on("error", reject)
					req.on("timeout", () => {
						req.destroy()
						reject(new Error("timeout"))
					})
				})
				latencyMs = Date.now() - t0
				const parsed = JSON.parse(body)
				ok = true
				models = (parsed.models || []).map((m) => m.name || m.model || "").filter(Boolean)
				modelCount = models.length
			} catch {
				ok = false
			}

			// Scoring breakdown (max 100):
			//   +30 reachable
			//   +20 has >= 1 model
			//   +10 has >= 2 models
			//   +10 has >= 3 models
			//   +15 latency < 2s
			//   +10 latency < 500ms
			//    +5 has an embedding or coding model detected
			let score = 0
			let level = "Offline"
			let recommendation = "Ollama is offline. Check service status."
			if (ok) {
				score += 30
				if (modelCount >= 1) score += 20
				if (modelCount >= 2) score += 10
				if (modelCount >= 3) score += 10
				if (latencyMs !== null && latencyMs < 2000) score += 15
				if (latencyMs !== null && latencyMs < 500) score += 10
				const hasSpecialist = models.some((m) => /(embed|code|coder|deepseek|mistral|llama)/i.test(m))
				if (hasSpecialist) score += 5

				if (score >= 90) level = "Main coder candidate"
				else if (score >= 75) level = "Junior coder"
				else if (score >= 60) level = "Patch suggester"
				else if (score >= 40) level = "Memory assistant"
				else level = "Summarizer only"

				if (score >= 90) recommendation = "Main coder candidate with review."
				else if (score >= 75) recommendation = "Allow small coding tasks with review."
				else if (score >= 60) recommendation = "Use for patch suggestions only."
				else if (score >= 40) recommendation = "Use for memory retrieval."
				else recommendation = "Keep Ollama as summarizer only."
			}

			const check = {
				created_at: new Date().toISOString(),
				total_score: score,
				level,
				recommendation,
				models_available: modelCount,
				models,
				latency_ms: latencyMs,
				ok,
			}
			const line = JSON.stringify(check) + "\n"
			await fs.appendFile(path.join(ollamaDir, "readiness-checks.jsonl"), line, "utf8")
		} catch (err) {
			// Non-critical — don't block startup
			console.warn(`[HermesClaw] Failed to record Ollama readiness check: ${err.message}`)
		}
	}

	/**
	 * Record an Ollama growth event — writes to memory/ollama/growth-events.jsonl
	 * for the Ollama Growth dashboard view.
	 * @param {string} eventType - e.g. "ollama_used", "ollama_failed", "ollama_warmed"
	 * @param {object} [metadata] - Optional event metadata
	 */
	async _recordOllamaGrowthEvent(eventType, metadata = {}) {
		const ollamaDir = this.config.ollamaGrowthDir
		if (!ollamaDir) return
		try {
			await fs.mkdir(ollamaDir, { recursive: true })
			const event = {
				created_at: new Date().toISOString(),
				event_type: eventType,
				...metadata,
			}
			const line = JSON.stringify(event) + "\n"
			await fs.appendFile(path.join(ollamaDir, "growth-events.jsonl"), line, "utf8")
		} catch (err) {
			// Non-critical
			console.warn(`[HermesClaw] Failed to record Ollama growth event: ${err.message}`)
		}
	}

	/**
	 * Call Ollama chat API using http.request (avoids Node.js 20 fetch undici headersTimeout issue).
	 * @param {string} systemPrompt
	 * @param {string} userPrompt
	 * @returns {Promise<string|null>} The response content, or null if Ollama is unavailable
	 */
	async _ollamaChat(systemPrompt, userPrompt) {
		if (!this.config.ollamaBaseUrl) return null
		const http = require("http")
		const postData = JSON.stringify({
			model: this.config.ollamaModel,
			messages: [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: userPrompt },
			],
			stream: false,
			options: {
				temperature: this.config.temperature,
				num_predict: this.config.maxTokens,
			},
		})
		return new Promise((resolve) => {
			const req = http.request(
				`${this.config.ollamaBaseUrl}/api/chat`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"Content-Length": Buffer.byteLength(postData),
					},
					timeout: this.config.timeoutMs,
				},
				(res) => {
					let body = ""
					res.on("data", (chunk) => (body += chunk))
					res.on("end", () => {
						try {
							const data = JSON.parse(body)
							const content = data.message?.content || data.response || ""
							resolve(content || null)
						} catch {
							resolve(null)
						}
					})
				},
			)
			req.on("error", () => resolve(null))
			req.on("timeout", () => {
				req.destroy()
				resolve(null)
			})
			req.write(postData)
			req.end()
		})
	}

	/**
	 * Initialize the BugKnowledgeStore for pgvector-backed RAG memory.
	 * This is optional — if PostgreSQL is unavailable, HermesClaw falls back
	 * to its in-memory keyword search.
	 */
	async initBugKnowledgeStore() {
		try {
			this.bugKnowledgeStore = new BugKnowledgeStore({
				dbConfig: {
					host: process.env.PGHOST || "127.0.0.1",
					port: parseInt(process.env.PGPORT || "5432", 10),
					user: process.env.PGUSER || "superroo",
					password: process.env.PGPASSWORD || "superroo",
					database: process.env.PGDATABASE || "superroo",
				},
			})
			await this.bugKnowledgeStore.init()
			console.log("[HermesClaw] BugKnowledgeStore (pgvector RAG) initialized")
		} catch (err) {
			console.warn(`[HermesClaw] BugKnowledgeStore not available: ${err.message}`)
			console.warn("[HermesClaw] Falling back to in-memory keyword search only")
			this.bugKnowledgeStore = null
		}
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
			// Ollama is always available (local), so we only need cloud keys as fallback
			// If Ollama is down, we fall back to cloud APIs
			if (!this.config.ollamaBaseUrl && !this.config.apiKey && !this.config.fallbackApiKey) {
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
	 * Uses pgvector RAG search when BugKnowledgeStore is available,
	 * falls back to in-memory keyword search otherwise.
	 *
	 * @param {string} query - What to recall context about
	 * @param {number} [limit=5] - Max results
	 * @returns {Promise<HermesResult>}
	 */
	async recallContext(query, limit = 5) {
		const localResults = this._searchMemory(query, limit)

		// Try RAG-powered search via BugKnowledgeStore
		let ragResults = []
		if (this.bugKnowledgeStore) {
			try {
				ragResults = await this.bugKnowledgeStore.searchSimilar(query, { limit })
			} catch (err) {
				console.warn(`[HermesClaw] RAG search failed, falling back: ${err.message}`)
			}
		}

		return this.execute({
			operation: "context_recall",
			topic: `Recall context: ${query}`,
			data: {
				query,
				limit,
				localMemoryResults: localResults,
				ragResults: ragResults.length > 0 ? ragResults : undefined,
			},
		})
	}

	/**
	 * Store a bug fix in the pgvector knowledge base.
	 * This feeds the Ollama RAG learning loop — every DeepSeek/OpenAI fix
	 * is stored here so Ollama can retrieve it later.
	 *
	 * @param {object} fix - Bug fix data (see BugKnowledgeStore.storeBugFix)
	 * @returns {Promise<{id: string|null, success: boolean}>}
	 */
	async storeBugFix(fix) {
		if (!this.bugKnowledgeStore) {
			return { id: null, success: false, error: "BugKnowledgeStore not available" }
		}
		return this.bugKnowledgeStore.storeBugFix(fix)
	}

	/**
	 * Store a lesson in the pgvector knowledge base.
	 *
	 * @param {object} lesson - Lesson data (see BugKnowledgeStore.storeLesson)
	 * @returns {Promise<{id: string|null, success: boolean}>}
	 */
	async storeLesson(lesson) {
		if (!this.bugKnowledgeStore) {
			return { id: null, success: false, error: "BugKnowledgeStore not available" }
		}
		return this.bugKnowledgeStore.storeLesson(lesson)
	}

	/**
	 * Build a RAG context string for injection into LLM prompts.
	 * This is the primary method used to give Ollama memory of past fixes.
	 *
	 * @param {string} query - The problem description or error message
	 * @param {object} [options]
	 * @param {number} [options.maxResults=3]
	 * @param {number} [options.threshold=0.6]
	 * @returns {Promise<string>} - Formatted context string, or empty string if unavailable
	 */
	async buildRagContext(query, options = {}) {
		if (!this.bugKnowledgeStore) {
			return ""
		}
		try {
			return await this.bugKnowledgeStore.buildRagContext(query, options)
		} catch (err) {
			console.warn(`[HermesClaw] buildRagContext failed: ${err.message}`)
			return ""
		}
	}

	/**
	 * Update the test_passed status for a stored bug fix.
	 *
	 * @param {string} taskId
	 * @param {boolean} passed
	 * @returns {Promise<boolean>}
	 */
	async updateBugFixTestStatus(taskId, passed) {
		if (!this.bugKnowledgeStore) return false
		return this.bugKnowledgeStore.updateTestStatus(taskId, passed)
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
	 * @returns {Promise<{operationCount: number, totalDurationMs: number, averageDurationMs: number, memoryEntries: number, knowledgeStore?: object}>}
	 */
	async getStats() {
		const stats = {
			operationCount: this.operationCount,
			totalDurationMs: this.totalDurationMs,
			averageDurationMs: this.operationCount > 0 ? Math.round(this.totalDurationMs / this.operationCount) : 0,
			memoryEntries: this.memoryStore.size,
		}

		// Include BugKnowledgeStore stats if available
		if (this.bugKnowledgeStore) {
			try {
				stats.knowledgeStore = await this.bugKnowledgeStore.getStats()
			} catch {
				stats.knowledgeStore = { error: "unavailable" }
			}
		}

		return stats
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
	 * Call AI API — tries Ollama (local, FREE) first, then falls back to cloud APIs.
	 * @param {string} systemPrompt
	 * @param {string} userPrompt
	 * @param {string} [operation]
	 * @returns {Promise<string>}
	 */
	async _callOpenAI(systemPrompt, userPrompt, operation) {
		const controller = new AbortController()
		const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs)

		// ── Step 1: Try Ollama (local, FREE) ──────────────────────────────
		// Uses http.request instead of fetch because Node.js 20's built-in fetch (undici)
		// has a default headersTimeout of ~20s, but Ollama can take ~30s on cold start.
		const opModel = operation ? this.config.operationModels[operation] : null
		if (!opModel || opModel === "ollama") {
			try {
				const ollamaResponse = await this._ollamaChat(systemPrompt, userPrompt)
				if (ollamaResponse) {
					console.log(`[HermesClaw] Ollama handled operation: ${operation || "unknown"} (FREE)`)
					clearTimeout(timeoutId)
					// Record growth event for dashboard
					this._recordOllamaGrowthEvent("ollama_used", { operation: operation || "unknown" }).catch(() => {})
					return ollamaResponse
				}
			} catch (ollamaErr) {
				console.warn(`[HermesClaw] Ollama unavailable (${ollamaErr.message}), falling back to cloud API`)
				// Record failure event for dashboard
				this._recordOllamaGrowthEvent("ollama_failed", {
					operation: operation || "unknown",
					error: ollamaErr.message,
				}).catch(() => {})
			}
		}

		// ── Step 2: Fallback to cloud API ─────────────────────────────────
		let provider

		if (opModel && opModel.includes("deepseek") && this.config.fallbackApiKey) {
			// DeepSeek (cheaper cloud)
			provider = {
				apiKey: this.config.fallbackApiKey,
				baseUrl: this.config.fallbackBaseUrl,
				model: opModel,
			}
		} else if (opModel && opModel.includes("gpt") && this.config.apiKey) {
			// OpenAI (better reasoning)
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
			clearTimeout(timeoutId)
			throw new Error("No AI provider configured for HermesClaw (Ollama unavailable and no cloud API keys).")
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
