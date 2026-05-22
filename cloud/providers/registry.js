/**
 * Provider Registry — Auto-discovery provider registry.
 *
 * Discovers and manages all provider packages. Supports:
 * - Auto-discovery of provider modules in the providers directory
 * - Registration of custom provider instances
 * - Provider selection by capability
 * - Connection testing
 * - Provider lifecycle management
 * - Cost/latency tracking for cost-optimized routing
 *
 * @module cloud/providers/registry
 */

const path = require("node:path")
const fs = require("node:fs")

class ProviderRegistry {
	constructor() {
		/** @type {Map<string, import("./types").Provider>} */
		this._providers = new Map()

		/** @type {Map<string, import("./types").ProviderDefinition>} */
		this._definitions = new Map()

		/** @type {boolean} */
		this._discovered = false

		/** @type {Map<string, { costPerRequest: number, latencyMs: number, totalTokens: number, requestCount: number, lastUsed: number }>} */
		this._usageStats = new Map()

		/** @type {Map<string, { status: string, lastTestedAt: number|null, latencyMs: number|null, hasKey: boolean, keyHash: string|null }>} */
		this._connectionMeta = new Map()
	}

	/**
	 * Auto-discover provider modules in the providers directory.
	 * Scans for .js files (excluding types.js, registry.js, index.js) and loads them.
	 * @returns {Promise<string[]>} — List of discovered provider IDs
	 */
	async discover() {
		if (this._discovered) return Array.from(this._providers.keys())

		const dir = __dirname
		const files = fs.readdirSync(dir).filter(
			(f) => f.endsWith(".js") && !["types.js", "registry.js", "index.js"].includes(f),
		)

		const discovered = []

		for (const file of files) {
			try {
				const mod = require(path.join(dir, file))
				if (typeof mod.createProvider !== "function") continue

				const provider = mod.createProvider()
				const id = provider.definition.id

				if (this._providers.has(id)) continue

				this._providers.set(id, provider)
				this._definitions.set(id, provider.definition)
				discovered.push(id)
			} catch (err) {
				console.warn(`[ProviderRegistry] Failed to load ${file}:`, err.message)
			}
		}

		this._discovered = true
		return discovered
	}

	/**
	 * Register a provider instance.
	 * @param {import("./types").Provider} provider
	 */
	register(provider) {
		const id = provider.definition.id
		this._providers.set(id, provider)
		this._definitions.set(id, provider.definition)
	}

	/**
	 * Get a provider by ID.
	 * @param {string} id — Provider identifier
	 * @returns {import("./types").Provider|undefined}
	 */
	getProvider(id) {
		return this._providers.get(id)
	}

	/**
	 * Get a provider definition by ID.
	 * @param {string} id
	 * @returns {import("./types").ProviderDefinition|undefined}
	 */
	getDefinition(id) {
		return this._definitions.get(id)
	}

	/**
	 * Get all registered providers.
	 * @returns {import("./types").Provider[]}
	 */
	getAllProviders() {
		return Array.from(this._providers.values())
	}

	/**
	 * Get all provider definitions.
	 * @returns {import("./types").ProviderDefinition[]}
	 */
	getAllDefinitions() {
		return Array.from(this._definitions.values())
	}

	/**
	 * Select providers that match required capabilities.
	 * @param {Object} [criteria]
	 * @param {string[]} [criteria.capabilities] — Required capabilities
	 * @param {boolean} [criteria.local] — Whether to include local-only providers
	 * @param {boolean} [criteria.hasKey] — Whether provider must have an API key configured
	 * @returns {import("./types").ProviderDefinition[]}
	 */
	selectProviders(criteria = {}) {
		let defs = this.getAllDefinitions()

		if (criteria.local !== undefined) {
			defs = defs.filter((d) => d.local === criteria.local)
		}

		if (criteria.hasKey !== undefined) {
			defs = defs.filter((d) => {
				if (d.local) return true // Local providers don't need keys
				if (!d.envName) return !criteria.hasKey
				const hasKey = !!process.env[d.envName]
				return hasKey === criteria.hasKey
			})
		}

		if (criteria.capabilities && criteria.capabilities.length > 0) {
			const { providerHasCapabilities } = require("./types")
			defs = defs.filter((d) => providerHasCapabilities(d, criteria.capabilities))
		}

		return defs
	}

