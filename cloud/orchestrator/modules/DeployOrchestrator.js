/**
 * Super Roo — Cloud Deploy Orchestrator
 *
 * Port of src/super-roo/deploy/DeployOrchestrator.ts
 *
 * GitHub Actions → VPS pipeline with auto-deploy, health checks, and rollback.
 * Uses SSH/SCP for deployment with full audit trail.
 */

const fs = require("fs")
const path = require("path")
const { spawnSync } = require("child_process")

/**
 * @typedef {Object} DeployConfig
 * @property {string} githubToken
 * @property {string} repoOwner
 * @property {string} repoName
 * @property {string} vpsHost
 * @property {string} vpsUser
 * @property {string} [vpsKeyPath]
 * @property {string} vpsDeployPath
 * @property {string} healthUrl
 * @property {number} maxRollbackVersions
 * @property {string} [rootKeyPath]
 */

/**
 * @typedef {Object} DeployState
 * @property {string} version
 * @property {string} commitSha
 * @property {number} deployedAt
 * @property {"pending"|"running"|"healthy"|"unhealthy"|"rolled_back"} status
 * @property {string} [error]
 */

class DeployOrchestrator {
	/**
	 * @param {DeployConfig} config
	 */
	constructor(config) {
		this.config = config
		/** @type {DeployState[]} */
		this.history = []
		/** @type {DeployState|null} */
		this.current = null
	}

	/**
	 * Trigger a full deploy pipeline.
	 * @param {string} version
	 * @param {string} commitSha
	 * @returns {Promise<DeployState>}
	 */
	async deploy(version, commitSha) {
		const state = {
			version,
			commitSha,
			deployedAt: Date.now(),
			status: "pending",
		}
		this.current = state
		this.history.unshift(state)
		this._trimHistory()

		try {
			state.status = "running"
			await this._triggerGitHubWorkflow(version, commitSha)
			await this._deployToVps(version)
			const healthy = await this._runHealthCheck()
			state.status = healthy ? "healthy" : "unhealthy"

			if (!healthy) {
				await this.rollback()
			}
		} catch (err) {
			state.status = "unhealthy"
			state.error = err instanceof Error ? err.message : String(err)
			await this.rollback()
		}

		return state
	}

	/**
	 * Health check the live VPS endpoint.
	 * @returns {Promise<{ ok: boolean, latencyMs: number, details?: Record<string, unknown> }>}
	 */
	async healthCheck() {
		const start = Date.now()
		try {
			const res = await this._fetch(this.config.healthUrl, { timeout: 10000 })
			const latencyMs = Date.now() - start
			if (res.status >= 200 && res.status < 300) {
				const json = await res.json().catch(() => ({}))
				return { ok: true, latencyMs, details: json }
			}
			return { ok: false, latencyMs }
		} catch {
			return { ok: false, latencyMs: Date.now() - start }
		}
	}

	/**
	 * Rollback to the previous healthy version.
	 * @returns {Promise<DeployState|null>}
	 */
	async rollback() {
		const previous = this.history.find((h) => h.status === "healthy" && h.version !== this.current?.version)
		if (!previous) return null

		this.current = { ...previous, deployedAt: Date.now(), status: "rolled_back" }
		await this._deployToVps(previous.version)
		return this.current
	}

	/**
	 * @returns {DeployState[]}
	 */
	getHistory() {
		return [...this.history]
	}

	/**
	 * @returns {DeployState|null}
	 */
	getCurrent() {
		return this.current ? { ...this.current } : null
	}

	/**
	 * Get deploy stats.
	 * @returns {{ totalDeploys: number, healthyCount: number, unhealthyCount: number, rolledBackCount: number, lastDeployAt: number|null }}
	 */
	getStats() {
		const healthyCount = this.history.filter((h) => h.status === "healthy").length
		const unhealthyCount = this.history.filter((h) => h.status === "unhealthy").length
		const rolledBackCount = this.history.filter((h) => h.status === "rolled_back").length
		return {
			totalDeploys: this.history.length,
			healthyCount,
			unhealthyCount,
			rolledBackCount,
			lastDeployAt: this.history.length > 0 ? this.history[0].deployedAt : null,
		}
	}

