#!/usr/bin/env node
/**
 * DeepSeek Coder MCP Server
 *
 * Model Context Protocol server that exposes DeepSeek coding capabilities
 * as MCP tools. Claude Code can call these tools to delegate coding tasks
 * to DeepSeek, following the SuperRoo agent routing workflow:
 *
 *   Claude (plan/review) → DeepSeek (code) → Ollama (summarize)
 *
 * Protocol: JSON-RPC 2.0 over stdio (standard MCP transport)
 *
 * Tools:
 *   - deepseek_code(prompt, system?, model?, temperature?, max_tokens?)
 *     Generate code using DeepSeek API
 *
 *   - deepseek_review(code, context?)
 *     Review code using DeepSeek API
 *
 *   - deepseek_refactor(code, instructions?)
 *     Refactor code using DeepSeek API
 *
 *   - deepseek_explain(code, context?)
 *     Explain code using DeepSeek API
 *
 *   - deepseek_status()
 *     Check if DeepSeek API is configured and reachable
 *
 * Usage:
 *   node scripts/deepseek-coder-mcp.mjs
 *
 * Environment:
 *   DEEPSEEK_API_KEY  (required) — DeepSeek API key
 *   DEEPSEEK_MODEL    (optional) — Model name (default: deepseek-chat)
 *   DEEPSEEK_API_URL  (optional) — API endpoint (default: https://api.deepseek.com/v1/chat/completions)
 */

import * as fs from "node:fs/promises"
import * as fsSync from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, "..")

