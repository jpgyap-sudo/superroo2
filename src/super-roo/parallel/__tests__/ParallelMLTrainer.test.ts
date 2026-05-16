/**
 * Tests for ParallelMLTrainer — concurrent learner training with timeout protection.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

import { ParallelMLTrainer } from "../ParallelMLTrainer"
import type { CodeLearner } from "../../ml/learning/CodeLearner"
import type { DebugLearner } from "../../ml/learning/DebugLearner"
import type { TestLearner } from "../../ml/learning/TestLearner"
import type { CodeSample, DebugSample, TestSample } from "../../ml/learning"
import type { EventLog } from "../../logging/EventLog"

// ── Fake dependencies ────────────────────────────────────────────────────────

function fakeEventLog(): EventLog {
	return {
		emit: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		subscribe: vi.fn(),
		unsubscribe: vi.fn(),
		recent: vi.fn().mockReturnValue([]),
	} as unknown as EventLog
}

function makeCodeLearner(): CodeLearner {
	return {
		train: vi.fn().mockReturnValue({ qualityLoss: 0.1, successLoss: 0.2, bugRiskLoss: 0.05 }),
		evaluate: vi.fn().mockReturnValue({
			quality: { mse: 0.01, mae: 0.08, r2: 0.9 },
			success: { accuracy: 0.85, precision: 0.8, recall: 0.9, f1: 0.85 },
			bugRisk: { accuracy: 0.75, precision: 0.7, recall: 0.8, f1: 0.75 },
		}),
	} as unknown as CodeLearner
}

function makeDebugLearner(): DebugLearner {
	return {
		train: vi.fn().mockReturnValue({ causeLoss: 0.3, complexityLoss: 0.15, fixSuccessLoss: 0.1 }),
		evaluate: vi.fn().mockReturnValue({
			cause: { accuracy: 0.8, precision: 0.75, recall: 0.85, f1: 0.8 },
			complexity: { mse: 0.02, mae: 0.1, r2: 0.85 },
			fixSuccess: { accuracy: 0.9, precision: 0.88, recall: 0.92, f1: 0.9 },
		}),
	} as unknown as DebugLearner
}

function makeTestLearner(): TestLearner {
	return {
		train: vi.fn().mockReturnValue({ failLoss: 0.2, timeLoss: 0.05, coverageLoss: 0.01 }),
		evaluate: vi.fn().mockReturnValue({
			fail: { accuracy: 0.95, precision: 0.93, recall: 0.97, f1: 0.95 },
			time: { mse: 0.005, mae: 0.05, r2: 0.95 },
			coverage: { mse: 0.001, mae: 0.02, r2: 0.98 },
		}),
	} as unknown as TestLearner
}

function makeCodeSamples(count = 3): CodeSample[] {
	return Array.from({ length: count }, (_, i) => ({
		features: [0.1 * i, 0.2 * i, 0.3 * i, 0.4 * i, 0.5 * i, 0.6 * i, 0.7 * i, 0.8 * i],
		quality: 0.5 + i * 0.1,
		success: i % 2 === 0 ? 1 : 0,
		bugRisk: i % 3,
	}))
}

function makeDebugSamples(count = 3): DebugSample[] {
	return Array.from({ length: count }, (_, i) => ({
		features: [0.1 * i, 0.2 * i, 0.3 * i, 0.4 * i, 0.5 * i, 0.6 * i, 0.7 * i, 0.8 * i],
		rootCause: i % 4,
		complexity: 0.3 + i * 0.1,
		fixSuccess: i % 2 === 0 ? 1 : 0,
	}))
}

function makeTestSamples(count = 3): TestSample[] {
	return Array.from({ length: count }, (_, i) => ({
		features: [0.1 * i, 0.2 * i, 0.3 * i, 0.4 * i, 0.5 * i, 0.6 * i, 0.7 * i, 0.8 * i],
		willFail: i % 2 === 0 ? 1 : 0,
		executionTime: 100 + i * 50,
		coverage: 0.7 + i * 0.05,
	}))
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("ParallelMLTrainer", () => {
	let trainer: ParallelMLTrainer
	let events: EventLog

	beforeEach(() => {
		events = fakeEventLog()
		trainer = new ParallelMLTrainer(events, {
			enabled: true,
			learnerTimeoutMs: 10_000,
		})
	})

	describe("trainAll", () => {
		it("trains all three learners in parallel and returns combined results", async () => {
			const codeLearner = makeCodeLearner()
			const debugLearner = makeDebugLearner()
			const testLearner = makeTestLearner()

			const result = await trainer.trainAll(
				codeLearner,
				debugLearner,
				testLearner,
				makeCodeSamples(),
				makeDebugSamples(),
				makeTestSamples(),
			)

			expect(result.codeLoss).toEqual({ qualityLoss: 0.1, successLoss: 0.2, bugRiskLoss: 0.05 })
			expect(result.debugLoss).toEqual({ causeLoss: 0.3, complexityLoss: 0.15, fixSuccessLoss: 0.1 })
			expect(result.testLoss).toEqual({ failLoss: 0.2, timeLoss: 0.05, coverageLoss: 0.01 })

			expect(result.codeMetrics).not.toBeNull()
			expect(result.debugMetrics).not.toBeNull()
			expect(result.testMetrics).not.toBeNull()

			expect(result.durationMs).toBeGreaterThanOrEqual(0)
			expect(result.codeError).toBeUndefined()
			expect(result.debugError).toBeUndefined()
			expect(result.testError).toBeUndefined()
		})

		it("returns null losses when disabled", async () => {
			const disabledTrainer = new ParallelMLTrainer(events, { enabled: false, learnerTimeoutMs: 10_000 })

			const result = await disabledTrainer.trainAll(
				makeCodeLearner(),
				makeDebugLearner(),
				makeTestLearner(),
				makeCodeSamples(),
				makeDebugSamples(),
				makeTestSamples(),
			)

			expect(result.codeLoss).toBeNull()
			expect(result.debugLoss).toBeNull()
			expect(result.testLoss).toBeNull()
			expect(result.durationMs).toBe(0)
		})

		it("returns null losses when all sample arrays are empty", async () => {
			const result = await trainer.trainAll(makeCodeLearner(), makeDebugLearner(), makeTestLearner(), [], [], [])

			expect(result.codeLoss).toBeNull()
			expect(result.debugLoss).toBeNull()
			expect(result.testLoss).toBeNull()
			expect(result.durationMs).toBe(0)
		})

		it("handles partial sample arrays (only code samples)", async () => {
			const codeLearner = makeCodeLearner()

			const result = await trainer.trainAll(
				codeLearner,
				makeDebugLearner(),
				makeTestLearner(),
				makeCodeSamples(2),
				[],
				[],
			)

			expect(result.codeLoss).not.toBeNull()
			expect(result.debugLoss).toBeNull()
			expect(result.testLoss).toBeNull()
		})

		it("captures per-learner errors without blocking others", async () => {
			const failingCodeLearner = {
				train: vi.fn().mockImplementation(() => {
					throw new Error("CodeLearner OOM")
				}),
				evaluate: vi.fn(),
			} as unknown as CodeLearner

			const debugLearner = makeDebugLearner()
			const testLearner = makeTestLearner()

			const result = await trainer.trainAll(
				failingCodeLearner,
				debugLearner,
				testLearner,
				makeCodeSamples(2),
				makeDebugSamples(2),
				makeTestSamples(2),
			)

			// Code learner failed
			expect(result.codeError).toBe("CodeLearner OOM")
			expect(result.codeLoss).toBeNull()

			// Debug and test learners still succeeded
			expect(result.debugLoss).not.toBeNull()
			expect(result.testLoss).not.toBeNull()
		})

		it("trains learners concurrently (not sequentially)", async () => {
			// Create learners with artificial delays
			const slowCodeLearner = {
				train: vi
					.fn()
					.mockImplementation(
						() =>
							new Promise((resolve) =>
								setTimeout(
									() => resolve({ qualityLoss: 0.1, successLoss: 0.2, bugRiskLoss: 0.05 }),
									200,
								),
							),
					),
				evaluate: vi.fn().mockResolvedValue({}),
			} as unknown as CodeLearner

			const slowDebugLearner = {
				train: vi
					.fn()
					.mockImplementation(
						() =>
							new Promise((resolve) =>
								setTimeout(
									() => resolve({ causeLoss: 0.3, complexityLoss: 0.15, fixSuccessLoss: 0.1 }),
									200,
								),
							),
					),
				evaluate: vi.fn().mockResolvedValue({}),
			} as unknown as DebugLearner

			const slowTestLearner = {
				train: vi
					.fn()
					.mockImplementation(
						() =>
							new Promise((resolve) =>
								setTimeout(() => resolve({ failLoss: 0.2, timeLoss: 0.05, coverageLoss: 0.01 }), 200),
							),
					),
				evaluate: vi.fn().mockResolvedValue({}),
			} as unknown as TestLearner

			const start = Date.now()
			await trainer.trainAll(
				slowCodeLearner,
				slowDebugLearner,
				slowTestLearner,
				makeCodeSamples(2),
				makeDebugSamples(2),
				makeTestSamples(2),
			)
			const elapsed = Date.now() - start

			// If sequential: ~600ms. If parallel: ~200ms
			expect(elapsed).toBeLessThan(400)
		})

		it("times out a learner that takes too long", async () => {
			const timeoutTrainer = new ParallelMLTrainer(events, {
				enabled: true,
				learnerTimeoutMs: 50, // very short timeout
			})

			const slowLearner = {
				train: vi
					.fn()
					.mockImplementation(
						() =>
							new Promise((resolve) =>
								setTimeout(
									() => resolve({ qualityLoss: 0.1, successLoss: 0.2, bugRiskLoss: 0.05 }),
									500,
								),
							),
					),
				evaluate: vi.fn().mockResolvedValue({}),
			} as unknown as CodeLearner

			const result = await timeoutTrainer.trainAll(
				slowLearner,
				makeDebugLearner(),
				makeTestLearner(),
				makeCodeSamples(2),
				makeDebugSamples(2),
				makeTestSamples(2),
			)

			// The slow learner should have timed out
			expect(result.codeError).toBeTruthy()
			expect(result.codeError).toContain("timed out")
		})
	})

	describe("getStats", () => {
		it("returns initial stats", () => {
			const stats = trainer.getStats()
			expect(stats.parallelTrainingCount).toBe(0)
			expect(stats.totalTrainingTimeMs).toBe(0)
			expect(stats.averageTrainingTimeMs).toBe(0)
			expect(stats.lastBatchResults).toBeNull()
		})

		it("updates stats after training", async () => {
			await trainer.trainAll(
				makeCodeLearner(),
				makeDebugLearner(),
				makeTestLearner(),
				makeCodeSamples(2),
				makeDebugSamples(2),
				makeTestSamples(2),
			)

			const stats = trainer.getStats()
			expect(stats.parallelTrainingCount).toBe(1)
			expect(stats.totalTrainingTimeMs).toBeGreaterThan(0)
			expect(stats.averageTrainingTimeMs).toBeGreaterThan(0)
			expect(stats.lastBatchResults).not.toBeNull()
			expect(stats.lastBatchResults!.codeLoss).not.toBeNull()
		})
	})

	describe("resetStats", () => {
		it("resets all statistics", async () => {
			await trainer.trainAll(
				makeCodeLearner(),
				makeDebugLearner(),
				makeTestLearner(),
				makeCodeSamples(2),
				makeDebugSamples(2),
				makeTestSamples(2),
			)

			trainer.resetStats()

			const stats = trainer.getStats()
			expect(stats.parallelTrainingCount).toBe(0)
			expect(stats.totalTrainingTimeMs).toBe(0)
			expect(stats.averageTrainingTimeMs).toBe(0)
			expect(stats.lastBatchResults).toBeNull()
		})
	})
})
