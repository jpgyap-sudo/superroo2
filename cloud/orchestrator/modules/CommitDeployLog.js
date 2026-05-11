/**
 * Cloud Orchestrator — Commit & Deploy Log.
 *
 * Append-only log for recording all commits and deployments across all
 * coding agents. Persisted as JSON for compatibility with the dashboard.
 *
 * Ported from src/super-roo/product-memory/CommitDeployLog.ts for the cloud runtime.
 */

const fs = require("node:fs")
const path = require("node:path")

const DEFAULT_LOG_PATH = path.join(__dirname, "..", "data", "commit-deploy-log.json")

// ─── Constants ──────────────────────────────────────────────────────────────

const CommitType = Object.freeze({
	FEATURE: "feature",
	BUGFIX: "bugfix",
	REFACTOR: "refactor",
	DOCS: "docs",
	CONFIG: "config",
	TEST: "test",
	DEPLOY: "deploy",
	OTHER: "other",
})

const DeployStatus = Object.freeze({
	HEALTHY: "healthy",
	UNHEALTHY: "unhealthy",
	ROLLED_BACK: "rolled_back",
	FAILED: "failed",
})

class CommitDeployLog {
	/**
	 * @param {Object} opts
	 * @param {string} [opts.logPath] - Path to persist the JSON log file.
	 * @param {Object} [opts.memoryStore] - Optional MemoryStore for additional persistence.
	 */
	constructor(opts = {}) {
		this.logPath = opts.logPath || DEFAULT_LOG_PATH
		this.memoryStore = opts.memoryStore || null
		this._data = { commits: [], deploys: [] }
		this._initialized = false
	}

	async initialize() {
		if (this._initialized) return
		this._initialized = true

		// Try loading from MemoryStore first
		let loaded = false
		if (this.memoryStore) {
			try {
				const stored = this.memoryStore.get("commit_deploy_log")
				if (stored) {
					this._data = typeof stored === "string" ? JSON.parse(stored) : stored
					loaded = true
					console.log(
						`[orchestrator/commit-deploy-log] Loaded from MemoryStore (${this._data.commits.length} commits, ${this._data.deploys.length} deploys)`,
					)
				}
			} catch (err) {
				console.warn("[orchestrator/commit-deploy-log] Failed to load from MemoryStore:", err.message)
			}
		}

		if (!loaded) {
			try {
				if (fs.existsSync(this.logPath)) {
					const raw = fs.readFileSync(this.logPath, "utf8")
					this._data = JSON.parse(raw)
					console.log(
						`[orchestrator/commit-deploy-log] Loaded from ${this.logPath} (${this._data.commits.length} commits, ${this._data.deploys.length} deploys)`,
					)
					loaded = true
				}
			} catch (err) {
				console.warn("[orchestrator/commit-deploy-log] Failed to load from file:", err.message)
			}
		}

		if (!loaded) {
			this._data = { commits: [], deploys: [] }
			await this._persist()
			console.log("[orchestrator/commit-deploy-log] Initialized empty log")
		}
	}

