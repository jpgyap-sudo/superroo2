import { describe, expect, it } from "vitest"

import { TesterAgent } from "../TesterAgent"
import type { TestRequest, TestResult, TestRunner } from "../TestRunner"
import type { AgentRunContext, EventLevel, EventType, Task } from "../../types"
import { SafetyMode } from "../../types"

function makeFakeRunner(result: Partial<TestResult>): { runner: TestRunner; calls: TestRequest[] } {
	const calls: TestRequest[] = []
	const runner: TestRunner = {
		isReady: () => true,
		run: async (req) => {
			calls.push(req)
			return {
				kind: req.kind,
				command: req.command ?? "npm",
				args: req.args ?? ["test"],
				cwd: req.cwd ?? "/tmp",
				exitCode: 0,
				durationMs: 100,
				stdout: "",
				stderr: "",
				passed: true,
				timedOut: false,
				aborted: false,
				...result,
			}
		},
	}
	return { runner, calls }
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
		agent: "tester",
		goal: "Run the tests",
		priority: "normal",
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

describe("TesterAgent", () => {
	it("returns ok=true on green tests", async () => {
		const { runner } = makeFakeRunner({ passed: true })
		const a = new TesterAgent(runner)
		const r = await a.run(makeCtx().ctx)
		expect(r.ok).toBe(true)
		expect(r.summary).toContain("PASSED")
	})

	it("returns ok=false on red tests with exit code", async () => {
		const { runner } = makeFakeRunner({ passed: false, exitCode: 1 })
		const a = new TesterAgent(runner)
		const r = await a.run(makeCtx().ctx)
		expect(r.ok).toBe(false)
		expect(r.error).toBe("tests_failed:1")
	})

	it("reports timeout distinctly", async () => {
		const { runner } = makeFakeRunner({ passed: false, timedOut: true, exitCode: null })
		const a = new TesterAgent(runner)
		const r = await a.run(makeCtx().ctx)
		expect(r.summary).toContain("TIMED OUT")
	})

	it("uses the kind from payload", async () => {
		const { runner, calls } = makeFakeRunner({})
		const a = new TesterAgent(runner)
		await a.run(makeCtx({ kind: "lint" }).ctx)
		expect(calls[0].kind).toBe("lint")
	})

	it("uses defaultKind when payload omits kind", async () => {
		const { runner, calls } = makeFakeRunner({})
		const a = new TesterAgent(runner, { defaultKind: "typecheck" })
		await a.run(makeCtx().ctx)
		expect(calls[0].kind).toBe("typecheck")
	})

	it("forwards cwd, command, args", async () => {
		const { runner, calls } = makeFakeRunner({})
		const a = new TesterAgent(runner)
		await a.run(
			makeCtx({
				kind: "custom",
				cwd: "/repo",
				command: "deno",
				args: ["test", "--coverage"],
				timeoutMs: 1000,
			}).ctx,
		)
		expect(calls[0].cwd).toBe("/repo")
		expect(calls[0].command).toBe("deno")
		expect(calls[0].args).toEqual(["test", "--coverage"])
		expect(calls[0].timeoutMs).toBe(1000)
	})

	it("returns runner_not_ready without invoking", async () => {
		const runner: TestRunner = {
			isReady: () => false,
			run: async () => {
				throw new Error("should not be called")
			},
		}
		const a = new TesterAgent(runner)
		const r = await a.run(makeCtx().ctx)
		expect(r.error).toBe("runner_not_ready")
	})

	it("emits an info event for green and error event for red", async () => {
		const { runner } = makeFakeRunner({ passed: false, exitCode: 1 })
		const a = new TesterAgent(runner)
		const { ctx, emitted } = makeCtx()
		await a.run(ctx)
		const errorEvent = emitted.find((e) => e.level === "error")
		expect(errorEvent).toBeDefined()
		expect(errorEvent?.message).toContain("FAILED")
	})
})
