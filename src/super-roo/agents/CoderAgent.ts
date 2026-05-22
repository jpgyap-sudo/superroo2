/**
 * Super Roo — Coder Agent (headless).
 *
 * Implements Super Roo's `Agent` contract by handing the work off to Roo's
 * existing Task loop via a {@link RooTaskRunner}. The agent itself adds
 * almost no logic — that's the point. Roo already knows how to write code;
 * we just give it the right mode, prompt overlay, and capability gating.
 *
 * Modes (inspired by Eclipse Theia's CoderAgent):
 *   - "edit":      Quick targeted edits. Minimal preamble, no planning.
 *   - "agent":     Full autonomous coding with planning and iteration.
 *   - "agent-next": Advanced agent mode with enhanced tool access.
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

import type {
	Agent,
	AgentMode,
	AgentRunContext,
	AgentRunResult,
	Capability,
	PromptVariant,
	PromptVariantSet,
} from "../types"
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

// ── Mode definitions (Theia-inspired) ──────────────────────────────────────

const CODER_MODES: AgentMode[] = [
	{
		id: "edit",
		name: "Edit Mode",
		description: "Quick targeted edits. Minimal preamble, no planning.",
		modeSlug: "code",
		promptVariantId: "edit",
		capabilities: ["read.file", "write.file"],
		canModifyFiles: true,
	},
	{
		id: "agent",
		name: "Agent Mode",
		description: "Full autonomous coding with planning and iteration.",
		modeSlug: "code",
		promptVariantId: "agent",
		capabilities: ["read.file", "write.file", "execute.command", "git.commit"],
		canModifyFiles: true,
	},
	{
		id: "agent-next",
		name: "Agent Mode (Next)",
		description: "Advanced agent mode with enhanced tool access and extended iteration limits.",
		modeSlug: "code",
		promptVariantId: "agent-next",
		capabilities: ["read.file", "write.file", "execute.command", "git.commit", "git.push", "network.crawl"],
		canModifyFiles: true,
	},
]

// ── Prompt variants (Theia-inspired PromptVariantSet) ──────────────────────

const EDIT_VARIANT: PromptVariant = {
	id: "edit",
	name: "Edit",
	description: "Quick targeted edits with minimal preamble.",
	systemPrompt: `You are the Coder Agent inside Super Roo, operating in Edit Mode.
Make minimal, targeted changes. Do not refactor unrelated code.
Always summarize what you changed at the end.`,
	label: "Quick Edit",
}

const AGENT_VARIANT: PromptVariant = {
	id: "agent",
	name: "Agent",
	description: "Full autonomous coding with planning and iteration.",
	systemPrompt: `You are the Coder Agent inside Super Roo, an autonomous multi-agent loop.
You operate on the user's open workspace. You are not editing Super Roo itself
unless explicit self-improve mode is on (in which case the orchestrator has
already validated the boundary).

Honor the safety mode the orchestrator passes you:
- SAFE: read and analyze only, do not modify files.
- AUTO: edit, run tests, and commit. Do not push to production.
- FULL_AUTONOMOUS: edits, tests, commits, and deploys are allowed.

Always summarize what you changed at the end so the orchestrator can record it.`,
	label: "Full Agent",
}

const AGENT_NEXT_VARIANT: PromptVariant = {
	id: "agent-next",
	name: "Agent Next",
	description: "Advanced agent mode with enhanced tool access and extended iteration limits.",
	systemPrompt: `You are the Coder Agent inside Super Roo, operating in Agent Mode (Next).
You have access to advanced tools including network operations and git push.
You operate on the user's open workspace.

Honor the safety mode the orchestrator passes you:
- SAFE: read and analyze only, do not modify files.
- AUTO: edit, run tests, and commit. Do not push to production.
- FULL_AUTONOMOUS: edits, tests, commits, and deploys are allowed.

You may use network tools for research and git push for deployment.
Always summarize what you changed at the end.`,
	label: "Agent Next",
}

const CODER_PROMPT_VARIANTS: PromptVariantSet = {
	id: "coder",
	name: "Coder Agent",
	description: "Prompt variants for the Coder Agent.",
	defaultVariant: "agent",
	variants: [EDIT_VARIANT, AGENT_VARIANT, AGENT_NEXT_VARIANT],
}

// ── Default preamble (used when no variant is selected) ────────────────────

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
	readonly promptVariants: PromptVariantSet[] = [CODER_PROMPT_VARIANTS]
	readonly modes: AgentMode[] = CODER_MODES
	readonly tags: string[] = ["coding", "implementation", "edit"]

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

	/**
	 * Resolve the effective mode slug and prompt based on the active mode ID.
	 */
	private resolveMode(ctx: AgentRunContext): { modeSlug: string; prompt: string } {
		const activeModeId = ctx.activeModeId ?? "agent"
		const mode = CODER_MODES.find((m) => m.id === activeModeId)
		const modeSlug = mode?.modeSlug ?? this.modeSlug

		// If a custom preamble was provided (not the default), use it as the prompt
		// regardless of mode variants. This preserves backward compatibility for
		// callers that pass a custom systemPromptPreamble.
		if (this.preamble !== DEFAULT_PREAMBLE) {
			return { modeSlug, prompt: this.preamble }
		}

		// Resolve prompt from variant or fall back to preamble
		if (mode?.promptVariantId) {
			const variant = CODER_PROMPT_VARIANTS.variants.find((v) => v.id === mode.promptVariantId)
			if (variant) {
				return { modeSlug, prompt: variant.systemPrompt }
			}
		}

		return { modeSlug, prompt: this.preamble }
	}

	async run(ctx: AgentRunContext): Promise<AgentRunResult> {
		if (!this.runner.isReady()) {
			return {
				ok: false,
				summary: "Coder Agent: Roo Task runner is not ready (provider not initialized).",
				error: "runner_not_ready",
			}
		}

		const { modeSlug, prompt } = this.resolveMode(ctx)

		ctx.emit("info", "agent.invoked", `Coder Agent starting: ${ctx.task.goal}`, {
			mode: modeSlug,
			activeModeId: ctx.activeModeId ?? "agent",
			safetyMode: ctx.safetyMode,
		})

		// Merge the agent's base capabilities with whatever the specific task
		// declared. The host's RooApprovalAdapter uses the union to decide
		// which Roo flags to flip.
		const capabilities = Array.from(
			new Set<Capability>([...this.requiredCapabilities, ...ctx.task.requiredCapabilities]),
		)

		// Caller-supplied overlay (per task) is appended to our resolved prompt.
		const taskOverlay = typeof ctx.task.payload?.systemPromptOverlay === "string"
			? (ctx.task.payload.systemPromptOverlay as string)
			: ""
		const systemPromptOverlay = taskOverlay ? `${prompt}\n\n${taskOverlay}` : prompt

		const workspacePathOverride =
			typeof ctx.task.payload?.workspacePathOverride === "string"
				? (ctx.task.payload.workspacePathOverride as string)
				: undefined

		try {
			const outcome = await this.runner.run(
				{
					mode: modeSlug,
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
					// EventLog so the dashboard can show progress.
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
