/**
 * SuperRoo Cloud — BugKnowledgeStore
 *
 * PostgreSQL + pgvector-backed knowledge store for the Ollama RAG Learning Loop.
 *
 * This module is the "Central Brain" — it stores every bug fix from DeepSeek/OpenAI
 * as vector embeddings, enabling Ollama to retrieve similar past fixes via RAG.
 *
 * Key features:
 *   - Vector similarity search via pgvector (cosine distance)
 *   - Hybrid search (vector + full-text keyword)
 *   - Automatic embedding generation via Ollama's nomic-embed-text model
 *   - Lesson extraction and storage for reusable patterns
 *   - Stats and health monitoring
 *
 * Embedding model: nomic-embed-text (768 dimensions) via Ollama
 * Database: PostgreSQL 16 + pgvector 0.8.2
 */

const { Pool } = require("pg")
const crypto = require("crypto")

// ── Configuration ──────────────────────────────────────────────────────────────

const DB_CONFIG = {
	host: process.env.PGHOST || "127.0.0.1",
	port: parseInt(process.env.PGPORT || "5432", 10),
	user: process.env.PGUSER || "superroo",
	password: process.env.PGPASSWORD || "superroo",
	database: process.env.PGDATABASE || "superroo",
	max: 5, // Max pool connections
	idleTimeoutMillis: 30000,
	connectionTimeoutMillis: 5000,
}

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434"
const EMBEDDING_MODEL = process.env.OLLAMA_EMBEDDING_MODEL || "nomic-embed-text"
const EMBEDDING_DIMS = 768

// ── Error classification ───────────────────────────────────────────────────────

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

// ═══════════════════════════════════════════════════════════════════════════════
// BugKnowledgeStore
// ═══════════════════════════════════════════════════════════════════════════════

class BugKnowledgeStore {
	/**
	 * @param {object} [options]
	 * @param {object} [options.dbConfig] - PostgreSQL connection config overrides
	 * @param {string} [options.ollamaBaseUrl] - Ollama API base URL
	 */
	constructor(options = {}) {
		this.dbConfig = { ...DB_CONFIG, ...options.dbConfig }
		this.ollamaBaseUrl = options.ollamaBaseUrl || OLLAMA_BASE_URL
		/** @type {import('pg').Pool|null} */
		this.pool = null
		this._initialized = false
	}

	/**
	 * Initialize the connection pool.
	 * Must be called before any other method.
	 */
	async init() {
		if (this._initialized) return

		this.pool = new Pool(this.dbConfig)

		// Test connection
		try {
			const client = await this.pool.connect()
			await client.query("SELECT 1")
			client.release()
			console.log("[BugKnowledgeStore] Connected to PostgreSQL at", this.dbConfig.host + ":" + this.dbConfig.port)
		} catch (err) {
			console.error("[BugKnowledgeStore] Failed to connect to PostgreSQL:", err.message)
			throw err
		}

		this._initialized = true
	}

	/**
	 * Close the connection pool.
	 */
	async close() {
		if (this.pool) {
			await this.pool.end()
			this.pool = null
			this._initialized = false
			console.log("[BugKnowledgeStore] Connection pool closed")
		}
	}

	/**
	 * Get a client from the pool.
	 * @returns {Promise<import('pg').PoolClient>}
	 */
	async _getClient() {
		if (!this._initialized || !this.pool) {
			throw new Error("BugKnowledgeStore not initialized. Call init() first.")
		}
		return this.pool.connect()
	}

	// ── Embedding Generation ───────────────────────────────────────────────

