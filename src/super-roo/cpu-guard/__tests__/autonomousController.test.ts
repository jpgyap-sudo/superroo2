/**
 * Tests for AutonomousController
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest"
import { autonomousController, runControlledAutonomousTask, onAutonomousControllerEvent } from "../autonomousController"

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

describe("autonomousController", () => {
	test("default mode is controlled", () => {
		expect(autonomousController.getMode()).toBe("controlled")
	})

	test("setMode changes mode", () => {
		autonomousController.setMode("paused")
		expect(autonomousController.getMode()).toBe("paused")
		expect(autonomousController.isEnabled()).toBe(false)

		autonomousController.setMode("controlled")
		expect(autonomousController.getMode()).toBe("controlled")
		expect(autonomousController.isEnabled()).toBe(true)
	})

	test("aggressive mode returns relaxed limits", () => {
		autonomousController.setMode("aggressive")
		const limits = autonomousController.getLimits()
		expect(limits.maxParallelAgents).toBeGreaterThanOrEqual(3)
		expect(limits.maxLoops).toBeGreaterThanOrEqual(8)
		expect(limits.cooldownMs).toBeLessThanOrEqual(1000)
		expect(limits.cpuPauseThreshold).toBeGreaterThanOrEqual(90)

		autonomousController.setMode("controlled")
	})

	test("controlled mode returns default limits", () => {
		autonomousController.setMode("controlled")
		const limits = autonomousController.getLimits()
		expect(limits.maxParallelAgents).toBe(2)
		expect(limits.maxLoops).toBe(5)
		expect(limits.cooldownMs).toBe(2000)
		expect(limits.cpuPauseThreshold).toBe(85)
	})
})

describe("onAutonomousControllerEvent", () => {
	test("subscribe and unsubscribe work", () => {
		const listener = vi.fn()
		const unsubscribe = onAutonomousControllerEvent(listener)
		expect(typeof unsubscribe).toBe("function")
		unsubscribe()
		expect(listener).not.toHaveBeenCalled()
	})

	test("mode change emits event", () => {
		const listener = vi.fn()
		const unsubscribe = onAutonomousControllerEvent(listener)

		autonomousController.setMode("paused")

		expect(listener).toHaveBeenCalledTimes(1)
		expect(listener).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "mode_changed",
				mode: "paused",
			}),
		)

		unsubscribe()
		autonomousController.setMode("controlled")
	})
})

describe("runControlledAutonomousTask", () => {
	beforeEach(() => {
		vi.useFakeTimers()
		autonomousController.setMode("controlled")
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	test("completes when step returns done=true", async () => {
		const step = vi.fn().mockResolvedValue({ done: true, message: "Done" })
		const logger = { info: vi.fn(), warn: vi.fn() }

		const summary = await runControlledAutonomousTask(step, {
			taskName: "test",
			maxLoops: 5,
			maxAttempts: 1,
			cooldownMs: 10,
			logger: logger as unknown as Console,
		})

		expect(summary.status).toBe("completed")
		expect(summary.finalMessage).toBe("Done")
		expect(summary.loops).toBe(1)
		expect(summary.attempts).toBe(1)
		expect(step).toHaveBeenCalledTimes(1)
	})

	test("stops when mode is paused", async () => {
		const step = vi.fn().mockResolvedValue({ done: false })
		const logger = { info: vi.fn(), warn: vi.fn() }

		autonomousController.setMode("paused")

		const summary = await runControlledAutonomousTask(step, {
			taskName: "paused-test",
			maxLoops: 5,
			maxAttempts: 1,
			cooldownMs: 10,
			logger: logger as unknown as Console,
		})

		expect(summary.status).toBe("stopped")
		expect(summary.finalMessage).toBe("Autonomous mode paused")
		expect(step).not.toHaveBeenCalled()
	})

	test("stops when max runtime exceeded", async () => {
		const step = vi.fn().mockResolvedValue({ done: false })
		const logger = { info: vi.fn(), warn: vi.fn() }

		const promise = runControlledAutonomousTask(step, {
			taskName: "timeout-test",
			maxLoops: 100,
			maxAttempts: 1,
			maxRuntimeMs: 100,
			cooldownMs: 10,
			logger: logger as unknown as Console,
		})

		// Advance time past the runtime limit
		await vi.advanceTimersByTimeAsync(200)

		const summary = await promise
		expect(summary.status).toBe("stopped")
		expect(summary.finalMessage).toBe("Max runtime reached")
	})

	test("respects AbortSignal", async () => {
		const abortController = new AbortController()
		const step = vi.fn().mockResolvedValue({ done: false })
		const logger = { info: vi.fn(), warn: vi.fn() }

		abortController.abort()

		const summary = await runControlledAutonomousTask(step, {
			taskName: "abort-test",
			maxLoops: 5,
			maxAttempts: 1,
			cooldownMs: 10,
			logger: logger as unknown as Console,
			signal: abortController.signal,
		})

		expect(summary.status).toBe("failed")
		expect(summary.error).toContain("aborted")
	})

	test("calls onSummary callback", async () => {
		const step = vi.fn().mockResolvedValue({ done: true })
		const onSummary = vi.fn()
		const logger = { info: vi.fn(), warn: vi.fn() }

		await runControlledAutonomousTask(step, {
			taskName: "summary-test",
			maxLoops: 5,
			maxAttempts: 1,
			cooldownMs: 10,
			logger: logger as unknown as Console,
			onSummary,
		})

		expect(onSummary).toHaveBeenCalledTimes(1)
		expect(onSummary).toHaveBeenCalledWith(
			expect.objectContaining({
				taskName: "summary-test",
				status: "completed",
			}),
		)
	})
})
