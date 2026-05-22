/**
 * Provider types for the modular provider extraction system.
 *
 * Defines the common interface that all provider packages must implement.
 * Each provider package exports a `createProvider()` function that returns
 * an object conforming to the Provider interface.
 *
 * @module cloud/providers/types
 */

/**
 * @typedef {Object} ProviderModel
 * @property {string} id — Model identifier (e.g., "gpt-4o")
 * @property {string} name — Human-readable name (e.g., "GPT-4o")
 * @property {number} [contextWindow] — Maximum context window in tokens
 * @property {boolean} [supportsVision] — Whether the model supports image inputs
 * @property {boolean} [supportsTools] — Whether the model supports function/tool calling
 * @property {boolean} [supportsReasoning] — Whether the model supports reasoning/thinking
 * @property {number} [inputCostPerMTok] — Cost per million input tokens (USD)
 * @property {number} [outputCostPerMTok] — Cost per million output tokens (USD)
 * @property {string[]} [bestFor] — Recommended use cases
 */

/**
 * @typedef {Object} ProviderCapabilities
 * @property {boolean} chat — Basic chat completion
 * @property {boolean} [vision] — Image understanding
 * @property {boolean} [functionCalling] — Tool/function calling
 * @property {boolean} [structuredOutput] — Structured/JSON output
 * @property {boolean} [reasoning] — Extended reasoning/thinking
 * @property {boolean} [streaming] — Streaming responses
 * @property {boolean} [embedding] — Text embeddings
 */

/**
 * @typedef {Object} ProviderDefinition
 * @property {string} id — Unique provider identifier
 * @property {string} name — Display name
 * @property {string} description — Short description
 * @property {string} envName — Environment variable name for API key (null if local)
 * @property {string} website — Provider website URL
 * @property {string} docsUrl — API documentation URL
 * @property {string} apiBaseUrl — Base URL for API requests
 * @property {string} defaultModel — Default model ID
 * @property {ProviderModel[]} models — Available models
 * @property {ProviderCapabilities} capabilities — Provider capabilities
 * @property {boolean} [local] — Whether this is a local provider (no API key needed)
 * @property {Object} [headers] — Additional HTTP headers for API requests
 */

/**
 * @typedef {Object} ChatMessage
 * @property {'system'|'user'|'assistant'|'tool'} role — Message role
 * @property {string} content — Message content
 * @property {string} [name] — Optional name for function calls
 * @property {Object[]} [toolCalls] — Tool calls from assistant
 */

/**
 * @typedef {Object} ChatOptions
 * @property {string} [model] — Model to use (defaults to provider default)
 * @property {number} [temperature] — Sampling temperature (0-2)
 * @property {number} [maxTokens] — Maximum tokens to generate
 * @property {number} [topP] — Nucleus sampling parameter
 * @property {string[]} [stop] — Stop sequences
 * @property {Object[]} [tools] — Available tools/functions
 * @property {'auto'|'none'|'required'} [toolChoice] — Tool choice mode
 * @property {Object} [reasoning] — Reasoning configuration
 * @property {number} [reasoning.budgetTokens] — Token budget for reasoning
 * @property {AbortSignal} [signal] — Abort signal for cancellation
 * @property {function(Object): void} [onStream] — Stream callback for partial responses
 */

/**
 * @typedef {Object} ChatResponse
 * @property {string} id — Response ID
 * @property {string} model — Model used
 * @property {string} content — Response content
 * @property {Object[]} [toolCalls] — Tool calls in response
 * @property {Object} usage — Token usage
 * @property {number} usage.promptTokens — Input tokens
 * @property {number} usage.completionTokens — Output tokens
 * @property {number} usage.totalTokens — Total tokens
 * @property {Object} [reasoning] — Reasoning content if applicable
 * @property {string} [reasoning.content] — Reasoning/thinking text
 */

/**
 * @typedef {Object} Provider
 * @property {ProviderDefinition} definition — Provider metadata
 * @property {function(ChatMessage[], ChatOptions): Promise<ChatResponse>} chat — Send a chat completion request
 * @property {function(string): boolean} testConnection — Test if the API key is valid
 * @property {function(): Object} [getHeaders] — Get HTTP headers for API requests
 * @property {function(): void} [dispose] — Cleanup resources
 */

/**
 * Check if a provider definition matches required capabilities.
 * @param {ProviderDefinition} def
 * @param {string[]} requiredCaps
 * @returns {boolean}
 */
function providerHasCapabilities(def, requiredCaps) {
	if (!requiredCaps || requiredCaps.length === 0) return true
	return requiredCaps.every((cap) => {
		switch (cap) {
			case "chat":
				return def.capabilities.chat === true
			case "vision":
				return def.capabilities.vision === true
			case "function-calling":
			case "tools":
				return def.capabilities.functionCalling === true
			case "structured-output":
				return def.capabilities.structuredOutput === true
			case "reasoning":
				return def.capabilities.reasoning === true
			case "streaming":
				return def.capabilities.streaming === true
			case "embedding":
				return def.capabilities.embedding === true
			default:
				return false
		}
	})
}

module.exports = { providerHasCapabilities }
