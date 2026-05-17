/**
 * Prompt Enhancer
 *
 * Enhances model prompts with relevant lessons from the SuperRoo
 * intelligence layer. Automatically injects contextually relevant
 * lessons based on the task being performed.
 */

import { LessonRetriever, getLessonRetriever, Lesson } from "./LessonRetriever"

export interface EnhanceOptions {
	/** The task type (coding, debugging, testing, etc.) */
	taskType?: string
	/** File paths being worked on */
	filePaths?: string[]
	/** The model being used (codex, claude, deepseek, kimi) */
	model: "codex" | "claude" | "deepseek" | "kimi"
	/** Maximum lessons to include */
	maxLessons?: number
	/** Minimum relevance score */
	minRelevance?: number
	/** Include only bug fixes */
	bugsOnly?: boolean
	/** Include only reusable rules */
	rulesOnly?: boolean
}

/**
 * Prompt Enhancer - Adds relevant lessons to model prompts
 */
export class PromptEnhancer {
	private retriever: LessonRetriever

	constructor(retriever?: LessonRetriever) {
		this.retriever = retriever || getLessonRetriever()
	}

	/**
	 * Enhance a prompt with relevant lessons
	 */
	async enhance(prompt: string, options: EnhanceOptions): Promise<string> {
		const lessons = await this.selectLessons(options)

		if (lessons.length === 0) {
			return prompt
		}

		const lessonSection = this.retriever.formatForPrompt(lessons, options.model)

		// Insert lessons at the appropriate location based on model
		return this.insertLessons(prompt, lessonSection, options.model)
	}

	/**
	 * Select relevant lessons based on options
	 *
	 * When using remote (cross-project) mode, increases the lesson count
	 * to compensate for broader, less-specific matches across projects.
	 */
	private async selectLessons(options: EnhanceOptions): Promise<Lesson[]> {
		// When using remote Central Brain (cross-project mode), fetch more lessons
		// since cross-project matches are broader and less specific
		const isRemote = this.retriever.isUsingRemote()
		const limit = options.maxLessons || (isRemote ? 10 : 5)
		const minRelevance = isRemote ? 0.6 : options.minRelevance || 0.8

		// If we have file paths, get lessons specific to those files
		if (options.filePaths && options.filePaths.length > 0) {
			const fileLessons: Lesson[] = []

			for (const filePath of options.filePaths.slice(0, 3)) {
				const lessons = await this.retriever.getLessonsForFile(filePath, 3)
				fileLessons.push(...lessons)
			}

			// Remove duplicates and filter by relevance
			const uniqueLessons = this.filterLessons(
				this.deduplicate(fileLessons).filter((l) => l.relevance_score >= minRelevance),
				options,
			).slice(0, limit)

			if (uniqueLessons.length >= 3) {
				return uniqueLessons
			}
		}

		// Otherwise, get lessons for the task type
		if (options.taskType) {
			const taskLessons = this.filterLessons(
				await this.retriever.getLessonsForTask(options.taskType, limit),
				options,
			)

			if (taskLessons.length > 0) {
				return taskLessons
			}
		}

		// Fallback to top lessons overall
		return this.filterLessons(await this.retriever.getTopLessons(limit), options)
	}

	/**
	 * Remove duplicate lessons by ID
	 */
	private deduplicate(lessons: Lesson[]): Lesson[] {
		const seen = new Set<string>()
		return lessons.filter((lesson) => {
			if (seen.has(lesson.id)) {
				return false
			}
			seen.add(lesson.id)
			return true
		})
	}

	private filterLessons(lessons: Lesson[], options: EnhanceOptions): Lesson[] {
		return lessons.filter((lesson) => {
			if (options.bugsOnly && lesson.type !== "bugfix") return false
			if (options.rulesOnly && !lesson.rule_summary?.trim()) return false
			return true
		})
	}

