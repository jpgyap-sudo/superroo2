/**
 * GlobalBuildOrchestrator — Compiles build tasks from multiple coding agent extensions
 * (Claude Code, Codex, SuperRoo agents) and queues Docker image builds on the VPS
 * with VPS-aware throttling to prevent crashes.
 *
 * Extends QueueManager for shared queue infrastructure (RAM check, concurrent limits,
 * queue lifecycle). Adds build-specific logic:
 *
 * 1. Multi-agent task collection — Accept build requests from Claude, Codex, API, webhooks
 * 2. Docker image building — Integrates with UnifiedBuilder for Docker builds
 * 3. Direct Docker build fallback — Runs docker build directly when UnifiedBuilder unavailable
 * 4. Agent source tracking — Records which agent source initiated each build
 * 5. Dashboard integration — Exposes status/history/cancel/retry APIs
 */

const crypto = require("crypto")
const { spawn } = require("child_process")
const { QueueManager, safeJsonParse, now } = require("./QueueManager")

// ── Constants ────────────────────────────────────────────────────────────────

const BUILD_STATUS = Object.freeze({
	QUEUED: "queued",
	RUNNING: "running",
	SUCCESS: "success",
	FAILED: "failed",
	CANCELLED: "cancelled",
	SKIPPED: "skipped",
})

const AGENT_SOURCES = Object.freeze({
	CLAUDE: "claude",
	CODEX: "codex",
	SUPERROO: "superroo",
	API: "api",
	WEBHOOK: "webhook",
})

const BUILD_TABLE = "global_build_tasks"

// ── GlobalBuildOrchestrator ──────────────────────────────────────────────────

class GlobalBuildOrchestrator extends QueueManager {
	/**
	 * @param {object} opts
	 * @param {object} opts.memory - MemoryStore instance for SQLite persistence
	 * @param {object} opts.eventLog - EventLog instance
	 * @param {object} opts.buildQueue - BuildQueue instance
	 * @param {object} opts.unifiedBuilder - UnifiedBuilder instance
	 * @param {object} [opts.deployOrchestrator] - DeployOrchestrator (for cross-awareness)
	 * @param {number} [opts.maxConcurrentBuilds=2] - Max concurrent builds across all projects
	 * @param {number} [opts.maxRamPercent=80] - Max RAM % before builds are queued instead of started
	 * @param {string} [opts.ramOrchestratorUrl] - URL for RAM orchestrator health endpoint
	 * @param {object} [opts.siblingOrchestrators] - Map of name -> orchestrator for cross-awareness
	 */
	constructor(opts) {
		// Initialize QueueManager base with build-specific queue config
		super({
			memory: opts.memory,
			eventLog: opts.eventLog,
			name: "global-build-orchestrator",
			queueTable: BUILD_TABLE,
			maxConcurrent: opts.maxConcurrentBuilds || 2,
			perProjectConcurrency: false, // Global concurrency for builds
			ramOrchestratorUrl: opts.ramOrchestratorUrl || "http://100.64.175.88:3419",
			ramCheckTimeoutMs: opts.ramCheckTimeoutMs || 5000,
			maxRamPercent: opts.maxRamPercent || 80,
			ramDeferOnStates: null, // Percentage-based deferral
			siblingOrchestrators: opts.siblingOrchestrators || {},
		})

		this.buildQueue = opts.buildQueue
		this.unifiedBuilder = opts.unifiedBuilder
		this.maxConcurrentBuilds = opts.maxConcurrentBuilds || 2
		this.maxRamPercent = opts.maxRamPercent || 80
	}

	/**
	 * Initialize SQLite table (build-specific columns in addition to queue columns).
	 */
	async initialize() {
		if (this._initialized) return
		if (!this.memory) return

		// Initialize base queue table
		await super.initialize()

		const db = await this.memory.getDb()

		// Add build-specific columns to the queue table
		// The base QueueManager already creates the table, so we add extra columns
		// via ALTER TABLE (safe, IF NOT EXISTS style)
		const extraColumns = [
			{ name: "build_type", def: "TEXT NOT NULL DEFAULT 'docker'" },
			{ name: "image_tag", def: "TEXT" },
			{ name: "agent_source", def: "TEXT" },
			{ name: "task_description", def: "TEXT" },
			{ name: "build_args", def: "TEXT" },
		]

		for (const col of extraColumns) {
			try {
				await db.exec(`ALTER TABLE ${BUILD_TABLE} ADD COLUMN ${col.name} ${col.def}`)
			} catch {
				// Column already exists — ignore
			}
		}

		// Add indexes for build-specific queries
		try {
			await db.exec(`CREATE INDEX IF NOT EXISTS idx_global_build_project ON ${BUILD_TABLE} (project_name)`)
			await db.exec(`CREATE INDEX IF NOT EXISTS idx_global_build_status ON ${BUILD_TABLE} (status)`)
			await db.exec(`CREATE INDEX IF NOT EXISTS idx_global_build_agent ON ${BUILD_TABLE} (agent_source)`)
		} catch {
			// Indexes may already exist
		}

		this._initialized = true
	}

