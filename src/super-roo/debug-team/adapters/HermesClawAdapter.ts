/**
 * Super Roo — HermesClaw Adapter
 *
 * HermesClaw is the MEMORY & CONTEXT agent for the Super Debug Team.
 * It uses the OpenAI API for natural language understanding, memory recall,
 * pattern recognition, and skill generation.
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
 * Safety:
 *   - Blocks cleanup/migrate/doctor commands automatically
 *   - Advisory only unless sandboxed
 *   - No direct production edits
 */

import { EventEmitter } from "events"

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export type HermesClawOperation =
	| "create_skill"
	| "memory_summary"
	| "context_recall"
	| "improvement_suggestion"
	| "pattern_analysis"
	| "knowledge_query"
	| "best_practices"
	| "lesson_extraction"

export interface HermesClawRequest {
	/** The operation to perform */
	operation: HermesClawOperation
	/** The topic or goal for context */
	topic: string
	/** Data payload for the operation */
	data: Record<string, unknown>
}

export interface HermesClawResult {
	/** The output text */
	output: string
	/** Duration in ms */
	durationMs: number
	/** Whether the operation was successful */
	success: boolean
	/** Error message if failed */
	error?: string
	/** Structured data extracted from output */
	structuredData?: Record<string, unknown>
}

export interface HermesClawAdapterConfig {
	/** OpenAI API key. Default: env OPENAI_API_KEY */
	apiKey: string
	/** OpenAI model. Default: "gpt-4o-mini" (fast + cheap for memory ops) */
	model: string
	/** OpenAI base URL (for proxies). Default: "https://api.openai.com/v1" */
	baseUrl: string
	/** Timeout per operation in ms. Default: 120000 (2 min) */
	timeoutMs: number
	/** Max tokens for responses. Default: 2048 */
	maxTokens: number
	/** Temperature for generation. Default: 0.3 (low for consistency) */
	temperature: number
	/** Max memory entries to keep. Default: 1000 */
	maxMemoryEntries: number
}

// ──────────────────────────────────────────────────────────────────────────────
// Defaults
// ──────────────────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: HermesClawAdapterConfig = {
	apiKey: process.env.OPENAI_API_KEY || "",
	model: "gpt-4o-mini",
	baseUrl: "https://api.openai.com/v1",
	timeoutMs: 120_000,
	maxTokens: 2048,
	temperature: 0.3,
	maxMemoryEntries: 1000,
}

// ──────────────────────────────────────────────────────────────────────────────
// System prompts per operation
// ──────────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPTS: Record<HermesClawOperation, string> = {
	create_skill:
		"You are a skill generation expert. Given a failure or lesson from a debugging session, " +
		"create a structured skill definition in YAML frontmatter markdown format. " +
		"The skill should be reusable for future debugging sessions. " +
		"Output ONLY the skill file content with: name, description, failurePattern, " +
		"rootCause, solution, verificationSteps, relatedFiles, and tags.",

	memory_summary:
		"You are a memory summarization expert. Given a debug job's history, " +
		"create a concise but comprehensive summary covering: the goal, what was attempted, " +
		"key decisions made, what worked and what didn't, and lessons learned. " +
		"Focus on actionable insights for future debugging sessions.",

	context_recall:
		"You are a context recall specialist. Given a query and relevant memory entries, " +
		"find and present the most relevant past experiences, solutions, and patterns. " +
		"For each suggestion, indicate confidence level and explain why it's relevant.",

	improvement_suggestion:
		"You are a process improvement analyst. Given failure patterns and job statistics, " +
		"suggest concrete improvements to the debugging process. " +
		"Prioritize suggestions by impact and effort required. " +
		"Consider tooling, automation, knowledge gaps, and workflow changes.",

	pattern_analysis:
		"You are a pattern recognition expert. Given data from multiple debug jobs, " +
		"identify recurring failure patterns, common root causes, and systemic issues. " +
		"Provide recommendations for systemic fixes that would prevent entire classes of failures.",

	knowledge_query:
		"You are a knowledge base query specialist. Given a question about debugging or " +
		"feature implementation, search your knowledge and provide relevant solutions, " +
		"best practices, and references to existing skill files or resources.",

	best_practices:
		"You are a best practices curator. Given successful debugging attempts, " +
		"extract and document best practices that can be applied to future work. " +
		"Focus on patterns that generalize across different types of problems.",

	lesson_extraction:
		"You are a lessons learned specialist. Given a completed or failed debug job, " +
		"extract structured lessons covering: what went wrong, root cause, " +
		"prevention strategies, early detection methods, and recommended skill/resource creation.",
}

// ──────────────────────────────────────────────────────────────────────────────
// HermesClawAdapter
// ──────────────────────────────────────────────────────────────────────────────

export class HermesClawAdapter extends EventEmitter {
	private config: HermesClawAdapterConfig
	private operationCount = 0
	private totalDurationMs = 0
	private memoryStore: Map<string, HermesMemoryEntry> = new Map()

	constructor(config: Partial<HermesClawAdapterConfig> = {}) {
		super()
		this.config = { ...DEFAULT_CONFIG, ...config }
	}

