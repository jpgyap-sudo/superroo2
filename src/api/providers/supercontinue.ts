/**
 * SuperContinue Provider
 *
 * Integrates SuperContinue package with SuperRoo's provider system.
 * Uses local Ollama models with ML enhancements.
 */

import { Anthropic } from "@anthropic-ai/sdk"
import { ModelInfo, openAiModelInfoSaneDefaults } from "@superroo/types"
import { ApiStream } from "../transform/stream"
import { BaseProvider } from "./base-provider"
import type { ApiHandlerOptions } from "../../shared/api"
import { NativeOllamaHandler } from "./native-ollama"
import { getSuperContinueBrain, MODEL_ROLES } from "@superroo/supercontinue"

export class SuperContinueHandler extends NativeOllamaHandler {
	private brain = getSuperContinueBrain()

	constructor(options: ApiHandlerOptions) {
		super(options)
	}

	/**
	 * Override to use SuperContinue's model selection.
	 */
	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		// Register lesson intent at session start
		await this.brain.registerLessonIntent("SuperContinue chat session")

		// Get relevant lessons for context enhancement
		const task = messages.map((m) => m.content).join(" ").slice(0, 200)
		const lessons = await this.brain.getRelevantLessons(task)

		// Enhance system prompt with lessons
		const enhancedSystem = lessons
			? `${systemPrompt}\n\n## Relevant Lessons\n${lessons}`
			: systemPrompt

		// Delegate to parent NativeOllamaHandler
		yield* super.createMessage(enhancedSystem, messages, metadata)
	}

	/**
	 * Get model info for SuperContinue models.
	 */
	override getModel(): { id: string; info: ModelInfo } {
		const modelId = this.options.ollamaModelId || MODEL_ROLES.CODING
		return {
			id: modelId,
			info: this.models[modelId] || openAiModelInfoSaneDefaults,
		}
	}

	/**
	 * Complete prompt with lesson augmentation.
	 */
	override async completePrompt(prompt: string): Promise<string> {
		// Get relevant lessons for context
		const lessons = await this.brain.getRelevantLessons(prompt)

		// Augment prompt with lessons
		const augmentedPrompt = lessons
			? `${prompt}\n\n## Reference Lessons\n${lessons}`
			: prompt

		return super.completePrompt(augmentedPrompt)
	}
}

export { SuperContinueHandler as SuperContinueProvider }