	/**
	 * Get the best provider for a task type.
	 * @param {string} taskType — Task type identifier
	 * @param {Object} [options]
	 * @param {boolean} [options.requireKey=true] — Whether to require configured API key
	 * @returns {import("./types").ProviderDefinition|undefined}
	 */
	getProviderForTask(taskType, options = {}) {
		const requireKey = options.requireKey !== false

		const taskToCapabilities = {
			coding: ["chat"],
			debugging: ["chat"],
			planning: ["chat"],
			reasoning: ["chat", "reasoning"],
			vision: ["chat", "vision"],
			embedding: ["embedding"],
			classification: ["chat"],
			summarization: ["chat"],
			review: ["chat", "vision"],
		}

		const caps = taskToCapabilities[taskType]
		if (!caps) return undefined

		const candidates = this.selectProviders({
			capabilities: caps,
			hasKey: requireKey ? true : undefined,
			local: taskType === "embedding" ? true : undefined,
		})

		if (candidates.length === 0) return undefined

		// Prefer providers with lower cost for coding/debugging
		if (taskType === "coding" || taskType === "debugging") {
			const sorted = [...candidates].sort((a, b) => {
				const aCost = a.models[0]?.inputCostPerMTok ?? Infinity
				const bCost = b.models[0]?.inputCostPerMTok ?? Infinity
				return aCost - bCost
			})
			return sorted[0]
		}

		return candidates[0]
	}

	/**
	 * Test connection for a specific provider.
	 * @param {string} id — Provider ID
	 * @param {string} [apiKey] — Optional API key override
	 * @returns {Promise<boolean>}
	 */
	async testConnection(id, apiKey) {
		const provider = this._providers.get(id)
		if (!provider) return false
		try {
			return await provider.testConnection(apiKey)
		} catch {
			return false
		}
	}

	/**
	 * Test connections for all registered providers.
	 * @returns {Promise<Object<string, boolean>>} — Map of provider ID to connection status
	 */
	async testAllConnections() {
		const results = {}
		const entries = Array.from(this._providers.entries())

		await Promise.allSettled(
			entries.map(async ([id, provider]) => {
				try {
					results[id] = await provider.testConnection()
				} catch {
					results[id] = false
				}
			}),
		)

		return results
	}

	/**
	 * Remove a provider from the registry.
	 * @param {string} id
	 */
	unregister(id) {
		this._providers.delete(id)
		this._definitions.delete(id)
	}

	/**
	 * Clear all providers.
	 */
	clear() {
		this._providers.clear()
		this._definitions.clear()
		this._discovered = false
		this._usageStats.clear()
		this._connectionMeta.clear()
	}

	/**
	 * Track usage for cost-optimized routing.
	 * @param {string} providerId
	 * @param {{ costPerRequest?: number, latencyMs?: number, tokens?: number }} usage
	 */
	trackUsage(providerId, usage = {}) {
		const existing = this._usageStats.get(providerId) || {
			costPerRequest: 0,
			latencyMs: 0,
			totalTokens: 0,
			requestCount: 0,
			lastUsed: 0,
		}
		existing.requestCount++
		existing.lastUsed = Date.now()
		if (usage.costPerRequest !== undefined) {
			existing.costPerRequest = (existing.costPerRequest * (existing.requestCount - 1) + usage.costPerRequest) / existing.requestCount
		}
		if (usage.latencyMs !== undefined) {
			existing.latencyMs = (existing.latencyMs * (existing.requestCount - 1) + usage.latencyMs) / existing.requestCount
		}
		if (usage.tokens !== undefined) {
			existing.totalTokens += usage.tokens
		}
		this._usageStats.set(providerId, existing)
	}

