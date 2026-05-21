/**
 * SuperRoo Cloud — BugKnowledgeStore
 *
 * PostgreSQL + pgvector-backed knowledge store for the Ollama RAG Learning Loop.
 *
 * This module is the "Central Brain" — it stores every bug fix from DeepSeek/OpenAI
 * as vector embeddings, enabling Ollama to retrieve similar past fixes via RAG.
 *
 * === REFACTORED for pluggable vector DB backends ===
 *
 * BugKnowledgeStore now delegates all vector storage operations to a
 * VectorStoreAdapter. By default it uses PgVectorAdapter (PostgreSQL + pgvector),
 * but you can switch to any adapter via the VECTOR_STORE_TYPE env var:
 *
 *   VECTOR_STORE_TYPE=pgvector   — PostgreSQL + pgvector (default, production)
 *   VECTOR_STORE_TYPE=memory     — In-memory (testing/dev, no persistence)
 *   VECTOR_STORE_TYPE=qdrant     — Qdrant vector database
 *   VECTOR_STORE_TYPE=pinecone   — Pinecone managed vector database
 *   VECTOR_STORE_TYPE=chroma     — Chroma open-source embedding database
 *
 * Backward-compatible: all existing callers continue to work unchanged.
 *
 * Key features:
 *   - Vector similarity search via pluggable backend
 *   - Hybrid search (vector + full-text keyword) — pgvector only
 *   - Automatic embedding generation via Ollama's nomic-embed-text model
 *   - Lesson extraction and storage for reusable patterns
 *   - Stats and health monitoring
 *
 * Embedding model: nomic-embed-text (768 dimensions) via Ollama
 */

const { createAdapter } = require("./adapters")
const { EmbeddingService } = require("./EmbeddingService")

// ═══════════════════════════════════════════════════════════════════════════════
// BugKnowledgeStore
// ═══════════════════════════════════════════════════════════════════════════════

class BugKnowledgeStore {
	/**
	 * @param {object} [options]
	 * @param {object} [options.dbConfig] - PostgreSQL connection config overrides (pgvector only)
	 * @param {string} [options.ollamaBaseUrl] - Ollama API base URL
	 * @param {string} [options.adapterType] - Vector store adapter type (default: VECTOR_STORE_TYPE env or "pgvector")
	 * @param {import('./adapters/VectorStoreAdapter').VectorStoreAdapter} [options.adapter] - Pre-configured adapter instance
	 */
	constructor(options = {}) {
		// Create shared embedding service
		this.embeddingService = new EmbeddingService({
			ollamaBaseUrl: options.ollamaBaseUrl,
		})

		// Create or use provided adapter
		if (options.adapter) {
			/** @type {import('./adapters/VectorStoreAdapter').VectorStoreAdapter} */
			this.adapter = options.adapter
		} else {
			this.adapter = createAdapter({
				type: options.adapterType,
				embeddingService: this.embeddingService,
				config: {
					dbConfig: options.dbConfig,
					ollamaBaseUrl: options.ollamaBaseUrl,
				},
			})
		}

		this._initialized = false
	}

	/**
	 * Initialize the adapter connection.
	 * Must be called before any other method.
	 */
	async init() {
		if (this._initialized) return
		await this.adapter.init()
		this._initialized = true
	}

	/**
	 * Close the adapter connection.
	 */
	async close() {
		if (this.adapter) {
			await this.adapter.close()
		}
		this._initialized = false
	}

	// ── Embedding Generation ───────────────────────────────────────────────

	/**
	 * Generate an embedding vector for text using Ollama.
	 * Delegates to the shared EmbeddingService.
	 *
	 * @param {string} text - The text to embed
	 * @returns {Promise<number[]|null>} - 768-dimension embedding array, or null on failure
	 */
	async _generateEmbedding(text) {
		return this.embeddingService.generate(text)
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
		return this.adapter.storeBugFix(fix)
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
		return this.adapter.searchSimilar(query, options)
	}

	/**
	 * Store an extracted lesson in the knowledge base.
	 *
	 * @param {object} lesson
	 * @param {string} lesson.lesson_type - 'pattern', 'fix', 'best_practice', 'anti_pattern'
	 * @param {string} lesson.topic - Lesson topic
	 * @param {string} lesson.content - Lesson content
	 * @param {string} [lesson.source_task_id] - Source task ID
	 * @param {string} [lesson.project] - Project name for cross-project learning
	 * @param {object} [lesson.metadata] - Additional metadata
	 * @returns {Promise<{id: string, success: boolean}>}
	 */
	async storeLesson(lesson) {
		return this.adapter.storeLesson(lesson)
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
		return this.adapter.searchLessons(query, options)
	}

	/**
	 * Build a RAG context string from similar bug fixes for injection into LLM prompts.
	 *
	 * @param {string} query - The problem description or error message
	 * @param {object} [options]
	 * @param {number} [options.maxResults=3] - Max similar fixes to include
	 * @param {number} [options.threshold=0.6] - Similarity threshold
	 * @returns {Promise<string>} - Formatted context string for prompt injection
	 */
	async buildRagContext(query, options = {}) {
		return this.adapter.buildRagContext(query, options)
	}

	/**
	 * Update the test_passed status for a bug fix.
	 *
	 * @param {string} taskId
	 * @param {boolean} passed
	 * @returns {Promise<boolean>}
	 */
	async updateTestStatus(taskId, passed) {
		return this.adapter.updateTestStatus(taskId, passed)
	}

	/**
	 * Get knowledge base statistics.
	 *
	 * @returns {Promise<object>}
	 */
	async getStats() {
		return this.adapter.getStats()
	}

	/**
	 * Get lesson counts grouped by project.
	 *
	 * @returns {Promise<Object<string, number>>} Map of project name -> lesson count
	 */
	async getLessonCountByProject() {
		return this.adapter.getLessonCountByProject()
	}

	/**
	 * Check if the knowledge store is healthy.
	 *
	 * @returns {Promise<{healthy: boolean, [key: string]: any}>}
	 */
	async healthCheck() {
		return this.adapter.healthCheck()
	}
}

module.exports = { BugKnowledgeStore }
