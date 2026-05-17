export type OllamaRole = "system" | "user" | "assistant"

export interface OllamaMessage {
	role: OllamaRole
	content: string
}

export interface OllamaClientOptions {
	baseUrl?: string
	defaultModel?: string
	timeoutMs?: number
	temperature?: number
	numCtx?: number
}

export interface OllamaGenerateOptions {
	model?: string
	system?: string
	prompt: string
	temperature?: number
	numCtx?: number
	format?: "json"
}

export interface OllamaChatOptions {
	model?: string
	messages: OllamaMessage[]
	temperature?: number
	numCtx?: number
	format?: "json"
}

export class OllamaClient {
	private baseUrl: string
	private defaultModel: string
	private timeoutMs: number
	private temperature: number
	private numCtx: number

	constructor(options: OllamaClientOptions = {}) {
		this.baseUrl = (
			options.baseUrl ||
			process.env.OLLAMA_BASE_URL ||
			process.env.OLLAMA_HOST ||
			"http://127.0.0.1:11434"
		).replace(/\/$/, "")
		this.defaultModel =
			options.defaultModel || process.env.OLLAMA_SUMMARY_MODEL || process.env.OLLAMA_MODEL || "qwen2.5-coder:3b"
		this.timeoutMs = Number(options.timeoutMs || process.env.OLLAMA_TIMEOUT_MS || 120000)
		this.temperature = Number(options.temperature ?? process.env.OLLAMA_TEMPERATURE ?? 0.1)
		this.numCtx = Number(options.numCtx || process.env.OLLAMA_NUM_CTX || 8192)
	}

	async health(): Promise<{ ok: boolean; models?: string[]; error?: string }> {
		try {
			const res = await this.request("/api/tags", { method: "GET" })
			const data = await res.json()
			return { ok: true, models: (data.models || []).map((m: any) => m.name) }
		} catch (error: any) {
			return { ok: false, error: error?.message || String(error) }
		}
	}

	async generate(options: OllamaGenerateOptions): Promise<string> {
		const body: any = {
			model: options.model || this.defaultModel,
			prompt: options.prompt,
			system: options.system,
			stream: false,
			options: {
				temperature: options.temperature ?? this.temperature,
				num_ctx: options.numCtx ?? this.numCtx,
			},
		}
		if (options.format) body.format = options.format

		const res = await this.request("/api/generate", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		})
		const data = await res.json()
		return String(data.response || "").trim()
	}

	async chat(options: OllamaChatOptions): Promise<string> {
		const body: any = {
			model: options.model || this.defaultModel,
			messages: options.messages,
			stream: false,
			options: {
				temperature: options.temperature ?? this.temperature,
				num_ctx: options.numCtx ?? this.numCtx,
			},
		}
		if (options.format) body.format = options.format

		const res = await this.request("/api/chat", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		})
		const data = await res.json()
		return String(data.message?.content || "").trim()
	}

	private async request(path: string, init: RequestInit): Promise<Response> {
		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
		try {
			const res = await fetch(`${this.baseUrl}${path}`, { ...init, signal: controller.signal })
			if (!res.ok) {
				const text = await res.text().catch(() => "")
				throw new Error(`Ollama ${res.status}: ${text || res.statusText}`)
			}
			return res
		} finally {
			clearTimeout(timeout)
		}
	}
}
