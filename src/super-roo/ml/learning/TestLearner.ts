/**
 * Super Roo ML — TestLearner
 *
 * Learns from test execution history to predict:
 *   - Which tests are likely to fail
 *   - Optimal test ordering (fail-fast prioritisation)
 *   - Test coverage gaps
 *
 * Uses the same encoder + multi-head architecture.
 */

import { NeuralNetwork } from "../engine/NeuralNetwork"
import { MSELoss, CrossEntropyLoss } from "../engine/Loss"
import { Tensor } from "../engine/Tensor"

export interface TestSample {
	features: number[]
	/** 1 = will fail, 0 = will pass */
	willFail?: number
	/** Execution time in ms (normalised) */
	execTime?: number
	/** Coverage gap score 0-1 */
	coverageGap?: number
}

export interface TestLearnerConfig {
	inputDim: number
	encoderDims?: number[]
	learningRate?: number
	batchSize?: number
	epochs?: number
}

export class TestLearner {
	private encoder: NeuralNetwork
	private failHead: NeuralNetwork
	private timeHead: NeuralNetwork
	private coverageHead: NeuralNetwork
	private config: Required<TestLearnerConfig>

	constructor(config: TestLearnerConfig) {
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

		this.failHead = new NeuralNetwork({
			inputDim: encoderOut,
			outputDim: 2,
			hiddenDims: [16],
			activation: "relu",
			finalActivation: "softmax",
		})

		this.timeHead = new NeuralNetwork({
			inputDim: encoderOut,
			outputDim: 1,
			hiddenDims: [16],
			activation: "relu",
			finalActivation: "sigmoid",
		})

		this.coverageHead = new NeuralNetwork({
			inputDim: encoderOut,
			outputDim: 1,
			hiddenDims: [16],
			activation: "relu",
			finalActivation: "sigmoid",
		})
	}

	train(samples: TestSample[]): { failLoss: number; timeLoss: number; coverageLoss: number } {
		if (samples.length === 0) return { failLoss: 0, timeLoss: 0, coverageLoss: 0 }

		const failSamples = samples.filter((s) => s.willFail !== undefined)
		const timeSamples = samples.filter((s) => s.execTime !== undefined)
		const coverageSamples = samples.filter((s) => s.coverageGap !== undefined)

		let failLoss = 0
		let timeLoss = 0
		let coverageLoss = 0

		if (failSamples.length > 0) {
			const X = Tensor.from2D(failSamples.map((s) => s.features))
			const y = Tensor.from2D(failSamples.map((s) => (s.willFail === 1 ? [0, 1] : [1, 0])))
			const encoded = this.encoder.predict(X)
			const losses = this.failHead.train(encoded, y, new CrossEntropyLoss(), {
				epochs: this.config.epochs,
				batchSize: this.config.batchSize,
				learningRate: this.config.learningRate,
			})
			failLoss = losses[losses.length - 1] ?? 0
		}

		if (timeSamples.length > 0) {
			const X = Tensor.from2D(timeSamples.map((s) => s.features))
			const y = Tensor.from2D(timeSamples.map((s) => [s.execTime!]))
			const encoded = this.encoder.predict(X)
			const losses = this.timeHead.train(encoded, y, new MSELoss(), {
				epochs: this.config.epochs,
				batchSize: this.config.batchSize,
				learningRate: this.config.learningRate,
			})
			timeLoss = losses[losses.length - 1] ?? 0
		}

		if (coverageSamples.length > 0) {
			const X = Tensor.from2D(coverageSamples.map((s) => s.features))
			const y = Tensor.from2D(coverageSamples.map((s) => [s.coverageGap!]))
			const encoded = this.encoder.predict(X)
			const losses = this.coverageHead.train(encoded, y, new MSELoss(), {
				epochs: this.config.epochs,
				batchSize: this.config.batchSize,
				learningRate: this.config.learningRate,
			})
			coverageLoss = losses[losses.length - 1] ?? 0
		}

		return { failLoss, timeLoss, coverageLoss }
	}

	predict(features: number[]): { failProb: number; execTime: number; coverageGap: number } {
		const x = Tensor.from2D([features])
		const encoded = this.encoder.predict(x)

		const failOut = this.failHead.predict(encoded)
		const timeOut = this.timeHead.predict(encoded)
		const coverageOut = this.coverageHead.predict(encoded)

		return {
			failProb: failOut.get(0, 1),
			execTime: timeOut.get(0, 0),
			coverageGap: coverageOut.get(0, 0),
		}
	}

	static extractFeatures(meta: {
		linesOfCode: number
		cyclomaticComplexity: number
		changedLines: number
		dependencies: number
		lastRunFailed: boolean
		daysSinceLastRun: number
		flakyHistory: number
		asyncUsage: boolean
	}): number[] {
		return [
			Math.min(meta.linesOfCode / 500, 1),
			Math.min(meta.cyclomaticComplexity / 30, 1),
			Math.min(meta.changedLines / 100, 1),
			Math.min(meta.dependencies / 20, 1),
			meta.lastRunFailed ? 1 : 0,
			Math.min(meta.daysSinceLastRun / 30, 1),
			Math.min(meta.flakyHistory / 5, 1),
			meta.asyncUsage ? 1 : 0,
		]
	}
}
