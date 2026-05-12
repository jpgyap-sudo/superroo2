import type { EmbeddingProvider } from "./types.js"

export interface OllamaEmbeddingProviderOptions {
	baseUrl?: string
	model?: string
	maxChars?: number
	requestTimeoutMs?: number
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
	private readonly baseUrl: string
	private readonly model: string
	private readonly maxChars: number
	private readonly requestTimeoutMs: number

	constructor(options: OllamaEmbeddingProviderOptions = {}) {
		this.baseUrl = options.baseUrl ?? process.env.OLLAMA_BASE_URL ?? "http://localhost:11434"
		this.model = options.model ?? process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text"
		this.maxChars = options.maxChars ?? 8000
		this.requestTimeoutMs = options.requestTimeoutMs ?? 30000
	}

	async embed(text: string): Promise<number[]> {
		const prompt = text.slice(0, this.maxChars)
		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs)

		try {
			const res = await fetch(`${this.baseUrl}/api/embeddings`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ model: this.model, prompt }),
				signal: controller.signal,
			})

			if (!res.ok) {
				const body = await res.text()
				throw new Error(`Ollama embedding failed: ${res.status} ${body}`)
			}

			const json = (await res.json()) as { embedding?: number[]; error?: string }
			if (json.error) throw new Error(`Ollama embedding error: ${json.error}`)
			if (!json.embedding || json.embedding.length === 0) {
				throw new Error("Ollama embedding returned empty vector")
			}
			return json.embedding
		} finally {
			clearTimeout(timeout)
		}
	}
}
