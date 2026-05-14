/**
 * Qdrant Vector DB Client for SuperRoo Repo Indexing
 *
 * Provides high-performance vector storage and search for code chunks
 * using Qdrant. Designed as an alternative/addition to pgvector for
 * large-scale codebase indexing.
 *
 * @module server/src/memory/qdrant-client
 */

export interface QdrantPoint {
	id: string
	vector: number[]
	payload: {
		projectId: string
		filePath: string
		language: string
		symbolName?: string
		symbolType?: string
		content: string
		summary?: string
		startLine: number
		endLine: number
		chunkIndex: number
		totalChunks: number
		gitSha?: string
		lastModified?: string
		metadata?: Record<string, unknown>
	}
}

export interface QdrantSearchResult {
	id: string
	score: number
	payload: QdrantPoint["payload"]
}

export interface QdrantClientOptions {
	url?: string
	apiKey?: string
	collectionName?: string
	vectorSize?: number
	recreate?: boolean
}

export class QdrantClient {
	private readonly baseUrl: string
	private readonly apiKey: string | undefined
	private readonly collectionName: string
	private readonly vectorSize: number

	constructor(options: QdrantClientOptions = {}) {
		this.baseUrl =
			options.url ?? process.env.QDRANT_URL ?? process.env.QDRANT_HOST ?? "http://localhost:6333"
		this.apiKey = options.apiKey ?? process.env.QDRANT_API_KEY
		this.collectionName = options.collectionName ?? process.env.QDRANT_COLLECTION ?? "superroo_code_chunks"
		this.vectorSize = options.vectorSize ?? Number(process.env.QDRANT_VECTOR_SIZE || "768")
	}

	private get headers(): Record<string, string> {
		const h: Record<string, string> = { "content-type": "application/json" }
		if (this.apiKey) h["api-key"] = this.apiKey
		return h
	}

	private async request<T>(
		method: string,
		path: string,
		body?: unknown,
	): Promise<{ ok: boolean; result?: T; error?: string }> {
		try {
			const res = await fetch(`${this.baseUrl}${path}`, {
				method,
				headers: this.headers,
				body: body ? JSON.stringify(body) : undefined,
			})
			const json = (await res.json()) as { ok?: boolean; result?: T; status?: { error?: string } }
			if (!res.ok) {
				return { ok: false, error: json.status?.error ?? `HTTP ${res.status}` }
			}
			return { ok: true, result: json.result }
		} catch (err) {
			return { ok: false, error: err instanceof Error ? err.message : String(err) }
		}
	}

	/**
	 * Ensure the collection exists with the correct vector configuration.
	 * Creates it if missing, or recreates if `recreate` option was set.
	 */
	async ensureCollection(): Promise<void> {
		// Check if collection exists
		const existing = await this.request<{ status?: string }>("GET", `/collections/${this.collectionName}`)
		if (existing.ok) {
			// Collection exists — skip creation
			return
		}

		// Create collection with HNSW index
		const created = await this.request("PUT", `/collections/${this.collectionName}`, {
			name: this.collectionName,
			vectors: {
				size: this.vectorSize,
				distance: "Cosine",
			},
			hnsw_config: {
				m: 16,
				ef_construct: 200,
				full_scan_threshold: 10000,
			},
			optimizers_config: {
				memmap_threshold_kb: 20000,
				default_segment_number: 2,
			},
		})

		if (!created.ok) {
			throw new Error(`Failed to create Qdrant collection: ${created.error}`)
		}

		// Create payload indexes for filtering
		await this.request("PUT", `/collections/${this.collectionName}/index`, {
			field_name: "projectId",
			field_type: "keyword",
		})
		await this.request("PUT", `/collections/${this.collectionName}/index`, {
			field_name: "filePath",
			field_type: "keyword",
		})
		await this.request("PUT", `/collections/${this.collectionName}/index`, {
			field_name: "language",
			field_type: "keyword",
		})
		await this.request("PUT", `/collections/${this.collectionName}/index`, {
			field_name: "symbolType",
			field_type: "keyword",
		})
	}

