import { Pool, type PoolConfig } from "pg"
import type { MemoryChunkInput, RetrievedMemory, VectorStore } from "./types.js"

function toVectorLiteral(values: number[]): string {
	return `[${values.join(",")}]`
}

export interface PgVectorStoreOptions {
	connectionString?: string
	poolConfig?: PoolConfig
}

export class PgVectorStore implements VectorStore {
	private pool: Pool

	constructor(options: PgVectorStoreOptions = {}) {
		const connectionString = options.connectionString ?? process.env.DATABASE_URL
		if (!connectionString) throw new Error("DATABASE_URL is required for PgVectorStore")
		this.pool = new Pool({ connectionString, ...options.poolConfig })
	}

	async close(): Promise<void> {
		await this.pool.end()
	}

	async insertMemory(input: MemoryChunkInput, embedding: number[]): Promise<string> {
		const result = await this.pool.query(
			`INSERT INTO memory_chunks
			 (project_id, source_type, source_id, source_path, title, content, summary, tags, importance, confidence, trust_score, metadata, embedding)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::vector)
			 RETURNING id`,
			[
				input.projectId,
				input.sourceType,
				input.sourceId ?? null,
				input.sourcePath ?? null,
				input.title ?? null,
				input.content,
				input.summary ?? null,
				input.tags ?? [],
				input.importance ?? 3,
				input.confidence ?? 0.8,
				input.trustScore ?? 0.7,
				JSON.stringify(input.metadata ?? {}),
				toVectorLiteral(embedding),
			],
		)
		return result.rows[0].id as string
	}

	async searchMemory(
		projectId: string,
		embedding: number[],
		limit = 10,
		minSimilarity = 0.25,
	): Promise<RetrievedMemory[]> {
		const result = await this.pool.query(
			`SELECT id, title, content, source_type, source_path, metadata,
					1 - (embedding <=> $2::vector) AS similarity
			 FROM memory_chunks
			 WHERE project_id = $1
			   AND is_archived = false
			   AND is_deprecated = false
			   AND 1 - (embedding <=> $2::vector) >= $4
			 ORDER BY embedding <=> $2::vector
			 LIMIT $3`,
			[projectId, toVectorLiteral(embedding), limit, minSimilarity],
		)

		return result.rows.map((row: Record<string, unknown>) => ({
			id: row.id as string,
			title: row.title as string | undefined,
			content: row.content as string,
			sourceType: row.source_type as string,
			sourcePath: row.source_path as string | undefined,
			similarity: Number(row.similarity),
			metadata: (row.metadata as Record<string, unknown>) ?? {},
		}))
	}

	async searchCode(
		projectId: string,
		embedding: number[],
		limit = 8,
		minSimilarity = 0.25,
	): Promise<RetrievedMemory[]> {
		const result = await this.pool.query(
			`SELECT id, file_path as title, content, 'code_chunk' as source_type, file_path as source_path, metadata,
					1 - (embedding <=> $2::vector) AS similarity
			 FROM code_chunks
			 WHERE project_id = $1
			   AND 1 - (embedding <=> $2::vector) >= $4
			 ORDER BY embedding <=> $2::vector
			 LIMIT $3`,
			[projectId, toVectorLiteral(embedding), limit, minSimilarity],
		)

		return result.rows.map((row: Record<string, unknown>) => ({
			id: row.id as string,
			title: row.title as string,
			content: row.content as string,
			sourceType: row.source_type as string,
			sourcePath: row.source_path as string,
			similarity: Number(row.similarity),
			metadata: (row.metadata as Record<string, unknown>) ?? {},
		}))
	}

	async insertCodeChunk(args: {
		projectId: string
		filePath: string
		language: string
		content: string
		summary?: string
		metadata?: Record<string, unknown>
		embedding: number[]
	}): Promise<string> {
		const result = await this.pool.query(
			`INSERT INTO code_chunks (project_id, file_path, language, content, summary, metadata, embedding)
			 VALUES ($1,$2,$3,$4,$5,$6,$7::vector)
			 RETURNING id`,
			[
				args.projectId,
				args.filePath,
				args.language,
				args.content,
				args.summary ?? null,
				JSON.stringify(args.metadata ?? {}),
				toVectorLiteral(args.embedding),
			],
		)
		return result.rows[0].id as string
	}
}
