import { describe, expect, it } from "vitest"
import {
	computeClassificationMetrics,
	computeMultiClassConfusionMatrix,
	computeRegressionMetrics,
	computeConfusionMatrix,
	ActionOutcomeTracker,
} from "../../ml/engine/Metrics"

describe("computeConfusionMatrix", () => {
	it("counts TP/FP/TN/FN correctly", () => {
		const predicted = [1, 0, 1, 0, 1, 1]
		const actual = [1, 0, 0, 0, 1, 1]
		const cm = computeConfusionMatrix(predicted, actual)
		expect(cm.truePositives).toBe(3)
		expect(cm.falsePositives).toBe(1)
		expect(cm.trueNegatives).toBe(2)
		expect(cm.falseNegatives).toBe(0)
	})
})

describe("computeClassificationMetrics", () => {
	it("returns perfect scores when all correct", () => {
		const pred = [1, 0, 1, 0]
		const actual = [1, 0, 1, 0]
		const m = computeClassificationMetrics(pred, actual)
		expect(m.accuracy).toBe(1)
		expect(m.precision).toBe(1)
		expect(m.recall).toBe(1)
		expect(m.f1).toBe(1)
	})

	it("returns zero precision when no positives predicted", () => {
		const pred = [0, 0, 0]
		const actual = [1, 1, 1]
		const m = computeClassificationMetrics(pred, actual)
		expect(m.precision).toBe(0)
		expect(m.recall).toBe(0)
	})

	it("handles empty arrays", () => {
		const m = computeClassificationMetrics([], [])
		expect(m.accuracy).toBeNaN()
	})
})

describe("computeMultiClassConfusionMatrix", () => {
	it("builds a 3x3 matrix", () => {
		const pred = [0, 1, 2, 1, 0]
		const actual = [0, 1, 2, 2, 0]
		const matrix = computeMultiClassConfusionMatrix(pred, actual, 3)
		expect(matrix[0][0]).toBe(2) // two 0s correct
		expect(matrix[1][1]).toBe(1) // one 1 correct
		expect(matrix[2][2]).toBe(1) // one 2 correct
		expect(matrix[2][1]).toBe(1) // one 2 predicted as 1
	})
})

describe("computeRegressionMetrics", () => {
	it("computes MAE, RMSE, R2 for perfect prediction", () => {
		const actual = [1, 2, 3, 4]
		const pred = [1, 2, 3, 4]
		const m = computeRegressionMetrics(pred, actual)
		expect(m.mae).toBe(0)
		expect(m.rmse).toBe(0)
		expect(m.r2).toBe(1)
	})

	it("computes sensible values for imperfect prediction", () => {
		const actual = [1, 2, 3, 4]
		const pred = [1.5, 2.5, 2.5, 4.5]
		const m = computeRegressionMetrics(pred, actual)
		expect(m.mae).toBeGreaterThan(0)
		expect(m.rmse).toBeGreaterThan(0)
		expect(m.r2).toBeLessThan(1)
	})

	it("returns NaN for mismatched lengths", () => {
		const m = computeRegressionMetrics([1], [1, 2])
		expect(m.mae).toBeNaN()
	})
})

describe("ActionOutcomeTracker", () => {
	it("computes helpRate", () => {
		const tracker = new ActionOutcomeTracker()
		tracker.record("a", "debugger", 0.9, 0.2, 0.8)
		tracker.record("b", "tester", 0.9, 0.5, 0.4)
		expect(tracker.helpRate()).toBe(0.5)
	})

	it("computes avgDelta", () => {
		const tracker = new ActionOutcomeTracker()
		tracker.record("a", "debugger", 0.9, 0.2, 0.8)
		tracker.record("b", "tester", 0.9, 0.5, 0.4)
		expect(tracker.avgDelta()).toBeCloseTo(0.25, 5)
	})

	it("filters by windowMs", async () => {
		const tracker = new ActionOutcomeTracker()
		tracker.record("a", "debugger", 0.9, 0.2, 0.8)
		await new Promise((r) => setTimeout(r, 2))
		expect(tracker.helpRate(1)).toBe(0) // window of 1 ms excludes everything after sleep
	})

	it("computes helpPrecision for high-confidence predictions", () => {
		const tracker = new ActionOutcomeTracker()
		tracker.record("a", "debugger", 0.9, 0.2, 0.8)
		tracker.record("b", "debugger", 0.6, 0.2, 0.8)
		expect(tracker.helpPrecision(0.8)).toBe(1)
		expect(tracker.helpPrecision(0.5)).toBe(1)
	})
})
