export type OllamaRole = "system" | "user" | "assistant"

export interface OllamaMessage {
	role: OllamaRole
	content: string
}

export interface OllamaClientOptions {
	baseUrl?: string
	defaultModel?: string
	fallbackModel?: string
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
	private fallbackModel: string
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
			options.defaultModel || process.env.OLLAMA_SUMMARY_MODEL || process.env.OLLAMA_MODEL || "hermes3"
		this.fallbackModel = options.fallbackModel || process.env.OLLAMA_FALLBACK_MODEL || "qwen3:14b"
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
		const body = this.buildGenerateBody(options, options.model || this.defaultModel)

		const data = await this.postJsonWithModelFallback("/api/generate", body)
		return String(data.response || "").trim()
	}

	async chat(options: OllamaChatOptions): Promise<string> {
		const body = this.buildChatBody(options, options.model || this.defaultModel)

		const data = await this.postJsonWithModelFallback("/api/chat", body)
		return String(data.message?.content || "").trim()
	}

	private buildGenerateBody(options: OllamaGenerateOptions, model: string): any {
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
		body.model = model
		return body
	}

	private buildChatBody(options: OllamaChatOptions, model: string): any {
		const body: any = {
			model,
			messages: options.messages,
			stream: false,
			options: {
				temperature: options.temperature ?? this.temperature,
				num_ctx: options.numCtx ?? this.numCtx,
			},
		}
		if (options.format) body.format = options.format
		return body
	}

	private async postJsonWithModelFallback(path: string, body: any): Promise<any> {
		try {
			const res = await this.request(path, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			})
			return await res.json()
		} catch (error: any) {
			if (!this.shouldRetryWithFallbackModel(error, body.model)) {
				throw error
			}
			const res = await this.request(path, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ ...body, model: this.fallbackModel }),
			})
			return await res.json()
		}
	}

	private shouldRetryWithFallbackModel(error: any, attemptedModel: string): boolean {
		if (!this.fallbackModel || attemptedModel === this.fallbackModel) return false
		const message = error?.message || ""
		return /model .*not found|model .* does not exist|pull model/i.test(message)
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
