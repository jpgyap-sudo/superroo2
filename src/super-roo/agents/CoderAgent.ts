/**
 * Super Roo — Coder Agent (headless).
 *
 * Implements Super Roo's `Agent` contract by handing the work off to Roo's
 * existing Task loop via a {@link RooTaskRunner}. The agent itself adds
 * almost no logic — that's the point. Roo already knows how to write code;
 * we just give it the right mode, prompt overlay, and capability gating.
 *
 * Mode: Roo's built-in `"code"` mode. We do not invent new modes here;
 * Phase 2.5/3 may register custom modes later.
 *
 * What this file is NOT:
 *   - It is not where Roo's Task loop is invoked. That's the runner.
 *   - It is not where auto-approval flags are translated. That's the host's
 *     {@link RooApprovalAdapter}.
 *   - It is not aware of `vscode` or `ClineProvider`. Headless rule.
 *
 * Constructor takes a runner so tests can inject a fake. See
 * `__tests__/CoderAgent.test.ts`.
 */

import type { Agent, AgentRunContext, AgentRunResult, Capability } from "../types"
import type { RooTaskRunner } from "./RooTaskAdapter"

export interface CoderAgentOptions {
	/**
	 * Roo mode slug. Defaults to "code". Override only if a custom mode is
	 * registered (e.g. a future self-improve mode that locks down certain
	 * tools).
	 */
	modeSlug?: string

	/**
	 * Extra system-prompt overlay appended to whatever the agent sends per-task.
	 * Use sparingly — most prompt content should be per-task.
	 */
	systemPromptPreamble?: string

	/**
	 * Capabilities every Coder task implicitly needs. Merged with the
	 * task's `requiredCapabilities` at dispatch time.
	 */
	baseCapabilities?: Capability[]
}

const DEFAULT_PREAMBLE = `You are the Coder Agent inside Super Roo, an autonomous multi-agent loop.
You operate on the user's open workspace. You are not editing Super Roo itself
unless explicit self-improve mode is on (in which case the orchestrator has
already validated the boundary).

Honor the safety mode the orchestrator passes you:
- SAFE: read and analyze only, do not modify files.
- AUTO: edit, run tests, and commit. Do not push to production.
- FULL_AUTONOMOUS: edits, tests, commits, and deploys are allowed.

Always summarize what you changed at the end so the orchestrator can record it.`

export class CoderAgent implements Agent {
	readonly name = "coder"
	readonly description = "Writes and edits code by driving Roo's Task loop in 'code' mode."
	readonly requiredCapabilities: Capability[]

	private readonly modeSlug: string
	private readonly preamble: string

	constructor(
		private readonly runner: RooTaskRunner,
		opts: CoderAgentOptions = {},
	) {
		this.modeSlug = opts.modeSlug ?? "code"
		this.preamble = opts.systemPromptPreamble ?? DEFAULT_PREAMBLE
		this.requiredCapabilities = opts.baseCapabilities ?? ["read.file", "write.file"]
	}

	async run(ctx: AgentRunContext): Promise<AgentRunResult> {
		if (!this.runner.isReady()) {
			return {
				ok: false,
				summary: "Coder Agent: Roo Task runner is not ready (provider not initialized).",
				error: "runner_not_ready",
			}
		}

		ctx.emit("info", "agent.invoked", `Coder Agent starting: ${ctx.task.goal}`, {
			mode: this.modeSlug,
			safetyMode: ctx.safetyMode,
		})

		// Merge the agent's base capabilities with whatever the specific task
		// declared. The host's RooApprovalAdapter uses the union to decide
		// which Roo flags to flip.
		const capabilities = Array.from(
			new Set<Capability>([...this.requiredCapabilities, ...ctx.task.requiredCapabilities]),
		)

		// Caller-supplied overlay (per task) is appended to our agent preamble.
		// We keep them clearly separated so Phase 2.5+ can refactor.
		const taskOverlay = typeof ctx.task.payload?.systemPromptOverlay === "string"
			? (ctx.task.payload.systemPromptOverlay as string)
			: ""
		const systemPromptOverlay = taskOverlay ? `${this.preamble}\n\n${taskOverlay}` : this.preamble

		const workspacePathOverride =
			typeof ctx.task.payload?.workspacePathOverride === "string"
				? (ctx.task.payload.workspacePathOverride as string)
				: undefined

		try {
			const outcome = await this.runner.run(
				{
					mode: this.modeSlug,
					text: ctx.task.goal,
					capabilities,
					safetyMode: ctx.safetyMode,
					systemPromptOverlay,
					maxIterations: ctx.task.maxIterations,
					workspacePathOverride,
					signal: ctx.signal,
				},
				(ev) => {
					// Forward selected Roo Task events into the orchestrator's
					// EventLog so the dashboard (Phase 3) can show progress.
					switch (ev.kind) {
						case "started":
							ctx.emit("debug", "agent.invoked", `Roo task started: ${ev.taskId}`, { rooTaskId: ev.taskId })
							break
						case "tool.invoked":
							ctx.emit("debug", "agent.invoked", `Tool: ${ev.toolName}`, { rooTaskId: ev.taskId, toolName: ev.toolName })
							break
						case "tool.failed":
							ctx.emit("warn", "agent.invoked", `Tool failed: ${ev.toolName}: ${ev.error}`, {
								rooTaskId: ev.taskId,
								toolName: ev.toolName,
							})
							break
						case "mode.switched":
							ctx.emit("info", "agent.invoked", `Roo mode: ${ev.from} → ${ev.to}`, {
								rooTaskId: ev.taskId,
							})
							break
						// "message", "completed", "aborted" are summarized by the outcome,
						// no need to double-emit.
					}
				},
			)

			return this.outcomeToResult(outcome)
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			return {
				ok: false,
				summary: `Coder Agent: setup error — ${msg}`,
				error: msg,
			}
		}
	}

	private outcomeToResult(outcome: Awaited<ReturnType<RooTaskRunner["run"]>>): AgentRunResult {
		switch (outcome.kind) {
			case "completed":
				return {
					ok: true,
					summary: `Coder Agent completed Roo task ${outcome.taskId}.`,
				}
			case "aborted":
				return {
					ok: false,
					summary: `Coder Agent aborted (${outcome.reason}).`,
					error: `aborted:${outcome.reason}`,
				}
			case "failed":
				return {
					ok: false,
					summary: outcome.toolName
						? `Coder Agent failed during tool ${outcome.toolName}: ${outcome.error}`
						: `Coder Agent failed: ${outcome.error}`,
					error: outcome.error,
				}
		}
	}
}
