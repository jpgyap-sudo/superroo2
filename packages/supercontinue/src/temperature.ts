/**
 * SuperContinue Adaptive Temperature Control
 *
 * Dynamically adjusts model temperature based on task risk and confidence.
 */

import { getModelRouter, type TaskFeatures, type ModelPrediction } from "./router.js"

export interface TemperatureContext {
	successProb: number
	bugRiskClass: number
	complexity: number
	confidence: number
}

/**
 * Adaptive temperature controller for Ollama models.
 */
export class TemperatureController {
	private static instance: TemperatureController | null = null
	private router = getModelRouter()

	private constructor() {}

	static getInstance(): TemperatureController {
		if (!TemperatureController.instance) {
			TemperatureController.instance = new TemperatureController()
		}
		return TemperatureController.instance
	}

	/**
	 * Get adaptive temperature based on task context.
	 */
	getTemperature(context: TemperatureContext): number {
		const { successProb, bugRiskClass, complexity } = context

		// High confidence → deterministic (low temperature)
		if (successProb > 0.9) {
			return 0.0
		}

		// High risk → need exploration (higher temperature)
		if (bugRiskClass >= 2) {
			return 0.4
		}

		// Medium risk → balanced
		if (bugRiskClass === 1) {
			return 0.2
		}

		// High complexity → moderate creativity
		if (complexity > 15) {
			return 0.15
		}

		// Default → low temperature for consistency
		return 0.1
	}

	/**
	 * Get temperature from model prediction.
	 */
	getTemperatureFromPrediction(prediction: ModelPrediction): number {
		return this.getTemperature({
			successProb: prediction.successProb,
			bugRiskClass: prediction.bugRiskClass,
			complexity: prediction.quality,
			confidence: prediction.confidence,
		})
	}

	/**
	 * Get temperature from task features.
	 */
	async getTemperatureFromFeatures(features: TaskFeatures): Promise<number> {
		const prediction = await this.router.predict(features)
		return this.getTemperatureFromPrediction(prediction)
	}

	/**
	 * Temperature presets for different scenarios.
	 */
	static readonly PRESETS = {
		DETERMINISTIC: 0.0,
		CONSERVATIVE: 0.1,
		BALANCED: 0.2,
		CREATIVE: 0.3,
		EXPLORATORY: 0.5,
	} as const

	/**
	 * Get temperature preset by name.
	 */
	getPreset(name: keyof typeof TemperatureController.PRESETS): number {
		return TemperatureController.PRESETS[name]
	}
}

export const getTemperatureController = (): TemperatureController => TemperatureController.getInstance()