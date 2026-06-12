#!/usr/bin/env node
/**
 * Copilot-only local Ollama coding agent.
 *
 * This is intentionally scoped to GitHub Copilot Chat persistence. Do not use
 * it as the default route for Codex, Kilo, Claude, Blackbox, Roo, or SuperRoo
 * VS Code agents.
 *
 * Usage:
 *   node scripts/copilot-local-coder.mjs "implement X"
 *   Get-Content prompt.txt | node scripts/copilot-local-coder.mjs
 *   node scripts/copilot-local-coder.mjs --check-models
 */

import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")

const OLLAMA_URL = (process.env.COPILOT_LOCAL_OLLAMA_URL || process.env.OLLAMA_HOST || "http://127.0.0.1:11434").replace(/\/$/, "")
const TIMEOUT_MS = Number(process.env.COPILOT_LOCAL_TIMEOUT_MS || "240000")
const NUM_PREDICT = Number(process.env.COPILOT_LOCAL_NUM_PREDICT || "700")
const NUM_CTX = Number(process.env.COPILOT_LOCAL_NUM_CTX || "4096")

const MODELS = {
	planner: process.env.COPILOT_LOCAL_PLANNER_MODEL || "hermes3",
	architect: process.env.COPILOT_LOCAL_ARCHITECT_MODEL || "phi4",
	coding: process.env.COPILOT_LOCAL_CODER_MODEL || "qwen2.5-coder:7b",
	complexCoding: process.env.COPILOT_LOCAL_COMPLEX_CODER_MODEL || "qwen2.5-coder:14b",
	embeddings: process.env.COPILOT_LOCAL_EMBED_MODEL || "nomic-embed-text",
}

const args = process.argv.slice(2)

function readPrompt() {
	const prompt = args.filter((arg) => !arg.startsWith("--")).join(" ").trim()
	if (prompt) return prompt

	try {
		if (!process.stdin.isTTY) {
			const stdin = fs.readFileSync(0, "utf8").trim()
			if (stdin) return stdin
		}
	} catch {
		// Fall through to usage.
	}

	console.error("Usage: node scripts/copilot-local-coder.mjs \"prompt\"")
	process.exit(2)
}

function requestJson(method, url, body = undefined, timeoutMs = TIMEOUT_MS) {
	return new Promise((resolve, reject) => {
		const payload = body ? JSON.stringify(body) : undefined
		const request = http.request(url, {
			method,
			headers: payload
				? {
					"Content-Type": "application/json",
					"Content-Length": Buffer.byteLength(payload),
				}
				: undefined,
			timeout: timeoutMs,
		}, (response) => {
			let raw = ""
			response.setEncoding("utf8")
			response.on("data", (chunk) => {
				raw += chunk
			})
			response.on("end", () => {
				if (response.statusCode < 200 || response.statusCode >= 300) {
					reject(new Error(`HTTP ${response.statusCode}: ${raw.slice(0, 500)}`))
					return
				}
				try {
					resolve(JSON.parse(raw || "{}"))
				} catch (error) {
					reject(new Error(`Invalid JSON from Ollama: ${error.message}`))
				}
			})
		})
		request.on("timeout", () => request.destroy(new Error("request timed out")))
		request.on("error", reject)
		if (payload) request.write(payload)
		request.end()
	})
}

async function ollamaChat(model, system, user) {
	const response = await requestJson("POST", `${OLLAMA_URL}/api/chat`, {
		model,
		messages: [
			{ role: "system", content: system },
			{ role: "user", content: user },
		],
		stream: false,
		options: {
			temperature: 0.2,
			num_predict: NUM_PREDICT,
			num_ctx: NUM_CTX,
		},
	})

	return response.message?.content?.trim() || ""
}

async function ollamaEmbed(text) {
	try {
		const response = await requestJson("POST", `${OLLAMA_URL}/api/embeddings`, {
			model: MODELS.embeddings,
			prompt: text.slice(0, 8000),
		}, 30000)
		return Array.isArray(response.embedding) ? response.embedding : null
	} catch (error) {
		process.stderr.write(`[copilot-local-coder] embedding unavailable, using keyword memory search: ${error.message}\n`)
		return null
	}
}

function tokenize(text) {
	return String(text || "")
		.toLowerCase()
		.replace(/[^a-z0-9_./:-]+/g, " ")
		.split(/\s+/)
		.filter((token) => token.length > 2)
}

function cosine(a, b) {
	if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0
	let dot = 0
	let aa = 0
	let bb = 0
	for (let index = 0; index < a.length; index += 1) {
		dot += a[index] * b[index]
		aa += a[index] * a[index]
		bb += b[index] * b[index]
	}
	return aa && bb ? dot / (Math.sqrt(aa) * Math.sqrt(bb)) : 0
}

function loadJsonlLessons() {
	const file = path.join(ROOT, "memory", "lesson-index.jsonl")
	if (!fs.existsSync(file)) return []
	const rows = []
	for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
		if (!line.trim()) continue
		try {
			const entry = JSON.parse(line)
			rows.push({
				title: entry.title || "Untitled lesson",
				summary: entry.lesson_summary || entry.rule_summary || entry.summary || "",
				rule: entry.rule_summary || "",
				files: Array.isArray(entry.files) ? entry.files : [],
				tags: Array.isArray(entry.tags) ? entry.tags : [],
				embedding: entry.embedding || entry.vector || null,
			})
		} catch {
			// Keep memory loading resilient.
		}
	}
	return rows
}

