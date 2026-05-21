/**
 * MemoryService — Postgres + pgvector semantic memory for Central Brain v2.
 *
 * Provides CRUD, semantic search, duplicate detection, recall logging,
 * memory decay scoring, and auto-merge for duplicate memories.
 *
 * Schema: cloud/orchestrator/stores/brain/schema.sql
 */

class MemoryService {
	/**
	 * @param {import('pg').Pool} db - Postgres pool
	 * @param {import('./EmbeddingService').EmbeddingService} embeddings
	 */
	constructor(db, embeddings) {
		this.db = db
		this.embeddings = embeddings
	}

	/**
	 * Get the pg Pool class (lazy-loaded to avoid vitest module resolution issues).
	 * @returns {import('pg').Pool}
	 */
	static getPool() {
		if (!MemoryService._poolClass) {
			MemoryService._poolClass = require("pg").Pool
		}
		return MemoryService._poolClass
	}

	/**
	 * Create a new memory with embedding, duplicate detection, and auto-status.
	 * @param {object} memory
	 * @param {string} memory.projectId
	 * @param {string} [memory.sourceTaskId]
	 * @param {string} [memory.sourceRunId]
	 * @param {string} [memory.memoryType='lesson']
	 * @param {string} [memory.title]
	 * @param {string} memory.content
	 * @param {string[]} [memory.tags]
	 * @param {string[]} [memory.relatedFiles]
	 * @param {string[]} [memory.relatedAgents]
	 * @param {'low'|'medium'|'high'} [memory.riskLevel='low']
	 * @param {number} [memory.confidence=0.75]
	 * @param {number} [memory.importance=3]
	 * @param {string} [memory.status]
	 * @param {string} [memory.createdBy='system']
	 * @returns {Promise<string>} - The new memory ID
	 */
	async createMemory(memory) {
		const embedding = await this.embeddings.generate(`${memory.title || ""}\n${memory.content}`)
		const duplicate = embedding ? await this.findDuplicate(memory.projectId, embedding) : null

		// Auto-merge: if duplicate found with high similarity, update instead of creating
		if (duplicate && duplicate.similarity > 0.96) {
			await this.mergeInto(memory, duplicate.id)
			return duplicate.id
		}

		const status = memory.status || this._defaultStatus(memory)

		const result = await this.db.query(
			`INSERT INTO agent_memory
			 (project_id, source_task_id, source_run_id, memory_type, title, content, tags,
				related_files, related_agents, risk_level, confidence, importance, status,
				embedding, duplicate_of, created_by)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::vector,$15,$16)
			 RETURNING id`,
			[
				memory.projectId,
				memory.sourceTaskId || null,
				memory.sourceRunId || null,
				memory.memoryType || "lesson",
				memory.title || null,
				memory.content,
				memory.tags || [],
				memory.relatedFiles || [],
				memory.relatedAgents || [],
				memory.riskLevel || "low",
				memory.confidence ?? 0.75,
				memory.importance ?? 3,
				status,
				this.embeddings.toPgVector(embedding || new Array(this.embeddings.dimensions).fill(0)),
				duplicate?.id || null,
				memory.createdBy || "system",
			],
		)

		return result.rows[0].id
	}

	/**
	 * Semantic search for memories using cosine similarity.
	 * @param {object} input
	 * @param {string} input.projectId
	 * @param {string} input.query
	 * @param {number} [input.topK=8]
	 * @param {string[]} [input.tags]
	 * @param {'approved'|'candidate'|'archived'|'rejected'} [input.status='approved']
	 * @returns {Promise<object[]>}
	 */
	async searchMemory(input) {
		const embedding = await this.embeddings.generate(input.query)
		if (!embedding) {
			// Fall back to text search if embedding fails
			return this._textSearch(input)
		}

		const topK = input.topK || 8
		const status = input.status || "approved"

		const result = await this.db.query(
			`SELECT id, title, content, memory_type, tags, related_files, related_agents,
							risk_level, confidence, importance, use_count, last_used_at, status,
							duplicate_of, created_at, created_by,
							1 - (embedding <=> $2::vector) AS similarity
			 FROM agent_memory
			 WHERE project_id = $1
				 AND status = $3
				 AND ($4::text[] IS NULL OR tags && $4::text[])
			 ORDER BY embedding <=> $2::vector
			 LIMIT $5`,
			[input.projectId, this.embeddings.toPgVector(embedding), status, input.tags || null, topK],
		)

		return result.rows
	}

