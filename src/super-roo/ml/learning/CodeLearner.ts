/**
 * Super Roo ML — CodeLearner
 *
 * Deep neural network that learns coding patterns from historical task data.
 * Uses the pure-TS Tensor engine with a multi-task architecture:
 *   - Shared encoder (Dense + ReLU + BatchNorm backbone)
 *   - Quality head (regression: MSE)
 *   - Success head (classification: CrossEntropy)
 *   - BugRisk head (classification: CrossEntropy)
 *
 * The encoder is now trained end-to-end jointly with each head, and weights
 * can be persisted to / restored from disk.
 */

import { NeuralNetwork } from "../engine/NeuralNetwork"
import { MSELoss, CrossEntropyLoss } from "../engine/Loss"
import { Tensor } from "../engine/Tensor"
import { ModelPersistence } from "../engine/ModelPersistence"
import { trainEndToEnd } from "./LearnerUtils"
import {
	computeClassificationMetrics,
	computeMultiClassConfusionMatrix,
	computeRegressionMetrics,
	type ClassificationMetrics,
	type RegressionMetrics,
} from "../engine/Metrics"

export interface CodeSample {
	/** Normalised feature vector (file count, line count, complexity, etc.) */
	features: number[]
	/** Quality score 0-1 (from reviewer / linter / human) */
	quality?: number
	/** 1 = succeeded, 0 = failed */
	success?: number
	/** Bug risk class: 0=low, 1=medium, 2=high */
	bugRisk?: number
}

export interface CodeLearnerConfig {
	inputDim: number
	encoderDims?: number[]
	learningRate?: number
	batchSize?: number
	epochs?: number
	/** Optional directory to persist / restore model weights. */
	modelDir?: string
}

export interface CodeLearnerMetrics {
	quality: RegressionMetrics | null
	success: ClassificationMetrics | null
	bugRisk: ClassificationMetrics | null
}

export class CodeLearner {
	private encoder: NeuralNetwork
	private qualityHead: NeuralNetwork
	private successHead: NeuralNetwork
	private bugRiskHead: NeuralNetwork
	private config: Required<
		Pick<CodeLearnerConfig, "inputDim" | "encoderDims" | "learningRate" | "batchSize" | "epochs">
	> &
		Pick<CodeLearnerConfig, "modelDir">
	private persistence?: ModelPersistence

	constructor(config: CodeLearnerConfig) {
		this.config = {
			inputDim: config.inputDim,
			encoderDims: config.encoderDims ?? [128, 64],
			learningRate: config.learningRate ?? 0.001,
			batchSize: config.batchSize ?? 16,
			epochs: config.epochs ?? 50,
			modelDir: config.modelDir,
		}

		const encoderOut = this.config.encoderDims[this.config.encoderDims.length - 1] ?? 64

		this.encoder = new NeuralNetwork({
			inputDim: this.config.inputDim,
			outputDim: encoderOut,
			hiddenDims: this.config.encoderDims.slice(0, -1),
			activation: "relu",
			finalActivation: "none",
			useBatchNorm: true,
			dropout: 0.2,
		})

		this.qualityHead = new NeuralNetwork({
			inputDim: encoderOut,
			outputDim: 1,
			hiddenDims: [32],
			activation: "relu",
			finalActivation: "sigmoid",
		})

		this.successHead = new NeuralNetwork({
			inputDim: encoderOut,
			outputDim: 2,
			hiddenDims: [32],
			activation: "relu",
			finalActivation: "softmax",
		})

		this.bugRiskHead = new NeuralNetwork({
			inputDim: encoderOut,
			outputDim: 3,
			hiddenDims: [32],
			activation: "relu",
			finalActivation: "softmax",
		})

		if (this.config.modelDir) {
			this.persistence = new ModelPersistence({ dir: this.config.modelDir, name: "code-learner" })
		}
	}

	/** Restore weights from disk if available. */
	async restore(): Promise<boolean> {
		if (!this.persistence) return false
		const weights = await this.persistence.load()
		if (!weights) return false
		this.encoder.deserialise(weights.encoder)
		if (weights.heads.quality) this.qualityHead.deserialise(weights.heads.quality)
		if (weights.heads.success) this.successHead.deserialise(weights.heads.success)
		if (weights.heads.bugRisk) this.bugRiskHead.deserialise(weights.heads.bugRisk)
		return true
	}

	/** Persist current weights to disk. */
	async save(): Promise<void> {
		if (!this.persistence) return
		await this.persistence.save({
			version: 1,
			encoder: this.encoder.serialise(),
			heads: {
				quality: this.qualityHead.serialise(),
				success: this.successHead.serialise(),
				bugRisk: this.bugRiskHead.serialise(),
			},
		})
	}

