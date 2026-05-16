/**
 * Super Roo — Tester Agent (headless).
 *
 * Runs tests for the user's project via the host's TestRunner. Decides which
 * kind of test to run based on the task's payload (kind: "unit" | "lint" |
 * "typecheck" | "e2e" | "custom"). Returns a structured AgentRunResult so the
 * orchestrator can react: queue a Debugger task on failure, mark a feature
 * as healthy on success, etc.
 *
 * Tester Agent does NOT use Roo's Task loop — there's nothing for an LLM to do
 * here; we just spawn a subprocess. This is the first agent that depends on
 * the host's TestRunner instead of the RooTaskRunner.
 */

import type { Agent, AgentRunContext, AgentRunResult, Capability } from "../types"
import type { TestKind, TestRunner } from "./TestRunner"

export interface TesterAgentOptions {
	/** Default kind if the task doesn't specify one. */
	defaultKind?: TestKind
	/** Default timeout (ms). */
	defaultTimeoutMs?: number
}

export class TesterAgent implements Agent {
	readonly name = "tester"
	readonly description = "Runs project tests (npm test / pytest / playwright) via the host TestRunner."
	readonly requiredCapabilities: Capability[] = ["execute.command"]

	private readonly defaultKind: TestKind
	private readonly defaultTimeoutMs: number

	constructor(
		private readonly runner: TestRunner,
		opts: TesterAgentOptions = {},
	) {
		this.defaultKind = opts.defaultKind ?? "unit"
		this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 600_000
	}

	async run(ctx: AgentRunContext): Promise<AgentRunResult> {
		if (!this.runner.isReady()) {
			return { ok: false, summary: "Tester: runner not ready", error: "runner_not_ready" }
		}

		const payload = ctx.task.payload ?? {}
		const kind = (typeof payload.kind === "string" ? payload.kind : this.defaultKind) as TestKind
		const cwd = typeof payload.cwd === "string" ? payload.cwd : undefined
		const command = typeof payload.command === "string" ? payload.command : undefined
		const args = Array.isArray(payload.args) ? (payload.args as string[]) : undefined
		const timeoutMs = typeof payload.timeoutMs === "number" ? payload.timeoutMs : this.defaultTimeoutMs

		ctx.emit("info", "agent.invoked", `Tester running ${kind} tests`, { data: { kind, cwd } })

		try {
			const result = await this.runner.run({
				kind,
				cwd,
				command,
				args,
				timeoutMs,
				signal: ctx.signal,
			})

			// Persist a brief test-result event for the dashboard.
			const summaryLine = result.passed
				? `${kind} tests PASSED in ${result.durationMs}ms`
				: result.timedOut
					? `${kind} tests TIMED OUT after ${result.durationMs}ms`
					: result.aborted
						? `${kind} tests ABORTED`
						: `${kind} tests FAILED (exit ${result.exitCode}) in ${result.durationMs}ms`

			ctx.emit(
				result.passed ? "info" : "error",
				"agent.completed",
				summaryLine,
				{
					data: {
						kind,
						passed: result.passed,
						timedOut: result.timedOut,
						aborted: result.aborted,
						exitCode: result.exitCode,
						durationMs: result.durationMs,
						// Truncate output so the events table doesn't bloat.
						stdoutTail: result.stdout.slice(-2000),
						stderrTail: result.stderr.slice(-2000),
					},
				},
			)

			return {
				ok: result.passed,
				summary: summaryLine,
				error: result.passed ? undefined : `tests_failed:${result.exitCode ?? "null"}`,
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			return { ok: false, summary: `Tester: setup error — ${msg}`, error: msg }
		}
	}
}
