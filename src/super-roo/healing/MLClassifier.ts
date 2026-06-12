/**
 * Super Roo — ML-Based Root Cause Classifier.
 *
 * Uses the ML engine's NeuralNetwork to learn from historical incidents
 * and provide learned classification alongside keyword-based matching.
 *
 * Architecture:
 * - Feature vector: bag-of-keywords over all CLASSIFICATION_PATTERNS keywords
 * - Output: one-hot encoded category vector (21 categories including UNKNOWN)
 * - Training data: historical incidents with known root cause categories
 * - Fallback: keyword-based classifier when model is not trained
 *
 * The classifier trains incrementally — each new confirmed incident
 * becomes a training example for the next cycle.
 */

import type { RootCauseCategory, IncidentRecord } from "../types"
import { NeuralNetwork } from "../ml/engine/NeuralNetwork"
import { Tensor } from "../ml/engine/Tensor"
import { CrossEntropyLoss } from "../ml/engine/Loss"
import { CLASSIFICATION_PATTERNS, classifyRootCause, MIN_CONFIDENCE } from "./RootCauseClassifier"
import type { ClassificationResult } from "./RootCauseClassifier"

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export interface TrainingExample {
	text: string
	category: RootCauseCategory
	confirmed: boolean
}

export interface MLClassifierConfig {
	/** Hidden layer size. Default: 16 */
	hiddenSize: number
	/** Learning rate for training. Default: 0.01 */
	learningRate: number
	/** Training epochs per batch. Default: 50 */
	epochsPerBatch: number
	/** Minimum examples per category before training. Default: 2 */
	minExamplesPerCategory: number
	/** Whether to auto-train when new examples are added. Default: true */
	autoTrain: boolean
}

// ──────────────────────────────────────────────────────────────────────────────
// Category vocabulary — ordered list matching the NeuralNetwork output layer
// ──────────────────────────────────────────────────────────────────────────────

const ALL_CATEGORIES: RootCauseCategory[] = [
	"ENV_MISSING",
	"DB_SCHEMA_MISMATCH",
	"API_AUTH_FAILURE",
	"API_RATE_LIMIT",
	"BROKEN_ROUTE",
	"FRONTEND_CORS",
	"WORKER_CRASH",
	"STALE_DATA",
	"TRADING_GATE_BLOCKED",
	"DEPLOY_DRIFT",
	"TEST_FAILURE",
	"SECURITY_RISK",
	"MEMORY_LEAK",
	"RACE_CONDITION",
	"CONFIGURATION_ERROR",
	"DEPENDENCY_CONFLICT",
	"AUTHENTICATION_FAILURE",
	"NETWORK_TIMEOUT",
	"FILE_SYSTEM_ERROR",
	"DNS_RESOLUTION",
	"SSL_TLS_ERROR",
	"UNKNOWN",
]

const NUM_CATEGORIES = ALL_CATEGORIES.length

// ──────────────────────────────────────────────────────────────────────────────
// Feature extraction
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Build a feature vector from text by checking keyword presence.
 * Each keyword from CLASSIFICATION_PATTERNS becomes a binary feature.
 */
function extractFeatures(text: string): number[] {
	const textLower = text.toLowerCase()
	const allKeywords = new Set<string>()

	for (const pattern of CLASSIFICATION_PATTERNS) {
		for (const kw of pattern.keywords) {
			allKeywords.add(kw.toLowerCase())
		}
	}

	const keywordList = Array.from(allKeywords)
	return keywordList.map((kw) => (textLower.includes(kw) ? 1 : 0))
}

/**
 * Get the feature dimension (number of unique keywords).
 */
export function getFeatureDimension(): number {
	const allKeywords = new Set<string>()
	for (const pattern of CLASSIFICATION_PATTERNS) {
		for (const kw of pattern.keywords) {
			allKeywords.add(kw.toLowerCase())
		}
	}
	return allKeywords.size
}

/**
 * Convert a category to a one-hot encoded target vector.
 */
