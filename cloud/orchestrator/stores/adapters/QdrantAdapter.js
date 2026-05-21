/**
 * QdrantAdapter — Qdrant vector database backend for VectorStoreAdapter.
 *
 * Qdrant is a high-performance vector similarity search engine that can run
 * as a standalone Docker container or as a cloud service. This adapter
 * communicates with Qdrant via its REST API.
 *
 * Configuration via environment variables:
 *   QDRANT_URL=http://127.0.0.1:6333 (default)
 *   QDRANT_API_KEY= (optional, for cloud instances)
 *
 * Collections:
 *   - bug_knowledge: stores bug fix vectors with payload
 *   - ollama_lessons: stores lesson vectors with payload
 *
 * Uses cosine distance metric with auto-created HNSW indexes.
 */

const { VectorStoreAdapter } = require("./VectorStoreAdapter")

const DEFAULT_QDRANT_URL = process.env.QDRANT_URL || "http://127.0.0.1:6333"
const QDRANT_API_KEY = process.env.QDRANT_API_KEY || ""

const COLLECTION_BUGS = "bug_knowledge"
const COLLECTION_LESSONS = "ollama_lessons"
const VECTOR_SIZE = parseInt(process.env.EMBEDDING_DIMS || "768", 10)

class QdrantAdapter extends VectorStoreAdapter {
	/**
	 * @param {object} [options]
	 * @param {import('../EmbeddingService').EmbeddingService} [options.embeddingService]
	 * @param {string} [options.url] - Qdrant REST API URL
	 * @param {string} [options.apiKey] - Qdrant API key
	 * @param {number} [options.vectorSize] - Embedding dimension size
	 */
	constructor(options = {}) {
		super(options)
		this._adapterName = "QdrantAdapter"
		this.url = options.url || DEFAULT_QDRANT_URL
		this.apiKey = options.apiKey || QDRANT_API_KEY
		this.vectorSize = options.vectorSize || VECTOR_SIZE
	}

	/**
	 * Make an HTTP request to the Qdrant REST API.
	 * @param {string} method
	 * @param {string} path
	 * @param {object} [body]
	 * @returns {Promise<object|null>}
	 */
	async _request(method, path, body) {
		const url = `${this.url}${path}`
		const headers = { "Content-Type": "application/json" }
		if (this.apiKey) {
			headers["api-key"] = this.apiKey
		}

		try {
			const res = await fetch(url, {
				method,
				headers,
				body: body ? JSON.stringify(body) : undefined,
			})
			if (!res.ok) {
				const text = await res.text()
				console.warn(`[QdrantAdapter] HTTP ${res.status} on ${method} ${path}: ${text}`)
				return null
			}
			return await res.json()
		} catch (err) {
			console.warn(`[QdrantAdapter] Request failed: ${method} ${path} — ${err.message}`)
			return null
		}
	}

	/**
	 * Ensure a collection exists with the correct vector configuration.
	 * @param {string} name
	 * @returns {Promise<boolean>}
	 */
	async _ensureCollection(name) {
		// Check if collection exists
		const existing = await this._request("GET", `/collections/${name}`)
		if (existing?.result) return true

		// Create collection
		const result = await this._request("PUT", `/collections/${name}`, {
			vectors: {
				size: this.vectorSize,
				distance: "Cosine",
			},
			optimizers_config: {
				default_segment_number: 2,
			},
			hnsw_config: {
				m: 16,
				ef_construct: 100,
			},
		})
		return result?.result === true
	}

	// ─── Lifecycle ─────────────────────────────────────────────────────────

	async init() {
		if (this._initialized) return

		// Ensure both collections exist
		await this._ensureCollection(COLLECTION_BUGS)
		await this._ensureCollection(COLLECTION_LESSONS)

		this._initialized = true
		console.log(`[QdrantAdapter] Initialized at ${this.url}`)
	}

	async close() {
		this._initialized = false
		console.log("[QdrantAdapter] Closed")
	}

	// ─── Embedding helper ──────────────────────────────────────────────────

	async _getEmbedding(text, precomputed) {
		if (precomputed) return precomputed
		if (this.embeddingService) {
			return this.embeddingService.generate(text)
		}
		return null
	}

	// ─── Bug Fix CRUD ──────────────────────────────────────────────────────