	async _persist() {
		// Write to file
		try {
			const dir = path.dirname(this.logPath)
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true })
			}
			fs.writeFileSync(this.logPath, JSON.stringify(this._data, null, 2), "utf8")
		} catch (err) {
			console.warn("[orchestrator/commit-deploy-log] Failed to persist to file:", err.message)
		}

		// Also persist to MemoryStore if available
		if (this.memoryStore) {
			try {
				this.memoryStore.set("commit_deploy_log", this._data, "orchestrator")
			} catch (err) {
				console.warn("[orchestrator/commit-deploy-log] Failed to persist to MemoryStore:", err.message)
			}
		}
	}

	// ── Commits ───────────────────────────────────────────────────────────

	/**
	 * Record a commit.
	 * @param {Object} input
	 * @param {string} input.commitSha
	 * @param {string} input.agent
	 * @param {string} input.type - One of CommitType values.
	 * @param {string} input.title
	 * @param {string[]} [input.filesChanged]
	 * @param {string[]} [input.featuresAffected]
	 * @returns {Object} The recorded commit.
	 */
	async recordCommit(input) {
		const commit = {
			commitSha: input.commitSha,
			agent: input.agent,
			type: input.type || CommitType.OTHER,
			title: input.title,
			filesChanged: input.filesChanged || [],
			featuresAffected: input.featuresAffected || [],
			timestamp: Date.now(),
		}
		this._data.commits.push(commit)
		await this._persist()
		return commit
	}

	/**
	 * Get commits with optional filters.
	 * @param {Object} [filter]
	 * @param {string} [filter.agent]
	 * @param {string} [filter.type]
	 * @param {number} [filter.limit=20]
	 * @returns {Object[]}
	 */
	getCommits(filter = {}) {
		let result = [...this._data.commits]
		if (filter.agent) {
			result = result.filter((c) => c.agent === filter.agent)
		}
		if (filter.type) {
			result = result.filter((c) => c.type === filter.type)
		}
		result.sort((a, b) => b.timestamp - a.timestamp)
		const limit = filter.limit || 20
		return result.slice(0, limit)
	}

	// ── Deploys ───────────────────────────────────────────────────────────

	/**
	 * Record a deployment.
	 * @param {Object} input
	 * @param {string} input.version
	 * @param {string} input.commitSha
	 * @param {string} input.agent
	 * @returns {Object} The recorded deploy.
	 */
	async recordDeploy(input) {
		const deploy = {
			version: input.version,
			commitSha: input.commitSha,
			agent: input.agent,
			status: "deploying",
			timestamp: Date.now(),
		}
		this._data.deploys.push(deploy)
		await this._persist()
		return deploy
	}

	/**
	 * Update the status of a deployment.
	 * @param {string} version
	 * @param {string} commitSha
	 * @param {string} status - One of DeployStatus values.
	 * @returns {boolean} Whether the deploy was found and updated.
	 */
	async updateDeployStatus(version, commitSha, status) {
		const deploy = this._data.deploys.find((d) => d.version === version && d.commitSha === commitSha)
		if (!deploy) return false
		deploy.status = status
		await this._persist()
		return true
	}

	/**
	 * Get deploys with optional filters.
	 * @param {Object} [filter]
	 * @param {string} [filter.status]
	 * @param {string} [filter.agent]
	 * @param {number} [filter.limit=10]
	 * @returns {Object[]}
	 */
	getDeploys(filter = {}) {
		let result = [...this._data.deploys]
		if (filter.status) {
			result = result.filter((d) => d.status === filter.status)
		}
		if (filter.agent) {
			result = result.filter((d) => d.agent === filter.agent)
		}
		result.sort((a, b) => b.timestamp - a.timestamp)
		const limit = filter.limit || 10
		return result.slice(0, limit)
	}

	/**
	 * Get the latest deployment.
	 * @returns {Object|null}
	 */
	getLatestDeploy() {
		if (this._data.deploys.length === 0) return null
		const sorted = [...this._data.deploys].sort((a, b) => b.timestamp - a.timestamp)
		return sorted[0]
	}

	/**
	 * Get aggregate stats.
	 * @returns {Object}
	 */
	getStats() {
		const commits = this._data.commits
		const deploys = this._data.deploys

		const commitCountByType = {}
		for (const c of commits) {
			commitCountByType[c.type] = (commitCountByType[c.type] || 0) + 1
		}

		const deployCountByStatus = {}
		for (const d of deploys) {
			deployCountByStatus[d.status] = (deployCountByStatus[d.status] || 0) + 1
		}

		const lastCommit = commits.length > 0 ? commits.reduce((a, b) => (a.timestamp > b.timestamp ? a : b)) : null

		const lastDeploy = this.getLatestDeploy()

		return {
			totalCommits: commits.length,
			totalDeploys: deploys.length,
			commitCountByType,
			deployCountByStatus,
			lastCommit: lastCommit
				? { sha: lastCommit.commitSha, title: lastCommit.title, timestamp: lastCommit.timestamp }
				: null,
			lastDeploy: lastDeploy
				? { version: lastDeploy.version, status: lastDeploy.status, timestamp: lastDeploy.timestamp }
				: null,
		}
	}
}

module.exports = { CommitDeployLog, CommitType, DeployStatus }
