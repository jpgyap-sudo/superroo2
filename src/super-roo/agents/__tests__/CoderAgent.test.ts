import { describe, expect, it, beforeEach } from "vitest"

import { CoderAgent } from "../CoderAgent"
import type {
	RooTaskEventListener,
	RooTaskOutcome,
	RooTaskRequest,
	RooTaskRunner,
} from "../RooTaskAdapter"
import type { AgentRunContext, EventLevel, EventType, Task } from "../../types"
import { SafetyMode } from "../../types"

// ──────────────────────────────────────────────────────────────────────────────
// Fake runner — records every call, lets each test choose the outcome.
// ──────────────────────────────────────────────────────────────────────────────

interface FakeRunnerSpy {
	calls: RooTaskRequest[]
	listeners: RooTaskEventListener[]
}

function makeFakeRunner(opts: {
	outcome?: RooTaskOutcome
	ready?: boolean
	throwOnRun?: Error
	emitEvents?: Array<Parameters<RooTaskEventListener>[0]>
}): { runner: RooTaskRunner; spy: FakeRunnerSpy } {
	const spy: FakeRunnerSpy = { calls: [], listeners: [] }
	const runner: RooTaskRunner = {
		isReady: () => opts.ready ?? true,
		run: async (req, onEvent) => {
			spy.calls.push(req)
			if (onEvent) spy.listeners.push(onEvent)
			if (opts.throwOnRun) throw opts.throwOnRun
			if (opts.emitEvents && onEvent) {
				for (const ev of opts.emitEvents) onEvent(ev)
			}
			return (
				opts.outcome ?? {
					kind: "completed",
					taskId: "fake-task-1",
				}
			)
		},
	}
	return { runner, spy }
}

// ──────────────────────────────────────────────────────────────────────────────
// Test context builder — creates a synthetic AgentRunContext without the
// orchestrator. Captures emitted events for assertion.
// ──────────────────────────────────────────────────────────────────────────────

interface Captured {
	level: EventLevel
	type: EventType
	message: string
	data?: Record<string, unknown>
}

