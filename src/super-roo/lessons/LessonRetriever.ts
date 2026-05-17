/**
 * Lesson Retriever
 *
 * Retrieves relevant lessons from the lesson index based on context,
 * tags, and relevance scoring. Used to inject institutional knowledge
 * into model prompts.
 *
 * Supports cross-project learning:
 * - When running inside superroo2 repo: loads local memory/lesson-index.jsonl
 * - When running in any other project: falls back to Central Brain via MCP
 * - The remote fallback is transparent to callers
 */

import fs from "fs/promises"
import path from "path"

export interface Lesson {
	id: string
	title: string
	type: "lesson" | "bugfix" | "decision"
	date: string
	source: string
	model: string
	confidence: "high" | "medium" | "low"
	files: string[]
	tags: string[]
	relevance_score: number
	relevance_factors: {
		is_bug_fix?: boolean
		has_tests?: boolean
		affects_multiple_files?: boolean
		has_reusable_rule?: boolean
		is_ml_related?: boolean
		affects_training?: boolean
		is_production_fix?: boolean
		affects_user_experience?: boolean
		affects_ui?: boolean
		affects_deployment?: boolean
		is_infrastructure?: boolean
		is_security_critical?: boolean
		affects_multi_agent?: boolean
		affects_data_integrity?: boolean
		is_build_fix?: boolean
		is_ai_related?: boolean
		affects_performance?: boolean
		is_reliability_fix?: boolean
		is_provider_config?: boolean
		affects_cost?: boolean
		affects_privacy?: boolean
		is_workflow?: boolean
		is_test_fix?: boolean
	}
	rule_summary: string
	lesson_summary: string
}

/**
 * Remote lesson result from Central Brain MCP query_memory
 */
interface RemoteLessonResult {
	file: string
	matches: Array<{
		text: string
		relevance: number
		metadata?: Record<string, unknown>
	}>
}

export interface RetrieveOptions {
	/** Filter by tags (lessons must have ALL specified tags) */
	tags?: string[]
	/** Match any tag instead of requiring every tag */
	matchAnyTag?: boolean
	/** Filter by file patterns */
	files?: string[]
	/** Filter by lesson type */
	type?: "lesson" | "bugfix" | "decision"
	/** Minimum relevance score (0-1) */
	minRelevance?: number
	/** Maximum number of lessons to return */
	limit?: number
	/** Sort by field */
	sortBy?: "relevance_score" | "date" | "confidence"
	/** Sort direction */
	sortOrder?: "asc" | "desc"
	/** Prefer lessons from specific model */
	preferModel?: string
}

/**
 * Lesson Retriever - Loads and queries the lesson index
 */
export class LessonRetriever {
	private lessons: Lesson[] = []
	private indexPath: string
	private loaded = false
	private useRemote = false
	private remoteUrl: string
	private remoteProject: string

	constructor(indexPath?: string, remoteUrl?: string, remoteProject?: string) {
		this.indexPath = indexPath || path.resolve(process.cwd(), "memory/lesson-index.jsonl")
		this.remoteUrl = remoteUrl || process.env.SUPERROO_MCP_URL || "http://127.0.0.1:3419/mcp"
		this.remoteProject = remoteProject || process.env.SUPERROO_PROJECT || ""
	}

	/**
	 * Load lessons from local JSONL index or fall back to Central Brain.
	 *
	 * Strategy:
	 *   1. Try local memory/lesson-index.jsonl (fast, no network)
	 *   2. If local file doesn't exist, try Central Brain via MCP
	 *   3. If both fail, return empty (no crash)
	 */
	async load(): Promise<void> {
		if (this.loaded) return

		// Try local first
		const localLoaded = await this._tryLoadLocal()
		if (localLoaded) {
			this.loaded = true
			return
		}

		// Fall back to remote Central Brain
		const remoteLoaded = await this._tryLoadRemote()
		if (remoteLoaded) {
			this.loaded = true
			this.useRemote = true
			return
		}

		// Both failed — empty state, no crash
		console.warn("[LessonRetriever] No local or remote lesson source available. Running without lesson context.")
		this.lessons = []
		this.loaded = true
	}

	/**
	 * Try to load lessons from local JSONL index file.
	 */
	private async _tryLoadLocal(): Promise<boolean> {
		try {
			const content = await fs.readFile(this.indexPath, "utf-8")
			const lines = content.split("\n").filter((line) => line.trim())
			if (lines.length === 0) return false

			this.lessons = lines.map((line) => JSON.parse(line))
			console.log(`[LessonRetriever] Loaded ${this.lessons.length} lessons from ${this.indexPath}`)
			return true
		} catch {
			return false
		}
	}

