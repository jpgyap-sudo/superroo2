/**
 * Tests for CodeLearner, DebugLearner, and TestLearner
 *
 * These learners use a multi-head encoder architecture:
 *   - Shared encoder (NeuralNetwork) + task-specific heads (NeuralNetwork)
 *   - trainEndToEnd() backpropagates through both head and encoder
 *   - predict() runs forward pass through encoder then head
 *   - evaluate() runs predict() on each sample and computes metrics
 *   - save()/restore() use ModelPersistence for serialization
 */

import { CodeLearner } from "../CodeLearner"
import { DebugLearner } from "../DebugLearner"
import { TestLearner } from "../TestLearner"
import { trainEndToEnd, getLossFn } from "../LearnerUtils"
import { Tensor } from "../../engine/Tensor"
import { NeuralNetwork } from "../../engine/NeuralNetwork"
import { MSELoss, CrossEntropyLoss } from "../../engine/Loss"

// ---------------------------------------------------------------------------
// CodeLearner
// ---------------------------------------------------------------------------

describe("CodeLearner", () => {
	const defaultConfig = { inputDim: 20, modelDir: "/tmp/.superroo-test-models" }

	describe("instantiation", () => {
		it("creates a learner with default config", () => {
			const learner = new CodeLearner(defaultConfig)
			expect(learner).toBeInstanceOf(CodeLearner)
			expect(learner["config"].inputDim).toBe(20)
			expect(learner["config"].encoderDims).toEqual([128, 64])
			expect(learner["config"].learningRate).toBe(0.001)
			expect(learner["config"].batchSize).toBe(16)
			expect(learner["config"].epochs).toBe(50)
		})

		it("accepts custom config", () => {
			const learner = new CodeLearner({
				...defaultConfig,
				inputDim: 10,
				encoderDims: [32],
				learningRate: 0.01,
				batchSize: 8,
				epochs: 5,
			})
			expect(learner["config"].inputDim).toBe(10)
			expect(learner["config"].encoderDims).toEqual([32])
			expect(learner["config"].learningRate).toBe(0.01)
			expect(learner["config"].batchSize).toBe(8)
			expect(learner["config"].epochs).toBe(5)
		})
	})

	describe("train()", () => {
		it("returns loss values after training on samples", () => {
			const learner = new CodeLearner({ ...defaultConfig, epochs: 2, batchSize: 4 })
			const samples = [
				{
					features: new Array(20).fill(0.5),
					quality: 0.8,
					success: 1,
					bugRisk: 0,
				},
				{
					features: new Array(20).fill(0.1),
					quality: 0.3,
					success: 0,
					bugRisk: 2,
				},
			]
			const result = learner.train(samples)
			expect(result).toHaveProperty("qualityLoss")
			expect(result).toHaveProperty("successLoss")
			expect(result).toHaveProperty("bugRiskLoss")
			expect(typeof result.qualityLoss).toBe("number")
			expect(typeof result.successLoss).toBe("number")
			expect(typeof result.bugRiskLoss).toBe("number")
		})

		it("handles empty samples without crashing", () => {
			const learner = new CodeLearner(defaultConfig)
			const result = learner.train([])
			expect(result.qualityLoss).toBe(0)
			expect(result.successLoss).toBe(0)
			expect(result.bugRiskLoss).toBe(0)
		})

		it("handles a single sample", () => {
			const learner = new CodeLearner({ ...defaultConfig, epochs: 1, batchSize: 1 })
			const samples = [
				{
					features: new Array(20).fill(0.5),
					quality: 0.5,
					success: 1,
					bugRisk: 1,
				},
			]
			const result = learner.train(samples)
			expect(typeof result.qualityLoss).toBe("number")
		})
	})

	describe("predict()", () => {
		it("returns predictions for valid feature vector", () => {
			const learner = new CodeLearner(defaultConfig)
			const features = new Array(20).fill(0.5)
			const pred = learner.predict(features)
			expect(pred).toHaveProperty("quality")
			expect(pred).toHaveProperty("successProb")
			expect(pred).toHaveProperty("bugRiskClass")
			expect(typeof pred.quality).toBe("number")
			expect(typeof pred.successProb).toBe("number")
			expect(typeof pred.bugRiskClass).toBe("number")
		})

		it("returns predictions for zeroed features", () => {
			const learner = new CodeLearner(defaultConfig)
			const features = new Array(20).fill(0)
			const pred = learner.predict(features)
			expect(typeof pred.quality).toBe("number")
			expect(typeof pred.successProb).toBe("number")
			expect(typeof pred.bugRiskClass).toBe("number")
		})
	})

	describe("evaluate()", () => {
		it("returns metrics for given samples", () => {
			const learner = new CodeLearner(defaultConfig)
			const samples = [
				{
					features: new Array(20).fill(0.5),
					quality: 0.8,
					success: 1,
					bugRisk: 0,
				},
			]
			const metrics = learner.evaluate(samples)
			expect(metrics).toHaveProperty("quality")
			expect(metrics).toHaveProperty("success")
			expect(metrics).toHaveProperty("bugRisk")
		})

		it("returns null metrics for empty samples", () => {
			const learner = new CodeLearner(defaultConfig)
			const metrics = learner.evaluate([])
			expect(metrics.quality).toBeNull()
			expect(metrics.success).toBeNull()
			expect(metrics.bugRisk).toBeNull()
		})
	})

	describe("extractFeatures()", () => {
		it("extracts features from code metadata", () => {
			const features = CodeLearner.extractFeatures({
				fileCount: 5,
				lineCount: 200,
				cyclomaticComplexity: 10,
				functionCount: 15,
				testCoverage: 0.7,
				lintErrors: 3,
				importsCount: 8,
				depth: 4,
			})
			expect(features).toHaveLength(8)
			expect(features.every((f) => typeof f === "number")).toBe(true)
		})

		it("handles zero values", () => {
			const features = CodeLearner.extractFeatures({
				fileCount: 0,
				lineCount: 0,
				cyclomaticComplexity: 0,
				functionCount: 0,
				testCoverage: 0,
				lintErrors: 0,
				importsCount: 0,
				depth: 0,
			})
			expect(features).toHaveLength(8)
			expect(features.every((f) => f === 0)).toBe(true)
		})
	})

	describe("save() / restore()", () => {
		it("save() does not throw", async () => {
			const learner = new CodeLearner(defaultConfig)
			await expect(learner.save()).resolves.toBeUndefined()
		})

		it("restore() returns false when no saved model exists", async () => {
			const learner = new CodeLearner({ inputDim: 20, modelDir: "/tmp/nonexistent-superroo-test" })
			const restored = await learner.restore()
			expect(restored).toBe(false)
		})
	})
})

