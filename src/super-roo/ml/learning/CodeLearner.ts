/**
 * Super Roo ML — CodeLearner
 *
 * Deep neural network that learns coding patterns from historical task data.
 * Trains on:
 *   - File paths + content signatures → predicted change quality score
 *   - Task descriptions → predicted success probability
 *   - Code AST feature vectors → predicted bug likelihood
 *
 * Uses the pure-TS Tensor engine with a multi-task architecture:
 *   - Shared encoder (Dense + ReLU + BatchNorm backbone)
 *   - Quality head (regression: MSE)
 *   - Success head (classification: CrossEntropy)
 *   - BugRisk head (classification: CrossEntropy)
 */

import { NeuralNetwork } from "../engine/NeuralNetwork"
import { MSELoss, CrossEntropyLoss } from "../engine/Loss"
import { Tensor } from "../engine/Tensor"

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
}

export class CodeLearner {
	private encoder: NeuralNetwork
	private qualityHead: NeuralNetwork
	private successHead: NeuralNetwork
	private bugRiskHead: NeuralNetwork
	private config: Required<CodeLearnerConfig>

	constructor(config: CodeLearnerConfig) {
		this.config = {
			inputDim: config.inputDim,
			encoderDims: config.encoderDims ?? [128, 64],
			learningRate: config.learningRate ?? 0.001,
			batchSize: config.batchSize ?? 16,
			epochs: config.epochs ?? 50,
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
	}

	/** Train on a batch of code samples. */
	train(samples: CodeSample[]): { qualityLoss: number; successLoss: number; bugRiskLoss: number } {
		if (samples.length === 0) return { qualityLoss: 0, successLoss: 0, bugRiskLoss: 0 }

		const qualitySamples = samples.filter((s) => s.quality !== undefined)
		const successSamples = samples.filter((s) => s.success !== undefined)
		const bugRiskSamples = samples.filter((s) => s.bugRisk !== undefined)

		let qualityLoss = 0
		let successLoss = 0
		let bugRiskLoss = 0

		// Train quality head
		if (qualitySamples.length > 0) {
			const X = Tensor.from2D(qualitySamples.map((s) => s.features))
			const y = Tensor.from2D(qualitySamples.map((s) => [s.quality!]))
			const encoded = this.encoder.predict(X)
			const losses = this.qualityHead.train(encoded, y, new MSELoss(), {
				epochs: this.config.epochs,
				batchSize: this.config.batchSize,
				learningRate: this.config.learningRate,
			})
			qualityLoss = losses[losses.length - 1] ?? 0
		}

		// Train success head
		if (successSamples.length > 0) {
			const X = Tensor.from2D(successSamples.map((s) => s.features))
			const y = Tensor.from2D(successSamples.map((s) => (s.success === 1 ? [0, 1] : [1, 0])))
			const encoded = this.encoder.predict(X)
			const losses = this.successHead.train(encoded, y, new CrossEntropyLoss(), {
				epochs: this.config.epochs,
				batchSize: this.config.batchSize,
				learningRate: this.config.learningRate,
			})
			successLoss = losses[losses.length - 1] ?? 0
		}

		// Train bug-risk head
		if (bugRiskSamples.length > 0) {
			const X = Tensor.from2D(bugRiskSamples.map((s) => s.features))
			const y = Tensor.from2D(
				bugRiskSamples.map((s) => {
					const vec = [0, 0, 0]
					vec[s.bugRisk!] = 1
					return vec
				}),
			)
			const encoded = this.encoder.predict(X)
			const losses = this.bugRiskHead.train(encoded, y, new CrossEntropyLoss(), {
				epochs: this.config.epochs,
				batchSize: this.config.batchSize,
				learningRate: this.config.learningRate,
			})
			bugRiskLoss = losses[losses.length - 1] ?? 0
		}

		return { qualityLoss, successLoss, bugRiskLoss }
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
