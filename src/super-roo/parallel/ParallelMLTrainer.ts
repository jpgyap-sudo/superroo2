/**
 * Super Roo — Parallel ML Trainer.
 *
 * Trains multiple learners concurrently instead of sequentially.
 * The InfiniteImprovementLoop currently trains CodeLearner, DebugLearner,
 * and TestLearner one after another. This module parallelizes that process,
 * reducing training latency by up to 3x.
 *
 * Each learner trains in its own Promise, and results are collected
 * once all complete. Error handling is per-learner so one failure
 * doesn't block the others.
 */

import type { EventLog } from "../logging/EventLog"
import type { CodeLearner } from "../ml/learning/CodeLearner"
import type { DebugLearner } from "../ml/learning/DebugLearner"
import type { TestLearner } from "../ml/learning/TestLearner"
import type { CodeSample, DebugSample, TestSample } from "../ml/learning"

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export interface ParallelMLConfig {
	/** Whether to enable parallel training. Default: true */
	enabled: boolean
	/** Timeout per learner in ms. Default: 60000 (1min) */
	learnerTimeoutMs: number
}

export interface MLTrainerStats {
	parallelTrainingCount: number
	totalTrainingTimeMs: number
	averageTrainingTimeMs: number
	lastBatchResults: TrainingBatchResult | null
}

export interface TrainingBatchResult {
	codeLoss: { qualityLoss: number; successLoss: number; bugRiskLoss: number } | null
	debugLoss: { causeLoss: number; complexityLoss: number; fixSuccessLoss: number } | null
	testLoss: { failLoss: number; timeLoss: number; coverageLoss: number } | null
	codeMetrics: object | null
	debugMetrics: object | null
	testMetrics: object | null
	codeError?: string
	debugError?: string
	testError?: string
	durationMs: number
}

// ──────────────────────────────────────────────────────────────────────────────
// ParallelMLTrainer
// ──────────────────────────────────────────────────────────────────────────────

export class ParallelMLTrainer {
	private stats: MLTrainerStats = {
		parallelTrainingCount: 0,
		totalTrainingTimeMs: 0,
		averageTrainingTimeMs: 0,
		lastBatchResults: null,
	}

	constructor(
		private readonly events: EventLog,
		private readonly config: ParallelMLConfig = {
			enabled: true,
			learnerTimeoutMs: 60_000,
		},
	) {}

	// ── Public API ────────────────────────────────────────────────────────

