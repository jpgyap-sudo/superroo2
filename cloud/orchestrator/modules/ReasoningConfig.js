/**
 * SuperRoo Cloud — Reasoning Configuration System
 *
 * Provides provider-agnostic ReasoningLevel abstraction and per-provider
 * reasoning mapping for configuring model reasoning effort.
 *
 * Part of Sprint 3 — Reasoning Configuration UI (F6)
 * Inspired by: Theia's ReasoningLevel (off/minimal/low/medium/high/auto)
 *              + ReasoningApi (effort/budget)
 */

/**
 * Reasoning levels — ordered from least to most reasoning effort
 * @enum {string}
 */
const ReasoningLevel = Object.freeze({
	OFF: "off",
	MINIMAL: "minimal",
	LOW: "low",
	MEDIUM: "medium",
	HIGH: "high",
	AUTO: "auto",
})

/**
 * Numeric mapping for comparison
 */
const REASONING_LEVEL_ORDER = {
	[ReasoningLevel.OFF]: 0,
	[ReasoningLevel.MINIMAL]: 1,
	[ReasoningLevel.LOW]: 2,
	[ReasoningLevel.MEDIUM]: 3,
	[ReasoningLevel.HIGH]: 4,
	[ReasoningLevel.AUTO]: 5,
}

class ReasoningConfig {
	constructor() {
		// Default reasoning level per model
		this._defaults = new Map()

		// Per-provider reasoning mapping functions
		this._providerMappings = new Map()

		// Per-task-type reasoning overrides
		this._taskOverrides = new Map()

		// Register built-in provider mappings
		this._registerBuiltinMappings()
	}

	/**
	 * Register built-in provider-specific reasoning mappings
	 * @private
	 */
	_registerBuiltinMappings() {
		// OpenAI — uses reasoning_effort parameter
		this.registerProviderMapping("openai", (level) => {
			switch (level) {
				case ReasoningLevel.OFF:
					return { reasoning_effort: null }
				case ReasoningLevel.MINIMAL:
				case ReasoningLevel.LOW:
					return { reasoning_effort: "low" }
				case ReasoningLevel.MEDIUM:
					return { reasoning_effort: "medium" }
				case ReasoningLevel.HIGH:
					return { reasoning_effort: "high" }
				case ReasoningLevel.AUTO:
					return { reasoning_effort: "auto" }
				default:
					return {}
			}
		})

		// Anthropic — adaptive thinking with effort (budget_tokens deprecated on 4.6+)
		this.registerProviderMapping("anthropic", (level) => {
			switch (level) {
				case ReasoningLevel.OFF:
					return {}
				case ReasoningLevel.MINIMAL:
				case ReasoningLevel.LOW:
					return { reasoning: { effort: "low" } }
				case ReasoningLevel.MEDIUM:
					return { reasoning: { effort: "medium" } }
				case ReasoningLevel.HIGH:
					return { reasoning: { effort: "high" } }
				case ReasoningLevel.AUTO:
					return { reasoning: { effort: "high" } }
				default:
					return {}
			}
		})

		// DeepSeek — native reasoning support
		this.registerProviderMapping("deepseek", (level) => {
			switch (level) {
				case ReasoningLevel.OFF:
					return {}
				case ReasoningLevel.MINIMAL:
				case ReasoningLevel.LOW:
					return { reasoning: true, max_tokens: 1024 }
				case ReasoningLevel.MEDIUM:
					return { reasoning: true, max_tokens: 2048 }
				case ReasoningLevel.HIGH:
					return { reasoning: true, max_tokens: 4096 }
				case ReasoningLevel.AUTO:
					return { reasoning: true }
				default:
					return {}
			}
		})

		// Google/Gemini — uses thinking_config
		this.registerProviderMapping("google", (level) => {
			switch (level) {
				case ReasoningLevel.OFF:
					return { thinking_config: { include_thoughts: false } }
				case ReasoningLevel.MINIMAL:
				case ReasoningLevel.LOW:
					return { thinking_config: { include_thoughts: true, budget_tokens: 1024 } }
				case ReasoningLevel.MEDIUM:
					return { thinking_config: { include_thoughts: true, budget_tokens: 2048 } }
				case ReasoningLevel.HIGH:
					return { thinking_config: { include_thoughts: true, budget_tokens: 4096 } }
				case ReasoningLevel.AUTO:
					return { thinking_config: { include_thoughts: true } }
				default:
					return {}
			}
		})

		// Ollama — no reasoning support
		this.registerProviderMapping("ollama", () => {
			return {}
		})

		// Set defaults for common models
		this.setDefault("gpt-4o", ReasoningLevel.MEDIUM)
		this.setDefault("gpt-4o-mini", ReasoningLevel.LOW)
		this.setDefault("claude-opus-4-8", ReasoningLevel.HIGH)
		this.setDefault("claude-sonnet-4-6", ReasoningLevel.HIGH)
		this.setDefault("claude-haiku-4-5-20251001", ReasoningLevel.LOW)
		this.setDefault("claude-sonnet-4-20250514", ReasoningLevel.HIGH)
		this.setDefault("deepseek-chat", ReasoningLevel.MEDIUM)
		this.setDefault("deepseek-reasoner", ReasoningLevel.HIGH)
		this.setDefault("gemini-2.0-flash", ReasoningLevel.LOW)
		this.setDefault("gemini-2.5-pro", ReasoningLevel.HIGH)
	}

	// ── Provider Mapping ──────────────────────────────────────────────────────

