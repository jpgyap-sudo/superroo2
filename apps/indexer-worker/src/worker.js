/**
 * Indexer Worker — Watches for git changes and re-indexes changed files
 * in Qdrant via Ollama embeddings.
 *
 * Runs as a long-lived process alongside the daemon.
 *
 * Usage:
 *   node src/worker.js [--repo /path/to/repo] [--project superroo2]
 *
 * @module apps/indexer-worker/src/worker
 */

import { watch } from "chokidar"
import { relative, resolve } from "node:path"
import { readFileSync, existsSync } from "node:fs"
import { createServer } from "node:http"
import { createHash } from "node:crypto"

// ── Configuration ──────────────────────────────────────────────────────────

const REPO_PATH = resolve(process.argv[2] || process.env.REPO_PATH || process.cwd())
const PROJECT_ID = process.argv[3] || process.env.PROJECT_ID || "superroo2"
const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333"
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434"
const OLLAMA_MODEL = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text"
const WATCHER_PORT = parseInt(process.env.WATCHER_PORT || "3418", 10)
const DEBOUNCE_MS = parseInt(process.env.DEBOUNCE_MS || "2000", 10)

// ── State ──────────────────────────────────────────────────────────────────

const queue = new Set()
let processing = false
let health = { ok: true, uptime: 0, indexedFiles: 0, indexedChunks: 0, errors: 0 }
const startTime = Date.now()

// ── Qdrant Client ──────────────────────────────────────────────────────────

async function qdrantRequest(method, path, body) {
	const url = QDRANT_URL + path
	const res = await fetch(url, {
		method,
		headers: { "content-type": "application/json" },
		body: body ? JSON.stringify(body) : undefined,
	})
	return res.json()
}

async function ensureQdrantCollection() {
	const check = await qdrantRequest("GET", "/collections/superroo_code_chunks")
	if (check.result) return

	await qdrantRequest("PUT", "/collections/superroo_code_chunks", {
		name: "superroo_code_chunks",
		vectors: { size: 768, distance: "Cosine" },
		hnsw_config: { m: 16, ef_construct: 200 },
	})

	// Create payload indexes
	for (const field of ["projectId", "filePath", "language", "symbolType"]) {
		await qdrantRequest("PUT", `/collections/superroo_code_chunks/index`, {
			field_name: field,
			field_type: "keyword",
		})
	}
}

// ── Embedding ──────────────────────────────────────────────────────────────

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

// ── Chunker ────────────────────────────────────────────────────────────────

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

const SKIP_DIRS = ["node_modules", ".git", "dist", "build", ".next", ".turbo", "coverage"]
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

	// Simple boundary detection for structured languages
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
	const relPath = relative(REPO_PATH, filePath).replace(/\\/g, "/")
	if (!isIndexable(relPath)) return { chunks: 0 }

	try {
		const content = readFileSync(filePath, "utf-8")
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

// ── Queue processor ────────────────────────────────────────────────────────

async function processQueue() {
	if (processing || queue.size === 0) return
	processing = true

	const files = Array.from(queue)
	queue.clear()

	console.log("[indexer] Processing", files.length, "changed files")

	for (const file of files) {
		const result = await indexFile(file)
		if (result.error) {
			health.errors++
		} else {
			health.indexedFiles++
			health.indexedChunks += result.chunks
		}
	}

	processing = false

	// Check if more files were queued while processing
	if (queue.size > 0) {
		setTimeout(processQueue, 100)
	}
}

function enqueue(filePath) {
	queue.add(filePath)
	if (!processing) {
		setTimeout(processQueue, DEBOUNCE_MS)
	}
}

// ── File watcher ───────────────────────────────────────────────────────────

function startWatcher() {
	console.log("[indexer] Watching", REPO_PATH)
	console.log("[indexer] Qdrant:", QDRANT_URL)
	console.log("[indexer] Ollama:", OLLAMA_URL, "model:", OLLAMA_MODEL)

	const watcher = watch(REPO_PATH, {
		ignored: /(^|[\/\\])(node_modules|\.git|dist|build|\.next|\.turbo|coverage|__pycache__)([\/\\]|$)/,
		persistent: true,
		ignoreInitial: true,
		awaitWriteFinish: {
			stabilityThreshold: 500,
			pollInterval: 100,
		},
	})

	watcher.on("change", enqueue)
	watcher.on("add", enqueue)
	watcher.on("unlink", async (filePath) => {
		const relPath = relative(REPO_PATH, filePath).replace(/\\/g, "/")
		await qdrantRequest("POST", "/collections/superroo_code_chunks/points/delete", {
			filter: {
				must: [
					{ key: "filePath", match: { value: relPath } },
					{ key: "projectId", match: { value: PROJECT_ID } },
				],
			},
		})
	})

	console.log("[indexer] Watcher started")
}

// ── Health HTTP server ─────────────────────────────────────────────────────

function startHealthServer() {
	const server = createServer((req, res) => {
		if (req.method === "GET" && req.url === "/health") {
			res.writeHead(200, { "content-type": "application/json" })
			res.end(JSON.stringify({
				ok: true,
				uptime: Date.now() - startTime,
				indexedFiles: health.indexedFiles,
				indexedChunks: health.indexedChunks,
				errors: health.errors,
				queueSize: queue.size,
				processing,
				repo: REPO_PATH,
				project: PROJECT_ID,
			}))
			return
		}

		if (req.method === "POST" && req.url === "/reindex") {
			let body = ""
			req.on("data", (chunk) => body += chunk)
			req.on("end", async () => {
				try {
					const { file } = JSON.parse(body)
					if (file) {
						const fullPath = resolve(REPO_PATH, file)
						enqueue(fullPath)
						res.writeHead(202, { "content-type": "application/json" })
						res.end(JSON.stringify({ ok: true, queued: true, file }))
					} else {
						res.writeHead(400, { "content-type": "application/json" })
						res.end(JSON.stringify({ ok: false, error: "missing file" }))
					}
				} catch {
					res.writeHead(400, { "content-type": "application/json" })
					res.end(JSON.stringify({ ok: false, error: "invalid json" }))
				}
			})
			return
		}

		res.writeHead(404)
		res.end()
	})

	server.listen(WATCHER_PORT, () => {
		console.log("[indexer] Health server on port", WATCHER_PORT)
	})
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
	console.log("[indexer] Starting SuperRoo Indexer Worker")
	console.log("[indexer] Repo:", REPO_PATH)
	console.log("[indexer] Project:", PROJECT_ID)

	await ensureQdrantCollection()
	startWatcher()
	startHealthServer()
}

main().catch((err) => {
	console.error("[indexer] Fatal:", err)
	process.exit(1)
})
