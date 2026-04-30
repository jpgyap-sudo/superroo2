export type SuperRooSource = "cli" | "vscode" | "telegram" | "scheduler"

export interface SuperRooRuntime {
	source: SuperRooSource
	workspaceRoot: string
	log: (message: string) => void
	warn: (message: string) => void
	error: (message: string, error?: unknown) => void
}

export interface SuperRooCommandOptions {
	args?: string[]
	projectPath?: string
	safeMode?: boolean
}

export interface SuperRooAgent {
	id: string
	name: string
	description: string
	run: (context: SuperRooAgentContext) => Promise<SuperRooAgentResult>
}

export interface SuperRooAgentContext {
	runtime: SuperRooRuntime
	command: string
	options?: SuperRooCommandOptions
}

export interface SuperRooAgentResult {
	ok: boolean
	summary: string
	details?: string[]
}
