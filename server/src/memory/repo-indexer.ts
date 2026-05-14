/**
 * Repo Indexer — Scans repository files, chunks them, creates embeddings,
 * and stores them in Qdrant vector DB.
 *
 * @module server/src/memory/repo-indexer
 */

import { readFile, stat } from "node:fs/promises"
import { join, relative, resolve } from "node:path"
import { readdirSync } from "node:fs"
import { createHash } from "node:crypto"
import { QdrantClient, type QdrantPoint } from "./qdrant-client.js"
import { chunkFile, isIndexableFile, detectLanguage } from "./chunker.js"

export interface IndexerOptions {
	repoPath: string
	projectId: string
	qdrantUrl?: string
	qdrantApiKey?: string
	ollamaUrl?: string
	ollamaModel?: string
	batchSize?: number
	concurrency?: number
	gitSha?: string
	onProgress?: (progress: IndexProgress) => void
}

export interface IndexProgress {
	totalFiles: number
	processedFiles: number
	totalChunks: number
	indexedChunks: number
	currentFile?: string
	errors: number
	elapsedMs: number
}

export interface IndexResult {
	ok: boolean
	totalFiles: number
	indexedFiles: number
	totalChunks: number
	indexedChunks: number
	errors: number
	elapsedMs: number
	error?: string
}

export interface IndexerStats {
	lastIndexed: string | null
	totalFiles: number
	totalChunks: number
	fileCountByLanguage: Record<string, number>
}

/**
 * Walk a directory recursively and return all indexable file paths.
 */
function walkDir(dir: string, basePath: string): string[] {
	const files: string[] = []
	try {
		const entries = readdirSync(dir, { withFileTypes: true })
		for (const entry of entries) {
			const fullPath = join(dir, entry.name)
			const relPath = relative(basePath, fullPath).replace(/\\/g, "/")

			if (entry.isDirectory()) {
				// Skip hidden directories and common non-source dirs
				if (entry.name.startsWith(".")) continue
				if (entry.name === "node_modules") continue
				if (entry.name === "dist") continue
				if (entry.name === "build") continue
				if (entry.name === ".next") continue
				if (entry.name === ".turbo") continue
				if (entry.name === "coverage") continue
				if (entry.name === "__pycache__") continue
				if (entry.name === ".venv") continue
				if (entry.name === "venv") continue
				if (entry.name === "vendor") continue
				files.push(...walkDir(fullPath, basePath))
			} else if (entry.isFile() && isIndexableFile(relPath)) {
				files.push(fullPath)
			}
		}
	} catch {
		// Permission denied or missing directory — skip
	}
	return files
}

/**
 * Compute a deterministic point ID from file path, start line, and project.
 */
function pointId(projectId: string, filePath: string, startLine: number): string {
	const hash = createHash("sha256")
		.update(`${projectId}:${filePath}:${startLine}`)
		.digest("hex")
		.slice(0, 32)
	return hash
}

/**
 * Create an embedding for a text chunk using Ollama.
 */
async function createEmbedding(
	text: string,
	ollamaUrl: string,
	model: string,
): Promise<number[]> {
	const res = await fetch(`${ollamaUrl}/api/embeddings`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ model, prompt: text.slice(0, 8000) }),
	})

	if (!res.ok) {
		const body = await res.text()
		throw new Error(`Ollama embedding failed: ${res.status} ${body}`)
	}

	const json = (await res.json()) as { embedding?: number[]; error?: string }
	if (json.error) throw new Error(`Ollama error: ${json.error}`)
	if (!json.embedding || json.embedding.length === 0) {
		throw new Error("Empty embedding returned")
	}
	return json.embedding
}

/**
 * Index a single file: read, chunk, embed, and store in Qdrant.
 */
async function indexFile(
	filePath: string,
	relPath: string,
	projectId: string,
	qdrant: QdrantClient,
	ollamaUrl: string,
	ollamaModel: string,
	gitSha?: string,
): Promise<{ chunks: number; error?: string }> {
	try {
		const content = await readFile(filePath, "utf-8")
		const result = chunkFile(relPath, content)

		if (result.chunks.length === 0) {
			return { chunks: 0 }
		}

		// Get file stats for lastModified
		const fileStat = await stat(filePath)

		// Create embeddings for each chunk in parallel
		const points: QdrantPoint[] = []
		const embeddingPromises = result.chunks.map(async (chunk) => {
			const embedText = `FILE: ${relPath}\n${chunk.symbolName ? `SYMBOL: ${chunk.symbolName}\n` : ""}${chunk.content}`
			const vector = await createEmbedding(embedText, ollamaUrl, ollamaModel)
			return {
				chunk,
				vector,
			}
		})

		const embedded = await Promise.all(embeddingPromises)

		for (const { chunk, vector } of embedded) {
			points.push({
				id: pointId(projectId, relPath, chunk.startLine),
				vector,
				payload: {
					projectId,
					filePath: relPath,
					language: result.language,
					symbolName: chunk.symbolName,
					symbolType: chunk.symbolType,
					content: chunk.content,
					summary: chunk.summary,
					startLine: chunk.startLine,
					endLine: chunk.endLine,
					chunkIndex: chunk.chunkIndex,
					totalChunks: chunk.totalChunks,
					gitSha: gitSha,
					lastModified: fileStat.mtime.toISOString(),
				},
			})
		}

		// Upsert in batches
		const batchSize = 50
		for (let i = 0; i < points.length; i += batchSize) {
			const batch = points.slice(i, i + batchSize)
			const result = await qdrant.upsert(batch)
			if (!result.ok) {
				return { chunks: 0, error: result.error }
			}
		}

		return { chunks: points.length }
	} catch (err) {
		return { chunks: 0, error: err instanceof Error ? err.message : String(err) }
	}
}

