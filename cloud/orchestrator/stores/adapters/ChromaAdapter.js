/**
 * ChromaAdapter — Chroma vector database backend for VectorStoreAdapter.
 *
 * Chroma is an open-source embedding database that runs as a standalone server
 * or embedded. This adapter communicates via Chroma's REST API.
 *
 * Configuration via environment variables:
 *   CHROMA_URL=http://127.0.0.1:8000 (default)
 *
 * Collections:
 *   - bug_knowledge: stores bug fix vectors with metadata
 *   - ollama_lessons: stores lesson vectors with metadata
 *
 * Uses cosine distance (default Chroma metric).
 */

const { VectorStoreAdapter } = require("./VectorStoreAdapter")

const DEFAULT_CHROMA_URL = process.env.CHROMA_URL || "http://127.0.0.1:8000"
const VECTOR_SIZE = parseInt(process.env.EMBEDDING_DIMS || "768", 10)

const COLLECTION_BUGS = "bug_knowledge"
const COLLECTION_LESSONS = "ollama_lessons"

class ChromaAdapter extends VectorStoreAdapter {
	/**
	 * @param {object} [options]
	 * @param {import('../EmbeddingService').EmbeddingService} [options.embeddingService]
	 * @param {string} [options.url] - Chroma REST API URL
	 * @param {number} [options.vectorSize] - Embedding dimension size
	 */
	constructor(options = {}) {
		super(options)
		this._adapterName = "ChromaAdapter"
		this.url = options.url || DEFAULT_CHROMA_URL
		this.vectorSize = options.vectorSize || VECTOR_SIZE
		/** @type {Map<string, string>} Cache of collection name -> UUID */
		this._collectionIds = new Map()
	}

	/**
	 * Make an HTTP request to the Chroma REST API.
	 * @param {string} method
	 * @param {string} path
	 * @param {object} [body]
	 * @returns {Promise<object|null>}
	 */
	async _request(method, path, body) {
		const url = `${this.url}/api/v1${path}`
		try {
			const res = await fetch(url, {
				method,
				headers: { "Content-Type": "application/json" },
				body: body ? JSON.stringify(body) : undefined,
			})
			if (!res.ok) {
				const text = await res.text()
				console.warn(`[ChromaAdapter] HTTP ${res.status} on ${method} ${path}: ${text}`)
				return null
			}
			if (res.status === 204) return { success: true }
			return await res.json()
		} catch (err) {
			console.warn(`[ChromaAdapter] Request failed: ${method} ${path} — ${err.message}`)
			return null
		}
	}

	/**
	 * Ensure a collection exists with the correct metadata.
	 * @param {string} name
	 * @returns {Promise<string|null>} Collection UUID
	 */
	async _ensureCollection(name) {
		// Try to get existing collection
		const existing = await this._request("GET", `/collections?name=${encodeURIComponent(name)}`)
		if (Array.isArray(existing) && existing.length > 0) {
			const id = existing[0].id || existing[0].name
			this._collectionIds.set(name, id)
			return id
		}

		// Create collection
		const result = await this._request("POST", "/collections", {
			name,
			metadata: { "hnsw:space": "cosine" },
		})
		if (result) {
			const id = result.id || result.name
			this._collectionIds.set(name, id)
			return id
		}
		return null
	}

	/**
	 * Get collection UUID.
	 * @param {string} name
	 * @returns {string|null}
	 */
	_getCollectionId(name) {
		return this._collectionIds.get(name) || name
	}

	// ─── Lifecycle ─────────────────────────────────────────────────────────

	async init() {
		if (this._initialized) return

		await this._ensureCollection(COLLECTION_BUGS)
		await this._ensureCollection(COLLECTION_LESSONS)

		this._initialized = true
		console.log(`[ChromaAdapter] Initialized at ${this.url}`)
	}

