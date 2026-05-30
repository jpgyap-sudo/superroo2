#!/usr/bin/env node
/**
 * Ollama MCP Server
 *
 * Model Context Protocol server that exposes VPS Ollama capabilities
 * as MCP tools. Claude Code can call these tools to generate embeddings,
 * chat with local models, and check model status.
 *
 * IMPORTANT: Summarization is now handled by DeepSeek API, not Ollama.
 * The ollama_summarize tool is kept for backward compatibility but is
 * deprecated — use build-agent-context.mjs (DeepSeek) for context
 * compression and ollama-summarize-lesson.mjs (DeepSeek + Ollama) for
 * lesson summarization.
 *
 * Protocol: JSON-RPC 2.0 over stdio (standard MCP transport)
 *
 * Tools:
 *   - ollama_embed(text)
 *     Generate embeddings using nomic-embed-text (primary use case)
 *
 *   - ollama_chat(message, model?, system?)
 *     Chat with an Ollama model (qwen2.5:0.5b)
 *
 *   - ollama_list_models()
 *     List available models on the VPS Ollama instance
 *
 *   - ollama_status()
 *     Check if Ollama is reachable and healthy
 *
 *   - ollama_summarize(text, model?) [DEPRECATED]
 *     Summarize text using Ollama (low quality with 0.5B model)
 *     Use DeepSeek API instead.
 *
 * Usage:
 *   node scripts/ollama-mcp.mjs
 *
 * Environment:
 *   OLLAMA_URL       (optional) — Ollama API URL (default: http://100.64.175.88:11434)
 *   OLLAMA_MODEL     (optional) — Default model (default: qwen2.5:0.5b)
 *   OLLAMA_EMBED_MODEL (optional) — Embedding model (default: nomic-embed-text)
 *
 * NOTE: Uses curl.exe via .cmd helper for Ollama API calls to avoid
 * Node.js fetch() hanging on Tailscale IPs (100.x.x.x) on Windows.
 * See scripts/ml/ollama-curl-helper.cmd for the helper.
 */

import fsSync from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { execSync } from "child_process"
import os from "os"
import readline from "readline"

// ── Configuration ─────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HELPER_SCRIPT = path.join(__dirname, "ml", "ollama-curl-helper.cmd")
const TMP_DIR = fsSync.mkdtempSync(path.join(os.tmpdir(), "sr-ollama-mcp-"))

const LOCAL_OLLAMA_URL = "http://127.0.0.1:11434"
const VPS_OLLAMA_URL = "http://100.64.175.88:11434"
// Prefer local Ollama; fall back to VPS via Tailscale if env var not set
const OLLAMA_URL = process.env.OLLAMA_URL || LOCAL_OLLAMA_URL
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:0.5b"
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text"
const OLLAMA_TIMEOUT_MS = parseInt(process.env.OLLAMA_TIMEOUT || "120000", 10)

// ── Logging ───────────────────────────────────────────────────────────────────

function log(msg) {
	console.error(`[ollama-mcp] ${msg}`)
}

// ── Ollama API Helpers ────────────────────────────────────────────────────────

/**
 * Call Ollama API via curl.exe helper (avoids Node.js fetch() hanging on Tailscale IPs on Windows).
 * @param {string} url - Full Ollama API URL
 * @param {object|null} body - JSON body for POST, or null for GET
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {object|null} Parsed JSON response, or null on failure
 */
function curlOllama(url, body, timeoutMs) {
	const outFile = path.join(TMP_DIR, `resp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.json`)
	try {
		if (body) {
			const bodyFile = path.join(TMP_DIR, `body_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.json`)
			fsSync.writeFileSync(bodyFile, JSON.stringify(body), "utf8")
			execSync(`"${HELPER_SCRIPT}" "${url}" "${outFile}" "${bodyFile}"`, {
				timeout: (timeoutMs || OLLAMA_TIMEOUT_MS) + 5000,
				stdio: ["pipe", "pipe", "ignore"],
				windowsHide: true,
			})
			try { fsSync.unlinkSync(bodyFile) } catch {}
		} else {
			execSync(`"${HELPER_SCRIPT}" "${url}" "${outFile}"`, {
				timeout: (timeoutMs || 10000) + 5000,
				stdio: ["pipe", "pipe", "ignore"],
				windowsHide: true,
			})
		}
		const raw = fsSync.readFileSync(outFile, "utf8")
		return JSON.parse(raw)
	} catch {
		return null
	} finally {
		try { fsSync.unlinkSync(outFile) } catch {}
	}
}

function getActiveUrl() {
	return process.env.OLLAMA_URL || OLLAMA_URL
}

function ollamaFetch(endpoint, body) {
	const url = `${getActiveUrl()}${endpoint}`
	const data = curlOllama(url, body, OLLAMA_TIMEOUT_MS)
	if (!data) {
		throw new Error(`Ollama API error: no response from ${url}`)
	}
	return data
}

