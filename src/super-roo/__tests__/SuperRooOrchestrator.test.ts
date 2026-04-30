import { describe, expect, it, beforeEach, afterEach } from "vitest"

import { SuperRooOrchestrator } from "../orchestrator/SuperRooOrchestrator"
import type { Agent } from "../types"
import { SafetyMode } from "../types"

/**
 * Test agent: records every invocation and lets the test choose how it responds.
 * Used to exercise the orchestrator's contract without depending on the real
 * Phase 2 agent implementations.
 */
function makeFakeAgent(name: string, behavior: Partial<Agent> & { onRun?: Agent["run"] } = {}): Agent {
	return {
		name,
		description: behavior.description ?? `fake ${name}`,
		requiredCapabilities: behavior.requiredCapabilities ?? [],
		run:
			behavior.onRun ??
			(async () => ({
				ok: true,
				summary: `${name} ran`,
			})),
	}
}

describe("SuperRooOrchestrator — lifecycle", () => {
	let orch: SuperRooOrchestrator

	beforeEach(() => {
		orch = new SuperRooOrchestrator({ dbPath: ":memory:", initialMode: SafetyMode.AUTO })
	})

	afterEach(async () => {
		await orch.stop()
		orch.close()
	})

	it("start() emits orchestrator.started with metadata", () => {
		orch.start()
		const ev = orch.events.recent({ type: "orchestrator.started" })[0]
		expect(ev).toBeDefined()
		expect(ev.data).toMatchObject({ mode: "AUTO", schemaVersion: 3 })
	})

	it("processNext returns 'idle' when queue is empty", async () => {
		orch.start()
		const r = await orch.processNext()
		expect(r.kind).toBe("idle")
	})

	it("processNext returns 'off' when mode is OFF", async () => {
		orch.setMode(SafetyMode.OFF)
		orch.start()
		orch.submit({
			agent: "coder",
			goal: "do thing",
			requiredCapabilities: [],
		} as never)
		const r = await orch.processNext()
		expect(r.kind).toBe("off")
	})
})

describe("SuperRooOrchestrator — agent dispatch", () => {
	let orch: SuperRooOrchestrator

	beforeEach(() => {
		orch = new SuperRooOrchestrator({
			dbPath: ":memory:",
			initialMode: SafetyMode.AUTO,
			healingCycleIntervalMs: 100, // Fast cleanup in tests
		})
		orch.start()
	})

	afterEach(async () => {
		await orch.stop()
		orch.close()
	})

	it("dispatches a task to a registered agent and marks it succeeded", async () => {
		const calls: string[] = []
		orch.agents.register(
			makeFakeAgent("coder", {
				onRun: async (ctx) => {
					calls.push(ctx.task.goal)
					return { ok: true, summary: "did it" }
				},
			}),
		)

		const t = orch.submit({
			agent: "coder",
			goal: "implement login",
			requiredCapabilities: ["write.file"],
		} as never)

		const r = await orch.processNext()
		expect(r.kind).toBe("ran")
		if (r.kind === "ran") {
			expect(r.result.ok).toBe(true)
		}
		expect(calls).toEqual(["implement login"])

		const reread = orch.queue.get(t.id)!
		expect(reread.status).toBe("succeeded")
		expect(reread.resultSummary).toBe("did it")
	})

	it("blocks tasks whose agent is unknown (Phase 2 hasn't registered yet)", async () => {
		const t = orch.submit({
			agent: "ghost",
			goal: "nope",
			requiredCapabilities: [],
		} as never)
		const r = await orch.processNext()
		expect(r.kind).toBe("blocked")
		const reread = orch.queue.get(t.id)!
		expect(reread.status).toBe("blocked")
		expect(reread.error).toMatch(/Unknown agent/)
	})

	it("blocks at submit time when capabilities aren't allowed at current mode", () => {
		orch.setMode(SafetyMode.SAFE)
		const t = orch.submit({
			agent: "coder",
			goal: "deploy prod",
			requiredCapabilities: ["deploy.production"],
		} as never)
		expect(t.status).toBe("blocked")
		expect(t.error).toMatch(/not permitted at safety mode SAFE/)
	})

	it("includes registered agent required capabilities in submit-time safety checks", () => {
		orch.agents.register(makeFakeAgent("db", { requiredCapabilities: ["database.sql.admin"] }))
		const t = orch.submit({
			agent: "db",
			goal: "reset database",
			requiredCapabilities: [],
		} as never)
		expect(t.status).toBe("blocked")
		expect(t.error).toContain("database.sql.admin")
	})

	it("captures agent throws as failed task with error", async () => {
		orch.agents.register(
			makeFakeAgent("crasher", {
				onRun: async () => {
					throw new Error("kaboom")
				},
			}),
		)
		orch.submit({ agent: "crasher", goal: "g", requiredCapabilities: [] } as never)
		const r = await orch.processNext()
		expect(r.kind).toBe("ran")
		if (r.kind === "ran") {
			expect(r.result.ok).toBe(false)
			expect(r.result.error).toBe("kaboom")
		}
	})

	it("agent followups are enqueued with parentTaskId", async () => {
		orch.agents.register(
			makeFakeAgent("planner", {
				onRun: async () => ({
					ok: true,
					summary: "planned",
					followups: [
						{
							agent: "coder",
							goal: "step 1",
							priority: "normal",
							requiredCapabilities: [],
							payload: {},
							maxIterations: 5,
						},
					],
				}),
			}),
		)
		const parent = orch.submit({ agent: "planner", goal: "plan", requiredCapabilities: [] } as never)
		await orch.processNext()
		const followups = orch.queue.list({ agent: "coder" })
		expect(followups).toHaveLength(1)
		expect(followups[0].parentTaskId).toBe(parent.id)
	})

	it("priority-orders dispatch", async () => {
		const seen: string[] = []
		orch.agents.register(
			makeFakeAgent("worker", {
				onRun: async (ctx) => {
					seen.push(ctx.task.goal)
					return { ok: true, summary: "ok" }
				},
			}),
		)
		orch.submit({ agent: "worker", goal: "low", priority: "low", requiredCapabilities: [] } as never)
		orch.submit({ agent: "worker", goal: "critical", priority: "critical", requiredCapabilities: [] } as never)
		orch.submit({ agent: "worker", goal: "normal", priority: "normal", requiredCapabilities: [] } as never)

		await orch.processNext()
		await orch.processNext()
		await orch.processNext()
		expect(seen).toEqual(["critical", "normal", "low"])
	})
})

