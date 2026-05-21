/**
 * MemoryVectorAdapter — In-memory vector store adapter for testing and development.
 *
 * Stores all vectors and metadata in JavaScript Maps. Uses cosine similarity
 * for search. Does NOT persist data across restarts — ideal for unit tests
 * and local development without PostgreSQL.
 *
 * Features:
 *   - Full VectorStoreAdapter interface compliance
 *   - Cosine similarity search
 *   - No external dependencies
 *   - No persistence (data lost on restart)
 *   - Embedding generation via injected EmbeddingService (optional — falls back
 *     to simple keyword matching if no EmbeddingService is available)
 */

const { VectorStoreAdapter } = require("./VectorStoreAdapter")

/**
 * Compute cosine similarity between two vectors.
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number} 0..1
 */
function cosineSimilarity(a, b) {
	if (!a || !b || a.length !== b.length) return 0
	let dot = 0,
		normA = 0,
		normB = 0
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i]
		normA += a[i] * a[i]
		normB += b[i] * b[i]
	}
	const denom = Math.sqrt(normA) * Math.sqrt(normB)
	return denom === 0 ? 0 : dot / denom
}

/**
 * Simple keyword matching score for fallback when embeddings are unavailable.
 * @param {string} text
 * @param {string} query
 * @returns {number}
 */
function keywordScore(text, query) {
	if (!text || !query) return 0
	const words = query.toLowerCase().split(/\W+/).filter(Boolean)
	const lower = text.toLowerCase()
	return words.reduce((score, word) => score + (lower.includes(word) ? 1 : 0), 0) / Math.max(words.length, 1)
}

class MemoryVectorAdapter extends VectorStoreAdapter {
	constructor(options = {}) {
		super(options)
		this._adapterName = "MemoryVectorAdapter"

		/** @type {Map<string, {type: 'bug_fix', data: object, embedding: number[]|null}>} */
		this._bugFixes = new Map()

		/** @type {Map<string, {type: 'lesson', data: object, embedding: number[]|null}>} */
		this._lessons = new Map()

		this._initialized = false
	}

	async init() {
		if (this._initialized) return
		this._initialized = true
		console.log("[MemoryVectorAdapter] Initialized (in-memory, no persistence)")
	}

	async close() {
		this._bugFixes.clear()
		this._lessons.clear()
		this._initialized = false
		console.log("[MemoryVectorAdapter] Closed")
	}

	// ─── Bug Fix CRUD ──────────────────────────────────────────────────────

	async storeBugFix(fix, embedding) {
		if (!this._initialized) throw new Error("MemoryVectorAdapter not initialized")

		const id = fix.task_id || `fix-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
		let emb = embedding
		if (!emb && this.embeddingService) {
			const text = [fix.error_summary, fix.instruction, fix.result].filter(Boolean).join("\n")
			emb = await this.embeddingService.generate(text)
		}

		this._bugFixes.set(id, {
			type: "bug_fix",
			data: {
				...fix,
				id,
				error_type: fix.error_type || "unknown",
			},
			embedding: emb,
		})

		return { id, success: true }
	}

	async searchSimilar(query, options = {}) {
		if (!this._initialized) return []

		const limit = options.limit || 5
		const threshold = options.threshold !== undefined ? options.threshold : 0.6

		// Try vector search first
		let queryEmb = null
		if (this.embeddingService) {
			queryEmb = await this.embeddingService.generate(query)
		}

		const results = []
		for (const [id, entry] of this._bugFixes) {
			let sim = 0
			if (queryEmb && entry.embedding) {
				sim = cosineSimilarity(queryEmb, entry.embedding)
			} else {
				// Fallback to keyword
				const text = [entry.data.error_summary, entry.data.result, entry.data.instruction]
					.filter(Boolean)
					.join(" ")
				sim = keywordScore(text, query)
			}

			if (sim >= threshold) {
				results.push({
					id,
					error_type: entry.data.error_type || "unknown",
					error_summary: entry.data.error_summary || "",
					result: entry.data.result || "",
					diff: entry.data.diff || null,
					similarity: sim,
				})
			}
		}

		return results.sort((a, b) => b.similarity - a.similarity).slice(0, limit)
	}

	async updateTestStatus(taskId, passed) {
		const entry = this._bugFixes.get(taskId)
		if (!entry) return false
		entry.data.test_passed = passed
		return true
	}

	// ─── Lesson CRUD ───────────────────────────────────────────────────────

	async storeLesson(lesson, embedding) {
		if (!this._initialized) throw new Error("MemoryVectorAdapter not initialized")

		const id =
			lesson.source_task_id || lesson.task_id || `lesson-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
		let emb = embedding
		if (!emb && this.embeddingService) {
			const text = `${lesson.topic || ""}\n${lesson.content || ""}`
			emb = await this.embeddingService.generate(text)
		}

		this._lessons.set(id, {
			type: "lesson",
			data: {
				...lesson,
				id,
				lesson_type: lesson.lesson_type || lesson.type || "best_practice",
				project: lesson.project || "superroo2",
			},
			embedding: emb,
		})

		return { id, success: true }
	}

	async searchLessons(query, options = {}) {
		if (!this._initialized) return []

		const limit = options.limit || 5
		const threshold = options.threshold !== undefined ? options.threshold : 0.6

		let queryEmb = null
		if (this.embeddingService) {
			queryEmb = await this.embeddingService.generate(query)
		}

		const results = []
		for (const [id, entry] of this._lessons) {
			let sim = 0
			if (queryEmb && entry.embedding) {
				sim = cosineSimilarity(queryEmb, entry.embedding)
			} else {
				const text = [entry.data.topic, entry.data.content].filter(Boolean).join(" ")
				sim = keywordScore(text, query)
			}

			if (sim >= threshold) {
				results.push({
					id,
					lesson_type: entry.data.lesson_type,
					topic: entry.data.topic || "",
					content: entry.data.content || "",
					similarity: sim,
				})
			}
		}

		return results.sort((a, b) => b.similarity - a.similarity).slice(0, limit)
	}

	async getLessonCountByProject() {
		const counts = {}
		for (const [, entry] of this._lessons) {
			const project = entry.data.project || "unknown"
			counts[project] = (counts[project] || 0) + 1
		}
		return counts
	}

	// ─── Stats & Health ────────────────────────────────────────────────────

	async getStats() {
		return {
			totalBugFixes: this._bugFixes.size,
			totalLessons: this._lessons.size,
			errorTypes: new Set(Array.from(this._bugFixes.values()).map((e) => e.data.error_type)).size,
			testsPassed: Array.from(this._bugFixes.values()).filter((e) => e.data.test_passed === true).length,
			testsFailed: Array.from(this._bugFixes.values()).filter((e) => e.data.test_passed === false).length,
			untested: Array.from(this._bugFixes.values()).filter((e) => e.data.test_passed === undefined).length,
			latestEntry: null,
		}
	}

	async healthCheck() {
		return {
			healthy: this._initialized,
			memory: this._initialized,
			ollama: this.embeddingService ? await this.embeddingService.healthCheck() : false,
		}
	}
}

module.exports = { MemoryVectorAdapter }
