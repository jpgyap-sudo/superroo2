/**
 * Tests for CPU Guard module
 *
 * These tests validate the resource monitoring, event system, and
 * backpressure logic without actually consuming CPU time.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest"
import {
	getCpuUsagePercent,
	getRamUsagePercent,
	getResourceSample,
	onResourceGuardEvent,
	waitForCpuBelow,
} from "../cpuGuard"

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("node:os", () => {
	const mockCpus = () => [
		{
			times: {
				user: 100,
				nice: 0,
				sys: 50,
				idle: 850,
				irq: 0,
			},
		},
		{
			times: {
				user: 120,
				nice: 0,
				sys: 60,
				idle: 820,
				irq: 0,
			},
		},
	]

	return {
		default: {
			cpus: mockCpus,
			totalmem: () => 16 * 1024 * 1024 * 1024, // 16 GB
			freemem: () => 8 * 1024 * 1024 * 1024, // 8 GB free
		},
		cpus: mockCpus,
		totalmem: () => 16 * 1024 * 1024 * 1024,
		freemem: () => 8 * 1024 * 1024 * 1024,
	}
})

// ── Tests ────────────────────────────────────────────────────────────────────

describe("getRamUsagePercent", () => {
	test("returns a percentage between 0 and 100", () => {
		const pct = getRamUsagePercent()
		expect(pct).toBeGreaterThanOrEqual(0)
		expect(pct).toBeLessThanOrEqual(100)
	})

	test("returns 50% with 16GB total and 8GB free", () => {
		const pct = getRamUsagePercent()
		expect(pct).toBe(50)
	})
})

describe("getResourceSample", () => {
	test("returns a complete resource snapshot", async () => {
		const sample = await getResourceSample(10)
		expect(sample).toHaveProperty("cpuPercent")
		expect(sample).toHaveProperty("ramPercent")
		expect(sample).toHaveProperty("freeRamMb")
		expect(sample).toHaveProperty("totalRamMb")
		expect(sample).toHaveProperty("timestamp")
		expect(sample.ramPercent).toBe(50)
		expect(sample.totalRamMb).toBe(16384)
		expect(sample.freeRamMb).toBe(8192)
		expect(typeof sample.cpuPercent).toBe("number")
	})
})

describe("onResourceGuardEvent", () => {
	test("subscribe and unsubscribe work", () => {
		const listener = vi.fn()
		const unsubscribe = onResourceGuardEvent(listener)
		expect(typeof unsubscribe).toBe("function")
		unsubscribe()
		// No event emitted yet, so listener should not have been called
		expect(listener).not.toHaveBeenCalled()
	})
})

describe("waitForCpuBelow", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	test("passes immediately when CPU is below threshold", async () => {
		// With mocked CPU at ~15% (idle=1670/2000), threshold of 85 should pass immediately
		const logger = { warn: vi.fn(), info: vi.fn() }
		const promise = waitForCpuBelow(85, logger as unknown as Console, undefined, {
			pollIntervalMs: 100,
			sampleMs: 10,
		})

		// Advance past the initial sample
		await vi.advanceTimersByTimeAsync(20)

		await expect(promise).resolves.toBeUndefined()
		expect(logger.warn).not.toHaveBeenCalled()
	})
})

describe("getCpuUsagePercent", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	test("returns a number between 0 and 100", async () => {
		const promise = getCpuUsagePercent(10)
		await vi.advanceTimersByTimeAsync(20)
		const pct = await promise
		expect(pct).toBeGreaterThanOrEqual(0)
		expect(pct).toBeLessThanOrEqual(100)
	})
})
