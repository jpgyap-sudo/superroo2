/**
 * PineconeAdapter — Pinecone vector database backend for VectorStoreAdapter.
 *
 * Pinecone is a fully managed vector database service. This adapter communicates
 * via Pinecone's REST API (2024-04+ serverless index format).
 *
 * Configuration via environment variables:
 *   PINECONE_API_KEY= (required)
 *   PINECONE_INDEX_HOST=https://your-index-abc123.svc.aped-4627-b74a.pinecone.io (required)
 *   PINECONE_CLOUD=aws (default)
 *   PINECONE_REGION=us-east-1 (default)
 *
 * Namespaces:
 *   - bug_knowledge: stores bug fix vectors
 *   - ollama_lessons: stores lesson vectors
 *
 * Uses cosine similarity metric.
 */

const { VectorStoreAdapter } = require("./VectorStoreAdapter")

const DEFAULT_API_KEY = process.env.PINECONE_API_KEY || ""
const DEFAULT_INDEX_HOST = process.env.PINECONE_INDEX_HOST || ""
const VECTOR_SIZE = parseInt(process.env.EMBEDDING_DIMS || "768", 10)

class PineconeAdapter extends VectorStoreAdapter {
	/**
	 * @param {object} [options]
	 * @param {import('../EmbeddingService').EmbeddingService} [options.embeddingService]
	 * @param {string} [options.apiKey] - Pinecone API key
	 * @param {string} [options.indexHost] - Pinecone index host URL
	 * @param {number} [options.vectorSize] - Embedding dimension size
	 */
	constructor(options = {}) {
		super(options)
		this._adapterName = "PineconeAdapter"
		this.apiKey = options.apiKey || DEFAULT_API_KEY
		this.indexHost = options.indexHost || DEFAULT_INDEX_HOST
		this.vectorSize = options.vectorSize || VECTOR_SIZE
	}

	/**
	 * Make an HTTP request to the Pinecone index REST API.
	 * @param {string} method
	 * @param {string} path
	 * @param {object} [body]
	 * @returns {Promise<object|null>}
	 */
	async _request(method, path, body) {
		if (!this.apiKey || !this.indexHost) {
			console.warn("[PineconeAdapter] Missing PINECONE_API_KEY or PINECONE_INDEX_HOST")
			return null
		}

		const url = `${this.indexHost}${path}`
		try {
			const res = await fetch(url, {
				method,
				headers: {
					"Content-Type": "application/json",
					"Api-Key": this.apiKey,
				},
				body: body ? JSON.stringify(body) : undefined,
			})
			if (!res.ok) {
				const text = await res.text()
				console.warn(`[PineconeAdapter] HTTP ${res.status} on ${method} ${path}: ${text}`)
				return null
			}
			// DELETE returns 204 with no body
			if (res.status === 204) return { success: true }
			return await res.json()
		} catch (err) {
			console.warn(`[PineconeAdapter] Request failed: ${method} ${path} — ${err.message}`)
			return null
		}
	}

	// ─── Lifecycle ─────────────────────────────────────────────────────────

	async init() {
		if (this._initialized) return

		if (!this.apiKey) {
			console.warn("[PineconeAdapter] PINECONE_API_KEY not set — adapter will be non-functional")
		}
		if (!this.indexHost) {
			console.warn("[PineconeAdapter] PINECONE_INDEX_HOST not set — adapter will be non-functional")
		}

		this._initialized = true
		console.log(`[PineconeAdapter] Initialized for index host: ${this.indexHost || "(not set)"}`)
	}

	async close() {
		this._initialized = false
		console.log("[PineconeAdapter] Closed")
	}

	// ─── Embedding helper ──────────────────────────────────────────────────

	async _getEmbedding(text, precomputed) {
		if (precomputed) return precomputed
		if (this.embeddingService) {
			return this.embeddingService.generate(text)
		}
		return null
	}