function loadEnvFile(filePath = path.join(ROOT, ".env")) {
	if (!fsSync.existsSync(filePath)) {
		return
	}

	const lines = fsSync.readFileSync(filePath, "utf8").split(/\r?\n/)
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

// ── Configuration ─────────────────────────────────────────────────────────────

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || ""
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat"
const DEEPSEEK_API_URL =
	process.env.DEEPSEEK_API_URL || "https://api.deepseek.com/v1/chat/completions"
const MCP_SERVER_NAME = "deepseek-coder"
const MCP_SERVER_VERSION = "1.0.0"

// ── MCP Protocol Helpers ──────────────────────────────────────────────────────

/**
 * Send a JSON-RPC message to stdout (MCP stdio transport)
 */
function sendMessage(msg) {
	const line = JSON.stringify(msg)
	process.stdout.write(line + "\n")
}

/**
 * Send a JSON-RPC response
 */
function sendResponse(id, result) {
	sendMessage({ jsonrpc: "2.0", id, result })
}

/**
 * Send a JSON-RPC error
 */
function sendError(id, code, message, data) {
	sendMessage({ jsonrpc: "2.0", id, error: { code, message, data } })
}

/**
 * Send a JSON-RPC notification (no id)
 */
function sendNotification(method, params) {
	sendMessage({ jsonrpc: "2.0", method, params })
}

// ── Tool Definitions ──────────────────────────────────────────────────────────

const TOOLS = [
	{
		name: "deepseek_code",
		description:
			"Generate code using DeepSeek V4 API. Use this for writing new code, implementing features, or creating files. DeepSeek is the primary coder in the SuperRoo workflow (Claude plans/reviews → DeepSeek codes → Ollama summarizes).",
		inputSchema: {
			type: "object",
			properties: {
				prompt: {
					type: "string",
					description: "The coding task description. Be specific about what to build.",
				},
				system: {
					type: "string",
					description:
						"Optional system prompt to guide DeepSeek's behavior (e.g., 'You are a senior TypeScript engineer')",
				},
				model: {
					type: "string",
					description: "DeepSeek model to use (default: deepseek-chat-v4)",
				},
				temperature: {
					type: "number",
					description: "Sampling temperature 0-2 (default: 0.3 for code)",
				},
				max_tokens: {
					type: "number",
					description: "Maximum tokens in response (default: 4096)",
				},
			},
			required: ["prompt"],
		},
	},
	{
		name: "deepseek_review",
		description:
			"Review code using DeepSeek V4 API. Use this for code review, finding bugs, or suggesting improvements.",
		inputSchema: {
			type: "object",
			properties: {
				code: {
					type: "string",
					description: "The code to review",
				},
				context: {
					type: "string",
					description: "Optional context about what this code does",
				},
				model: {
					type: "string",
					description: "DeepSeek model to use (default: deepseek-chat-v4)",
				},
			},
			required: ["code"],
		},
	},
	{
		name: "deepseek_refactor",
		description:
			"Refactor code using DeepSeek V4 API. Use this for improving existing code structure, performance, or readability.",
		inputSchema: {
			type: "object",
			properties: {
				code: {
					type: "string",
					description: "The code to refactor",
				},
				instructions: {
					type: "string",
					description: "Specific refactoring instructions (e.g., 'extract into smaller functions', 'add error handling')",
				},
				model: {
					type: "string",
					description: "DeepSeek model to use (default: deepseek-chat-v4)",
				},
			},
			required: ["code"],
		},
	},
	{
		name: "deepseek_explain",
		description:
			"Explain code using DeepSeek V4 API. Use this for understanding complex code, generating documentation, or learning.",
		inputSchema: {
			type: "object",
			properties: {
				code: {
					type: "string",
					description: "The code to explain",
				},
				context: {
					type: "string",
					description: "Optional context about the codebase or problem domain",
				},
				model: {
					type: "string",
					description: "DeepSeek model to use (default: deepseek-chat-v4)",
				},
			},
			required: ["code"],
		},
	},
	{
		name: "deepseek_status",
		description:
			"Check if DeepSeek API is configured and reachable. Returns API key status, model info, and connection health.",
		inputSchema: {
			type: "object",
			properties: {},
			required: [],
		},
	},
]

// ── DeepSeek API Call ─────────────────────────────────────────────────────────

/**
 * Call the DeepSeek chat completions API
 */
async function callDeepSeek(messages, options = {}) {
	const {
		model = DEEPSEEK_MODEL,
		temperature = 0.3,
		max_tokens = 4096,
	} = options

	if (!DEEPSEEK_API_KEY) {
		throw new Error(
			"DEEPSEEK_API_KEY is not set. Configure it in your environment or .env file."
		)
	}

	const body = {
		model,
		messages,
		temperature,
		max_tokens,
	}

	const startTime = Date.now()

	const response = await fetch(DEEPSEEK_API_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
		},
		body: JSON.stringify(body),
	})

	const latencyMs = Date.now() - startTime

	if (!response.ok) {
		const errorData = await response.json().catch(() => ({}))
		throw new Error(
			`DeepSeek API error (${response.status}): ${errorData.error?.message || response.statusText}`
		)
	}

	const data = await response.json()
	const content = data.choices?.[0]?.message?.content || ""
	const usage = data.usage || {}

	return {
		content,
		model: data.model || model,
		usage: {
			promptTokens: usage.prompt_tokens || 0,
			completionTokens: usage.completion_tokens || 0,
			totalTokens: usage.total_tokens || 0,
		},
		latencyMs,
	}
}

// ── Tool Handlers ─────────────────────────────────────────────────────────────

async function handleDeepseekCode(params) {
	const { prompt, system, model, temperature, max_tokens } = params

	const messages = []
	if (system) {
		messages.push({ role: "system", content: system })
	}
	messages.push({ role: "user", content: prompt })

	const result = await callDeepSeek(messages, { model, temperature, max_tokens })

	return {
		content: [
			{
				type: "text",
				text: result.content,
			},
			{
				type: "resource",
				resource: {
					text: JSON.stringify(
						{
							model: result.model,
							tokens: result.usage,
							latencyMs: result.latencyMs,
							provider: "deepseek",
						},
						null,
						2
					),
					mimeType: "application/json",
				},
			},
		],
		isError: false,
	}
}

