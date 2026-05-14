#!/usr/bin/env node

/**
 * Indexer CLI — One-shot repo indexing for SuperRoo.
 *
 * Usage:
 *   node src/cli.js [--repo /path/to/repo] [--project superroo2] [--reindex file.ts]
 *
 * @module apps/indexer-worker/src/cli
 */

import { resolve } from "node:path"
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs"
import { createHash } from "node:crypto"
import { createServer } from "node:http"

// ── Config ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const REPO_PATH = resolve(args[args.indexOf("--repo") + 1] || process.env.REPO_PATH || process.cwd())
const PROJECT_ID = args[args.indexOf("--project") + 1] || process.env.PROJECT_ID || "superroo2"
const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333"
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434"
const OLLAMA_MODEL = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text"
const REINDEX_FILE = args[args.indexOf("--reindex") + 1] || null

// ── Helpers ─────────────────────────────────────────────────────────────────

async function qdrantRequest(method, path, body) {
	const url = QDRANT_URL + path
	const res = await fetch(url, {
		method,
		headers: { "content-type": "application/json" },
		body: body ? JSON.stringify(body) : undefined,
	})
	if (!res.ok) {
		const text = await res.text()
		throw new Error(`Qdrant ${res.status}: ${text}`)
	}
	return res.json()
}

async function createEmbedding(text) {
	const res = await fetch(OLLAMA_URL + "/api/embeddings", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ model: OLLAMA_MODEL, prompt: text.slice(0, 8000) }),
	})
	if (!res.ok) throw new Error(`Ollama error: ${res.status}`)
	const json = await res.json()
	if (json.error) throw new Error(`Ollama error: ${json.error}`)
	return json.embedding
}

function detectLanguage(filePath) {
	const ext = filePath.split(".").pop().toLowerCase()
	const map = {
		ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
		py: "python", go: "go", rs: "rust", java: "java",
		cpp: "cpp", c: "c", h: "c", hpp: "cpp",
		php: "php", rb: "ruby", swift: "swift", kt: "kotlin",
		sh: "shell", bash: "shell", yaml: "yaml", yml: "yaml",
		toml: "toml", json: "json", md: "markdown", sql: "sql",
		css: "css", scss: "scss", html: "html", vue: "typescript",
		svelte: "typescript",
	}
	return map[ext] || "text"
}

const SKIP_DIRS = ["node_modules", ".git", "dist", "build", ".next", ".turbo", "coverage", "__pycache__"]
const SKIP_EXTS = new Set([
	".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp",
	".woff", ".woff2", ".ttf", ".eot", ".mp4", ".mp3",
	".zip", ".tar", ".gz", ".rar", ".pdf", ".doc", ".docx",
	".exe", ".dll", ".so", ".dylib", ".o", ".obj", ".class",
	".map", ".d.ts",
])

function isIndexable(filePath) {
	const ext = filePath.split(".").pop()
	if (!ext || SKIP_EXTS.has("." + ext)) return false
	for (const dir of SKIP_DIRS) {
		if (filePath.includes("/" + dir + "/") || filePath.includes("\\" + dir + "\\")) return false
	}
	return true
}

function chunkFile(filePath, content) {
	const language = detectLanguage(filePath)
	const lines = content.split("\n")
	const chunks = []
	const maxLines = 80
	const minLines = 5

	const boundaryPatterns = {
		typescript: [/^\s*(export\s+)?(async\s+)?(function|class|interface|type|enum|namespace|module)\s+\w+/],
		javascript: [/^\s*(export\s+)?(async\s+)?(function|class)\s+\w+/],
		tsx: [/^\s*(export\s+)?(async\s+)?(function|class|interface|const\s+\w+\s*[:=]\s*(React\.FC|React\.ComponentType|\(\)))/],
		python: [/^\s*(def|class|async\s+def)\s+\w+/],
		go: [/^\s*(func|type\s+\w+\s+(struct|interface))\s+\w+/],
		rust: [/^\s*(fn|struct|enum|impl|trait|mod)\s+\w+/],
	}

	const patterns = boundaryPatterns[language] || []
	const boundaryLines = []

	for (let i = 0; i < lines.length; i++) {
		const trimmed = lines[i].trimStart()
		for (const pattern of patterns) {
			if (pattern.test(trimmed)) {
				boundaryLines.push(i)
				break
			}
		}
	}

	if (boundaryLines.length > 0) {
		let start = 0
		for (let i = 0; i < boundaryLines.length; i++) {
			const b = boundaryLines[i]
			const nextB = boundaryLines[i + 1] || lines.length

			if (b - start < minLines && i > 0) continue

			if (nextB - start > maxLines) {
				const chunkLines = lines.slice(start, b)
				if (chunkLines.length >= minLines) {
					chunks.push({
						content: chunkLines.join("\n"),
						startLine: start + 1,
						endLine: b,
					})
				}
				start = b
			}
		}

		if (start < lines.length) {
			const chunkLines = lines.slice(start)
			if (chunkLines.length >= minLines) {
				chunks.push({
					content: chunkLines.join("\n"),
					startLine: start + 1,
					endLine: lines.length,
				})
			}
		}
	}

	// Fallback: line-count splitting
	if (chunks.length === 0) {
		for (let i = 0; i < lines.length; i += maxLines - 3) {
			const end = Math.min(i + maxLines, lines.length)
			const chunkLines = lines.slice(i, end)
			if (chunkLines.length < minLines && i > 0) break
			chunks.push({
				content: chunkLines.join("\n"),
				startLine: i + 1,
				endLine: end,
			})
		}
	}

	return { language, chunks }
}

