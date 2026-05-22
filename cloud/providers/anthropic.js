/**
 * Anthropic Provider — Modular provider package.
 *
 * Supports Claude Sonnet 4, Haiku 3.5, and Opus models with extended thinking.
 *
 * @module cloud/providers/anthropic
 */

/**
 * Create an Anthropic provider instance.
 * @param {Object} [options]
 * @param {string} [options.apiKey] — API key (falls back to ANTHROPIC_API_KEY env var)
 * @param {string} [options.apiBaseUrl] — Base URL override
 * @returns {import("./types").Provider}
 */
function createProvider(options = {}) {
	const apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY || ""
	const baseUrl = (options.apiBaseUrl || "https://api.anthropic.com/v1").replace(/\/+$/, "")

	/** @type {import("./types").ProviderDefinition} */
	const definition = {
		id: "anthropic",
		name: "Anthropic",
		description: "Claude Sonnet 4, Haiku 3.5, and Opus models",
		envName: "ANTHROPIC_API_KEY",
		website: "https://anthropic.com",
		docsUrl: "https://docs.anthropic.com",
		apiBaseUrl: baseUrl,
		defaultModel: "claude-sonnet-4-20250514",
		models: [
			{ id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", contextWindow: 200000, supportsVision: true, supportsTools: true, supportsReasoning: true, inputCostPerMTok: 3, outputCostPerMTok: 15, bestFor: ["UI debugging", "frontend review", "code review"] },
			{ id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku", contextWindow: 200000, supportsVision: true, supportsTools: true, supportsReasoning: false, inputCostPerMTok: 0.8, outputCostPerMTok: 4, bestFor: ["fast tasks", "classification", "summaries"] },
		],
		capabilities: {
			chat: true,
			vision: true,
			functionCalling: true,
			structuredOutput: false,
			reasoning: true,
			streaming: true,
			embedding: false,
		},
		headers: {
			"anthropic-version": "2023-06-01",
		},
	}

	/**
	 * Convert messages to Anthropic format.
	 * @param {import("./types").ChatMessage[]} messages
	 * @returns {{ system?: string, messages: Object[] }}
	 */
	function _formatMessages(messages) {
		let system = ""
		const msgs = []

		for (const msg of messages) {
			if (msg.role === "system") {
				system = (system ? system + "\n" : "") + msg.content
			} else if (msg.role === "tool") {
				msgs.push({
					role: "user",
					content: [{ type: "tool_result", tool_use_id: msg.name, content: msg.content }],
				})
			} else {
				msgs.push({ role: msg.role, content: msg.content })
			}
		}

		return { system: system || undefined, messages: msgs }
	}

	/**
	 * Send a chat completion request.
	 * @param {import("./types").ChatMessage[]} messages
	 * @param {import("./types").ChatOptions} [opts]
	 * @returns {Promise<import("./types").ChatResponse>}
	 */
	async function chat(messages, opts = {}) {
		const model = opts.model || definition.defaultModel
		const url = `${baseUrl}/messages`
		const { system, messages: formattedMessages } = _formatMessages(messages)

		/** @type {Object} */
		const body = {
			model,
			messages: formattedMessages,
			max_tokens: opts.maxTokens || 4096,
			temperature: opts.temperature ?? 0.7,
			top_p: opts.topP,
			stop_sequences: opts.stop,
			stream: !!opts.onStream,
		}

		if (system) body.system = system

		if (opts.tools && opts.tools.length > 0) {
			body.tools = opts.tools.map((t) => ({
				name: t.name || t.function?.name,
				description: t.description || t.function?.description,
				input_schema: t.input_schema || t.function?.parameters,
			}))
			body.tool_choice = opts.toolChoice === "required" ? { type: "any" }
				: opts.toolChoice === "none" ? { type: "none" }
				: { type: "auto" }
		}

		// Apply extended thinking
		if (opts.reasoning && opts.reasoning.budgetTokens) {
			body.thinking = { type: "enabled", budget_tokens: opts.reasoning.budgetTokens }
		}

		const headers = {
			"Content-Type": "application/json",
			"x-api-key": apiKey,
			"anthropic-version": "2023-06-01",
		}

		if (opts.onStream) {
			return _streamChat(url, headers, body, opts.onStream, opts.signal)
		}

		const response = await fetch(url, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
			signal: opts.signal,
		})

		if (!response.ok) {
			const errorText = await response.text().catch(() => "Unknown error")
			throw new Error(`Anthropic API error (${response.status}): ${errorText}`)
		}

		const data = await response.json()

		return {
			id: data.id,
			model: data.model || model,
			content: data.content?.find((c) => c.type === "text")?.text || "",
			toolCalls: data.content
				?.filter((c) => c.type === "tool_use")
				.map((c) => ({
					id: c.id,
					type: "function",
					function: { name: c.name, arguments: JSON.stringify(c.input) },
				})),
			usage: {
				promptTokens: data.usage?.input_tokens || 0,
				completionTokens: data.usage?.output_tokens || 0,
				totalTokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
			},
			reasoning: data.content?.find((c) => c.type === "thinking")
				? { content: data.content.find((c) => c.type === "thinking").text }
				: undefined,
		}
	}

	/**
	 * Stream a chat completion response (SSE).
	 * @param {string} url
	 * @param {Object} headers
	 * @param {Object} body
	 * @param {Function} onStream
	 * @param {AbortSignal} [signal]
	 * @returns {Promise<import("./types").ChatResponse>}
	 */
	async function _streamChat(url, headers, body, onStream, signal) {
		const response = await fetch(url, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
			signal,
		})

		if (!response.ok) {
			const errorText = await response.text().catch(() => "Unknown error")
			throw new Error(`Anthropic streaming error (${response.status}): ${errorText}`)
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
					if (chunk.type === "content_block_delta" && chunk.delta?.text) {
						fullContent += chunk.delta.text
						onStream({ content: chunk.delta.text, fullContent, done: false })
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
			const response = await fetch(`${baseUrl}/messages`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-api-key": testKey,
					"anthropic-version": "2023-06-01",
				},
				body: JSON.stringify({
					model: "claude-sonnet-4-20250514",
					max_tokens: 1,
					messages: [{ role: "user", content: "ping" }],
				}),
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