	/**
	 * Register a provider-specific reasoning mapping function
	 * @param {string} providerId - Provider identifier
	 * @param {Function} mappingFn - (level: string) => Object
	 */
	registerProviderMapping(providerId, mappingFn) {
		this._providerMappings.set(providerId, mappingFn)
	}

	/**
	 * Get the provider-specific parameters for a reasoning level
	 * @param {string} providerId
	 * @param {string} level - ReasoningLevel value
	 * @returns {Object} Provider-specific parameters
	 */
	getProviderParams(providerId, level) {
		const mapping = this._providerMappings.get(providerId)
		if (!mapping) return {}
		return mapping(level)
	}

	/**
	 * Check if a provider supports reasoning
	 * @param {string} providerId
	 * @returns {boolean}
	 */
	supportsReasoning(providerId) {
		const mapping = this._providerMappings.get(providerId)
		if (!mapping) return false
		const params = mapping(ReasoningLevel.HIGH)
		return Object.keys(params).length > 0
	}

	// ── Default Levels ────────────────────────────────────────────────────────

	/**
	 * Set the default reasoning level for a model
	 * @param {string} modelId
	 * @param {string} level
	 */
	setDefault(modelId, level) {
		if (!Object.values(ReasoningLevel).includes(level)) {
			throw new Error(`Invalid reasoning level: ${level}`)
		}
		this._defaults.set(modelId, level)
	}

	/**
	 * Get the default reasoning level for a model
	 * @param {string} modelId
	 * @returns {string}
	 */
	getDefault(modelId) {
		return this._defaults.get(modelId) || ReasoningLevel.AUTO
	}

	/**
	 * Remove a model default
	 * @param {string} modelId
	 */
	removeDefault(modelId) {
		this._defaults.delete(modelId)
	}

	// ── Task Type Overrides ───────────────────────────────────────────────────

	/**
	 * Set a reasoning override for a task type
	 * @param {string} taskType - e.g., "debug", "code", "plan", "review"
	 * @param {string} level
	 */
	setTaskOverride(taskType, level) {
		if (!Object.values(ReasoningLevel).includes(level)) {
			throw new Error(`Invalid reasoning level: ${level}`)
		}
		this._taskOverrides.set(taskType, level)
	}

	/**
	 * Get the reasoning override for a task type
	 * @param {string} taskType
	 * @returns {string|null} Reasoning level or null if no override
	 */
	getTaskOverride(taskType) {
		return this._taskOverrides.get(taskType) || null
	}

	/**
	 * Remove a task type override
	 * @param {string} taskType
	 */
	removeTaskOverride(taskType) {
		this._taskOverrides.delete(taskType)
	}

	/**
	 * List all task type overrides
	 * @returns {Object} taskType -> level mapping
	 */
	listTaskOverrides() {
		const result = {}
		for (const [taskType, level] of this._taskOverrides) {
			result[taskType] = level
		}
		return result
	}

	// ── Resolution ─────────────────────────────────────────────────────────────

	/**
	 * Resolve the effective reasoning level for a model + task type combination
	 *
	 * Priority:
	 *   1. Task type override (highest priority)
	 *   2. Model default
	 *   3. AUTO (fallback)
	 *
	 * @param {string} modelId
	 * @param {string} [taskType] - Optional task type for override
	 * @returns {string} Resolved ReasoningLevel
	 */
	resolveLevel(modelId, taskType) {
		// Task type override takes highest priority
		if (taskType) {
			const override = this.getTaskOverride(taskType)
			if (override) return override
		}

		// Model default
		const defaultLevel = this.getDefault(modelId)
		if (defaultLevel) return defaultLevel

		// Fallback to AUTO
		return ReasoningLevel.AUTO
	}

	/**
	 * Get provider-specific parameters for a model + task combination
	 *
	 * @param {string} providerId - Provider identifier (e.g., "openai", "anthropic")
	 * @param {string} modelId - Model identifier (e.g., "gpt-4o")
	 * @param {string} [taskType] - Optional task type for override
	 * @returns {Object} Provider-specific reasoning parameters
	 */
	getParams(providerId, modelId, taskType) {
		const level = this.resolveLevel(modelId, taskType)
		return this.getProviderParams(providerId, level)
	}

	// ── Listing ─────────────────────────────────────────────────────────────────

	/**
	 * List all model defaults
	 * @returns {Object} modelId -> level mapping
	 */
	listDefaults() {
		const result = {}
		for (const [modelId, level] of this._defaults) {
			result[modelId] = level
		}
		return result
	}

	/**
	 * List all registered providers
	 * @returns {string[]}
	 */
	listProviders() {
		return Array.from(this._providerMappings.keys())
	}

	// ── Serialization ───────────────────────────────────────────────────────────

	/**
	 * Serialize to a plain object
	 * @returns {Object}
	 */
	toJSON() {
		return {
			defaults: this.listDefaults(),
			taskOverrides: this.listTaskOverrides(),
			providers: this.listProviders(),
		}
	}

	/**
	 * Deserialize from a plain object
	 * @param {Object} data
	 */
	fromJSON(data) {
		if (data.defaults) {
			for (const [modelId, level] of Object.entries(data.defaults)) {
				this.setDefault(modelId, level)
			}
		}
		if (data.taskOverrides) {
			for (const [taskType, level] of Object.entries(data.taskOverrides)) {
				this.setTaskOverride(taskType, level)
			}
		}
	}
}

module.exports = {
	ReasoningConfig,
	ReasoningLevel,
	REASONING_LEVEL_ORDER,
}
