#!/usr/bin/env node
/**
 * MCP Codex Bridge — CLI wrapper for Codex VS Code extension
 *
 * Codex doesn't have native MCP support like Claude Code. This bridge
 * lets Codex invoke the same DeepSeek and Ollama MCP tools via CLI args,
 * following the updated SuperRoo agent routing workflow:
 *
 *   Codex (plan/review) → DeepSeek (code + summarize) → Ollama (embeddings only)
 *
 * Usage:
 *   node scripts/mcp-codex-bridge.mjs deepseek <tool> [args...]
 *   node scripts/mcp-codex-bridge.mjs ollama <tool> [args...]
 *
 * Examples:
 *   # DeepSeek tools
 *   node scripts/mcp-codex-bridge.mjs deepseek code "Write a function to..." --system "You are an expert"
 *   node scripts/mcp-codex-bridge.mjs deepseek review "const x = 1;" --context "Check for bugs"
 *   node scripts/mcp-codex-bridge.mjs deepseek refactor "function old() {}" --instructions "Use arrow functions"
 *   node scripts/mcp-codex-bridge.mjs deepseek explain "async function fetchData() {}"
 *   node scripts/mcp-codex-bridge.mjs deepseek status
 *
 *   # Ollama tools (embeddings and chat only — summarization is now DeepSeek API)
 *   node scripts/mcp-codex-bridge.mjs ollama embed "Text to embed"
 *   node scripts/mcp-codex-bridge.mjs ollama chat "Hello, how are you?"
 *   node scripts/mcp-codex-bridge.mjs ollama list-models
 *   node scripts/mcp-codex-bridge.mjs ollama status
 *
 * Environment:
 *   DEEPSEEK_API_KEY  (required for deepseek tools) — DeepSeek API key
 *   DEEPSEEK_MODEL    (optional) — Model name (default: deepseek-v4-flash)
 *   OLLAMA_URL        (optional) — Ollama endpoint (default: http://100.64.175.88:11434)
 */

import { fileURLToPath } from "node:url"
import path from "node:path"
import fs from "node:fs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, "..")

function loadEnvFile(filePath = path.join(ROOT, ".env")) {
	if (!fs.existsSync(filePath)) {
		return
	}

	const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/)
	for (const line of lines) {
		const trimmed = line.trim()
		if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
			continue
		}

		const index = trimmed.indexOf("=")
		const key = trimmed.slice(0, index).trim()
		let value = trimmed.slice(index + 1).trim()
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1)
		}

		if (key && process.env[key] === undefined) {
			process.env[key] = value
		}
	}
}

loadEnvFile()

// ── Help ──────────────────────────────────────────────────────────────────────

function printHelp() {
	console.log(`
MCP Codex Bridge — CLI wrapper for DeepSeek and Ollama MCP tools

Usage:
  node scripts/mcp-codex-bridge.mjs <provider> <tool> [args...]

Providers:
  deepseek    DeepSeek coding tools (code, review, refactor, explain, status)
  ollama      Ollama tools (summarize, embed, chat, list-models, status)

DeepSeek tools:
  code <prompt> [--system <system>] [--model <model>] [--temperature <temp>] [--max-tokens <n>]
  review <code> [--context <context>] [--model <model>]
  refactor <code> [--instructions <instructions>] [--model <model>]
  explain <code> [--context <context>] [--model <model>]
  status

Ollama tools:
  summarize <text> [--model <model>]
  embed <text> [--model <model>]
  chat <message> [--system <system>] [--model <model>]
  list-models
  status

Examples:
  node scripts/mcp-codex-bridge.mjs deepseek code "Write a React component"
  node scripts/mcp-codex-bridge.mjs deepseek status
  node scripts/mcp-codex-bridge.mjs ollama summarize "Lesson text..."
  node scripts/mcp-codex-bridge.mjs ollama status
`)
}

// ── Argument parser ───────────────────────────────────────────────────────────