function loadMarkdownLessons() {
	const file = path.join(ROOT, "memory", "lessons-learned.md")
	if (!fs.existsSync(file)) return []
	const blocks = fs.readFileSync(file, "utf8").split(/\n(?=### Lesson: )/g)
	return blocks
		.filter((block) => block.startsWith("### Lesson: "))
		.slice(-120)
		.map((block) => {
			const title = block.match(/^### Lesson:\s*(.+)$/m)?.[1]?.trim() || "Untitled lesson"
			const rule = block.match(/#### Reusable Rule\s+([\s\S]*?)(?:\n####|\n---|$)/)?.[1]?.trim() || ""
			const learned = block.match(/#### Lesson Learned\s+([\s\S]*?)(?:\n####|\n---|$)/)?.[1]?.trim() || ""
			return { title, summary: learned, rule, files: [], tags: [], embedding: null }
		})
}

async function memoryExplorer(query, limit = 6) {
	const entries = [...loadJsonlLessons(), ...loadMarkdownLessons()]
	const queryTokens = new Set(tokenize(query))
	const queryEmbedding = await ollamaEmbed(query)

	const scored = entries.map((entry) => {
		const haystack = [entry.title, entry.summary, entry.rule, entry.files.join(" "), entry.tags.join(" ")].join(" ")
		const tokens = tokenize(haystack)
		let keywordScore = 0
		for (const token of tokens) {
			if (queryTokens.has(token)) keywordScore += 1
		}
		const embeddingScore = queryEmbedding && entry.embedding ? cosine(queryEmbedding, entry.embedding) * 20 : 0
		return { ...entry, score: keywordScore + embeddingScore }
	})

	return scored
		.filter((entry) => entry.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, limit)
}

function formatMemory(entries) {
	if (!entries.length) return "No directly relevant SuperRoo Memory Explorer lessons found."
	return entries.map((entry, index) => [
		`${index + 1}. ${entry.title}`,
		entry.rule ? `Rule: ${entry.rule}` : "",
		entry.summary ? `Summary: ${entry.summary}` : "",
		entry.files.length ? `Files: ${entry.files.slice(0, 8).join(", ")}` : "",
	].filter(Boolean).join("\n")).join("\n\n")
}

function isComplex(prompt) {
	const text = prompt.toLowerCase()
	const complexSignals = ["multi-file", "architecture", "refactor", "migration", "auth", "database", "deploy", "security", "performance", "webview", "extension", "tests", "e2e"]
	return prompt.length > 2000 || complexSignals.some((signal) => text.includes(signal))
}

async function checkModels() {
	const response = await requestJson("GET", `${OLLAMA_URL}/api/tags`, undefined, 30000)
	const installed = new Set((response.models || []).map((model) => model.name))
	console.log(`Ollama: ${OLLAMA_URL}`)
	for (const [role, model] of Object.entries(MODELS)) {
		const ready = installed.has(model) || [...installed].some((name) => name.startsWith(`${model}:`))
		console.log(`${role.padEnd(14)} ${model.padEnd(22)} ${ready ? "READY" : "MISSING"}`)
	}
}

async function main() {
	if (args.includes("--check-models")) {
		await checkModels()
		return
	}

	const prompt = readPrompt()
	const memories = await memoryExplorer(prompt)
	const memoryContext = formatMemory(memories)

	const plannerSystem = "You are Hermes 3 acting as the Copilot-only local planner. Break the user request into intent, constraints, likely files, risks, and verification. Use only local SuperRoo context. Do not route to other coding extensions."
	const plan = await ollamaChat(MODELS.planner, plannerSystem, `User request:\n${prompt}\n\nSuperRoo Memory Explorer context:\n${memoryContext}`)

	const architectSystem = "You are Phi-4 acting as the Copilot-only local architect. Turn the plan into a concise implementation design with risks and acceptance criteria. Respect existing repo patterns and keep scope limited."
	const architecture = await ollamaChat(MODELS.architect, architectSystem, `User request:\n${prompt}\n\nPlanner output:\n${plan}\n\nMemory context:\n${memoryContext}`)

	const coderModel = isComplex(prompt) ? MODELS.complexCoding : MODELS.coding
	const coderSystem = `You are ${coderModel} acting as the Copilot-only local coding agent. Produce practical code guidance or patch-ready implementation steps. Call out exact files, tests, and risk. Do not delegate to Kilo, Codex, Claude, Blackbox, Roo, or cloud Copilot.`
	const implementation = await ollamaChat(coderModel, coderSystem, `User request:\n${prompt}\n\nPlanner output:\n${plan}\n\nArchitect output:\n${architecture}\n\nMemory context:\n${memoryContext}`)

	console.log([
		"# Copilot Local Ollama Coding Agent",
		"",
		`Planner: ${MODELS.planner}`,
		`Architect: ${MODELS.architect}`,
		`Coder: ${coderModel}`,
		`Search/Embeddings: ${MODELS.embeddings}`,
		`Long-term Memory: SuperRoo Memory Explorer (${memories.length} matched lessons)`,
		"",
		"## Plan",
		plan,
		"",
		"## Architecture",
		architecture,
		"",
		"## Implementation",
		implementation,
	].join("\n"))
}

main().catch((error) => {
	console.error(`[copilot-local-coder] failed: ${error.message}`)
	process.exit(1)
})
