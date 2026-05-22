/**
 * Super Roo — Product Manager Agent (headless).
 *
 * Responsibilities:
 *   - Read feature health from FeatureRegistry
 *   - Take a high-level "build feature X" goal and decompose it into smaller
 *     concrete tasks (typically Coder Agent tasks)
 *   - Update feature status as work progresses (planned → building → testing → working/broken)
 *
 * Like CoderAgent, this agent uses Roo's Task loop — but in `"architect"` mode,
 * which is Roo's planning-oriented mode. The PM doesn't directly write code; it
 * produces a plan and emits follow-up tasks for the Coder.
 *
 * Phase 2.5 keeps the PM simple: it reads the goal, runs a planning task in
 * Roo, and either marks the feature as building or returns a plan summary.
 * Future phases may add iterative re-planning.
 */

import type { Agent, AgentRunContext, AgentRunResult, Capability, TaskInputRaw } from "../types"
import type { RooTaskRunner } from "./RooTaskAdapter"
import type { FeatureRegistry } from "../features/FeatureRegistry"

export interface PmAgentOptions {
	modeSlug?: string
	systemPromptPreamble?: string
}

const DEFAULT_PREAMBLE = `You are the Product Manager Agent inside Super Roo.

Your job is to take a feature request, analyze it, and produce a clear plan
for the Coder Agent to execute. You do NOT write code yourself.

Output a numbered plan of small, concrete steps. Each step should be a single
task the Coder Agent can complete in one Roo task run. Identify the files most
likely to change.

If the feature already exists in the registry, read its current status and
related files first. If you discover the feature is broken (rather than
missing), report that — do not silently start a rebuild.

End with: "PLAN COMPLETE — N steps".`

export class PmAgent implements Agent {
	readonly name = "product-manager"
	readonly description = "Decomposes feature goals into Coder tasks. Drives FeatureRegistry."
	readonly requiredCapabilities: Capability[] = ["read.file"]
	readonly tags: string[] = ["planning", "management", "architecture"]

	private readonly modeSlug: string
	private readonly preamble: string

	constructor(
		private readonly runner: RooTaskRunner,
		private readonly features: FeatureRegistry,
		opts: PmAgentOptions = {},
	) {
		this.modeSlug = opts.modeSlug ?? "architect"
		this.preamble = opts.systemPromptPreamble ?? DEFAULT_PREAMBLE
	}

	async run(ctx: AgentRunContext): Promise<AgentRunResult> {
		if (!this.runner.isReady()) {
			return { ok: false, summary: "PM Agent: runner not ready", error: "runner_not_ready" }
		}

		// Identify or create the feature this run is about.
		const featureName =
			typeof ctx.task.payload?.featureName === "string" ? (ctx.task.payload.featureName as string) : ctx.task.goal

		let feature = this.features.getByName(featureName)
		if (!feature) {
			feature = this.features.create({
				name: featureName,
				description: ctx.task.goal,
				ownerAgent: "product-manager",
				status: "planned",
				priority: ctx.task.priority,
			})
			ctx.emit("info", "feature.created", `PM created feature: ${featureName}`, {
				featureId: feature.id,
			})
		} else if (feature.status === "deprecated") {
			return {
				ok: false,
				summary: `PM Agent: feature '${featureName}' is deprecated - skipping rebuild. Remove the deprecated status first to re-enable.`,
				error: "feature_deprecated",
			}
		}

		// Mark the feature as building.
		this.features.update(feature.id, { status: "building" })

		// Compose context for the planning task.
		const featureContext = `
Feature: ${feature.name}
Current status: ${feature.status}
Current health: ${feature.health}
Related files: ${feature.relatedFiles.join(", ") || "(none recorded)"}
Prior fix attempts: ${feature.fixAttempts}
`.trim()

		const planText = `${ctx.task.goal}\n\nContext:\n${featureContext}`

		try {
			const outcome = await this.runner.run(
				{
					mode: this.modeSlug,
					text: planText,
					capabilities: this.requiredCapabilities,
					safetyMode: ctx.safetyMode,
					systemPromptOverlay: this.preamble,
					maxIterations: ctx.task.maxIterations,
					signal: ctx.signal,
				},
				(ev) => {
					if (ev.kind === "tool.failed") {
						ctx.emit("warn", "agent.invoked", `PM tool failed: ${ev.toolName}: ${ev.error}`, {
							toolName: ev.toolName,
						})
					}
				},
			)

			if (outcome.kind !== "completed") {
				const reason =
					outcome.kind === "aborted"
						? `aborted:${outcome.reason}`
						: outcome.error
				return {
					ok: false,
					summary: `PM Agent: planning ${outcome.kind}`,
					error: reason,
				}
			}

			// PM successfully produced a plan. Emit a follow-up Coder task with the
			// feature linkage so its work is tied back. The Coder Agent's prompt
			// already handles "do this concrete change."
			const followups: TaskInputRaw[] = [
				{
					agent: "coder",
					goal: `Implement the plan for feature: ${feature.name}`,
					priority: ctx.task.priority,
					featureId: feature.id,
					requiredCapabilities: ["read.file", "write.file", "execute.command"],
					payload: {
						systemPromptOverlay: `Refer to the planning task ${outcome.taskId} for the agreed plan. Implement step by step.`,
					},
				},
			]

			return {
				ok: true,
				summary: `PM Agent: plan complete for ${feature.name}; queued Coder follow-up.`,
				followups,
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			return { ok: false, summary: `PM Agent: setup error — ${msg}`, error: msg }
		}
	}
}
