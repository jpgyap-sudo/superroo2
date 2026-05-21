/**
 * EmbeddingService — Generates vector embeddings from text using Ollama.
 *
 * Extracted from BugKnowledgeStore._generateEmbedding() so that all
 * VectorStoreAdapter implementations can share the same embedding logic.
 *
 * Supports two Ollama embedding API formats:
 *   - Modern: POST /api/embed (model + input)
 *   - Legacy: POST /api/embeddings (model + prompt)
 *
 * Embedding model: nomic-embed-text (768 dimensions) via Ollama
 */

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434"
const EMBEDDING_MODEL = process.env.OLLAMA_EMBEDDING_MODEL || "nomic-embed-text"
const EMBEDDING_DIMS = 768

class EmbeddingService {
	/**
	 * @param {object} [options]
	 * @param {string} [options.ollamaBaseUrl]
	 * @param {string} [options.model]
	 * @param {number} [options.dimensions]
	 */
	constructor(options = {}) {
		this.ollamaBaseUrl = options.ollamaBaseUrl || OLLAMA_BASE_URL
		this.model = options.model || EMBEDDING_MODEL
		this.dimensions = options.dimensions || EMBEDDING_DIMS
	}

	/**
	 * Generate an embedding vector for text using Ollama.
	 * Tries the modern /api/embed endpoint first, falls back to legacy /api/embeddings.
	 *
	 * @param {string} text - The text to embed
	 * @returns {Promise<number[]|null>} - Embedding array, or null on failure
	 */
	async generate(text) {
		if (!text || text.trim().length === 0) return null

		try {
			const http = require("http")

			const requestJson = (path, payload) =>
				new Promise((resolve) => {
					const postData = JSON.stringify(payload)
					const req = http.request(
						`${this.ollamaBaseUrl}${path}`,
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
									if (res.statusCode >= 400) {
										resolve(null)
										return
									}
									resolve(data)
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

			// Try modern /api/embed first
			const modern = await requestJson("/api/embed", {
				model: this.model,
				input: text.slice(0, 8000),
			})
			const modernEmbedding = Array.isArray(modern?.embeddings?.[0])
				? modern.embeddings[0]
				: Array.isArray(modern?.embedding)
					? modern.embedding
					: null
			if (modernEmbedding) {
				return modernEmbedding
			}

			// Fall back to legacy /api/embeddings
			const postData = JSON.stringify({
				model: this.model,
				prompt: text.slice(0, 8000),
			})
			const embedding = await new Promise((resolve) => {
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
			console.warn(`[EmbeddingService] Ollama embedding error: ${err.message}`)
			return null
		}
	}

	/**
	 * Generate embeddings for multiple texts in batch.
	 * Falls back to sequential generation if batch API is unavailable.
	 *
	 * @param {string[]} texts
	 * @returns {Promise<(number[]|null)[]>}
	 */
	async generateBatch(texts) {
		if (!texts || texts.length === 0) return []

		// Try batch via modern /api/embed
		try {
			const http = require("http")
			const postData = JSON.stringify({
				model: this.model,
				input: texts.map((t) => (t || "").slice(0, 8000)),
			})
			const result = await new Promise((resolve) => {
				const req = http.request(
					`${this.ollamaBaseUrl}/api/embed`,
					{
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							"Content-Length": Buffer.byteLength(postData),
						},
						timeout: 60_000,
					},
					(res) => {
						let body = ""
						res.on("data", (chunk) => (body += chunk))
						res.on("end", () => {
							try {
								resolve(JSON.parse(body))
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
			if (Array.isArray(result?.embeddings)) {
				return result.embeddings
			}
		} catch {
			// Fall through to sequential
		}

		// Sequential fallback
		return Promise.all(texts.map((t) => this.generate(t)))
	}

	/**
	 * Check if Ollama is reachable.
	 * @returns {Promise<boolean>}
	 */
	async healthCheck() {
		try {
			const controller = new AbortController()
			const timeoutId = setTimeout(() => controller.abort(), 5000)
			const res = await fetch(`${this.ollamaBaseUrl}/api/tags`, { signal: controller.signal })
			clearTimeout(timeoutId)
			return res.ok
		} catch {
			return false
		}
	}
}

module.exports = { EmbeddingService, EMBEDDING_DIMS }
