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
 *
 * Modes (inspired by Eclipse Theia's ArchitectAgent):
 *   - "plan":       Lightweight investigation. Quick scan, minimal output.
 *   - "simple":     Standard investigation with structured output.
 *   - "deep":       Deep investigation with full stack trace analysis.
 */

import type {
	Agent,
	AgentMode,
	AgentRunContext,
	AgentRunResult,
	Capability,
	BugSeverity,
	PromptVariant,
	PromptVariantSet,
	TaskInputRaw,
} from "../types"
import type { BugRegistry } from "../bugs/BugRegistry"
import type { RooTaskRunner } from "./RooTaskAdapter"

export interface DebuggerAgentOptions {
	modeSlug?: string
	systemPromptPreamble?: string
}

// ── Mode definitions (Theia-inspired) ──────────────────────────────────────

const DEBUGGER_MODES: AgentMode[] = [
	{
		id: "plan",
		name: "Plan Mode",
		description: "Lightweight investigation. Quick scan, minimal output.",
		modeSlug: "debug",
		promptVariantId: "plan",
		capabilities: ["read.file"],
		canModifyFiles: false,
	},
	{
		id: "simple",
		name: "Simple Mode",
		description: "Standard investigation with structured output.",
		modeSlug: "debug",
		promptVariantId: "simple",
		capabilities: ["read.file"],
		canModifyFiles: false,
	},
	{
		id: "deep",
		name: "Deep Mode",
		description: "Deep investigation with full stack trace analysis and multi-file correlation.",
		modeSlug: "debug",
		promptVariantId: "deep",
		capabilities: ["read.file", "execute.command"],
		canModifyFiles: false,
	},
]

// ── Prompt variants ────────────────────────────────────────────────────────

const PLAN_VARIANT: PromptVariant = {
	id: "plan",
	name: "Plan",
	description: "Quick scan of the error surface.",
	systemPrompt: `You are the Debugger Agent inside Super Roo, operating in Plan Mode.

Quickly scan the error and identify the most likely file and line.
Output in this format:
- ROOT CAUSE: <one sentence>
- FILE: <path>
- RISK: low | medium | high | critical

Do not write or edit any code.`,
	label: "Quick Scan",
}

const SIMPLE_VARIANT: PromptVariant = {
	id: "simple",
	name: "Simple",
	description: "Standard investigation with structured output.",
	systemPrompt: `You are the Debugger Agent inside Super Roo.

You receive a bug report. Your job is to investigate the root cause, NOT
fix the code. Use file reads, ripgrep searches, and tree-sitter queries to
locate the source of the problem.

When you have a hypothesis, output:
- ROOT CAUSE: <one sentence>
- FILES TO CHANGE: <comma-separated paths>
- RECOMMENDED FIX: <one paragraph, no code unless trivial>
- DEPLOYMENT RISK: low | medium | high | critical

Do not write or edit any code. The Coder Agent handles that.`,
	label: "Standard",
}

const DEEP_VARIANT: PromptVariant = {
	id: "deep",
	name: "Deep",
	description: "Deep investigation with full stack trace analysis.",
	systemPrompt: `You are the Debugger Agent inside Super Roo, operating in Deep Mode.

You receive a bug report with full stack trace. Your job is to:
1. Trace the error through the call stack
2. Identify all files involved in the failure path
3. Determine the root cause with high confidence
4. Propose a specific fix with code examples

Use file reads, ripgrep searches, and tree-sitter queries to correlate
multiple files. You may run commands to reproduce the issue.

Output:
- ROOT CAUSE: <one sentence>
- CALL CHAIN: <file:line → file:line → ...>
- FILES TO CHANGE: <comma-separated paths>
- RECOMMENDED FIX: <detailed paragraph with code snippets>
- DEPLOYMENT RISK: low | medium | high | critical
- CONFIDENCE: <percentage>

Do not write or edit any code. The Coder Agent handles that.`,
	label: "Deep Investigation",
}

const DEBUGGER_PROMPT_VARIANTS: PromptVariantSet = {
	id: "debugger",
	name: "Debugger Agent",
	description: "Prompt variants for the Debugger Agent.",
	defaultVariant: "simple",
	variants: [PLAN_VARIANT, SIMPLE_VARIANT, DEEP_VARIANT],
}

// ── Default preamble ───────────────────────────────────────────────────────

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
	readonly promptVariants: PromptVariantSet[] = [DEBUGGER_PROMPT_VARIANTS]
	readonly modes: AgentMode[] = DEBUGGER_MODES
	readonly tags: string[] = ["debugging", "diagnosis", "investigation"]

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

	/**
	 * Resolve the effective mode slug and prompt based on the active mode ID.
	 */
	private resolveMode(ctx: AgentRunContext): { modeSlug: string; prompt: string } {
		const activeModeId = ctx.activeModeId ?? "simple"
		const mode = DEBUGGER_MODES.find((m) => m.id === activeModeId)
		const modeSlug = mode?.modeSlug ?? this.modeSlug

		if (mode?.promptVariantId) {
			const variant = DEBUGGER_PROMPT_VARIANTS.variants.find((v) => v.id === mode.promptVariantId)
			if (variant) {
				return { modeSlug, prompt: variant.systemPrompt }
			}
		}

		return { modeSlug, prompt: this.preamble }
	}

	async run(ctx: AgentRunContext): Promise<AgentRunResult> {
		if (!this.runner.isReady()) {
			return { ok: false, summary: "Debugger: runner not ready", error: "runner_not_ready" }
		}

		const { modeSlug, prompt } = this.resolveMode(ctx)

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
					mode: modeSlug,
					text: investigationText,
					capabilities: this.requiredCapabilities,
					safetyMode: ctx.safetyMode,
					systemPromptOverlay: prompt,
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