	/**
	 * Get usage stats for all providers.
	 * @returns {Object<string, { costPerRequest: number, latencyMs: number, totalTokens: number, requestCount: number, lastUsed: number }>}
	 */
	getUsageStats() {
		const result = {}
		for (const [id, stats] of this._usageStats) {
			result[id] = { ...stats }
		}
		return result
	}

	/**
	 * Get usage stats for a specific provider.
	 * @param {string} providerId
	 * @returns {{ costPerRequest: number, latencyMs: number, totalTokens: number, requestCount: number, lastUsed: number }|undefined}
	 */
	getProviderUsageStats(providerId) {
		const stats = this._usageStats.get(providerId)
		return stats ? { ...stats } : undefined
	}

	/**
	 * Update connection metadata for a provider.
	 * @param {string} providerId
	 * @param {Partial<{ status: string, latencyMs: number|null, hasKey: boolean, keyHash: string|null }>} meta
	 */
	updateConnectionMeta(providerId, meta = {}) {
		const existing = this._connectionMeta.get(providerId) || {
			status: "not_tested",
			lastTestedAt: null,
			latencyMs: null,
			hasKey: false,
			keyHash: null,
		}
		if (meta.status !== undefined) existing.status = meta.status
		if (meta.latencyMs !== undefined) existing.latencyMs = meta.latencyMs
		if (meta.hasKey !== undefined) existing.hasKey = meta.hasKey
		if (meta.keyHash !== undefined) existing.keyHash = meta.keyHash
		existing.lastTestedAt = Date.now()
		this._connectionMeta.set(providerId, existing)
	}

	/**
	 * Get connection metadata for all providers.
	 * @returns {Object<string, { status: string, lastTestedAt: number|null, latencyMs: number|null, hasKey: boolean, keyHash: string|null }>}
	 */
	getConnectionMeta() {
		const result = {}
		for (const [id, meta] of this._connectionMeta) {
			result[id] = { ...meta }
		}
		return result
	}

	/**
	 * Get the most cost-effective provider for a task type.
	 * @param {string} taskType
	 * @param {Object} [options]
	 * @returns {import("./types").ProviderDefinition|undefined}
	 */
	getCheapestProvider(taskType, options = {}) {
		const candidates = this.selectProviders(options)
		if (candidates.length === 0) return undefined

		return candidates.sort((a, b) => {
			const aStats = this._usageStats.get(a.id)
			const bStats = this._usageStats.get(b.id)
			const aCost = aStats ? aStats.costPerRequest : (a.models[0]?.inputCostPerMTok ?? Infinity)
			const bCost = bStats ? bStats.costPerRequest : (b.models[0]?.inputCostPerMTok ?? Infinity)
			return aCost - bCost
		})[0]
	}

	/**
	 * Get registry summary.
	 * @returns {Object}
	 */
	getSummary() {
		return {
			providerCount: this._providers.size,
			providers: this.getAllDefinitions().map((d) => ({
				id: d.id,
				name: d.name,
				local: !!d.local,
				modelCount: d.models.length,
				defaultModel: d.defaultModel,
				capabilities: Object.entries(d.capabilities)
					.filter(([, v]) => v)
					.map(([k]) => k),
			})),
			usageStats: this.getUsageStats(),
			connectionMeta: this.getConnectionMeta(),
		}
	}
}

// Singleton instance
let _instance = null

/**
 * Get the global ProviderRegistry singleton.
 * @returns {ProviderRegistry}
 */
function getProviderRegistry() {
	if (!_instance) {
		_instance = new ProviderRegistry()
	}
	return _instance
}

module.exports = { ProviderRegistry, getProviderRegistry }
