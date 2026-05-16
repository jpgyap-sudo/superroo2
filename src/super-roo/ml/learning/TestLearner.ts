/**
 * Super Roo ML — TestLearner
 *
 * Learns from test execution history to predict:
 *   - Which tests are likely to fail
 *   - Optimal test ordering (fail-fast prioritisation)
 *   - Test coverage gaps
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

export interface TestSample {
	features: number[]
	/** 1 = will fail, 0 = will pass */
	willFail?: number
	/** Execution time in ms (normalised 0-1) */
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
	/** Optional directory to persist / restore model weights. */
	modelDir?: string
}

export interface TestLearnerMetrics {
	fail: ClassificationMetrics | null
	time: RegressionMetrics | null
	coverage: RegressionMetrics | null
}

export class TestLearner {
	private encoder: NeuralNetwork
	private failHead: NeuralNetwork
	private timeHead: NeuralNetwork
	private coverageHead: NeuralNetwork
	private config: Required<
		Pick<TestLearnerConfig, "inputDim" | "encoderDims" | "learningRate" | "batchSize" | "epochs">
	> &
		Pick<TestLearnerConfig, "modelDir">
	private persistence?: ModelPersistence

	constructor(config: TestLearnerConfig) {
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

		if (this.config.modelDir) {
			this.persistence = new ModelPersistence({ dir: this.config.modelDir, name: "test-learner" })
		}
	}

	/** Restore weights from disk if available. */
	async restore(): Promise<boolean> {
		if (!this.persistence) return false
		const weights = await this.persistence.load()
		if (!weights) return false
		this.encoder.deserialise(weights.encoder)
		if (weights.heads.fail) this.failHead.deserialise(weights.heads.fail)
		if (weights.heads.time) this.timeHead.deserialise(weights.heads.time)
		if (weights.heads.coverage) this.coverageHead.deserialise(weights.heads.coverage)
		return true
	}

	/** Persist current weights to disk. */
	async save(): Promise<void> {
		if (!this.persistence) return
		await this.persistence.save({
			version: 1,
			encoder: this.encoder.serialise(),
			heads: {
				fail: this.failHead.serialise(),
				time: this.timeHead.serialise(),
				coverage: this.coverageHead.serialise(),
			},
		})
	}

	/** Train on a batch of test samples. Updates encoder end-to-end. */
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
			const losses = trainEndToEnd(
				this.encoder,
				this.failHead,
				X,
				y,
				new CrossEntropyLoss(),
				this.config.epochs,
				this.config.batchSize,
				this.config.learningRate,
			)
			failLoss = losses[losses.length - 1] ?? 0
		}

		if (timeSamples.length > 0) {
			const X = Tensor.from2D(timeSamples.map((s) => s.features))
			const y = Tensor.from2D(timeSamples.map((s) => [s.execTime!]))
			const losses = trainEndToEnd(
				this.encoder,
				this.timeHead,
				X,
				y,
				new MSELoss(),
				this.config.epochs,
				this.config.batchSize,
				this.config.learningRate,
			)
			timeLoss = losses[losses.length - 1] ?? 0
		}

		if (coverageSamples.length > 0) {
			const X = Tensor.from2D(coverageSamples.map((s) => s.features))
			const y = Tensor.from2D(coverageSamples.map((s) => [s.coverageGap!]))
			const losses = trainEndToEnd(
				this.encoder,
				this.coverageHead,
				X,
				y,
				new MSELoss(),
				this.config.epochs,
				this.config.batchSize,
				this.config.learningRate,
			)
			coverageLoss = losses[losses.length - 1] ?? 0
		}

		return { failLoss, timeLoss, coverageLoss }
	}

	/** Compute per-head metrics on the given samples. */
	evaluate(samples: TestSample[]): TestLearnerMetrics {
		const failPreds: number[] = []
		const failActual: number[] = []
		const timePreds: number[] = []
		const timeActual: number[] = []
		const coveragePreds: number[] = []
		const coverageActual: number[] = []

		for (const s of samples) {
			const pred = this.predict(s.features)
			if (s.willFail !== undefined) {
				failPreds.push(pred.failProb >= 0.5 ? 1 : 0)
				failActual.push(s.willFail)
			}
			if (s.execTime !== undefined) {
				timePreds.push(pred.execTime)
				timeActual.push(s.execTime)
			}
			if (s.coverageGap !== undefined) {
				coveragePreds.push(pred.coverageGap)
				coverageActual.push(s.coverageGap)
			}
		}

		return {
			fail: failPreds.length > 0 ? computeClassificationMetrics(failPreds, failActual) : null,
			time: timePreds.length > 0 ? computeRegressionMetrics(timePreds, timeActual) : null,
			coverage: coveragePreds.length > 0 ? computeRegressionMetrics(coveragePreds, coverageActual) : null,
		}
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
