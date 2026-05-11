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

		// Track the rejection in a variable so we can assert on it later.
		// We must attach a .catch() handler before advancing timers to prevent
		// Vitest's global handler from detecting the rejection as unhandled.
		// With fake timers, vi.advanceTimersByTimeAsync resolves the sleep()
		// microtasks, causing the GuardedLoopError to be thrown. Vitest detects
		// the rejection before await promise can catch it.
		let rejection: unknown = undefined
		const promise = runGuardedAgentLoop(step, {
			taskName: "infinite-task",
			maxLoops: 3,
			cooldownMs: 10,
			logger: logger as unknown as Console,
		}).catch((e) => {
			rejection = e
		})

		// Advance fake timers to let each sleep(cooldownMs) resolve
		// 3 iterations × 10ms cooldown = 30ms needed between iterations
		// The mock waitForCpuBelow resolves immediately, so only cooldown sleeps block
		await vi.advanceTimersByTimeAsync(50)

		// Wait for the promise chain to settle
		await promise

		expect(rejection).toBeInstanceOf(GuardedLoopError)
		if (rejection instanceof GuardedLoopError) {
			expect(rejection.taskName).toBe("infinite-task")
			expect(rejection.loopsExecuted).toBe(3)
		}
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
