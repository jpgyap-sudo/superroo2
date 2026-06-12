/**
 * SuperContinue Neural Model Router
 *
 * Uses SuperRoo's ML engine to predict optimal model per task.
 */

import { getSuperContinueBrain } from "./brain.js"

export interface TaskFeatures {
	fileCount: number
	lineCount: number
	cyclomaticComplexity: number
	functionCount: number
	testCoverage: number
	lintErrors: number
	importsCount: number
	depth: number
}

export interface ModelPrediction {
	model: string
	confidence: number
	quality: number
	successProb: number
	bugRiskClass: number
}

/**
 * Neural model router that selects the best Ollama model based on task features.
 */
export class ModelRouter {
	private static instance: ModelRouter | null = null
	private brain = getSuperContinueBrain()

	private constructor() {}

	static getInstance(): ModelRouter {
		if (!ModelRouter.instance) {
			ModelRouter.instance = new ModelRouter()
		}
		return ModelRouter.instance
	}

	/**
	 * Extract features from a task description and codebase context.
	 */
	extractFeatures(input: {
		fileCount?: number
		lineCount?: number
		cyclomaticComplexity?: number
		functionCount?: number
		testCoverage?: number
		lintErrors?: number
		importsCount?: number
		depth?: number
	}): TaskFeatures {
		return {
			fileCount: input.fileCount ?? 1,
			lineCount: input.lineCount ?? 100,
			cyclomaticComplexity: input.cyclomaticComplexity ?? 5,
			functionCount: input.functionCount ?? 10,
			testCoverage: input.testCoverage ?? 0.5,
			lintErrors: input.lintErrors ?? 0,
			importsCount: input.importsCount ?? 5,
			depth: input.depth ?? 2,
		}
	}

	/**
	 * Predict the optimal model for a task.
	 * Uses heuristics when ML model is unavailable.
	 */
	async predict(features: TaskFeatures): Promise<ModelPrediction> {
		// Try to get ML prediction from Central Brain
		try {
			const lessons = await this.brain.getRelevantLessons("model selection routing")
			if (lessons) {
				// Use learned patterns to inform decision
				return this._applyLearnedPatterns(features, lessons)
			}
		} catch {
			// Fall through to heuristic routing
		}

		// Heuristic-based routing
		return this._heuristicRoute(features)
	}

	/**
	 * Apply learned patterns from the Central Brain.
	 */
	private _applyLearnedPatterns(features: TaskFeatures, lessons: string): ModelPrediction {
		// Parse lessons for model selection patterns
		const lines = lessons.split("\n")
		const learnedModel = lines.find((l) => l.includes("qwen2.5-coder"))

		if (learnedModel && features.lineCount > 500) {
			return {
				model: "qwen2.5-coder:14b",
				confidence: 0.85,
				quality: 0.9,
				successProb: 0.85,
				bugRiskClass: features.cyclomaticComplexity > 20 ? 2 : 1,
			}
		}

		return this._heuristicRoute(features)
	}

	/**
	 * Heuristic-based model selection.
	 */
	private _heuristicRoute(features: TaskFeatures): ModelPrediction {
		// Complex tasks → larger model
		if (features.lineCount > 500 || features.cyclomaticComplexity > 20) {
			return {
				model: "qwen2.5-coder:14b",
				confidence: 0.8,
				quality: 0.85,
				successProb: 0.8,
				bugRiskClass: 1,
			}
		}

		// Simple tasks → smaller, faster model
		if (features.lineCount < 100 && features.cyclomaticComplexity < 10) {
			return {
				model: "qwen2.5-coder:7b",
				confidence: 0.9,
				quality: 0.8,
				successProb: 0.9,
				bugRiskClass: 0,
			}
		}

		// Planning tasks → hermes3
		if (features.functionCount === 0 && features.lineCount === 0) {
			return {
				model: "hermes3:latest",
				confidence: 0.95,
				quality: 0.9,
				successProb: 0.95,
				bugRiskClass: 0,
			}
		}

		// Architecture tasks → phi4
		if (features.depth > 5) {
			return {
				model: "phi4:latest",
				confidence: 0.85,
				quality: 0.95,
				successProb: 0.85,
				bugRiskClass: 1,
			}
		}

		// Default to 7B coder
		return {
			model: "qwen2.5-coder:7b",
			confidence: 0.75,
			quality: 0.75,
			successProb: 0.75,
			bugRiskClass: 0,
		}
	}

	/**
	 * Record outcome for learning.
	 */
	async recordOutcome(
		features: TaskFeatures,
		model: string,
		success: boolean,
		quality: number
	): Promise<void> {
		await this.brain.storeLesson(
			"Model Selection Outcome",
			`Model ${model} for task with features: ${JSON.stringify(features)}. Success: ${success}, Quality: ${quality}`,
			["ml", "model-selection", "supercontinue"],
			[]
		)
	}
}

export const getModelRouter = (): ModelRouter => ModelRouter.getInstance()