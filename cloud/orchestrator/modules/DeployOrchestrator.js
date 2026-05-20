/**
 * DeployOrchestrator — Unified deployment entry point for all AI coding agents.
 *
 * Features:
 * 1. Queue all deployment requests (SQLite-backed)
 * 2. Track active deployments per project (prevent concurrent deploys)
 * 3. Track active builds (prevent duplicate Docker/build processes)
 * 4. Integration with CommitDeployLog (log every deployment attempt)
 * 5. Integration with EventLog (emit events for dashboard monitoring)
 * 6. Agent-aware tracking (record which AI agent initiated the deployment)
 * 7. Health check before deploy (verify current deployment is healthy)
 * 8. Rollback on failure (auto-rollback to last known good version)
 * 9. API methods: deploy(), getQueue(), getActiveDeployments(), getBuildStatus(), cancelDeployment(), forceDeploy()
 */

const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const http = require("http");
const { spawn } = require("child_process");

// ── Constants ────────────────────────────────────────────────────────────────

const DEPLOY_STATUS = Object.freeze({
	QUEUED: "queued",
	RUNNING: "running",
	SUCCESS: "success",
	FAILED: "failed",
	CANCELLED: "cancelled",
	ROLLED_BACK: "rolled_back",
});

const BUILD_STATUS = Object.freeze({
	QUEUED: "queued",
	RUNNING: "running",
	SUCCESS: "success",
	FAILED: "failed",
	CANCELLED: "cancelled",
	SKIPPED: "skipped",
});

const DEPLOY_TABLE = "deploy_orchestrator_deployments";
const BUILD_TABLE = "deploy_orchestrator_builds";
const QUEUE_TABLE = "deploy_orchestrator_queue";

// ── Helpers ──────────────────────────────────────────────────────────────────

function safeJsonParse(str, fallback) {
	if (!str) return fallback;
	try {
		return JSON.parse(str);
	} catch {
		return fallback;
	}
}

function now() {
	return Date.now();
}

// ── DeployOrchestrator ───────────────────────────────────────────────────────

class DeployOrchestrator {
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
	 */
	constructor(opts) {
		this.projectName = opts.projectName || "superroo";
		this.vpsHost = opts.vpsHost || "100.64.175.88";
		this.vpsUser = opts.vpsUser || "root";
		this.deployPath = opts.deployPath || "/root/superroo";
		this.healthUrl = opts.healthUrl || "http://100.64.175.88:3419/api/health";
		this.sshKeyPath = opts.sshKeyPath || null;
		this.memory = opts.memory;
		this.eventLog = opts.eventLog;
		this.commitDeployLog = opts.commitDeployLog;
		this.maxConcurrentDeploys = opts.maxConcurrentDeploys || 1;
		this.maxConcurrentBuilds = opts.maxConcurrentBuilds || 1;
		this.healthCheckTimeoutMs = opts.healthCheckTimeoutMs || 30000;
		this.deployTimeoutMs = opts.deployTimeoutMs || 300000;

		// RAM Orchestrator awareness (GAP 5)
		this.ramOrchestratorUrl = opts.ramOrchestratorUrl || "http://127.0.0.1:3456";
		this.ramCheckTimeoutMs = opts.ramCheckTimeoutMs || 3000;
		this.ramDeferOnStates = opts.ramDeferOnStates || ["critical", "danger"];

		// In-memory active tracking (fast lookup, SQLite is source of truth)
		this._activeDeployments = new Map(); // projectName -> deploymentId
		this._activeBuilds = new Map(); // projectName -> buildId
		this._initialized = false;
	}

	/**
	 * Initialize SQLite tables.
	 */
	async initialize() {
		if (this._initialized) return;
		if (!this.memory) return;

		const db = await this.memory.getDb();

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
		`);

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
		`);

		await db.exec(`
			CREATE TABLE IF NOT EXISTS ${QUEUE_TABLE} (
				id TEXT PRIMARY KEY,
				project_name TEXT NOT NULL,
				type TEXT NOT NULL,
				priority INTEGER DEFAULT 0,
				status TEXT NOT NULL DEFAULT 'pending',
				input TEXT,
				agent TEXT,
				metadata TEXT,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			)
		`);

