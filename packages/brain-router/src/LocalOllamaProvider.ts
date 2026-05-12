export interface LocalOllamaProviderOptions {
	baseUrl?: string
	model?: string
	requestTimeoutMs?: number
}

export class LocalOllamaProvider {
	private readonly baseUrl: string
	private readonly model: string
	private readonly requestTimeoutMs: number

	constructor(options: LocalOllamaProviderOptions = {}) {
		this.baseUrl = options.baseUrl ?? process.env.OLLAMA_BASE_URL ?? "http://localhost:11434"
		this.model = options.model ?? process.env.OLLAMA_CHEAP_TEXT_MODEL ?? "qwen2.5:0.5b"
		this.requestTimeoutMs = options.requestTimeoutMs ?? 60000
	}

	async generate(prompt: string): Promise<string> {
		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs)

		try {
			const res = await fetch(`${this.baseUrl}/api/generate`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ model: this.model, prompt, stream: false }),
				signal: controller.signal,
			})

			if (!res.ok) {
				const body = await res.text()
				throw new Error(`Ollama generate failed: ${res.status} ${body}`)
			}

			const json = (await res.json()) as { response?: string; error?: string }
			if (json.error) throw new Error(`Ollama generate error: ${json.error}`)
			return json.response ?? ""
		} finally {
			clearTimeout(timeout)
		}
	}

	async chat(messages: { role: string; content: string }[]): Promise<string> {
		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs)

		try {
			const res = await fetch(`${this.baseUrl}/api/chat`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ model: this.model, messages, stream: false }),
				signal: controller.signal,
			})

			if (!res.ok) {
				const body = await res.text()
				throw new Error(`Ollama chat failed: ${res.status} ${body}`)
			}

			const json = (await res.json()) as { message?: { content?: string }; error?: string }
			if (json.error) throw new Error(`Ollama chat error: ${json.error}`)
			return json.message?.content ?? ""
		} finally {
			clearTimeout(timeout)
		}
	}
}
