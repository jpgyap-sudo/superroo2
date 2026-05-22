/**
 * Provider Registry Bridge — Syncs the new modular provider registry
 * with the legacy api.js PROVIDERS array, providerMeta Map, and
 * encrypted secrets store.
 *
 * This bridge ensures backward compatibility while allowing the new
 * ProviderRegistry (with auto-discovery, capability-based selection,
 * cost/latency tracking) to be the single source of truth.
 *
 * @module cloud/providers/bridge
 */

const { getProviderRegistry } = require("./registry")

/**
 * @typedef {Object} BridgeOptions
 * @property {Array} [legacyProviders] — The old PROVIDERS array from api.js
 * @property {Map} [legacyProviderMeta] — The old providerMeta Map from api.js
 * @property {Map} [legacyEncryptedSecrets] — The old encryptedSecrets Map from api.js
 * @property {Function} [legacyResolveProviderForTask] — The old resolveProviderForTask function
 * @property {Function} [legacyResolveProviderById] — The old resolveProviderById function
 */

/**
 * Bridge instance that connects the new ProviderRegistry to legacy api.js structures.
 */
class ProviderRegistryBridge {
	/**
	 * @param {BridgeOptions} options
	 */
	constructor(options = {}) {
		this._registry = getProviderRegistry()
		this._legacyProviders = options.legacyProviders || []
		this._legacyProviderMeta = options.legacyProviderMeta || new Map()
		this._legacyEncryptedSecrets = options.legacyEncryptedSecrets || new Map()
		this._legacyResolveProviderForTask = options.legacyResolveProviderForTask || null
		this._legacyResolveProviderById = options.legacyResolveProviderById || null
		this._synced = false
	}

	/**
	 * Initialize the bridge: discover providers and sync with legacy structures.
	 * @returns {Promise<void>}
	 */
	async initialize() {
		// Discover providers from the new modular system
		await this._registry.discover()

		// Sync legacy provider metadata into the new registry
		this._syncLegacyMeta()

		// Register any legacy providers not yet in the new registry
		this._registerLegacyProviders()

		this._synced = true
	}

	/**
	 * Sync legacy providerMeta into the new registry's connection metadata.
	 * @private
	 */
	_syncLegacyMeta() {
		for (const [providerId, meta] of this._legacyProviderMeta) {
			this._registry.updateConnectionMeta(providerId, {
				status: meta.status || "not_tested",
				latencyMs: meta.latencyMs || null,
				hasKey: !!meta.hasKey,
				keyHash: meta.keyHash || null,
			})
		}
	}

	/**
	 * Register any legacy providers that aren't in the new registry yet.
	 * @private
	 */
	_registerLegacyProviders() {
		for (const p of this._legacyProviders) {
			if (!this._registry.getProvider(p.id)) {
				// Create a minimal provider wrapper for backward compatibility
				const provider = this._createLegacyProviderWrapper(p)
				this._registry.register(provider)
			}
		}
	}

	/**
	 * Create a minimal provider wrapper from a legacy PROVIDERS entry.
	 * @param {Object} legacyProvider
	 * @returns {import("./types").Provider}
	 * @private
	 */
	_createLegacyProviderWrapper(legacyProvider) {
		const definition = {
			id: legacyProvider.id,
			name: legacyProvider.name,
			description: legacyProvider.description || "",
			envName: legacyProvider.envName || null,
			local: !!legacyProvider.local,
			apiBaseUrl: legacyProvider.apiBaseUrl || "",
			defaultModel: legacyProvider.defaultModel || "",
			models: (legacyProvider.models || []).map((m) => ({
				id: typeof m === "string" ? m : m.id,
				name: typeof m === "string" ? m : m.name,
			})),
			capabilities: {
				chat: legacyProvider.capabilities?.includes("chat") || false,
				vision: legacyProvider.capabilities?.includes("vision") || false,
				reasoning: legacyProvider.capabilities?.includes("reasoning") || legacyProvider.capabilities?.includes("extended-thinking") || false,
				embedding: legacyProvider.capabilities?.includes("embedding") || false,
				functionCalling: legacyProvider.capabilities?.includes("function-calling") || false,
			},
		}

		return {
			definition,
			chat: async () => ({ content: "", usage: {} }),
			testConnection: async () => true,
		}
	}