function parseArgs(args) {
	const result = { positional: [], named: {} }
	for (let i = 0; i < args.length; i++) {
		if (args[i].startsWith("--")) {
			const key = args[i].slice(2)
			const val = args[i + 1]
			if (val !== undefined && !val.startsWith("--")) {
				result.named[key] = val
				i++
			} else {
				result.named[key] = true
			}
		} else {
			result.positional.push(args[i])
		}
	}
	return result
}

// ── DeepSeek API call ─────────────────────────────────────────────────────────

// Try environment first, then fall back to .mcp.json
function loadDeepSeekApiKey() {
	if (process.env.DEEPSEEK_API_KEY) {
		return process.env.DEEPSEEK_API_KEY
	}
	// Fallback: check .mcp.json env block
	try {
		const mcpConfigPath = path.resolve(__dirname, "..", ".mcp.json")
		const mcpConfig = JSON.parse(fs.readFileSync(mcpConfigPath, "utf-8"))
		const dsEnv = mcpConfig?.mcpServers?.["deepseek-coder"]?.env
		if (dsEnv?.DEEPSEEK_API_KEY && dsEnv.DEEPSEEK_API_KEY.length >= 10) {
			return dsEnv.DEEPSEEK_API_KEY
		}
	} catch {
		// .mcp.json not found or invalid — ignore
	}
	return ""
}

const DEEPSEEK_API_KEY = loadDeepSeekApiKey()
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat"
const DEEPSEEK_API_URL =
	process.env.DEEPSEEK_API_URL || "https://api.deepseek.com/v1/chat/completions"

async function callDeepSeek(messages, options = {}) {
	if (!DEEPSEEK_API_KEY) {
		throw new Error("DEEPSEEK_API_KEY is not set. Configure it in your environment or .mcp.json.")
	}

	const model = options.model || DEEPSEEK_MODEL
	const temperature = options.temperature ?? 0.3
	const maxTokens = options.maxTokens ?? 4096

	const response = await fetch(DEEPSEEK_API_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
		},
		body: JSON.stringify({
			model,
			messages,
			temperature,
			max_tokens: maxTokens,
		}),
	})

	if (!response.ok) {
		const errorText = await response.text()
		throw new Error(`DeepSeek API error (${response.status}): ${errorText}`)
	}

	const data = await response.json()
	return data.choices?.[0]?.message?.content || "No response from DeepSeek"
}

// ── DeepSeek tool handlers ────────────────────────────────────────────────────

async function handleDeepseekCode(args) {
	const prompt = args.positional[0]
	if (!prompt) throw new Error("Usage: deepseek code <prompt> [--system <system>]")

	const messages = []
	if (args.named.system) {
		messages.push({ role: "system", content: args.named.system })
	}
	messages.push({ role: "user", content: prompt })

	return await callDeepSeek(messages, {
		model: args.named.model,
		temperature: args.named.temperature ? parseFloat(args.named.temperature) : undefined,
		maxTokens: args.named["max-tokens"] ? parseInt(args.named["max-tokens"]) : undefined,
	})
}

async function handleDeepseekReview(args) {
	const code = args.positional[0]
	if (!code) throw new Error("Usage: deepseek review <code> [--context <context>]")

	const systemMsg = "You are an expert code reviewer. Analyze the following code for bugs, security issues, performance problems, and best practices. Provide a structured review."
	const userMsg = args.named.context
		? `Context: ${args.named.context}\n\nCode to review:\n\`\`\`\n${code}\n\`\`\``
		: `Review the following code:\n\`\`\`\n${code}\n\`\`\``

	return await callDeepSeek([
		{ role: "system", content: systemMsg },
		{ role: "user", content: userMsg },
	], { model: args.named.model })
}

async function handleDeepseekRefactor(args) {
	const code = args.positional[0]
	if (!code) throw new Error("Usage: deepseek refactor <code> [--instructions <instructions>]")

	const instructions = args.named.instructions || "Improve the code quality, readability, and maintainability."
	const systemMsg = "You are an expert code refactoring assistant. Improve the code while preserving its functionality."
	const userMsg = `Refactoring instructions: ${instructions}\n\nCode to refactor:\n\`\`\`\n${code}\n\`\`\``

	return await callDeepSeek([
		{ role: "system", content: systemMsg },
		{ role: "user", content: userMsg },
	], { model: args.named.model })
}