	// ── Task submission from agents ───────────────────────────────────────

	/**
	 * Submit a build task from any agent source.
	 *
	 * @param {object} opts
	 * @param {string} opts.projectName - Project to build
	 * @param {string} [opts.buildType='docker'] - Build type (docker, nextjs, typescript, static)
	 * @param {string} [opts.imageTag] - Docker image tag (required for docker builds)
	 * @param {string} [opts.commitSha] - Commit SHA for tagging
	 * @param {string} [opts.agent='unknown'] - Agent name
	 * @param {string} [opts.agentSource='api'] - Source: 'claude' | 'codex' | 'superroo' | 'api' | 'webhook'
	 * @param {string} [opts.taskDescription] - Human-readable description of the build task
	 * @param {object} [opts.buildArgs] - Build arguments (for Docker builds)
	 * @param {string} [opts.dockerfile] - Path to Dockerfile
	 * @param {string} [opts.context] - Build context directory
	 * @param {string} [opts.projectDir] - Project directory (for non-Docker builds)
	 * @param {boolean} [opts.skipCache=false] - Force rebuild even if cached
	 * @returns {Promise<{success: boolean, buildId?: string, status?: string, error?: string, queued?: boolean}>}
	 */
	async submitBuild(opts) {
		await this.initialize()

		const {
			projectName,
			buildType = "docker",
			imageTag,
			commitSha,
			agent = "unknown",
			agentSource = AGENT_SOURCES.API,
			taskDescription = "",
			buildArgs = {},
			dockerfile,
			context,
			projectDir,
			skipCache = false,
		} = opts

		if (!projectName) {
			return { success: false, error: "projectName is required" }
		}

		const buildId = crypto.randomUUID()

		// Step 1: Try to enqueue via QueueManager (RAM check + sibling check + concurrent check)
		const queueResult = await this.enqueue({
			projectName,
			operationType: buildType,
			priority: 1,
			input: {
				projectName,
				buildType,
				imageTag,
				commitSha,
				agent,
				agentSource,
				taskDescription,
				buildArgs,
				dockerfile,
				context,
				projectDir,
				skipCache,
			},
			agent,
			agentSource,
			description: taskDescription || `Build ${imageTag || projectName} (${buildType})`,
			metadata: {
				buildId,
				buildType,
				imageTag,
				commitSha,
				agentSource,
			},
		})

		if (queueResult.queued) {
			// Update the queue item with build-specific fields
			await this._run(
				`UPDATE ${BUILD_TABLE} SET build_type = ?, image_tag = ?, agent_source = ?, task_description = ?, build_args = ? WHERE id = ?`,
				[
					buildType,
					imageTag || null,
					agentSource,
					taskDescription || null,
					Object.keys(buildArgs).length > 0 ? JSON.stringify(buildArgs) : null,
					queueResult.id,
				],
			)

			return {
				success: true,
				buildId: queueResult.id,
				status: BUILD_STATUS.QUEUED,
				queued: true,
				error: queueResult.reason,
			}
		}

		// Not queued — execute immediately
		return this._executeBuild({
			buildId,
			projectName,
			buildType,
			imageTag,
			commitSha,
			agent,
			agentSource,
			taskDescription,
			buildArgs,
			dockerfile,
			context,
			projectDir,
			skipCache,
		})
	}

	/**
	 * Execute a build immediately.
	 * @private
	 */
	async _executeBuild(opts) {
		const {
			buildId,
			projectName,
			buildType,
			imageTag,
			commitSha,
			agent,
			agentSource,
			taskDescription,
			buildArgs,
			dockerfile,
			context,
			projectDir,
			skipCache,
		} = opts

		// Mark as started via QueueManager
		await this.markStarted(buildId, { projectName })

		await this._emitEvent(
			"build.started",
			{
				project: projectName,
				buildType,
				imageTag,
				commitSha,
				agent,
				agentSource,
				buildId,
				taskDescription,
			},
			"info",
		)

		try {
			let result

			if (this.unifiedBuilder && buildType === "docker") {
				// Use UnifiedBuilder for Docker builds
				result = await this.unifiedBuilder.buildDocker({
					imageTag: imageTag || `${projectName}:latest`,
					dockerfile: dockerfile || "Dockerfile",
					context: context || projectDir || ".",
					commitSha,
					agent,
					buildArgs,
				})
			} else if (this.unifiedBuilder) {
				// Use UnifiedBuilder auto-detect for other build types
				result = await this.unifiedBuilder.build({
					buildType,
					projectDir: projectDir || ".",
					commitSha,
					agent,
				})
			} else {
				// Fallback: direct Docker build
				result = await this._runDirectDockerBuild({
					imageTag: imageTag || `${projectName}:latest`,
					dockerfile: dockerfile || "Dockerfile",
					context: context || projectDir || ".",
					commitSha,
					buildArgs,
				})
			}

			await this._completeBuild(buildId, {
				status: BUILD_STATUS.SUCCESS,
				output: result.output || JSON.stringify(result),
				projectName,
			})

			return {
				success: true,
				buildId,
				status: BUILD_STATUS.SUCCESS,
				output: result.output,
			}
		} catch (err) {
			const errorMsg = err.message || err.error || JSON.stringify(err)

			await this._completeBuild(buildId, {
				status: BUILD_STATUS.FAILED,
				error: errorMsg,
				projectName,
			})

			return {
				success: false,
				buildId,
				status: BUILD_STATUS.FAILED,
				error: errorMsg,
			}
		}
	}

