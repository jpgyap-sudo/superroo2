/**
 * Cloud Orchestrator — Agent Registry.
 *
 * Manages agent definitions, their capabilities, safety constraints, and
 * runtime state. Agents are persisted to a JSON file for durability across
 * restarts.
 *
 * Ported from cloud/agent-runtime/agentRegistry.js with enhanced features
 * matching the local SuperRoo orchestrator's agent model.
 */

const fs = require("node:fs")
const path = require("node:path")

const DEFAULT_AGENT_STATE_PATH = path.join(__dirname, "..", "data", "agent-state.json")

// ─── Built-in agent definitions ─────────────────────────────────────────────
const BUILTIN_AGENTS = [
	{
		id: "superroo-debugger-agent",
		name: "SuperRoo Debugger",
		description: "General-purpose coding and debugging agent",
		enabled: true,
		capabilities: [
			"read_file",
			"list_files",
			"search_files",
			"write_file",
			"apply_diff",
			"execute_command",
			"run_tests",
			"create_branch",
			"commit_changes",
		],
		safety: {
			canDeploy: false,
			requiresApproval: true,
			approvalTriggers: ["delete", "drop", "format", "prune"],
			blockedCommands: ["rm -rf /", "shutdown", "reboot"],
		},
		maxConcurrency: 2,
	},
	{
		id: "superroo-deployer-agent",
		name: "SuperRoo Deployer",
		description: "Handles deployments to staging and production",
		enabled: true,
		capabilities: [
			"read_file",
			"list_files",
			"execute_command",
			"deploy_staging",
			"deploy_production",
			"push_changes",
			"create_pr",
		],
		safety: {
			canDeploy: true,
			requiresApproval: true,
			approvalTriggers: ["production", "prod", "deploy"],
			blockedCommands: ["rm -rf", "shutdown", "reboot", "docker system prune"],
		},
		maxConcurrency: 1,
	},
	{
		id: "superroo-tester-agent",
		name: "SuperRoo Tester",
		description: "Runs test suites and reports results",
		enabled: true,
		capabilities: ["read_file", "list_files", "search_files", "execute_command", "run_tests"],
		safety: {
			canDeploy: false,
			requiresApproval: false,
			blockedCommands: ["rm -rf", "shutdown", "reboot"],
		},
		maxConcurrency: 3,
	},
	{
		id: "superroo-consultant-agent",
		name: "SuperRoo Consultant",
		description: "Provides architectural guidance and code review",
		enabled: true,
		capabilities: ["read_file", "list_files", "search_files", "view_code", "view_diff", "ask_question"],
		safety: {
			canDeploy: false,
			requiresApproval: false,
			blockedCommands: [],
		},
		maxConcurrency: 5,
	},
	{
		id: "superroo-crawler-agent",
		name: "SuperRoo Crawler",
		description: "Scans codebase for bugs, issues, and improvement opportunities",
		enabled: true,
		capabilities: ["read_file", "list_files", "search_files", "execute_safe_command"],
		safety: {
			canDeploy: false,
			requiresApproval: false,
			blockedCommands: ["rm -rf", "shutdown", "reboot", "write"],
		},
		maxConcurrency: 2,
	},
	{
		id: "superroo-orchestrator-agent",
		name: "SuperRoo Orchestrator",
		description: "Coordinates multi-agent workflows and pipeline execution",
		enabled: true,
		capabilities: [
			"read_file",
			"list_files",
			"search_files",
			"execute_safe_command",
			"create_branch",
			"commit_changes",
			"push_changes",
			"create_pr",
			"deploy_staging",
			"deploy_production",
		],
		safety: {
			canDeploy: true,
			requiresApproval: true,
			approvalTriggers: ["production", "prod", "deploy", "delete", "drop"],
			blockedCommands: ["rm -rf /", "shutdown", "reboot"],
		},
		maxConcurrency: 1,
	},
]

class AgentRegistry {
	/**
	 * @param {Object} opts
	 * @param {string} [opts.statePath] - Path to persist agent state JSON.
	 * @param {Object} [opts.memoryStore] - Optional MemoryStore instance for persistence.
	 */
	constructor(opts = {}) {
		this.statePath = opts.statePath || DEFAULT_AGENT_STATE_PATH
		this.memoryStore = opts.memoryStore || null
		this.agents = new Map()
		this._initialized = false
	}

	/**
	 * Initialize the registry: load persisted state or seed with built-in agents.
	 */
	async initialize() {
		if (this._initialized) return
		this._initialized = true

		// Try loading from memory store first, then file
		let loaded = false
		if (this.memoryStore) {
			try {
				const stored = this.memoryStore.get("agent_registry")
				if (stored) {
					const data = typeof stored === "string" ? JSON.parse(stored) : stored
					for (const agent of data) {
						this.agents.set(agent.id, agent)
					}
					loaded = true
					console.log(`[orchestrator/agent-registry] Loaded ${data.length} agents from MemoryStore`)
				}
			} catch (err) {
				console.warn("[orchestrator/agent-registry] Failed to load from MemoryStore:", err.message)
			}
		}

		if (!loaded) {
			try {
				if (fs.existsSync(this.statePath)) {
					const raw = fs.readFileSync(this.statePath, "utf8")
					const data = JSON.parse(raw)
					for (const agent of data) {
						this.agents.set(agent.id, agent)
					}
					console.log(`[orchestrator/agent-registry] Loaded ${data.length} agents from ${this.statePath}`)
					loaded = true
				}
			} catch (err) {
				console.warn("[orchestrator/agent-registry] Failed to load from file:", err.message)
			}
		}

		if (!loaded) {
			// Seed with built-in agents
			for (const agent of BUILTIN_AGENTS) {
				this.agents.set(agent.id, { ...agent })
			}
			console.log(`[orchestrator/agent-registry] Seeded ${BUILTIN_AGENTS.length} built-in agents`)
			await this._persist()
		}
	}