	async storeBugFix(fix, embedding) {
		const id = fix.task_id || `fix-${Date.now()}`
		const emb = await this._getEmbedding(
			[fix.error_summary, fix.instruction, fix.result].filter(Boolean).join("\n"),
			embedding,
		)
		if (!emb) {
			return { id: null, success: false, error: "Could not generate embedding" }
		}

		const result = await this._request("PUT", `/collections/${COLLECTION_BUGS}/points`, {
			points: [
				{
					id,
					vector: emb,
					payload: {
						task_id: fix.task_id,
						agent_type: fix.agent_type || "unknown",
						error_type: fix.error_type || "unknown",
						error_summary: fix.error_summary || "",
						instruction: fix.instruction || "",
						prompt: fix.prompt || null,
						diff: fix.diff || null,
						logs: fix.logs || null,
						result: fix.result || "",
						files_changed: fix.files_changed || [],
						test_commands: fix.test_commands || [],
						test_passed: fix.test_passed !== undefined ? fix.test_passed : null,
						metadata: fix.metadata || {},
					},
				},
			],
		})

		return { id, success: result !== null }
	}

	async searchSimilar(query, options = {}) {
		const limit = options.limit || 5
		const threshold = options.threshold || 0.6

		const emb = await this._getEmbedding(query)
		if (!emb) return []

		const result = await this._request("POST", `/collections/${COLLECTION_BUGS}/points/search`, {
			vector: emb,
			limit,
			score_threshold: threshold,
			with_payload: true,
		})

		if (!result?.result) return []

		return result.result.map((point) => ({
			id: point.id,
			error_type: point.payload?.error_type || "unknown",
			error_summary: point.payload?.error_summary || "",
			result: point.payload?.result || "",
			diff: point.payload?.diff || null,
			similarity: point.score || 0,
		}))
	}

	async updateTestStatus(taskId, passed) {
		const result = await this._request("PATCH", `/collections/${COLLECTION_BUGS}/points`, {
			points: [
				{
					id: taskId,
					payload: { test_passed: passed },
				},
			],
		})
		return result !== null
	}

	// ─── Lesson CRUD ───────────────────────────────────────────────────────

	async storeLesson(lesson, embedding) {
		const id = lesson.source_task_id || lesson.task_id || `lesson-${Date.now()}`
		const emb = await this._getEmbedding(`${lesson.topic || ""}\n${lesson.content || ""}`, embedding)
		if (!emb) {
			return { id: null, success: false, error: "Could not generate embedding" }
		}

		const result = await this._request("PUT", `/collections/${COLLECTION_LESSONS}/points`, {
			points: [
				{
					id,
					vector: emb,
					payload: {
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
						agent_type: lesson.agent_type || null,
						features_affected: lesson.features_affected || null,
						metadata: lesson.metadata || {},
					},
				},
			],
		})

		return { id, success: result !== null }
	}

	async searchLessons(query, options = {}) {
		const limit = options.limit || 5
		const threshold = options.threshold || 0.6

		const emb = await this._getEmbedding(query)
		if (!emb) return []

		const result = await this._request("POST", `/collections/${COLLECTION_LESSONS}/points/search`, {
			vector: emb,
			limit,
			score_threshold: threshold,
			with_payload: true,
		})

		if (!result?.result) return []

		return result.result.map((point) => ({
			id: point.id,
			lesson_type: point.payload?.lesson_type || "best_practice",
			topic: point.payload?.topic || "",
			content: point.payload?.content || "",
			similarity: point.score || 0,
		}))
	}

	async getLessonCountByProject() {
		// Qdrant doesn't have a simple GROUP BY — scroll all and count in memory
		const counts = {}
		let offset = null
		while (true) {
			const body = { limit: 100, with_payload: ["project"] }
			if (offset) body.offset = offset

			const result = await this._request("POST", `/collections/${COLLECTION_LESSONS}/points/scroll`, body)
			if (!result?.result?.points?.length) break

			for (const point of result.result.points) {
				const project = point.payload?.project || "unknown"
				counts[project] = (counts[project] || 0) + 1
			}

			offset = result.result.next_page_offset
			if (!offset) break
		}
		return counts
	}

	// ─── Stats & Health ────────────────────────────────────────────────────

	async getStats() {
		const bugsInfo = await this._request("GET", `/collections/${COLLECTION_BUGS}`)
		const lessonsInfo = await this._request("GET", `/collections/${COLLECTION_LESSONS}`)

		return {
			totalBugFixes: bugsInfo?.result?.points_count || 0,
			totalLessons: lessonsInfo?.result?.points_count || 0,
			errorTypes: 0, // Qdrant doesn't expose distinct count easily
			testsPassed: 0,
			testsFailed: 0,
			untested: 0,
			latestEntry: null,
		}
	}

	async healthCheck() {
		const result = await this._request("GET", "/")
		return {
			healthy: result !== null,
			qdrant: result !== null,
			ollama: this.embeddingService ? await this.embeddingService.healthCheck() : false,
		}
	}
}

module.exports = { QdrantAdapter }