	/**
	 * Upsert (insert or update) points into the collection.
	 * Qdrant handles deduplication by point ID.
	 */
	async upsert(points: QdrantPoint[]): Promise<{ ok: boolean; count: number; error?: string }> {
		if (points.length === 0) return { ok: true, count: 0 }

		const result = await this.request<{ operation_id?: number; status?: string }>(
			"PUT",
			`/collections/${this.collectionName}/points`,
			{
				points: points.map((p) => ({
					id: p.id,
					vector: p.vector,
					payload: p.payload,
				})),
			},
		)

		if (!result.ok) {
			return { ok: false, count: 0, error: result.error }
		}
		return { ok: true, count: points.length }
	}

	/**
	 * Search for similar vectors in the collection.
	 */
	async search(
		vector: number[],
		options: {
			limit?: number
			scoreThreshold?: number
			filter?: Record<string, unknown>
		} = {},
	): Promise<QdrantSearchResult[]> {
		const limit = options.limit ?? 10
		const scoreThreshold = options.scoreThreshold ?? 0.25

		const body: Record<string, unknown> = {
			vector,
			limit,
			score_threshold: scoreThreshold,
			with_payload: true,
		}

		if (options.filter) {
			body.filter = options.filter
		}

		const result = await this.request<Array<{ id: string; score: number; payload: QdrantPoint["payload"] }>>(
			"POST",
			`/collections/${this.collectionName}/points/search`,
			body,
		)

		if (!result.ok || !result.result) {
			return []
		}

		return result.result.map((r) => ({
			id: r.id,
			score: r.score,
			payload: r.payload,
		}))
	}

	/**
	 * Search by file path prefix (exact match on filePath field).
	 */
	async searchByFile(
		filePath: string,
		projectId?: string,
	): Promise<QdrantSearchResult[]> {
		const filter: Record<string, unknown> = {
			must: [{ key: "filePath", match: { value: filePath } }],
		}
		if (projectId) {
			;(filter.must as Array<Record<string, unknown>>).push({
				key: "projectId",
				match: { value: projectId },
			})
		}

		const result = await this.request<Array<{ id: string; score: number; payload: QdrantPoint["payload"] }>>(
			"POST",
			`/collections/${this.collectionName}/points/search`,
			{
				vector: new Array(this.vectorSize).fill(0),
				limit: 100,
				filter,
				with_payload: true,
			},
		)

		if (!result.ok || !result.result) return []
		return result.result.map((r) => ({
			id: r.id,
			score: r.score,
			payload: r.payload,
		}))
	}

	/**
	 * Delete all points for a given file path (used when re-indexing a changed file).
	 */
	async deleteByFile(filePath: string, projectId: string): Promise<boolean> {
		const result = await this.request(
			"POST",
			`/collections/${this.collectionName}/points/delete`,
			{
				filter: {
					must: [
						{ key: "filePath", match: { value: filePath } },
						{ key: "projectId", match: { value: projectId } },
					],
				},
			},
		)
		return result.ok
	}

	/**
	 * Delete all points for a project (used when full re-index).
	 */
	async deleteByProject(projectId: string): Promise<boolean> {
		const result = await this.request(
			"POST",
			`/collections/${this.collectionName}/points/delete`,
			{
				filter: {
					must: [{ key: "projectId", match: { value: projectId } }],
				},
			},
		)
		return result.ok
	}

	/**
	 * Get collection info (point count, vector size, etc.).
	 */
	async info(): Promise<{
		pointsCount: number
		vectorSize: number
		status?: string
	} | null> {
		const result = await this.request<{
			status?: string
			vectors_count?: number
			points_count?: number
			config?: { params?: { vectors?: { size?: number } } }
		}>("GET", `/collections/${this.collectionName}`)

		if (!result.ok || !result.result) return null

		return {
			pointsCount: result.result.points_count ?? 0,
			vectorSize: result.result.config?.params?.vectors?.size ?? this.vectorSize,
			status: result.result.status,
		}
	}

	/**
	 * Health check — ping Qdrant.
	 */
	async health(): Promise<boolean> {
		const result = await this.request<{ version?: string }>("GET", "/")
		return result.ok
	}
}
