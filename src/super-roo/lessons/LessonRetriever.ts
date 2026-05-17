/**
 * Lesson Retriever
 *
 * Retrieves relevant lessons from the lesson index based on context,
 * tags, and relevance scoring. Used to inject institutional knowledge
 * into model prompts.
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

export interface RetrieveOptions {
	/** Filter by tags (lessons must have ALL specified tags) */
	tags?: string[]
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

	constructor(indexPath?: string) {
		this.indexPath = indexPath || path.resolve(process.cwd(), "memory/lesson-index.jsonl")
	}

	/**
	 * Load lessons from the JSONL index file
	 */
	async load(): Promise<void> {
		if (this.loaded) return

		try {
			const content = await fs.readFile(this.indexPath, "utf-8")
			this.lessons = content
				.split("\n")
				.filter((line) => line.trim())
				.map((line) => JSON.parse(line))

			this.loaded = true
		} catch (error) {
			console.warn("[LessonRetriever] Failed to load lesson index:", error)
			this.lessons = []
		}
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
				const hasAllTags = options.tags.every((tag) => lesson.tags.includes(tag))
				if (!hasAllTags) return false
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

export function getLessonRetriever(): LessonRetriever {
	if (!defaultRetriever) {
		defaultRetriever = new LessonRetriever()
	}
	return defaultRetriever
}