describe("SuperRooOrchestrator — mode + self-improve", () => {
	let orch: SuperRooOrchestrator

	beforeEach(() => {
		orch = new SuperRooOrchestrator({
			dbPath: ":memory:",
			initialMode: SafetyMode.SAFE,
			healingCycleIntervalMs: 100, // Fast cleanup in tests
		})
		orch.start()
	})

	afterEach(async () => {
		await orch.stop()
		orch.close()
	})

	it("setMode emits safety.mode_changed", () => {
		orch.setMode(SafetyMode.AUTO)
		const ev = orch.events.recent({ type: "safety.mode_changed" })[0]
		expect(ev.data).toMatchObject({ from: "SAFE", to: "AUTO" })
	})

	it("setMode no-ops when same mode is set", () => {
		const before = orch.events.recent({ type: "safety.mode_changed" }).length
		orch.setMode(SafetyMode.SAFE)
		const after = orch.events.recent({ type: "safety.mode_changed" }).length
		expect(after).toBe(before)
	})

	it("enableSelfImprove logs at WARN level", () => {
		orch.enableSelfImprove()
		const ev = orch.events.recent({ type: "safety.mode_changed" })[0]
		expect(ev.level).toBe("warn")
		expect(ev.message).toMatch(/Self-improve/)
	})
})

describe("SuperRooOrchestrator — runLoop", () => {
	it("processes queued tasks until idle then sleeps; respects stop()", async () => {
		const orch = new SuperRooOrchestrator({ dbPath: ":memory:", initialMode: SafetyMode.AUTO })
		orch.start()
		const seen: string[] = []
		orch.agents.register(
			makeFakeAgent("w", {
				onRun: async (ctx) => {
					seen.push(ctx.task.goal)
					return { ok: true, summary: "ok" }
				},
			}),
		)
		orch.submit({ agent: "w", goal: "a", requiredCapabilities: [] } as never)
		orch.submit({ agent: "w", goal: "b", requiredCapabilities: [] } as never)

		const loop = orch.runLoop({ idleSleepMs: 5 })
		// Give the loop a moment to drain the queue.
		await new Promise((r) => setTimeout(r, 50))
		await orch.stop()
		await loop
		expect(seen).toEqual(["a", "b"])
		orch.close()
	})
})