	/**
	 * Resolve a provider for a task type using the new registry,
	 * falling back to the legacy resolver if the new one returns nothing.
	 * @param {string} taskType
	 * @returns {Object|undefined}
	 */
	resolveProviderForTask(taskType) {
		// Try the new registry first
		const def = this._registry.getProviderForTask(taskType)
		if (def) {
			return {
				provider: def.id,
				model: def.defaultModel,
				apiBaseUrl: def.apiBaseUrl,
				capabilities: Object.entries(def.capabilities)
					.filter(([, v]) => v)
					.map(([k]) => k),
			}
		}

		// Fall back to legacy resolver
		if (this._legacyResolveProviderForTask) {
			return this._legacyResolveProviderForTask(taskType)
		}

		return undefined
	}

	/**
	 * Resolve a provider by ID, falling back to legacy.
	 * @param {string} providerId
	 * @param {string} [modelOverride]
	 * @returns {Object|undefined}
	 */
	resolveProviderById(providerId, modelOverride) {
		const def = this._registry.getDefinition(providerId)
		if (def) {
			return {
				provider: def.id,
				model: modelOverride || def.defaultModel,
				apiBaseUrl: def.apiBaseUrl,
			}
		}

		if (this._legacyResolveProviderById) {
			return this._legacyResolveProviderById(providerId, modelOverride)
		}

		return undefined
	}

	/**
	 * Get all providers with merged metadata (new registry + legacy meta).
	 * @returns {Array<Object>}
	 */
	getAllProviders() {
		const defs = this._registry.getAllDefinitions()
		const usageStats = this._registry.getUsageStats()
		const connectionMeta = this._registry.getConnectionMeta()

		return defs.map((d) => {
			const meta = connectionMeta[d.id] || { status: "not_tested", hasKey: false }
			const usage = usageStats[d.id] || null
			return {
				id: d.id,
				name: d.name,
				description: d.description,
				status: meta.status,
				hasKey: meta.hasKey,
				lastTestedAt: meta.lastTestedAt,
				latencyMs: meta.latencyMs,
				models: d.models.map((m) => m.id),
				modelLabels: Object.fromEntries(d.models.map((m) => [m.id, m.name])),
				capabilities: Object.entries(d.capabilities)
					.filter(([, v]) => v)
					.map(([k]) => k),
				defaultModel: d.defaultModel,
				apiBaseUrl: d.apiBaseUrl,
				local: !!d.local,
				usage,
			}
		})
	}

	/**
	 * Track usage for a provider and sync to legacy meta.
	 * @param {string} providerId
	 * @param {{ costPerRequest?: number, latencyMs?: number, tokens?: number }} usage
	 */
	trackUsage(providerId, usage = {}) {
		this._registry.trackUsage(providerId, usage)
	}

	/**
	 * Update connection metadata and sync to legacy meta.
	 * @param {string} providerId
	 * @param {Object} meta
	 */
	updateConnectionMeta(providerId, meta = {}) {
		this._registry.updateConnectionMeta(providerId, meta)

		// Also update legacy providerMeta for backward compatibility
		if (this._legacyProviderMeta) {
			const existing = this._legacyProviderMeta.get(providerId) || {}
			if (meta.status !== undefined) existing.status = meta.status
			if (meta.latencyMs !== undefined) existing.latencyMs = meta.latencyMs
			if (meta.hasKey !== undefined) existing.hasKey = meta.hasKey
			if (meta.keyHash !== undefined) existing.keyHash = meta.keyHash
			existing.lastTestedAt = Date.now()
			this._legacyProviderMeta.set(providerId, existing)
		}
	}

	/**
	 * Get the bridge status.
	 * @returns {Object}
	 */
	getStatus() {
		return {
			synced: this._synced,
			registryProviderCount: this._registry.getAllProviders().length,
			legacyProviderCount: this._legacyProviders.length,
			usageStats: this._registry.getUsageStats(),
			connectionMeta: this._registry.getConnectionMeta(),
		}
	}
}

/**
 * Create and initialize the provider registry bridge.
 * @param {BridgeOptions} options
 * @returns {Promise<ProviderRegistryBridge>}
 */
async function createProviderBridge(options = {}) {
	const bridge = new ProviderRegistryBridge(options)
	await bridge.initialize()
	return bridge
}

module.exports = { ProviderRegistryBridge, createProviderBridge }
