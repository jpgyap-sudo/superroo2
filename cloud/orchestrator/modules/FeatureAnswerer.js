/**
 * SuperRoo Cloud — Feature Answerer
 *
 * Answers questions about SuperRoo's product features using:
 *   1. FeatureKnowledgeIndexer — retrieves relevant doc chunks from SQLite FTS5
 *   2. Ollama chat — generates a grounded answer from retrieved context
 *
 * Routing rule (from ollama-prompts.md):
 *   "memory retrieval -> Ollama + pgvector later"
 *   "feature questions -> Ollama (grounded on indexed docs)"
 *
 * Flow:
 *   question -> FTS5 search -> top-K chunks -> Ollama chat -> Telegram reply
 *
 * Fallback: if Ollama is unavailable, returns raw doc snippets directly.
 */

const http = require("http")
const { FeatureKnowledgeIndexer } = require("./FeatureKnowledgeIndexer")

// ── Config ──────────────────────────────────────────────────────────────────
// Canonical env vars: OLLAMA_BASE_URL, OLLAMA_MODEL
// Legacy fallbacks: OLLAMA_FEATURE_MODEL, OLLAMA_CHAT_MODEL

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || process.env.OLLAMA_HOST || "http://127.0.0.1:11434"
const OLLAMA_MODEL =
	process.env.OLLAMA_MODEL || process.env.OLLAMA_FEATURE_MODEL || process.env.OLLAMA_CHAT_MODEL || "qwen2.5:0.5b"
const OLLAMA_TIMEOUT_MS = parseInt(process.env.OLLAMA_TIMEOUT_MS || "30000", 10)

// Max chars to include per chunk in the Ollama context window
const CHUNK_CONTEXT_CHARS = 400
// Number of chunks to retrieve
const RETRIEVAL_LIMIT = 6

const SYSTEM_PROMPT =
	"You are SuperRoo's product feature expert.\n" +
	"You answer questions about SuperRoo's features, architecture, agents, and capabilities.\n" +
	"Answer ONLY based on the provided context. Do not hallucinate or invent features.\n" +
	"If the context doesn't fully cover the question, say what you know and note the gap.\n" +
	"Format for Telegram markdown: use bullet points, bold key terms, max 800 characters."

// ═══════════════════════════════════════════════════════════════════════════════
// FeatureAnswerer
// ═══════════════════════════════════════════════════════════════════════════════

class FeatureAnswerer {
	/**
	 * @param {object} [opts]
	 * @param {FeatureKnowledgeIndexer} [opts.indexer]  - Provide a pre-built indexer
	 * @param {string} [opts.dbPath]                    - Override SQLite path
	 * @param {string} [opts.projectRoot]               - Override project root
	 * @param {string} [opts.ollamaBaseUrl]             - Override Ollama URL
	 * @param {string} [opts.model]                     - Override Ollama model
	 */
	constructor(opts = {}) {
		this.indexer = opts.indexer || new FeatureKnowledgeIndexer(opts)
		this.ollamaBaseUrl = opts.ollamaBaseUrl || OLLAMA_BASE_URL
		this.model = opts.model || OLLAMA_MODEL
		this._indexed = false
	}

	/**
	 * Ensure the knowledge index is ready.
	 * Runs indexAll() on first call if the DB is empty.
	 */
	ensureIndexed() {
		if (this._indexed) return
		try {
			this.indexer.init()
			const stats = this.indexer.getStats()
			if (stats.chunks === 0) {
				console.log("[FeatureAnswerer] Empty index — running indexAll()")
				this.indexer.indexAll()
			} else {
				console.log(`[FeatureAnswerer] Index ready: ${stats.chunks} chunks from ${stats.files} files`)
			}
			this._indexed = true
		} catch (err) {
			console.error("[FeatureAnswerer] Index init failed:", err.message)
		}
	}

	/**
	 * Re-index all feature docs. Call after docs are updated.
	 * @returns {number} Number of chunks indexed
	 */
	reindex() {
		this.indexer.init()
		const count = this.indexer.indexAll()
		this._indexed = true
		return count
	}

