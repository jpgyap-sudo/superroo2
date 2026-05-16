/**
 * Tests for ParallelExecutor — resource-aware concurrent task execution.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

import { ParallelExecutor } from "../ParallelExecutor"
import type { Agent, AgentRunContext, AgentRunResult, Task, TaskPriority } from "../../types"
import { SafetyMode } from "../../types"
import type { EventLog } from "../../logging/EventLog"
import type { SafetyManager } from "../../safety/SafetyManager"

// ── Fake dependencies ────────────────────────────────────────────────────────

function fakeEventLog(): EventLog {
	return {
		emit: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		subscribe: vi.fn(),
		unsubscribe: vi.fn(),
		recent: vi.fn().mockReturnValue([]),
	} as unknown as EventLog
}

function fakeSafetyManager(): SafetyManager {
	return {
		getMode: vi.fn().mockReturnValue(SafetyMode.AUTO),
		checkCapabilities: vi.fn().mockReturnValue({ allowed: true }),
	} as unknown as SafetyManager
}

function makeTask(overrides: Partial<Task> = {}): Task {
	return {
		id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
		agent: "coder",
		goal: "test task",
		priority: "normal" as TaskPriority,
		status: "pending",
		requiredCapabilities: [],
		payload: {},
		maxIterations: 10,
		createdAt: Date.now(),
		updatedAt: Date.now(),
		attempts: 0,
		...overrides,
	}
}

function makeFakeAgent(name: string, delayMs = 0): Agent {
	return {
		name,
		description: `fake ${name}`,
		requiredCapabilities: [],
		run: vi.fn().mockImplementation(async (ctx: AgentRunContext): Promise<AgentRunResult> => {
			if (delayMs > 0) {
				await new Promise((resolve) => setTimeout(resolve, delayMs))
			}
			// Check for cancellation
			if (ctx.signal.aborted) {
				return { ok: false, summary: "cancelled" }
			}
			return { ok: true, summary: `${name} ran` }
		}),
	}
}

function makeEmit(): AgentRunContext["emit"] {
	return vi.fn()
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("ParallelExecutor", () => {
	let executor: ParallelExecutor
	let events: EventLog
	let safety: SafetyManager

	beforeEach(() => {
		events = fakeEventLog()
		safety = fakeSafetyManager()
		executor = new ParallelExecutor(events, safety, {
			maxConcurrency: 3,
			maxTokenBudget: 100,
			enablePreemption: false,
			taskTimeoutMs: 10_000,
		})
		executor.start()
	})

	afterEach(() => {
		executor.stop()
	})

	describe("lifecycle", () => {
		it("starts and stops without error", () => {
			const ex = new ParallelExecutor(events, safety)
			expect(ex.isRunning()).toBe(false)
			ex.start()
			expect(ex.isRunning()).toBe(true)
			ex.stop()
			expect(ex.isRunning()).toBe(false)
		})

		it("start() is idempotent", () => {
			executor.start()
			executor.start()
			expect(executor.isRunning()).toBe(true)
		})

		it("stop() aborts all running slots", async () => {
			const slowAgent = makeFakeAgent("slow", 5000)
			const task = makeTask({ agent: "slow" })
			const slotId = executor.dispatch(task, slowAgent, makeEmit())
			expect(slotId).not.toBeNull()

			executor.stop()
			expect(executor.isRunning()).toBe(false)

			// The slot should have been aborted
			const result = await (slowAgent.run as ReturnType<typeof vi.fn>).mock.results[0]?.value
			expect(result?.ok).toBe(false)
		})
	})

	describe("canDispatch", () => {
		it("allows dispatch when resources are available", () => {
			const task = makeTask()
			const agent = makeFakeAgent("coder")
			const result = executor.canDispatch(task, agent)
			expect(result.allowed).toBe(true)
		})

		it("rejects when executor is not running", () => {
			executor.stop()
			const task = makeTask()
			const agent = makeFakeAgent("coder")
			const result = executor.canDispatch(task, agent)
			expect(result.allowed).toBe(false)
			expect(result.reason).toContain("not running")
		})

		it("rejects when concurrency limit is reached", () => {
			const ex = new ParallelExecutor(events, safety, {
				maxConcurrency: 1,
				enablePreemption: false,
				taskTimeoutMs: 5000,
			})
			ex.start()

			const agent1 = makeFakeAgent("coder", 1000)
			const agent2 = makeFakeAgent("debugger", 1000)

			ex.dispatch(makeTask({ agent: "coder" }), agent1, makeEmit())
			const result = ex.canDispatch(makeTask({ agent: "debugger" }), agent2)
			expect(result.allowed).toBe(false)
			expect(result.reason).toContain("concurrency")

			ex.stop()
		})

		it("rejects when token budget is exceeded", () => {
			const ex = new ParallelExecutor(events, safety, {
				maxConcurrency: 5,
				maxTokenBudget: 15,
				enablePreemption: false,
				taskTimeoutMs: 5000,
			})
			ex.start()

			// coder costs 10 tokens, debugger costs 8 = 18 > 15
			const agent1 = makeFakeAgent("coder", 1000)
			const agent2 = makeFakeAgent("debugger", 1000)

			ex.dispatch(makeTask({ agent: "coder" }), agent1, makeEmit())
			const result = ex.canDispatch(makeTask({ agent: "debugger" }), agent2)
			expect(result.allowed).toBe(false)
			expect(result.reason).toContain("budget")

			ex.stop()
		})
	})

	describe("dispatch", () => {
		it("returns a slot ID on successful dispatch", () => {
			const agent = makeFakeAgent("coder")
			const task = makeTask()
			const slotId = executor.dispatch(task, agent, makeEmit())
			expect(slotId).toBe(`slot_${task.id}`)
		})

		it("returns null when resources are exhausted", () => {
			const ex = new ParallelExecutor(events, safety, {
				maxConcurrency: 1,
				enablePreemption: false,
				taskTimeoutMs: 5000,
			})
			ex.start()

			ex.dispatch(makeTask({ agent: "coder" }), makeFakeAgent("coder", 1000), makeEmit())
			const slotId = ex.dispatch(makeTask({ agent: "debugger" }), makeFakeAgent("debugger"), makeEmit())
			expect(slotId).toBeNull()

			ex.stop()
		})

		it("executes the agent and returns result via slot promise", async () => {
			const agent = makeFakeAgent("coder")
			const task = makeTask()
			const slotId = executor.dispatch(task, agent, makeEmit())
			expect(slotId).not.toBeNull()

			const promise = executor.getSlotPromise(task.id)
			expect(promise).not.toBeNull()

			const result = await promise!
			expect(result.ok).toBe(true)
			expect(result.summary).toBe("coder ran")
		})

		it("runs multiple agents concurrently", async () => {
			const agent1 = makeFakeAgent("coder", 200)
			const agent2 = makeFakeAgent("debugger", 200)
			const agent3 = makeFakeAgent("tester", 200)

			const start = Date.now()
			executor.dispatch(makeTask({ agent: "coder" }), agent1, makeEmit())
			executor.dispatch(makeTask({ agent: "debugger" }), agent2, makeEmit())
			executor.dispatch(makeTask({ agent: "tester" }), agent3, makeEmit())

			await executor.drain()
			const elapsed = Date.now() - start

			// With 3 concurrent slots and each taking 200ms, total should be ~200ms not 600ms
			expect(elapsed).toBeLessThan(400)
		})
	})

	describe("cancel", () => {
		it("cancels a running task", async () => {
			const agent = makeFakeAgent("slow", 5000)
			const task = makeTask()
			executor.dispatch(task, agent, makeEmit())

			const cancelled = executor.cancel(task.id)
			expect(cancelled).toBe(true)

			// The agent run should have been aborted
			const result = await (agent.run as ReturnType<typeof vi.fn>).mock.results[0]?.value
			expect(result?.ok).toBe(false)
		})

		it("returns false for unknown task", () => {
			const result = executor.cancel("nonexistent")
			expect(result).toBe(false)
		})
	})

	describe("drain", () => {
		it("resolves immediately when no slots are running", async () => {
			await expect(executor.drain()).resolves.toBeUndefined()
		})

		it("waits for all slots to complete", async () => {
			const agent1 = makeFakeAgent("coder", 100)
			const agent2 = makeFakeAgent("debugger", 100)

			executor.dispatch(makeTask({ agent: "coder" }), agent1, makeEmit())
			executor.dispatch(makeTask({ agent: "debugger" }), agent2, makeEmit())

			const start = Date.now()
			await executor.drain()
			const elapsed = Date.now() - start

			expect(elapsed).toBeGreaterThanOrEqual(90)
			expect(elapsed).toBeLessThan(300)
		})
	})

	describe("getStats", () => {
		it("returns correct stats when idle", () => {
			const stats = executor.getStats()
			expect(stats.runningTasks).toBe(0)
			expect(stats.maxConcurrency).toBe(3)
			expect(stats.maxTokenBudget).toBe(100)
			expect(stats.tokenBudgetUsed).toBe(0)
		})

		it("returns correct stats when tasks are running", () => {
			executor.dispatch(makeTask({ agent: "coder" }), makeFakeAgent("coder", 1000), makeEmit())
			executor.dispatch(makeTask({ agent: "debugger" }), makeFakeAgent("debugger", 1000), makeEmit())

			const stats = executor.getStats()
			expect(stats.runningTasks).toBe(2)
			expect(stats.tokenBudgetUsed).toBe(18) // coder=10 + debugger=8
			expect(stats.slots).toHaveLength(2)
		})
	})

	describe("isRunningTask", () => {
		it("returns true for running tasks", () => {
			const task = makeTask()
			executor.dispatch(task, makeFakeAgent("coder", 1000), makeEmit())
			expect(executor.isRunningTask(task.id)).toBe(true)
		})

		it("returns false for completed tasks", async () => {
			const agent = makeFakeAgent("coder")
			const task = makeTask()
			executor.dispatch(task, agent, makeEmit())
			await executor.drain()
			expect(executor.isRunningTask(task.id)).toBe(false)
		})
	})

	describe("timeout", () => {
		it("aborts a task that exceeds the timeout", async () => {
			const ex = new ParallelExecutor(events, safety, {
				maxConcurrency: 1,
				maxTokenBudget: 100,
				enablePreemption: false,
				taskTimeoutMs: 50, // very short timeout
			})
			ex.start()

			const agent = makeFakeAgent("slow", 500) // takes longer than timeout
			const task = makeTask()
			ex.dispatch(task, agent, makeEmit())

			// Wait for the timeout to trigger
			await new Promise((resolve) => setTimeout(resolve, 200))

			// The agent should have been aborted
			const result = await (agent.run as ReturnType<typeof vi.fn>).mock.results[0]?.value
			expect(result?.ok).toBe(false)

			ex.stop()
		})
	})
})
