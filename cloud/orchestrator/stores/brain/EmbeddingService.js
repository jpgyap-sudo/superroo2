/**
 * EmbeddingService — Generates vector embeddings from text.
 *
 * Default provider: Ollama (nomic-embed-text, 768 dimensions)
 * Fallback provider: OpenAI (text-embedding-3-small, 1536 dimensions)
 *
 * Configurable via environment variables:
 *   EMBEDDING_PROVIDER=ollama|openai
 *   OLLAMA_BASE_URL=http://127.0.0.1:11434
 *   OLLAMA_EMBEDDING_MODEL=nomic-embed-text
 *   OPENAI_API_KEY=sk-...
 *   OPENAI_EMBEDDING_MODEL=text-embedding-3-small
 */

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434"
const OLLAMA_EMBEDDING_MODEL = process.env.OLLAMA_EMBEDDING_MODEL || "nomic-embed-text"
const OLLAMA_DIMS = 768
const OPENAI_EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small"
const OPENAI_DIMS = 1536

class EmbeddingService {
	/**
	 * @param {object} [options]
	 * @param {'ollama'|'openai'} [options.provider] - Embedding provider
	 * @param {string} [options.ollamaBaseUrl]
	 * @param {string} [options.ollamaModel]
	 * @param {string} [options.openaiApiKey]
	 * @param {string} [options.openaiModel]
	 */
	constructor(options = {}) {
		this.provider = options.provider || process.env.EMBEDDING_PROVIDER || "ollama"
		this.ollamaBaseUrl = options.ollamaBaseUrl || OLLAMA_BASE_URL
		this.ollamaModel = options.ollamaModel || OLLAMA_EMBEDDING_MODEL
		this.openaiApiKey = options.openaiApiKey || process.env.OPENAI_API_KEY || ""
		this.openaiModel = options.openaiModel || OPENAI_EMBEDDING_MODEL
		this.dimensions = this.provider === "openai" ? OPENAI_DIMS : OLLAMA_DIMS
	}

	/**
	 * Generate an embedding vector for text.
	 * Tries the configured provider first, falls back to the other provider.
	 *
	 * @param {string} text - The text to embed
	 * @returns {Promise<number[]|null>} - Embedding array, or null on total failure
	 */
	async generate(text) {
		if (!text || text.trim().length === 0) return null

		// Try primary provider
		const primary = await this._embedWithProvider(this.provider, text)
		if (primary) return primary

		// Try fallback provider
		const fallbackProvider = this.provider === "openai" ? "ollama" : "openai"
		console.warn(`[EmbeddingService] ${this.provider} failed, falling back to ${fallbackProvider}`)
		const fallback = await this._embedWithProvider(fallbackProvider, text)
		if (fallback) return fallback

		console.error("[EmbeddingService] All embedding providers failed")
		return null
	}

	/**
	 * Embed text with a specific provider.
	 * @param {'ollama'|'openai'} provider
	 * @param {string} text
	 * @returns {Promise<number[]|null>}
	 */
	async _embedWithProvider(provider, text) {
		try {
			if (provider === "ollama") {
				return await this._embedOllama(text)
			}
			if (provider === "openai") {
				return await this._embedOpenAI(text)
			}
		} catch (err) {
			console.warn(`[EmbeddingService] ${provider} embedding error:`, err.message)
			return null
		}
		return null
	}

	/**
	 * Embed using Ollama (nomic-embed-text, 768 dims).
	 * Tries modern /api/embed first, falls back to legacy /api/embeddings.
	 */
	async _embedOllama(text) {
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
			model: this.ollamaModel,
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
		const legacy = await requestJson("/api/embeddings", {
			model: this.ollamaModel,
			prompt: text.slice(0, 8000),
		})
		return Array.isArray(legacy?.embedding) ? legacy.embedding : null
	}

	/**
	 * Embed using OpenAI (text-embedding-3-small, 1536 dims).
	 */
	async _embedOpenAI(text) {
		if (!this.openaiApiKey) {
			throw new Error("OPENAI_API_KEY is required for OpenAI embeddings")
		}

		const https = require("https")

		return new Promise((resolve, reject) => {
			const payload = JSON.stringify({
				model: this.openaiModel,
				input: text.slice(0, 8000),
			})

			const req = https.request(
				"https://api.openai.com/v1/embeddings",
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${this.openaiApiKey}`,
						"Content-Length": Buffer.byteLength(payload),
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
								reject(new Error(`OpenAI API error ${res.statusCode}: ${body}`))
								return
							}
							resolve(data.data[0].embedding)
						} catch (err) {
							reject(err)
						}
					})
				},
			)
			req.on("error", reject)
			req.on("timeout", () => {
				req.destroy()
				reject(new Error("OpenAI embedding request timed out"))
			})
			req.write(payload)
			req.end()
		})
	}

	/**
	 * Format a vector array for pgvector insertion.
	 * @param {number[]} vector
	 * @returns {string}
	 */
	toPgVector(vector) {
		return `[${vector.join(",")}]`
	}
}

module.exports = { EmbeddingService }
