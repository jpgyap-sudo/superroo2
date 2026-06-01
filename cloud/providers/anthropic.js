/**
 * Anthropic Provider — Modular provider package.
 *
 * Supports Claude Sonnet 4, Haiku 3.5, and Opus models with extended thinking.
 *
 * @module cloud/providers/anthropic
 */

/**
 * Models that support adaptive thinking (effort param) instead of legacy budget_tokens.
 * @type {string[]}
 */
const ADAPTIVE_THINKING_PREFIXES = ["claude-opus-4", "claude-sonnet-4-6", "claude-haiku-4-5"]

/**
 * Convert legacy budgetTokens value to an effort string for adaptive thinking.
 * @param {number} tokens
 * @returns {string}
 */
function _budgetTokensToEffort(tokens) {
	if (tokens <= 1024) return "low"
	if (tokens <= 4096) return "medium"
	if (tokens <= 8192) return "high"
	return "xhigh"
}

/**
 * Build the thinking block for a request, model-aware.
 * New models (opus-4-x, sonnet-4-6, haiku-4-5) use adaptive thinking with effort.
 * Legacy models fall back to budget_tokens.
 * @param {string} model
 * @param {{ effort?: string, budgetTokens?: number }} reasoning
 * @returns {Object|null}
 */
function _buildThinking(model, reasoning) {
	if (!reasoning) return null
	const isAdaptive = ADAPTIVE_THINKING_PREFIXES.some((p) => model.startsWith(p))
	if (isAdaptive) {
		const effort =
			reasoning.effort || (reasoning.budgetTokens ? _budgetTokensToEffort(reasoning.budgetTokens) : "medium")
		return { type: "adaptive", effort }
	}
	if (reasoning.budgetTokens) return { type: "enabled", budget_tokens: reasoning.budgetTokens }
	if (reasoning.effort) return { type: "adaptive", effort: reasoning.effort }
	return null
}

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
		description: "Claude Opus 4.8, Sonnet 4.6, and Haiku 4.5 models",
		envName: "ANTHROPIC_API_KEY",
		website: "https://anthropic.com",
		docsUrl: "https://docs.anthropic.com",
		apiBaseUrl: baseUrl,
		defaultModel: "claude-sonnet-4-6",
		models: [
			{
				id: "claude-opus-4-8",
				name: "Claude Opus 4.8",
				contextWindow: 1000000,
				supportsVision: true,
				supportsTools: true,
				supportsReasoning: true,
				inputCostPerMTok: 5,
				outputCostPerMTok: 25,
				bestFor: ["complex reasoning", "architecture", "deep debugging"],
			},
			{
				id: "claude-sonnet-4-6",
				name: "Claude Sonnet 4.6",
				contextWindow: 200000,
				supportsVision: true,
				supportsTools: true,
				supportsReasoning: true,
				inputCostPerMTok: 3,
				outputCostPerMTok: 15,
				bestFor: ["UI debugging", "frontend review", "code review"],
			},
			{
				id: "claude-haiku-4-5-20251001",
				name: "Claude Haiku 4.5",
				contextWindow: 200000,
				supportsVision: true,
				supportsTools: true,
				supportsReasoning: false,
				inputCostPerMTok: 0.8,
				outputCostPerMTok: 4,
				bestFor: ["fast tasks", "classification", "summaries"],
			},
			{
				id: "claude-sonnet-4-20250514",
				name: "Claude Sonnet 4 (legacy)",
				contextWindow: 200000,
				supportsVision: true,
				supportsTools: true,
				supportsReasoning: true,
				inputCostPerMTok: 3,
				outputCostPerMTok: 15,
				bestFor: ["legacy workloads"],
			},
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
	 * Convert messages to Anthropic format with cache_control markers.
	 * System prompt gets a single ephemeral cache point.
	 * The last 2 user messages get cache points on their final content block.
	 * @param {import("./types").ChatMessage[]} messages
	 * @returns {{ system?: Object[], messages: Object[] }}
	 */
	function _formatMessages(messages) {
		let systemText = ""
		const msgs = []

		for (const msg of messages) {
			if (msg.role === "system") {
				systemText = (systemText ? systemText + "\n" : "") + msg.content
			} else if (msg.role === "tool") {
				msgs.push({
					role: "user",
					content: [{ type: "tool_result", tool_use_id: msg.name, content: msg.content }],
				})
			} else {
				const content = typeof msg.content === "string" ? [{ type: "text", text: msg.content }] : msg.content
				msgs.push({ role: msg.role, content })
			}
		}

		// Cache the system prompt as a single text block
		const system = systemText
			? [{ type: "text", text: systemText, cache_control: { type: "ephemeral" } }]
			: undefined

		// Add cache_control to the last content block of the last 2 user messages
		const userMsgs = msgs.filter((m) => m.role === "user")
		for (const msg of userMsgs.slice(-2)) {
			const blocks = Array.isArray(msg.content) ? msg.content : []
			const lastTextBlock = [...blocks].reverse().find((b) => b.type === "text" || b.type === "tool_result")
			if (lastTextBlock) {
				lastTextBlock.cache_control = { type: "ephemeral" }
			}
		}

		return { system, messages: msgs }
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
			body.tool_choice =
				opts.toolChoice === "required"
					? { type: "any" }
					: opts.toolChoice === "none"
						? { type: "none" }
						: { type: "auto" }
		}

		// Apply thinking — adaptive (effort) for new models, legacy budget_tokens for old
		if (opts.reasoning) {
			const thinking = _buildThinking(model, opts.reasoning)
			if (thinking) body.thinking = thinking
		}

		const headers = {
			"Content-Type": "application/json",
			"x-api-key": apiKey,
			"anthropic-version": "2023-06-01",
			"anthropic-beta": "prompt-caching-2024-07-31",
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
				cacheReadTokens: data.usage?.cache_read_input_tokens || 0,
				cacheCreationTokens: data.usage?.cache_creation_input_tokens || 0,
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
					"anthropic-beta": "prompt-caching-2024-07-31",
				},
				body: JSON.stringify({
					model: "claude-sonnet-4-6",
					max_tokens: 1,
					messages: [{ role: "user", content: "ping" }],
				}),
			})
			return response.ok
		} catch {
			return false
		}
	}

	/**
	 * Submit a batch of message requests (50% cheaper, up to 300k output tokens).
	 * Returns a batch object with an id — poll getBatch(id) until processing_status === "ended".
	 * @param {Array<{id?: string, model?: string, messages: Object[], system?: string, maxTokens?: number}>} requests
	 * @param {Object} [opts]
	 * @returns {Promise<Object>} Batch object
	 */
	async function batch(requests, opts = {}) {
		const url = `${baseUrl}/messages/batches`
		const headers = {
			"Content-Type": "application/json",
			"x-api-key": apiKey,
			"anthropic-version": "2023-06-01",
			"anthropic-beta": "message-batches-2024-09-24",
		}
		const body = {
			requests: requests.map((req, i) => ({
				custom_id: req.id || `req_${i}`,
				params: {
					model: req.model || opts.model || definition.defaultModel,
					max_tokens: req.maxTokens || opts.maxTokens || 4096,
					messages: req.messages,
					...(req.system ? { system: [{ type: "text", text: req.system }] } : {}),
				},
			})),
		}
		const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: opts.signal })
		if (!response.ok) {
			const err = await response.text().catch(() => "Unknown error")
			throw new Error(`Anthropic Batch API error (${response.status}): ${err}`)
		}
		return response.json()
	}

	/**
	 * Poll the status of a batch by ID.
	 * @param {string} batchId
	 * @returns {Promise<Object>}
	 */
	async function getBatch(batchId) {
		const response = await fetch(`${baseUrl}/messages/batches/${batchId}`, {
			headers: {
				"x-api-key": apiKey,
				"anthropic-version": "2023-06-01",
				"anthropic-beta": "message-batches-2024-09-24",
			},
		})
		if (!response.ok) throw new Error(`Batch status error (${response.status})`)
		return response.json()
	}

	/**
	 * Retrieve results for a completed batch (JSONL, one result per line).
	 * @param {string} batchId
	 * @returns {Promise<Object[]>}
	 */
	async function getBatchResults(batchId) {
		const response = await fetch(`${baseUrl}/messages/batches/${batchId}/results`, {
			headers: {
				"x-api-key": apiKey,
				"anthropic-version": "2023-06-01",
				"anthropic-beta": "message-batches-2024-09-24",
			},
		})
		if (!response.ok) throw new Error(`Batch results error (${response.status})`)
		const text = await response.text()
		return text
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line))
	}

	return {
		definition,
		chat,
		testConnection,
		batch,
		getBatch,
		getBatchResults,
	}
}

module.exports = { createProvider }
