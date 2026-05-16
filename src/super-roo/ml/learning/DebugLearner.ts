/**
 * Super Roo ML — DebugLearner
 *
 * Learns from historical debugging sessions to predict:
 *   - Root-cause category from error signatures
 *   - Estimated fix complexity
 *   - Likely files involved
 *
 * Uses an encoder + multi-head architecture with end-to-end encoder training,
 * persistence, and evaluation metrics.
 */

import { NeuralNetwork } from "../engine/NeuralNetwork"
import { MSELoss, CrossEntropyLoss } from "../engine/Loss"
import { Tensor } from "../engine/Tensor"
import { ModelPersistence } from "../engine/ModelPersistence"
import { trainEndToEnd } from "./LearnerUtils"
import {
	computeClassificationMetrics,
	computeRegressionMetrics,
	type ClassificationMetrics,
	type RegressionMetrics,
} from "../engine/Metrics"

export interface DebugSample {
	/** Normalised error signature vector */
	features: number[]
	/** Root-cause category: 0=syntax, 1=logic, 2=type, 3=runtime, 4=env */
	causeCategory?: number
	/** Fix complexity 0-1 */
	fixComplexity?: number
	/** 1 = fix succeeded, 0 = fix failed */
	fixSuccess?: number
}

export interface DebugLearnerConfig {
	inputDim: number
	encoderDims?: number[]
	learningRate?: number
	batchSize?: number
	epochs?: number
	/** Optional directory to persist / restore model weights. */
	modelDir?: string
}

export interface DebugLearnerMetrics {
	cause: ClassificationMetrics | null
	complexity: RegressionMetrics | null
	fixSuccess: ClassificationMetrics | null
}

export class DebugLearner {
	private encoder: NeuralNetwork
	private causeHead: NeuralNetwork
	private complexityHead: NeuralNetwork
	private fixSuccessHead: NeuralNetwork
	private config: Required<
		Pick<DebugLearnerConfig, "inputDim" | "encoderDims" | "learningRate" | "batchSize" | "epochs">
	> &
		Pick<DebugLearnerConfig, "modelDir">
	private persistence?: ModelPersistence

	constructor(config: DebugLearnerConfig) {
		this.config = {
			inputDim: config.inputDim,
			encoderDims: config.encoderDims ?? [64, 32],
			learningRate: config.learningRate ?? 0.001,
			batchSize: config.batchSize ?? 16,
			epochs: config.epochs ?? 50,
			modelDir: config.modelDir,
		}

		const encoderOut = this.config.encoderDims[this.config.encoderDims.length - 1] ?? 32

		this.encoder = new NeuralNetwork({
			inputDim: this.config.inputDim,
			outputDim: encoderOut,
			hiddenDims: this.config.encoderDims.slice(0, -1),
			activation: "relu",
			finalActivation: "none",
			useBatchNorm: true,
			dropout: 0.2,
		})

		this.causeHead = new NeuralNetwork({
			inputDim: encoderOut,
			outputDim: 5,
			hiddenDims: [16],
			activation: "relu",
			finalActivation: "softmax",
		})

		this.complexityHead = new NeuralNetwork({
			inputDim: encoderOut,
			outputDim: 1,
			hiddenDims: [16],
			activation: "relu",
			finalActivation: "sigmoid",
		})

		this.fixSuccessHead = new NeuralNetwork({
			inputDim: encoderOut,
			outputDim: 2,
			hiddenDims: [16],
			activation: "relu",
			finalActivation: "softmax",
		})

		if (this.config.modelDir) {
			this.persistence = new ModelPersistence({ dir: this.config.modelDir, name: "debug-learner" })
		}
	}

	/** Restore weights from disk if available. */
	async restore(): Promise<boolean> {
		if (!this.persistence) return false
		const weights = await this.persistence.load()
		if (!weights) return false
		this.encoder.deserialise(weights.encoder)
		if (weights.heads.cause) this.causeHead.deserialise(weights.heads.cause)
		if (weights.heads.complexity) this.complexityHead.deserialise(weights.heads.complexity)
		if (weights.heads.fixSuccess) this.fixSuccessHead.deserialise(weights.heads.fixSuccess)
		return true
	}

	/** Persist current weights to disk. */
	async save(): Promise<void> {
		if (!this.persistence) return
		await this.persistence.save({
			version: 1,
			encoder: this.encoder.serialise(),
			heads: {
				cause: this.causeHead.serialise(),
				complexity: this.complexityHead.serialise(),
				fixSuccess: this.fixSuccessHead.serialise(),
			},
		})
	}