	/**
	 * Insert lesson section into prompt at appropriate location
	 */
	private insertLessons(prompt: string, lessonSection: string, model: string): string {
		if (!lessonSection.trim()) {
			return prompt
		}

		switch (model) {
			case "codex":
				// Insert after system instructions, before user query
				return this.insertAfterSystemInstructions(prompt, lessonSection)

			case "claude":
				// Insert as a context block
				return this.insertAsContextBlock(prompt, lessonSection)

			case "deepseek":
				// Insert at the beginning as context
				return `${lessonSection}\n\n${prompt}`

			case "kimi":
				// Insert before the main task
				return this.insertBeforeTask(prompt, lessonSection)

			default:
				return `${lessonSection}\n\n${prompt}`
		}
	}

	/**
	 * Insert after system instructions (for Codex)
	 */
	private insertAfterSystemInstructions(prompt: string, lessonSection: string): string {
		// Look for common system instruction markers
		const markers = ["</system_instructions>", "---", "## Task", "### User Request"]

		for (const marker of markers) {
			const index = prompt.indexOf(marker)
			if (index !== -1) {
				const insertPos = index + marker.length
				return prompt.slice(0, insertPos) + "\n\n" + lessonSection + "\n" + prompt.slice(insertPos)
			}
		}

		// If no marker found, insert after first paragraph
		const firstParaEnd = prompt.indexOf("\n\n")
		if (firstParaEnd !== -1) {
			return prompt.slice(0, firstParaEnd) + "\n\n" + lessonSection + prompt.slice(firstParaEnd)
		}

		// Fallback: prepend
		return lessonSection + "\n\n" + prompt
	}

	/**
	 * Insert as context block (for Claude)
	 */
	private insertAsContextBlock(prompt: string, lessonSection: string): string {
		// Wrap in XML tags for Claude
		const wrapped = `<relevant_lessons>\n${lessonSection}\n</relevant_lessons>`

		// Insert after system instructions or at the beginning
		const systemEnd = prompt.indexOf("</system>")
		if (systemEnd !== -1) {
			const insertPos = systemEnd + "</system>".length
			return prompt.slice(0, insertPos) + "\n\n" + wrapped + "\n" + prompt.slice(insertPos)
		}

		// Insert before user message
		const userMsg = prompt.indexOf("<user_message>")
		if (userMsg !== -1) {
			return prompt.slice(0, userMsg) + wrapped + "\n" + prompt.slice(userMsg)
		}

		// Fallback: prepend
		return wrapped + "\n\n" + prompt
	}

	/**
	 * Insert before task (for Kimi)
	 */
	private insertBeforeTask(prompt: string, lessonSection: string): string {
		// Look for task markers
		const taskMarkers = ["## Task:", "### Goal:", "**Task:**"]

		for (const marker of taskMarkers) {
			const index = prompt.indexOf(marker)
			if (index !== -1) {
				return prompt.slice(0, index) + lessonSection + "\n\n" + prompt.slice(index)
			}
		}

		// If no marker, insert at the beginning
		return lessonSection + "\n\n---\n\n" + prompt
	}

	/**
	 * Get quick lesson context for a specific file
	 */
	async getFileContext(filePath: string, model: EnhanceOptions["model"]): Promise<string> {
		const lessons = await this.retriever.getLessonsForFile(filePath, 3)

		if (lessons.length === 0) {
			return ""
		}

		return this.retriever.formatForPrompt(lessons, model)
	}

	/**
	 * Create a system prompt with embedded lessons
	 */
	async createSystemPrompt(
		basePrompt: string,
		options: Omit<EnhanceOptions, "model">,
		model: EnhanceOptions["model"],
	): Promise<string> {
		const lessons = await this.selectLessons({ ...options, model })

		if (lessons.length === 0) {
			return basePrompt
		}

		const lessonSection = this.retriever.formatForPrompt(lessons, model)

		return `${basePrompt}\n\n## Important Lessons from Previous Work\n\n${lessonSection}\n\nAlways consider these lessons when making decisions.`
	}
}

// Singleton instance
let defaultEnhancer: PromptEnhancer | null = null

export function getPromptEnhancer(): PromptEnhancer {
	if (!defaultEnhancer) {
		defaultEnhancer = new PromptEnhancer()
	}
	return defaultEnhancer
}

/**
 * Convenience function to enhance a prompt
 */
export async function enhancePrompt(prompt: string, options: EnhanceOptions): Promise<string> {
	const enhancer = getPromptEnhancer()
	return enhancer.enhance(prompt, options)
}