function pointId(projectId, filePath, startLine) {
	const hash = createHash("sha256")
		.update(projectId + ":" + filePath + ":" + startLine)
		.digest("hex")
		.slice(0, 32)
	return hash
}

// ── Index a single file ────────────────────────────────────────────────────

async function indexFile(filePath) {
	const relPath = filePath.replace(/\\/g, "/")
	if (!isIndexable(relPath)) return { chunks: 0, skipped: true }

	try {
		const fullPath = resolve(REPO_PATH, relPath)
		if (!existsSync(fullPath)) return { chunks: 0, skipped: true }

		const content = readFileSync(fullPath, "utf-8")
		const { language, chunks } = chunkFile(relPath, content)

		if (chunks.length === 0) return { chunks: 0 }

		// Delete old points for this file
		await qdrantRequest("POST", "/collections/superroo_code_chunks/points/delete", {
			filter: {
				must: [
					{ key: "filePath", match: { value: relPath } },
					{ key: "projectId", match: { value: PROJECT_ID } },
				],
			},
		})

		// Create embeddings and upsert
		const points = []
		for (const chunk of chunks) {
			const embedText = "FILE: " + relPath + "\n" + chunk.content
			const vector = await createEmbedding(embedText)
			const id = pointId(PROJECT_ID, relPath, chunk.startLine)
			points.push({
				id,
				vector,
				payload: {
					projectId: PROJECT_ID,
					filePath: relPath,
					language,
					content: chunk.content,
					startLine: chunk.startLine,
					endLine: chunk.endLine,
					chunkIndex: chunks.indexOf(chunk),
					totalChunks: chunks.length,
				},
			})
		}

		// Upsert in batches of 50
		for (let i = 0; i < points.length; i += 50) {
			const batch = points.slice(i, i + 50)
			await qdrantRequest("PUT", "/collections/superroo_code_chunks/points", { points: batch })
		}

		return { chunks: points.length }
	} catch (err) {
		console.error("[indexer] Error indexing", filePath, err.message)
		return { chunks: 0, error: err.message }
	}
}

// ── Walk directory ─────────────────────────────────────────────────────────

function walkDir(dir, basePath) {
	const files = []
	try {
		const entries = readdirSync(dir)
		for (const entry of entries) {
			const fullPath = resolve(dir, entry)
			const relPath = resolve(basePath, entry)
			try {
				const stat = statSync(fullPath)
				if (stat.isDirectory()) {
					const dirName = entry.toLowerCase()
					if (SKIP_DIRS.includes(dirName)) continue
					if (entry.startsWith(".")) continue
					files.push(...walkDir(fullPath, basePath))
				} else if (stat.isFile()) {
					files.push(relPath)
				}
			} catch {
				// skip inaccessible
			}
		}
	} catch {
		// skip inaccessible
	}
	return files
}

// ── Ensure Qdrant collection ───────────────────────────────────────────────

async function ensureQdrantCollection() {
	console.log("[indexer] Ensuring Qdrant collection exists...")
	try {
		const check = await qdrantRequest("GET", "/collections/superroo_code_chunks")
		if (check.result) {
			console.log("[indexer] Collection already exists")
			return
		}
	} catch {
		// collection doesn't exist, create it
	}

	await qdrantRequest("PUT", "/collections/superroo_code_chunks", {
		name: "superroo_code_chunks",
		vectors: { size: 768, distance: "Cosine" },
		hnsw_config: { m: 16, ef_construct: 200 },
	})

	for (const field of ["projectId", "filePath", "language", "symbolType"]) {
		try {
			await qdrantRequest("PUT", `/collections/superroo_code_chunks/index`, {
				field_name: field,
				field_type: "keyword",
			})
		} catch {
			// index may already exist
		}
	}

	console.log("[indexer] Collection created")
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
	console.log("=".repeat(60))
	console.log("SuperRoo Repo Indexer CLI")
	console.log("=".repeat(60))
	console.log("Repo:    ", REPO_PATH)
	console.log("Project: ", PROJECT_ID)
	console.log("Qdrant:  ", QDRANT_URL)
	console.log("Ollama:  ", OLLAMA_URL, "model:", OLLAMA_MODEL)
	console.log()

	await ensureQdrantCollection()

	if (REINDEX_FILE) {
		// Single file re-index
		console.log("Re-indexing single file:", REINDEX_FILE)
		const result = await indexFile(REINDEX_FILE)
		if (result.error) {
			console.error("Error:", result.error)
			process.exit(1)
		}
		console.log("Indexed", result.chunks, "chunks")
		process.exit(0)
	}

	// Full repo index
	console.log("Scanning repository...")
	const files = walkDir(REPO_PATH, REPO_PATH)
	const indexableFiles = files.filter(isIndexable)
	console.log("Found", files.length, "files,", indexableFiles.length, "indexable")
	console.log()

	let totalChunks = 0
	let errors = 0
	const startTime = Date.now()

	for (let i = 0; i < indexableFiles.length; i++) {
		const file = indexableFiles[i]
		const relPath = file.replace(REPO_PATH + "/", "").replace(/\\/g, "/")
		process.stdout.write("\r[" + (i + 1) + "/" + indexableFiles.length + "] " + relPath.padEnd(60))

		const result = await indexFile(file)
		if (result.error) {
			errors++
		}
		totalChunks += result.chunks || 0
	}

	const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
	console.log()
	console.log()
	console.log("=".repeat(60))
	console.log("Indexing Complete")
	console.log("=".repeat(60))
	console.log("Files indexed: ", indexableFiles.length)
	console.log("Total chunks:  ", totalChunks)
	console.log("Errors:        ", errors)
	console.log("Elapsed:       ", elapsed + "s")
	console.log()
}

main().catch((err) => {
	console.error("Fatal:", err)
	process.exit(1)
})