function categoryToOneHot(category: RootCauseCategory): number[] {
	const vec = new Array(NUM_CATEGORIES).fill(0)
	const idx = ALL_CATEGORIES.indexOf(category)
	if (idx >= 0) {
		vec[idx] = 1
	}
	return vec
}

/**
 * Convert a NeuralNetwork output vector to a category prediction.
 */
function oneHotToCategory(output: number[]): { category: RootCauseCategory; confidence: number } {
	let bestIdx = 0
	let bestVal = output[0] ?? 0

	for (let i = 1; i < output.length; i++) {
		const val = output[i] ?? 0
		if (val > bestVal) {
			bestVal = val
			bestIdx = i
		}
	}

	return {
		category: ALL_CATEGORIES[bestIdx] ?? "UNKNOWN",
		confidence: bestVal,
	}
}

// ──────────────────────────────────────────────────────────────────────────────
// MLClassifier
// ──────────────────────────────────────────────────────────────────────────────

export class MLClassifier {
	private network: NeuralNetwork | null = null
	private trained = false
	private trainingExamples: TrainingExample[] = []
	private config: Required<MLClassifierConfig>
	private featureDim: number

	constructor(config: Partial<MLClassifierConfig> = {}) {
		this.config = {
			hiddenSize: 16,
			learningRate: 0.01,
			epochsPerBatch: 50,
			minExamplesPerCategory: 2,
			autoTrain: true,
			...config,
		}
		this.featureDim = getFeatureDimension()
	}

	// ────────────────────────────────────────────────────────────────────────────
	// Training
	// ────────────────────────────────────────────────────────────────────────────

	/**
	 * Add a training example from a confirmed incident.
	 * Returns true if the example was added (category is known).
	 */
	addExample(incident: IncidentRecord | TrainingExample): boolean {
		const example: TrainingExample =
			"text" in incident
				? incident
				: {
						text: `${incident.title} ${incident.symptom} ${JSON.stringify(incident.evidence ?? {})}`,
						category: incident.rootCauseCategory ?? "UNKNOWN",
						confirmed: true,
					}

		if (example.category === "UNKNOWN") {
			return false
		}

		this.trainingExamples.push(example)

		if (this.config.autoTrain && this.hasMinimumExamples()) {
			this.train()
		}

		return true
	}

	/**
	 * Add multiple training examples at once.
	 */
	addExamples(examples: (IncidentRecord | TrainingExample)[]): number {
		let added = 0
		for (const ex of examples) {
			if (this.addExample(ex)) {
				added++
			}
		}
		return added
	}

	/**
	 * Check if we have the minimum number of examples per category.
	 */
	hasMinimumExamples(): boolean {
		const counts = new Map<RootCauseCategory, number>()
		for (const ex of this.trainingExamples) {
			counts.set(ex.category, (counts.get(ex.category) ?? 0) + 1)
		}

		for (const cat of ALL_CATEGORIES) {
			if (cat === "UNKNOWN") continue
			const count = counts.get(cat) ?? 0
			if (count > 0 && count < this.config.minExamplesPerCategory) {
				return false
			}
		}

		return counts.size >= 2 // Need at least 2 categories with examples
	}

	/**
	 * Train the neural network on accumulated examples.
	 */
	train(): void {
		if (this.trainingExamples.length < 2) {
			return // Not enough data
		}

		// Build the network if not already created
		if (!this.network) {
			this.network = new NeuralNetwork({
				inputDim: this.featureDim,
				outputDim: NUM_CATEGORIES,
				hiddenDims: [this.config.hiddenSize],
				activation: "relu",
				finalActivation: "softmax",
			})
		}

		// Prepare training data
		const X = new Tensor(this.trainingExamples.length, this.featureDim)
		const y = new Tensor(this.trainingExamples.length, NUM_CATEGORIES)

		for (let i = 0; i < this.trainingExamples.length; i++) {
			const features = extractFeatures(this.trainingExamples[i].text)
			const target = categoryToOneHot(this.trainingExamples[i].category)
			for (let j = 0; j < this.featureDim; j++) {
				X.data[i * this.featureDim + j] = features[j] ?? 0
			}
			for (let j = 0; j < NUM_CATEGORIES; j++) {
				y.data[i * NUM_CATEGORIES + j] = target[j] ?? 0
			}
		}

		// Train
		const lossFn = new CrossEntropyLoss()
		this.network.train(X, y, lossFn, {
			epochs: this.config.epochsPerBatch,
			learningRate: this.config.learningRate,
			batchSize: Math.min(16, this.trainingExamples.length),
		})

		this.trained = true
	}

