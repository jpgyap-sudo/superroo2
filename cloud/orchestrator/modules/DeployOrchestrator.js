/**
 * DeployOrchestrator — Unified deployment entry point for all AI coding agents.
 *
 * Extends QueueManager for shared queue infrastructure (RAM check, concurrent limits,
 * queue lifecycle). Adds deploy-specific logic:
 *
 * 1. SSH-based deployment to VPS
 * 2. Health check before/after deploy
 * 3. Auto-rollback on failure
 * 4. CommitDeployLog integration
 * 5. Build tracking (registerBuild / completeBuild)
 * 6. Agent-aware tracking
 */

const crypto = require("crypto")
const path = require("path")
const fs = require("fs")
const http = require("http")
const { spawn } = require("child_process")
const { QueueManager, safeJsonParse, now } = require("./QueueManager")

// ── Constants ────────────────────────────────────────────────────────────────

const DEPLOY_STATUS = Object.freeze({
	QUEUED: "queued",
	RUNNING: "running",
	SUCCESS: "success",
	FAILED: "failed",
	CANCELLED: "cancelled",
	ROLLED_BACK: "rolled_back",
})

const BUILD_STATUS = Object.freeze({
	QUEUED: "queued",
	RUNNING: "running",
	SUCCESS: "success",
	FAILED: "failed",
	CANCELLED: "cancelled",
	SKIPPED: "skipped",
})

const DEPLOY_TABLE = "deploy_orchestrator_deployments"
const BUILD_TABLE = "deploy_orchestrator_builds"
const QUEUE_TABLE = "deploy_orchestrator_queue"

// ── DeployOrchestrator ───────────────────────────────────────────────────────

class DeployOrchestrator extends QueueManager {
	/**
	 * @param {object} opts
	 * @param {string} opts.projectName
	 * @param {string} opts.vpsHost - Tailscale IP (e.g. 100.64.175.88)
	 * @param {string} opts.vpsUser - SSH user (e.g. root)
	 * @param {string} opts.deployPath - Remote deploy path
	 * @param {string} opts.healthUrl - URL for health checks
	 * @param {string} [opts.sshKeyPath] - Path to SSH identity file
	 * @param {object} opts.memory - MemoryStore instance for SQLite persistence
	 * @param {object} opts.eventLog - EventLog instance
	 * @param {object} opts.commitDeployLog - CommitDeployLog instance
	 * @param {number} [opts.maxConcurrentDeploys=1] - Max concurrent deployments per project
	 * @param {number} [opts.maxConcurrentBuilds=1] - Max concurrent builds
	 * @param {number} [opts.healthCheckTimeoutMs=30000] - Health check timeout
	 * @param {number} [opts.deployTimeoutMs=300000] - Deploy timeout (5 min)
	 * @param {object} [opts.siblingOrchestrators] - Map of name -> orchestrator for cross-awareness
	 */
	constructor(opts) {
		// Initialize QueueManager base with deploy-specific queue config
		super({
			memory: opts.memory,
			eventLog: opts.eventLog,
			name: "deploy-orchestrator",
			queueTable: QUEUE_TABLE,
			maxConcurrent: opts.maxConcurrentDeploys || 1,
			perProjectConcurrency: true, // Per-project concurrency for deploys
			ramOrchestratorUrl: opts.ramOrchestratorUrl || "http://127.0.0.1:3456",
			ramCheckTimeoutMs: opts.ramCheckTimeoutMs || 3000,
			maxRamPercent: opts.maxRamPercent || 80,
			ramDeferOnStates: opts.ramDeferOnStates || ["critical", "danger"],
			siblingOrchestrators: opts.siblingOrchestrators || {},
		})

		this.projectName = opts.projectName || "superroo"
		this.vpsHost = opts.vpsHost || "100.64.175.88"
		this.vpsUser = opts.vpsUser || "root"
		this.deployPath = opts.deployPath || "/root/superroo"
		this.healthUrl = opts.healthUrl || "http://100.64.175.88:3419/api/health"
		this.sshKeyPath = opts.sshKeyPath || null
		this.commitDeployLog = opts.commitDeployLog
		this.maxConcurrentDeploys = opts.maxConcurrentDeploys || 1
		this.maxConcurrentBuilds = opts.maxConcurrentBuilds || 1
		this.healthCheckTimeoutMs = opts.healthCheckTimeoutMs || 30000
		this.deployTimeoutMs = opts.deployTimeoutMs || 300000
	}