// ---------------------------------------------------------------------------
// DebugLearner
// ---------------------------------------------------------------------------

describe("DebugLearner", () => {
	const defaultConfig = { inputDim: 20, modelDir: "/tmp/.superroo-test-models" }

	describe("instantiation", () => {
		it("creates a learner with default config", () => {
			const learner = new DebugLearner(defaultConfig)
			expect(learner).toBeInstanceOf(DebugLearner)
			expect(learner["config"].inputDim).toBe(20)
			expect(learner["config"].encoderDims).toEqual([64, 32])
		})
	})

	describe("train()", () => {
		it("returns loss values after training on samples", () => {
			const learner = new DebugLearner({ ...defaultConfig, epochs: 2, batchSize: 4 })
			const samples = [
				{
					features: new Array(20).fill(0.5),
					causeCategory: 2,
					fixComplexity: 0.6,
					fixSuccess: 1,
				},
				{
					features: new Array(20).fill(0.1),
					causeCategory: 4,
					fixComplexity: 0.9,
					fixSuccess: 0,
				},
			]
			const result = learner.train(samples)
			expect(result).toHaveProperty("causeLoss")
			expect(result).toHaveProperty("complexityLoss")
			expect(result).toHaveProperty("fixSuccessLoss")
			expect(typeof result.causeLoss).toBe("number")
			expect(typeof result.complexityLoss).toBe("number")
			expect(typeof result.fixSuccessLoss).toBe("number")
		})

		it("handles empty samples", () => {
			const learner = new DebugLearner(defaultConfig)
			const result = learner.train([])
			expect(result.causeLoss).toBe(0)
			expect(result.complexityLoss).toBe(0)
			expect(result.fixSuccessLoss).toBe(0)
		})
	})

	describe("predict()", () => {
		it("returns predictions for valid feature vector", () => {
			const learner = new DebugLearner(defaultConfig)
			const pred = learner.predict(new Array(20).fill(0.5))
			expect(pred).toHaveProperty("causeCategory")
			expect(pred).toHaveProperty("fixComplexity")
			expect(pred).toHaveProperty("fixSuccessProb")
			expect(typeof pred.causeCategory).toBe("number")
			expect(typeof pred.fixComplexity).toBe("number")
			expect(typeof pred.fixSuccessProb).toBe("number")
		})
	})

	describe("evaluate()", () => {
		it("returns metrics for given samples", () => {
			const learner = new DebugLearner(defaultConfig)
			const samples = [
				{
					features: new Array(20).fill(0.5),
					causeCategory: 2,
					fixComplexity: 0.6,
					fixSuccess: 1,
				},
			]
			const metrics = learner.evaluate(samples)
			expect(metrics).toHaveProperty("cause")
			expect(metrics).toHaveProperty("complexity")
			expect(metrics).toHaveProperty("fixSuccess")
		})
	})

	describe("extractFeatures()", () => {
		it("extracts features from debug metadata", () => {
			const features = DebugLearner.extractFeatures({
				errorType: "TypeError",
				stackDepth: 5,
				fileCountMentioned: 2,
				lineCountMentioned: 10,
				isTypeError: true,
				isSyntaxError: false,
				isRuntimeError: false,
				isAssertionError: false,
			})
			expect(features).toHaveLength(8)
			expect(features.every((f) => typeof f === "number")).toBe(true)
		})

		it("handles all error types correctly", () => {
			const syntax = DebugLearner.extractFeatures({
				errorType: "SyntaxError",
				stackDepth: 0,
				fileCountMentioned: 0,
				lineCountMentioned: 0,
				isTypeError: false,
				isSyntaxError: true,
				isRuntimeError: false,
				isAssertionError: false,
			})
			expect(syntax[1]).toBe(1) // one-hot index 1 for syntax

			const runtime = DebugLearner.extractFeatures({
				errorType: "RuntimeError",
				stackDepth: 0,
				fileCountMentioned: 0,
				lineCountMentioned: 0,
				isTypeError: false,
				isSyntaxError: false,
				isRuntimeError: true,
				isAssertionError: false,
			})
			expect(runtime[2]).toBe(1) // one-hot index 2 for runtime
		})
	})

	describe("save() / restore()", () => {
		it("save() does not throw", async () => {
			const learner = new DebugLearner(defaultConfig)
			await expect(learner.save()).resolves.toBeUndefined()
		})

		it("restore() returns false when no saved model exists", async () => {
			const learner = new DebugLearner({ inputDim: 20, modelDir: "/tmp/nonexistent-superroo-test" })
			const restored = await learner.restore()
			expect(restored).toBe(false)
		})
	})
})

