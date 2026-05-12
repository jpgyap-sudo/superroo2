import { OllamaEmbeddingProvider } from "./OllamaEmbeddingProvider.js"
import { PgVectorStore } from "./PgVectorStore.js"
import { RagContextBuilder } from "./RagContextBuilder.js"
import type { MemoryChunkInput, SharedContextPacket } from "./types.js"
import type { OllamaEmbeddingProviderOptions } from "./OllamaEmbeddingProvider.js"
import type { PgVectorStoreOptions } from "./PgVectorStore.js"
import type { RagContextBuilderOptions } from "./RagContextBuilder.js"

export interface MemoryClientOptions {
	embedding?: OllamaEmbeddingProviderOptions
	store?: PgVectorStoreOptions
	rag?: RagContextBuilderOptions
}

export class MemoryClient {
	private readonly embeddings: OllamaEmbeddingProvider
	private readonly store: PgVectorStore
	private readonly rag: RagContextBuilder

	constructor(options: MemoryClientOptions = {}) {
		this.embeddings = new OllamaEmbeddingProvider(options.embedding)
		this.store = new PgVectorStore(options.store)
		this.rag = new RagContextBuilder(this.store, this.embeddings, options.rag)
	}

	async saveMemory(input: MemoryChunkInput): Promise<string> {
		const vector = await this.embeddings.embed(`${input.title ?? ""}\n${input.content}`)
		return this.store.insertMemory(input, vector)
	}

	async buildContext(packet: SharedContextPacket) {
		return this.rag.build(packet)
	}

	async saveExperience(args: {
		projectId: string
		agentName: string
		task: string
		result: string
		status: "success" | "failed" | "partial"
		metadata?: Record<string, unknown>
	}) {
		return this.saveMemory({
			projectId: args.projectId,
			sourceType: "agent_experience",
			title: `${args.agentName}: ${args.status}`,
			content: `TASK:\n${args.task}\n\nRESULT:\n${args.result}`,
			tags: [args.agentName, args.status],
			metadata: args.metadata ?? {},
			importance: args.status === "success" ? 4 : 5,
			trustScore: args.status === "success" ? 0.85 : 0.65,
		})
	}

	async saveBugPattern(args: {
		projectId: string
		errorText: string
		normalizedClass?: string
		filesInvolved?: string[]
		command?: string
		fix?: string
		failedFixes?: string[]
		test?: string
	}) {
		return this.saveMemory({
			projectId: args.projectId,
			sourceType: "bug_pattern",
			title: args.normalizedClass ?? "Bug Pattern",
			content: [
				`ERROR:\n${args.errorText}`,
				args.filesInvolved?.length ? `FILES:\n${args.filesInvolved.join("\n")}` : "",
				args.command ? `COMMAND:\n${args.command}` : "",
				args.fix ? `FIX:\n${args.fix}` : "",
				args.failedFixes?.length ? `FAILED_FIXES:\n${args.failedFixes.join("\n")}` : "",
				args.test ? `TEST:\n${args.test}` : "",
			]
				.filter(Boolean)
				.join("\n\n"),
			tags: ["bug", "pattern", args.normalizedClass ?? "unknown"],
			metadata: {
				hasFix: !!args.fix,
				hasTest: !!args.test,
				files: args.filesInvolved ?? [],
			},
			importance: 5,
			trustScore: args.fix ? 0.8 : 0.5,
		})
	}

	async indexCodeChunk(args: {
		projectId: string
		filePath: string
		language: string
		content: string
		summary?: string
		metadata?: Record<string, unknown>
	}) {
		const vector = await this.embeddings.embed(`FILE: ${args.filePath}\n${args.content}`)
		return this.store.insertCodeChunk({ ...args, embedding: vector })
	}

	async close(): Promise<void> {
		await this.store.close()
	}
}
