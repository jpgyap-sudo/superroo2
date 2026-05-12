import type { EmbeddingProvider, RagContext, SharedContextPacket } from "./types.js"
import type { PgVectorStore } from "./PgVectorStore.js"

export interface RagContextBuilderOptions {
	memoryTopK?: number
	codeTopK?: number
	minSimilarity?: number
	maxMemoryChars?: number
	maxCodeChars?: number
}

export class RagContextBuilder {
	constructor(
		private readonly store: PgVectorStore,
		private readonly embeddings: EmbeddingProvider,
		private readonly options: RagContextBuilderOptions = {},
	) {}

	async build(packet: SharedContextPacket): Promise<RagContext> {
		const searchText = [
			packet.userMessage,
			packet.currentFile ? `Current file: ${packet.currentFile}` : "",
			packet.selectedCode ? `Selected code: ${packet.selectedCode}` : "",
			packet.gitDiff ? `Git diff: ${packet.gitDiff}` : "",
			packet.recentTerminalErrors?.join("\n") ?? "",
		]
			.filter(Boolean)
			.join("\n\n")

		const vector = await this.embeddings.embed(searchText)

		const [memories, code] = await Promise.all([
			this.store.searchMemory(
				packet.projectId,
				vector,
				this.options.memoryTopK ?? 10,
				this.options.minSimilarity ?? 0.25,
			),
			this.store.searchCode(
				packet.projectId,
				vector,
				this.options.codeTopK ?? 8,
				this.options.minSimilarity ?? 0.25,
			),
		])

		const maxMemChars = this.options.maxMemoryChars ?? 1500
		const maxCodeChars = this.options.maxCodeChars ?? 1500

		const contextText = [
			`SOURCE: ${packet.source}`,
			`PROJECT: ${packet.projectId}`,
			packet.repoPath ? `REPO_PATH: ${packet.repoPath}` : "",
			packet.currentFile ? `CURRENT_FILE: ${packet.currentFile}` : "",
			packet.selectedCode ? `SELECTED_CODE:\n${packet.selectedCode}` : "",
			packet.gitBranch ? `GIT_BRANCH: ${packet.gitBranch}` : "",
			packet.gitDiff ? `GIT_DIFF:\n${packet.gitDiff}` : "",
			packet.recentTerminalErrors?.length
				? `RECENT_TERMINAL_ERRORS:\n${packet.recentTerminalErrors.join("\n")}`
				: "",
			packet.buildStatus ? `BUILD_STATUS: ${packet.buildStatus}` : "",
			packet.testStatus ? `TEST_STATUS: ${packet.testStatus}` : "",
			packet.openTabs?.length ? `OPEN_TABS: ${packet.openTabs.join(", ")}` : "",
			"---",
			"RELEVANT_MEMORY:",
			...memories.map(
				(m: { title?: string; sourceType: string; similarity: number; content: string }, i: number) =>
					`[#${i + 1}] ${m.title ?? m.sourceType} (sim=${m.similarity.toFixed(3)})\n${m.content.slice(0, maxMemChars)}`,
			),
			"---",
			"RELEVANT_CODE:",
			...code.map(
				(c: { sourcePath?: string; similarity: number; content: string }, i: number) =>
					`[#${i + 1}] ${c.sourcePath} (sim=${c.similarity.toFixed(3)})\n${c.content.slice(0, maxCodeChars)}`,
			),
		]
			.filter(Boolean)
			.join("\n\n")

		return {
			projectId: packet.projectId,
			task: packet.userMessage,
			memories,
			code,
			contextText,
		}
	}
}