	/**
	 * Direct Docker build fallback when UnifiedBuilder is unavailable.
	 * @private
	 */
	async _runDirectDockerBuild(opts) {
		const { imageTag, dockerfile, context, commitSha, buildArgs = {} } = opts

		return new Promise((resolve, reject) => {
			const args = ["build", "-t", imageTag, "-f", dockerfile]

			// Add build args
			for (const [key, value] of Object.entries(buildArgs)) {
				args.push("--build-arg", `${key}=${value}`)
			}

			args.push(context)

			const child = spawn("docker", args, { shell: true, cwd: process.cwd() })
			let stdout = ""
			let stderr = ""

			child.stdout.on("data", (d) => {
				stdout += d.toString()
			})
			child.stderr.on("data", (d) => {
				stderr += d.toString()
			})

			child.on("close", async (code) => {
				if (code === 0) {
					// Tag with commit SHA
					if (commitSha) {
						try {
							await new Promise((res, rej) => {
								const tag = spawn(
									"docker",
									["tag", imageTag, `${imageTag.split(":")[0]}:${commitSha.substring(0, 8)}`],
									{ shell: true },
								)
								tag.on("close", (c) => (c === 0 ? res() : rej()))
							})
						} catch {}
					}
					resolve({ success: true, output: stdout.trim() })
				} else {
					reject({ success: false, error: stderr.trim() || `Exit code: ${code}`, output: stdout.trim() })
				}
			})

			child.on("error", (err) => reject({ success: false, error: err.message }))
		})
	}

	/**
	 * Complete a build and process the queue.
	 * @private
	 */
	async _completeBuild(buildId, opts) {
		const { status, output, error, projectName } = opts

		// Use QueueManager's markCompleted
		await this.markCompleted(buildId, { status, output, error, projectName })

		await this._emitEvent(
			"build.completed",
			{
				buildId,
				status,
				error,
			},
			status === BUILD_STATUS.SUCCESS ? "info" : "error",
		)
	}

	// ── Queue processing override ─────────────────────────────────────────

	/**
	 * Override QueueManager._executeQueuedOperation to handle build queue items.
	 */
	async _executeQueuedOperation(queueItem) {
		const input = safeJsonParse(queueItem.input, {})

		await this._executeBuild({
			buildId: queueItem.id,
			projectName: input.projectName || queueItem.project_name,
			buildType: queueItem.build_type || input.buildType || "docker",
			imageTag: queueItem.image_tag || input.imageTag,
			commitSha: queueItem.commit_sha || input.commitSha,
			agent: queueItem.agent || input.agent || "unknown",
			agentSource: queueItem.agent_source || input.agentSource || AGENT_SOURCES.API,
			taskDescription: queueItem.task_description || input.taskDescription || "",
			buildArgs: safeJsonParse(queueItem.build_args, input.buildArgs || {}),
			dockerfile: input.dockerfile,
			context: input.context,
			projectDir: input.projectDir,
			skipCache: input.skipCache,
		})
	}

	// ── API methods ───────────────────────────────────────────────────────