// ---------------------------------------------------------------------------
// TestLearner
// ---------------------------------------------------------------------------

describe("TestLearner", () => {
	const defaultConfig = { inputDim: 20, modelDir: "/tmp/.superroo-test-models" }

	describe("instantiation", () => {
		it("creates a learner with default config", () => {
			const learner = new TestLearner(defaultConfig)
			expect(learner).toBeInstanceOf(TestLearner)
			expect(learner["config"].inputDim).toBe(20)
			expect(learner["config"].encoderDims).toEqual([64, 32])
		})
	})

	describe("train()", () => {
		it("returns loss values after training on samples", () => {
			const learner = new TestLearner({ ...defaultConfig, epochs: 2, batchSize: 4 })
			const samples = [
				{
					features: new Array(20).fill(0.5),
					willFail: 0,
					execTime: 0.3,
					coverageGap: 0.2,
				},
				{
					features: new Array(20).fill(0.9),
					willFail: 1,
					execTime: 0.8,
					coverageGap: 0.7,
				},
			]
			const result = learner.train(samples)
			expect(result).toHaveProperty("failLoss")
			expect(result).toHaveProperty("timeLoss")
			expect(result).toHaveProperty("coverageLoss")
			expect(typeof result.failLoss).toBe("number")
			expect(typeof result.timeLoss).toBe("number")
			expect(typeof result.coverageLoss).toBe("number")
		})

		it("handles empty samples", () => {
			const learner = new TestLearner(defaultConfig)
			const result = learner.train([])
			expect(result.failLoss).toBe(0)
			expect(result.timeLoss).toBe(0)
			expect(result.coverageLoss).toBe(0)
		})
	})

	describe("predict()", () => {
		it("returns predictions for valid feature vector", () => {
			const learner = new TestLearner(defaultConfig)
			const pred = learner.predict(new Array(20).fill(0.5))
			expect(pred).toHaveProperty("failProb")
			expect(pred).toHaveProperty("execTime")
			expect(pred).toHaveProperty("coverageGap")
			expect(typeof pred.failProb).toBe("number")
			expect(typeof pred.execTime).toBe("number")
			expect(typeof pred.coverageGap).toBe("number")
		})
	})

	describe("evaluate()", () => {
		it("returns metrics for given samples", () => {
			const learner = new TestLearner(defaultConfig)
			const samples = [
				{
					features: new Array(20).fill(0.5),
					willFail: 0,
					execTime: 0.3,
					coverageGap: 0.2,
				},
			]
			const metrics = learner.evaluate(samples)
			expect(metrics).toHaveProperty("fail")
			expect(metrics).toHaveProperty("time")
			expect(metrics).toHaveProperty("coverage")
		})
	})

	describe("extractFeatures()", () => {
		it("extracts features from test metadata", () => {
			const features = TestLearner.extractFeatures({
				linesOfCode: 50,
				cyclomaticComplexity: 5,
				changedLines: 10,
				dependencies: 3,
				lastRunFailed: false,
				daysSinceLastRun: 2,
				flakyHistory: 0,
				asyncUsage: true,
			})
			expect(features).toHaveLength(8)
			expect(features.every((f) => typeof f === "number")).toBe(true)
		})

		it("handles boolean flags correctly", () => {
			const failed = TestLearner.extractFeatures({
				linesOfCode: 0,
				cyclomaticComplexity: 0,
				changedLines: 0,
				dependencies: 0,
				lastRunFailed: true,
				daysSinceLastRun: 0,
				flakyHistory: 0,
				asyncUsage: true,
			})
			expect(failed[4]).toBe(1) // lastRunFailed
			expect(failed[7]).toBe(1) // asyncUsage
		})
	})

	describe("save() / restore()", () => {
		it("save() does not throw", async () => {
			const learner = new TestLearner(defaultConfig)
			await expect(learner.save()).resolves.toBeUndefined()
		})

		it("restore() returns false when no saved model exists", async () => {
			const learner = new TestLearner({ inputDim: 20, modelDir: "/tmp/nonexistent-superroo-test" })
			const restored = await learner.restore()
			expect(restored).toBe(false)
		})
	})
})

