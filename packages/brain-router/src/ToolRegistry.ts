export type ToolSafety = "safe" | "approval_required" | "blocked"

export interface ToolCall {
	name: string
	args: Record<string, unknown>
}

export interface ToolDefinition {
	name: string
	description: string
	parameters: Record<string, unknown>
	safety: ToolSafety
	handler?: (args: Record<string, unknown>) => Promise<unknown>
}

const DEFAULT_BLOCKED = [
	"rm -rf /",
	"drop database",
	"sudo rm",
	"docker system prune -a",
	"format c:",
	"dd if=/dev/zero",
	":(){ :|:& };:",
]

const DEFAULT_APPROVAL = [
	"sudo",
	"chmod -r",
	"chown -r",
	"deploy production",
	"modify .env",
	"rm -rf",
	"docker system prune",
	"git push --force",
]

export class ToolRegistry {
	private tools = new Map<string, ToolDefinition>()
	private blockedPatterns: string[]
	private approvalPatterns: string[]

	constructor(options?: { blocked?: string[]; approval?: string[] }) {
		this.blockedPatterns = options?.blocked ?? DEFAULT_BLOCKED
		this.approvalPatterns = options?.approval ?? DEFAULT_APPROVAL
	}

	register(tool: ToolDefinition): void {
		this.tools.set(tool.name, tool)
	}

	get(name: string): ToolDefinition | undefined {
		return this.tools.get(name)
	}

	list(): ToolDefinition[] {
		return Array.from(this.tools.values())
	}

	classify(call: ToolCall): ToolSafety {
		const serialized = JSON.stringify(call).toLowerCase()

		if (this.blockedPatterns.some((x) => serialized.includes(x.toLowerCase()))) return "blocked"
		if (this.approvalPatterns.some((x) => serialized.includes(x.toLowerCase()))) return "approval_required"

		const tool = this.tools.get(call.name)
		if (tool) return tool.safety

		return "safe"
	}

	async execute(call: ToolCall): Promise<{ status: string; output: string }> {
		const safety = this.classify(call)
		if (safety === "blocked") throw new Error(`Blocked unsafe tool call: ${call.name}`)
		if (safety === "approval_required") throw new Error(`Approval required for tool call: ${call.name}`)

		const tool = this.tools.get(call.name)
		if (!tool || !tool.handler) {
			return { status: "not_implemented", output: `Tool ${call.name} has no handler registered.` }
		}

		try {
			const result = await tool.handler(call.args)
			return { status: "success", output: JSON.stringify(result) }
		} catch (err) {
			return { status: "failed", output: err instanceof Error ? err.message : String(err) }
		}
	}
}
