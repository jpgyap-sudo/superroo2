/**
 * SuperRoo Cloud — Prompt Customization System
 *
 * Provides PromptVariantSet, slash commands, and agent-specific
 * variable documentation for customizing agent behavior.
 *
 * Part of Sprint 3 — Prompt Customization System (F5)
 * Inspired by: Theia's PromptVariantSet, CommandPromptFragmentMetadata, PromptServiceImpl
 */

/**
 * @typedef {Object} PromptVariant
 * @property {string} id - Unique variant identifier
 * @property {string} name - Human-readable name
 * @property {string} description - What this variant does
 * @property {string} systemPrompt - The actual system prompt content
 * @property {string[]} [tags] - Tags for filtering
 */

/**
 * @typedef {Object} PromptVariantSet
 * @property {string} id - Unique set identifier
 * @property {string} name - Human-readable name
 * @property {string} defaultVariant - Default variant ID
 * @property {PromptVariant[]} variants - Available variants
 * @property {Object} [metadata] - Additional metadata
 */

/**
 * @typedef {Object} SlashCommand
 * @property {string} command - The slash command (e.g., "fix", "explain")
 * @property {string} description - What the command does
 * @property {string[]} agents - Which agents support this command
 * @property {Function} handler - Handler function
 * @property {Object} [schema] - Parameter schema
 */

class PromptCustomizer {
	constructor() {
		this._variantSets = new Map()
		this._slashCommands = new Map()
		this._agentVariables = new Map()
		this._activeVariants = new Map() // agentId -> variantSetId + variantId
	}

	// ── Variant Set Management ────────────────────────────────────────────────

	/**
	 * Register a prompt variant set
	 * @param {PromptVariantSet} variantSet
	 */
	registerVariantSet(variantSet) {
		if (!variantSet.id || !variantSet.variants || variantSet.variants.length === 0) {
			throw new Error("Variant set must have an id and at least one variant")
		}
		if (!variantSet.defaultVariant) {
			variantSet.defaultVariant = variantSet.variants[0].id
		}
		this._variantSets.set(variantSet.id, variantSet)
	}

	/**
	 * Get a variant set by ID
	 * @param {string} setId
	 * @returns {PromptVariantSet|null}
	 */
	getVariantSet(setId) {
		return this._variantSets.get(setId) || null
	}

	/**
	 * List all registered variant sets
	 * @returns {PromptVariantSet[]}
	 */
	listVariantSets() {
		return Array.from(this._variantSets.values())
	}

	/**
	 * Remove a variant set
	 * @param {string} setId
	 */
	removeVariantSet(setId) {
		this._variantSets.delete(setId)
	}

	/**
	 * Get a specific variant from a set
	 * @param {string} setId
	 * @param {string} variantId
	 * @returns {PromptVariant|null}
	 */
	getVariant(setId, variantId) {
		const set = this._variantSets.get(setId)
		if (!set) return null
		return set.variants.find((v) => v.id === variantId) || null
	}

	/**
	 * Get the active variant for an agent
	 * @param {string} agentId
	 * @returns {{ setId: string, variantId: string, variant: PromptVariant }|null}
	 */
	getActiveVariant(agentId) {
		const active = this._activeVariants.get(agentId)
		if (!active) return null
		const set = this._variantSets.get(active.setId)
		if (!set) return null
		const variant = set.variants.find((v) => v.id === active.variantId)
		if (!variant) return null
		return { setId: active.setId, variantId: active.variantId, variant }
	}

	/**
	 * Set the active variant for an agent
	 * @param {string} agentId
	 * @param {string} setId
	 * @param {string} variantId
	 */
	setActiveVariant(agentId, setId, variantId) {
		const set = this._variantSets.get(setId)
		if (!set) throw new Error(`Variant set "${setId}" not found`)
		const variant = set.variants.find((v) => v.id === variantId)
		if (!variant) throw new Error(`Variant "${variantId}" not found in set "${setId}"`)
		this._activeVariants.set(agentId, { setId, variantId })
	}

