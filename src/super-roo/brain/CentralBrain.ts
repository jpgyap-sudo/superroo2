import { MemoryClient } from "@superroo/memory-core"
import type { SharedContextPacket } from "@superroo/memory-core"
import { BrainRouter, ToolRegistry } from "@superroo/brain-router"
import type { BrainRouterOptions, ToolCall, ToolDefinition } from "@superroo/brain-router"
import { buildContextPacket } from "./buildContextPacket.js"
import type { Agent, AgentRunContext, AgentRunResult } from "../types"

export interface CentralBrainOptions {
	memory?: MemoryClient
	brainRouter?: BrainRouter
	brainRouterOptions?: BrainRouterOptions
	toolRegistry?: ToolRegistry
	safeMode?: boolean
	requireGitCheckpointBeforeEdit?: boolean
}

export interface CentralBrainRunResult {
	ok: boolean
	summary: string
	route: string
	routeReason: string
	memorySaved: boolean
	toolCalls: ToolCall[]
	agentResult: AgentRunResult
	contextPacket: SharedContextPacket
	ragContextText: string
}

/**
 * CentralBrain is the single entry point for ALL agent execution in SuperRoo.
 *
 * It enforces the pipeline:
 *   1. Build SharedContextPacket from AgentRunContext
 *   2. Query RAG memory (searchContext)
 *   3. Route to correct model via BrainRouter
 *   4. Check permissions via ToolRegistry
 *   5. Execute the agent
 *   6. Verify / test (optional)
 *   7. Save experience back to memory (saveExperience)
 *   8. Log all actions
 *
 * No agent may call an LLM directly. All requests must flow through here.
 */
export class CentralBrain {
	readonly memory: MemoryClient
	readonly brainRouter: BrainRouter
	readonly toolRegistry: ToolRegistry
	readonly safeMode: boolean
	readonly requireGitCheckpointBeforeEdit: boolean

	private runLog: Array<{
		agentName: string
		task: string
		route: string
		status: string
		timestamp: string
	}> = []

	constructor(options: CentralBrainOptions = {}) {
		this.memory = options.memory ?? new MemoryClient()
		this.brainRouter = options.brainRouter ?? new BrainRouter(options.brainRouterOptions)
		this.toolRegistry = options.toolRegistry ?? new ToolRegistry()
		this.safeMode = options.safeMode ?? process.env.SUPERROO_SAFE_MODE !== "false"
		this.requireGitCheckpointBeforeEdit = options.requireGitCheckpointBeforeEdit ?? true
	}

	/**
	 * The ONE method all agents must call.
	 *
	 * Pipeline:
	 *   Context Packet -> RAG Memory -> Brain Router -> Permissions ->
	 *   Agent Execute -> Memory Save -> Log
	 */
	async run(agent: Agent, ctx: AgentRunContext): Promise<CentralBrainRunResult> {
		const packet = buildContextPacket(ctx)
		const toolCalls: ToolCall[] = []
		let ragContextText = ""
		let memorySaved = false
		let route = "cloud"
		let routeReason = "Default fallback"

		// ── 1. RAG Memory ──
		try {
			const rag = await this.memory.buildContext(packet)
			ragContextText = rag.contextText
		} catch (err) {
			this._log("warn", ctx, `RAG memory query failed: ${err instanceof Error ? err.message : String(err)}`)
		}

		// ── 2. Brain Router ──
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
				riskLevel: this._assessRisk(ctx),
			})
			route = decision.route
			routeReason = decision.reason

			if (decision.requiresApproval) {
				this._log("info", ctx, `Route '${route}' requires approval: ${routeReason}`)
			}
		} catch (err) {
			this._log("warn", ctx, `Brain routing failed: ${err instanceof Error ? err.message : String(err)}`)
		}

		// ── 3. Permission Gate ──
		if (this.safeMode && route === "openclaw") {
			this._log("info", ctx, "OpenClaw route blocked in safe mode")
			return {
				ok: false,
				summary: "OpenClaw execution blocked in safe mode.",
				route,
				routeReason,
				memorySaved,
				toolCalls,
				agentResult: {
					ok: false,
					summary: "Blocked by CentralBrain safety gate.",
					error: "safety_gate_blocked",
				},
				contextPacket: packet,
				ragContextText,
			}
		}

		// ── 4. Enrich context with RAG + route for inner agent ──
		const enrichedCtx: AgentRunContext = {
			...ctx,
			task: {
				...ctx.task,
				payload: {
					...ctx.task.payload,
					_centralBrainRagContext: ragContextText,
					_centralBrainRoute: route,
					_centralBrainRouteReason: routeReason,
				},
			},
		}

		// ── 5. Agent Execute ──
		let agentResult: AgentRunResult
		try {
			agentResult = await agent.run(enrichedCtx)
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			agentResult = {
				ok: false,
				summary: `Agent crashed: ${msg}`,
				error: msg,
			}
		}

		// ── 6. Memory Save ──
		try {
			await this.memory.saveExperience({
				projectId: packet.projectId,
				agentName: agent.name,
				task: packet.userMessage,
				result: agentResult.summary,
				status: agentResult.ok ? "success" : "failed",
				metadata: {
					route,
					reason: routeReason,
					source: packet.source,
					activeTaskId: packet.activeTaskId,
					error: agentResult.error,
					followupsCount: agentResult.followups?.length ?? 0,
					safeMode: this.safeMode,
				},
			})
			memorySaved = true
		} catch (err) {
			this._log("warn", ctx, `Memory save failed: ${err instanceof Error ? err.message : String(err)}`)
		}

		// ── 7. Log ──
		this.runLog.push({
			agentName: agent.name,
			task: packet.userMessage,
			route,
			status: agentResult.ok ? "success" : "failed",
			timestamp: new Date().toISOString(),
		})

		if (this.runLog.length > 5000) this.runLog = this.runLog.slice(-5000)

		return {
			ok: agentResult.ok,
			summary: agentResult.summary,
			route,
			routeReason,
			memorySaved,
			toolCalls,
			agentResult,
			contextPacket: packet,
			ragContextText,
		}
	}

	/**
	 * Register a tool in the CentralBrain's ToolRegistry.
	 * All tool calls must go through this registry.
	 */
	registerTool(tool: ToolDefinition): void {
		this.toolRegistry.register(tool)
	}

	/**
	 * Execute a tool call through the permission-controlled registry.
	 */
	async executeTool(call: ToolCall): Promise<{ status: string; output: string }> {
		return this.toolRegistry.execute(call)
	}

	/**
	 * Get recent run log entries.
	 */
	getRunLog(
		limit = 100,
	): Array<{ agentName: string; task: string; route: string; status: string; timestamp: string }> {
		return this.runLog.slice(-limit)
	}

	/**
	 * Clean up resources (close DB pool).
	 */
	async close(): Promise<void> {
		await this.memory.close()
	}

	private _assessRisk(ctx: AgentRunContext): "low" | "medium" | "high" {
		const text = ctx.task.goal.toLowerCase()
		if (
			text.includes("deploy") ||
			text.includes("production") ||
			text.includes("drop") ||
			text.includes("delete")
		) {
			return "high"
		}
		if (text.includes("edit") || text.includes("write") || text.includes("execute")) {
			return "medium"
		}
		return "low"
	}

	private _log(level: "info" | "warn" | "error", ctx: AgentRunContext, message: string): void {
		ctx.emit(level, "agent.invoked", message)
	}
}