async function handleDeepseekReview(params) {
	const { code, context, model } = params

	const systemPrompt = `You are a senior code reviewer. Analyze the following code for:
1. Bugs and logic errors
2. Security vulnerabilities
3. Performance issues
4. Code style and best practices
5. Missing error handling
6. Type safety concerns

Provide a structured review with severity levels (critical/warning/info) for each finding.`

	const userPrompt = context
		? `Context: ${context}\n\nCode to review:\n\`\`\`\n${code}\n\`\`\``
		: `Code to review:\n\`\`\`\n${code}\n\`\`\``

	const messages = [
		{ role: "system", content: systemPrompt },
		{ role: "user", content: userPrompt },
	]

	const result = await callDeepSeek(messages, { model })

	return {
		content: [
			{
				type: "text",
				text: result.content,
			},
			{
				type: "resource",
				resource: {
					text: JSON.stringify(
						{
							model: result.model,
							tokens: result.usage,
							latencyMs: result.latencyMs,
							provider: "deepseek",
						},
						null,
						2
					),
					mimeType: "application/json",
				},
			},
		],
		isError: false,
	}
}

async function handleDeepseekRefactor(params) {
	const { code, instructions, model } = params

	const systemPrompt = `You are a senior software engineer specializing in code refactoring. 
Your task is to improve the provided code while maintaining its exact functionality.
Focus on: readability, performance, maintainability, and best practices.
Return ONLY the refactored code, with brief comments explaining key changes.`

	const userPrompt = instructions
		? `Refactoring instructions: ${instructions}\n\nCode to refactor:\n\`\`\`\n${code}\n\`\`\``
		: `Refactor the following code for better quality:\n\`\`\`\n${code}\n\`\`\``

	const messages = [
		{ role: "system", content: systemPrompt },
		{ role: "user", content: userPrompt },
	]

	const result = await callDeepSeek(messages, { model })

	return {
		content: [
			{
				type: "text",
				text: result.content,
			},
			{
				type: "resource",
				resource: {
					text: JSON.stringify(
						{
							model: result.model,
							tokens: result.usage,
							latencyMs: result.latencyMs,
							provider: "deepseek",
						},
						null,
						2
					),
					mimeType: "application/json",
				},
			},
		],
		isError: false,
	}
}

async function handleDeepseekExplain(params) {
	const { code, context, model } = params

	const systemPrompt = `You are a senior software engineer and technical teacher.
Explain the provided code clearly and thoroughly. Cover:
1. What the code does at a high level
2. Key design patterns and architectural decisions
3. How the different parts work together
4. Any potential improvements or gotchas
5. The data flow and control flow`

	const userPrompt = context
		? `Context: ${context}\n\nCode to explain:\n\`\`\`\n${code}\n\`\`\``
		: `Explain this code:\n\`\`\`\n${code}\n\`\`\``

	const messages = [
		{ role: "system", content: systemPrompt },
		{ role: "user", content: userPrompt },
	]

	const result = await callDeepSeek(messages, { model })

	return {
		content: [
			{
				type: "text",
				text: result.content,
			},
			{
				type: "resource",
				resource: {
					text: JSON.stringify(
						{
							model: result.model,
							tokens: result.usage,
							latencyMs: result.latencyMs,
							provider: "deepseek",
						},
						null,
						2
					),
					mimeType: "application/json",
				},
			},
		],
		isError: false,
	}
}

async function handleDeepseekStatus() {
	const keyConfigured = !!DEEPSEEK_API_KEY
	const keyLast4 = keyConfigured ? DEEPSEEK_API_KEY.slice(-4) : "none"
	const model = DEEPSEEK_MODEL

	let reachable = false
	let latencyMs = 0
	let errorMsg = null

	if (keyConfigured) {
		try {
			const startTime = Date.now()
			const response = await fetch(DEEPSEEK_API_URL, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
				},
				body: JSON.stringify({
					model,
					messages: [
						{ role: "user", content: "Say 'ok'" },
					],
					max_tokens: 5,
					temperature: 0,
				}),
			})
			latencyMs = Date.now() - startTime
			reachable = response.ok
			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}))
				errorMsg = errorData.error?.message || `HTTP ${response.status}`
			}
		} catch (err) {
			reachable = false
			errorMsg = err.message
		}
	}

	return {
		content: [
			{
				type: "text",
				text: JSON.stringify(
					{
						configured: keyConfigured,
						keyLast4,
						model,
						apiUrl: DEEPSEEK_API_URL,
						reachable,
						latencyMs: reachable ? latencyMs : null,
						error: errorMsg,
						workflowRole: "primary coder",
						workflowPosition: "Claude (plan/review) → DeepSeek (code) → Ollama (summarize)",
					},
					null,
					2
				),
			},
		],
		isError: false,
	}
}