	/**
	 * Initialize SQLite tables (deploy + build tables in addition to queue table).
	 */
	async initialize() {
		if (this._initialized) return
		if (!this.memory) return

		// Initialize base queue table
		await super.initialize()

		const db = await this.memory.getDb()

		await db.exec(`
			CREATE TABLE IF NOT EXISTS ${DEPLOY_TABLE} (
				id TEXT PRIMARY KEY,
				project_name TEXT NOT NULL,
				version TEXT,
				commit_sha TEXT,
				status TEXT NOT NULL DEFAULT '${DEPLOY_STATUS.QUEUED}',
				agent TEXT,
				initiated_by TEXT,
				previous_version TEXT,
				health_before TEXT,
				health_after TEXT,
				error TEXT,
				rollback_version TEXT,
				rollback_status TEXT,
				metadata TEXT,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL,
				started_at INTEGER,
				completed_at INTEGER
			)
		`)

		await db.exec(`
			CREATE TABLE IF NOT EXISTS ${BUILD_TABLE} (
				id TEXT PRIMARY KEY,
				project_name TEXT NOT NULL,
				build_type TEXT NOT NULL,
				image_tag TEXT,
				commit_sha TEXT,
				status TEXT NOT NULL DEFAULT '${BUILD_STATUS.QUEUED}',
				agent TEXT,
				output TEXT,
				error TEXT,
				metadata TEXT,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL,
				started_at INTEGER,
				completed_at INTEGER
			)
		`)

		this._initialized = true
	}

	// ── Health check ──────────────────────────────────────────────────────