	/**
	 * Try to load lessons from Central Brain via MCP server.
	 * This enables cross-project learning — any project can query
	 * lessons stored from all other projects.
	 */
	private async _tryLoadRemote(): Promise<boolean> {
		try {
			const response = await fetch(this.remoteUrl, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: Date.now(),
					method: "tools/call",
					params: {
						name: "query_memory",
						arguments: {
							query: "lessons best practices patterns fixes",
							project: this.remoteProject || undefined,
							maxResults: 20,
						},
					},
				}),
			})

			if (!response.ok) return false

			const result = await response.json()
			if (result.error) return false

			const data = result.result as { results?: RemoteLessonResult[]; success?: boolean }
			if (!data?.results || !Array.isArray(data.results)) return false

			// Convert remote results to Lesson format
			this.lessons = this._convertRemoteResults(data.results)
			console.log(
				`[LessonRetriever] Loaded ${this.lessons.length} lessons from Central Brain (${this.remoteUrl})`,
			)
			return this.lessons.length > 0
		} catch {
			return false
		}
	}

	/**
	 * Convert Central Brain query results to Lesson format.
	 */
	private _convertRemoteResults(results: RemoteLessonResult[]): Lesson[] {
		const lessons: Lesson[] = []
		let idCounter = 0

		for (const file of results) {
			for (const match of file.matches) {
				const text = match.text || ""
				const relevance = match.relevance || 0.5

				lessons.push({
					id: `remote-${++idCounter}`,
					title: text.split("\n")[0]?.slice(0, 80) || "Remote lesson",
					type: "lesson",
					date: new Date().toISOString().split("T")[0],
					source: "central-brain",
					model: "remote",
					confidence: relevance > 0.8 ? "high" : relevance > 0.5 ? "medium" : "low",
					files: file.file ? [file.file] : [],
					tags: [],
					relevance_score: relevance,
					relevance_factors: {},
					rule_summary: text.slice(0, 200),
					lesson_summary: text.slice(0, 300),
				})
			}
		}

		return lessons
	}

	/**
	 * Check if this retriever is using remote (Central Brain) fallback.
	 */
	isUsingRemote(): boolean {
		return this.useRemote
	}

	/**
	 * Get all loaded lessons
	 */
	getAllLessons(): Lesson[] {
		return [...this.lessons]
	}

	/**
	 * Retrieve lessons matching the specified criteria
	 */
	async retrieve(options: RetrieveOptions = {}): Promise<Lesson[]> {
		await this.load()

		let results = this.lessons.filter((lesson) => {
			// Filter by tags
			if (options.tags && options.tags.length > 0) {
				const hasMatchingTags = options.matchAnyTag
					? options.tags.some((tag) => lesson.tags.includes(tag))
					: options.tags.every((tag) => lesson.tags.includes(tag))
				if (!hasMatchingTags) return false
			}

			// Filter by files
			if (options.files && options.files.length > 0) {
				const matchesFile = options.files.some((pattern) => lesson.files.some((file) => file.includes(pattern)))
				if (!matchesFile) return false
			}

			// Filter by type
			if (options.type && lesson.type !== options.type) {
				return false
			}

			// Filter by minimum relevance
			if (options.minRelevance !== undefined) {
				if (lesson.relevance_score < options.minRelevance) {
					return false
				}
			}

			return true
		})

		// Sort results
		const sortBy = options.sortBy || "relevance_score"
		const sortOrder = options.sortOrder || "desc"

		results.sort((a, b) => {
			let comparison = 0

			switch (sortBy) {
				case "relevance_score":
					comparison = a.relevance_score - b.relevance_score
					break
				case "date":
					comparison = new Date(a.date).getTime() - new Date(b.date).getTime()
					break
				case "confidence":
					const confidenceOrder = { high: 3, medium: 2, low: 1 }
					comparison = confidenceOrder[a.confidence] - confidenceOrder[b.confidence]
					break
			}

			return sortOrder === "asc" ? comparison : -comparison
		})

		// Boost preferred model
		if (options.preferModel) {
			results.sort((a, b) => {
				const aMatch = a.model.toLowerCase().includes(options.preferModel!.toLowerCase())
				const bMatch = b.model.toLowerCase().includes(options.preferModel!.toLowerCase())
				if (aMatch && !bMatch) return -1
				if (!aMatch && bMatch) return 1
				return 0
			})
		}

		// Apply limit
		if (options.limit && options.limit > 0) {
			results = results.slice(0, options.limit)
		}

		return results
	}

	/**
	 * Get top N most relevant lessons overall
	 */
	async getTopLessons(limit = 10): Promise<Lesson[]> {
		return this.retrieve({
			minRelevance: 0.85,
			sortBy: "relevance_score",
			sortOrder: "desc",
			limit,
		})
	}

	/**
	 * Get lessons relevant to a specific file path
	 */
	async getLessonsForFile(filePath: string, limit = 5): Promise<Lesson[]> {
		return this.retrieve({
			files: [filePath],
			sortBy: "relevance_score",
			sortOrder: "desc",
			limit,
		})
	}

	/**
	 * Get lessons relevant to a task type
	 */
	async getLessonsForTask(taskType: string, limit = 5): Promise<Lesson[]> {
		const tagMap: Record<string, string[]> = {
			coding: ["superroo-core", "vscode-extension", "typescript"],
			debugging: ["debugging", "error-handling", "testing"],
			testing: ["testing", "vitest", "error-handling"],
			deployment: ["deployment", "docker", "pm2", "vps"],
			ml: ["ml-engine", "tensor", "training"],
			ui: ["ui", "react", "webview", "state-management"],
			infrastructure: ["infrastructure", "security", "coordination"],
			"model-routing": ["model-router", "ai-providers", "routing"],
		}

		const tags = tagMap[taskType] || [taskType]

		return this.retrieve({
			tags,
			matchAnyTag: true,
			sortBy: "relevance_score",
			sortOrder: "desc",
			limit,
		})
	}

	/**
	 * Format lessons for inclusion in a prompt
	 */
	formatForPrompt(lessons: Lesson[], format: "codex" | "claude" | "deepseek" | "kimi" = "codex"): string {
		if (lessons.length === 0) {
			return ""
		}

		const sections = lessons.map((lesson, i) => {
			const rule = lesson.rule_summary
			const summary = lesson.lesson_summary

			switch (format) {
				case "codex":
					return `${i + 1}. **${lesson.title}** (relevance: ${lesson.relevance_score.toFixed(2)})\n   - Rule: ${rule}\n   - Context: ${summary.slice(0, 100)}...`

				case "claude":
					return `### ${lesson.title}\n**Relevance:** ${lesson.relevance_score.toFixed(2)} | **Confidence:** ${lesson.confidence}\n\n**Rule:** ${rule}\n\n**Lesson:** ${summary}`

				case "deepseek":
					return `[${i + 1}] ${lesson.title}\n   RULE: ${rule}\n   WHY: ${summary.slice(0, 80)}...`

				case "kimi":
					return `${i + 1}. ${lesson.title} [${lesson.tags.slice(0, 3).join(", ")}]\n   → ${rule}`

				default:
					return `- ${lesson.title}: ${rule}`
			}
		})

		const header =
			format === "claude" ? "## Relevant Lessons from SuperRoo Intelligence Layer\n" : "\n📚 Relevant Lessons:\n"

		return header + sections.join("\n\n")
	}

	/**
	 * Get lesson statistics
	 */
	getStats(): {
		total: number
		byType: Record<string, number>
		byModel: Record<string, number>
		byTag: Record<string, number>
		avgRelevance: number
	} {
		const byType: Record<string, number> = {}
		const byModel: Record<string, number> = {}
		const byTag: Record<string, number> = {}

		let totalRelevance = 0

		for (const lesson of this.lessons) {
			byType[lesson.type] = (byType[lesson.type] || 0) + 1
			byModel[lesson.model] = (byModel[lesson.model] || 0) + 1

			for (const tag of lesson.tags) {
				byTag[tag] = (byTag[tag] || 0) + 1
			}

			totalRelevance += lesson.relevance_score
		}

		return {
			total: this.lessons.length,
			byType,
			byModel,
			byTag,
			avgRelevance: this.lessons.length > 0 ? totalRelevance / this.lessons.length : 0,
		}
	}
}

// Singleton instance
let defaultRetriever: LessonRetriever | null = null

export function getLessonRetriever(indexPath?: string, remoteUrl?: string, remoteProject?: string): LessonRetriever {
	if (!defaultRetriever) {
		defaultRetriever = new LessonRetriever(indexPath, remoteUrl, remoteProject)
	}
	return defaultRetriever
}

/**
 * Reset the singleton (useful for testing or reconfiguration).
 */
export function resetLessonRetriever(): void {
	defaultRetriever = null
}
