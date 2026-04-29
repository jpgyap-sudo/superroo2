/**
 * Super Roo ML — DebugLearner
 *
 * Learns from historical debugging sessions to predict:
 *   - Root-cause category from error signatures
 *   - Estimated fix complexity
 *   - Likely files involved
 *
 * Uses an encoder + multi-head architecture similar to CodeLearner.
 */

import { NeuralNetwork } from "../engine/NeuralNetwork"
import { MSELoss, CrossEntropyLoss } from "../engine/Loss"
import { Tensor } from "../engine/Tensor"

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
}

export class DebugLearner {
	private encoder: NeuralNetwork
	private causeHead: NeuralNetwork
	private complexityHead: NeuralNetwork
	private fixSuccessHead: NeuralNetwork
	private config: Required<DebugLearnerConfig>

	constructor(config: DebugLearnerConfig) {
		this.config = {
			inputDim: config.inputDim,
			encoderDims: config.encoderDims ?? [64, 32],
			learningRate: config.learningRate ?? 0.001,
			batchSize: config.batchSize ?? 16,
			epochs: config.epochs ?? 50,
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
	}

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
			const encoded = this.encoder.predict(X)
			const losses = this.causeHead.train(encoded, y, new CrossEntropyLoss(), {
				epochs: this.config.epochs,
				batchSize: this.config.batchSize,
				learningRate: this.config.learningRate,
			})
			causeLoss = losses[losses.length - 1] ?? 0
		}

		if (complexitySamples.length > 0) {
			const X = Tensor.from2D(complexitySamples.map((s) => s.features))
			const y = Tensor.from2D(complexitySamples.map((s) => [s.fixComplexity!]))
			const encoded = this.encoder.predict(X)
			const losses = this.complexityHead.train(encoded, y, new MSELoss(), {
				epochs: this.config.epochs,
				batchSize: this.config.batchSize,
				learningRate: this.config.learningRate,
			})
			complexityLoss = losses[losses.length - 1] ?? 0
		}

		if (fixSuccessSamples.length > 0) {
			const X = Tensor.from2D(fixSuccessSamples.map((s) => s.features))
			const y = Tensor.from2D(fixSuccessSamples.map((s) => (s.fixSuccess === 1 ? [0, 1] : [1, 0])))
			const encoded = this.encoder.predict(X)
			const losses = this.fixSuccessHead.train(encoded, y, new CrossEntropyLoss(), {
				epochs: this.config.epochs,
				batchSize: this.config.batchSize,
				learningRate: this.config.learningRate,
			})
			fixSuccessLoss = losses[losses.length - 1] ?? 0
		}

		return { causeLoss, complexityLoss, fixSuccessLoss }
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
		// One-hot-ish encoding for error type
		const typeVec = [0, 0, 0, 0, 0, 0]
		const typeIdx =
			meta.isTypeError ? 0
			: meta.isSyntaxError ? 1
			: meta.isRuntimeError ? 2
			: meta.isAssertionError ? 3
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
