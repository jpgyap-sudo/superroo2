import { describe, expect, it, beforeEach, afterEach } from "vitest"
import { InfiniteImprovementLoop } from "../../ml/loop/InfiniteImprovementLoop"
import { SuperRooOrchestrator } from "../../orchestrator/SuperRooOrchestrator"
import { SafetyMode } from "../../types"

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
