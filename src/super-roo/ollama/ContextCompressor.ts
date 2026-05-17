import { OllamaClient } from "./OllamaClient"

export class ContextCompressor {
	constructor(private ollama = new OllamaClient()) {}

	async compressForModel(params: {
		title: string
		goal: string
		context: string
		target: "codex" | "deepseek" | "telegram" | "memory"
		maxChars?: number
	}): Promise<string> {
		const maxChars = params.maxChars || 24000
		const context =
			params.context.length > maxChars
				? `${params.context.slice(0, Math.floor(maxChars * 0.7))}\n\n...[TRUNCATED]...\n\n${params.context.slice(-Math.floor(maxChars * 0.3))}`
				: params.context

		return this.ollama.generate({
			temperature: 0,
			system: "You compress engineering context. Keep filenames, errors, decisions, commands, and next actions. Remove noise.",
			prompt: `Target model: ${params.target}\nTitle: ${params.title}\nGoal: ${params.goal}\n\nCompress the context into:\n1. Current objective\n2. Relevant files\n3. Errors/evidence\n4. Constraints\n5. Exact next action\n\nContext:\n${context}`,
		})
	}
}