// ---------------------------------------------------------------------------
// LearnerUtils
// ---------------------------------------------------------------------------

describe("LearnerUtils", () => {
	describe("getLossFn()", () => {
		it("returns MSELoss for 'mse'", () => {
			const fn = getLossFn("mse")
			expect(fn).toBeInstanceOf(MSELoss)
		})

		it("returns CrossEntropyLoss for 'crossentropy'", () => {
			const fn = getLossFn("crossentropy")
			expect(fn).toBeInstanceOf(CrossEntropyLoss)
		})

		it("returns undefined for unknown loss type", () => {
			expect(getLossFn("unknown" as any)).toBeUndefined()
		})
	})

	describe("trainEndToEnd()", () => {
		it("trains encoder and head together and returns loss", () => {
			const encoder = new NeuralNetwork({ inputDim: 4, outputDim: 8, hiddenDims: [6] })
			const head = new NeuralNetwork({ inputDim: 8, outputDim: 1, hiddenDims: [], finalActivation: "sigmoid" })
			const X = Tensor.from2D([
				[0, 0, 1, 1],
				[1, 1, 0, 0],
			])
			const y = Tensor.from2D([[1], [0]])
			const lossFn = new MSELoss()
			const losses = trainEndToEnd(encoder, head, X, y, lossFn, 3, 2, 0.01)
			expect(Array.isArray(losses)).toBe(true)
			expect(losses.length).toBe(3)
			losses.forEach((l: number) => {
				expect(typeof l).toBe("number")
				expect(l).toBeGreaterThan(0)
			})
		})

		it("works with cross-entropy loss", () => {
			const encoder = new NeuralNetwork({ inputDim: 4, outputDim: 8, hiddenDims: [6] })
			const head = new NeuralNetwork({
				inputDim: 8,
				outputDim: 2,
				hiddenDims: [],
				finalActivation: "softmax",
			})
			const X = Tensor.from2D([
				[0, 0, 1, 1],
				[1, 1, 0, 0],
			])
			const y = Tensor.from2D([
				[1, 0],
				[0, 1],
			])
			const lossFn = new CrossEntropyLoss()
			const losses = trainEndToEnd(encoder, head, X, y, lossFn, 3, 2, 0.01)
			expect(Array.isArray(losses)).toBe(true)
			expect(losses.length).toBe(3)
		})
	})
})