	/**
	 * Fallback text search when embeddings are unavailable.
	 */
	async _textSearch(input) {
		const topK = input.topK || 8
		const status = input.status || "approved"
		const terms = input.query
			.toLowerCase()
			.split(/\s+/)
			.filter((t) => t.length > 2)

		const result = await this.db.query(
			`SELECT id, title, content, memory_type, tags, related_files, related_agents,
							risk_level, confidence, importance, use_count, last_used_at, status,
							duplicate_of, created_at, created_by, 0 AS similarity
			 FROM agent_memory
			 WHERE project_id = $1
				 AND status = $2
				 AND ($3::text[] IS NULL OR tags && $3::text[])
				 AND ($4::text IS NULL OR to_tsvector('english', content || ' ' || COALESCE(title, '')) @@ plainto_tsquery('english', $4))
			 ORDER BY importance DESC, last_used_at DESC NULLS LAST
			 LIMIT $5`,
			[input.projectId, status, input.tags || null, terms.join(" ") || null, topK],
		)

		return result.rows
	}

	/**
	 * Log which memories were recalled during an agent run.
	 */
	async logRecall(params) {
		const { memoryIds, projectId, taskId, runId, agentName, model, similarities } = params
		for (const memoryId of memoryIds) {
			await this.db.query(
				`INSERT INTO memory_recall_logs
				 (memory_id, task_id, run_id, project_id, agent_name, model, similarity, injected)
				 VALUES ($1,$2,$3,$4,$5,$6,$7,true)`,
				[memoryId, taskId, runId, projectId, agentName, model || null, similarities?.[memoryId] || null],
			)
			await this.db.query(
				`UPDATE agent_memory SET use_count = use_count + 1, last_used_at = now() WHERE id = $1`,
				[memoryId],
			)
		}
	}

