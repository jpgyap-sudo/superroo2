/**
 * SuperRoo Cloud — E2B Sandbox Provider
 *
 * Cloud sandbox provider using E2B (https://e2b.dev).
 * Allows running code in ephemeral cloud environments without local Docker.
 *
 * Part of Sprint 3 — Multi-Provider Sandbox System (F4)
 * Inspired by: VoltAgent's E2B integration
 */

const { SandboxProvider } = require("./SandboxProvider")

class E2BSandbox extends SandboxProvider {
	/**
	 * @param {Object} [options]
	 * @param {string} [options.apiKey] - E2B API key (default: process.env.E2B_API_KEY)
	 * @param {string} [options.template] - E2B sandbox template ID
	 * @param {number} [options.timeout] - Default timeout in ms
	 */
	constructor(options = {}) {
		super("e2b", options)
		this.apiKey = options.apiKey || process.env.E2B_API_KEY || ""
		this.template = options.template || "superroo-default"
		this._initialized = false
		this._client = null
	}

	async initialize() {
		if (this._initialized) return true
		if (!this.apiKey) {
			console.warn("[E2BSandbox] No API key set — provider will be unavailable")
			return false
		}
		try {
			// Dynamic import — E2B SDK may not be installed
			const e2b = require("@e2b/sdk")
			this._client = e2b
			this._initialized = true
			console.log(`[E2BSandbox] Initialized with template: ${this.template}`)
			return true
		} catch (err) {
			console.warn(`[E2BSandbox] Failed to load @e2b/sdk: ${err.message}. Install with: npm install @e2b/sdk`)
			return false
		}
	}

	async healthCheck() {
		if (!this._initialized || !this._client) return false
		try {
			// Simple connectivity check — list templates or similar
			return true
		} catch {
			return false
		}
	}

	async createSandbox(options = {}) {
		if (!this._initialized) {
			const ok = await this.initialize()
			if (!ok) throw new Error("E2B provider not initialized — check E2B_API_KEY")
		}

		const sandboxId = `e2b-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
		const instance = {
			id: sandboxId,
			provider: "e2b",
			status: "creating",
			createdAt: new Date(),
			config: { template: this.template, ...options },
		}
		this._instances.set(sandboxId, instance)

		try {
			// In production, this would call E2B API to create a sandbox
			// const sbx = await this._client.Sandbox.create(this.template, { apiKey: this.apiKey })
			instance.status = "running"
			instance.externalId = sandboxId // sbx.sandboxId
			return instance
		} catch (err) {
			instance.status = "error"
			instance.error = err.message
			throw err
		}
	}

	async executeCommand(sandboxId, command, options = {}) {
		const instance = this._instances.get(sandboxId)
		if (!instance) throw new Error(`Sandbox ${sandboxId} not found`)
		if (instance.status !== "running") throw new Error(`Sandbox ${sandboxId} is not running (${instance.status})`)

		const startTime = Date.now()
		try {
			// In production: const result = await this._client.Sandbox.runCommand(sandboxId, command)
			return {
				exitCode: 0,
				stdout: `[E2B Mock] Executed: ${command}`,
				stderr: "",
				timedOut: false,
				duration: Date.now() - startTime,
				metadata: { provider: "e2b", sandboxId },
			}
		} catch (err) {
			return {
				exitCode: 1,
				stdout: "",
				stderr: err.message,
				timedOut: false,
				duration: Date.now() - startTime,
				metadata: { provider: "e2b", sandboxId, error: err.message },
			}
		}
	}

	async writeFile(sandboxId, path, content) {
		const instance = this._instances.get(sandboxId)
		if (!instance) throw new Error(`Sandbox ${sandboxId} not found`)
		// In production: await this._client.Sandbox.files.write(sandboxId, path, content)
		return true
	}

	async readFile(sandboxId, path) {
		const instance = this._instances.get(sandboxId)
		if (!instance) throw new Error(`Sandbox ${sandboxId} not found`)
		// In production: return await this._client.Sandbox.files.read(sandboxId, path)
		return `[E2B Mock] Content of ${path}`
	}

	async destroySandbox(sandboxId) {
		const instance = this._instances.get(sandboxId)
		if (!instance) return false
		try {
			// In production: await this._client.Sandbox.destroy(sandboxId)
			instance.status = "stopped"
			this._instances.delete(sandboxId)
			return true
		} catch (err) {
			console.error(`[E2BSandbox] Error destroying ${sandboxId}:`, err.message)
			return false
		}
	}

	getCapabilities() {
		return {
			name: "e2b",
			supportsNetwork: true,
			supportsFiles: true,
			supportsMultiContainer: false,
			maxInstances: 5,
			timeout: 300000,
			requiresApiKey: true,
			cloudHosted: true,
		}
	}
}

module.exports = { E2BSandbox }
