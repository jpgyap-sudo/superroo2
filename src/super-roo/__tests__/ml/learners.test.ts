import { describe, expect, it, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { CodeLearner } from "../../ml/learning/CodeLearner"
import { DebugLearner } from "../../ml/learning/DebugLearner"
import { TestLearner } from "../../ml/learning/TestLearner"

async function mkTempDir(): Promise<string> {
	return fs.mkdtemp(path.join(os.tmpdir(), "superroo-ml-"))
}

describe("CodeLearner", () => {
	it("trains and predicts", () => {
		const learner = new CodeLearner({ inputDim: 3, epochs: 30, learningRate: 0.05 })
		const samples = [
			{ features: [0.1, 0.2, 0.3], quality: 0.9, success: 1, bugRisk: 0 },
			{ features: [0.9, 0.8, 0.7], quality: 0.2, success: 0, bugRisk: 2 },
			{ features: [0.5, 0.5, 0.5], quality: 0.5, success: 1, bugRisk: 1 },
		]
		const losses = learner.train(samples)
		expect(Number.isNaN(losses.qualityLoss)).toBe(false)
		expect(Number.isNaN(losses.successLoss)).toBe(false)
		expect(Number.isNaN(losses.bugRiskLoss)).toBe(false)

		const pred = learner.predict([0.1, 0.2, 0.3])
		expect(pred.quality).toBeGreaterThanOrEqual(0)
		expect(pred.quality).toBeLessThanOrEqual(1)
		expect(pred.successProb).toBeGreaterThanOrEqual(0)
		expect(pred.successProb).toBeLessThanOrEqual(1)
		expect([0, 1, 2]).toContain(pred.bugRiskClass)
	})

	it("evaluates metrics", () => {
		const learner = new CodeLearner({ inputDim: 3, epochs: 30, learningRate: 0.05 })
		const samples = [
			{ features: [0.1, 0.2, 0.3], quality: 0.9, success: 1, bugRisk: 0 },
			{ features: [0.9, 0.8, 0.7], quality: 0.2, success: 0, bugRisk: 2 },
		]
		learner.train(samples)
		const metrics = learner.evaluate(samples)
		expect(metrics.quality).not.toBeNull()
		expect(metrics.success).not.toBeNull()
		expect(metrics.bugRisk).not.toBeNull()
	})

	it("persists and restores weights", async () => {
		const dir = await mkTempDir()
		const learner = new CodeLearner({ inputDim: 3, epochs: 10, modelDir: dir })
		const samples = [
			{ features: [0.1, 0.2, 0.3], quality: 0.9, success: 1, bugRisk: 0 },
			{ features: [0.9, 0.8, 0.7], quality: 0.2, success: 0, bugRisk: 2 },
		]
		learner.train(samples)
		const before = learner.predict([0.1, 0.2, 0.3])

		await learner.save()

		const restored = new CodeLearner({ inputDim: 3, epochs: 10, modelDir: dir })
		const ok = await restored.restore()
		expect(ok).toBe(true)

		const after = restored.predict([0.1, 0.2, 0.3])
		expect(after.quality).toBeCloseTo(before.quality, 5)
		expect(after.successProb).toBeCloseTo(before.successProb, 5)
		expect(after.bugRiskClass).toBe(before.bugRiskClass)

		await fs.rm(dir, { recursive: true, force: true })
	})
})

describe("DebugLearner", () => {
	it("trains and predicts", () => {
		const learner = new DebugLearner({ inputDim: 3, epochs: 30, learningRate: 0.05 })
		const samples = [
			{ features: [0.1, 0.2, 0.3], causeCategory: 0, fixComplexity: 0.2, fixSuccess: 1 },
			{ features: [0.9, 0.8, 0.7], causeCategory: 3, fixComplexity: 0.8, fixSuccess: 0 },
		]
		const losses = learner.train(samples)
		expect(Number.isNaN(losses.causeLoss)).toBe(false)
		expect(Number.isNaN(losses.complexityLoss)).toBe(false)
		expect(Number.isNaN(losses.fixSuccessLoss)).toBe(false)

		const pred = learner.predict([0.1, 0.2, 0.3])
		expect([0, 1, 2, 3, 4]).toContain(pred.causeCategory)
		expect(pred.fixComplexity).toBeGreaterThanOrEqual(0)
		expect(pred.fixComplexity).toBeLessThanOrEqual(1)
		expect(pred.fixSuccessProb).toBeGreaterThanOrEqual(0)
		expect(pred.fixSuccessProb).toBeLessThanOrEqual(1)
	})

	it("persists and restores weights", async () => {
		const dir = await mkTempDir()
		const learner = new DebugLearner({ inputDim: 3, epochs: 10, modelDir: dir })
		const samples = [{ features: [0.1, 0.2, 0.3], causeCategory: 0, fixComplexity: 0.2, fixSuccess: 1 }]
		learner.train(samples)
		const before = learner.predict([0.1, 0.2, 0.3])
		await learner.save()

		const restored = new DebugLearner({ inputDim: 3, epochs: 10, modelDir: dir })
		const ok = await restored.restore()
		expect(ok).toBe(true)

		const after = restored.predict([0.1, 0.2, 0.3])
		expect(after.causeCategory).toBe(before.causeCategory)
		expect(after.fixComplexity).toBeCloseTo(before.fixComplexity, 5)
		expect(after.fixSuccessProb).toBeCloseTo(before.fixSuccessProb, 5)

		await fs.rm(dir, { recursive: true, force: true })
	})
})

describe("TestLearner", () => {
	it("trains and predicts", () => {
		const learner = new TestLearner({ inputDim: 3, epochs: 30, learningRate: 0.05 })
		const samples = [
			{ features: [0.1, 0.2, 0.3], willFail: 0, execTime: 0.2, coverageGap: 0.1 },
			{ features: [0.9, 0.8, 0.7], willFail: 1, execTime: 0.9, coverageGap: 0.8 },
		]
		const losses = learner.train(samples)
		expect(Number.isNaN(losses.failLoss)).toBe(false)
		expect(Number.isNaN(losses.timeLoss)).toBe(false)
		expect(Number.isNaN(losses.coverageLoss)).toBe(false)

		const pred = learner.predict([0.1, 0.2, 0.3])
		expect(pred.failProb).toBeGreaterThanOrEqual(0)
		expect(pred.failProb).toBeLessThanOrEqual(1)
		expect(pred.execTime).toBeGreaterThanOrEqual(0)
		expect(pred.execTime).toBeLessThanOrEqual(1)
	})

	it("persists and restores weights", async () => {
		const dir = await mkTempDir()
		const learner = new TestLearner({ inputDim: 3, epochs: 10, modelDir: dir })
		const samples = [{ features: [0.1, 0.2, 0.3], willFail: 0, execTime: 0.2, coverageGap: 0.1 }]
		learner.train(samples)
		const before = learner.predict([0.1, 0.2, 0.3])
		await learner.save()

		const restored = new TestLearner({ inputDim: 3, epochs: 10, modelDir: dir })
		const ok = await restored.restore()
		expect(ok).toBe(true)

		const after = restored.predict([0.1, 0.2, 0.3])
		expect(after.failProb).toBeCloseTo(before.failProb, 5)
		expect(after.execTime).toBeCloseTo(before.execTime, 5)
		expect(after.coverageGap).toBeCloseTo(before.coverageGap, 5)

		await fs.rm(dir, { recursive: true, force: true })
	})
})
