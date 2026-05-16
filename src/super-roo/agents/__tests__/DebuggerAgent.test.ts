import { describe, expect, it, beforeEach, afterEach } from "vitest"

import { DebuggerAgent } from "../DebuggerAgent"
import { BugRegistry } from "../../bugs/BugRegistry"
import { EventLog } from "../../logging/EventLog"
import { MemoryStore } from "../../memory/MemoryStore"
import type { RooTaskOutcome, RooTaskRunner } from "../RooTaskAdapter"
import type { AgentRunContext, EventLevel, EventType, Task } from "../../types"
import { SafetyMode } from "../../types"

function makeFakeRunner(opts: { outcome?: RooTaskOutcome; ready?: boolean }) {
	const runner: RooTaskRunner = {
		isReady: () => opts.ready ?? true,
		run: async () => opts.outcome ?? { kind: "completed", taskId: "diag-1" },
	}
	return runner
}

interface Captured {
	level: EventLevel
	type: EventType
	message: string
}

function makeCtx(payload: Record<string, unknown> = {}) {
	const emitted: Captured[] = []
	const task: Task = {
		id: "t1",
		agent: "debugger",
		goal: "Investigate login crash",
		priority: "high",
		status: "running",
		requiredCapabilities: [],
		payload,
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

describe("DebuggerAgent", () => {
	let store: MemoryStore
	let log: EventLog
	let bugs: BugRegistry

	beforeEach(() => {
		store = new MemoryStore(":memory:")
		log = new EventLog(store)
		bugs = new BugRegistry(store, log)
	})
	afterEach(() => store.close())

	it("records a bug before invoking Roo", async () => {
		const a = new DebuggerAgent(makeFakeRunner({}), bugs)
		const { ctx } = makeCtx({ errorMessage: "TypeError: cannot read property 'x' of undefined" })
		await a.run(ctx)
		const all = bugs.list()
		expect(all).toHaveLength(1)
		expect(all[0].title).toContain("TypeError")
	})

	it("uses debug mode by default", async () => {
		let capturedMode = ""
		const runner: RooTaskRunner = {
			isReady: () => true,
			run: async (req) => {
				capturedMode = req.mode
				return { kind: "completed", taskId: "x" }
			},
		}
		const a = new DebuggerAgent(runner, bugs)
		await a.run(makeCtx({ errorMessage: "boom" }).ctx)
		expect(capturedMode).toBe("debug")
	})

	it("queues a Coder follow-up linked by bugId on success", async () => {
		const a = new DebuggerAgent(makeFakeRunner({}), bugs)
		const r = await a.run(makeCtx({ errorMessage: "boom" }).ctx)
		expect(r.ok).toBe(true)
		expect(r.followups).toHaveLength(1)
		expect(r.followups?.[0].agent).toBe("coder")
		expect(r.followups?.[0].bugId).toMatch(/^bug_/)
	})

	it("marks bug as blocked when Roo investigation fails", async () => {
		const a = new DebuggerAgent(
			makeFakeRunner({ outcome: { kind: "failed", taskId: "x", error: "model down" } }),
			bugs,
		)
		await a.run(makeCtx({ errorMessage: "boom" }).ctx)
		const all = bugs.list()
		expect(all[0].status).toBe("blocked")
	})

	it("captures stack trace and files into bug record", async () => {
		const a = new DebuggerAgent(makeFakeRunner({}), bugs)
		await a.run(
			makeCtx({
				errorMessage: "ReferenceError: foo is not defined",
				stackTrace: "at line 42 of auth.ts",
				filesLikelyInvolved: ["src/auth.ts"],
			}).ctx,
		)
		const b = bugs.list()[0]
		expect(b.symptoms.some((s) => s.includes("ReferenceError"))).toBe(true)
		expect(b.symptoms.some((s) => s.includes("line 42"))).toBe(true)
		expect(b.filesLikelyInvolved).toEqual(["src/auth.ts"])
	})

	it("respects severity from payload", async () => {
		const a = new DebuggerAgent(makeFakeRunner({}), bugs)
		await a.run(makeCtx({ errorMessage: "boom", severity: "critical" }).ctx)
		expect(bugs.list()[0].severity).toBe("critical")
	})

	it("returns runner_not_ready without recording a bug", async () => {
		const a = new DebuggerAgent(makeFakeRunner({ ready: false }), bugs)
		const r = await a.run(makeCtx({ errorMessage: "boom" }).ctx)
		expect(r.error).toBe("runner_not_ready")
		// We do still record because the bug exists regardless of runner readiness?
		// The implementation chose to gate on isReady before recording — verify that.
		expect(bugs.list()).toHaveLength(0)
	})
})