async function handleDeepseekExplain(args) {
	const code = args.positional[0]
	if (!code) throw new Error("Usage: deepseek explain <code> [--context <context>]")

	const context = args.named.context || ""
	const systemMsg = "You are an expert code explainer. Explain the following code in detail, covering what it does, how it works, and any important patterns or potential issues."
	const userMsg = context
		? `Context: ${context}\n\nCode to explain:\n\`\`\`\n${code}\n\`\`\``
		: `Explain the following code:\n\`\`\`\n${code}\n\`\`\``

	return await callDeepSeek([
		{ role: "system", content: systemMsg },
		{ role: "user", content: userMsg },
	], { model: args.named.model })
}

async function handleDeepseekStatus() {
	const keyConfigured = !!DEEPSEEK_API_KEY
	const keyLast4 = keyConfigured ? DEEPSEEK_API_KEY.slice(-4) : "none"

	if (!keyConfigured) {
		return JSON.stringify({
			status: "unconfigured",
			configured: false,
			model: DEEPSEEK_MODEL,
			message: "DEEPSEEK_API_KEY is not set",
		}, null, 2)
	}

	// Test the API connection
	try {
		const response = await fetch(DEEPSEEK_API_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
			},
			body: JSON.stringify({
				model: DEEPSEEK_MODEL,
				messages: [{ role: "user", content: "Respond with only the word 'ok'." }],
				max_tokens: 10,
			}),
		})

		if (response.ok) {
			return JSON.stringify({
				status: "healthy",
				configured: true,
				model: DEEPSEEK_MODEL,
				keyLast4,
				latencyMs: 0,
			}, null, 2)
		} else {
			const errorText = await response.text()
			return JSON.stringify({
				status: "error",
				configured: true,
				model: DEEPSEEK_MODEL,
				keyLast4,
				error: `API returned ${response.status}: ${errorText}`,
			}, null, 2)
		}
	} catch (err) {
		return JSON.stringify({
			status: "unreachable",
			configured: true,
			model: DEEPSEEK_MODEL,
			keyLast4,
			error: err.message,
		}, null, 2)
	}
}

// ── Ollama API call ───────────────────────────────────────────────────────────

import fsSync from "fs"
import { execSync } from "child_process"
import os from "os"

const HELPER_SCRIPT = path.join(__dirname, "ml", "ollama-curl-helper.cmd")
const TMP_DIR = fsSync.mkdtempSync(path.join(os.tmpdir(), "sr-ollama-bridge-"))

const OLLAMA_URL = process.env.OLLAMA_URL || "http://100.64.175.88:11434"
const OLLAMA_TIMEOUT_MS = parseInt(process.env.OLLAMA_TIMEOUT || "120000", 10)

/**
 * Call Ollama API via curl.exe helper (avoids Node.js fetch() hanging on Tailscale IPs on Windows).
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

function callOllama(endpoint, body) {
	const url = `${OLLAMA_URL}${endpoint}`
	const data = curlOllama(url, body, OLLAMA_TIMEOUT_MS)
	if (!data) {
		throw new Error(`Ollama API error: no response from ${url}`)
	}
	return data
}

// ── Ollama tool handlers ──────────────────────────────────────────────────────

/**
 * @deprecated Summarization is now handled by DeepSeek API.
 * Use `node scripts/ollama-summarize-lesson.mjs` instead (which uses DeepSeek for summaries).
 * This function is kept for backward compatibility but will produce low-quality results
 * with the 0.5B model.
 */
function handleOllamaSummarize(args) {
	console.warn("⚠️  [DEPRECATED] ollama summarize uses hermes3 for summarization — quality is poor.")
	console.warn("   Use DeepSeek API instead: node scripts/ollama-summarize-lesson.mjs")
	console.warn("   Or call build-agent-context.mjs which uses DeepSeek for context compression.\n")

	const text = args.positional[0]
	if (!text) throw new Error("Usage: ollama summarize <text> [--model <model>]")

	const model = args.named.model || "hermes3"
	const prompt = `Summarize the following text concisely while preserving key information:\n\n${text}`

	const result = callOllama("/api/generate", {
		model,
		prompt,
		stream: false,
	})

	return result.response || "No response from Ollama"
}

