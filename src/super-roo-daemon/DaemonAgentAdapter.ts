/**
 * DaemonAgentAdapter — Wraps the orchestrator's task submission as an Agent
 * so the UnifiedTaskRouter / CentralBrain can route through it.
 *
 * The daemon cannot create full Agent instances (CoderAgent, DebuggerAgent, etc.)
 * because they require a RooTaskRunner which only exists in the VS Code host.
 * Instead, this adapter:
 *   1. Implements the Agent interface minimally (name, description, capabilities)
 *   2. Delegates actual execution to the orchestrator's task queue
 *   3. Returns a result indicating the task was queued
 *
 * This allows the CentralBrain to:
 *   - Route to the correct agent
 *   - Query RAG memory before execution
 *   - Save experience after execution
 *   - Log all actions
 *
 * While the orchestrator handles the actual task execution.
 */

import type { Agent, AgentRunContext, AgentRunResult, Capability } from "../super-roo/types"
import type { SuperRooOrchestrator } from "../super-roo"
import { parseTaskSubmission } from "../core/SuperRooTask"

export interface DaemonAgentAdapterOptions {
	name: string
	description: string
	modeSlug: string
	capabilities?: Capability[]
}

/**
 * A lightweight Agent implementation for the daemon that delegates
 * execution to the orchestrator's task queue.
 */
export class DaemonAgentAdapter implements Agent {
	readonly name: string
	readonly description: string
	readonly requiredCapabilities: Capability[]

	constructor(
		private readonly orch: SuperRooOrchestrator,
		opts: DaemonAgentAdapterOptions,
	) {
		this.name = opts.name
		this.description = opts.description
		this.requiredCapabilities = opts.capabilities ?? ["read.file", "write.file"]
	}

	async run(ctx: AgentRunContext): Promise<AgentRunResult> {
		const goal = ctx.task.goal

		// Submit to orchestrator queue for actual execution
		const input = parseTaskSubmission(
			{
				goal: String(goal),
				agent: this.name,
				payload: ctx.task.payload ?? {},
			},
			"daemon",
		)
		const task = this.orch.submit(input)

		return {
			ok: true,
			summary: `Task submitted to orchestrator queue: ${String(goal).slice(0, 100)}`,
			data: { taskId: task.id, agentName: this.name },
		}
	}
}

/**
 * Pre-built adapters for all known agents.
 */
export function createDaemonAdapters(orch: SuperRooOrchestrator): DaemonAgentAdapter[] {
	return [
		new DaemonAgentAdapter(orch, {
			name: "coder",
			description: "Writes and edits code by driving Roo's Task loop in 'code' mode.",
			modeSlug: "code",
			capabilities: ["read.file", "write.file", "execute.command", "search.files"],
		}),
		new DaemonAgentAdapter(orch, {
			name: "debugger",
			description: "Diagnoses bugs by running Roo's debug mode.",
			modeSlug: "debug",
			capabilities: ["read.file", "execute.command", "search.files"],
		}),
		new DaemonAgentAdapter(orch, {
			name: "tester",
			description: "Runs project tests via the host TestRunner.",
			modeSlug: "code",
			capabilities: ["execute.command", "read.file"],
		}),
		new DaemonAgentAdapter(orch, {
			name: "product-manager",
			description: "Decomposes feature goals into Coder tasks. Drives FeatureRegistry.",
			modeSlug: "architect",
			capabilities: ["read.file", "search.files"],
		}),
		new DaemonAgentAdapter(orch, {
			name: "supabase",
			description: "Runs Supabase CLI/database operations.",
			modeSlug: "code",
			capabilities: ["execute.command"],
		}),
		new DaemonAgentAdapter(orch, {
			name: "self-healing",
			description: "Manages self-healing operations: incident reporting, cycle triggering, and approvals.",
			modeSlug: "code",
			capabilities: ["read.file", "write.file"],
		}),
	]
}
