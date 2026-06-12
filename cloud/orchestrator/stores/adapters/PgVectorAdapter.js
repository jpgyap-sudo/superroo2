/**
 * PgVectorAdapter — PostgreSQL + pgvector backend for VectorStoreAdapter.
 *
 * This is the primary production adapter, extracted and refactored from
 * BugKnowledgeStore. Uses PostgreSQL 16 + pgvector 0.8.2 with HNSW indexes
 * for fast approximate nearest neighbor search.
 *
 * Schema tables:
 *   - bug_knowledge: stores bug fixes with vector embeddings
 *   - ollama_lessons: stores extracted lessons with vector embeddings
 *   - Views: bug_knowledge_stats, match_bug_knowledge, match_ollama_lessons,
 *            hybrid_search_bug_knowledge
 *
 * Embedding model: nomic-embed-text (768 dimensions) via Ollama
 *
 * NOTE: The `pg` module is lazily required inside init() so that this module
 * can be loaded without `pg` installed (e.g., in test environments using
 * MemoryVectorAdapter). The classifyError utility and ERROR_PATTERNS are
 * exported at the top level and do not depend on `pg`.
 */

const { VectorStoreAdapter } = require("./VectorStoreAdapter")

// ── Error classification (kept here for backward compat) ──────────────────

const ERROR_PATTERNS = [
	{ pattern: /syntax\s*error|unexpected\s*token|missing\s*[\);]|unterminated/i, type: "syntax" },
	{ pattern: /cannot\s*read\s*property|undefined\s*is\s*not|TypeError|ReferenceError/i, type: "runtime" },
	{ pattern: /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|fetch\s*failed|network\s*error/i, type: "api" },
	{ pattern: /test\s*failed|assertion\s*error|expected.*to\s*be|test.*fail/i, type: "test" },
	{ pattern: /module\s*not\s*found|cannot\s*find\s*module|import\s*error/i, type: "config" },
	{ pattern: /timeout|timed?\s*out|hanging/i, type: "runtime" },
	{ pattern: /permission\s*denied|EACCES|EACCESS|forbidden|unauthorized|401|403/i, type: "api" },
	{ pattern: /out\s*of\s*memory|heap\s*out|OOM|allocation\s*failed/i, type: "runtime" },
	{ pattern: /docker|container|sandbox/i, type: "infra" },
]

function classifyError(text) {
	for (const { pattern, type } of ERROR_PATTERNS) {
		if (pattern.test(text)) return type
	}
	return "unknown"
}

// ── Default PostgreSQL config ─────────────────────────────────────────────

const DEFAULT_DB_CONFIG = {
	host: process.env.PGHOST || "127.0.0.1",
	port: parseInt(process.env.PGPORT || "5432", 10),
	user: process.env.PGUSER || "superroo",
	password: process.env.PGPASSWORD || "superroo",
	database: process.env.PGDATABASE || "superroo",
	max: 5,
	idleTimeoutMillis: 30000,
	connectionTimeoutMillis: 5000,
}

// ═══════════════════════════════════════════════════════════════════════════
// PgVectorAdapter
// ═══════════════════════════════════════════════════════════════════════════

class PgVectorAdapter extends VectorStoreAdapter {
	/**
	 * @param {object} [options]
	 * @param {import('../EmbeddingService').EmbeddingService} [options.embeddingService]
	 * @param {object} [options.dbConfig] - PostgreSQL connection config overrides
	 */
	constructor(options = {}) {
		super(options)
		this._adapterName = "PgVectorAdapter"
		this.dbConfig = { ...DEFAULT_DB_CONFIG, ...options.dbConfig }
		/** @type {import('pg').Pool|null} */
		this.pool = null
	}

	// ─── Lifecycle ─────────────────────────────────────────────────────────

	async init() {
		if (this._initialized) return

		// Lazy require `pg` so this module can be loaded without it installed
		const { Pool } = require("pg")
		this.pool = new Pool(this.dbConfig)

		try {
			const client = await this.pool.connect()
			await client.query("SELECT 1")
			client.release()
			console.log("[PgVectorAdapter] Connected to PostgreSQL at", this.dbConfig.host + ":" + this.dbConfig.port)
		} catch (err) {
			console.error("[PgVectorAdapter] Failed to connect to PostgreSQL:", err.message)
			throw err
		}

		this._initialized = true
	}