	/**
	 * Train all three learners in parallel.
	 * Returns a combined result with per-learner outcomes.
	 */
	async trainAll(
		codeLearner: CodeLearner,
		debugLearner: DebugLearner,
		testLearner: TestLearner,
		codeSamples: CodeSample[],
		debugSamples: DebugSample[],
		testSamples: TestSample[],
	): Promise<TrainingBatchResult> {
		const startTime = Date.now()

		if (
			!this.config.enabled ||
			(codeSamples.length === 0 && debugSamples.length === 0 && testSamples.length === 0)
		) {
			return {
				codeLoss: null,
				debugLoss: null,
				testLoss: null,
				codeMetrics: null,
				debugMetrics: null,
				testMetrics: null,
				durationMs: 0,
			}
		}

		this.events.info(
			"ml.parallel.training_start",
			`Starting parallel training (code=${codeSamples.length}, debug=${debugSamples.length}, test=${testSamples.length})`,
		)

		// Create timeout-aware training promises
		const codePromise = this.trainWithTimeout(
			"CodeLearner",
			async () => {
				const loss = await codeLearner.train(codeSamples)
				const metrics = codeLearner.evaluate(codeSamples)
				return { loss, metrics }
			},
			codeSamples,
		)

		const debugPromise = this.trainWithTimeout(
			"DebugLearner",
			async () => {
				const loss = await debugLearner.train(debugSamples)
				const metrics = debugLearner.evaluate(debugSamples)
				return { loss, metrics }
			},
			debugSamples,
		)

		const testPromise = this.trainWithTimeout(
			"TestLearner",
			async () => {
				const loss = await testLearner.train(testSamples)
				const metrics = testLearner.evaluate(testSamples)
				return { loss, metrics }
			},
			testSamples,
		)

		// Run all three in parallel
		const [codeResult, debugResult, testResult] = await Promise.allSettled([codePromise, debugPromise, testPromise])

		const durationMs = Math.max(1, Date.now() - startTime)

		// Collect results
		const result: TrainingBatchResult = {
			codeLoss: null,
			debugLoss: null,
			testLoss: null,
			codeMetrics: null,
			debugMetrics: null,
			testMetrics: null,
			durationMs,
		}

		if (codeResult.status === "fulfilled" && codeResult.value) {
			result.codeLoss = codeResult.value.loss
			result.codeMetrics = codeResult.value.metrics
		} else if (codeResult.status === "rejected") {
			result.codeError =
				codeResult.reason instanceof Error ? codeResult.reason.message : String(codeResult.reason)
		}

		if (debugResult.status === "fulfilled" && debugResult.value) {
			result.debugLoss = debugResult.value.loss
			result.debugMetrics = debugResult.value.metrics
		} else if (debugResult.status === "rejected") {
			result.debugError =
				debugResult.reason instanceof Error ? debugResult.reason.message : String(debugResult.reason)
		}

		if (testResult.status === "fulfilled" && testResult.value) {
			result.testLoss = testResult.value.loss
			result.testMetrics = testResult.value.metrics
		} else if (testResult.status === "rejected") {
			result.testError =
				testResult.reason instanceof Error ? testResult.reason.message : String(testResult.reason)
		}

		// Update stats
		this.stats.parallelTrainingCount++
		this.stats.totalTrainingTimeMs += durationMs
		this.stats.averageTrainingTimeMs = this.stats.totalTrainingTimeMs / this.stats.parallelTrainingCount
		this.stats.lastBatchResults = result

		this.events.info("ml.parallel.training_done", `Parallel training completed in ${durationMs}ms`, {
			data: {
				durationMs,
				codeError: result.codeError,
				debugError: result.debugError,
				testError: result.testError,
			} as unknown as Record<string, unknown>,
		})

		return result
	}

	/**
	 * Get trainer statistics.
	 */
	getStats(): MLTrainerStats {
		return { ...this.stats }
	}

	/**
	 * Reset statistics.
	 */
	resetStats(): void {
		this.stats = {
			parallelTrainingCount: 0,
			totalTrainingTimeMs: 0,
			averageTrainingTimeMs: 0,
			lastBatchResults: null,
		}
	}

	// ── Internal ──────────────────────────────────────────────────────────

	/**
	 * Run a training function with timeout protection.
	 * Returns null if there are no samples or if the timeout is exceeded.
	 */
	private trainWithTimeout<T>(name: string, trainFn: () => Promise<T>, samples: unknown[]): Promise<T | null> {
		if (samples.length === 0) return Promise.resolve(null)

		return new Promise<T | null>((resolve, reject) => {
			let settled = false
			const timer = setTimeout(() => {
				if (settled) return
				settled = true
				const err = new Error(`${name} training timed out after ${this.config.learnerTimeoutMs}ms`)
				this.events.error("ml.parallel.learner_error", `${name} failed: ${err.message}`)
				reject(err)
			}, this.config.learnerTimeoutMs)

			trainFn()
				.then((result) => {
					if (settled) return
					settled = true
					clearTimeout(timer)
					resolve(result)
				})
				.catch((err) => {
					if (settled) return
					settled = true
					clearTimeout(timer)
					const msg = err instanceof Error ? err.message : String(err)
					this.events.error("ml.parallel.learner_error", `${name} failed: ${msg}`)
					reject(err)
				})
		})
	}
}
