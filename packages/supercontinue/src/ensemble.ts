/**
 * SuperContinue Multi-Model Ensemble Voting
 *
 * Combines responses from multiple models for higher quality output.
 */

import { getModelRouter, type TaskFeatures } from "./router.js"

export interface ModelResponse {
	model: string
	response: string
	confidence: number
	latencyMs: number
}

export interface EnsembleResult {
	response: string
	confidence: number
	modelWeights: Record<string, number>
	consensus: boolean
}

/**
 * Multi-model ensemble voting system.
 */
export class EnsembleVoter {
	private static instance: EnsembleVoter | null = null
	private router = getModelRouter()

	private constructor() {}

	static getInstance(): EnsembleVoter {
		if (!EnsembleVoter.instance) {
			EnsembleVoter.instance = new EnsembleVoter()
		}
		return EnsembleVoter.instance
	}

	/**
	 * Get responses from multiple models.
	 */
	async getResponses(
		prompt: string,
		models: string[],
		options?: { timeoutMs?: number }
	): Promise<ModelResponse[]> {
		const responses: ModelResponse[] = []

		for (const model of models) {
			const start = Date.now()
			try {
				const response = await this._queryOllama(model, prompt, options)
				responses.push({
					model,
					response,
					confidence: 0.8,
					latencyMs: Date.now() - start,
				})
			} catch (err) {
				console.warn(`[EnsembleVoter] Model ${model} failed:`, err)
			}
		}

		return responses
	}

	/**
	 * Query Ollama for a response.
	 */
	private async _queryOllama(
		model: string,
		prompt: string,
		options?: { timeoutMs?: number }
	): Promise<string> {
		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), options?.timeoutMs ?? 30000)

		try {
			const res = await fetch("http://localhost:11434/api/generate", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					model,
					prompt,
					stream: false,
				}),
				signal: controller.signal,
			})

			if (!res.ok) {
				throw new Error(`Ollama API error: ${res.status}`)
			}

const json = (await res.json()) as { response?: string }
 			return json.response || ""
		} finally {
			clearTimeout(timeout)
		}
	}

	/**
	 * Perform weighted voting on model responses.
	 */
	vote(responses: ModelResponse[]): EnsembleResult {
		if (responses.length === 0) {
			return {
				response: "",
				confidence: 0,
				modelWeights: {},
				consensus: false,
			}
		}

		// Calculate weights based on confidence and inverse latency
		const modelWeights: Record<string, number> = {}
		let totalWeight = 0

		for (const r of responses) {
			// Weight = confidence * (1 / latency) - faster, more confident models get higher weight
			const latencyFactor = Math.max(0.1, 1 / (r.latencyMs / 1000))
			const weight = r.confidence * latencyFactor
			modelWeights[r.model] = weight
			totalWeight += weight
		}

		// Normalize weights
		for (const model of Object.keys(modelWeights)) {
			modelWeights[model] /= totalWeight
		}

		// For now, return the highest-weighted response
		// Future: implement actual text consensus algorithm
		const bestResponse = responses.reduce((best, current) => {
			const currentWeight = modelWeights[current.model] || 0
			const bestWeight = modelWeights[best.model] || 0
			return currentWeight > bestWeight ? current : best
		})

		// Check if responses agree (simple check)
		const consensus = this._checkConsensus(responses)

		return {
			response: bestResponse.response,
			confidence: bestResponse.confidence,
			modelWeights,
			consensus,
		}
	}

	/**
	 * Check if responses show consensus.
	 */
	private _checkConsensus(responses: ModelResponse[]): boolean {
		if (responses.length < 2) return true

		// Simple heuristic: check if any response contains similar key phrases
		const responseTexts = responses.map((r) => r.response.toLowerCase())
		const commonPhrases = this._extractKeyPhrases(responseTexts)

		// If at least 2 responses share common phrases, consider it consensus
		return commonPhrases.length >= 2
	}

	/**
	 * Extract key phrases from response texts.
	 */
	private _extractKeyPhrases(texts: string[]): string[] {
		const phraseCounts = new Map<string, number>()

		for (const text of texts) {
			// Extract 3-5 word phrases
			const words = text.split(/\s+/).filter((w) => w.length > 3)
			for (let i = 0; i < words.length - 2; i++) {
				const phrase = `${words[i]} ${words[i + 1]} ${words[i + 2]}`
				phraseCounts.set(phrase, (phraseCounts.get(phrase) || 0) + 1)
			}
		}

		// Return phrases that appear in multiple responses
		return Array.from(phraseCounts.entries())
			.filter(([, count]) => count >= 2)
			.map(([phrase]) => phrase)
	}

	/**
	 * Select models for ensemble based on task features.
	 */
	async selectModels(features: TaskFeatures): Promise<string[]> {
		const prediction = await this.router.predict(features)

		// For complex tasks, use multiple models
		if (features.lineCount > 300 || features.cyclomaticComplexity > 15) {
			return ["qwen2.5-coder:7b", "qwen2.5-coder:14b"]
		}

		// For simple tasks, single model is sufficient
		return [prediction.model]
	}
}

export const getEnsembleVoter = (): EnsembleVoter => EnsembleVoter.getInstance()