	async close() {
		if (this.pool) {
			await this.pool.end()
			this.pool = null
			this._initialized = false
			console.log("[PgVectorAdapter] Connection pool closed")
		}
	}

	/**
	 * Get a client from the pool.
	 * @returns {Promise<import('pg').PoolClient>}
	 */
	async _getClient() {
		if (!this._initialized || !this.pool) {
			throw new Error("PgVectorAdapter not initialized. Call init() first.")
		}
		return this.pool.connect()
	}

	// ─── Embedding helpers ─────────────────────────────────────────────────

	/**
	 * Build a text representation of a bug fix for embedding.
	 * @param {object} fix
	 * @returns {string}
	 */
	_buildEmbeddingText(fix) {
		const parts = [
			fix.error_summary,
			fix.instruction,
			fix.result,
			fix.error_type,
			Array.isArray(fix.files_changed) ? fix.files_changed.join(" ") : "",
			Array.isArray(fix.test_commands) ? fix.test_commands.join(" ") : "",
		]
		return parts.filter(Boolean).join("\n")
	}

	/**
	 * Generate embedding or return pre-computed one.
	 * @param {string} text
	 * @param {number[]} [precomputed]
	 * @returns {Promise<number[]|null>}
	 */
	async _resolveEmbedding(text, precomputed) {
		if (precomputed) return precomputed
		if (this.embeddingService) {
			return this.embeddingService.generate(text)
		}
		return null
	}

	// ─── Bug Fix CRUD ──────────────────────────────────────────────────────

	async storeBugFix(fix, embedding) {
		const client = await this._getClient()
		try {
			const errorType = fix.error_type || classifyError(fix.error_summary || fix.result || "")
			const embeddingText = this._buildEmbeddingText(fix)
			const emb = await this._resolveEmbedding(embeddingText, embedding)

			const result = await client.query(
				`INSERT INTO bug_knowledge
				 (task_id, agent_type, error_type, error_summary, instruction, prompt, diff, logs, result,
				  files_changed, test_commands, test_passed, embedding, metadata)
				 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
				 ON CONFLICT (task_id) DO UPDATE SET
				   agent_type = EXCLUDED.agent_type,
				   error_type = EXCLUDED.error_type,
				   error_summary = EXCLUDED.error_summary,
				   result = EXCLUDED.result,
				   diff = EXCLUDED.diff,
				   logs = EXCLUDED.logs,
				   files_changed = EXCLUDED.files_changed,
				   test_commands = EXCLUDED.test_commands,
				   test_passed = EXCLUDED.test_passed,
				   embedding = COALESCE(EXCLUDED.embedding, bug_knowledge.embedding),
				   metadata = bug_knowledge.metadata || EXCLUDED.metadata
				 RETURNING id`,
				[
					fix.task_id,
					fix.agent_type || "unknown",
					errorType,
					fix.error_summary || "",
					fix.instruction || "",
					fix.prompt || null,
					fix.diff || null,
					fix.logs || null,
					fix.result || "",
					fix.files_changed || [],
					fix.test_commands || [],
					fix.test_passed !== undefined ? fix.test_passed : null,
					emb ? `[${emb.join(",")}]` : null,
					JSON.stringify(fix.metadata || {}),
				],
			)

			return { id: result.rows[0].id, success: true }
		} catch (err) {
			console.error(`[PgVectorAdapter] Failed to store bug fix: ${err.message}`)
			return { id: null, success: false, error: err.message }
		} finally {
			client.release()
		}
	}