/**
 * Index an entire repository.
 */
export async function indexRepository(options: IndexerOptions): Promise<IndexResult> {
	const startTime = Date.now()
	const {
		repoPath,
		projectId,
		qdrantUrl,
		ollamaUrl = process.env.OLLAMA_URL ?? "http://localhost:11434",
		ollamaModel = process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text",
		batchSize = 50,
		gitSha,
		onProgress,
	} = options

	const qdrant = new QdrantClient({ url: qdrantUrl })

	// Ensure Qdrant collection exists
	try {
		await qdrant.ensureCollection()
	} catch (err) {
		return {
			ok: false,
			totalFiles: 0,
			indexedFiles: 0,
			totalChunks: 0,
			indexedChunks: 0,
			errors: 1,
			elapsedMs: Date.now() - startTime,
			error: `Failed to ensure Qdrant collection: ${err instanceof Error ? err.message : String(err)}`,
		}
	}

	// Walk the repo
	const absPath = resolve(repoPath)
	const files = walkDir(absPath, absPath)

	if (files.length === 0) {
		return {
			ok: true,
			totalFiles: 0,
			indexedFiles: 0,
			totalChunks: 0,
			indexedChunks: 0,
			errors: 0,
			elapsedMs: Date.now() - startTime,
		}
	}

	// Delete existing points for this project (full re-index)
	await qdrant.deleteByProject(projectId)

	// Index files
	let indexedFiles = 0
	let totalChunks = 0
	let indexedChunks = 0
	let errors = 0

	for (let i = 0; i < files.length; i++) {
		const filePath = files[i]
		const relPath = relative(absPath, filePath).replace(/\\/g, "/")

		const progress: IndexProgress = {
			totalFiles: files.length,
			processedFiles: i,
			totalChunks,
			indexedChunks,
			currentFile: relPath,
			errors,
			elapsedMs: Date.now() - startTime,
		}
		onProgress?.(progress)

		const result = await indexFile(filePath, relPath, projectId, qdrant, ollamaUrl, ollamaModel, gitSha)

		if (result.error) {
			errors++
			continue
		}

		indexedFiles++
		totalChunks += result.chunks
		indexedChunks += result.chunks
	}

	const finalProgress: IndexProgress = {
		totalFiles: files.length,
		processedFiles: files.length,
		totalChunks,
		indexedChunks,
		errors,
		elapsedMs: Date.now() - startTime,
	}
	onProgress?.(finalProgress)

	return {
		ok: true,
		totalFiles: files.length,
		indexedFiles,
		totalChunks,
		indexedChunks,
		errors,
		elapsedMs: Date.now() - startTime,
	}
}

/**
 * Re-index a single changed file (for incremental updates).
 */
export async function reindexFile(
	filePath: string,
	projectId: string,
	repoPath: string,
	options: {
		qdrantUrl?: string
		ollamaUrl?: string
		ollamaModel?: string
		gitSha?: string
	} = {},
): Promise<{ ok: boolean; chunks: number; error?: string }> {
	const absRepoPath = resolve(repoPath)
	const relPath = relative(absRepoPath, filePath).replace(/\\/g, "/")

	if (!isIndexableFile(relPath)) {
		return { ok: true, chunks: 0 }
	}

	const qdrant = new QdrantClient({ url: options.qdrantUrl })
	const ollamaUrl = options.ollamaUrl ?? process.env.OLLAMA_URL ?? "http://localhost:11434"
	const ollamaModel = options.ollamaModel ?? process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text"

	// Delete old points for this file
	await qdrant.deleteByFile(relPath, projectId)

	// Re-index
	const result = await indexFile(filePath, relPath, projectId, qdrant, ollamaUrl, ollamaModel, options.gitSha)

	return {
		ok: !result.error,
		chunks: result.chunks,
		error: result.error,
	}
}

/**
 * Get indexing statistics for a project.
 */
export async function getIndexStats(
	projectId: string,
	options: { qdrantUrl?: string } = {},
): Promise<IndexerStats | null> {
	const qdrant = new QdrantClient({ url: options.qdrantUrl })

	const info = await qdrant.info()
	if (!info) return null

	// Search with empty vector to get all points (limited)
	const results = await qdrant.search(new Array(info.vectorSize).fill(0), {
		limit: 10000,
		scoreThreshold: 0,
		filter: {
			must: [{ key: "projectId", match: { value: projectId } }],
		},
	})

	const fileCountByLanguage: Record<string, number> = {}
	const uniqueFiles = new Set<string>()
	let lastIndexed: string | null = null

	for (const r of results) {
		uniqueFiles.add(r.payload.filePath)
		fileCountByLanguage[r.payload.language] = (fileCountByLanguage[r.payload.language] ?? 0) + 1
		if (r.payload.lastModified && (!lastIndexed || r.payload.lastModified > lastIndexed)) {
			lastIndexed = r.payload.lastModified
		}
	}

	return {
		lastIndexed,
		totalFiles: uniqueFiles.size,
		totalChunks: results.length,
		fileCountByLanguage,
	}
}