	/**
	 * Generate an embedding vector for text using Ollama's nomic-embed-text model.
	 *
	 * @param {string} text - The text to embed
	 * @returns {Promise<number[]|null>} - 768-dimension embedding array, or null on failure
	 */
	async _generateEmbedding(text) {
		if (!text || text.trim().length === 0) return null

		try {
			const http = require("http")
			const postData = JSON.stringify({
				model: EMBEDDING_MODEL,
				prompt: text.slice(0, 8000),
			})
			const embedding = await new Promise((resolve, reject) => {
				const req = http.request(
					`${this.ollamaBaseUrl}/api/embeddings`,
					{
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							"Content-Length": Buffer.byteLength(postData),
						},
						timeout: 30_000,
					},
					(res) => {
						let body = ""
						res.on("data", (chunk) => (body += chunk))
						res.on("end", () => {
							try {
								const data = JSON.parse(body)
								if (data.embedding && Array.isArray(data.embedding)) {
									resolve(data.embedding)
								} else {
									resolve(null)
								}
							} catch {
								resolve(null)
							}
						})
					},
				)
				req.on("error", () => resolve(null))
				req.on("timeout", () => {
					req.destroy()
					resolve(null)
				})
				req.write(postData)
				req.end()
			})
			return embedding
		} catch (err) {
			console.warn(`[BugKnowledgeStore] Ollama embedding error: ${err.message}`)
			return null
		}
	}

	/**
	 * Build a text representation of a bug fix for embedding.
	 * Combines all relevant fields into a single searchable text.
	 *
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

	// ── CRUD Operations ────────────────────────────────────────────────────

	/**
	 * Store a bug fix in the knowledge base.
	 * Generates embedding automatically via Ollama.
	 *
	 * @param {object} fix
	 * @param {string} fix.task_id - Unique task identifier
	 * @param {string} fix.agent_type - 'deepseek', 'openai', 'ollama', 'anthropic'
	 * @param {string} [fix.error_summary] - Brief description of the bug
	 * @param {string} fix.instruction - Original user instruction
	 * @param {string} [fix.prompt] - The LLM prompt that fixed it
	 * @param {string} [fix.diff] - Git diff of the fix
	 * @param {string} [fix.logs] - Relevant logs/output
	 * @param {string} fix.result - Final result / fix description
	 * @param {string[]} [fix.files_changed] - Array of file paths
	 * @param {string[]} [fix.test_commands] - Commands used to verify
	 * @param {boolean} [fix.test_passed] - Whether tests passed
	 * @param {object} [fix.metadata] - Additional metadata
	 * @returns {Promise<{id: string, success: boolean}>}
	 */
	async storeBugFix(fix) {
		const client = await this._getClient()
		try {
			const errorType = fix.error_type || classifyError(fix.error_summary || fix.result || "")
			const embeddingText = this._buildEmbeddingText(fix)
			const embedding = await this._generateEmbedding(embeddingText)

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
					embedding ? `[${embedding.join(",")}]` : null,
					JSON.stringify(fix.metadata || {}),
				],
			)

			return { id: result.rows[0].id, success: true }
		} catch (err) {
			console.error(`[BugKnowledgeStore] Failed to store bug fix: ${err.message}`)
			return { id: null, success: false, error: err.message }
		} finally {
			client.release()
		}
	}

	/**
	 * Search for similar bug fixes using vector similarity.
	 *
	 * @param {string} query - Natural language query describing the problem
	 * @param {object} [options]
	 * @param {number} [options.limit=5] - Max results
	 * @param {number} [options.threshold=0.6] - Similarity threshold (0-1)
	 * @param {boolean} [options.hybrid=false] - Use hybrid search (vector + keyword)
	 * @returns {Promise<Array<{id: string, error_type: string, error_summary: string, result: string, diff: string, similarity: number}>>}
	 */
	async searchSimilar(query, options = {}) {
		const limit = options.limit || 5
		const threshold = options.threshold || 0.6
		const hybrid = options.hybrid || false

		const embedding = await this._generateEmbedding(query)
		if (!embedding) {
			console.warn(
				"[BugKnowledgeStore] Could not generate embedding for search query — falling back to keyword search",
			)
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
			console.error(`[BugKnowledgeStore] Vector search failed: ${err.message}`)
			return []
		} finally {
			client.release()
		}
	}

	/**
	 * Fallback keyword search when embeddings are unavailable.
	 *
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
			console.error(`[BugKnowledgeStore] Keyword search failed: ${err.message}`)
			return []
		} finally {
			client.release()
		}
	}

	/**
	 * Store an extracted lesson in the ollama_lessons table.
	 *
	 * @param {object} lesson
	 * @param {string} lesson.lesson_type - 'pattern', 'fix', 'best_practice', 'anti_pattern'
	 * @param {string} lesson.topic - Lesson topic
	 * @param {string} lesson.content - Lesson content
	 * @param {string} [lesson.source_task_id] - Source task ID
	 * @param {object} [lesson.metadata] - Additional metadata
	 * @returns {Promise<{id: string, success: boolean}>}
	 */
	async storeLesson(lesson) {
		const client = await this._getClient()
		try {
			const embeddingText = `${lesson.topic}\n${lesson.content}`
			const embedding = await this._generateEmbedding(embeddingText)

			const result = await client.query(
				`INSERT INTO ollama_lessons
				 (lesson_type, topic, content, source_task_id, embedding, metadata)
				 VALUES ($1, $2, $3, $4, $5, $6)
				 RETURNING id`,
				[
					lesson.lesson_type,
					lesson.topic,
					lesson.content,
					lesson.source_task_id || null,
					embedding ? `[${embedding.join(",")}]` : null,
					JSON.stringify(lesson.metadata || {}),
				],
			)

			return { id: result.rows[0].id, success: true }
		} catch (err) {
			console.error(`[BugKnowledgeStore] Failed to store lesson: ${err.message}`)
			return { id: null, success: false, error: err.message }
		} finally {
			client.release()
		}
	}

	/**
	 * Search for similar lessons using vector similarity.
	 *
	 * @param {string} query
	 * @param {object} [options]
	 * @param {number} [options.limit=5]
	 * @param {number} [options.threshold=0.6]
	 * @returns {Promise<Array>}
	 */
	async searchLessons(query, options = {}) {
		const limit = options.limit || 5
		const threshold = options.threshold || 0.6

		const embedding = await this._generateEmbedding(query)
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
			console.error(`[BugKnowledgeStore] Lesson search failed: ${err.message}`)
			return []
		} finally {
			client.release()
		}
	}

	/**
	 * Build a RAG context string from similar bug fixes for injection into LLM prompts.
	 * This is the primary method used by agentRunners.js to give Ollama memory.
	 *
	 * @param {string} query - The problem description or error message
	 * @param {object} [options]
	 * @param {number} [options.maxResults=3] - Max similar fixes to include
	 * @param {number} [options.threshold=0.6] - Similarity threshold
	 * @returns {Promise<string>} - Formatted context string for prompt injection
	 */
	async buildRagContext(query, options = {}) {
		const maxResults = options.maxResults || 3
		const threshold = options.threshold || 0.6

		const [bugFixes, lessons] = await Promise.all([
			this.searchSimilar(query, { limit: maxResults, threshold }),
			this.searchLessons(query, { limit: maxResults, threshold }),
		])

		const parts = []

		if (bugFixes.length > 0) {
			parts.push("=== Similar Bug Fixes from Knowledge Base ===")
			for (const fix of bugFixes) {
				parts.push(`---`)
				parts.push(`Error Type: ${fix.error_type || "unknown"}`)
				parts.push(`Summary: ${fix.error_summary || "N/A"}`)
				parts.push(`Solution: ${fix.result || "N/A"}`)
				parts.push(`Similarity: ${(fix.similarity * 100).toFixed(1)}%`)
				if (fix.diff) {
					parts.push(`Diff snippet:\n${fix.diff.slice(0, 1000)}`)
				}
			}
		}

		if (lessons.length > 0) {
			parts.push("")
			parts.push("=== Relevant Lessons ===")
			for (const lesson of lessons) {
				parts.push(`---`)
				parts.push(`Type: ${lesson.lesson_type}`)
				parts.push(`Topic: ${lesson.topic}`)
				parts.push(`Content: ${lesson.content}`)
				parts.push(`Similarity: ${(lesson.similarity * 100).toFixed(1)}%`)
			}
		}

		if (parts.length === 0) {
			return ""
		}

		return parts.join("\n")
	}

	/**
	 * Update the test_passed status for a bug fix.
	 *
	 * @param {string} taskId
	 * @param {boolean} passed
	 * @returns {Promise<boolean>}
	 */
	async updateTestStatus(taskId, passed) {
		const client = await this._getClient()
		try {
			await client.query(`UPDATE bug_knowledge SET test_passed = $1 WHERE task_id = $2`, [passed, taskId])
			return true
		} catch (err) {
			console.error(`[BugKnowledgeStore] Failed to update test status: ${err.message}`)
			return false
		} finally {
			client.release()
		}
	}

	/**
	 * Get knowledge base statistics.
	 *
	 * @returns {Promise<object>}
	 */
	async getStats() {
		const client = await this._getClient()
		try {
			const result = await client.query("SELECT * FROM bug_knowledge_stats")
			const row = result.rows[0] || {}

			// Also get lesson count
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
			console.error(`[BugKnowledgeStore] Failed to get stats: ${err.message}`)
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

	/**
	 * Check if the knowledge store is healthy (PostgreSQL + Ollama reachable).
	 *
	 * @returns {Promise<{healthy: boolean, postgres: boolean, ollama: boolean, error?: string}>}
	 */
	async healthCheck() {
		const result = { healthy: false, postgres: false, ollama: false }

		// Check PostgreSQL
		try {
			const client = await this._getClient()
			await client.query("SELECT 1")
			client.release()
			result.postgres = true
		} catch (err) {
			result.error = `PostgreSQL: ${err.message}`
		}

		// Check Ollama
		try {
			const controller = new AbortController()
			const timeoutId = setTimeout(() => controller.abort(), 5000)
			const res = await fetch(`${this.ollamaBaseUrl}/api/tags`, { signal: controller.signal })
			clearTimeout(timeoutId)
			if (res.ok) {
				result.ollama = true
			}
		} catch {
			// Ollama may not be running — that's okay for non-local mode
		}

		result.healthy = result.postgres
		return result
	}
}

module.exports = { BugKnowledgeStore }
