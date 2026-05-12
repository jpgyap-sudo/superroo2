export type InterfaceSource = "vscode" | "cloud" | "telegram" | "cli"

export interface SharedContextPacket {
	source: InterfaceSource
	userId?: string
	projectId: string
	repoPath?: string
	currentFile?: string
	selectedCode?: string
	openTabs?: string[]
	activeTaskId?: string
	conversationId?: string
	gitBranch?: string
	gitDiff?: string
	recentTerminalErrors?: string[]
	currentRoute?: string
	buildStatus?: string
	testStatus?: string
	userMessage: string
	timestamp: string
}

export interface MemoryChunkInput {
	projectId: string
	sourceType: string
	sourceId?: string
	sourcePath?: string
	title?: string
	content: string
	summary?: string
	tags?: string[]
	importance?: number
	confidence?: number
	trustScore?: number
	metadata?: Record<string, unknown>
}

export interface RetrievedMemory {
	id: string
	title?: string
	content: string
	sourceType: string
	sourcePath?: string
	similarity: number
	metadata?: Record<string, unknown>
}

export interface RagContext {
	projectId: string
	task: string
	memories: RetrievedMemory[]
	code: RetrievedMemory[]
	contextText: string
}

export interface EmbeddingProvider {
	embed(text: string): Promise<number[]>
}

export interface VectorStore {
	insertMemory(input: MemoryChunkInput, embedding: number[]): Promise<string>
	searchMemory(projectId: string, embedding: number[], limit?: number): Promise<RetrievedMemory[]>
	searchCode(projectId: string, embedding: number[], limit?: number): Promise<RetrievedMemory[]>
}