	async searchSimilar(query, options = {}) {
		const limit = options.limit || 5
		const threshold = options.threshold || 0.6
		const hybrid = options.hybrid || false

		const embedding = this.embeddingService ? await this.embeddingService.generate(query) : null
		if (!embedding) {
			console.warn("[PgVectorAdapter] Could not generate embedding — falling back to keyword search")
			return this._keywordSearch(query, limit)
		}

		const client = await this._getClient()
		try {
			let result
			if (hybrid) {
				result = await client.query(
					`SELECT id, error_type, error_summary, result, diff, score
					 FROM hybrid_search_bug_knowledge($1::vector, $2, $3, 0.6)`,
					[`[${embedding.join(",")}]`, query, limit],
				)
			} else {
				result = await client.query(
					`SELECT id, error_type, error_summary, result, diff, similarity
					 FROM match_bug_knowledge($1::vector, $2, $3)`,
					[`[${embedding.join(",")}]`, threshold, limit],
				)
			}

			return result.rows.map((r) => ({
				id: r.id,
				error_type: r.error_type,
				error_summary: r.error_summary,
				result: r.result,
				diff: r.diff,
				similarity: r.similarity || r.score,
			}))
		} catch (err) {
			console.error(`[PgVectorAdapter] Vector search failed: ${err.message}`)
			return []
		} finally {
			client.release()
		}
	}

	/**
	 * Fallback keyword search when embeddings are unavailable.
	 * @param {string} query
	 * @param {number} limit
	 * @returns {Promise<Array>}
	 */
	async _keywordSearch(query, limit) {
		const client = await this._getClient()
		try {
			const result = await client.query(
				`SELECT id, error_type, error_summary, result, diff,
				        ts_rank(to_tsvector('english', error_summary || ' ' || result || ' ' || COALESCE(instruction, '')),
				                plainto_tsquery('english', $1)) AS similarity
				 FROM bug_knowledge
				 WHERE to_tsvector('english', error_summary || ' ' || result || ' ' || COALESCE(instruction, ''))
				       @@ plainto_tsquery('english', $1)
				 ORDER BY similarity DESC
				 LIMIT $2`,
				[query, limit],
			)
			return result.rows.map((r) => ({
				...r,
				similarity: r.similarity || 0,
			}))
		} catch (err) {
			console.error(`[PgVectorAdapter] Keyword search failed: ${err.message}`)
			return []
		} finally {
			client.release()
		}
	}

	async updateTestStatus(taskId, passed) {
		const client = await this._getClient()
		try {
			await client.query(`UPDATE bug_knowledge SET test_passed = $1 WHERE task_id = $2`, [passed, taskId])
			return true
		} catch (err) {
			console.error(`[PgVectorAdapter] Failed to update test status: ${err.message}`)
			return false
		} finally {
			client.release()
		}
	}

	// ─── Lesson CRUD ───────────────────────────────────────────────────────

	async storeLesson(lesson, embedding) {
		const client = await this._getClient()
		try {
			const normalized = {
				lesson_type: lesson.lesson_type || lesson.type || "best_practice",
				topic: lesson.topic || lesson.summary || lesson.problem || "Untitled lesson",
				content:
					lesson.content ||
					lesson.details ||
					[lesson.root_cause, lesson.solution].filter(Boolean).join("\n") ||
					lesson.summary ||
					"",
				source_task_id: lesson.source_task_id || lesson.task_id || lesson.raw_ref || null,
				project: lesson.project || "superroo2",
				metadata: {
					...(lesson.metadata || {}),
					agent_type: lesson.agent_type,
					features_affected: lesson.features_affected,
				},
			}
			const embeddingText = `${normalized.topic}\n${normalized.content}`
			const emb =
				embedding || (this.embeddingService ? await this.embeddingService.generate(embeddingText) : null)

			const result = await client.query(
				`INSERT INTO ollama_lessons
				 (lesson_type, topic, content, source_task_id, project, embedding, metadata)
				 VALUES ($1, $2, $3, $4, $5, $6, $7)
				 RETURNING id`,
				[
					normalized.lesson_type,
					normalized.topic,
					normalized.content,
					normalized.source_task_id,
					normalized.project,
					emb ? `[${emb.join(",")}]` : null,
					JSON.stringify(normalized.metadata),
				],
			)

			return { id: result.rows[0].id, success: true }
		} catch (err) {
			console.error(`[PgVectorAdapter] Failed to store lesson: ${err.message}`)
			return { id: null, success: false, error: err.message }
		} finally {
			client.release()
		}
	}

