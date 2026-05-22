/**
 * OpenAI Provider — Modular provider package.
 *
 * Supports GPT-4o, GPT-4o-mini, and o-series reasoning models.
 *
 * @module cloud/providers/openai
 */

/**
 * Create an OpenAI provider instance.
 * @param {Object} [options]
 * @param {string} [options.apiKey] — API key (falls back to OPENAI_API_KEY env var)
 * @param {string} [options.apiBaseUrl] — Base URL override
 * @returns {import("./types").Provider}
 */
function createProvider(options = {}) {
	const apiKey = options.apiKey || process.env.OPENAI_API_KEY || ""
	const baseUrl = (options.apiBaseUrl || "https://api.openai.com/v1").replace(/\/+$/, "")

	/** @type {import("./types").ProviderDefinition} */
	const definition = {
		id: "openai",
		name: "OpenAI",
		description: "GPT-4o, GPT-4o-mini, and o-series models",
		envName: "OPENAI_API_KEY",
		website: "https://openai.com",
		docsUrl: "https://platform.openai.com/docs",
		apiBaseUrl: baseUrl,
		defaultModel: "gpt-4o",
		models: [
			{ id: "gpt-4o", name: "GPT-4o", contextWindow: 128000, supportsVision: true, supportsTools: true, supportsReasoning: false, inputCostPerMTok: 2.5, outputCostPerMTok: 10, bestFor: ["planning", "orchestration", "reasoning"] },
			{ id: "gpt-4o-mini", name: "GPT-4o Mini", contextWindow: 128000, supportsVision: true, supportsTools: true, supportsReasoning: false, inputCostPerMTok: 0.15, outputCostPerMTok: 0.6, bestFor: ["cheap tasks", "classification", "summaries"] },
			{ id: "o3-mini", name: "o3-mini", contextWindow: 200000, supportsVision: false, supportsTools: true, supportsReasoning: true, inputCostPerMTok: 1.1, outputCostPerMTok: 4.4, bestFor: ["reasoning", "math", "science"] },
		],
		capabilities: {
			chat: true,
			vision: true,
			functionCalling: true,
			structuredOutput: true,
			reasoning: true,
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
		const url = `${baseUrl}/chat/completions`

		/** @type {Object} */
		const body = {
			model,
			messages: messages.map((m) => ({
				role: m.role,
				content: m.content,
				...(m.toolCalls ? { tool_calls: m.toolCalls } : {}),
			})),
			temperature: opts.temperature ?? 0.7,
			max_tokens: opts.maxTokens,
			top_p: opts.topP,
			stop: opts.stop,
			stream: !!opts.onStream,
		}

		if (opts.tools && opts.tools.length > 0) {
			body.tools = opts.tools
			body.tool_choice = opts.toolChoice || "auto"
		}

		// Apply reasoning effort for o-series models
		if (opts.reasoning) {
			const effort = opts.reasoning.budgetTokens > 16000 ? "high"
				: opts.reasoning.budgetTokens > 8000 ? "medium"
				: "low"
			body.reasoning_effort = effort
		}

		if (opts.onStream) {
			return _streamChat(url, apiKey, body, opts.onStream, opts.signal)
		}

		const response = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify(body),
			signal: opts.signal,
		})

		if (!response.ok) {
			const errorText = await response.text().catch(() => "Unknown error")
			throw new Error(`OpenAI API error (${response.status}): ${errorText}`)
		}

		const data = await response.json()
		const choice = data.choices?.[0]

		return {
			id: data.id,
			model: data.model || model,
			content: choice?.message?.content || "",
			toolCalls: choice?.message?.tool_calls,
			usage: {
				promptTokens: data.usage?.prompt_tokens || 0,
				completionTokens: data.usage?.completion_tokens || 0,
				totalTokens: data.usage?.total_tokens || 0,
			},
		}
	}

	/**
	 * Stream a chat completion response.
	 * @param {string} url
	 * @param {string} key
	 * @param {Object} body
	 * @param {Function} onStream
	 * @param {AbortSignal} [signal]
	 * @returns {Promise<import("./types").ChatResponse>}
	 */
	async function _streamChat(url, key, body, onStream, signal) {
		const response = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${key}`,
			},
			body: JSON.stringify(body),
			signal,
		})

		if (!response.ok) {
			const errorText = await response.text().catch(() => "Unknown error")
			throw new Error(`OpenAI streaming error (${response.status}): ${errorText}`)
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
				if (!trimmed || !trimmed.startsWith("data: ")) continue
				const jsonStr = trimmed.slice(6)
				if (jsonStr === "[DONE]") continue

				try {
					const chunk = JSON.parse(jsonStr)
					const delta = chunk.choices?.[0]?.delta
					const content = delta?.content || ""
					if (content) {
						fullContent += content
						onStream({ content, fullContent, done: false })
					}
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
	 * Test the API connection.
	 * @param {string} [key] — API key to test
	 * @returns {Promise<boolean>}
	 */
	async function testConnection(key) {
		const testKey = key || apiKey
		if (!testKey) return false
		try {
			const response = await fetch(`${baseUrl}/models`, {
				headers: { Authorization: `Bearer ${testKey}` },
			})
			return response.ok
		} catch {
			return false
		}
	}

	return {
		definition,
		chat,
		testConnection,
	}
}

module.exports = { createProvider }