	/**
	 * Execute a HermesClaw operation using OpenAI API.
	 */
	async execute(request: HermesClawRequest): Promise<HermesClawResult> {
		const startTime = Date.now()
		this.operationCount++
		const opId = `hermesclaw_${Date.now()}_${this.operationCount}`

		this.emit("operation:start", { opId, operation: request.operation, topic: request.topic })

		try {
			if (!this.config.apiKey) {
				throw new Error(
					"OpenAI API key not configured. Set OPENAI_API_KEY environment variable or pass apiKey in config.",
				)
			}

			const systemPrompt = SYSTEM_PROMPTS[request.operation]
			const userPrompt = this.buildUserPrompt(request)

			const response = await this.callOpenAI(systemPrompt, userPrompt)

			const durationMs = Date.now() - startTime
			this.totalDurationMs += durationMs

			const output = response || "(no output)"
			const structuredData = this.extractStructuredData(output)

			// Store in memory for context recall
			this.storeMemory(request.operation, request.topic, output)

			const result: HermesClawResult = {
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
	 */
	async createSkill(params: {
		failureType: string
		goal: string
		rootCause: string
		solution: string
		verificationSteps: string[]
		relatedFiles: string[]
		tags: string[]
	}): Promise<HermesClawResult> {
		return this.execute({
			operation: "create_skill",
			topic: `Create skill from failure: ${params.failureType}`,
			data: params as unknown as Record<string, unknown>,
		})
	}

	/**
	 * Generate a memory summary of what happened during a debug session.
	 */
	async generateMemorySummary(params: {
		jobId: string
		goal: string
		attempts: number
		hypotheses: Array<{ description: string; confidence: number; status: string }>
		lessons: Array<{ failureType: string; rootCause: string }>
		finalStatus: string
	}): Promise<HermesClawResult> {
		return this.execute({
			operation: "memory_summary",
			topic: `Memory summary for job ${params.jobId}: ${params.goal}`,
			data: params as unknown as Record<string, unknown>,
		})
	}

	/**
	 * Recall relevant context from past debugging sessions.
	 */
	async recallContext(query: string, limit = 5): Promise<HermesClawResult> {
		const localResults = this.searchMemory(query, limit)

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
	 */
	async suggestImprovements(params: {
		jobId: string
		failurePatterns: Array<{ type: string; count: number }>
		recentAttempts: number
		successRate: number
	}): Promise<HermesClawResult> {
		return this.execute({
			operation: "improvement_suggestion",
			topic: `Improvement suggestions for job ${params.jobId}`,
			data: params as unknown as Record<string, unknown>,
		})
	}

	/**
	 * Analyze failure patterns across multiple jobs.
	 */
	async analyzePatterns(params: {
		jobs: Array<{
			id: string
			goal: string
			failureTypes: string[]
			attempts: number
			status: string
		}>
	}): Promise<HermesClawResult> {
		return this.execute({
			operation: "pattern_analysis",
			topic: "Cross-job pattern analysis",
			data: params as unknown as Record<string, unknown>,
		})
	}

	/**
	 * Query the knowledge base for solutions to similar problems.
	 */
	async queryKnowledge(query: string): Promise<HermesClawResult> {
		return this.execute({
			operation: "knowledge_query",
			topic: query,
			data: { query },
		})
	}

	/**
	 * Extract lessons from a completed or failed job.
	 */
	async extractLessons(params: {
		jobId: string
		goal: string
		attempts: Array<{
			number: number
			hypothesis: string
			result: string
			error?: string
		}>
		finalStatus: string
	}): Promise<HermesClawResult> {
		return this.execute({
			operation: "lesson_extraction",
			topic: `Extract lessons from job ${params.jobId}`,
			data: params as unknown as Record<string, unknown>,
		})
	}

	// ── Stats ──────────────────────────────────────────────────────────────

	getStats() {
		return {
			operationCount: this.operationCount,
			totalDurationMs: this.totalDurationMs,
			averageDurationMs: this.operationCount > 0 ? Math.round(this.totalDurationMs / this.operationCount) : 0,
			memoryEntries: this.memoryStore.size,
		}
	}

	resetStats(): void {
		this.operationCount = 0
		this.totalDurationMs = 0
		this.memoryStore.clear()
	}

	// ── Private ────────────────────────────────────────────────────────────

	private async callOpenAI(systemPrompt: string, userPrompt: string): Promise<string> {
		const controller = new AbortController()
		const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs)

		try {
			const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.config.apiKey}`,
				},
				body: JSON.stringify({
					model: this.config.model,
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
				throw new Error(`OpenAI API error ${response.status}: ${errorText}`)
			}

			const data = (await response.json()) as {
				choices: Array<{ message: { content: string } }>
			}

			return data.choices?.[0]?.message?.content ?? "(empty response)"
		} finally {
			clearTimeout(timeoutId)
		}
	}

	private buildUserPrompt(request: HermesClawRequest): string {
		const parts: string[] = [
			`## Operation: ${request.operation}`,
			`## Topic: ${request.topic}`,
			``,
			`### Data:`,
			"```json",
			JSON.stringify(request.data, null, 2),
			"```",
		]

		// Add relevant memory context if available
		const memoryResults = this.searchMemory(request.topic, 3)
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

	private extractStructuredData(output: string): Record<string, unknown> | undefined {
		const data: Record<string, unknown> = {}

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

	private storeMemory(operation: string, topic: string, output: string): void {
		const key = `${operation}::${topic}`
		const entry: HermesMemoryEntry = {
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
	}

	private searchMemory(
		query: string,
		limit: number,
	): HermesMemoryEntry[] {
		const lowerQuery = query.toLowerCase()
		const results: HermesMemoryEntry[] = []

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

// ── Internal Types ───────────────────────────────────────────────────────────

interface HermesMemoryEntry {
	key: string
	operation: string
	topic: string
	summary: string
	timestamp: number
}