function ollamaGet(endpoint) {
	const url = `${getActiveUrl()}${endpoint}`
	const data = curlOllama(url, null, 10000)
	if (!data) {
		throw new Error(`Ollama GET error: no response from ${url}`)
	}
	return data
}

// ── Tool Handlers ─────────────────────────────────────────────────────────────

/**
 * @deprecated Summarization is now handled by DeepSeek API.
 * Use build-agent-context.mjs (DeepSeek) for context compression
 * or ollama-summarize-lesson.mjs (DeepSeek + Ollama) for lesson summarization.
 * This function is kept for backward compatibility but produces low-quality results.
 */
function handleSummarize(text, model) {
	log("[DEPRECATED] ollama_summarize uses qwen2.5:0.5b — quality is poor. Use DeepSeek API instead.")
	if (!text || typeof text !== "string") {
		return { content: [{ type: "text", text: "Error: 'text' parameter is required" }] }
	}

	const useModel = model || DEFAULT_MODEL
	const prompt = `Summarize the following text in 2-3 concise sentences, focusing on the key takeaway:\n\n${text.slice(0, 4000)}`

	try {
		const data = ollamaFetch("/api/generate", {
			model: useModel,
			prompt,
			stream: false,
		})
		return {
			content: [{ type: "text", text: data.response?.trim() || "No summary generated" }],
		}
	} catch (error) {
		log(`summarize failed: ${error.message}`)
		return {
			content: [{ type: "text", text: `Error: ${error.message}` }],
			isError: true,
		}
	}
}

function handleEmbed(text) {
	if (!text || typeof text !== "string") {
		return { content: [{ type: "text", text: "Error: 'text' parameter is required" }] }
	}

	try {
		let data = ollamaFetch("/api/embed", {
			model: EMBED_MODEL,
			input: text.slice(0, 8000),
		})
		let embedding = data.embeddings?.[0] || data.embedding
		if (!embedding || !Array.isArray(embedding)) {
			data = ollamaFetch("/api/embeddings", {
				model: EMBED_MODEL,
				prompt: text.slice(0, 8000),
			})
			embedding = data.embedding
		}
		if (!embedding || !Array.isArray(embedding)) {
			return { content: [{ type: "text", text: "Error: no embedding returned" }] }
		}
		return {
			content: [
				{
					type: "text",
					text: JSON.stringify({
						dimensions: embedding.length,
						preview: embedding.slice(0, 5),
						model: EMBED_MODEL,
					}),
				},
			],
		}
	} catch (error) {
		log(`embed failed: ${error.message}`)
		return {
			content: [{ type: "text", text: `Error: ${error.message}` }],
			isError: true,
		}
	}
}

function handleChat(message, model, system) {
	if (!message || typeof message !== "string") {
		return { content: [{ type: "text", text: "Error: 'message' parameter is required" }] }
	}

	const useModel = model || DEFAULT_MODEL
	const messages = []
	if (system) {
		messages.push({ role: "system", content: system })
	}
	messages.push({ role: "user", content: message })

	try {
		const data = ollamaFetch("/api/chat", {
			model: useModel,
			messages,
			stream: false,
		})
		return {
			content: [{ type: "text", text: data.message?.content || "No response" }],
		}
	} catch (error) {
		log(`chat failed: ${error.message}`)
		return {
			content: [{ type: "text", text: `Error: ${error.message}` }],
			isError: true,
		}
	}
}

function handleListModels() {
	try {
		const data = ollamaGet("/api/tags")
		const models = (data.models || []).map((m) => ({
			name: m.name,
			size: m.size,
			parameter_size: m.details?.parameter_size || "unknown",
			quantization: m.details?.quantization_level || "unknown",
			modified: m.modified_at,
		}))
		return {
			content: [
				{
					type: "text",
					text:
						models.length === 0
							? "No models available on VPS Ollama"
							: `Available models (${models.length}):\n\n${models
									.map(
										(m) =>
											`- **${m.name}** (${m.parameter_size}, ${m.quantization}, ${(m.size / 1e9).toFixed(1)}GB)`,
									)
									.join("\n")}`,
				},
			],
		}
	} catch (error) {
		log(`list models failed: ${error.message}`)
		return {
			content: [{ type: "text", text: `Error: ${error.message}` }],
			isError: true,
		}
	}
}

function handleStatus() {
	try {
		const start = Date.now()
		const data = ollamaGet("/api/tags")
		let version = "unknown"
		try {
			version = ollamaGet("/api/version")?.version || version
		} catch {}
		const elapsed = Date.now() - start
		const modelCount = (data.models || []).length
		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(
						{
							status: "healthy",
							url: OLLAMA_URL,
							version,
							latency_ms: elapsed,
							models_available: modelCount,
							model_list: (data.models || []).map((m) => m.name),
							default_model: DEFAULT_MODEL,
							embed_model: EMBED_MODEL,
						},
						null,
						2,
					),
				},
			],
		}
	} catch (error) {
		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(
						{
							status: "unreachable",
							url: OLLAMA_URL,
							error: error.message,
						},
						null,
						2,
					),
				},
			],
			isError: true,
		}
	}
}