	/**
	 * Get all builds (with optional filters).
	 * @param {object} [filter]
	 * @param {string} [filter.projectName]
	 * @param {string} [filter.status]
	 * @param {string} [filter.agentSource]
	 * @param {number} [filter.limit=50]
	 * @param {number} [filter.offset=0]
	 * @returns {Promise<Array>}
	 */
	async getBuilds(filter = {}) {
		await this.initialize()

		const { projectName, status, agentSource, limit = 50, offset = 0 } = filter

		let sql = "SELECT * FROM " + BUILD_TABLE + " WHERE 1=1"
		const params = []

		if (projectName) {
			sql += " AND project_name = ?"
			params.push(projectName)
		}

		if (status) {
			sql += " AND status = ?"
			params.push(status)
		}

		if (agentSource) {
			sql += " AND agent_source = ?"
			params.push(agentSource)
		}

		sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
		params.push(limit, offset)

		const rows = await this._query(sql, params)
		return rows.map((r) => ({
			id: r.id,
			projectName: r.project_name,
			buildType: r.build_type,
			imageTag: r.image_tag,
			commitSha: r.commit_sha,
			status: r.status,
			agent: r.agent,
			agentSource: r.agent_source,
			taskDescription: r.task_description,
			buildArgs: safeJsonParse(r.build_args, {}),
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
	 * Get active builds.
	 * @returns {Promise<Array>}
	 */
	async getActiveBuilds() {
		return this.getBuilds({ status: BUILD_STATUS.RUNNING })
	}

	/**
	 * Get queued builds.
	 * @returns {Promise<Array>}
	 */
	async getQueuedBuilds() {
		return this.getBuilds({ status: BUILD_STATUS.QUEUED })
	}

	/**
	 * Get build statistics.
	 * @returns {Promise<object>}
	 */
	async getStats() {
		await this.initialize()

		const total = await this._getOne(`SELECT COUNT(*) as count FROM ${BUILD_TABLE}`)

		const byStatus = await this._query(`SELECT status, COUNT(*) as count FROM ${BUILD_TABLE} GROUP BY status`)

		const bySource = await this._query(
			`SELECT agent_source, COUNT(*) as count FROM ${BUILD_TABLE} WHERE agent_source IS NOT NULL GROUP BY agent_source`,
		)

		const byProject = await this._query(
			`SELECT project_name, COUNT(*) as count FROM ${BUILD_TABLE} GROUP BY project_name ORDER BY count DESC LIMIT 10`,
		)

		const statusMap = {}
		for (const row of byStatus) {
			statusMap[row.status] = row.count
		}

		const sourceMap = {}
		for (const row of bySource) {
			sourceMap[row.agent_source] = row.count
		}

		const projectMap = {}
		for (const row of byProject) {
			projectMap[row.project_name] = row.count
		}

		return {
			totalBuilds: total?.count || 0,
			byStatus: statusMap,
			bySource: sourceMap,
			byProject: projectMap,
			activeBuilds: this._activeOperations.size,
			maxConcurrentBuilds: this.maxConcurrentBuilds,
			maxRamPercent: this.maxRamPercent,
		}
	}

	/**
	 * Cancel a queued or running build.
	 * @param {string} buildId
	 * @returns {Promise<{success: boolean, error?: string}>}
	 */
	async cancelBuild(buildId) {
		await this.initialize()

		const build = await this._getOne(`SELECT * FROM ${BUILD_TABLE} WHERE id = ?`, [buildId])

		if (!build) {
			return { success: false, error: "Build not found" }
		}

		if (build.status === BUILD_STATUS.SUCCESS || build.status === BUILD_STATUS.FAILED) {
			return { success: false, error: `Cannot cancel build with status: ${build.status}` }
		}

		// Use QueueManager's cancelOperation
		return this.cancelOperation(buildId)
	}

	/**
	 * Retry a failed build.
	 * @param {string} buildId
	 * @returns {Promise<{success: boolean, buildId?: string, error?: string}>}
	 */
	async retryBuild(buildId) {
		await this.initialize()

		const build = await this._getOne(`SELECT * FROM ${BUILD_TABLE} WHERE id = ?`, [buildId])

		if (!build) {
			return { success: false, error: "Build not found" }
		}

		if (build.status !== BUILD_STATUS.FAILED) {
			return { success: false, error: `Can only retry failed builds, current status: ${build.status}` }
		}

		return this.submitBuild({
			projectName: build.project_name,
			buildType: build.build_type,
			imageTag: build.image_tag,
			commitSha: build.commit_sha,
			agent: build.agent || "unknown",
			agentSource: build.agent_source || AGENT_SOURCES.API,
			taskDescription: `Retry: ${build.task_description || ""}`,
			buildArgs: safeJsonParse(build.build_args, {}),
			skipCache: true,
		})
	}

	/**
	 * Get build history for a specific project.
	 * @param {string} projectName
	 * @param {number} [limit=20]
	 * @returns {Promise<Array>}
	 */
	async getProjectHistory(projectName, limit = 20) {
		return this.getBuilds({ projectName, limit })
	}

	/**
	 * Get builds by agent source (Claude, Codex, etc.).
	 * @param {string} agentSource
	 * @param {number} [limit=20]
	 * @returns {Promise<Array>}
	 */
	async getBuildsBySource(agentSource, limit = 20) {
		return this.getBuilds({ agentSource, limit })
	}
}

module.exports = { GlobalBuildOrchestrator, BUILD_STATUS, AGENT_SOURCES }