	/**
	 * Reset an agent to the default variant
	 * @param {string} agentId
	 * @param {string} setId
	 */
	resetToDefault(agentId, setId) {
		const set = this._variantSets.get(setId)
		if (!set) throw new Error(`Variant set "${setId}" not found`)
		this._activeVariants.set(agentId, { setId, variantId: set.defaultVariant })
	}

	// ── Slash Command Management ──────────────────────────────────────────────

	/**
	 * Register a slash command
	 * @param {SlashCommand} cmd
	 */
	registerSlashCommand(cmd) {
		if (!cmd.command || !cmd.handler) {
			throw new Error("Slash command must have a command name and handler")
		}
		const key = cmd.command.toLowerCase().replace(/^\//, "")
		this._slashCommands.set(key, cmd)
	}

	/**
	 * Get a slash command by name
	 * @param {string} command - Command name (with or without leading /)
	 * @returns {SlashCommand|null}
	 */
	getSlashCommand(command) {
		const key = command.toLowerCase().replace(/^\//, "")
		return this._slashCommands.get(key) || null
	}

	/**
	 * List slash commands, optionally filtered by agent
	 * @param {string} [agentId]
	 * @returns {SlashCommand[]}
	 */
	listSlashCommands(agentId) {
		const all = Array.from(this._slashCommands.values())
		if (agentId) {
			return all.filter((cmd) => cmd.agents.includes(agentId))
		}
		return all
	}

	/**
	 * Remove a slash command
	 * @param {string} command
	 */
	removeSlashCommand(command) {
		const key = command.toLowerCase().replace(/^\//, "")
		this._slashCommands.delete(key)
	}

	/**
	 * Execute a slash command
	 * @param {string} command - Command name
	 * @param {Object} params - Command parameters
	 * @param {Object} context - Execution context (agentId, chatId, etc.)
	 * @returns {Promise<any>}
	 */
	async executeSlashCommand(command, params = {}, context = {}) {
		const cmd = this.getSlashCommand(command)
		if (!cmd) throw new Error(`Unknown slash command: /${command}`)
		return cmd.handler(params, context)
	}

	/**
	 * Parse a message for slash commands
	 * @param {string} text - User message text
	 * @returns {{ command: string|null, args: string, params: Object }|null}
	 */
	parseSlashCommand(text) {
		const match = text.match(/^\/(\w+)(?:\s+(.*))?$/s)
		if (!match) return null
		const command = match[1]
		const args = (match[2] || "").trim()
		const cmd = this._slashCommands.get(command.toLowerCase())
		return {
			command,
			args,
			params: cmd && cmd.schema ? this._parseParams(args, cmd.schema) : { text: args },
		}
	}

	/**
	 * Parse parameters from args string based on schema
	 * @private
	 */
	_parseParams(args, schema) {
		if (!args) return {}
		const params = { text: args }
		if (schema.properties) {
			for (const [key, prop] of Object.entries(schema.properties)) {
				const regex = new RegExp(`--${key}\\s+(\\S+)`, "i")
				const match = args.match(regex)
				if (match) {
					params[key] = match[1]
				}
			}
		}
		return params
	}

	// ── Agent Variable Documentation ──────────────────────────────────────────

	/**
	 * Register agent-specific variables
	 * @param {string} agentId
	 * @param {Object[]} variables - Array of { name, description, type, default }
	 */
	registerAgentVariables(agentId, variables) {
		this._agentVariables.set(agentId, variables)
	}

	/**
	 * Get variables for an agent
	 * @param {string} agentId
	 * @returns {Object[]}
	 */
	getAgentVariables(agentId) {
		return this._agentVariables.get(agentId) || []
	}

	/**
	 * Substitute variables in a prompt template
	 * @param {string} template - Prompt template with {{variable}} placeholders
	 * @param {Object} values - Variable values
	 * @returns {string}
	 */
	substituteVariables(template, values = {}) {
		return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
			return values[key] !== undefined ? String(values[key]) : match
		})
	}

	// ── Built-in Variant Sets ─────────────────────────────────────────────────

	/**
	 * Register the default built-in variant sets
	 */
	registerDefaults() {
		// Coder variants
		this.registerVariantSet({
			id: "coder-style",
			name: "Coder Style",
			defaultVariant: "balanced",
			variants: [
				{
					id: "concise",
					name: "Concise",
					description: "Short, minimal explanations. Just the code.",
					systemPrompt:
						"You are a concise coding assistant. Provide minimal explanations and focus on code. Use short variable names. Prefer one-liners when possible.",
					tags: ["fast", "minimal"],
				},
				{
					id: "balanced",
					name: "Balanced",
					description: "Clear code with moderate explanations.",
					systemPrompt:
						"You are a helpful coding assistant. Provide clear code with moderate explanations. Follow best practices and include comments for complex logic.",
					tags: ["default", "general"],
				},
				{
					id: "thorough",
					name: "Thorough",
					description: "Detailed explanations with comprehensive code.",
					systemPrompt:
						"You are a thorough coding assistant. Provide detailed explanations, comprehensive code with full error handling, type definitions, and documentation. Assume the user wants production-quality code.",
					tags: ["production", "enterprise"],
				},
				{
					id: "educational",
					name: "Educational",
					description: "Teach concepts while writing code.",
					systemPrompt:
						"You are an educational coding assistant. Explain concepts as you write code. Include analogies, compare alternatives, and highlight best practices. Assume the user wants to learn.",
					tags: ["learning", "tutorial"],
				},
			],
		})

		// Debugger variants
		this.registerVariantSet({
			id: "debugger-style",
			name: "Debugger Style",
			defaultVariant: "systematic",
			variants: [
				{
					id: "systematic",
					name: "Systematic",
					description: "Step-by-step debugging with hypothesis testing.",
					systemPrompt:
						"You are a systematic debugger. Always form a hypothesis before investigating. Test one variable at a time. Document what you've ruled out.",
					tags: ["default", "methodical"],
				},
				{
					id: "aggressive",
					name: "Aggressive",
					description: "Quick fixes with less investigation.",
					systemPrompt:
						"You are an aggressive debugger. Look for common patterns first. Suggest quick fixes. Only dig deeper if the obvious solutions don't work.",
					tags: ["fast", "practical"],
				},
			],
		})

		// Register default slash commands
		this.registerSlashCommand({
			command: "fix",
			description: "Fix a bug or error",
			agents: ["coder", "debugger"],
			schema: {
				properties: {
					file: { type: "string", description: "File to fix" },
				},
			},
			handler: async (params, ctx) => {
				return { action: "fix", target: params.file || ctx.lastFile, context: ctx }
			},
		})

		this.registerSlashCommand({
			command: "explain",
			description: "Explain code or concept",
			agents: ["coder", "consultant"],
			handler: async (params, ctx) => {
				return { action: "explain", text: params.text, context: ctx }
			},
		})

		this.registerSlashCommand({
			command: "test",
			description: "Generate or run tests",
			agents: ["coder", "tester"],
			schema: {
				properties: {
					file: { type: "string", description: "File to test" },
					type: { type: "string", description: "Test type (unit/integration/e2e)" },
				},
			},
			handler: async (params, ctx) => {
				return { action: "test", target: params.file, type: params.type || "unit", context: ctx }
			},
		})

		this.registerSlashCommand({
			command: "deploy",
			description: "Deploy the current project",
			agents: ["coder", "devops"],
			handler: async (params, ctx) => {
				return { action: "deploy", context: ctx }
			},
		})

		this.registerSlashCommand({
			command: "review",
			description: "Review code for issues",
			agents: ["coder", "reviewer"],
			schema: {
				properties: {
					file: { type: "string", description: "File to review" },
				},
			},
			handler: async (params, ctx) => {
				return { action: "review", target: params.file || ctx.lastFile, context: ctx }
			},
		})
	}
}

module.exports = { PromptCustomizer }
