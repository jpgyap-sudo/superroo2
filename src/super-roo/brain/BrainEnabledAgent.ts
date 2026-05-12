import type { Agent, AgentRunContext, AgentRunResult } from "../types"
import type { MemoryClient } from "@superroo/memory-core"
import { BrainRouter } from "@superroo/brain-router"
import type { BrainRouterOptions } from "@superroo/brain-router"
import { buildContextPacket } from "./buildContextPacket.js"

export interface BrainEnabledAgentOptions {
	memory?: MemoryClient
	brainRouter?: BrainRouter
	brainRouterOptions?: BrainRouterOptions
	/** Inject extra packet fields (e.g. source, git diff) beyond what payload provides. */
	packetOverrides?: Partial<import("@superroo/memory-core").SharedContextPacket>
}

/**
 * Adapts any existing SuperRoo Agent to the Brain pipeline.
 *
 * Before the agent runs:
 *   1. Builds a SharedContextPacket from the AgentRunContext
 *   2. Queries memory for relevant context via RAG
 *   3. Routes to the correct model/provider via BrainRouter
 *
 * After the agent runs:
 *   4. Saves the experience (task, result, status) back to memory
 *
 * The wrapped agent remains a drop-in replacement — it still implements
 * the Agent interface and can be passed to the orchestrator unchanged.
 */
export class BrainEnabledAgent implements Agent {
	readonly name: string
	readonly description: string
	readonly requiredCapabilities: string[]

	private readonly inner: Agent
	private readonly memory: MemoryClient
	private readonly brainRouter: BrainRouter
	private readonly packetOverrides?: Partial<import("@superroo/memory-core").SharedContextPacket>

	constructor(agent: Agent, options: BrainEnabledAgentOptions = {}) {
		this.inner = agent
		this.name = `brain-${agent.name}`
		this.description = `Brain-wrapped ${agent.description}`
		this.requiredCapabilities = agent.requiredCapabilities
		this.memory = options.memory ?? new MemoryClient()
		this.brainRouter = options.brainRouter ?? new BrainRouter(options.brainRouterOptions)
		this.packetOverrides = options.packetOverrides
	}

	async run(ctx: AgentRunContext): Promise<AgentRunResult> {
		const packet = buildContextPacket(ctx, this.packetOverrides)

		// 1. Build RAG context (may throw if DB is unreachable — degrade gracefully)
		let ragContextText = ""
		try {
			const rag = await this.memory.buildContext(packet)
			ragContextText = rag.contextText
		} catch (err) {
			ctx.emit(
				"warn",
				"agent.invoked",
				`Brain memory query failed: ${err instanceof Error ? err.message : String(err)}`,
			)
		}

		// 2. Route via BrainRouter
		let route = "cloud"
		let routeReason = "Default route (memory unavailable)"
		try {
			const decision = this.brainRouter.choose({
				packet,
				rag: {
					projectId: packet.projectId,
					task: packet.userMessage,
					memories: [],
					code: [],
					contextText: ragContextText,
				},
			})
			route = decision.route
			routeReason = decision.reason

			if (decision.requiresApproval) {
				ctx.emit("info", "agent.invoked", `Brain route '${route}' requires approval`, { reason: routeReason })
			}
		} catch (err) {
			ctx.emit(
				"warn",
				"agent.invoked",
				`Brain routing failed: ${err instanceof Error ? err.message : String(err)}`,
			)
		}

		// 3. Inject RAG context + route into the task payload so the inner agent can use it
		const enrichedCtx: AgentRunContext = {
			...ctx,
			task: {
				...ctx.task,
				payload: {
					...ctx.task.payload,
					_brainRagContext: ragContextText,
					_brainRoute: route,
					_brainRouteReason: routeReason,
				},
			},
		}

		// 4. Run the inner agent
		const result = await this.inner.run(enrichedCtx)

		// 5. Save experience back to memory
		try {
			await this.memory.saveExperience({
				projectId: packet.projectId,
				agentName: this.inner.name,
				task: packet.userMessage,
				result: result.summary,
				status: result.ok ? "success" : "failed",
				metadata: {
					route,
					reason: routeReason,
					source: packet.source,
					activeTaskId: packet.activeTaskId,
					error: result.error,
					followupsCount: result.followups?.length ?? 0,
				},
			})
		} catch (err) {
			ctx.emit(
				"warn",
				"agent.invoked",
				`Brain memory save failed: ${err instanceof Error ? err.message : String(err)}`,
			)
		}

		return result
	}
}
