import { describe, it, expect, vi, beforeEach } from "vitest"
import { SuperRooOrchestrator } from "../SuperRooOrchestrator"
import type { SuperRooRuntime } from "../types"

const createMockRuntime = (): SuperRooRuntime => ({
	log: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	source: "cli",
	workspaceRoot: "/tmp",
})

describe("SuperRooOrchestrator", () => {
	let runtime: SuperRooRuntime
	let orchestrator: SuperRooOrchestrator

	beforeEach(() => {
		runtime = createMockRuntime()
		orchestrator = new SuperRooOrchestrator(runtime)
	})

	it("runManual should log start and finish messages", async () => {
		await orchestrator.runManual()
		expect(runtime.log).toHaveBeenCalledWith("Starting Phase 3 manual mode...")
		expect(runtime.log).toHaveBeenCalledWith(
			"Manual mode finished. No production deploy performed in Phase 3 skeleton.",
		)
	})
})