	/**
	 * Persist current agent state.
	 */
	async _persist() {
		const data = Array.from(this.agents.values())
		if (this.memoryStore) {
			try {
				this.memoryStore.set("agent_registry", data, "orchestrator")
			} catch (err) {
				console.warn("[orchestrator/agent-registry] Failed to persist to MemoryStore:", err.message)
			}
		}
		try {
			const dir = path.dirname(this.statePath)
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true })
			}
			fs.writeFileSync(this.statePath, JSON.stringify(data, null, 2), "utf8")
		} catch (err) {
			console.warn("[orchestrator/agent-registry] Failed to persist to file:", err.message)
		}
	}

	// ── CRUD ──────────────────────────────────────────────────────────────

	/**
	 * Register a new agent or update an existing one.
	 * @param {Object} agentDef
	 * @returns {Object} The registered agent.
	 */
	async register(agentDef) {
		if (!agentDef.id) {
			throw new Error("Agent definition must have an 'id' field")
		}
		const agent = {
			...agentDef,
			enabled: agentDef.enabled !== false,
			capabilities: agentDef.capabilities || [],
			safety: agentDef.safety || { canDeploy: false, requiresApproval: false, blockedCommands: [] },
			maxConcurrency: agentDef.maxConcurrency || 1,
		}
		this.agents.set(agent.id, agent)
		await this._persist()
		return agent
	}

	/**
	 * Get an agent by ID.
	 * @param {string} agentId
	 * @returns {Object|null}
	 */
	get(agentId) {
		return this.agents.get(agentId) || null
	}

	/**
	 * List all registered agents, optionally filtered.
	 * @param {Object} [filter]
	 * @param {boolean} [filter.enabled] - Filter by enabled/disabled state.
	 * @param {string} [filter.capability] - Filter by required capability.
	 * @returns {Object[]}
	 */
	list(filter = {}) {
		let result = Array.from(this.agents.values())
		if (filter.enabled !== undefined) {
			result = result.filter((a) => a.enabled === filter.enabled)
		}
		if (filter.capability) {
			result = result.filter((a) => a.capabilities.includes(filter.capability))
		}
		return result
	}

	/**
	 * Enable or disable an agent.
	 * @param {string} agentId
	 * @param {boolean} enabled
	 * @returns {boolean} Whether the agent was found and updated.
	 */
	async setEnabled(agentId, enabled) {
		const agent = this.agents.get(agentId)
		if (!agent) return false
		agent.enabled = enabled
		await this._persist()
		return true
	}

	/**
	 * Toggle an agent's enabled state.
	 * @param {string} agentId
	 * @returns {boolean} The new enabled state, or null if not found.
	 */
	async toggle(agentId) {
		const agent = this.agents.get(agentId)
		if (!agent) return null
		agent.enabled = !agent.enabled
		await this._persist()
		return agent.enabled
	}

	/**
	 * Remove an agent from the registry.
	 * @param {string} agentId
	 * @returns {boolean}
	 */
	async unregister(agentId) {
		const existed = this.agents.delete(agentId)
		if (existed) await this._persist()
		return existed
	}

	// ── Validation ────────────────────────────────────────────────────────

	/**
	 * Validate whether an agent can execute a given task.
	 * @param {string} agentId
	 * @param {Object} job - The task/job definition.
	 * @returns {{ valid: boolean, reason?: string }}
	 */
	validateJob(agentId, job) {
		const agent = this.agents.get(agentId)
		if (!agent) {
			return { valid: false, reason: `Agent not found: ${agentId}` }
		}
		if (!agent.enabled) {
			return { valid: false, reason: `Agent disabled: ${agentId}` }
		}

		// Check blocked commands
		const blocked = agent.safety.blockedCommands || []
		for (const cmd of job.commands || []) {
			for (const bad of blocked) {
				if (cmd.includes(bad)) {
					return { valid: false, reason: `Blocked dangerous command for ${agentId}: ${cmd}` }
				}
			}
		}

		// Check if approval is required
		if (agent.safety.canDeploy === false && job.task && job.task.toLowerCase().includes("deploy production")) {
			return { valid: true, approvalRequired: true, reason: "Production deploy requires approval." }
		}

		if (agent.safety.requiresApproval) {
			const lower = (job.task || "").toLowerCase()
			const triggers = agent.safety.approvalTriggers || []
			const trigger = triggers.find((t) => lower.includes(t.toLowerCase()))
			if (trigger) {
				return { valid: true, approvalRequired: true, reason: `Approval trigger matched: ${trigger}` }
			}
		}

		return { valid: true, approvalRequired: false }
	}

	/**
	 * Get stats about the registry.
	 * @returns {{ total: number, enabled: number, disabled: number }}
	 */
	getStats() {
		const all = Array.from(this.agents.values())
		return {
			total: all.length,
			enabled: all.filter((a) => a.enabled).length,
			disabled: all.filter((a) => !a.enabled).length,
		}
	}
}

module.exports = { AgentRegistry }