	async searchLessons(query, options = {}) {
		const limit = options.limit || 5
		const threshold = options.threshold || 0.6

		const embedding = this.embeddingService ? await this.embeddingService.generate(query) : null
		if (!embedding) {
			return []
		}

		const client = await this._getClient()
		try {
			const result = await client.query(
				`SELECT id, lesson_type, topic, content, similarity
				 FROM match_ollama_lessons($1::vector, $2, $3)`,
				[`[${embedding.join(",")}]`, threshold, limit],
			)
			return result.rows
		} catch (err) {
			console.error(`[PgVectorAdapter] Lesson search failed: ${err.message}`)
			return []
		} finally {
			client.release()
		}
	}

	async getAllLessons(options = {}) {
		const limit = Math.min(options.limit || 100, 500)
		const offset = options.offset || 0
		const project = options.project || null
		const client = await this._getClient()
		try {
			const where = project ? `WHERE project = $3` : ''
			const params = project ? [limit, offset, project] : [limit, offset]
			const result = await client.query(
				`SELECT id, lesson_type, topic, content, source_task_id, project, metadata, created_at
				 FROM ollama_lessons
				 ${where}
				 ORDER BY created_at ASC
				 LIMIT $1 OFFSET $2`,
				params,
			)
			const countResult = await client.query(
				project ? `SELECT COUNT(*)::int AS total FROM ollama_lessons WHERE project = $1` : `SELECT COUNT(*)::int AS total FROM ollama_lessons`,
				project ? [project] : [],
			)
			return {
				rows: result.rows,
				total: parseInt(countResult.rows[0]?.total || '0', 10),
				offset,
				limit,
			}
		} catch (err) {
			console.error(`[PgVectorAdapter] getAllLessons failed: ${err.message}`)
			return { rows: [], total: 0, offset, limit }
		} finally {
			client.release()
		}
	}

	async getLessonCountByProject() {
		const client = await this._getClient()
		try {
			const result = await client.query(
				`SELECT project, COUNT(*)::int AS count
				 FROM ollama_lessons
				 GROUP BY project
				 ORDER BY count DESC`,
			)
			const counts = {}
			for (const row of result.rows) {
				counts[row.project] = parseInt(row.count, 10)
			}
			return counts
		} catch (err) {
			console.error(`[PgVectorAdapter] Failed to get lesson counts by project: ${err.message}`)
			return {}
		} finally {
			client.release()
		}
	}

	// ─── Stats & Health ────────────────────────────────────────────────────

	async getStats() {
		const client = await this._getClient()
		try {
			const result = await client.query("SELECT * FROM bug_knowledge_stats")
			const row = result.rows[0] || {}

			const lessonResult = await client.query("SELECT COUNT(*) AS count FROM ollama_lessons")
			const lessonCount = parseInt(lessonResult.rows[0]?.count || "0", 10)

			return {
				totalBugFixes: parseInt(row.total_entries || "0", 10),
				errorTypes: parseInt(row.error_types || "0", 10),
				agentTypes: parseInt(row.agent_types || "0", 10),
				testsPassed: parseInt(row.tests_passed || "0", 10),
				testsFailed: parseInt(row.tests_failed || "0", 10),
				untested: parseInt(row.untested || "0", 10),
				totalLessons: lessonCount,
				latestEntry: row.latest_entry || null,
			}
		} catch (err) {
			console.error(`[PgVectorAdapter] Failed to get stats: ${err.message}`)
			return {
				totalBugFixes: 0,
				errorTypes: 0,
				agentTypes: 0,
				testsPassed: 0,
				testsFailed: 0,
				untested: 0,
				totalLessons: 0,
				latestEntry: null,
			}
		} finally {
			client.release()
		}
	}

	async healthCheck() {
		const result = { healthy: false, postgres: false, ollama: false }

		try {
			const client = await this._getClient()
			await client.query("SELECT 1")
			client.release()
			result.postgres = true
		} catch (err) {
			result.error = `PostgreSQL: ${err.message}`
		}

		if (this.embeddingService) {
			try {
				result.ollama = await this.embeddingService.healthCheck()
			} catch {
				// Ollama may not be running
			}
		}

		result.healthy = result.postgres
		return result
	}
}

module.exports = { PgVectorAdapter, classifyError, ERROR_PATTERNS }