	/**
	 * List memories with filters, pagination, and decay-aware sorting.
	 */
	async listMemories(params) {
		const { projectId, q, status, tag, agent, riskLevel, minConfidence, minImportance, limit, offset } = params

		const conditions = ["project_id = $1"]
		const values = [projectId]
		let paramIdx = 2

		if (status) {
			conditions.push(`status = $${paramIdx++}`)
			values.push(status)
		}
		if (tag) {
			conditions.push(`$${paramIdx} = ANY(tags)`)
			values.push(tag)
			paramIdx++
		}
		if (agent) {
			conditions.push(`$${paramIdx} = ANY(related_agents)`)
			values.push(agent)
			paramIdx++
		}
		if (riskLevel) {
			conditions.push(`risk_level = $${paramIdx++}`)
			values.push(riskLevel)
		}
		if (minConfidence !== undefined) {
			conditions.push(`confidence >= $${paramIdx++}`)
			values.push(minConfidence)
		}
		if (minImportance !== undefined) {
			conditions.push(`importance >= $${paramIdx++}`)
			values.push(minImportance)
		}
		if (q) {
			conditions.push(
				`$${paramIdx}::text IS NULL OR content ILIKE '%' || $${paramIdx} || '%' OR title ILIKE '%' || $${paramIdx} || '%'`,
			)
			values.push(q)
			paramIdx++
		}

		const result = await this.db.query(
			`SELECT *,
							-- Decay score: memories lose relevance over time if unused
							CASE
								WHEN last_used_at IS NULL THEN importance * 0.5
								ELSE importance * (1.0 - LEAST(EXTRACT(EPOCH FROM (now() - last_used_at)) / 2592000.0, 0.9))
							END AS decay_score
			 FROM agent_memory
			 WHERE ${conditions.join(" AND ")}
			 ORDER BY decay_score DESC, importance DESC, created_at DESC
			 LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
			[...values, limit || 50, offset || 0],
		)
		return result.rows
	}

	/**
	 * Update memory status (approve, archive, reject).
	 */
	async updateStatus(id, status, approvedBy) {
		await this.db.query(
			`UPDATE agent_memory
			 SET status = $2, approved_by = COALESCE($3, approved_by),
					 approved_at = CASE WHEN $2 = 'approved' THEN now() ELSE approved_at END
			 WHERE id = $1`,
			[id, status, approvedBy || null],
		)
	}

	/**
	 * Partial update of a memory record.
	 */
	async updateMemory(id, patch) {
		const sets = []
		const values = [id]
		let idx = 2

		if (patch.title !== undefined) {
			sets.push(`title = $${idx++}`)
			values.push(patch.title)
		}
		if (patch.content !== undefined) {
			sets.push(`content = $${idx++}`)
			values.push(patch.content)
		}
		if (patch.tags !== undefined) {
			sets.push(`tags = $${idx++}`)
			values.push(patch.tags)
		}
		if (patch.importance !== undefined) {
			sets.push(`importance = $${idx++}`)
			values.push(patch.importance)
		}
		if (patch.confidence !== undefined) {
			sets.push(`confidence = $${idx++}`)
			values.push(patch.confidence)
		}
		if (patch.riskLevel !== undefined) {
			sets.push(`risk_level = $${idx++}`)
			values.push(patch.riskLevel)
		}

		if (sets.length === 0) return

		await this.db.query(`UPDATE agent_memory SET ${sets.join(", ")} WHERE id = $1`, values)
	}

	/**
	 * Delete a memory permanently.
	 */
	async deleteMemory(id) {
		await this.db.query("DELETE FROM agent_memory WHERE id = $1", [id])
	}

	/**
	 * Get recall logs for a specific memory.
	 */
	async getRecallLogs(memoryId, limit = 100) {
		const result = await this.db.query(
			`SELECT * FROM memory_recall_logs WHERE memory_id = $1 ORDER BY created_at DESC LIMIT $2`,
			[memoryId, limit],
		)
		return result.rows
	}

	/**
	 * Find potential duplicates by cosine similarity.
	 * Returns memories with similarity > 0.85.
	 */
	async findDuplicates(projectId, threshold = 0.85) {
		const result = await this.db.query(
			`SELECT a.id AS id1, b.id AS id2, a.title AS title1, b.title AS title2,
							1 - (a.embedding <=> b.embedding) AS similarity
			 FROM agent_memory a
			 JOIN agent_memory b ON a.id < b.id
			 WHERE a.project_id = $1 AND b.project_id = $1
				 AND a.status = 'approved' AND b.status = 'approved'
				 AND 1 - (a.embedding <=> b.embedding) > $2
			 ORDER BY similarity DESC`,
			[projectId, threshold],
		)
		return result.rows
	}

	/**
	 * Auto-merge duplicate: merge content from source into target, mark source as duplicate.
	 */
	async mergeInto(source, targetId) {
		// Merge tags
		await this.db.query(
			`UPDATE agent_memory
			 SET tags = ARRAY(SELECT DISTINCT unnest(array_cat(tags, $2::text[]))),
					 use_count = use_count + 1,
					 last_used_at = now()
			 WHERE id = $1`,
			[targetId, source.tags || []],
		)
	}

	/**
	 * Find the single closest duplicate for a given embedding.
	 */
	async findDuplicate(projectId, embedding) {
		const result = await this.db.query(
			`SELECT id, 1 - (embedding <=> $2::vector) AS similarity
			 FROM agent_memory
			 WHERE project_id = $1
			 ORDER BY embedding <=> $2::vector
			 LIMIT 1`,
			[projectId, this.embeddings.toPgVector(embedding)],
		)
		const row = result.rows[0]
		return row && Number(row.similarity) > 0.94 ? row : null
	}

	/**
	 * Apply memory decay: reduce importance of memories unused for >90 days.
	 * Returns count of affected memories.
	 */
	async applyDecay(projectId) {
		const result = await this.db.query(
			`UPDATE agent_memory
			 SET importance = GREATEST(1, importance - 1)
			 WHERE project_id = $1
				 AND status = 'approved'
				 AND (last_used_at IS NULL OR last_used_at < now() - INTERVAL '90 days')
				 AND importance > 1`,
			[projectId],
		)
		return result.rowCount || 0
	}

	/**
	 * Get agent scores for the dashboard.
	 */
	async getAgentScores(projectId) {
		const result = await this.db.query(
			`SELECT *,
							CASE WHEN success_count + failure_count = 0 THEN 0
									 ELSE success_count::numeric / (success_count + failure_count)
							END AS success_rate
			 FROM agent_scores
			 WHERE project_id = $1
			 ORDER BY success_rate DESC, last_used_at DESC`,
			[projectId],
		)
		return result.rows
	}

	/**
	 * Get brain events for the dashboard.
	 */
	async getBrainEvents(projectId, limit = 100) {
		const result = await this.db.query(
			`SELECT * FROM brain_events WHERE project_id = $1 ORDER BY created_at DESC LIMIT $2`,
			[projectId, limit],
		)
		return result.rows
	}

	/**
	 * Determine default status based on risk and confidence.
	 */
	_defaultStatus(memory) {
		const requireApproval = process.env.MEMORY_APPROVAL_REQUIRED !== "false"
		const risky = memory.riskLevel === "high" || (memory.confidence ?? 0) < 0.7
		return requireApproval || risky ? "candidate" : "approved"
	}
}

module.exports = { MemoryService }