	// ────────────────────────────────────────────────────────────────────────────
	// Classification
	// ────────────────────────────────────────────────────────────────────────────

	/**
	 * Classify an incident using the trained ML model.
	 * Falls back to keyword-based classification if model is not trained.
	 */
	classify(incident: IncidentRecord): ClassificationResult {
		// If not trained, fall back to keyword classifier
		if (!this.trained || !this.network) {
			return classifyRootCause(incident)
		}

		const text = buildMLClassificationText(incident)
		const features = extractFeatures(text)

		// If no keywords matched, fall back to keyword classifier
		if (features.every((f) => f === 0)) {
			return classifyRootCause(incident)
		}

		const input = Tensor.from1D(features)
		const output = this.network.predict(input)
		const outputArr = output.to2D()[0] ?? []

		const { category, confidence } = oneHotToCategory(outputArr)

		// If confidence is too low, fall back to keyword classifier
		if (confidence < MIN_CONFIDENCE) {
			const fallback = classifyRootCause(incident)
			return {
				...fallback,
				reasoning: `ML confidence too low (${confidence.toFixed(3)}), fell back to keyword matching: ${fallback.reasoning}`,
			}
		}

		return {
			category,
			confidence,
			reasoning: `ML classifier predicted ${category} with confidence ${confidence.toFixed(3)} (trained on ${this.trainingExamples.length} examples)`,
		}
	}

	/**
	 * Classify from raw text (for inline use).
	 */
	classifyFromText(text: string, defaultCategory: RootCauseCategory = "UNKNOWN"): ClassificationResult {
		const mockIncident: IncidentRecord = {
			id: "temp",
			fingerprint: "temp",
			featureKey: null,
			sourceAgent: "unknown",
			title: text,
			symptom: text,
			severity: "medium",
			status: "new",
			rootCauseCategory: null,
			affectedFiles: [],
			recommendedAction: null,
			evidence: {},
			autoFixAllowed: false,
			fixAttempts: 0,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		}

		const result = this.classify(mockIncident)
		if (result.category === "UNKNOWN") {
			result.category = defaultCategory
		}
		return result
	}

	// ────────────────────────────────────────────────────────────────────────────
	// Status
	// ────────────────────────────────────────────────────────────────────────────

	/**
	 * Whether the model has been trained.
	 */
	isTrained(): boolean {
		return this.trained
	}

	/**
	 * Get all training examples (GAP #5 — exposed for InfiniteImprovementLoop integration).
	 */
	getTrainingExamples(): TrainingExample[] {
		return [...this.trainingExamples]
	}

	/**
	 * Number of training examples accumulated.
	 */
	getExampleCount(): number {
		return this.trainingExamples.length
	}

	/**
	 * Get the distribution of training examples by category.
	 */
	getExampleDistribution(): Record<RootCauseCategory, number> {
		const dist: Record<string, number> = {}
		for (const cat of ALL_CATEGORIES) {
			dist[cat] = 0
		}
		for (const ex of this.trainingExamples) {
			dist[ex.category] = (dist[ex.category] ?? 0) + 1
		}
		return dist as Record<RootCauseCategory, number>
	}

	/**
	 * Reset the classifier (clears model and training data).
	 */
	reset(): void {
		this.network = null
		this.trained = false
		this.trainingExamples = []
	}

	/**
	 * Get the underlying neural network (for serialization).
	 */
	getNetwork(): NeuralNetwork | null {
		return this.network
	}

}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function buildMLClassificationText(incident: IncidentRecord): string {
	const parts = [incident.title, incident.symptom]

	if (incident.evidence) {
		parts.push(JSON.stringify(incident.evidence))
	}

	return parts.join(" ")
}
