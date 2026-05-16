/**
 * Super Roo — Agent Registry.
 *
 * Phase 1 ships an empty registry. Phase 2 will register the actual agents
 * (Product Manager, Coder, Debugger, Tester, etc.) here. Keeping the seam
 * exposed now means Phase 2 only needs to call `register()` — orchestrator
 * code is written against this interface and won't need to change.
 */

import type { Agent } from "../types"

export class AgentRegistry {
	private agents = new Map<string, Agent>()

	register(agent: Agent): void {
		if (this.agents.has(agent.name)) {
			throw new Error(`Agent already registered: ${agent.name}`)
		}
		this.agents.set(agent.name, agent)
	}

	unregister(name: string): boolean {
		return this.agents.delete(name)
	}

	get(name: string): Agent | undefined {
		return this.agents.get(name)
	}

	has(name: string): boolean {
		return this.agents.has(name)
	}

	list(): Agent[] {
		return Array.from(this.agents.values())
	}

	clear(): void {
		this.agents.clear()
	}
}