// ── MCP Protocol ──────────────────────────────────────────────────────────────

const TOOLS = [
	{
		name: "ollama_summarize",
		description:
			"[DEPRECATED] Summarize text using Ollama (qwen2.5:0.5b) — quality is poor. Use DeepSeek API instead: run build-agent-context.mjs for context compression or ollama-summarize-lesson.mjs for lesson summarization. Kept for backward compatibility only.",
		inputSchema: {
			type: "object",
			properties: {
				text: {
					type: "string",
					description: "The text to summarize (DEPRECATED — use DeepSeek API instead)",
				},
				model: {
					type: "string",
					description: `Ollama model to use (default: ${DEFAULT_MODEL}) — DEPRECATED`,
				},
			},
			required: ["text"],
		},
	},
	{
		name: "ollama_embed",
		description:
			"Generate text embeddings using Ollama (nomic-embed-text). Use this for semantic search, similarity comparison, or RAG pipelines.",
		inputSchema: {
			type: "object",
			properties: {
				text: {
					type: "string",
					description: "The text to generate embeddings for",
				},
			},
			required: ["text"],
		},
	},
	{
		name: "ollama_chat",
		description:
			"Chat with an Ollama model on the VPS. Use this for quick questions, code explanations, or any task that benefits from a local model.",
		inputSchema: {
			type: "object",
			properties: {
				message: {
					type: "string",
					description: "The message to send to the model",
				},
				model: {
					type: "string",
					description: `Ollama model to use (default: ${DEFAULT_MODEL})`,
				},
				system: {
					type: "string",
					description: "Optional system prompt to guide model behavior",
				},
			},
			required: ["message"],
		},
	},
	{
		name: "ollama_list_models",
		description: "List all available models on the VPS Ollama instance.",
		inputSchema: {
			type: "object",
			properties: {},
			required: [],
		},
	},
	{
		name: "ollama_status",
		description:
			"Check if the VPS Ollama instance is reachable and healthy. Returns latency, model count, and configuration.",
		inputSchema: {
			type: "object",
			properties: {},
			required: [],
		},
	},
]

function handleToolCall(name, args) {
	switch (name) {
		case "ollama_summarize":
			return handleSummarize(args.text, args.model)
		case "ollama_embed":
			return handleEmbed(args.text)
		case "ollama_chat":
			return handleChat(args.message, args.model, args.system)
		case "ollama_list_models":
			return handleListModels()
		case "ollama_status":
			return handleStatus()
		default:
			return {
				content: [{ type: "text", text: `Unknown tool: ${name}` }],
				isError: true,
			}
	}
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
	log(`Starting MCP server: ollama-mcp v1.0.0`)
	log(`Ollama URL: ${OLLAMA_URL}`)
	log(`Default model: ${DEFAULT_MODEL}`)
	log(`Embed model: ${EMBED_MODEL}`)

	// Quick health check on startup — try local first, fall back to VPS
	const urlsToTry = [
		{ url: LOCAL_OLLAMA_URL, name: "local" },
		{ url: VPS_OLLAMA_URL, name: "VPS (100.64.175.88)" },
	]
	if (process.env.OLLAMA_URL) urlsToTry.unshift({ url: process.env.OLLAMA_URL, name: "env" })

	let connected = false
	for (const { url, name } of urlsToTry) {
		try {
			const data = curlOllama(`${url}/api/tags`, null, 4000)
			if (data && data.models) {
				if (url !== OLLAMA_URL) {
					process.env.OLLAMA_URL = url
					log(`Using ${name} Ollama at ${url}`)
				}
				const models = (data.models || []).map((m) => m.name)
				log(`Connected (${name}) — models: ${models.join(", ") || "none"}`)
				connected = true
				break
			}
		} catch {}
	}
	if (!connected) {
		log(`⚠️  Ollama not reachable (local or VPS) — tools will return errors until connection is restored.`)
	}

	// Read JSON-RPC requests from stdin
	const reader = readline.createInterface({ input: process.stdin })
	reader.on("line", (line) => {
		let request
		try {
			request = JSON.parse(line)
		} catch {
			return
		}

		const { id, method, params } = request

		if (method === "tools/list") {
			console.log(JSON.stringify({ jsonrpc: "2.0", id, result: { tools: TOOLS } }))
		} else if (method === "tools/call") {
			const result = handleToolCall(params.name, params.arguments || {})
			console.log(JSON.stringify({ jsonrpc: "2.0", id, ...result }))
		} else if (method === "initialize") {
			console.log(
				JSON.stringify({
					jsonrpc: "2.0",
					id,
					result: {
						protocolVersion: "2024-11-05",
						capabilities: { tools: {} },
						serverInfo: { name: "ollama-mcp", version: "1.0.0" },
					},
				}),
			)
		} else if (method === "notifications/initialized") {
			// no response needed
		} else {
			console.log(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } }))
		}
	})

	reader.on("close", () => {
		log("stdin closed, shutting down")
	})
}

main()
