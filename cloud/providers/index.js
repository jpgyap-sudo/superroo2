/**
 * Modular Provider Extraction — Barrel exports.
 *
 * Extracts provider implementations into individual packages with
 * a common interface and auto-discovery registry.
 *
 * Each provider package exports a `createProvider(options)` function
 * that returns a Provider instance conforming to the Provider interface.
 *
 * @module cloud/providers
 */

const { ProviderRegistry, getProviderRegistry } = require("./registry")
const { providerHasCapabilities } = require("./types")

// Provider factory functions
const { createProvider: createDeepSeek } = require("./deepseek")
const { createProvider: createOpenAI } = require("./openai")
const { createProvider: createAnthropic } = require("./anthropic")
const { createProvider: createOllama } = require("./ollama")
const { createProvider: createKimi } = require("./kimi")
const { createProvider: createOpenRouter } = require("./openrouter")
const { createProvider: createGroq } = require("./groq")

/**
 * Create all provider instances and register them in the global registry.
 * @param {Object} [options]
 * @param {Object} [options.apiKeys] — Map of provider ID to API key
 * @returns {ProviderRegistry}
 */
function initializeProviders(options = {}) {
	const registry = getProviderRegistry()
	const apiKeys = options.apiKeys || {}

	const providers = [
		createDeepSeek({ apiKey: apiKeys.deepseek }),
		createOpenAI({ apiKey: apiKeys.openai }),
		createAnthropic({ apiKey: apiKeys.anthropic }),
		createOllama(),
		createKimi({ apiKey: apiKeys.kimi }),
		createOpenRouter({ apiKey: apiKeys.openrouter }),
		createGroq({ apiKey: apiKeys.groq }),
	]

	for (const provider of providers) {
		registry.register(provider)
	}

	return registry
}

module.exports = {
	// Registry
	ProviderRegistry,
	getProviderRegistry,
	initializeProviders,

	// Utility
	providerHasCapabilities,

	// Provider factories
	createDeepSeek,
	createOpenAI,
	createAnthropic,
	createOllama,
	createKimi,
	createOpenRouter,
	createGroq,
}
