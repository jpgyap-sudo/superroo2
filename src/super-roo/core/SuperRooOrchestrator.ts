import { createAgentRegistry } from "./AgentRegistry"
import { SuperRooCommandOptions, SuperRooRuntime } from "./types"

export class SuperRooOrchestrator {
	private agents = createAgentRegistry()

	constructor(private readonly runtime: SuperRooRuntime) {}

	async status() {
		this.runtime.log(`Source: ${this.runtime.source}`)
		this.runtime.log(`Workspace: ${this.runtime.workspaceRoot}`)
		this.runtime.log(`Agents loaded: ${this.agents.map((agent) => agent.name).join(", ")}`)
	}

	async runAutonomous(options: SuperRooCommandOptions = {}) {
		this.runtime.log("Starting Phase 3 autonomous safe-mode loop...")
		await this.runAgent("product-manager", "autonomous", options)
		await this.runAgent("debugger", "autonomous", options)
		await this.runAgent("tester", "autonomous", options)
		this.runtime.log("Autonomous safe-mode finished. No production deploy performed in Phase 3 skeleton.")
	}

	async checkVps(options: SuperRooCommandOptions = {}) {
		await this.runAgent("deploy-checker", "check-vps", options)
	}

	async deploy(options: SuperRooCommandOptions = {}) {
		this.runtime.warn("Deploy command is intentionally safe in Phase 3. Add real deploy implementation in Phase 5.")
		await this.runAgent("deploy-checker", "deploy-precheck", options)
	}

	async debugApi(options: SuperRooCommandOptions = {}) {
		await this.runAgent("debugger", "debug-api", options)
	}

	private async runAgent(agentId: string, command: string, options: SuperRooCommandOptions) {
		const agent = this.agents.find((item) => item.id === agentId)
		if (!agent) {
			throw new Error(`Agent not found: ${agentId}`)
		}

		this.runtime.log(`Running ${agent.name}...`)
		const result = await agent.run({ runtime: this.runtime, command, options })

		if (!result.ok) {
			throw new Error(`${agent.name} failed: ${result.summary}`)
		}

		this.runtime.log(`${agent.name}: ${result.summary}`)
		for (const detail of result.details ?? []) {
			this.runtime.log(`- ${detail}`)
		}
	}
}