	/** Train on a batch of code samples. Updates encoder end-to-end. */
	train(samples: CodeSample[]): { qualityLoss: number; successLoss: number; bugRiskLoss: number } {
		if (samples.length === 0) return { qualityLoss: 0, successLoss: 0, bugRiskLoss: 0 }

		const qualitySamples = samples.filter((s) => s.quality !== undefined)
		const successSamples = samples.filter((s) => s.success !== undefined)
		const bugRiskSamples = samples.filter((s) => s.bugRisk !== undefined)

		let qualityLoss = 0
		let successLoss = 0
		let bugRiskLoss = 0

		// Train quality head end-to-end
		if (qualitySamples.length > 0) {
			const X = Tensor.from2D(qualitySamples.map((s) => s.features))
			const y = Tensor.from2D(qualitySamples.map((s) => [s.quality!]))
			const losses = trainEndToEnd(
				this.encoder,
				this.qualityHead,
				X,
				y,
				new MSELoss(),
				this.config.epochs,
				this.config.batchSize,
				this.config.learningRate,
			)
			qualityLoss = losses[losses.length - 1] ?? 0
		}

		// Train success head end-to-end
		if (successSamples.length > 0) {
			const X = Tensor.from2D(successSamples.map((s) => s.features))
			const y = Tensor.from2D(successSamples.map((s) => (s.success === 1 ? [0, 1] : [1, 0])))
			const losses = trainEndToEnd(
				this.encoder,
				this.successHead,
				X,
				y,
				new CrossEntropyLoss(),
				this.config.epochs,
				this.config.batchSize,
				this.config.learningRate,
			)
			successLoss = losses[losses.length - 1] ?? 0
		}

		// Train bug-risk head end-to-end
		if (bugRiskSamples.length > 0) {
			const X = Tensor.from2D(bugRiskSamples.map((s) => s.features))
			const y = Tensor.from2D(
				bugRiskSamples.map((s) => {
					const vec = [0, 0, 0]
					vec[s.bugRisk!] = 1
					return vec
				}),
			)
			const losses = trainEndToEnd(
				this.encoder,
				this.bugRiskHead,
				X,
				y,
				new CrossEntropyLoss(),
				this.config.epochs,
				this.config.batchSize,
				this.config.learningRate,
			)
			bugRiskLoss = losses[losses.length - 1] ?? 0
		}

		return { qualityLoss, successLoss, bugRiskLoss }
	}

	/** Compute per-head metrics on the given samples. */
	evaluate(samples: CodeSample[]): CodeLearnerMetrics {
		const qualityPreds: number[] = []
		const qualityActual: number[] = []
		const successPreds: number[] = []
		const successActual: number[] = []
		const bugRiskPreds: number[] = []
		const bugRiskActual: number[] = []

		for (const s of samples) {
			const pred = this.predict(s.features)
			if (s.quality !== undefined) {
				qualityPreds.push(pred.quality)
				qualityActual.push(s.quality)
			}
			if (s.success !== undefined) {
				successPreds.push(pred.successProb >= 0.5 ? 1 : 0)
				successActual.push(s.success)
			}
			if (s.bugRisk !== undefined) {
				bugRiskPreds.push(pred.bugRiskClass)
				bugRiskActual.push(s.bugRisk)
			}
		}

		return {
			quality: qualityPreds.length > 0 ? computeRegressionMetrics(qualityPreds, qualityActual) : null,
			success: successPreds.length > 0 ? computeClassificationMetrics(successPreds, successActual) : null,
			bugRisk: bugRiskPreds.length > 0 ? computeClassificationMetrics(bugRiskPreds, bugRiskActual) : null,
		}
	}

	/** Predict quality score (0-1), success probability, and bug risk for a feature vector. */
	predict(features: number[]): { quality: number; successProb: number; bugRiskClass: number } {
		const x = Tensor.from2D([features])
		const encoded = this.encoder.predict(x)

		const qualityOut = this.qualityHead.predict(encoded)
		const successOut = this.successHead.predict(encoded)
		const bugRiskOut = this.bugRiskHead.predict(encoded)

		return {
			quality: qualityOut.get(0, 0),
			successProb: successOut.get(0, 1),
			bugRiskClass: bugRiskOut.argmax(1)[0],
		}
	}

	/** Build a feature vector from raw code metadata. */
	static extractFeatures(meta: {
		fileCount: number
		lineCount: number
		cyclomaticComplexity: number
		functionCount: number
		testCoverage: number
		lintErrors: number
		importsCount: number
		depth: number
	}): number[] {
		// Normalise to roughly 0-1 range
		return [
			Math.min(meta.fileCount / 20, 1),
			Math.min(meta.lineCount / 1000, 1),
			Math.min(meta.cyclomaticComplexity / 50, 1),
			Math.min(meta.functionCount / 50, 1),
			meta.testCoverage,
			Math.min(meta.lintErrors / 20, 1),
			Math.min(meta.importsCount / 30, 1),
			Math.min(meta.depth / 10, 1),
		]
	}
}