// ── MCP Request Router ────────────────────────────────────────────────────────

const toolHandlers = {
	deepseek_code: handleDeepseekCode,
	deepseek_review: handleDeepseekReview,
	deepseek_refactor: handleDeepseekRefactor,
	deepseek_explain: handleDeepseekExplain,
	deepseek_status: handleDeepseekStatus,
}

/**
 * Handle an incoming JSON-RPC request
 */
async function handleRequest(request) {
	const { id, method, params } = request

	try {
		switch (method) {
			// ── MCP Lifecycle ──
			case "initialize": {
				sendResponse(id, {
					protocolVersion: "2024-11-05",
					capabilities: {
						tools: {},
					},
					serverInfo: {
						name: MCP_SERVER_NAME,
						version: MCP_SERVER_VERSION,
					},
				})
				break
			}

			case "notifications/initialized": {
				// No response needed for notifications
				break
			}

			// ── Tools ──
			case "tools/list": {
				sendResponse(id, { tools: TOOLS })
				break
			}

			case "tools/call": {
				const toolName = params?.name
				const toolParams = params?.arguments || {}

				if (!toolName) {
					sendError(id, -32602, "Missing tool name")
					break
				}

				const handler = toolHandlers[toolName]
				if (!handler) {
					sendError(id, -32601, `Unknown tool: ${toolName}`)
					break
				}

				const result = await handler(toolParams)
				sendResponse(id, result)
				break
			}

			// ── Unknown ──
			default:
				sendError(id, -32601, `Method not found: ${method}`)
		}
	} catch (err) {
		sendError(id, -32603, `Internal error: ${err.message}`, {
			stack: err.stack,
		})
	}
}

// ── Main ──────────────────────────────────────────────────────────────────────

/**
 * Start the MCP server. Reads JSON-RPC messages from stdin.
 */
function main() {
	// Log startup to stderr (stdout is reserved for MCP protocol)
	console.error(`[deepseek-coder-mcp] Starting MCP server: ${MCP_SERVER_NAME} v${MCP_SERVER_VERSION}`)
	console.error(`[deepseek-coder-mcp] Model: ${DEEPSEEK_MODEL}`)
	console.error(`[deepseek-coder-mcp] API URL: ${DEEPSEEK_API_URL}`)
	console.error(`[deepseek-coder-mcp] API Key configured: ${!!DEEPSEEK_API_KEY}`)

	if (!DEEPSEEK_API_KEY) {
		console.error("[deepseek-coder-mcp] ⚠️  DEEPSEEK_API_KEY is not set. Tools will fail until configured.")
	}

	let buffer = ""
	const pendingRequests = new Set()

	process.stdin.setEncoding("utf8")
	process.stdin.on("data", (chunk) => {
		buffer += chunk

		// Process complete JSON-RPC messages (newline-delimited)
		const lines = buffer.split("\n")
		buffer = lines.pop() || "" // Keep incomplete line in buffer

		for (const line of lines) {
			const trimmed = line.trim()
			if (!trimmed) continue

			try {
				const request = JSON.parse(trimmed)
				const pending = handleRequest(request)
					.catch((err) => {
						console.error(`[deepseek-coder-mcp] Error handling request:`, err)
					})
					.finally(() => {
						pendingRequests.delete(pending)
					})
				pendingRequests.add(pending)
			} catch (err) {
				console.error(`[deepseek-coder-mcp] Failed to parse message:`, err.message)
				console.error(`[deepseek-coder-mcp] Raw:`, trimmed.slice(0, 200))
			}
		}
	})

	process.stdin.on("end", async () => {
		console.error("[deepseek-coder-mcp] stdin closed, shutting down")
		await Promise.allSettled([...pendingRequests])
		process.exit(0)
	})

	process.on("SIGINT", () => {
		console.error("[deepseek-coder-mcp] SIGINT received, shutting down")
		process.exit(0)
	})

	process.on("SIGTERM", () => {
		console.error("[deepseek-coder-mcp] SIGTERM received, shutting down")
		process.exit(0)
	})
}

main()
