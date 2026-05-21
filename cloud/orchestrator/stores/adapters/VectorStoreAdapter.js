/**
 * VectorStoreAdapter — Abstract base class for pluggable vector database backends.
 *
 * All concrete adapters (PgVectorAdapter, MemoryVectorAdapter, QdrantAdapter,
 * PineconeAdapter, ChromaAdapter) MUST extend this class and implement every method.
 *
 * The adapter interface is designed to support:
 *   - Bug fix storage and similarity search (for RAG in agent runners)
 *   - Lesson storage and similarity search (for Central Brain learning loop)
 *   - Hybrid search (vector + keyword) where the backend supports it
 *   - Health checks and stats
 *   - Cross-project lesson tracking
 *
 * Embedding generation is NOT part of the adapter — it's handled by the
 * separate EmbeddingService, which is injected into each adapter.
 *
 * @abstract
 */
class VectorStoreAdapter {
	/**
	 * @param {object} options
	 * @param {import('../EmbeddingService').EmbeddingService} options.embeddingService
	 * @param {object} [options.config] - Backend-specific configuration
	 */
	constructor(options = {}) {
		if (new.target === VectorStoreAdapter) {
			throw new Error("VectorStoreAdapter is abstract — extend it, don't instantiate it directly")
		}
		this.embeddingService = options.embeddingService || null
		this.config = options.config || {}
		this._initialized = false
		this._adapterName = "abstract"
	}

	/**
	 * Initialize the backend connection.
	 * Must be called before any other method.
	 * @returns {Promise<void>}
	 * @abstract
	 */
	async init() {
		throw new Error(`${this._adapterName}.init() not implemented`)
	}

	/**
	 * Close the backend connection gracefully.
	 * @returns {Promise<void>}
	 * @abstract
	 */
	async close() {
		throw new Error(`${this._adapterName}.close() not implemented`)
	}

	// ─── Bug Fix CRUD ───────────────────────────────────────────────────────

	/**
	 * Store a bug fix with its embedding.
	 * @param {object} fix
	 * @param {string} fix.task_id
	 * @param {string} fix.agent_type
	 * @param {string} [fix.error_summary]
	 * @param {string} fix.instruction
	 * @param {string} [fix.prompt]
	 * @param {string} [fix.diff]
	 * @param {string} [fix.logs]
	 * @param {string} fix.result
	 * @param {string[]} [fix.files_changed]
	 * @param {string[]} [fix.test_commands]
	 * @param {boolean} [fix.test_passed]
	 * @param {object} [fix.metadata]
	 * @param {number[]} [embedding] - Pre-computed embedding vector (optional; generated if omitted)
	 * @returns {Promise<{id: string, success: boolean}>}
	 * @abstract
	 */
	async storeBugFix(fix, embedding) {
		throw new Error(`${this._adapterName}.storeBugFix() not implemented`)
	}

	/**
	 * Search for similar bug fixes using vector similarity.
	 * @param {string} query - Natural language query
	 * @param {object} [options]
	 * @param {number} [options.limit=5]
	 * @param {number} [options.threshold=0.6]
	 * @param {boolean} [options.hybrid=false] - Use hybrid search (vector + keyword)
	 * @returns {Promise<Array<{id: string, error_type: string, error_summary: string, result: string, diff: string, similarity: number}>>}
	 * @abstract
	 */
	async searchSimilar(query, options = {}) {
		throw new Error(`${this._adapterName}.searchSimilar() not implemented`)
	}

	/**
	 * Update the test_passed status for a bug fix.
	 * @param {string} taskId
	 * @param {boolean} passed
	 * @returns {Promise<boolean>}
	 * @abstract
	 */
	async updateTestStatus(taskId, passed) {
		throw new Error(`${this._adapterName}.updateTestStatus() not implemented`)
	}

	// ─── Lesson CRUD ────────────────────────────────────────────────────────

	/**
	 * Store a lesson with its embedding.
	 * @param {object} lesson
	 * @param {string} lesson.lesson_type
	 * @param {string} lesson.topic
	 * @param {string} lesson.content
	 * @param {string} [lesson.source_task_id]
	 * @param {string} [lesson.project]
	 * @param {object} [lesson.metadata]
	 * @param {number[]} [embedding] - Pre-computed embedding vector (optional)
	 * @returns {Promise<{id: string, success: boolean}>}
	 * @abstract
	 */
	async storeLesson(lesson, embedding) {
		throw new Error(`${this._adapterName}.storeLesson() not implemented`)
	}

	/**
	 * Search for similar lessons using vector similarity.
	 * @param {string} query
	 * @param {object} [options]
	 * @param {number} [options.limit=5]
	 * @param {number} [options.threshold=0.6]
	 * @returns {Promise<Array<{id: string, lesson_type: string, topic: string, content: string, similarity: number}>>}
	 * @abstract
	 */
	async searchLessons(query, options = {}) {
		throw new Error(`${this._adapterName}.searchLessons() not implemented`)
	}

	/**
	 * Get lesson counts grouped by project.
	 * @returns {Promise<Object<string, number>>}
	 * @abstract
	 */
	async getLessonCountByProject() {
		throw new Error(`${this._adapterName}.getLessonCountByProject() not implemented`)
	}

	// ─── RAG Context ────────────────────────────────────────────────────────

	/**
	 * Build a RAG context string from similar bug fixes and lessons.
	 * Default implementation queries both searchSimilar and searchLessons.
	 * @param {string} query
	 * @param {object} [options]
	 * @param {number} [options.maxResults=3]
	 * @param {number} [options.threshold=0.6]
	 * @returns {Promise<string>}
	 */
	async buildRagContext(query, options = {}) {
		const maxResults = options.maxResults || 3
		const threshold = options.threshold !== undefined ? options.threshold : 0.6

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

	// ─── Stats & Health ─────────────────────────────────────────────────────

	/**
	 * Get knowledge base statistics.
	 * @returns {Promise<{totalBugFixes: number, totalLessons: number, [key: string]: any}>}
	 * @abstract
	 */
	async getStats() {
		throw new Error(`${this._adapterName}.getStats() not implemented`)
	}

	/**
	 * Check if the backend is healthy and reachable.
	 * @returns {Promise<{healthy: boolean, [key: string]: any}>}
	 * @abstract
	 */
	async healthCheck() {
		throw new Error(`${this._adapterName}.healthCheck() not implemented`)
	}
}

module.exports = { VectorStoreAdapter }
