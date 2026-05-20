/**
 * Tests for InfiniteImprovementLoop
 *
 * The loop implements an Observe → Learn → Predict → Act → Evaluate → Persist → Sync → Loop cycle.
 * It depends on SuperRooOrchestrator (events, queue, agents) and creates internal
 * CodeLearner, DebugLearner, TestLearner, and optionally MLSyncClient.
 *
 * We mock the orchestrator to avoid real SQLite, task queues, and agent registries.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { InfiniteImprovementLoop } from "../InfiniteImprovementLoop"
import type { SuperRooOrchestrator } from "../../../orchestrator/SuperRooOrchestrator"
import { TaskStatus } from "../../../types"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockTask(overrides: Record<string, any> = {}): any {
	return {
		id: "task-1",
		agent: "coder",
		goal: "Implement feature X",
		priority: "normal",
		requiredCapabilities: [],
		payload: {},
		maxIterations: 5,
		status: TaskStatus.SUCCEEDED,
		createdAt: Date.now(),
		updatedAt: Date.now(),
		attempts: 1,
		...overrides,
	}
}

function createMockOrchestrator(): Partial<SuperRooOrchestrator> {
	return {
		events: {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
		} as any,
		queue: {
			list: vi.fn().mockReturnValue([]),
			add: vi.fn().mockResolvedValue("new-task-id"),
		} as any,
		agents: {
			list: vi.fn().mockReturnValue([{ name: "coder" }, { name: "tester" }, { name: "debugger" }]),
		} as any,
	}
}

function defaultLoopConfig() {
	return {
		minSamples: 5,
		maxIterations: 1000,
		idleSleepMs: 5000,
		trainEpochs: 20,
		confidenceThreshold: 0.75,
		maxActionsPerIteration: 3,
	}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("InfiniteImprovementLoop", () => {
	let orchestrator: Partial<SuperRooOrchestrator>

	beforeEach(() => {
		orchestrator = createMockOrchestrator()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe("instantiation", () => {
		it("creates a loop with default config", () => {
			const loop = new InfiniteImprovementLoop(orchestrator as SuperRooOrchestrator)
			expect(loop).toBeInstanceOf(InfiniteImprovementLoop)
			expect(loop["config"].minSamples).toBe(5)
			expect(loop["config"].maxIterations).toBe(1000)
			expect(loop["config"].idleSleepMs).toBe(5000)
			expect(loop["config"].trainEpochs).toBe(20)
			expect(loop["config"].confidenceThreshold).toBe(0.75)
			expect(loop["config"].maxActionsPerIteration).toBe(3)
		})

		it("creates a loop with custom config", () => {
			const loop = new InfiniteImprovementLoop(orchestrator as SuperRooOrchestrator, {
				...defaultLoopConfig(),
				minSamples: 10,
				maxIterations: 100,
				idleSleepMs: 1000,
				trainEpochs: 5,
				confidenceThreshold: 0.8,
				maxActionsPerIteration: 5,
			})
			expect(loop["config"].minSamples).toBe(10)
			expect(loop["config"].maxIterations).toBe(100)
			expect(loop["config"].idleSleepMs).toBe(1000)
			expect(loop["config"].trainEpochs).toBe(5)
			expect(loop["config"].confidenceThreshold).toBe(0.8)
			expect(loop["config"].maxActionsPerIteration).toBe(5)
		})

		it("creates internal learners with correct inputDim", () => {
			const loop = new InfiniteImprovementLoop(orchestrator as SuperRooOrchestrator)
			expect(loop["codeLearner"]["config"].inputDim).toBe(8)
			expect(loop["debugLearner"]["config"].inputDim).toBe(8)
			expect(loop["testLearner"]["config"].inputDim).toBe(8)
		})

		it("does not create MLSyncClient when cloudApiBaseUrl is not set", () => {
			const loop = new InfiniteImprovementLoop(orchestrator as SuperRooOrchestrator)
			expect(loop["mlSyncClient"]).toBeNull()
		})

		it("creates MLSyncClient when cloudApiBaseUrl is set", () => {
			const loop = new InfiniteImprovementLoop(orchestrator as SuperRooOrchestrator, {
				...defaultLoopConfig(),
				cloudApiBaseUrl: "https://api.example.com",
				cloudAuthToken: "test-token",
				syncIntervalMs: 30000,
			})
			expect(loop["mlSyncClient"]).not.toBeNull()
			expect(loop["modelPersistence"]).not.toBeNull()
		})
	})

	describe("getStats()", () => {
		it("returns initial stats", () => {
			const loop = new InfiniteImprovementLoop(orchestrator as SuperRooOrchestrator)
			const stats = loop.getStats()
			expect(stats).toHaveProperty("iteration")
			expect(stats).toHaveProperty("totalSamples")
			expect(stats).toHaveProperty("lastTrainLoss")
			expect(stats).toHaveProperty("predictionsMade")
			expect(stats).toHaveProperty("actionsTaken")
			expect(stats).toHaveProperty("actionHelpRate")
			expect(stats.iteration).toBe(0)
			expect(stats.totalSamples).toBe(0)
			expect(stats.actionsTaken).toBe(0)
		})
	})

	describe("getSyncStatus()", () => {
		it("returns null when no MLSyncClient is configured", () => {
			const loop = new InfiniteImprovementLoop(orchestrator as SuperRooOrchestrator)
			expect(loop.getSyncStatus()).toBeNull()
		})
	})

	describe("start() / stop()", () => {
		it("start() logs info event and begins loop", async () => {
			const loop = new InfiniteImprovementLoop(orchestrator as SuperRooOrchestrator, {
				...defaultLoopConfig(),
				maxIterations: 1,
				idleSleepMs: 50,
				minSamples: 0,
			})
			await loop.start()
			expect(orchestrator.events!.info).toHaveBeenCalledWith("ml.loop.started", expect.any(String))
			expect(loop["running"]).toBe(true)
			await loop.stop()
			expect(loop["running"]).toBe(false)
		})

		it("start() is idempotent", async () => {
			const loop = new InfiniteImprovementLoop(orchestrator as SuperRooOrchestrator)
			await loop.start()
			await loop.start() // second call should be no-op
			expect(orchestrator.events!.info).toHaveBeenCalledTimes(1)
			await loop.stop()
		})

		it("stop() is idempotent", async () => {
			const loop = new InfiniteImprovementLoop(orchestrator as SuperRooOrchestrator)
			await loop.stop() // stop before start should be no-op
			expect(loop["running"]).toBe(false)
		})

		it("stop() saves model weights", async () => {
			const loop = new InfiniteImprovementLoop(orchestrator as SuperRooOrchestrator, {
				...defaultLoopConfig(),
				maxIterations: 1,
				idleSleepMs: 50,
				minSamples: 0,
			})
			await loop.start()
			await loop.stop()
			expect(orchestrator.events!.info).toHaveBeenCalledWith("ml.loop.saved", expect.any(String))
		})
	})

	describe("observeAndLearn()", () => {
		it("processes tasks from the queue", async () => {
			const mockTasks = [
				createMockTask({
					id: "t1",
					agent: "coder",
					goal: "Fix bug in parser",
					requiredCapabilities: ["write.file"],
					priority: "high",
				}),
			]
			orchestrator.queue!.list = vi.fn().mockReturnValue(mockTasks)

			const loop = new InfiniteImprovementLoop(orchestrator as SuperRooOrchestrator, {
				...defaultLoopConfig(),
				maxIterations: 1,
				idleSleepMs: 50,
				minSamples: 0,
			})
			await loop.start()
			await loop.stop()

			expect(orchestrator.queue!.list).toHaveBeenCalled()
		})
	})

	describe("validateAction()", () => {
		it("rejects actions with confidence below 0.5", () => {
			const loop = new InfiniteImprovementLoop(orchestrator as SuperRooOrchestrator)
			const result = (loop as any).validateAction({ confidence: 0.3, agent: "coder", reason: "test" })
			expect(result.valid).toBe(false)
			expect(result.reason).toContain("Confidence too low")
		})

		it("accepts actions with confidence above threshold", () => {
			const loop = new InfiniteImprovementLoop(orchestrator as SuperRooOrchestrator)
			const result = (loop as any).validateAction({ confidence: 0.9, agent: "coder", reason: "test" })
			expect(result.valid).toBe(true)
		})

		it("rejects actions for unknown agents", () => {
			orchestrator.agents!.list = vi.fn().mockReturnValue([{ name: "coder" }])
			const loop = new InfiniteImprovementLoop(orchestrator as SuperRooOrchestrator)
			const result = (loop as any).validateAction({ confidence: 0.9, agent: "unknown-agent", reason: "test" })
			expect(result.valid).toBe(false)
			expect(result.reason).toContain("Unknown agent")
		})

		it("allows generic agent names", () => {
			const loop = new InfiniteImprovementLoop(orchestrator as SuperRooOrchestrator)
			const result = (loop as any).validateAction({ confidence: 0.9, agent: "tester", reason: "test" })
			expect(result.valid).toBe(true)
		})
	})

	describe("taskToFeatures()", () => {
		it("converts a task to an 8-element feature vector", () => {
			const loop = new InfiniteImprovementLoop(orchestrator as SuperRooOrchestrator)
			const task = createMockTask({
				goal: "Short goal",
				requiredCapabilities: ["write.file", "execute.command"],
				priority: "critical",
				attempts: 2,
				parentTaskId: "parent-1",
			})
			const features = (loop as any).taskToFeatures(task)
			expect(features).toHaveLength(8)
			expect(features.every((f: number) => typeof f === "number")).toBe(true)
			// priority "critical" → 1
			expect(features[4]).toBe(1)
			// has parent → 1
			expect(features[6]).toBe(1)
		})

		it("handles low-priority tasks", () => {
			const loop = new InfiniteImprovementLoop(orchestrator as SuperRooOrchestrator)
			const task = createMockTask({ priority: "low" })
			const features = (loop as any).taskToFeatures(task)
			expect(features[4]).toBe(0.25)
		})
	})

	describe("extractCodeSamples()", () => {
		it("extracts code samples from coder-agent tasks", () => {
			const loop = new InfiniteImprovementLoop(orchestrator as SuperRooOrchestrator)
			const tasks = [
				createMockTask({ agent: "coder", goal: "Implement feature" }),
				createMockTask({ agent: "debugger", goal: "Fix bug" }),
			]
			const samples = (loop as any).extractCodeSamples(tasks)
			expect(samples.length).toBeGreaterThanOrEqual(1)
			expect(samples[0]).toHaveProperty("features")
			expect(samples[0]).toHaveProperty("quality")
			expect(samples[0]).toHaveProperty("success")
		})
	})

	describe("extractDebugSamples()", () => {
		it("extracts debug samples from debugger-agent tasks", () => {
			const loop = new InfiniteImprovementLoop(orchestrator as SuperRooOrchestrator)
			const tasks = [
				createMockTask({ agent: "debugger", goal: "Fix TypeError in module" }),
			]
			const samples = (loop as any).extractDebugSamples(tasks)
			expect(samples.length).toBeGreaterThanOrEqual(1)
			expect(samples[0]).toHaveProperty("features")
			expect(samples[0]).toHaveProperty("causeCategory")
		})
	})

	describe("extractTestSamples()", () => {
		it("extracts test samples from tester-agent tasks", () => {
			const loop = new InfiniteImprovementLoop(orchestrator as SuperRooOrchestrator)
			const tasks = [
				createMockTask({ agent: "tester", goal: "Run unit tests" }),
			]
			const samples = (loop as any).extractTestSamples(tasks)
			expect(samples.length).toBeGreaterThanOrEqual(1)
			expect(samples[0]).toHaveProperty("features")
			expect(samples[0]).toHaveProperty("willFail")
		})
	})
})