	async close() {
		this._collectionIds.clear()
		this._initialized = false
		console.log("[ChromaAdapter] Closed")
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

		const collectionId = this._getCollectionId(COLLECTION_BUGS)
		const result = await this._request("POST", `/collections/${collectionId}/add`, {
			ids: [id],
			embeddings: [emb],
			metadatas: [
				{
					task_id: fix.task_id,
					agent_type: fix.agent_type || "unknown",
					error_type: fix.error_type || "unknown",
					error_summary: fix.error_summary || "",
					instruction: fix.instruction || "",
					prompt: fix.prompt || null,
					diff: fix.diff || null,
					logs: fix.logs || null,
					result: fix.result || "",
					files_changed: JSON.stringify(fix.files_changed || []),
					test_commands: JSON.stringify(fix.test_commands || []),
					test_passed: fix.test_passed !== undefined ? String(fix.test_passed) : null,
				},
			],
		})

		return { id, success: result !== null }
	}

	async searchSimilar(query, options = {}) {
		const limit = options.limit || 5

		const emb = await this._getEmbedding(query)
		if (!emb) return []

		const collectionId = this._getCollectionId(COLLECTION_BUGS)
		const result = await this._request("POST", `/collections/${collectionId}/query`, {
			query_embeddings: [emb],
			n_results: limit,
			include: ["metadatas", "distances"],
		})

		if (!result?.ids?.[0]) return []

		const ids = result.ids[0]
		const distances = result.distances?.[0] || []
		const metadatas = result.metadatas?.[0] || []

		return ids.map((id, i) => {
			const meta = metadatas[i] || {}
			// Chroma returns distances (0 = identical), convert to similarity (1 = identical)
			const similarity = distances[i] !== undefined ? Math.max(0, 1 - distances[i]) : 0
			return {
				id,
				error_type: meta.error_type || "unknown",
				error_summary: meta.error_summary || "",
				result: meta.result || "",
				diff: meta.diff || null,
				similarity,
			}
		})
	}

	async updateTestStatus(taskId, passed) {
		const collectionId = this._getCollectionId(COLLECTION_BUGS)
		const result = await this._request("POST", `/collections/${collectionId}/update`, {
			ids: [taskId],
			metadatas: [{ test_passed: String(passed) }],
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

		const collectionId = this._getCollectionId(COLLECTION_LESSONS)
		const result = await this._request("POST", `/collections/${collectionId}/add`, {
			ids: [id],
			embeddings: [emb],
			metadatas: [
				{
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
				},
			],
		})

		return { id, success: result !== null }
	}

	async searchLessons(query, options = {}) {
		const limit = options.limit || 5

		const emb = await this._getEmbedding(query)
		if (!emb) return []

		const collectionId = this._getCollectionId(COLLECTION_LESSONS)
		const result = await this._request("POST", `/collections/${collectionId}/query`, {
			query_embeddings: [emb],
			n_results: limit,
			include: ["metadatas", "distances"],
		})

		if (!result?.ids?.[0]) return []

		const ids = result.ids[0]
		const distances = result.distances?.[0] || []
		const metadatas = result.metadatas?.[0] || []

		return ids.map((id, i) => {
			const meta = metadatas[i] || {}
			const similarity = distances[i] !== undefined ? Math.max(0, 1 - distances[i]) : 0
			return {
				id,
				lesson_type: meta.lesson_type || "best_practice",
				topic: meta.topic || "",
				content: meta.content || "",
				similarity,
			}
		})
	}

	async getLessonCountByProject() {
		// Chroma doesn't have a simple GROUP BY — get collection size
		const collectionId = this._getCollectionId(COLLECTION_LESSONS)
		const result = await this._request("GET", `/collections/${collectionId}`)
		return { superroo2: result?.count || 0 }
	}

	// ─── Stats & Health ────────────────────────────────────────────────────

	async getStats() {
		const bugsCol = await this._request("GET", `/collections/${this._getCollectionId(COLLECTION_BUGS)}`)
		const lessonsCol = await this._request("GET", `/collections/${this._getCollectionId(COLLECTION_LESSONS)}`)

		return {
			totalBugFixes: bugsCol?.count || 0,
			totalLessons: lessonsCol?.count || 0,
			errorTypes: 0,
			testsPassed: 0,
			testsFailed: 0,
			untested: 0,
			latestEntry: null,
		}
	}

	async healthCheck() {
		const heartbeat = await this._request("GET", "/heartbeat")
		return {
			healthy: heartbeat !== null,
			chroma: heartbeat !== null,
			ollama: this.embeddingService ? await this.embeddingService.healthCheck() : false,
		}
	}
}

module.exports = { ChromaAdapter }
