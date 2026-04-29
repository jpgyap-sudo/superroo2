/**
 * Super Roo — Debugger Agent (headless).
 *
 * Responsibilities:
 *   - Take an error report (from a tester run, user, or upstream agent)
 *   - Persist a Bug record via BugRegistry
 *   - Run Roo's `"debug"` mode to investigate root cause
 *   - Queue a Coder follow-up task to apply the fix (if proposed)
 *
 * Inputs (via task.payload):
 *   - errorMessage: string             — the user-visible error
 *   - stackTrace?: string              — optional, helps localize
 *   - filesLikelyInvolved?: string[]   — optional hints
 *   - featureId?: string               — link bug to a feature
 *   - severity?: BugSeverity           — caller can override default ("medium")
 *
 * The agent itself doesn't apply the fix — it records the diagnosis and queues
 * a Coder task. This separation matches the "single responsibility" rule and
 * makes the orchestrator's loop visible: PM plans, Debugger diagnoses, Coder
 * implements, Tester verifies.
 */

import type { Agent, AgentRunContext, AgentRunResult, Capability, BugSeverity, TaskInputRaw } from "../types"
import type { BugRegistry } from "../bugs/BugRegistry"
import type { RooTaskRunner } from "./RooTaskAdapter"

export interface DebuggerAgentOptions {
	modeSlug?: string
	systemPromptPreamble?: string
}

const DEFAULT_PREAMBLE = `You are the Debugger Agent inside Super Roo.

You receive a bug report. Your job is to investigate the root cause, NOT
fix the code. Use file reads, ripgrep searches, and tree-sitter queries to
locate the source of the problem.

When you have a hypothesis, output:
- ROOT CAUSE: <one sentence>
- FILES TO CHANGE: <comma-separated paths>
- RECOMMENDED FIX: <one paragraph, no code unless trivial>
- DEPLOYMENT RISK: low | medium | high | critical

Do not write or edit any code. The Coder Agent handles that.`

export class DebuggerAgent implements Agent {
	readonly name = "debugger"
	readonly description = "Diagnoses bugs by running Roo's debug mode. Records BugRecord and queues Coder fix."
	readonly requiredCapabilities: Capability[] = ["read.file"]

	private readonly modeSlug: string
	private readonly preamble: string

	constructor(
		private readonly runner: RooTaskRunner,
		private readonly bugs: BugRegistry,
		opts: DebuggerAgentOptions = {},
	) {
		this.modeSlug = opts.modeSlug ?? "debug"
		this.preamble = opts.systemPromptPreamble ?? DEFAULT_PREAMBLE
	}

	async run(ctx: AgentRunContext): Promise<AgentRunResult> {
		if (!this.runner.isReady()) {
			return { ok: false, summary: "Debugger: runner not ready", error: "runner_not_ready" }
		}

		const payload = ctx.task.payload ?? {}
		const errorMessage = typeof payload.errorMessage === "string" ? payload.errorMessage : ctx.task.goal
		const stackTrace = typeof payload.stackTrace === "string" ? payload.stackTrace : undefined
		const filesHint = Array.isArray(payload.filesLikelyInvolved)
			? (payload.filesLikelyInvolved as string[])
			: []
		const severity = (typeof payload.severity === "string" ? payload.severity : "medium") as BugSeverity
		const featureId = typeof payload.featureId === "string" ? payload.featureId : undefined

		// 1. Record the bug *first*. We always want a paper trail even if Roo
		//    fails to investigate.
		const bug = this.bugs.create({
			title: errorMessage.slice(0, 120),
			severity,
			status: "investigating",
			featureId,
			symptoms: [errorMessage, ...(stackTrace ? [stackTrace] : [])],
			filesLikelyInvolved: filesHint,
		})

		// 2. Compose the diagnosis prompt for Roo's debug mode.
		const investigationText = [
			`Error: ${errorMessage}`,
			stackTrace ? `\nStack trace:\n${stackTrace}` : "",
			filesHint.length ? `\nFiles likely involved: ${filesHint.join(", ")}` : "",
			`\nBug ID: ${bug.id}`,
		]
			.filter(Boolean)
			.join("")

		try {
			const outcome = await this.runner.run(
				{
					mode: this.modeSlug,
					text: investigationText,
					capabilities: this.requiredCapabilities,
					safetyMode: ctx.safetyMode,
					systemPromptOverlay: this.preamble,
					maxIterations: ctx.task.maxIterations,
					signal: ctx.signal,
				},
				(ev) => {
					if (ev.kind === "tool.failed") {
						ctx.emit("warn", "agent.invoked", `Debugger tool failed: ${ev.toolName}`, {
							toolName: ev.toolName,
						})
					}
				},
			)

			if (outcome.kind !== "completed") {
				// Mark bug as blocked for now; orchestrator may retry later.
				this.bugs.update(bug.id, { status: "blocked" })
				return {
					ok: false,
					summary: `Debugger: investigation ${outcome.kind} for bug ${bug.id}`,
					error:
						outcome.kind === "aborted"
							? `aborted:${outcome.reason}`
							: outcome.error,
				}
			}

			// Diagnosis succeeded. Queue a Coder follow-up to apply the fix.
			// The Coder agent reads the bug record for context.
			const followups: TaskInputRaw[] = [
				{
					agent: "coder",
					goal: `Apply fix for bug ${bug.id}: ${bug.title}`,
					priority: ctx.task.priority,
					bugId: bug.id,
					featureId,
					requiredCapabilities: ["read.file", "write.file"],
					payload: {
						systemPromptOverlay: `You are applying the fix proposed in debug task ${outcome.taskId} for bug ${bug.id}. Make minimal targeted changes.`,
					},
				},
			]

			return {
				ok: true,
				summary: `Debugger: bug ${bug.id} diagnosed; queued Coder fix task.`,
				followups,
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			this.bugs.update(bug.id, { status: "blocked" })
			return { ok: false, summary: `Debugger: setup error — ${msg}`, error: msg }
		}
	}
}