function handleOllamaEmbed(args) {
	const text = args.positional[0]
	if (!text) throw new Error("Usage: ollama embed <text> [--model <model>]")

	const model = args.named.model || "nomic-embed-text"
	const result = callOllama("/api/embeddings", {
		model,
		prompt: text,
	})

	if (result.embedding) {
		return JSON.stringify({ embedding: result.embedding, dimensions: result.embedding.length }, null, 2)
	}
	return "No embedding returned"
}

function handleOllamaChat(args) {
	const message = args.positional[0]
	if (!message) throw new Error("Usage: ollama chat <message> [--system <system>] [--model <model>]")

	const model = args.named.model || "hermes3"
	const messages = []
	if (args.named.system) {
		messages.push({ role: "system", content: args.named.system })
	}
	messages.push({ role: "user", content: message })

	const result = callOllama("/api/chat", {
		model,
		messages,
		stream: false,
	})

	return result.message?.content || "No response from Ollama"
}

function handleOllamaListModels() {
	const data = callOllama("/api/tags", null)
	if (!data) {
		throw new Error("Ollama API error: no response")
	}
	const models = (data.models || []).map(m => ({
		name: m.name,
		size: m.size,
		modified: m.modified_at,
	}))
	return JSON.stringify({ models, count: models.length }, null, 2)
}

function handleOllamaStatus() {
	try {
		const start = Date.now()
		const data = callOllama("/api/tags", null)
		const latency = Date.now() - start

		if (!data) {
			return JSON.stringify({
				status: "error",
				url: OLLAMA_URL,
				error: "No response from Ollama",
			}, null, 2)
		}

		const models = (data.models || []).map(m => m.name)

		return JSON.stringify({
			status: "healthy",
			url: OLLAMA_URL,
			latencyMs: latency,
			models,
			modelCount: models.length,
		}, null, 2)
	} catch (err) {
		return JSON.stringify({
			status: "unreachable",
			url: OLLAMA_URL,
			error: err.message,
		}, null, 2)
	}
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
	const args = process.argv.slice(2)

	if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
		printHelp()
		process.exit(0)
	}

	const provider = args[0]
	const tool = args[1]
	const toolArgs = parseArgs(args.slice(2))

	try {
		let result

		if (provider === "deepseek") {
			switch (tool) {
				case "code":
					result = await handleDeepseekCode(toolArgs)
					break
				case "review":
					result = await handleDeepseekReview(toolArgs)
					break
				case "refactor":
					result = await handleDeepseekRefactor(toolArgs)
					break
				case "explain":
					result = await handleDeepseekExplain(toolArgs)
					break
				case "status":
					result = await handleDeepseekStatus()
					break
				default:
					console.error(`Unknown deepseek tool: ${tool}`)
					console.error("Available: code, review, refactor, explain, status")
					process.exit(1)
			}
		} else if (provider === "ollama") {
			switch (tool) {
				case "summarize":
					result = handleOllamaSummarize(toolArgs)
					break
				case "embed":
					result = handleOllamaEmbed(toolArgs)
					break
				case "chat":
					result = handleOllamaChat(toolArgs)
					break
				case "list-models":
					result = handleOllamaListModels()
					break
				case "status":
					result = handleOllamaStatus()
					break
				default:
					console.error(`Unknown ollama tool: ${tool}`)
					console.error("Available: summarize, embed, chat, list-models, status")
					process.exit(1)
			}
		} else {
			console.error(`Unknown provider: ${provider}`)
			console.error("Available: deepseek, ollama")
			process.exit(1)
		}

		console.log(result)
	} catch (err) {
		console.error(`Error: ${err.message}`)
		process.exit(1)
	}
}

main()
