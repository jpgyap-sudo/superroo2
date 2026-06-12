/**
 * Ollama Provider — Modular provider package.
 *
 * Supports local Ollama models (qwen2.5, llama, etc.).
 * No API key required — connects to local Ollama instance.
 *
 * @module cloud/providers/ollama
 */

/**
 * Create an Ollama provider instance.
 * @param {Object} [options]
 * @param {string} [options.apiBaseUrl] — Base URL override (default: http://127.0.0.1:11434)
 * @returns {import("./types").Provider}
 */
function createProvider(options = {}) {
	const baseUrl = (options.apiBaseUrl || "http://127.0.0.1:11434").replace(/\/+$/, "")

	/** @type {import("./types").ProviderDefinition} */
	const definition = {
		id: "ollama",
		name: "Ollama (Local)",
		description: "Local Ollama models (hermes3, qwen3:14b, qwen2.5-coder:7b)",
		envName: null,
		website: "https://ollama.com",
		docsUrl: "https://github.com/ollama/ollama",
		apiBaseUrl: baseUrl,
		defaultModel: "hermes3",
		local: true,
		models: [
			{ id: "qwen3:14b", name: "Qwen3 14B", contextWindow: 131072, supportsVision: false, supportsTools: true, supportsReasoning: true, inputCostPerMTok: 0, outputCostPerMTok: 0, bestFor: ["complex coding", "multi-file work", "architecture"] },
			{ id: "qwen2.5-coder:7b", name: "Qwen2.5 Coder 7B", contextWindow: 131072, supportsVision: false, supportsTools: false, supportsReasoning: false, inputCostPerMTok: 0, outputCostPerMTok: 0, bestFor: ["fast edits", "quick functions"] },
			{ id: "hermes3", name: "Hermes 3 8B", contextWindow: 131072, supportsVision: false, supportsTools: false, supportsReasoning: false, inputCostPerMTok: 0, outputCostPerMTok: 0, bestFor: ["research", "analysis", "memory retrieval"] },
		],
		capabilities: {
			chat: true,
			vision: false,
			functionCalling: false,
			structuredOutput: false,
			reasoning: false,
			streaming: true,
			embedding: true,
		},
	}

	/**
	 * Send a chat completion request.
	 * @param {import("./types").ChatMessage[]} messages
	 * @param {import("./types").ChatOptions} [opts]
	 * @returns {Promise<import("./types").ChatResponse>}
	 */
	async function chat(messages, opts = {}) {
		const model = opts.model || definition.defaultModel
		const url = `${baseUrl}/api/chat`

		/** @type {Object} */
		const body = {
			model,
			messages: messages.map((m) => ({
				role: m.role,
				content: m.content,
			})),
			stream: !!opts.onStream,
			options: {
				temperature: opts.temperature ?? 0.7,
				top_p: opts.topP,
				stop: opts.stop,
			},
		}

		if (opts.maxTokens) {
			body.options.num_predict = opts.maxTokens
		}

		if (opts.onStream) {
			return _streamChat(url, body, opts.onStream, opts.signal)
		}

		const response = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
			signal: opts.signal,
		})

		if (!response.ok) {
			const errorText = await response.text().catch(() => "Unknown error")
			throw new Error(`Ollama API error (${response.status}): ${errorText}`)
		}

		const data = await response.json()

		return {
			id: `ollama_${Date.now()}`,
			model: data.model || model,
			content: data.message?.content || "",
			usage: {
				promptTokens: data.prompt_eval_count || 0,
				completionTokens: data.eval_count || 0,
				totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
			},
		}
	}

	/**
	 * Stream a chat completion response (NDJSON).
	 * @param {string} url
	 * @param {Object} body
	 * @param {Function} onStream
	 * @param {AbortSignal} [signal]
	 * @returns {Promise<import("./types").ChatResponse>}
	 */
	async function _streamChat(url, body, onStream, signal) {
		const response = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
			signal,
		})

		if (!response.ok) {
			const errorText = await response.text().catch(() => "Unknown error")
			throw new Error(`Ollama streaming error (${response.status}): ${errorText}`)
		}

		const reader = response.body.getReader()
		const decoder = new TextDecoder()
		let fullContent = ""
		let buffer = ""

		while (true) {
			const { done, value } = await reader.read()
			if (done) break

			buffer += decoder.decode(value, { stream: true })
			const lines = buffer.split("\n")
			buffer = lines.pop() || ""

			for (const line of lines) {
				const trimmed = line.trim()
				if (!trimmed) continue

				try {
					const chunk = JSON.parse(trimmed)
					const content = chunk.message?.content || ""
					if (content) {
						fullContent += content
						onStream({ content, fullContent, done: chunk.done || false })
					}
					if (chunk.done) break
				} catch {
					// Skip malformed chunks
				}
			}
		}

		onStream({ content: "", fullContent, done: true })

		return {
			id: `stream_${Date.now()}`,
			model: body.model,
			content: fullContent,
			usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
		}
	}

	/**
	 * Generate embeddings for a text.
	 * @param {string} text
	 * @param {string} [model] — Model to use for embeddings
	 * @returns {Promise<number[]>}
	 */
	async function embed(text, model) {
		const embedModel = model || "hermes3"
		const url = `${baseUrl}/api/embed`

		const response = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ model: embedModel, input: text }),
		})

		if (!response.ok) {
			throw new Error(`Ollama embedding error (${response.status})`)
		}

		const data = await response.json()
		return data.embeddings?.[0] || []
	}

	/**
	 * List available models from the Ollama instance.
	 * @returns {Promise<Array<{name: string, modifiedAt: string, size: number}>>}
	 */
	async function listModels() {
		try {
			const response = await fetch(`${baseUrl}/api/tags`)
			if (!response.ok) return []
			const data = await response.json()
			return (data.models || []).map((m) => ({
				name: m.name,
				modifiedAt: m.modified_at,
				size: m.size,
			}))
		} catch {
			return []
		}
	}

	/**
	 * Test the API connection.
	 * @returns {Promise<boolean>}
	 */
	async function testConnection() {
		try {
			const response = await fetch(`${baseUrl}/api/tags`)
			return response.ok
		} catch {
			return false
		}
	}

	return {
		definition,
		chat,
		embed,
		listModels,
		testConnection,
	}
}

module.exports = { createProvider }