	/** Train on a batch of debug samples. Updates encoder end-to-end. */
	train(samples: DebugSample[]): { causeLoss: number; complexityLoss: number; fixSuccessLoss: number } {
		if (samples.length === 0) return { causeLoss: 0, complexityLoss: 0, fixSuccessLoss: 0 }

		const causeSamples = samples.filter((s) => s.causeCategory !== undefined)
		const complexitySamples = samples.filter((s) => s.fixComplexity !== undefined)
		const fixSuccessSamples = samples.filter((s) => s.fixSuccess !== undefined)

		let causeLoss = 0
		let complexityLoss = 0
		let fixSuccessLoss = 0

		if (causeSamples.length > 0) {
			const X = Tensor.from2D(causeSamples.map((s) => s.features))
			const y = Tensor.from2D(
				causeSamples.map((s) => {
					const vec = [0, 0, 0, 0, 0]
					vec[s.causeCategory!] = 1
					return vec
				}),
			)
			const losses = trainEndToEnd(
				this.encoder,
				this.causeHead,
				X,
				y,
				new CrossEntropyLoss(),
				this.config.epochs,
				this.config.batchSize,
				this.config.learningRate,
			)
			causeLoss = losses[losses.length - 1] ?? 0
		}

		if (complexitySamples.length > 0) {
			const X = Tensor.from2D(complexitySamples.map((s) => s.features))
			const y = Tensor.from2D(complexitySamples.map((s) => [s.fixComplexity!]))
			const losses = trainEndToEnd(
				this.encoder,
				this.complexityHead,
				X,
				y,
				new MSELoss(),
				this.config.epochs,
				this.config.batchSize,
				this.config.learningRate,
			)
			complexityLoss = losses[losses.length - 1] ?? 0
		}

		if (fixSuccessSamples.length > 0) {
			const X = Tensor.from2D(fixSuccessSamples.map((s) => s.features))
			const y = Tensor.from2D(fixSuccessSamples.map((s) => (s.fixSuccess === 1 ? [0, 1] : [1, 0])))
			const losses = trainEndToEnd(
				this.encoder,
				this.fixSuccessHead,
				X,
				y,
				new CrossEntropyLoss(),
				this.config.epochs,
				this.config.batchSize,
				this.config.learningRate,
			)
			fixSuccessLoss = losses[losses.length - 1] ?? 0
		}

		return { causeLoss, complexityLoss, fixSuccessLoss }
	}

	/** Compute per-head metrics on the given samples. */
	evaluate(samples: DebugSample[]): DebugLearnerMetrics {
		const causePreds: number[] = []
		const causeActual: number[] = []
		const complexityPreds: number[] = []
		const complexityActual: number[] = []
		const fixSuccessPreds: number[] = []
		const fixSuccessActual: number[] = []

		for (const s of samples) {
			const pred = this.predict(s.features)
			if (s.causeCategory !== undefined) {
				causePreds.push(pred.causeCategory)
				causeActual.push(s.causeCategory)
			}
			if (s.fixComplexity !== undefined) {
				complexityPreds.push(pred.fixComplexity)
				complexityActual.push(s.fixComplexity)
			}
			if (s.fixSuccess !== undefined) {
				fixSuccessPreds.push(pred.fixSuccessProb >= 0.5 ? 1 : 0)
				fixSuccessActual.push(s.fixSuccess)
			}
		}

		return {
			cause: causePreds.length > 0 ? computeClassificationMetrics(causePreds, causeActual) : null,
			complexity: complexityPreds.length > 0 ? computeRegressionMetrics(complexityPreds, complexityActual) : null,
			fixSuccess:
				fixSuccessPreds.length > 0 ? computeClassificationMetrics(fixSuccessPreds, fixSuccessActual) : null,
		}
	}

	predict(features: number[]): { causeCategory: number; fixComplexity: number; fixSuccessProb: number } {
		const x = Tensor.from2D([features])
		const encoded = this.encoder.predict(x)

		const causeOut = this.causeHead.predict(encoded)
		const complexityOut = this.complexityHead.predict(encoded)
		const fixSuccessOut = this.fixSuccessHead.predict(encoded)

		return {
			causeCategory: causeOut.argmax(1)[0],
			fixComplexity: complexityOut.get(0, 0),
			fixSuccessProb: fixSuccessOut.get(0, 1),
		}
	}

	static extractFeatures(meta: {
		errorType: string
		stackDepth: number
		fileCountMentioned: number
		lineCountMentioned: number
		isTypeError: boolean
		isSyntaxError: boolean
		isRuntimeError: boolean
		isAssertionError: boolean
	}): number[] {
		// One-hot encoding for error type (5 categories: type, syntax, runtime, assertion, other)
		const typeVec = [0, 0, 0, 0, 0]
		const typeIdx = meta.isTypeError
			? 0
			: meta.isSyntaxError
				? 1
				: meta.isRuntimeError
					? 2
					: meta.isAssertionError
						? 3
						: 4
		typeVec[typeIdx] = 1
		return [
			...typeVec,
			Math.min(meta.stackDepth / 20, 1),
			Math.min(meta.fileCountMentioned / 10, 1),
			Math.min(meta.lineCountMentioned / 200, 1),
		]
	}
}
