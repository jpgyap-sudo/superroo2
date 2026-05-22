/**
 * SuperRoo Cloud — SandboxProvider Interface
 *
 * Abstract provider interface for sandbox execution environments.
 * All sandbox providers (Docker, E2B, Daytona, etc.) must implement
 * this interface to be interchangeable.
 *
 * Part of Sprint 3 — Multi-Provider Sandbox System (F4)
 * Inspired by: VoltAgent (E2B, Daytona, Blaxel) + Mastra (Docker, E2B, Daytona, Modal, Blaxel)
 */

/**
 * @typedef {Object} SandboxOptions
 * @property {string} [image] - Container image to use
 * @property {string} [timeout] - Execution timeout in ms
 * @property {string} [memory] - Memory limit (e.g., "512m")
 * @property {string} [cpus] - CPU limit (e.g., "1")
 * @property {string[]} [env] - Environment variables (KEY=VALUE format)
 * @property {string} [workingDir] - Working directory inside sandbox
 * @property {boolean} [network] - Enable network access
 * @property {Object} [metadata] - Arbitrary metadata for tracking
 */

/**
 * @typedef {Object} SandboxResult
 * @property {number} exitCode - Process exit code
 * @property {string} stdout - Standard output
 * @property {string} stderr - Standard error
 * @property {boolean} timedOut - Whether execution timed out
 * @property {number} duration - Execution duration in ms
 * @property {Object} [metadata] - Provider-specific metadata
 */

/**
 * @typedef {Object} SandboxInstance
 * @property {string} id - Unique sandbox instance ID
 * @property {string} provider - Provider name (e.g., "docker", "e2b", "daytona")
 * @property {string} status - "creating" | "running" | "stopped" | "error"
 * @property {Date} createdAt - Creation timestamp
 * @property {Object} [config] - Provider-specific configuration
 */

class SandboxProvider {
	/**
	 * @param {string} name - Provider name identifier
	 * @param {Object} [options] - Provider-specific options
	 */
	constructor(name, options = {}) {
		if (new.target === SandboxProvider) {
			throw new Error("SandboxProvider is abstract — use a concrete implementation")
		}
		this.name = name
		this.options = options
		this._instances = new Map()
	}

	/**
	 * Initialize the provider (connect, authenticate, etc.)
	 * @returns {Promise<boolean>} Whether initialization succeeded
	 */
	async initialize() {
		throw new Error("initialize() must be implemented by subclass")
	}

	/**
	 * Check if the provider is healthy and ready
	 * @returns {Promise<boolean>}
	 */
	async healthCheck() {
		throw new Error("healthCheck() must be implemented by subclass")
	}

	/**
	 * Create a new sandbox instance
	 * @param {SandboxOptions} [options]
	 * @returns {Promise<SandboxInstance>}
	 */
	async createSandbox(options = {}) {
		throw new Error("createSandbox() must be implemented by subclass")
	}

	/**
	 * Execute a command inside a sandbox
	 * @param {string} sandboxId - Sandbox instance ID
	 * @param {string} command - Command to execute
	 * @param {SandboxOptions} [options]
	 * @returns {Promise<SandboxResult>}
	 */
	async executeCommand(sandboxId, command, options = {}) {
		throw new Error("executeCommand() must be implemented by subclass")
	}

	/**
	 * Write a file to the sandbox
	 * @param {string} sandboxId - Sandbox instance ID
	 * @param {string} path - File path inside sandbox
	 * @param {string|Buffer} content - File content
	 * @returns {Promise<boolean>}
	 */
	async writeFile(sandboxId, path, content) {
		throw new Error("writeFile() must be implemented by subclass")
	}

	/**
	 * Read a file from the sandbox
	 * @param {string} sandboxId - Sandbox instance ID
	 * @param {string} path - File path inside sandbox
	 * @returns {Promise<string>}
	 */
	async readFile(sandboxId, path) {
		throw new Error("readFile() must be implemented by subclass")
	}

	/**
	 * Stop and destroy a sandbox instance
	 * @param {string} sandboxId - Sandbox instance ID
	 * @returns {Promise<boolean>}
	 */
	async destroySandbox(sandboxId) {
		throw new Error("destroySandbox() must be implemented by subclass")
	}

	/**
	 * Get sandbox instance info
	 * @param {string} sandboxId
	 * @returns {Promise<SandboxInstance|null>}
	 */
	async getSandbox(sandboxId) {
		return this._instances.get(sandboxId) || null
	}

	/**
	 * List all active sandbox instances
	 * @returns {Promise<SandboxInstance[]>}
	 */
	async listSandboxes() {
		return Array.from(this._instances.values())
	}

	/**
	 * Get provider capabilities/metadata
	 * @returns {Object}
	 */
	getCapabilities() {
		return {
			name: this.name,
			supportsNetwork: false,
			supportsFiles: false,
			supportsMultiContainer: false,
			maxInstances: 10,
			timeout: 300000,
		}
	}

	/**
	 * Clean up all resources
	 * @returns {Promise<void>}
	 */
	async shutdown() {
		for (const [id] of this._instances) {
			try {
				await this.destroySandbox(id)
			} catch (err) {
				console.error(`[SandboxProvider:${this.name}] Error destroying ${id}:`, err.message)
			}
		}
		this._instances.clear()
	}
}

module.exports = { SandboxProvider }