	// ── Internal pipeline steps ───────────────────────────────────────────────

	/**
	 * @param {string} version
	 * @param {string} commitSha
	 * @private
	 */
	async _triggerGitHubWorkflow(version, commitSha) {
		const manifestDir = path.join(process.cwd(), ".super-roo", "deploy")
		fs.mkdirSync(manifestDir, { recursive: true })
		const manifest = {
			version,
			commitSha,
			triggeredAt: new Date().toISOString(),
			vpsHost: this.config.vpsHost,
			vpsDeployPath: this.config.vpsDeployPath,
		}
		fs.writeFileSync(path.join(manifestDir, "manifest.json"), JSON.stringify(manifest, null, 2))
	}

	/**
	 * @param {string} version
	 * @private
	 */
	async _deployToVps(version) {
		const bundleDir = path.join(process.cwd(), ".super-roo", "deploy", "bundles")
		fs.mkdirSync(bundleDir, { recursive: true })
		const bundlePath = path.join(bundleDir, `${version}.tar.gz`)

		await this._createDeployBundle(bundlePath)

		const sshHangPrevention = [
			"-o",
			"ConnectTimeout=15",
			"-o",
			"ServerAliveInterval=15",
			"-o",
			"ServerAliveCountMax=3",
		]

		const keyArgs = this.config.vpsKeyPath ? ["-i", this.config.vpsKeyPath] : []

		this._runCommand("scp", [
			...sshHangPrevention,
			...keyArgs,
			bundlePath,
			`${this.config.vpsUser}@${this.config.vpsHost}:${this.config.vpsDeployPath}/`,
		])

		this._runCommand("ssh", [
			...sshHangPrevention,
			...keyArgs,
			`${this.config.vpsUser}@${this.config.vpsHost}`,
			`cd ${this._shellQuote(this.config.vpsDeployPath)} && tar -xzf ${this._shellQuote(`${version}.tar.gz`)} && ./scripts/restart.sh`,
		])
	}

	/**
	 * @returns {Promise<boolean>}
	 * @private
	 */
	async _runHealthCheck() {
		const result = await this.healthCheck()
		return result.ok
	}

	/**
	 * @param {string} outPath
	 * @private
	 */
	async _createDeployBundle(outPath) {
		const excludeArgs = ["node_modules", ".git", ".super-roo", "dist", "out", ".vscode"].flatMap((e) => [
			"--exclude",
			e,
		])
		this._runCommand("tar", ["-czf", outPath, ...excludeArgs, "."], process.cwd())
	}

	/**
	 * @param {string} command
	 * @param {string[]} args
	 * @param {string} [cwd]
	 * @private
	 */
	_runCommand(command, args, cwd = process.cwd()) {
		const result = spawnSync(command, args, { cwd, stdio: "ignore", shell: false })
		if (result.error) throw result.error
		if (result.status !== 0) {
			throw new Error(`${command} exited with code ${result.status ?? "unknown"}`)
		}
	}

	/**
	 * @param {string} value
	 * @returns {string}
	 * @private
	 */
	_shellQuote(value) {
		return `'${value.replace(/'/g, "'\\''")}'`
	}

	/**
	 * @private
	 */
	_trimHistory() {
		while (this.history.length > this.config.maxRollbackVersions) {
			this.history.pop()
		}
	}

	/**
	 * @param {string} url
	 * @param {Object} [opts]
	 * @param {number} [opts.timeout]
	 * @returns {Promise<Response>}
	 * @private
	 */
	async _fetch(url, opts = {}) {
		return globalThis.fetch(url, { signal: AbortSignal.timeout(opts.timeout ?? 30000) })
	}
}

module.exports = { DeployOrchestrator }
