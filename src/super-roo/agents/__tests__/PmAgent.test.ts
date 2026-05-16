import { describe, expect, it, beforeEach, afterEach } from "vitest"

import { PmAgent } from "../PmAgent"
import { FeatureRegistry } from "../../features/FeatureRegistry"
import { EventLog } from "../../logging/EventLog"
import { MemoryStore } from "../../memory/MemoryStore"
import type { RooTaskRequest, RooTaskOutcome, RooTaskRunner } from "../RooTaskAdapter"
import type { AgentRunContext, EventLevel, EventType, Task } from "../../types"
import { SafetyMode } from "../../types"

function makeFakeRunner(opts: { outcome?: RooTaskOutcome; ready?: boolean }) {
	const calls: RooTaskRequest[] = []
	const runner: RooTaskRunner = {
		isReady: () => opts.ready ?? true,
		run: async (req) => {
			calls.push(req)
			return opts.outcome ?? { kind: "completed", taskId: "plan-1" }
		},
	}
	return { runner, calls }
}

interface Captured {
	level: EventLevel
	type: EventType
	message: string
}

function makeCtx(over: { goal?: string; payload?: Record<string, unknown> } = {}) {
	const emitted: Captured[] = []
	const task: Task = {
		id: "t1",
		agent: "product-manager",
		goal: over.goal ?? "Build user authentication",
		priority: "normal",
		status: "running",
		requiredCapabilities: [],
		payload: over.payload ?? {},
		maxIterations: 5,
		attempts: 1,
		createdAt: 1,
		updatedAt: 1,
	}
	const ctx: AgentRunContext = {
		task,
		safetyMode: SafetyMode.AUTO,
		signal: new AbortController().signal,
		emit: (level, type, message) => {
			emitted.push({ level, type, message })
		},
	}
	return { ctx, emitted }
}

describe("PmAgent", () => {
	let store: MemoryStore
	let log: EventLog
	let features: FeatureRegistry

	beforeEach(() => {
		store = new MemoryStore(":memory:")
		log = new EventLog(store)
		features = new FeatureRegistry(store, log)
	})
	afterEach(() => store.close())

	it("creates the feature when it doesn't exist yet", async () => {
		const { runner } = makeFakeRunner({})
		const a = new PmAgent(runner, features)
		const { ctx } = makeCtx({ payload: { featureName: "Auth" } })
		await a.run(ctx)
		expect(features.getByName("Auth")).not.toBeNull()
	})

	it("marks the feature as building before invoking Roo", async () => {
		const { runner } = makeFakeRunner({})
		const a = new PmAgent(runner, features)
		const { ctx } = makeCtx({ payload: { featureName: "Auth" } })
		await a.run(ctx)
		expect(features.getByName("Auth")?.status).toBe("building")
	})

	it("uses architect mode by default", async () => {
		const { runner, calls } = makeFakeRunner({})
		const a = new PmAgent(runner, features)
		await a.run(makeCtx().ctx)
		expect(calls[0].mode).toBe("architect")
	})

	it("emits a Coder follow-up linked by featureId on success", async () => {
		const { runner } = makeFakeRunner({})
		const a = new PmAgent(runner, features)
		const { ctx } = makeCtx({ payload: { featureName: "Auth" } })
		const r = await a.run(ctx)
		expect(r.ok).toBe(true)
		expect(r.followups).toHaveLength(1)
		expect(r.followups?.[0].agent).toBe("coder")
		expect(r.followups?.[0].featureId).toBe(features.getByName("Auth")?.id)
	})

	it("returns ok=false when planning fails", async () => {
		const { runner } = makeFakeRunner({
			outcome: { kind: "failed", taskId: "x", error: "context window exceeded" },
		})
		const a = new PmAgent(runner, features)
		const r = await a.run(makeCtx().ctx)
		expect(r.ok).toBe(false)
		expect(r.error).toBe("context window exceeded")
	})

	it("returns runner_not_ready without invoking Roo", async () => {
		const { runner, calls } = makeFakeRunner({ ready: false })
		const a = new PmAgent(runner, features)
		const r = await a.run(makeCtx().ctx)
		expect(r.error).toBe("runner_not_ready")
		expect(calls).toHaveLength(0)
	})
})