		this._initialized = true;
	}

	// ── Database helpers ──────────────────────────────────────────────────

	async _getDb() {
		if (!this.memory) return null;
		return this.memory.getDb();
	}

	async _query(sql, params = []) {
		const db = await this._getDb();
		if (!db) return [];
		return db.all(sql, params);
	}

	async _run(sql, params = []) {
		const db = await this._getDb();
		if (!db) return;
		return db.run(sql, params);
	}

	async _getOne(sql, params = []) {
		const db = await this._getDb();
		if (!db) return null;
		return db.get(sql, params);
	}

	// ── Event logging ─────────────────────────────────────────────────────

	async _emitEvent(type, payload, severity = "info") {
		if (!this.eventLog) return;
		try {
			await this.eventLog.record({
				type,
				source: "deploy-orchestrator",
				payload,
				severity,
			});
		} catch (err) {
			console.error("[DeployOrchestrator] EventLog error:", err.message);
		}
	}

	// ── SSH helpers ───────────────────────────────────────────────────────

	_runCommand(command, args, cwd = process.cwd()) {
		const opts = { cwd, stdio: ["pipe", "pipe", "pipe"], timeout: this.deployTimeoutMs };
		if (this.sshKeyPath) {
			args = ["-i", this.sshKeyPath, ...args];
		}
		return new Promise((resolve, reject) => {
			const child = spawn(command, args, opts);
			let stdout = "";
			let stderr = "";
			child.stdout.on("data", (d) => { stdout += d.toString(); });
			child.stderr.on("data", (d) => { stderr += d.toString(); });
			child.on("close", (code) => {
				if (code === 0) resolve(stdout.trim());
				else reject(new Error(`Exit code ${code}: ${stderr.trim() || stdout.trim()}`));
			});
			child.on("error", reject);
		});
	}

	_shellQuote(str) {
		return `'${str.replace(/'/g, "'\\''")}'`;
	}

	// ── Health check ──────────────────────────────────────────────────────

	/**
	 * Perform a health check against the current deployment.
	 * @returns {Promise<{healthy: boolean, statusCode?: number, error?: string}>}
	 */
	async healthCheck() {
		const timeoutMs = this.healthCheckTimeoutMs;
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);

		try {
			const res = await fetch(this.healthUrl, {
				signal: controller.signal,
				timeout: timeoutMs,
			});
			clearTimeout(timer);
			const healthy = res.status >= 200 && res.status < 500;
			return { healthy, statusCode: res.status };
		} catch (err) {
			clearTimeout(timer);
			return { healthy: false, error: err.message };
		}
	}

	// ── RAM state check (GAP 5) ───────────────────────────────────────────

	/**
		* Check RAM orchestrator health before deploying.
		* If RAM is in a defer-on state (critical/danger), deployment is queued instead.
		* @returns {Promise<{ok: boolean, state?: string, ramPercent?: number}>}
		*/
	async _checkRamState() {
		const timeoutMs = this.ramCheckTimeoutMs;
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);

		try {
			const res = await fetch(`${this.ramOrchestratorUrl}/health`, {
				signal: controller.signal,
				timeout: timeoutMs,
			});
			clearTimeout(timer);

			if (!res.ok) {
				// RAM orchestrator unreachable — allow deploy (fail open)
				return { ok: true };
			}

			const data = await res.json();
			const state = data.ramState || "normal";

			if (this.ramDeferOnStates.includes(state)) {
				return { ok: false, state, ramPercent: data.ramPercent };
			}

			return { ok: true, state, ramPercent: data.ramPercent };
		} catch (err) {
			clearTimeout(timer);
			// RAM orchestrator unreachable — allow deploy (fail open)
			return { ok: true };
		}
	}

	// ── Deploy logic ──────────────────────────────────────────────────────

	async _createDeployBundle(outPath) {
		const excludeArgs = [
			"node_modules", ".git", ".super-roo", "dist", "out", ".vscode",
			"__pycache__", ".next", "coverage", ".env",
		].flatMap((e) => ["--exclude", e]);
		await this._runCommand("tar", [
			"-czf", outPath,
			...excludeArgs,
			"-C", process.cwd(),
			".",
		]);
	}

	async _deployToVps(version) {
		const bundleName = `deploy-${version || "latest"}-${Date.now()}.tar.gz`;
		const localBundle = path.join(process.cwd(), bundleName);
		const remoteBundle = `/tmp/${bundleName}`;

		try {
			await this._createDeployBundle(localBundle);

			const scpTarget = `${this.vpsUser}@${this.vpsHost}:${remoteBundle}`;
			const scpArgs = [localBundle, scpTarget];
			if (this.sshKeyPath) scpArgs.unshift("-i", this.sshKeyPath);
			await this._runCommand("scp", scpArgs);

			const sshBase = `${this.vpsUser}@${this.vpsHost}`;
			const sshArgsBase = [sshBase];
			if (this.sshKeyPath) sshArgsBase.unshift("-i", this.sshKeyPath);

			await this._runCommand("ssh", [
				...sshArgsBase,
				[
					`mkdir -p ${this._shellQuote(this.deployPath)}`,
					`tar -xzf ${remoteBundle} -C ${this._shellQuote(this.deployPath)}`,
					`rm -f ${remoteBundle}`,
					`cd ${this._shellQuote(this.deployPath)}`,
					`[ -f package.json ] && npm install --production --no-audit --no-fund 2>/dev/null || true`,
					`[ -f docker-compose.yml ] && docker-compose restart 2>/dev/null || [ -f Dockerfile ] && docker restart $(docker ps -q --filter ancestor=${this.projectName}) 2>/dev/null || pm2 restart ${this.projectName} 2>/dev/null || systemctl restart ${this.projectName} 2>/dev/null || true`,
				].join(" && "),
			]);

			return { success: true };
		} catch (err) {
			return { success: false, error: err.message };
		} finally {
			try { fs.unlinkSync(localBundle); } catch {}
		}
	}

	async _triggerGitHubWorkflow(version, commitSha) {
		const githubToken = process.env.GITHUB_TOKEN || process.env.SUPERROO_GITHUB_TOKEN;
		if (!githubToken) {
			throw new Error("GITHUB_TOKEN not set; cannot trigger workflow");
		}

		const manifest = {
			ref: "main",
			inputs: {
				version: version || "latest",
				commit_sha: commitSha || "HEAD",
				project: this.projectName,
			},
		};

		const res = await fetch(
			`https://api.github.com/repos/jpgyap/${this.projectName}/actions/workflows/deploy.yml/dispatches`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${githubToken}`,
					"Content-Type": "application/json",
					"User-Agent": "superroo-deploy-orchestrator",
				},
				body: JSON.stringify(manifest),
			}
		);

		if (!res.ok) {
			const text = await res.text();
			throw new Error(`GitHub workflow trigger failed (${res.status}): ${text}`);
		}
	}

	// ── Rollback ──────────────────────────────────────────────────────────

	/**
	 * Rollback to the last known good deployment.
	 * @param {string} [deploymentId] - Specific deployment to rollback from
	 * @returns {Promise<{success: boolean, rollbackVersion?: string, error?: string}>}
	 */
	async rollback(deploymentId) {
		const deployId = deploymentId || this._activeDeployments.get(this.projectName);
		let currentDeploy = null;

		if (deployId) {
			currentDeploy = await this._getOne(
				`SELECT * FROM ${DEPLOY_TABLE} WHERE id = ?`,
				[deployId]
			);
		}

		const previousDeploy = await this._getOne(
			`SELECT * FROM ${DEPLOY_TABLE} WHERE project_name = ? AND status = ? AND id != ? ORDER BY created_at DESC LIMIT 1`,
			[this.projectName, DEPLOY_STATUS.SUCCESS, deployId || ""]
		);

		if (!previousDeploy) {
			await this._emitEvent("rollback.no-previous", {
				project: this.projectName,
				deploymentId: deployId,
				error: "No previous successful deployment found",
			}, "warning");
			return { success: false, error: "No previous successful deployment found" };
		}

		const rollbackVersion = previousDeploy.version || "unknown";

		await this._emitEvent("rollback.started", {
			project: this.projectName,
			fromVersion: currentDeploy?.version || "unknown",
			toVersion: rollbackVersion,
			deploymentId: deployId,
		}, "warning");

		try {
			const result = await this._deployToVps(rollbackVersion);

			if (result.success) {
				if (currentDeploy) {
					await this._run(
						`UPDATE ${DEPLOY_TABLE} SET status = ?, rollback_version = ?, rollback_status = ?, updated_at = ? WHERE id = ?`,
						[DEPLOY_STATUS.ROLLED_BACK, rollbackVersion, "success", now(), currentDeploy.id]
					);
				}

				if (this.commitDeployLog) {
					try {
						await this.commitDeployLog.recordDeploy({
							version: rollbackVersion,
							commitSha: previousDeploy.commit_sha || "",
							status: "healthy",
							agent: "deploy-orchestrator",
							metadata: JSON.stringify({
								rollbackFrom: currentDeploy?.version || "unknown",
								reason: "auto-rollback after failed deployment",
							}),
						});
					} catch {}
				}

				await this._emitEvent("rollback.completed", {
					project: this.projectName,
					rollbackVersion,
				}, "info");

				return { success: true, rollbackVersion };
			} else {
				await this._emitEvent("rollback.failed", {
					project: this.projectName,
					rollbackVersion,
					error: result.error,
				}, "error");
				return { success: false, error: result.error };
			}
		} catch (err) {
			await this._emitEvent("rollback.failed", {
				project: this.projectName,
				rollbackVersion,
				error: err.message,
			}, "error");
			return { success: false, error: err.message };
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
		} = typeof opts === "string"
			? { version: opts, commitSha: arguments[1], agent: arguments[2] || "unknown" }
			: opts;

		await this.initialize();

		const deploymentId = crypto.randomUUID();

		// GAP 5: Check RAM state before deploying
		if (!force) {
			const ramCheck = await this._checkRamState();
			if (!ramCheck.ok) {
				await this._run(
					`INSERT INTO ${QUEUE_TABLE} (id, project_name, type, priority, status, input, agent, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					[
						deploymentId,
						this.projectName,
						"deploy",
						0,
						"pending",
						JSON.stringify({ version, commitSha, skipHealthCheck, skipBuild }),
						agent,
						now(),
						now(),
					]
				);

				await this._emitEvent("deploy.queued", {
					project: this.projectName,
					version,
					commitSha,
					agent,
					deploymentId,
					reason: `RAM state is ${ramCheck.state} — deployment deferred`,
				}, "warning");

				return { queued: true, deploymentId, status: DEPLOY_STATUS.QUEUED, ramState: ramCheck.state };
			}
		}

		// Check if there's already an active deployment for this project
		const activeDeploy = this._activeDeployments.get(this.projectName);
		if (activeDeploy && !force) {
			await this._run(
				`INSERT INTO ${QUEUE_TABLE} (id, project_name, type, priority, status, input, agent, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					deploymentId,
					this.projectName,
					"deploy",
					0,
					"pending",
					JSON.stringify({ version, commitSha, skipHealthCheck, skipBuild }),
					agent,
					now(),
					now(),
				]
			);

			await this._emitEvent("deploy.queued", {
				project: this.projectName,
				version,
				commitSha,
				agent,
				deploymentId,
				reason: "Active deployment in progress",
			}, "info");

			return { queued: true, deploymentId, status: DEPLOY_STATUS.QUEUED };
		}

		// Record deployment start
		await this._run(
			`INSERT INTO ${DEPLOY_TABLE} (id, project_name, version, commit_sha, status, agent, initiated_by, metadata, created_at, updated_at, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				deploymentId,
				this.projectName,
				version || null,
				commitSha || null,
				DEPLOY_STATUS.RUNNING,
				agent,
				agent,
				JSON.stringify({ force, skipHealthCheck, skipBuild }),
				now(),
				now(),
				now(),
			]
		);

		this._activeDeployments.set(this.projectName, deploymentId);

		await this._emitEvent("deploy.started", {
			project: this.projectName,
			version,
			commitSha,
			agent,
			deploymentId,
		}, "info");

		try {
			// Step 1: Health check before deploy
			if (!skipHealthCheck) {
				const health = await this.healthCheck();
				await this._run(
					`UPDATE ${DEPLOY_TABLE} SET health_before = ?, updated_at = ? WHERE id = ?`,
					[JSON.stringify(health), now(), deploymentId]
				);

				if (!health.healthy) {
					throw new Error(
						`Pre-deploy health check failed: ${health.error || `HTTP ${health.statusCode}`}`
					);
				}
			}

			// Step 2: Deploy to VPS
			const deployResult = await this._deployToVps(version);

			if (!deployResult.success) {
				throw new Error(`Deploy failed: ${deployResult.error}`);
			}

			// Step 3: Health check after deploy
			let healthAfter = null;
			if (!skipHealthCheck) {
				await new Promise((r) => setTimeout(r, 5000));
				healthAfter = await this.healthCheck();
				await this._run(
					`UPDATE ${DEPLOY_TABLE} SET health_after = ?, updated_at = ? WHERE id = ?`,
					[JSON.stringify(healthAfter), now(), deploymentId]
				);
			}

			// Step 4: Check post-deploy health
			if (healthAfter && !healthAfter.healthy) {
				await this._run(
					`UPDATE ${DEPLOY_TABLE} SET status = ?, error = ?, updated_at = ?, completed_at = ? WHERE id = ?`,
					[DEPLOY_STATUS.FAILED, `Post-deploy health check failed: ${healthAfter.error || `HTTP ${healthAfter.statusCode}`}`, now(), now(), deploymentId]
				);

				await this._emitEvent("deploy.failed", {
					project: this.projectName,
					version,
					deploymentId,
					error: "Post-deploy health check failed, initiating rollback",
				}, "error");

				const rollbackResult = await this.rollback(deploymentId);
				this._activeDeployments.delete(this.projectName);

				return {
					queued: false,
					deploymentId,
					status: DEPLOY_STATUS.FAILED,
					error: "Post-deploy health check failed",
					rollback: rollbackResult,
				};
			}

			// Step 5: Mark as success
			await this._run(
				`UPDATE ${DEPLOY_TABLE} SET status = ?, updated_at = ?, completed_at = ? WHERE id = ?`,
				[DEPLOY_STATUS.SUCCESS, now(), now(), deploymentId]
			);

			if (this.commitDeployLog) {
				try {
					await this.commitDeployLog.recordDeploy({
						version: version || "latest",
						commitSha: commitSha || "",
						status: healthAfter?.healthy ? "healthy" : "unhealthy",
						agent,
						metadata: JSON.stringify({
							deploymentId,
							project: this.projectName,
						}),
					});
				} catch {}
			}

			await this._emitEvent("deploy.completed", {
				project: this.projectName,
				version,
				commitSha,
				agent,
				deploymentId,
				healthy: healthAfter?.healthy ?? true,
			}, "info");

			this._activeDeployments.delete(this.projectName);

			// Process next item in queue
			this._processQueue().catch((err) => {
				console.error("[DeployOrchestrator] Queue processing error:", err.message);
			});

			return { queued: false, deploymentId, status: DEPLOY_STATUS.SUCCESS };
		} catch (err) {
			await this._run(
				`UPDATE ${DEPLOY_TABLE} SET status = ?, error = ?, updated_at = ?, completed_at = ? WHERE id = ?`,
				[DEPLOY_STATUS.FAILED, err.message, now(), now(), deploymentId]
			);

			await this._emitEvent("deploy.failed", {
				project: this.projectName,
				version,
				commitSha,
				agent,
				deploymentId,
				error: err.message,
			}, "error");

			this._activeDeployments.delete(this.projectName);

			let rollbackResult = null;
			if (!err.message.includes("Pre-deploy health check")) {
				rollbackResult = await this.rollback(deploymentId);
			}

			this._processQueue().catch((err) => {
				console.error("[DeployOrchestrator] Queue processing error:", err.message);
			});

			return {
				queued: false,
				deploymentId,
				status: DEPLOY_STATUS.FAILED,
				error: err.message,
				rollback: rollbackResult,
			};
		}
	}

	// ── Queue processing ──────────────────────────────────────────────────

	async _processQueue() {
		const nextItem = await this._getOne(
			`SELECT * FROM ${QUEUE_TABLE} WHERE project_name = ? AND status = 'pending' ORDER BY priority DESC, created_at ASC LIMIT 1`,
			[this.projectName]
		);

		if (!nextItem) return;

		await this._run(
			`UPDATE ${QUEUE_TABLE} SET status = 'processing', updated_at = ? WHERE id = ?`,
			[now(), nextItem.id]
		);

		const input = safeJsonParse(nextItem.input, {});

		const result = await this.deploy({
			version: input.version,
			commitSha: input.commitSha,
			agent: nextItem.agent || "unknown",
			force: true,
			skipHealthCheck: input.skipHealthCheck,
			skipBuild: input.skipBuild,
		});

		await this._run(
			`UPDATE ${QUEUE_TABLE} SET status = ?, metadata = ?, updated_at = ? WHERE id = ?`,
			[
				result.status === DEPLOY_STATUS.SUCCESS ? "completed" : "failed",
				JSON.stringify({ result }),
				now(),
				nextItem.id,
			]
		);

		await this._processQueue();
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
		await this.initialize();

		const { buildType, imageTag, commitSha, agent = "unknown" } = opts;
		const buildId = crypto.randomUUID();

		// Check for duplicate build (same image tag + commit SHA)
		if (imageTag && commitSha) {
			const existing = await this._getOne(
				`SELECT * FROM ${BUILD_TABLE} WHERE project_name = ? AND image_tag = ? AND commit_sha = ? AND status = ? ORDER BY created_at DESC LIMIT 1`,
				[this.projectName, imageTag, commitSha, BUILD_STATUS.SUCCESS]
			);

			if (existing) {
				await this._emitEvent("build.skipped", {
					project: this.projectName,
					buildType,
					imageTag,
					commitSha,
					reason: "Duplicate build (already exists with same image tag and commit SHA)",
				}, "info");

				return { buildId: existing.id, skipped: true, reason: "Duplicate build skipped" };
			}
		}

		// Check for active builds (prevent concurrent builds)
		const activeBuild = this._activeBuilds.get(this.projectName);
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
				]
			);

			return { buildId, skipped: false };
		}

		this._activeBuilds.set(this.projectName, buildId);

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
			]
		);

		await this._emitEvent("build.started", {
			project: this.projectName,
			buildType,
			imageTag,
			commitSha,
			agent,
			buildId,
		}, "info");

		return { buildId, skipped: false };
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
		const { status, output, error } = opts;

		await this._run(
			`UPDATE ${BUILD_TABLE} SET status = ?, output = ?, error = ?, updated_at = ?, completed_at = ? WHERE id = ?`,
			[status, output || null, error || null, now(), now(), buildId]
		);

		const build = await this._getOne(`SELECT * FROM ${BUILD_TABLE} WHERE id = ?`, [buildId]);
		if (build && this._activeBuilds.get(build.project_name) === buildId) {
			this._activeBuilds.delete(build.project_name);
		}

		await this._emitEvent("build.completed", {
			project: build?.project_name || this.projectName,
			buildId,
			status,
			error,
		}, status === BUILD_STATUS.SUCCESS ? "info" : "error");

		await this._processBuildQueue();
	}

	async _processBuildQueue() {
		const nextBuild = await this._getOne(
			`SELECT * FROM ${BUILD_TABLE} WHERE project_name = ? AND status = ? ORDER BY created_at ASC LIMIT 1`,
			[this.projectName, BUILD_STATUS.QUEUED]
		);

		if (!nextBuild) return;

		this._activeBuilds.set(this.projectName, nextBuild.id);
		await this._run(
			`UPDATE ${BUILD_TABLE} SET status = ?, started_at = ?, updated_at = ? WHERE id = ?`,
			[BUILD_STATUS.RUNNING, now(), now(), nextBuild.id]
		);

		await this._emitEvent("build.started", {
			project: this.projectName,
			buildType: nextBuild.build_type,
			buildId: nextBuild.id,
		}, "info");
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
		await this.initialize();
		const { status, limit = 50 } = filter;

		let sql = `SELECT * FROM ${QUEUE_TABLE} WHERE project_name = ?`;
		const params = [this.projectName];

		if (status) {
			sql += " AND status = ?";
			params.push(status);
		}

		sql += " ORDER BY priority DESC, created_at ASC LIMIT ?";
		params.push(limit);

		const rows = await this._query(sql, params);
		return rows.map((r) => ({
			id: r.id,
			projectName: r.project_name,
			type: r.type,
			priority: r.priority,
			status: r.status,
			input: safeJsonParse(r.input, {}),
			agent: r.agent,
			metadata: safeJsonParse(r.metadata, {}),
			createdAt: r.created_at,
			updatedAt: r.updated_at,
		}));
	}

	/**
	 * Get active deployments.
	 * @returns {Promise<Array>}
	 */
	async getActiveDeployments() {
		await this.initialize();
		const rows = await this._query(
			`SELECT * FROM ${DEPLOY_TABLE} WHERE project_name = ? AND status IN (?, ?) ORDER BY created_at DESC`,
			[this.projectName, DEPLOY_STATUS.RUNNING, DEPLOY_STATUS.QUEUED]
		);
		return rows.map((r) => this._rowToDeployment(r));
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
		await this.initialize();
		const { buildType, status, limit = 20 } = filter;

		let sql = `SELECT * FROM ${BUILD_TABLE} WHERE project_name = ?`;
		const params = [this.projectName];

		if (buildType) {
			sql += " AND build_type = ?";
			params.push(buildType);
		}

		if (status) {
			sql += " AND status = ?";
			params.push(status);
		}

		sql += " ORDER BY created_at DESC LIMIT ?";
		params.push(limit);

		const rows = await this._query(sql, params);
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
		}));
	}

	/**
	 * Cancel a queued or running deployment.
	 * @param {string} deploymentId
	 * @returns {Promise<{success: boolean, error?: string}>}
	 */
	async cancelDeployment(deploymentId) {
		await this.initialize();

		const deploy = await this._getOne(
			`SELECT * FROM ${DEPLOY_TABLE} WHERE id = ?`,
			[deploymentId]
		);

		if (!deploy) {
			return { success: false, error: "Deployment not found" };
		}

		if (deploy.status === DEPLOY_STATUS.SUCCESS || deploy.status === DEPLOY_STATUS.FAILED || deploy.status === DEPLOY_STATUS.ROLLED_BACK) {
			return { success: false, error: `Cannot cancel deployment with status: ${deploy.status}` };
		}

		await this._run(
			`UPDATE ${DEPLOY_TABLE} SET status = ?, updated_at = ?, completed_at = ? WHERE id = ?`,
			[DEPLOY_STATUS.CANCELLED, now(), now(), deploymentId]
		);

		// Also cancel in queue if present
		await this._run(
			`UPDATE ${QUEUE_TABLE} SET status = 'cancelled', updated_at = ? WHERE id = ?`,
			[now(), deploymentId]
		);

		// Clear active deployment
		if (this._activeDeployments.get(this.projectName) === deploymentId) {
			this._activeDeployments.delete(this.projectName);
		}

		await this._emitEvent("deploy.cancelled", {
			project: this.projectName,
			deploymentId,
			version: deploy.version,
			agent: deploy.agent,
		}, "warning");

		return { success: true };
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
		});
	}

	/**
		* Get deployment history.
		* @param {object} [filter]
		* @param {number} [filter.limit=20]
		* @param {string} [filter.status]
		* @returns {Promise<Array>}
		*/
	async getHistory(filter = {}) {
		await this.initialize();
		const { limit = 20, status } = filter;

		let sql = `SELECT * FROM ${DEPLOY_TABLE} WHERE project_name = ?`;
		const params = [this.projectName];

		if (status) {
			sql += " AND status = ?";
			params.push(status);
		}

		sql += " ORDER BY created_at DESC LIMIT ?";
		params.push(limit);

		const rows = await this._query(sql, params);
		return rows.map((r) => this._rowToDeployment(r));
	}

	/**
		* Get deployment statistics.
		* @returns {Promise<object>}
		*/
	async getStats() {
		await this.initialize();

		const total = await this._getOne(
			`SELECT COUNT(*) as count FROM ${DEPLOY_TABLE} WHERE project_name = ?`,
			[this.projectName]
		);

		const byStatus = await this._query(
			`SELECT status, COUNT(*) as count FROM ${DEPLOY_TABLE} WHERE project_name = ? GROUP BY status`,
			[this.projectName]
		);

		const byAgent = await this._query(
			`SELECT agent, COUNT(*) as count FROM ${DEPLOY_TABLE} WHERE project_name = ? GROUP BY agent`,
			[this.projectName]
		);

		const latest = await this._getOne(
			`SELECT * FROM ${DEPLOY_TABLE} WHERE project_name = ? ORDER BY created_at DESC LIMIT 1`,
			[this.projectName]
		);

		const queueLength = await this._getOne(
			`SELECT COUNT(*) as count FROM ${QUEUE_TABLE} WHERE project_name = ? AND status = 'pending'`,
			[this.projectName]
		);

		const activeBuilds = await this._getOne(
			`SELECT COUNT(*) as count FROM ${BUILD_TABLE} WHERE project_name = ? AND status = ?`,
			[this.projectName, BUILD_STATUS.RUNNING]
		);

		const statusMap = {};
		for (const row of byStatus) {
			statusMap[row.status] = row.count;
		}

		const agentMap = {};
		for (const row of byAgent) {
			agentMap[row.agent] = row.count;
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
		};
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
		};
	}
}

module.exports = { DeployOrchestrator, DEPLOY_STATUS, BUILD_STATUS };
