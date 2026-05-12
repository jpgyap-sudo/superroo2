import { MemoryClient } from "@superroo/memory-core"
import type { SharedContextPacket } from "@superroo/memory-core"
import { BrainRouter } from "@superroo/brain-router"
import type { BrainRouterOptions } from "@superroo/brain-router"

export interface AgentLike {
	name: string
	execute(input: {
		task: string
		contextText: string
		route: string
	}): Promise<{ status: "success" | "failed" | "partial"; output: string }>
}

export interface AgentRuntimeWrapperOptions {
	agent: AgentLike
	memory?: MemoryClient
	brainRouter?: BrainRouter
	brainRouterOptions?: BrainRouterOptions
}

export class AgentRuntimeWrapper {
	private readonly agent: AgentLike
	private readonly memory: MemoryClient
	private readonly brainRouter: BrainRouter

	constructor(options: AgentRuntimeWrapperOptions) {
		this.agent = options.agent
		this.memory = options.memory ?? new MemoryClient()
		this.brainRouter = options.brainRouter ?? new BrainRouter(options.brainRouterOptions)
	}

	async run(packet: SharedContextPacket) {
		const rag = await this.memory.buildContext(packet)
		const decision = this.brainRouter.choose({ packet, rag })

		const result = await this.agent.execute({
			task: packet.userMessage,
			contextText: rag.contextText,
			route: decision.route,
		})

		await this.memory.saveExperience({
			projectId: packet.projectId,
			agentName: this.agent.name,
			task: packet.userMessage,
			result: result.output,
			status: result.status,
			metadata: {
				route: decision.route,
				reason: decision.reason,
				source: packet.source,
				activeTaskId: packet.activeTaskId,
			},
		})

		return { decision, result, rag }
	}
}