	/**
	 * Perform a health check against the current deployment.
	 * @returns {Promise<{healthy: boolean, statusCode?: number, error?: string}>}
	 */
	async healthCheck() {
		const timeoutMs = this.healthCheckTimeoutMs
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), timeoutMs)

		try {
			const res = await fetch(this.healthUrl, {
				signal: controller.signal,
				timeout: timeoutMs,
			})
			clearTimeout(timer)
			const healthy = res.status >= 200 && res.status < 500
			return { healthy, statusCode: res.status }
		} catch (err) {
			clearTimeout(timer)
			return { healthy: false, error: err.message }
		}
	}

	// ── Deploy logic ──────────────────────────────────────────────────────

	async _createDeployBundle(outPath) {
		const excludeArgs = [
			"node_modules",
			".git",
			".super-roo",
			"dist",
			"out",
			".vscode",
			"__pycache__",
			".next",
			"coverage",
			".env",
		].flatMap((e) => ["--exclude", e])
		await this._runCommand("tar", ["-czf", outPath, ...excludeArgs, "-C", process.cwd(), "."])
	}

	async _deployToVps(version) {
		const bundlePath = `/tmp/deploy-${version || "latest"}-${Date.now()}.tar.gz`

		try {
			// Create deploy bundle
			await this._createDeployBundle(bundlePath)

			// Ensure remote directory exists
			const sshMkdir = [
				"ssh",
				this.sshKeyPath ? ["-i", this.sshKeyPath] : [],
				`${this.vpsUser}@${this.vpsHost}`,
				`mkdir -p ${this.deployPath}`,
			].flat()
			await this._runCommand(sshMkdir[0], sshMkdir.slice(1))

			// Copy bundle to VPS
			const scpArgs = [
				this.sshKeyPath ? ["-i", this.sshKeyPath] : [],
				bundlePath,
				`${this.vpsUser}@${this.vpsHost}:${this.deployPath}/deploy.tar.gz`,
			].flat()
			await this._runCommand("scp", scpArgs)

			// Extract and restart on VPS
			const sshExtract = [
				"ssh",
				this.sshKeyPath ? ["-i", this.sshKeyPath] : [],
				`${this.vpsUser}@${this.vpsHost}`,
				[
					`cd ${this.deployPath}`,
					"tar -xzf deploy.tar.gz",
					"rm deploy.tar.gz",
					// Detect and restart the right process
					"if command -v docker &>/dev/null && [ -f docker-compose.yml ]; then docker-compose up -d --build 2>/dev/null || docker compose up -d --build 2>/dev/null; fi",
					"if command -v pm2 &>/dev/null; then pm2 restart all --update-env 2>/dev/null || true; fi",
					"if command -v systemctl &>/dev/null; then systemctl restart superroo 2>/dev/null || true; fi",
				].join(" && "),
			].flat()
			await this._runCommand(sshExtract[0], sshExtract.slice(1), undefined, this.deployTimeoutMs)

			return { success: true }
		} catch (err) {
			return { success: false, error: err.message }
		} finally {
			// Clean up local bundle
			try {
				fs.unlinkSync(bundlePath)
			} catch {}
		}
	}

	async _triggerGitHubWorkflow(version, commitSha) {
		const ghToken = process.env.GITHUB_TOKEN || process.env.PAT_TOKEN
		if (!ghToken) {
			return { success: false, error: "No GitHub token available" }
		}

		const manifest = {
			ref: "main",
			inputs: {
				version: version || "latest",
				commit_sha: commitSha || "",
			},
		}

		try {
			const res = await fetch(
				"https://api.github.com/repos/jpgyap/superroo2/actions/workflows/deploy.yml/dispatches",
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${ghToken}`,
						"Content-Type": "application/json",
						"User-Agent": "superroo-deploy-orchestrator",
					},
					body: JSON.stringify(manifest),
				},
			)

			if (!res.ok) {
				const text = await res.text()
				return { success: false, error: `GitHub API error ${res.status}: ${text}` }
			}

			return { success: true }
		} catch (err) {
			return { success: false, error: err.message }
		}
	}

	// ── Rollback ──────────────────────────────────────────────────────────

	async rollback(deploymentId) {
		await this.initialize()

		const currentDeploy = await this._getOne(`SELECT * FROM ${DEPLOY_TABLE} WHERE id = ?`, [deploymentId])

		if (!currentDeploy) {
			return { success: false, error: "Deployment not found" }
		}

		// Find the previous successful deployment
		const previousDeploy = await this._getOne(
			`SELECT * FROM ${DEPLOY_TABLE} WHERE project_name = ? AND status = ? AND id != ? ORDER BY created_at DESC LIMIT 1`,
			[this.projectName, DEPLOY_STATUS.SUCCESS, deploymentId],
		)

		if (!previousDeploy) {
			await this._emitEvent(
				"rollback.no-previous",
				{
					project: this.projectName,
					deploymentId,
				},
				"warning",
			)
			return { success: false, error: "No previous successful deployment to rollback to" }
		}

		const rollbackVersion = previousDeploy.version || "previous"

		await this._emitEvent(
			"rollback.started",
			{
				project: this.projectName,
				fromVersion: currentDeploy.version,
				toVersion: rollbackVersion,
				deploymentId,
			},
			"warning",
		)

		try {
			// Re-deploy the previous version
			const result = await this._deployToVps(rollbackVersion)

			if (result.success) {
				await this._run(
					`UPDATE ${DEPLOY_TABLE} SET status = ?, rollback_version = ?, rollback_status = ?, updated_at = ?, completed_at = ? WHERE id = ?`,
					[DEPLOY_STATUS.ROLLED_BACK, rollbackVersion, "success", now(), now(), deploymentId],
				)

				if (this.commitDeployLog) {
					try {
						await this.commitDeployLog.recordDeploy({
							version: rollbackVersion,
							commitSha: previousDeploy.commit_sha || "",
							status: "healthy",
							agent: "deploy-orchestrator",
							repoName: this.projectName,
							metadata: JSON.stringify({
								rollbackFrom: currentDeploy?.version || "unknown",
								reason: "auto-rollback after failed deployment",
							}),
						})
					} catch {}
				}

				await this._emitEvent(
					"rollback.completed",
					{
						project: this.projectName,
						rollbackVersion,
					},
					"info",
				)

				return { success: true, rollbackVersion }
			} else {
				await this._emitEvent(
					"rollback.failed",
					{
						project: this.projectName,
						rollbackVersion,
						error: result.error,
					},
					"error",
				)
				return { success: false, error: result.error }
			}
		} catch (err) {
			await this._emitEvent(
				"rollback.failed",
				{
					project: this.projectName,
					rollbackVersion,
					error: err.message,
				},
				"error",
			)
			return { success: false, error: err.message }
		}
	}

	// ── Main deploy method ────────────────────────────────────────────────

	/**
	 * Queue or execute a deployment.
	 * @param {object} opts
	 * @param {string} opts.version - Version to deploy
	 * @param {string} opts.commitSha - Commit SHA
	 * @param {string} [opts.agent] - AI agent name (e.g. "deepseek", "codex")
	 * @param {boolean} [opts.force=false] - Skip queue, force deploy immediately
	 * @param {boolean} [opts.skipHealthCheck=false] - Skip pre-deploy health check
	 * @param {boolean} [opts.skipBuild=false] - Skip build step
	 * @returns {Promise<{queued: boolean, deploymentId: string, status: string, error?: string}>}
	 */
	async deploy(opts) {
		const {
			version,
			commitSha,
			agent = "unknown",
			force = false,
			skipHealthCheck = false,
			skipBuild = false,
			projectName,
		} = typeof opts === "string"
			? { version: opts, commitSha: arguments[1], agent: arguments[2] || "unknown" }
			: opts

		// Allow per-call projectName override for cross-project support
		const activeProject = projectName || this.projectName

		await this.initialize()

		const deploymentId = crypto.randomUUID()

		// Step 1: Try to enqueue via QueueManager (RAM check + sibling check + concurrent check)
		if (!force) {
			const queueResult = await this.enqueue({
				projectName: activeProject,
				operationType: "deploy",
				priority: 1, // Deploy is high priority
				input: { version, commitSha, skipHealthCheck, skipBuild, projectName, deploymentId },
				agent,
				description: `Deploy ${version || "latest"} to ${activeProject}`,
				metadata: { deploymentId },
			})

			if (queueResult.queued) {
				// Also record in deploy table for tracking
				await this._run(
					`INSERT INTO ${DEPLOY_TABLE} (id, project_name, version, commit_sha, status, agent, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					[
						deploymentId,
						activeProject,
						version || null,
						commitSha || null,
						DEPLOY_STATUS.QUEUED,
						agent,
						JSON.stringify({ force, skipHealthCheck, skipBuild, projectName, queueId: queueResult.id }),
						now(),
						now(),
					],
				)

				return {
					queued: true,
					deploymentId,
					status: DEPLOY_STATUS.QUEUED,
					error: queueResult.reason,
				}
			}

			// Not queued — mark queue entry as started before proceeding
			await this.markStarted(queueResult.id, { projectName: activeProject })
		}

		// Record deployment start in deploy table
		await this._run(
			`INSERT INTO ${DEPLOY_TABLE} (id, project_name, version, commit_sha, status, agent, initiated_by, metadata, created_at, updated_at, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				deploymentId,
				activeProject,
				version || null,
				commitSha || null,
				DEPLOY_STATUS.RUNNING,
				agent,
				agent,
				JSON.stringify({ force, skipHealthCheck, skipBuild, projectName }),
				now(),
				now(),
				now(),
			],
		)

		await this._emitEvent(
			"deploy.started",
			{
				project: activeProject,
				version,
				commitSha,
				agent,
				deploymentId,
			},
			"info",
		)

		try {
			// Step 1: Health check before deploy
			if (!skipHealthCheck) {
				const health = await this.healthCheck()
				await this._run(`UPDATE ${DEPLOY_TABLE} SET health_before = ?, updated_at = ? WHERE id = ?`, [
					JSON.stringify(health),
					now(),
					deploymentId,
				])

				if (!health.healthy) {
					throw new Error(`Pre-deploy health check failed: ${health.error || `HTTP ${health.statusCode}`}`)
				}
			}

			// Step 2: Deploy to VPS
			const deployResult = await this._deployToVps(version)

			if (!deployResult.success) {
				throw new Error(`Deploy failed: ${deployResult.error}`)
			}

			// Step 3: Health check after deploy
			let healthAfter = null
			if (!skipHealthCheck) {
				await new Promise((r) => setTimeout(r, 5000))
				healthAfter = await this.healthCheck()
				await this._run(`UPDATE ${DEPLOY_TABLE} SET health_after = ?, updated_at = ? WHERE id = ?`, [
					JSON.stringify(healthAfter),
					now(),
					deploymentId,
				])
			}

			// Step 4: Check post-deploy health
			if (healthAfter && !healthAfter.healthy) {
				await this._run(
					`UPDATE ${DEPLOY_TABLE} SET status = ?, error = ?, updated_at = ?, completed_at = ? WHERE id = ?`,
					[
						DEPLOY_STATUS.FAILED,
						`Post-deploy health check failed: ${healthAfter.error || `HTTP ${healthAfter.statusCode}`}`,
						now(),
						now(),
						deploymentId,
					],
				)

				await this._emitEvent(
					"deploy.failed",
					{
						project: activeProject,
						version,
						deploymentId,
						error: "Post-deploy health check failed, initiating rollback",
					},
					"error",
				)

				const rollbackResult = await this.rollback(deploymentId)

				return {
					queued: false,
					deploymentId,
					status: DEPLOY_STATUS.FAILED,
					error: "Post-deploy health check failed",
					rollback: rollbackResult,
				}
			}

			// Step 5: Mark as success
			await this._run(`UPDATE ${DEPLOY_TABLE} SET status = ?, updated_at = ?, completed_at = ? WHERE id = ?`, [
				DEPLOY_STATUS.SUCCESS,
				now(),
				now(),
				deploymentId,
			])

			if (this.commitDeployLog) {
				try {
					await this.commitDeployLog.recordDeploy({
						version: version || "latest",
						commitSha: commitSha || "",
						status: healthAfter?.healthy ? "healthy" : "unhealthy",
						agent,
						repoName: activeProject,
						metadata: JSON.stringify({
							deploymentId,
							project: activeProject,
						}),
					})
				} catch {}
			}

			await this._emitEvent(
				"deploy.completed",
				{
					project: activeProject,
					version,
					commitSha,
					agent,
					deploymentId,
					healthy: healthAfter?.healthy ?? true,
				},
				"info",
			)

			// Mark queue entry as completed — this also triggers _processQueue()
			await this.markCompleted(deploymentId, {
				status: "success",
				projectName: activeProject,
			})

			return { queued: false, deploymentId, status: DEPLOY_STATUS.SUCCESS }
		} catch (err) {
			await this._run(
				`UPDATE ${DEPLOY_TABLE} SET status = ?, error = ?, updated_at = ?, completed_at = ? WHERE id = ?`,
				[DEPLOY_STATUS.FAILED, err.message, now(), now(), deploymentId],
			)

			await this._emitEvent(
				"deploy.failed",
				{
					project: activeProject,
					version,
					commitSha,
					agent,
					deploymentId,
					error: err.message,
				},
				"error",
			)

			let rollbackResult = null
			if (!err.message.includes("Pre-deploy health check")) {
				rollbackResult = await this.rollback(deploymentId)
			}

			// Mark queue entry as failed — this also triggers _processQueue()
			await this.markCompleted(deploymentId, {
				status: "failed",
				error: err.message,
				projectName: activeProject,
			})

			return {
				queued: false,
				deploymentId,
				status: DEPLOY_STATUS.FAILED,
				error: err.message,
				rollback: rollbackResult,
			}
		}
	}

	// ── Queue processing override ─────────────────────────────────────────

	/**
	 * Override QueueManager._executeQueuedOperation to handle deploy queue items.
	 * Deploy queue items are re-submitted via deploy() with force=true.
	 */
	async _executeQueuedOperation(queueItem) {
		const input = safeJsonParse(queueItem.input, {})

		// Use the queue item's ID as the deployment ID so markStarted/markCompleted
		// in deploy() correctly reference the queue entry
		await this.deploy({
			version: input.version,
			commitSha: input.commitSha,
			agent: queueItem.agent || "unknown",
			force: true,
			skipHealthCheck: input.skipHealthCheck,
			skipBuild: input.skipBuild,
			projectName: input.projectName || queueItem.project_name,
		})
	}

	// ── Build tracking ────────────────────────────────────────────────────

	/**
	 * Register a build in the tracking system.
	 * @param {object} opts
	 * @param {string} opts.buildType - "docker", "nextjs", "typescript", "static"
	 * @param {string} [opts.imageTag] - Docker image tag
	 * @param {string} [opts.commitSha] - Commit SHA
	 * @param {string} [opts.agent] - AI agent name
	 * @returns {Promise<{buildId: string, skipped: boolean, reason?: string}>}
	 */
	async registerBuild(opts) {
		await this.initialize()

		const { buildType, imageTag, commitSha, agent = "unknown" } = opts
		const buildId = crypto.randomUUID()

		// Check for duplicate build (same image tag + commit SHA)
		if (imageTag && commitSha) {
			const existing = await this._getOne(
				`SELECT * FROM ${BUILD_TABLE} WHERE project_name = ? AND image_tag = ? AND commit_sha = ? AND status = ? ORDER BY created_at DESC LIMIT 1`,
				[this.projectName, imageTag, commitSha, BUILD_STATUS.SUCCESS],
			)

			if (existing) {
				await this._emitEvent(
					"build.skipped",
					{
						project: this.projectName,
						buildType,
						imageTag,
						commitSha,
						reason: "Duplicate build (already exists with same image tag and commit SHA)",
					},
					"info",
				)

				return { buildId: existing.id, skipped: true, reason: "Duplicate build skipped" }
			}
		}

		// Check for active builds (prevent concurrent builds)
		const activeBuild = this._activeBuilds.get(this.projectName)
		if (activeBuild) {
			await this._run(
				`INSERT INTO ${BUILD_TABLE} (id, project_name, build_type, image_tag, commit_sha, status, agent, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					buildId,
					this.projectName,
					buildType,
					imageTag || null,
					commitSha || null,
					BUILD_STATUS.QUEUED,
					agent,
					JSON.stringify({ blockedBy: activeBuild }),
					now(),
					now(),
				],
			)

			return { buildId, skipped: false }
		}

		this._activeBuilds.set(this.projectName, buildId)

		await this._run(
			`INSERT INTO ${BUILD_TABLE} (id, project_name, build_type, image_tag, commit_sha, status, agent, created_at, updated_at, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				buildId,
				this.projectName,
				buildType,
				imageTag || null,
				commitSha || null,
				BUILD_STATUS.RUNNING,
				agent,
				now(),
				now(),
				now(),
			],
		)

		await this._emitEvent(
			"build.started",
			{
				project: this.projectName,
				buildType,
				imageTag,
				commitSha,
				agent,
				buildId,
			},
			"info",
		)

		return { buildId, skipped: false }
	}

	/**
	 * Complete a build (success or failure).
	 * @param {string} buildId
	 * @param {object} opts
	 * @param {string} opts.status - BUILD_STATUS.SUCCESS or BUILD_STATUS.FAILED
	 * @param {string} [opts.output] - Build output
	 * @param {string} [opts.error] - Error message
	 */
	async completeBuild(buildId, opts) {
		const { status, output, error } = opts

		await this._run(
			`UPDATE ${BUILD_TABLE} SET status = ?, output = ?, error = ?, updated_at = ?, completed_at = ? WHERE id = ?`,
			[status, output || null, error || null, now(), now(), buildId],
		)

		const build = await this._getOne(`SELECT * FROM ${BUILD_TABLE} WHERE id = ?`, [buildId])
		if (build && this._activeBuilds.get(build.project_name) === buildId) {
			this._activeBuilds.delete(build.project_name)
		}

		await this._emitEvent(
			"build.completed",
			{
				project: build?.project_name || this.projectName,
				buildId,
				status,
				error,
			},
			status === BUILD_STATUS.SUCCESS ? "info" : "error",
		)

		await this._processBuildQueue()
	}

	async _processBuildQueue() {
		const nextBuild = await this._getOne(
			`SELECT * FROM ${BUILD_TABLE} WHERE project_name = ? AND status = ? ORDER BY created_at ASC LIMIT 1`,
			[this.projectName, BUILD_STATUS.QUEUED],
		)

		if (!nextBuild) return

		this._activeBuilds.set(this.projectName, nextBuild.id)
		await this._run(`UPDATE ${BUILD_TABLE} SET status = ?, started_at = ?, updated_at = ? WHERE id = ?`, [
			BUILD_STATUS.RUNNING,
			now(),
			now(),
			nextBuild.id,
		])

		await this._emitEvent(
			"build.started",
			{
				project: this.projectName,
				buildType: nextBuild.build_type,
				buildId: nextBuild.id,
			},
			"info",
		)
	}

	// ── Shell command helper ──────────────────────────────────────────────

	_runCommand(command, args, cwd = process.cwd(), timeoutMs = 120000) {
		if (this.sshKeyPath && (command === "ssh" || command === "scp")) {
			args = ["-i", this.sshKeyPath, ...args]
		}
		return new Promise((resolve, reject) => {
			const child = spawn(command, args, { cwd, shell: true, timeout: timeoutMs })
			let stdout = ""
			let stderr = ""
			child.stdout.on("data", (d) => {
				stdout += d.toString()
			})
			child.stderr.on("data", (d) => {
				stderr += d.toString()
			})
			child.on("close", (code) => {
				if (code === 0) resolve(stdout.trim())
				else reject(new Error(`Exit code ${code}: ${stderr.trim() || stdout.trim()}`))
			})
			child.on("error", reject)
		})
	}

	_shellQuote(str) {
		return `'${str.replace(/'/g, "'\\''")}'`
	}

	// ── API methods ───────────────────────────────────────────────────────

	/**
	 * Get the deployment queue.
	 * @param {object} [filter]
	 * @param {string} [filter.status] - Filter by status
	 * @param {number} [filter.limit=50]
	 * @returns {Promise<Array>}
	 */
	async getQueue(filter = {}) {
		await this.initialize()
		const { status, limit = 50 } = filter

		let sql = `SELECT * FROM ${QUEUE_TABLE} WHERE project_name = ?`
		const params = [this.projectName]

		if (status) {
			sql += " AND status = ?"
			params.push(status)
		}

		sql += " ORDER BY priority DESC, created_at ASC LIMIT ?"
		params.push(limit)

		const rows = await this._query(sql, params)
		return rows.map((r) => ({
			id: r.id,
			projectName: r.project_name,
			operationType: r.operation_type,
			priority: r.priority,
			status: r.status,
			input: safeJsonParse(r.input, {}),
			agent: r.agent,
			agentSource: r.agent_source,
			description: r.description,
			output: r.output,
			error: r.error,
			metadata: safeJsonParse(r.metadata, {}),
			createdAt: r.created_at,
			updatedAt: r.updated_at,
			startedAt: r.started_at,
			completedAt: r.completed_at,
		}))
	}

	/**
	 * Get active deployments.
	 * @returns {Promise<Array>}
	 */
	async getActiveDeployments() {
		await this.initialize()
		const rows = await this._query(
			`SELECT * FROM ${DEPLOY_TABLE} WHERE project_name = ? AND status IN (?, ?) ORDER BY created_at DESC`,
			[this.projectName, DEPLOY_STATUS.RUNNING, DEPLOY_STATUS.QUEUED],
		)
		return rows.map((r) => this._rowToDeployment(r))
	}

	/**
	 * Get build status for a project.
	 * @param {object} [filter]
	 * @param {string} [filter.buildType]
	 * @param {string} [filter.status]
	 * @param {number} [filter.limit=20]
	 * @returns {Promise<Array>}
	 */
	async getBuildStatus(filter = {}) {
		await this.initialize()
		const { buildType, status, limit = 20 } = filter

		let sql = `SELECT * FROM ${BUILD_TABLE} WHERE project_name = ?`
		const params = [this.projectName]

		if (buildType) {
			sql += " AND build_type = ?"
			params.push(buildType)
		}

		if (status) {
			sql += " AND status = ?"
			params.push(status)
		}

		sql += " ORDER BY created_at DESC LIMIT ?"
		params.push(limit)

		const rows = await this._query(sql, params)
		return rows.map((r) => ({
			id: r.id,
			projectName: r.project_name,
			buildType: r.build_type,
			imageTag: r.image_tag,
			commitSha: r.commit_sha,
			status: r.status,
			agent: r.agent,
			output: r.output,
			error: r.error,
			metadata: safeJsonParse(r.metadata, {}),
			createdAt: r.created_at,
			updatedAt: r.updated_at,
			startedAt: r.started_at,
			completedAt: r.completed_at,
		}))
	}

	/**
	 * Cancel a queued or running deployment.
	 * @param {string} deploymentId
	 * @returns {Promise<{success: boolean, error?: string}>}
	 */
	async cancelDeployment(deploymentId) {
		await this.initialize()

		const deploy = await this._getOne(`SELECT * FROM ${DEPLOY_TABLE} WHERE id = ?`, [deploymentId])

		if (!deploy) {
			return { success: false, error: "Deployment not found" }
		}

		if (
			deploy.status === DEPLOY_STATUS.SUCCESS ||
			deploy.status === DEPLOY_STATUS.FAILED ||
			deploy.status === DEPLOY_STATUS.ROLLED_BACK
		) {
			return { success: false, error: `Cannot cancel deployment with status: ${deploy.status}` }
		}

		await this._run(`UPDATE ${DEPLOY_TABLE} SET status = ?, updated_at = ?, completed_at = ? WHERE id = ?`, [
			DEPLOY_STATUS.CANCELLED,
			now(),
			now(),
			deploymentId,
		])

		// Also cancel in queue using QueueManager's cancelOperation
		await this.cancelOperation(deploymentId)

		await this._emitEvent(
			"deploy.cancelled",
			{
				project: this.projectName,
				deploymentId,
				version: deploy.version,
				agent: deploy.agent,
			},
			"warning",
		)

		return { success: true }
	}

	/**
	 * Force a deployment, bypassing the queue and active deployment checks.
	 * @param {object} opts - Same as deploy() options
	 * @returns {Promise<{queued: boolean, deploymentId: string, status: string, error?: string}>}
	 */
	async forceDeploy(opts) {
		return this.deploy({
			...opts,
			force: true,
		})
	}

	/**
	 * Retry a failed deployment.
	 * @param {string} deploymentId
	 * @returns {Promise<{success: boolean, deploymentId?: string, error?: string}>}
	 */
	async retryDeploy(deploymentId) {
		await this.initialize()

		const deploy = await this._getOne(`SELECT * FROM ${DEPLOY_TABLE} WHERE id = ?`, [deploymentId])

		if (!deploy) {
			return { success: false, error: "Deployment not found" }
		}

		if (deploy.status !== DEPLOY_STATUS.FAILED) {
			return { success: false, error: `Can only retry failed deployments, current status: ${deploy.status}` }
		}

		return this.deploy({
			version: deploy.version,
			commitSha: deploy.commit_sha,
			skipHealthCheck: false,
			skipBuild: false,
			force: false,
			agent: deploy.agent || "unknown",
		})
	}

	/**
	 * Get deployment history.
	 * @param {object} [filter]
	 * @param {number} [filter.limit=20]
	 * @param {string} [filter.status]
	 * @returns {Promise<Array>}
	 */
	async getHistory(filter = {}) {
		await this.initialize()
		const { limit = 20, status } = filter

		let sql = `SELECT * FROM ${DEPLOY_TABLE} WHERE project_name = ?`
		const params = [this.projectName]

		if (status) {
			sql += " AND status = ?"
			params.push(status)
		}

		sql += " ORDER BY created_at DESC LIMIT ?"
		params.push(limit)

		const rows = await this._query(sql, params)
		return rows.map((r) => this._rowToDeployment(r))
	}

	/**
	 * Get deployment statistics.
	 * @returns {Promise<object>}
	 */
	async getStats() {
		await this.initialize()

		const total = await this._getOne(`SELECT COUNT(*) as count FROM ${DEPLOY_TABLE} WHERE project_name = ?`, [
			this.projectName,
		])

		const byStatus = await this._query(
			`SELECT status, COUNT(*) as count FROM ${DEPLOY_TABLE} WHERE project_name = ? GROUP BY status`,
			[this.projectName],
		)

		const byAgent = await this._query(
			`SELECT agent, COUNT(*) as count FROM ${DEPLOY_TABLE} WHERE project_name = ? GROUP BY agent`,
			[this.projectName],
		)

		const latest = await this._getOne(
			`SELECT * FROM ${DEPLOY_TABLE} WHERE project_name = ? ORDER BY created_at DESC LIMIT 1`,
			[this.projectName],
		)

		const queueLength = await this._getOne(
			`SELECT COUNT(*) as count FROM ${QUEUE_TABLE} WHERE project_name = ? AND status = 'pending'`,
			[this.projectName],
		)

		const activeBuilds = await this._getOne(
			`SELECT COUNT(*) as count FROM ${BUILD_TABLE} WHERE project_name = ? AND status = ?`,
			[this.projectName, BUILD_STATUS.RUNNING],
		)

		const statusMap = {}
		for (const row of byStatus) {
			statusMap[row.status] = row.count
		}

		const agentMap = {}
		for (const row of byAgent) {
			agentMap[row.agent] = row.count
		}

		return {
			totalDeployments: total?.count || 0,
			byStatus: statusMap,
			byAgent: agentMap,
			queueLength: queueLength?.count || 0,
			activeBuilds: activeBuilds?.count || 0,
			latestDeployment: latest ? this._rowToDeployment(latest) : null,
			maxConcurrentDeploys: this.maxConcurrentDeploys,
			maxConcurrentBuilds: this.maxConcurrentBuilds,
		}
	}

	// ── Row mapping ───────────────────────────────────────────────────────

	_rowToDeployment(r) {
		return {
			id: r.id,
			projectName: r.project_name,
			version: r.version,
			commitSha: r.commit_sha,
			status: r.status,
			agent: r.agent,
			initiatedBy: r.initiated_by,
			previousVersion: r.previous_version,
			healthBefore: safeJsonParse(r.health_before, null),
			healthAfter: safeJsonParse(r.health_after, null),
			error: r.error,
			rollbackVersion: r.rollback_version,
			rollbackStatus: r.rollback_status,
			metadata: safeJsonParse(r.metadata, {}),
			createdAt: r.created_at,
			updatedAt: r.updated_at,
			startedAt: r.started_at,
			completedAt: r.completed_at,
		}
	}
}

module.exports = { DeployOrchestrator, DEPLOY_STATUS, BUILD_STATUS }