	/**
	 * Answer a product feature question using Ollama + indexed docs.
	 *
	 * @param {string} question
	 * @returns {Promise<string>} Telegram-formatted answer
	 */
	async answer(question) {
		this.ensureIndexed()

		const chunks = this.indexer.search(question, RETRIEVAL_LIMIT)

		if (chunks.length === 0) {
			return (
				"🤖 *SuperRoo Feature Knowledge*\n\n" +
				"No matching docs found for that question.\n\n" +
				"Try asking about:\n" +
				"• Safety Mode & autonomous operation\n" +
				"• Ollama integration & log summarizer\n" +
				"• Agent workflow (Codex → DeepSeek → Ollama)\n" +
				"• Central Brain & memory system\n" +
				"• Telegram commands & NLP routing\n" +
				"• Cloud orchestrator & worker pipeline"
			)
		}

		// Build context string for Ollama
		const context = chunks
			.map((c, i) => `[${i + 1}] ${c.section} (${c.source_file})\n${c.chunk_text.slice(0, CHUNK_CONTEXT_CHARS)}`)
			.join("\n\n---\n\n")

		const userPrompt =
			`Context from SuperRoo product docs:\n\n${context}\n\n` +
			`---\n\nQuestion: ${question}\n\nAnswer concisely for Telegram:`

		// Try Ollama first
		try {
			const response = await this._ollamaChat(SYSTEM_PROMPT, userPrompt)
			if (response && response.trim().length > 0) {
				return "🤖 *SuperRoo Feature Info*\n\n" + response.trim()
			}
		} catch (err) {
			console.error("[FeatureAnswerer] Ollama error:", err.message)
		}

		// Ollama unavailable — return raw doc snippets
		const snippet = chunks
			.slice(0, 3)
			.map((c) => `📄 *${c.section}*\n${c.chunk_text.slice(0, 250).replace(/\n+/g, " ")}...`)
			.join("\n\n")

		return "📚 *SuperRoo Feature Docs*\n\n" + snippet
	}

	/**
	 * Get index health info for diagnostic purposes.
	 * @returns {{ chunks: number, files: number, indexed: boolean, model: string }}
	 */
	getStatus() {
		try {
			this.indexer.init()
			const stats = this.indexer.getStats()
			return { ...stats, model: this.model, ollamaUrl: this.ollamaBaseUrl }
		} catch (err) {
			return { chunks: 0, files: 0, indexed: false, model: this.model, error: err.message }
		}
	}

	// ── Private ──────────────────────────────────────────────────────────────

	/**
	 * Call Ollama chat API using http.request.
	 * Uses http instead of fetch to avoid Node.js 20 undici headersTimeout on cold start.
	 *
	 * @param {string} systemPrompt
	 * @param {string} userPrompt
	 * @returns {Promise<string|null>}
	 */
	async _ollamaChat(systemPrompt, userPrompt) {
		const postData = JSON.stringify({
			model: this.model,
			messages: [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: userPrompt },
			],
			stream: false,
			options: { temperature: 0.2, num_predict: 512 },
		})

		return new Promise((resolve) => {
			const req = http.request(
				`${this.ollamaBaseUrl}/api/chat`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"Content-Length": Buffer.byteLength(postData),
					},
					timeout: OLLAMA_TIMEOUT_MS,
				},
				(res) => {
					let body = ""
					res.on("data", (chunk) => (body += chunk))
					res.on("end", () => {
						try {
							const data = JSON.parse(body)
							resolve(data.message?.content || data.response || null)
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
	}
}

// ── Singleton ─────────────────────────────────────────────────────────────────
// Shared instance so the index is only initialized once per process.
let _instance = null

/**
 * Get the shared FeatureAnswerer singleton.
 * @returns {FeatureAnswerer}
 */
function getFeatureAnswerer() {
	if (!_instance) {
		_instance = new FeatureAnswerer()
	}
	return _instance
}

module.exports = { FeatureAnswerer, getFeatureAnswerer }