	/**
	 * Build a Pinecone-compatible vector record.
	 * @param {string} id
	 * @param {number[]} vector
	 * @param {object} metadata
	 * @param {string} namespace
	 * @returns {object}
	 */
	_makeRecord(id, vector, metadata, namespace) {
		return {
			id,
			values: vector,
			metadata,
			namespace,
		}
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

		const result = await this._request("POST", "/vectors/upsert", {
			vectors: [
				this._makeRecord(
					id,
					emb,
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
						files_changed: (fix.files_changed || []).join(","),
						test_commands: (fix.test_commands || []).join(","),
						test_passed: fix.test_passed !== undefined ? String(fix.test_passed) : null,
					},
					"bug_knowledge",
				),
			],
		})

		return { id, success: result !== null }
	}

	async searchSimilar(query, options = {}) {
		const limit = options.limit || 5
		const threshold = options.threshold || 0.6

		const emb = await this._getEmbedding(query)
		if (!emb) return []

		const result = await this._request("POST", "/query", {
			vector: emb,
			topK: limit,
			includeMetadata: true,
			includeValues: false,
			namespace: "bug_knowledge",
		})

		if (!result?.matches) return []

		return result.matches
			.filter((m) => m.score >= threshold)
			.map((match) => ({
				id: match.id,
				error_type: match.metadata?.error_type || "unknown",
				error_summary: match.metadata?.error_summary || "",
				result: match.metadata?.result || "",
				diff: match.metadata?.diff || null,
				similarity: match.score || 0,
			}))
	}

	async updateTestStatus(taskId, passed) {
		// Pinecone doesn't support partial update of metadata directly via REST.
		// We'd need to fetch, modify, re-upsert. For simplicity, skip for now.
		console.warn(`[PineconeAdapter] updateTestStatus not directly supported — skipping`)
		return false
	}

	// ─── Lesson CRUD ───────────────────────────────────────────────────────

	async storeLesson(lesson, embedding) {
		const id = lesson.source_task_id || lesson.task_id || `lesson-${Date.now()}`
		const emb = await this._getEmbedding(`${lesson.topic || ""}\n${lesson.content || ""}`, embedding)
		if (!emb) {
			return { id: null, success: false, error: "Could not generate embedding" }
		}

		const result = await this._request("POST", "/vectors/upsert", {
			vectors: [
				this._makeRecord(
					id,
					emb,
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
					"ollama_lessons",
				),
			],
		})

		return { id, success: result !== null }
	}

	async searchLessons(query, options = {}) {
		const limit = options.limit || 5
		const threshold = options.threshold || 0.6

		const emb = await this._getEmbedding(query)
		if (!emb) return []

		const result = await this._request("POST", "/query", {
			vector: emb,
			topK: limit,
			includeMetadata: true,
			includeValues: false,
			namespace: "ollama_lessons",
		})

		if (!result?.matches) return []

		return result.matches
			.filter((m) => m.score >= threshold)
			.map((match) => ({
				id: match.id,
				lesson_type: match.metadata?.lesson_type || "best_practice",
				topic: match.metadata?.topic || "",
				content: match.metadata?.content || "",
				similarity: match.score || 0,
			}))
	}

	async getLessonCountByProject() {
		// Pinecone doesn't expose aggregate counts by metadata field via REST.
		// This would require a full scan + client-side aggregation.
		console.warn("[PineconeAdapter] getLessonCountByProject not supported via REST API")
		return {}
	}

	// ─── Stats & Health ────────────────────────────────────────────────────

	async getStats() {
		const stats = await this._request("GET", "/describe_index_stats")
		return {
			totalBugFixes: stats?.namespaces?.bug_knowledge?.vectorCount || 0,
			totalLessons: stats?.namespaces?.ollama_lessons?.vectorCount || 0,
			errorTypes: 0,
			testsPassed: 0,
			testsFailed: 0,
			untested: 0,
			latestEntry: null,
		}
	}

	async healthCheck() {
		const stats = await this._request("GET", "/describe_index_stats")
		return {
			healthy: stats !== null,
			pinecone: stats !== null,
			ollama: this.embeddingService ? await this.embeddingService.healthCheck() : false,
			dimension: stats?.dimension,
			totalVectorCount: stats?.totalVectorCount,
		}
	}
}

module.exports = { PineconeAdapter }
