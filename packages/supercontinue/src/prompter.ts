/**
 * SuperContinue Lesson-Augmented Prompts
 *
 * Enhances prompts with relevant lessons from the Central Brain.
 */

import { getSuperContinueBrain } from "./brain.js"

export interface PromptOptions {
	task: string
	files?: string[]
	maxLessons?: number
	includeContext?: boolean
	language?: string
}

export interface AugmentedPrompt {
	system: string
	user: string
	lessons: string
	context: string
}

/**
 * Lesson-augmented prompt builder.
 */
export class Prompter {
	private static instance: Prompter | null = null
	private brain = getSuperContinueBrain()

	private constructor() {}

	static getInstance(): Prompter {
		if (!Prompter.instance) {
			Prompter.instance = new Prompter()
		}
		return Prompter.instance
	}

	/**
	 * Build an augmented prompt with lessons.
	 */
	async buildPrompt(options: PromptOptions): Promise<AugmentedPrompt> {
		const { task, files = [], maxLessons = 5, includeContext = true } = options

		// Get relevant lessons
		const lessons = await this.brain.getRelevantLessons(task, maxLessons)

		// Build context
		let context = ""
		if (includeContext && files.length > 0) {
			context = await this._buildFileContext(files)
		}

		// Build system message
		const system = this._buildSystemMessage(lessons)

		// Build user message
		const user = this._buildUserMessage(task, context, lessons)

		return {
			system,
			user,
			lessons,
			context,
		}
	}

	/**
	 * Build system message with lessons.
	 */
	private _buildSystemMessage(lessons: string): string {
		const baseSystem = `You are SuperContinue, a pure local Ollama coding agent integrated with the SuperRoo ecosystem.
All models run locally via Ollama - no cloud connections.
All secrets stay within the SuperRoo ecosystem.
Contribute lessons to the learning layer after completing tasks.
Follow autonomous coding principles: plan decisively, iterate until success, record outcomes.`

		if (!lessons) return baseSystem

		return `${baseSystem}

## Relevant Lessons from Institutional Memory

${lessons}

Use these lessons to inform your approach to the task.`
	}

	/**
	 * Build user message.
	 */
	private _buildUserMessage(task: string, context: string, lessons: string): string {
		let message = `Task: ${task}`

		if (context) {
			message += `\n\n## File Context\n${context}`
		}

		if (lessons) {
			message += `\n\n## Reference Lessons\n${lessons}`
		}

		return message
	}

	/**
	 * Build context from files.
	 */
	private async _buildFileContext(files: string[]): Promise<string> {
		// This would read file contents in a real implementation
		// For now, return a placeholder
		return files.map((f) => `- ${f}`).join("\n")
	}

	/**
	 * Get just the lessons portion for injection.
	 */
	async getLessons(task: string, limit = 5): Promise<string> {
		return this.brain.getRelevantLessons(task, limit)
	}

	/**
	 * Format lessons for prompt injection.
	 */
	formatLessons(lessons: string, format: "markdown" | "text" = "markdown"): string {
		if (!lessons) return ""

		if (format === "markdown") {
			return `## Relevant Lessons\n\n${lessons}`
		}

		return lessons
	}
}

export const getPrompter = (): Prompter => Prompter.getInstance()