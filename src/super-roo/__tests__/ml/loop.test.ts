import { describe, expect, it, beforeEach, afterEach, vi } from "vitest"
import { InfiniteImprovementLoop, type LoopConfig } from "../../ml/loop/InfiniteImprovementLoop"
import { SuperRooOrchestrator } from "../../orchestrator/SuperRooOrchestrator"
import { SafetyMode, type Task } from "../../types"

// ── Helpers ──────────────────────────────────────────────────────────────────

function createMockTask(overrides: Partial<Task> = {}): Task {
	return {
		id: `task-${Math.random().toString(36).slice(2, 8)}`,
		agent: "coder",
		goal: "test goal",
		status: "pending",
		priority: "normal",
		requiredCapabilities: [],
		payload: {},
		maxIterations: 3,
		attempts: 0,
		createdAt: Date.now(),
		updatedAt: Date.now(),
		...overrides,
	}
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MockOrchestrator = ReturnType<typeof createMockOrchestrator>

function createMockOrchestrator() {
	const events = {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		recent: vi.fn().mockReturnValue([]),
	}
	const queue = {
		list: vi.fn().mockReturnValue([]),
	}
	const safety = {
		getSelfImprove: vi.fn().mockReturnValue(false),
	}
	const agents = {
		list: vi.fn().mockReturnValue([]),
	}
	const submit = vi.fn()

	return {
		events,
		queue,
		safety,
		agents,
		submit,
	}
}

// ── Integration tests (real orchestrator) ────────────────────────────────────

describe("InfiniteImprovementLoop", () => {
	let orch: SuperRooOrchestrator

	beforeEach(async () => {
		orch = new SuperRooOrchestrator({
			dbPath: ":memory:",
			initialMode: SafetyMode.AUTO,
			healingCycleIntervalMs: 100,
		})
		await orch.start()
	})

	afterEach(async () => {
		await orch.stop()
		orch.close()
	})

	it("starts and stops without error", async () => {
		const loop = orch.mlLoop
		// orchestrator.start() already started the loop
		expect(loop.getStats().iteration).toBeGreaterThanOrEqual(0)
		await loop.stop()
		expect(loop.getStats().iteration).toBeGreaterThanOrEqual(0)
	})

	it("throttles actions to maxActionsPerIteration", async () => {
		const loop = new InfiniteImprovementLoop(orch, {
			minSamples: 1,
			maxIterations: 1,
			idleSleepMs: 10,
			trainEpochs: 2,
			confidenceThreshold: 0.1,
			maxActionsPerIteration: 1,
		})
		// Seed some completed tasks so training has data
		orch.submit({ agent: "coder", goal: "g1", requiredCapabilities: [] } as never)
		await orch.processNext()
		orch.submit({ agent: "coder", goal: "g2", requiredCapabilities: [] } as never)
		await orch.processNext()
		orch.submit({ agent: "tester", goal: "g3", requiredCapabilities: [] } as never)
		await orch.processNext()

		// Now queue pending tasks so the loop has something to predict on
		orch.submit({ agent: "coder", goal: "pending1", requiredCapabilities: [] } as never)
		orch.submit({ agent: "coder", goal: "pending2", requiredCapabilities: [] } as never)

		await loop.start()
		// Let it run a few ms
		await new Promise((r) => setTimeout(r, 80))
		await loop.stop()
		const stats = loop.getStats()
		expect(stats.actionsTaken).toBeLessThanOrEqual(1)
	})

	it("validates actions before queuing", async () => {
		const loop = new InfiniteImprovementLoop(orch, {
			minSamples: 1,
			maxIterations: 1,
			idleSleepMs: 10,
			trainEpochs: 2,
			confidenceThreshold: 0.99, // very high so predictions rarely pass
			maxActionsPerIteration: 3,
		})
		orch.submit({ agent: "coder", goal: "g1", requiredCapabilities: [] } as never)
		await orch.processNext()
		orch.submit({ agent: "coder", goal: "pending1", requiredCapabilities: [] } as never)

		await loop.start()
		await new Promise((r) => setTimeout(r, 80))
		await loop.stop()
		const stats = loop.getStats()
		// With confidence 0.99, no actions should be taken
		expect(stats.actionsTaken).toBe(0)
	})
})

// ── Unit tests (mocked orchestrator) ────────────────────────────────────────

describe("InfiniteImprovementLoop — unit", () => {
	const defaultConfig: LoopConfig = {
		minSamples: 5,
		maxIterations: 1000,
		idleSleepMs: 5000,
		trainEpochs: 20,
		confidenceThreshold: 0.75,
		maxActionsPerIteration: 3,
	}

	describe("taskToFeatures", () => {
		it("should produce an 8-dim feature vector", () => {
			const mockOrch = createMockOrchestrator() as any
			const loop = new InfiniteImprovementLoop(mockOrch, defaultConfig)
			const task = createMockTask({
				goal: "short goal",
				requiredCapabilities: ["write.file"],
				priority: "high",
				attempts: 2,
				parentTaskId: "parent-1",
			})
			const features = (loop as any).taskToFeatures(task) as number[]

			expect(features).toHaveLength(8)
			// goalLen / 200 = 10/200 = 0.05
			expect(features[0]).toBeCloseTo(0.05, 2)
			// capsCount / 5 = 1/5 = 0.2
			expect(features[1]).toBeCloseTo(0.2, 2)
			// hasWrite = 1
			expect(features[2]).toBe(1)
			// hasExecute = 0
			expect(features[3]).toBe(0)
			// priority "high" = 0.75
			expect(features[4]).toBeCloseTo(0.75, 2)
			// attempts / 3 = 2/3 ≈ 0.67
			expect(features[5]).toBeCloseTo(0.67, 1)
			// isFollowup = 1
			expect(features[6]).toBe(1)
			// reserved = 0
			expect(features[7]).toBe(0)
		})

		it("should cap goal length at 1.0", () => {
			const mockOrch = createMockOrchestrator() as any
			const loop = new InfiniteImprovementLoop(mockOrch, defaultConfig)
			const longGoal = "x".repeat(500)
			const task = createMockTask({ goal: longGoal })
			const features = (loop as any).taskToFeatures(task) as number[]

			expect(features[0]).toBe(1) // capped at 1.0
		})

		it("should cap capabilities at 1.0", () => {
			const mockOrch = createMockOrchestrator() as any
			const loop = new InfiniteImprovementLoop(mockOrch, defaultConfig)
			const task = createMockTask({
				requiredCapabilities: ["a", "b", "c", "d", "e", "f", "g"],
			})
			const features = (loop as any).taskToFeatures(task) as number[]

			expect(features[1]).toBe(1) // capped at 1.0
		})

		it("should map all priority levels correctly", () => {
			const mockOrch = createMockOrchestrator() as any
			const loop = new InfiniteImprovementLoop(mockOrch, defaultConfig)

			const critical = (loop as any).taskToFeatures(createMockTask({ priority: "critical" })) as number[]
			const high = (loop as any).taskToFeatures(createMockTask({ priority: "high" })) as number[]
			const normal = (loop as any).taskToFeatures(createMockTask({ priority: "normal" })) as number[]
			const low = (loop as any).taskToFeatures(createMockTask({ priority: "low" })) as number[]

			expect(critical[4]).toBe(1)
			expect(high[4]).toBeCloseTo(0.75, 2)
			expect(normal[4]).toBeCloseTo(0.5, 2)
			expect(low[4]).toBeCloseTo(0.25, 2)
		})

		it("should detect write.file and execute.command capabilities", () => {
			const mockOrch = createMockOrchestrator() as any
			const loop = new InfiniteImprovementLoop(mockOrch, defaultConfig)

			const both = (loop as any).taskToFeatures(
				createMockTask({ requiredCapabilities: ["write.file", "execute.command"] }),
			) as number[]
			const none = (loop as any).taskToFeatures(
				createMockTask({ requiredCapabilities: ["read.file"] }),
			) as number[]

			expect(both[2]).toBe(1) // hasWrite
			expect(both[3]).toBe(1) // hasExecute
			expect(none[2]).toBe(0)
			expect(none[3]).toBe(0)
		})
	})

	describe("extractCodeSamples", () => {
		it("should filter only coder tasks with non-pending status", () => {
			const mockOrch = createMockOrchestrator() as any
			const loop = new InfiniteImprovementLoop(mockOrch, defaultConfig)

			const tasks = [
				createMockTask({ agent: "coder", status: "succeeded" }),
				createMockTask({ agent: "coder", status: "pending" }), // filtered out
				createMockTask({ agent: "debugger", status: "succeeded" }), // filtered out
				createMockTask({ agent: "tester", status: "failed" }), // filtered out
			]
			const samples = (loop as any).extractCodeSamples(tasks) as Array<{
				features: number[]
				quality: number
				success: number
				bugRisk: number
			}>

			expect(samples).toHaveLength(1)
			expect(samples[0].success).toBe(1) // succeeded
		})

		it("should degrade quality with retries", () => {
			const mockOrch = createMockOrchestrator() as any
			const loop = new InfiniteImprovementLoop(mockOrch, defaultConfig)

			const tasks = [
				createMockTask({ agent: "coder", status: "succeeded", attempts: 1 }),
				createMockTask({ agent: "coder", status: "succeeded", attempts: 5 }),
			]
			const samples = (loop as any).extractCodeSamples(tasks) as Array<{ quality: number }>

			expect(samples).toHaveLength(2)
			expect(samples[0].quality).toBeGreaterThan(samples[1].quality)
			// 5 attempts: 0.9 - (4 * 0.15) = 0.9 - 0.6 = 0.3
			expect(samples[1].quality).toBeCloseTo(0.3, 1)
		})

		it("should set bugRisk to 2 for failed tasks with many retries", () => {
			const mockOrch = createMockOrchestrator() as any
			const loop = new InfiniteImprovementLoop(mockOrch, defaultConfig)

			const tasks = [
				createMockTask({ agent: "coder", status: "failed", attempts: 3 }),
				createMockTask({ agent: "coder", status: "succeeded", attempts: 1 }),
			]
			const samples = (loop as any).extractCodeSamples(tasks) as Array<{ bugRisk: number }>

			expect(samples).toHaveLength(2)
			expect(samples[0].bugRisk).toBe(2) // failed + attempts > 2
			expect(samples[1].bugRisk).toBe(0) // succeeded
		})
	})

	describe("extractDebugSamples", () => {
		it("should classify cause category from error text", () => {
			const mockOrch = createMockOrchestrator() as any
			const loop = new InfiniteImprovementLoop(mockOrch, defaultConfig)

			const tasks = [
				createMockTask({ agent: "debugger", status: "failed", error: "SyntaxError: unexpected token" }),
				createMockTask({ agent: "debugger", status: "failed", error: "TypeError: cannot read" }),
				createMockTask({ agent: "debugger", status: "failed", error: "AssertionError: expected 5" }),
				createMockTask({ agent: "debugger", status: "failed", error: "ENV variable missing" }),
				createMockTask({ agent: "debugger", status: "failed", error: "random runtime error" }),
			]
			const samples = (loop as any).extractDebugSamples(tasks) as Array<{ causeCategory: number }>

			expect(samples).toHaveLength(5)
			expect(samples[0].causeCategory).toBe(0) // syntax/parse
			expect(samples[1].causeCategory).toBe(2) // type/typescript
			expect(samples[2].causeCategory).toBe(4) // assert/expect
			expect(samples[3].causeCategory).toBe(4) // env/config
			expect(samples[4].causeCategory).toBe(3) // runtime default
		})

		it("should increase fix complexity with retries", () => {
			const mockOrch = createMockOrchestrator() as any
			const loop = new InfiniteImprovementLoop(mockOrch, defaultConfig)

			const tasks = [
				createMockTask({ agent: "debugger", status: "succeeded", attempts: 1 }),
				createMockTask({ agent: "debugger", status: "failed", attempts: 4 }),
			]
			const samples = (loop as any).extractDebugSamples(tasks) as Array<{ fixComplexity: number }>

			expect(samples).toHaveLength(2)
			expect(samples[0].fixComplexity).toBeLessThan(samples[1].fixComplexity)
		})
	})

	describe("extractTestSamples", () => {
		it("should set willFail based on status", () => {
			const mockOrch = createMockOrchestrator() as any
			const loop = new InfiniteImprovementLoop(mockOrch, defaultConfig)

			const tasks = [
				createMockTask({ agent: "tester", status: "succeeded" }),
				createMockTask({ agent: "tester", status: "failed" }),
			]
			const samples = (loop as any).extractTestSamples(tasks) as Array<{ willFail: number }>

			expect(samples).toHaveLength(2)
			expect(samples[0].willFail).toBe(0) // succeeded
			expect(samples[1].willFail).toBe(1) // failed
		})

		it("should increase coverage gap for failed tests with many retries", () => {
			const mockOrch = createMockOrchestrator() as any
			const loop = new InfiniteImprovementLoop(mockOrch, defaultConfig)

			const tasks = [
				createMockTask({ agent: "tester", status: "succeeded", attempts: 1 }),
				createMockTask({ agent: "tester", status: "failed", attempts: 3 }),
			]
			const samples = (loop as any).extractTestSamples(tasks) as Array<{ coverageGap: number }>

			expect(samples).toHaveLength(2)
			expect(samples[0].coverageGap).toBeCloseTo(0.2, 1)
			expect(samples[1].coverageGap).toBeCloseTo(0.9, 1) // failed + attempts > 2
		})
	})

	describe("validateAction", () => {
		it("should reject actions with confidence below 0.5", () => {
			const mockOrch = createMockOrchestrator() as any
			const loop = new InfiniteImprovementLoop(mockOrch, defaultConfig)

			const result = (loop as any).validateAction({ confidence: 0.3, agent: "coder", reason: "test" })
			expect(result.valid).toBe(false)
			expect(result.reason).toContain("Confidence too low")
		})

		it("should accept actions with confidence >= 0.5", () => {
			const mockOrch = createMockOrchestrator() as any
			const loop = new InfiniteImprovementLoop(mockOrch, defaultConfig)

			const result = (loop as any).validateAction({ confidence: 0.5, agent: "coder", reason: "test" })
			expect(result.valid).toBe(true)
		})

		it("should reject unknown agents", () => {
			const mockOrch = createMockOrchestrator() as any
			mockOrch.agents.list.mockReturnValue([{ name: "coder" }])
			const loop = new InfiniteImprovementLoop(mockOrch, defaultConfig)

			const result = (loop as any).validateAction({ confidence: 0.9, agent: "unknown-agent", reason: "test" })
			expect(result.valid).toBe(false)
			expect(result.reason).toContain("Unknown agent")
		})

		it("should allow generic agents (coder, tester, debugger) even if not registered", () => {
			const mockOrch = createMockOrchestrator() as any
			mockOrch.agents.list.mockReturnValue([])
			const loop = new InfiniteImprovementLoop(mockOrch, defaultConfig)

			const coderResult = (loop as any).validateAction({ confidence: 0.9, agent: "coder", reason: "test" })
			const testerResult = (loop as any).validateAction({ confidence: 0.9, agent: "tester", reason: "test" })
			const debuggerResult = (loop as any).validateAction({ confidence: 0.9, agent: "debugger", reason: "test" })

			expect(coderResult.valid).toBe(true)
			expect(testerResult.valid).toBe(true)
			expect(debuggerResult.valid).toBe(true)
		})

		it("should reject duplicate actions for the same task", () => {
			const mockOrch = createMockOrchestrator() as any
			const task = createMockTask({ id: "task-1" })
			mockOrch.queue.list.mockReturnValue([
				createMockTask({
					parentTaskId: "task-1",
					agent: "debugger",
					goal: "Pre-emptive debug for task task-1: predicted high bug risk",
				}),
			])
			const loop = new InfiniteImprovementLoop(mockOrch, defaultConfig)

			const result = (loop as any).validateAction(
				{
					confidence: 0.9,
					agent: "debugger",
					reason: "Pre-emptive debug for task task-1: predicted high bug risk",
				},
				task,
			)
			expect(result.valid).toBe(false)
			expect(result.reason).toContain("Duplicate")
		})

		it("should reject when per-iteration budget is exceeded", () => {
			const mockOrch = createMockOrchestrator() as any
			const loop = new InfiniteImprovementLoop(mockOrch, { ...defaultConfig, maxActionsPerIteration: 1 })
			;(loop as any).actionCountThisIteration = 1

			const result = (loop as any).validateAction({ confidence: 0.9, agent: "coder", reason: "test" })
			expect(result.valid).toBe(false)
			expect(result.reason).toContain("Max actions per iteration")
		})
	})

	describe("getSyncStatus", () => {
		it("should return null when no MLSyncClient is configured", () => {
			const mockOrch = createMockOrchestrator() as any
			const loop = new InfiniteImprovementLoop(mockOrch, defaultConfig)

			expect(loop.getSyncStatus()).toBeNull()
		})
	})

	describe("getStats", () => {
		it("should return a copy of stats", () => {
			const mockOrch = createMockOrchestrator() as any
			const loop = new InfiniteImprovementLoop(mockOrch, defaultConfig)

			const stats = loop.getStats()
			expect(stats).toEqual({
				iteration: 0,
				totalSamples: 0,
				lastTrainLoss: 0,
				predictionsMade: 0,
				actionsTaken: 0,
				lastMetrics: {},
				actionHelpRate: 0,
			})
			// Verify it's a copy, not a reference
			stats.iteration = 99
			expect(loop.getStats().iteration).toBe(0)
		})
	})

	describe("observeAndLearn", () => {
		it("should wait for minimum samples before training", async () => {
			const mockOrch = createMockOrchestrator() as any
			mockOrch.queue.list.mockReturnValue([])
			const loop = new InfiniteImprovementLoop(mockOrch, { ...defaultConfig, minSamples: 10 })

			await (loop as any).observeAndLearn()

			expect(mockOrch.events.debug).toHaveBeenCalledWith(
				"ml.loop.observe",
				expect.stringContaining("Waiting for more samples"),
			)
		})

		it("should handle CodeLearner training errors gracefully", async () => {
			const mockOrch = createMockOrchestrator() as any
			const task = createMockTask({ agent: "coder", status: "succeeded" })
			mockOrch.queue.list.mockReturnValue([task])
			const loop = new InfiniteImprovementLoop(mockOrch, { ...defaultConfig, minSamples: 1 })

			// Spy on codeLearner.train to throw
			const codeLearner = (loop as any).codeLearner
			const originalTrain = codeLearner.train
			codeLearner.train = vi.fn().mockImplementation(() => {
				throw new Error("Training failed")
			})

			await (loop as any).observeAndLearn()

			expect(mockOrch.events.error).toHaveBeenCalledWith(
				"ml.loop.train_error",
				expect.stringContaining("CodeLearner training failed"),
			)
			// Restore
			codeLearner.train = originalTrain
		})

		it("should reset all learners when all losses are NaN", async () => {
			const mockOrch = createMockOrchestrator() as any
			const task = createMockTask({ agent: "coder", status: "succeeded" })
			mockOrch.queue.list.mockReturnValue([task])
			const loop = new InfiniteImprovementLoop(mockOrch, { ...defaultConfig, minSamples: 1 })

			// Make all learners throw so losses become NaN
			const codeLearner = (loop as any).codeLearner
			const debugLearner = (loop as any).debugLearner
			const testLearner = (loop as any).testLearner
			const originalCodeTrain = codeLearner.train
			const originalDebugTrain = debugLearner.train
			const originalTestTrain = testLearner.train
			codeLearner.train = vi.fn().mockImplementation(() => {
				throw new Error("fail")
			})
			debugLearner.train = vi.fn().mockImplementation(() => {
				throw new Error("fail")
			})
			testLearner.train = vi.fn().mockImplementation(() => {
				throw new Error("fail")
			})

			await (loop as any).observeAndLearn()

			expect(mockOrch.events.warn).toHaveBeenCalledWith(
				"ml.loop.train_error",
				expect.stringContaining("All training losses are NaN"),
			)
			expect(mockOrch.events.info).toHaveBeenCalledWith(
				"ml.loop.reset",
				expect.stringContaining("Reset all learners"),
			)

			// Restore
			codeLearner.train = originalCodeTrain
			debugLearner.train = originalDebugTrain
			testLearner.train = originalTestTrain
		})
	})

	describe("loop lifecycle", () => {
		it("should stop after max consecutive failures", async () => {
			const mockOrch = createMockOrchestrator() as any
			mockOrch.queue.list.mockReturnValue([])
			const loop = new InfiniteImprovementLoop(mockOrch, {
				...defaultConfig,
				maxIterations: 10,
				idleSleepMs: 5,
				minSamples: 1,
			})

			// Make observeAndLearn throw every time
			const originalObserve = (loop as any).observeAndLearn
			;(loop as any).observeAndLearn = vi.fn().mockRejectedValue(new Error("Persistent failure"))

			await loop.start()
			// Wait for loop to hit maxConsecutiveFailures (5)
			await new Promise((r) => setTimeout(r, 200))
			await loop.stop()

			expect(mockOrch.events.error).toHaveBeenCalledWith(
				"ml.loop.fatal",
				expect.stringContaining("Too many consecutive failures"),
			)

			// Restore
			;(loop as any).observeAndLearn = originalObserve
		})
	})
})
