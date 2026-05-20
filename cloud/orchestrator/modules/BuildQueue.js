/**
 * BuildQueue — Project-scoped build queue with locking and image deduplication.
 *
 * Features:
 * 1. Project-scoped locking — Only one build per project at a time
 * 2. Image deduplication — Skip builds for already-built image+commit combinations
 * 3. Build result caching — Cache successful build outputs
 * 4. API methods: enqueueBuild(), getActiveBuilds(), getBuildHistory(), skipIfExists()
 */

const crypto = require("crypto");

// ── Constants ────────────────────────────────────────────────────────────────

const BUILD_STATUS = Object.freeze({
	QUEUED: "queued",
	RUNNING: "running",
	SUCCESS: "success",
	FAILED: "failed",
	CANCELLED: "cancelled",
	SKIPPED: "skipped",
});

const BUILD_TABLE = "build_queue_builds";
const CACHE_TABLE = "build_queue_cache";

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

// ── BuildQueue ───────────────────────────────────────────────────────────────

class BuildQueue {
	/**
	 * @param {object} opts
	 * @param {object} opts.memory - MemoryStore instance for SQLite persistence
	 * @param {object} opts.eventLog - EventLog instance
	 * @param {number} [opts.maxConcurrentBuilds=1] - Max concurrent builds per project
	 * @param {number} [opts.cacheTtlMs=86400000] - Cache TTL (24 hours default)
	 */
	constructor(opts) {
		this.memory = opts.memory;
		this.eventLog = opts.eventLog;
		this.maxConcurrentBuilds = opts.maxConcurrentBuilds || 1;
		this.cacheTtlMs = opts.cacheTtlMs || 86400000;

		// In-memory active tracking
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
			CREATE TABLE IF NOT EXISTS ${CACHE_TABLE} (
				id TEXT PRIMARY KEY,
				project_name TEXT NOT NULL,
				build_type TEXT NOT NULL,
				image_tag TEXT,
				commit_sha TEXT,
				output TEXT,
				metadata TEXT,
				created_at INTEGER NOT NULL,
				expires_at INTEGER NOT NULL
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
				source: "build-queue",
				payload,
				severity,
			});
		} catch (err) {
			console.error("[BuildQueue] EventLog error:", err.message);
		}
	}

	// ── Cache management ──────────────────────────────────────────────────

	/**
	 * Check if a build result exists in cache.
	 * @param {object} opts
	 * @param {string} opts.projectName
	 * @param {string} opts.buildType
	 * @param {string} [opts.imageTag]
	 * @param {string} [opts.commitSha]
	 * @returns {Promise<{cached: boolean, output?: string, metadata?: object}>}
	 */
	async skipIfExists(opts) {
		await this.initialize();

		const { projectName, buildType, imageTag, commitSha } = opts;

		if (!imageTag && !commitSha) {
			return { cached: false };
		}

		let sql = `SELECT * FROM ${CACHE_TABLE} WHERE project_name = ? AND build_type = ? AND expires_at > ?`;
		const params = [projectName, buildType, now()];

		if (imageTag) {
			sql += " AND image_tag = ?";
			params.push(imageTag);
		}

		if (commitSha) {
			sql += " AND commit_sha = ?";
			params.push(commitSha);
		}

		sql += " ORDER BY created_at DESC LIMIT 1";

		const cached = await this._getOne(sql, params);

		if (cached) {
			return {
				cached: true,
				output: cached.output,
				metadata: safeJsonParse(cached.metadata, {}),
			};
		}

		return { cached: false };
	}

	/**
	 * Store a build result in cache.
	 * @param {object} opts
	 * @param {string} opts.projectName
	 * @param {string} opts.buildType
	 * @param {string} [opts.imageTag]
	 * @param {string} [opts.commitSha]
	 * @param {string} [opts.output]
	 * @param {object} [opts.metadata]
	 */
	async _cacheResult(opts) {
		const { projectName, buildType, imageTag, commitSha, output, metadata } = opts;

		if (!imageTag && !commitSha) return;

		const id = crypto.randomUUID();

		await this._run(
			`INSERT INTO ${CACHE_TABLE} (id, project_name, build_type, image_tag, commit_sha, output, metadata, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				id,
				projectName,
				buildType,
				imageTag || null,
				commitSha || null,
				output || null,
				metadata ? JSON.stringify(metadata) : null,
				now(),
				now() + this.cacheTtlMs,
			]
		);
	}

	/**
	 * Clean expired cache entries.
	 */
	async cleanCache() {
		await this.initialize();
		await this._run(
			`DELETE FROM ${CACHE_TABLE} WHERE expires_at < ?`,
			[now()]
		);
	}

	// ── Build queue management ────────────────────────────────────────────

	/**
	 * Enqueue a build request.
	 * @param {object} opts
	 * @param {string} opts.projectName
	 * @param {string} opts.buildType - "docker", "nextjs", "typescript", "static"
	 * @param {string} [opts.imageTag] - Docker image tag
	 * @param {string} [opts.commitSha] - Commit SHA
	 * @param {string} [opts.agent] - AI agent name
	 * @param {object} [opts.metadata] - Additional metadata
	 * @returns {Promise<{buildId: string, status: string, skipped: boolean, reason?: string}>}
	 */
	async enqueueBuild(opts) {
		await this.initialize();

		const { projectName, buildType, imageTag, commitSha, agent = "unknown", metadata } = opts;
		const buildId = crypto.randomUUID();

		// Step 1: Check cache for existing build
		if (imageTag || commitSha) {
			const cached = await this.skipIfExists({
				projectName,
				buildType,
				imageTag,
				commitSha,
			});

			if (cached.cached) {
				await this._emitEvent("build.skipped-cached", {
					project: projectName,
					buildType,
					imageTag,
					commitSha,
					reason: "Build result found in cache",
				}, "info");

				return {
					buildId,
					status: BUILD_STATUS.SKIPPED,
					skipped: true,
					reason: "Build result found in cache",
				};
			}
		}

		// Step 2: Check for duplicate running build (same image tag + commit SHA)
		if (imageTag && commitSha) {
			const duplicate = await this._getOne(
				`SELECT * FROM ${BUILD_TABLE} WHERE project_name = ? AND build_type = ? AND image_tag = ? AND commit_sha = ? AND status IN (?, ?) ORDER BY created_at DESC LIMIT 1`,
				[projectName, buildType, imageTag, commitSha, BUILD_STATUS.QUEUED, BUILD_STATUS.RUNNING]
			);

			if (duplicate) {
				await this._emitEvent("build.duplicate", {
					project: projectName,
					buildType,
					imageTag,
					commitSha,
					existingBuildId: duplicate.id,
				}, "info");

				return {
					buildId: duplicate.id,
					status: duplicate.status,
					skipped: true,
					reason: "Duplicate build already in progress",
				};
			}
		}

		// Step 3: Check project-scoped lock
		const activeBuild = this._activeBuilds.get(projectName);
		if (activeBuild) {
			// Queue the build
			await this._run(
				`INSERT INTO ${BUILD_TABLE} (id, project_name, build_type, image_tag, commit_sha, status, agent, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					buildId,
					projectName,
					buildType,
					imageTag || null,
					commitSha || null,
					BUILD_STATUS.QUEUED,
					agent,
					metadata ? JSON.stringify(metadata) : JSON.stringify({ blockedBy: activeBuild }),
					now(),
					now(),
				]
			);

			await this._emitEvent("build.queued", {
				project: projectName,
				buildType,
				imageTag,
				commitSha,
				agent,
				buildId,
				reason: "Active build in progress",
			}, "info");

			return { buildId, status: BUILD_STATUS.QUEUED, skipped: false };
		}

		// Step 4: Acquire lock and start build
		this._activeBuilds.set(projectName, buildId);

		await this._run(
			`INSERT INTO ${BUILD_TABLE} (id, project_name, build_type, image_tag, commit_sha, status, agent, metadata, created_at, updated_at, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				buildId,
				projectName,
				buildType,
				imageTag || null,
				commitSha || null,
				BUILD_STATUS.RUNNING,
				agent,
				metadata ? JSON.stringify(metadata) : null,
				now(),
				now(),
				now(),
			]
		);

		await this._emitEvent("build.started", {
			project: projectName,
			buildType,
			imageTag,
			commitSha,
			agent,
			buildId,
		}, "info");

		return { buildId, status: BUILD_STATUS.RUNNING, skipped: false };
	}

	/**
	 * Complete a build (success or failure).
	 * @param {string} buildId
	 * @param {object} opts
	 * @param {string} opts.status - BUILD_STATUS.SUCCESS or BUILD_STATUS.FAILED
	 * @param {string} [opts.output] - Build output
	 * @param {string} [opts.error] - Error message
	 * @param {object} [opts.metadata] - Additional metadata to cache
	 */
	async completeBuild(buildId, opts) {
		await this.initialize();

		const { status, output, error, metadata } = opts;

		await this._run(
			`UPDATE ${BUILD_TABLE} SET status = ?, output = ?, error = ?, updated_at = ?, completed_at = ? WHERE id = ?`,
			[status, output || null, error || null, now(), now(), buildId]
		);

		const build = await this._getOne(`SELECT * FROM ${BUILD_TABLE} WHERE id = ?`, [buildId]);

		if (build) {
			// Release project lock
			if (this._activeBuilds.get(build.project_name) === buildId) {
				this._activeBuilds.delete(build.project_name);
			}

			// Cache successful builds
			if (status === BUILD_STATUS.SUCCESS) {
				await this._cacheResult({
					projectName: build.project_name,
					buildType: build.build_type,
					imageTag: build.image_tag,
					commitSha: build.commit_sha,
					output,
					metadata: metadata || safeJsonParse(build.metadata, {}),
				});
			}
		}

		await this._emitEvent("build.completed", {
			project: build?.project_name || "unknown",
			buildId,
			buildType: build?.build_type,
			status,
			error,
		}, status === BUILD_STATUS.SUCCESS ? "info" : "error");

		// Process next queued build
		if (build) {
			await this._processNext(build.project_name);
		}
	}

	/**
	 * Process the next queued build for a project.
	 * @param {string} projectName
	 */
	async _processNext(projectName) {
		const nextBuild = await this._getOne(
			`SELECT * FROM ${BUILD_TABLE} WHERE project_name = ? AND status = ? ORDER BY created_at ASC LIMIT 1`,
			[projectName, BUILD_STATUS.QUEUED]
		);

		if (!nextBuild) return;

		this._activeBuilds.set(projectName, nextBuild.id);

		await this._run(
			`UPDATE ${BUILD_TABLE} SET status = ?, started_at = ?, updated_at = ? WHERE id = ?`,
			[BUILD_STATUS.RUNNING, now(), now(), nextBuild.id]
		);

		await this._emitEvent("build.dequeued", {
			project: projectName,
			buildId: nextBuild.id,
			buildType: nextBuild.build_type,
		}, "info");
	}

	/**
	 * Cancel a queued or running build.
	 * @param {string} buildId
	 * @returns {Promise<{success: boolean, error?: string}>}
	 */
	async cancelBuild(buildId) {
		await this.initialize();

		const build = await this._getOne(`SELECT * FROM ${BUILD_TABLE} WHERE id = ?`, [buildId]);

		if (!build) {
			return { success: false, error: "Build not found" };
		}

		if (build.status === BUILD_STATUS.SUCCESS || build.status === BUILD_STATUS.FAILED) {
			return { success: false, error: `Cannot cancel build with status: ${build.status}` };
		}

		await this._run(
			`UPDATE ${BUILD_TABLE} SET status = ?, updated_at = ?, completed_at = ? WHERE id = ?`,
			[BUILD_STATUS.CANCELLED, now(), now(), buildId]
		);

		if (this._activeBuilds.get(build.project_name) === buildId) {
			this._activeBuilds.delete(build.project_name);
		}

		await this._emitEvent("build.cancelled", {
			project: build.project_name,
			buildId,
			buildType: build.build_type,
		}, "warning");

		// Process next queued build
		await this._processNext(build.project_name);

		return { success: true };
	}

	// ── API methods ───────────────────────────────────────────────────────

	/**
	 * Get active builds for a project.
	 * @param {string} projectName
	 * @returns {Promise<Array>}
	 */
	async getActiveBuilds(projectName) {
		await this.initialize();

		const rows = await this._query(
			`SELECT * FROM ${BUILD_TABLE} WHERE project_name = ? AND status IN (?, ?) ORDER BY created_at DESC`,
			[projectName, BUILD_STATUS.RUNNING, BUILD_STATUS.QUEUED]
		);

		return rows.map((r) => ({
			id: r.id,
			projectName: r.project_name,
			buildType: r.build_type,
			imageTag: r.image_tag,
			commitSha: r.commit_sha,
			status: r.status,
			agent: r.agent,
			metadata: safeJsonParse(r.metadata, {}),
			createdAt: r.created_at,
			updatedAt: r.updated_at,
			startedAt: r.started_at,
		}));
	}

	/**
	 * Get build history for a project.
	 * @param {object} filter
	 * @param {string} filter.projectName
	 * @param {string} [filter.buildType]
	 * @param {string} [filter.status]
	 * @param {number} [filter.limit=50]
	 * @returns {Promise<Array>}
	 */
	async getBuildHistory(filter = {}) {
		await this.initialize();

		const { projectName, buildType, status, limit = 50 } = filter;

		let sql = `SELECT * FROM ${BUILD_TABLE} WHERE project_name = ?`;
		const params = [projectName];

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
	 * Get build queue statistics.
	 * @param {string} projectName
	 * @returns {Promise<object>}
	 */
	async getStats(projectName) {
		await this.initialize();

		const total = await this._getOne(
			`SELECT COUNT(*) as count FROM ${BUILD_TABLE} WHERE project_name = ?`,
			[projectName]
		);

		const byStatus = await this._query(
			`SELECT status, COUNT(*) as count FROM ${BUILD_TABLE} WHERE project_name = ? GROUP BY status`,
			[projectName]
		);

		const byType = await this._query(
			`SELECT build_type, COUNT(*) as count FROM ${BUILD_TABLE} WHERE project_name = ? GROUP BY build_type`,
			[projectName]
		);

		const statusMap = {};
		for (const row of byStatus) {
			statusMap[row.status] = row.count;
		}

		const typeMap = {};
		for (const row of byType) {
			typeMap[row.build_type] = row.count;
		}

		return {
			totalBuilds: total?.count || 0,
			byStatus: statusMap,
			byType: typeMap,
			activeBuilds: this._activeBuilds.size,
			cacheTtlMs: this.cacheTtlMs,
		};
	}
}

module.exports = { BuildQueue, BUILD_STATUS };
