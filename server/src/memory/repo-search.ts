/**
 * Repo Search — High-level search API for querying the indexed codebase
 * via Qdrant vector search.
 *
 * @module server/src/memory/repo-search
 */

import { QdrantClient, type QdrantSearchResult } from "./qdrant-client.js"

export interface RepoSearchOptions {
	qdrantUrl?: string
	ollamaUrl?: string
	ollamaModel?: string
	topK?: number
	scoreThreshold?: number
	projectId?: string
	language?: string
	symbolType?: string
	filePath?: string
}

export interface RepoSearchResult {
	query: string
	results: Array<{
		filePath: string
		language: string
		symbolName?: string
		symbolType?: string
		content: string
		summary?: string
		startLine: number
		endLine: number
		score: number
	}>
	totalResults: number
	elapsedMs: number
}

export interface RepoSearchContext {
	contextText: string
	matches: RepoSearchResult["results"]
	estimatedTokens: number
}

/**
 * Create an embedding for a search query using Ollama.
 */
async function createQueryEmbedding(
	query: string,
	ollamaUrl: string,
	model: string,
): Promise<number[]> {
	const res = await fetch(`${ollamaUrl}/api/embeddings`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ model, prompt: query.slice(0, 8000) }),
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
 * Search the indexed codebase for code relevant to a query.
 */
export async function searchCodebase(
	query: string,
	options: RepoSearchOptions = {},
): Promise<RepoSearchResult> {
	const startTime = Date.now()
	const {
		qdrantUrl,
		ollamaUrl = process.env.OLLAMA_URL ?? "http://localhost:11434",
		ollamaModel = process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text",
		topK = 10,
		scoreThreshold = 0.25,
		projectId,
		language,
		symbolType,
		filePath,
	} = options

	const qdrant = new QdrantClient({ url: qdrantUrl })

	// Create query embedding
	let vector: number[]
	try {
		vector = await createQueryEmbedding(query, ollamaUrl, ollamaModel)
	} catch (err) {
		return {
			query,
			results: [],
			totalResults: 0,
			elapsedMs: Date.now() - startTime,
		}
	}

	// Build filter
	const must: Array<Record<string, unknown>> = []
	if (projectId) {
		must.push({ key: "projectId", match: { value: projectId } })
	}
	if (language) {
		must.push({ key: "language", match: { value: language } })
	}
	if (symbolType) {
		must.push({ key: "symbolType", match: { value: symbolType } })
	}
	if (filePath) {
		must.push({ key: "filePath", match: { value: filePath } })
	}

	const filter = must.length > 0 ? { must } : undefined

	// Search Qdrant
	const results = await qdrant.search(vector, {
		limit: topK,
		scoreThreshold,
		filter,
	})

	const mapped = results.map((r: QdrantSearchResult) => ({
		filePath: r.payload.filePath,
		language: r.payload.language,
		symbolName: r.payload.symbolName,
		symbolType: r.payload.symbolType,
		content: r.payload.content,
		summary: r.payload.summary,
		startLine: r.payload.startLine,
		endLine: r.payload.endLine,
		score: r.score,
	}))

	return {
		query,
		results: mapped,
		totalResults: mapped.length,
		elapsedMs: Date.now() - startTime,
	}
}

/**
 * Build a context string from search results, suitable for injecting into
 * an LLM prompt.
 */
export function buildSearchContext(
	query: string,
	results: RepoSearchResult["results"],
	maxChars = 8000,
): RepoSearchContext {
	const escapedQuery = query.replace(/[""]/g, """)
	const parts: string[] = []
	parts.push("<repo_context query=\"" + escapedQuery + "\">")

	let totalChars = parts[0].length + 10

	for (const r of results) {
		const symbolAttr = r.symbolName ? " symbol=\"" + r.symbolName + "\"" : ""
		const header = "\n<file path=\"" + r.filePath + "\" language=\"" + r.language + "\"" + symbolAttr + " score=\"" + r.score.toFixed(3) + "\">"
		const footer = "\n</file>"

		let content: string
		if (r.summary) {
			content = "\n<summary>" + r.summary + "</summary>\n<code>\n" + r.content + "\n</code>"
		} else {
			content = "\n<code>\n" + r.content + "\n</code>"
		}

		const entry = header + content + "\n" + footer
		if (totalChars + entry.length > maxChars) break

		parts.push(entry)
		totalChars += entry.length
	}

	parts.push("\n</repo_context>")

	const contextText = parts.join("")

	return {
		contextText,
		matches: results,
		estimatedTokens: Math.ceil(contextText.length / 4),
	}
}

/**
 * One-shot: search + build context. This is the main entry point for
 * agents that want to augment their prompt with relevant code.
 */
export async function searchAndBuildContext(
	query: string,
	options: RepoSearchOptions & { maxContextChars?: number } = {},
): Promise<RepoSearchContext> {
	const searchResult = await searchCodebase(query, options)
	return buildSearchContext(query, searchResult.results, options.maxContextChars ?? 8000)
}