function makeCtx(overrides: {
	goal?: string
	safetyMode?: SafetyMode
	requiredCapabilities?: string[]
	maxIterations?: number
	payload?: Record<string, unknown>
	signal?: AbortSignal
} = {}): { ctx: AgentRunContext; emitted: Captured[] } {
	const emitted: Captured[] = []
	const task: Task = {
		id: "task_test_1",
		agent: "coder",
		goal: overrides.goal ?? "fix the login bug",
		priority: "normal",
		status: "running",
		requiredCapabilities: overrides.requiredCapabilities ?? [],
		payload: overrides.payload ?? {},
		maxIterations: overrides.maxIterations ?? 5,
		attempts: 1,
		createdAt: 1000,
		updatedAt: 1000,
		startedAt: 1000,
	}
	const ctx: AgentRunContext = {
		task,
		safetyMode: overrides.safetyMode ?? SafetyMode.AUTO,
		signal: overrides.signal ?? new AbortController().signal,
		emit: (level, type, message, data) => {
			emitted.push({ level, type, message, data })
		},
	}
	return { ctx, emitted }
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe("CoderAgent — basic identity", () => {
	it("declares stable name and description", () => {
		const { runner } = makeFakeRunner({})
		const a = new CoderAgent(runner)
		expect(a.name).toBe("coder")
		expect(a.description).toContain("Roo")
	})

	it("declares default required capabilities", () => {
		const { runner } = makeFakeRunner({})
		const a = new CoderAgent(runner)
		expect(a.requiredCapabilities).toEqual(["read.file", "write.file"])
	})

	it("honors custom modeSlug and baseCapabilities", () => {
		const { runner } = makeFakeRunner({})
		const a = new CoderAgent(runner, {
			modeSlug: "architect",
			baseCapabilities: ["read.file"],
		})
		expect(a.requiredCapabilities).toEqual(["read.file"])
	})
})

describe("CoderAgent — successful path", () => {
	let runner: RooTaskRunner
	let spy: FakeRunnerSpy

	beforeEach(() => {
		const f = makeFakeRunner({
			outcome: { kind: "completed", taskId: "roo-123" },
		})
		runner = f.runner
		spy = f.spy
	})

	it("returns ok=true on completion", async () => {
		const a = new CoderAgent(runner)
		const { ctx } = makeCtx()
		const r = await a.run(ctx)
		expect(r.ok).toBe(true)
		expect(r.summary).toContain("roo-123")
	})

	it("invokes the runner exactly once", async () => {
		const a = new CoderAgent(runner)
		const { ctx } = makeCtx()
		await a.run(ctx)
		expect(spy.calls).toHaveLength(1)
	})

	it("uses the 'code' mode by default", async () => {
		const a = new CoderAgent(runner)
		const { ctx } = makeCtx()
		await a.run(ctx)
		expect(spy.calls[0].mode).toBe("code")
	})

	it("forwards the task goal as the runner's text", async () => {
		const a = new CoderAgent(runner)
		const { ctx } = makeCtx({ goal: "refactor the auth module" })
		await a.run(ctx)
		expect(spy.calls[0].text).toBe("refactor the auth module")
	})
})

describe("CoderAgent — SafetyMode passthrough", () => {
	it("forwards the orchestrator's SafetyMode to the runner", async () => {
		const { runner, spy } = makeFakeRunner({})
		const a = new CoderAgent(runner)
		const { ctx } = makeCtx({ safetyMode: SafetyMode.SAFE })
		await a.run(ctx)
		expect(spy.calls[0].safetyMode).toBe(SafetyMode.SAFE)
	})

	it("forwards FULL_AUTONOMOUS unchanged", async () => {
		const { runner, spy } = makeFakeRunner({})
		const a = new CoderAgent(runner)
		const { ctx } = makeCtx({ safetyMode: SafetyMode.FULL_AUTONOMOUS })
		await a.run(ctx)
		expect(spy.calls[0].safetyMode).toBe(SafetyMode.FULL_AUTONOMOUS)
	})

	it("emits an info event with the safety mode for the dashboard", async () => {
		const { runner } = makeFakeRunner({})
		const a = new CoderAgent(runner)
		const { ctx, emitted } = makeCtx({ safetyMode: SafetyMode.AUTO })
		await a.run(ctx)
		const startedEvent = emitted.find((e) => e.message.includes("Coder Agent starting"))
		expect(startedEvent).toBeDefined()
		expect(startedEvent?.data).toMatchObject({ safetyMode: SafetyMode.AUTO })
	})
})

describe("CoderAgent — capability merging", () => {
	it("merges base capabilities with task-specific ones (de-duped)", async () => {
		const { runner, spy } = makeFakeRunner({})
		const a = new CoderAgent(runner, { baseCapabilities: ["read.file", "write.file"] })
		const { ctx } = makeCtx({ requiredCapabilities: ["write.file", "execute.command"] })
		await a.run(ctx)
		const sent = spy.calls[0].capabilities.sort()
		expect(sent).toEqual(["execute.command", "read.file", "write.file"])
	})
})

describe("CoderAgent — system-prompt overlay", () => {
	it("includes the agent preamble by default", async () => {
		const { runner, spy } = makeFakeRunner({})
		const a = new CoderAgent(runner)
		const { ctx } = makeCtx()
		await a.run(ctx)
		expect(spy.calls[0].systemPromptOverlay).toContain("Coder Agent")
		expect(spy.calls[0].systemPromptOverlay).toContain("Super Roo")
	})

	it("appends per-task overlay onto the agent preamble", async () => {
		const { runner, spy } = makeFakeRunner({})
		const a = new CoderAgent(runner)
		const { ctx } = makeCtx({
			payload: { systemPromptOverlay: "Use TypeScript strict mode for every change." },
		})
		await a.run(ctx)
		const overlay = spy.calls[0].systemPromptOverlay ?? ""
		expect(overlay).toContain("Coder Agent") // preamble
		expect(overlay).toContain("Use TypeScript strict mode") // per-task
		// Per-task overlay should appear AFTER preamble.
		expect(overlay.indexOf("Coder Agent")).toBeLessThan(overlay.indexOf("Use TypeScript"))
	})

	it("respects a fully custom preamble", async () => {
		const { runner, spy } = makeFakeRunner({})
		const a = new CoderAgent(runner, { systemPromptPreamble: "ROBOT MODE ACTIVATED" })
		const { ctx } = makeCtx()
		await a.run(ctx)
		expect(spy.calls[0].systemPromptOverlay).toBe("ROBOT MODE ACTIVATED")
	})
})

describe("CoderAgent — failure paths", () => {
	it("reports ok=false when runner reports failed", async () => {
		const { runner } = makeFakeRunner({
			outcome: { kind: "failed", taskId: "x", error: "model 503", toolName: "execute_command" },
		})
		const a = new CoderAgent(runner)
		const { ctx } = makeCtx()
		const r = await a.run(ctx)
		expect(r.ok).toBe(false)
		expect(r.error).toBe("model 503")
		expect(r.summary).toContain("execute_command")
	})

	it("reports failed without toolName when no tool was involved", async () => {
		const { runner } = makeFakeRunner({
			outcome: { kind: "failed", taskId: "x", error: "context window exceeded" },
		})
		const a = new CoderAgent(runner)
		const { ctx } = makeCtx()
		const r = await a.run(ctx)
		expect(r.ok).toBe(false)
		expect(r.summary).toContain("context window exceeded")
		expect(r.summary).not.toContain("during tool")
	})

	it("reports aborted (signal) when runner returns aborted with signal reason", async () => {
		const { runner } = makeFakeRunner({
			outcome: { kind: "aborted", taskId: "x", reason: "signal" },
		})
		const a = new CoderAgent(runner)
		const { ctx } = makeCtx()
		const r = await a.run(ctx)
		expect(r.ok).toBe(false)
		expect(r.error).toBe("aborted:signal")
	})

	it("reports aborted (user) when runner returns aborted with user reason", async () => {
		const { runner } = makeFakeRunner({
			outcome: { kind: "aborted", taskId: "x", reason: "user" },
		})
		const a = new CoderAgent(runner)
		const { ctx } = makeCtx()
		const r = await a.run(ctx)
		expect(r.error).toBe("aborted:user")
	})

	it("returns runner_not_ready and does not call run() when isReady=false", async () => {
		const { runner, spy } = makeFakeRunner({ ready: false })
		const a = new CoderAgent(runner)
		const { ctx } = makeCtx()
		const r = await a.run(ctx)
		expect(r.ok).toBe(false)
		expect(r.error).toBe("runner_not_ready")
		expect(spy.calls).toHaveLength(0)
	})

	it("catches setup errors thrown by the runner", async () => {
		const { runner } = makeFakeRunner({ throwOnRun: new Error("provider died") })
		const a = new CoderAgent(runner)
		const { ctx } = makeCtx()
		const r = await a.run(ctx)
		expect(r.ok).toBe(false)
		expect(r.error).toBe("provider died")
		expect(r.summary).toContain("setup error")
	})
})

describe("CoderAgent — runner event forwarding", () => {
	it("emits debug events for tool invocations", async () => {
		const { runner } = makeFakeRunner({
			emitEvents: [
				{ kind: "started", taskId: "r1" },
				{ kind: "tool.invoked", taskId: "r1", toolName: "read_file" },
			],
			outcome: { kind: "completed", taskId: "r1" },
		})
		const a = new CoderAgent(runner)
		const { ctx, emitted } = makeCtx()
		await a.run(ctx)
		expect(emitted.some((e) => e.level === "debug" && e.message.includes("read_file"))).toBe(true)
	})

	it("emits warn events for tool failures during a task", async () => {
		const { runner } = makeFakeRunner({
			emitEvents: [{ kind: "tool.failed", taskId: "r1", toolName: "execute_command", error: "ENOENT" }],
			outcome: { kind: "completed", taskId: "r1" },
		})
		const a = new CoderAgent(runner)
		const { ctx, emitted } = makeCtx()
		await a.run(ctx)
		const warn = emitted.find((e) => e.level === "warn")
		expect(warn?.message).toContain("execute_command")
		expect(warn?.message).toContain("ENOENT")
	})

	it("emits an info event for mode switches", async () => {
		const { runner } = makeFakeRunner({
			emitEvents: [{ kind: "mode.switched", taskId: "r1", from: "code", to: "debug" }],
			outcome: { kind: "completed", taskId: "r1" },
		})
		const a = new CoderAgent(runner)
		const { ctx, emitted } = makeCtx()
		await a.run(ctx)
		expect(emitted.some((e) => e.level === "info" && e.message.includes("debug"))).toBe(true)
	})
})

describe("CoderAgent — workspace override pass-through", () => {
	it("forwards workspacePathOverride from payload to the runner", async () => {
		const { runner, spy } = makeFakeRunner({})
		const a = new CoderAgent(runner)
		const { ctx } = makeCtx({ payload: { workspacePathOverride: "/tmp/some/repo" } })
		await a.run(ctx)
		expect(spy.calls[0].workspacePathOverride).toBe("/tmp/some/repo")
	})

	it("forwards undefined workspacePathOverride when payload doesn't set it", async () => {
		const { runner, spy } = makeFakeRunner({})
		const a = new CoderAgent(runner)
		const { ctx } = makeCtx()
		await a.run(ctx)
		expect(spy.calls[0].workspacePathOverride).toBeUndefined()
	})
})

describe("CoderAgent — abort signal pass-through", () => {
	it("forwards the AbortSignal to the runner", async () => {
		const { runner, spy } = makeFakeRunner({})
		const a = new CoderAgent(runner)
		const ac = new AbortController()
		const { ctx } = makeCtx({ signal: ac.signal })
		await a.run(ctx)
		expect(spy.calls[0].signal).toBe(ac.signal)
	})
})

describe("CoderAgent — maxIterations pass-through", () => {
	it("forwards the task's maxIterations to the runner", async () => {
		const { runner, spy } = makeFakeRunner({})
		const a = new CoderAgent(runner)
		const { ctx } = makeCtx({ maxIterations: 3 })
		await a.run(ctx)
		expect(spy.calls[0].maxIterations).toBe(3)
	})
})
