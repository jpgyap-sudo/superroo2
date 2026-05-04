/**
 * Tests for AgentLoopGuard
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest"
import { runGuardedAgentLoop, GuardedLoopError } from "../AgentLoopGuard"

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../cpuGuard", () => ({
	waitForCpuBelow: vi.fn().mockResolvedValue(undefined),
	getCpuUsagePercent: vi.fn().mockResolvedValue(30),
	getRamUsagePercent: vi.fn().mockReturnValue(40),
	getResourceSample: vi.fn().mockResolvedValue({
		cpuPercent: 30,
		ramPercent: 40,
		freeRamMb: 8000,
		totalRamMb: 16000,
		timestamp: Date.now(),
	}),
	onResourceGuardEvent: vi.fn().mockReturnValue(vi.fn()),
}))

// ── Tests ────────────────────────────────────────────────────────────────────

describe("runGuardedAgentLoop", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	test("completes when step returns done=true", async () => {
		const step = vi.fn().mockResolvedValue({ done: true, message: "Task finished" })
		const logger = { info: vi.fn(), warn: vi.fn() }

		const result = await runGuardedAgentLoop(step, {
			taskName: "test-task",
			maxLoops: 5,
			cooldownMs: 10,
			logger: logger as unknown as Console,
		})

		expect(result).toEqual({ done: true, message: "Task finished" })
		expect(step).toHaveBeenCalledTimes(1)
		expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("test-task: loop 1/5"))
		expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("test-task: completed"))
	})

	test("throws GuardedLoopError when maxLoops exceeded", async () => {
		const step = vi.fn().mockResolvedValue({ done: false })
		const logger = { info: vi.fn(), warn: vi.fn() }

		// Start the loop (will hang on sleep(cooldownMs) between iterations)
		const promise = runGuardedAgentLoop(step, {
			taskName: "infinite-task",
			maxLoops: 3,
			cooldownMs: 10,
			logger: logger as unknown as Console,
		})

		// Advance fake timers to let each sleep(cooldownMs) resolve
		// 3 iterations × 10ms cooldown = 30ms needed between iterations
		// The mock waitForCpuBelow resolves immediately, so only cooldown sleeps block
		await vi.advanceTimersByTimeAsync(50)

		await expect(promise).rejects.toThrow(GuardedLoopError)
		expect(step).toHaveBeenCalledTimes(3)
	})

	test("respects AbortSignal", async () => {
		const abortController = new AbortController()
		const step = vi.fn().mockResolvedValue({ done: false })
		const logger = { info: vi.fn(), warn: vi.fn() }

		// Abort before the loop starts
		abortController.abort()

		await expect(
			runGuardedAgentLoop(step, {
				taskName: "abort-task",
				maxLoops: 5,
				cooldownMs: 10,
				logger: logger as unknown as Console,
				signal: abortController.signal,
			}),
		).rejects.toThrow("aborted")
	})

	test("uses default values when options are omitted", async () => {
		const step = vi.fn().mockResolvedValue({ done: true })

		const result = await runGuardedAgentLoop(step, { taskName: "defaults-test" })

		expect(result).toEqual({ done: true })
		expect(step).toHaveBeenCalledTimes(1)
	})
})
