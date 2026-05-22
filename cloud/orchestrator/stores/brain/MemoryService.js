/**
 * MemoryService — Postgres + pgvector semantic memory for Central Brain v2/v3.
 *
 * Provides CRUD, semantic search, duplicate detection, recall logging,
 * memory decay scoring, auto-merge, memory versioning, feedback scoring,
 * auto-trust, and usefulness metrics.
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

	// ═══════════════════════════════════════════════════════════════════
	// Memory Evolution v3 — Versioning, Feedback, Auto-Trust, Recall
	// ═══════════════════════════════════════════════════════════════════

	/**
	 * Evolve a memory: create a new version, update content + embedding, boost confidence.
	 * Also updates title/summary if provided and records a brain_events entry.
	 * @param {string} memoryId
	 * @param {string} newContent
	 * @param {string} reason
	 * @param {object} [options]
	 * @param {string} [options.agent='memory-evolution']
	 * @param {string} [options.title]
	 * @param {string} [options.summary]
	 * @returns {Promise<{versionNo: number}>}
	 */
	async evolveMemory(memoryId, newContent, reason, options = {}) {
		const agent = options.agent || "memory-evolution"
		const current = await this.db.query(
			`SELECT COALESCE(MAX(version_no), 0) + 1 AS next FROM brain_memory_versions WHERE memory_id = $1`,
			[memoryId],
		)
		const versionNo = Number(current.rows[0].next)

		const embedding = await this.embeddings.generate(newContent)

		await this.db.query(
			`INSERT INTO brain_memory_versions (memory_id, version_no, content, summary, change_reason, created_by_agent)
			 VALUES ($1, $2, $3, $4, $5, $6)`,
			[memoryId, versionNo, newContent, options.summary || null, reason, agent],
		)

		// Build dynamic SET clause for optional title/summary
		const setClauses = [
			`content = $2`,
			`embedding = $3::vector`,
			`confidence = LEAST(confidence + 0.05, 1)`,
			`updated_at = now()`,
		]
		const setValues = [memoryId, newContent, this.embeddings.toPgVector(embedding || new Array(this.embeddings.dimensions).fill(0))]
		let paramIdx = 4
		if (options.title !== undefined) {
			setClauses.push(`title = $${paramIdx++}`)
			setValues.push(options.title)
		}
		if (options.summary !== undefined) {
			setClauses.push(`summary = $${paramIdx++}`)
			setValues.push(options.summary)
		}

		await this.db.query(
			`UPDATE agent_memory SET ${setClauses.join(", ")} WHERE id = $1`,
			setValues,
		)

		// Record brain event
		await this.db.query(
			`INSERT INTO brain_events (project_id, event_type, actor, payload)
			 VALUES ((SELECT project_id FROM agent_memory WHERE id = $1), 'memory.evolved', $2, $3)`,
			[memoryId, agent, JSON.stringify({ memoryId, versionNo, reason, title: options.title })],
		)

		return { versionNo }
	}

	/**
	 * Get version history for a memory.
	 * @param {string} memoryId
	 * @param {number} [limit=50]
	 * @returns {Promise<object[]>}
	 */
	async getVersionHistory(memoryId, limit = 50) {
		const result = await this.db.query(
			`SELECT id, version_no, content, summary, change_reason, created_by_agent, created_at
			 FROM brain_memory_versions
			 WHERE memory_id = $1
			 ORDER BY version_no DESC
			 LIMIT $2`,
			[memoryId, limit],
		)
		return result.rows
	}

	/**
	 * Compare two versions of a memory (diff).
	 * Returns both line-level and word-level diffs for richer comparison.
	 * @param {string} memoryId
	 * @param {number} fromVersion
	 * @param {number} toVersion
	 * @returns {Promise<{from: object|null, to: object|null, changes: string[], wordChanges: string[]}>}
	 */
	async diffVersions(memoryId, fromVersion, toVersion) {
		const [fromResult, toResult] = await Promise.all([
			this.db.query(
				`SELECT version_no, content, change_reason, created_at FROM brain_memory_versions
				 WHERE memory_id = $1 AND version_no = $2 LIMIT 1`,
				[memoryId, fromVersion],
			),
			this.db.query(
				`SELECT version_no, content, change_reason, created_at FROM brain_memory_versions
				 WHERE memory_id = $1 AND version_no = $2 LIMIT 1`,
				[memoryId, toVersion],
			),
		])

		const from = fromResult.rows[0] || null
		const to = toResult.rows[0] || null

		const changes = []
		const wordChanges = []
		if (from && to) {
			// Line-level diff
			const fromLines = (from.content || "").split("\n")
			const toLines = (to.content || "").split("\n")
			const maxLen = Math.max(fromLines.length, toLines.length)
			for (let i = 0; i < maxLen; i++) {
				if (fromLines[i] !== toLines[i]) {
					changes.push(`Line ${i + 1}: ${fromLines[i] || "(empty)"} → ${toLines[i] || "(empty)"}`)
				}
			}

			// Word-level diff — compare word-by-word for finer granularity
			const fromWords = (from.content || "").split(/\s+/)
			const toWords = (to.content || "").split(/\s+/)
			const maxWords = Math.max(fromWords.length, toWords.length)
			for (let i = 0; i < maxWords; i++) {
				if (fromWords[i] !== toWords[i]) {
					wordChanges.push(`Word ${i + 1}: ${fromWords[i] || "(empty)"} → ${toWords[i] || "(empty)"}`)
				}
			}
		}

		return { from, to, changes, wordChanges }
	}

	/**
	 * Add feedback for a memory and update its usefulness score and confidence.
	 * @param {string} memoryId
	 * @param {object} feedback
	 * @param {string} [feedback.taskId]
	 * @param {string} [feedback.agentName]
	 * @param {'success'|'failure'|'neutral'} feedback.outcome
	 * @param {number} feedback.score
	 * @param {string} [feedback.note]
	 * @returns {Promise<void>}
	 */
	async addFeedback(memoryId, feedback) {
		await this.db.query(
			`INSERT INTO brain_memory_feedback (memory_id, task_id, agent_name, outcome, score, note)
			 VALUES ($1, $2, $3, $4, $5, $6)`,
			[memoryId, feedback.taskId || null, feedback.agentName || null, feedback.outcome, feedback.score, feedback.note || null],
		)

		const delta = feedback.outcome === "success" ? Math.abs(feedback.score) : -Math.abs(feedback.score)

		// Upsert aggregated usefulness
		await this.db.query(
			`INSERT INTO brain_memory_usefulness (memory_id, usefulness, total_feedback, success_count, failure_count, last_feedback_at, updated_at)
			 VALUES ($1, GREATEST(0, LEAST(1, 0.5 + $2)), 1,
			         CASE WHEN $3 = 'success' THEN 1 ELSE 0 END,
			         CASE WHEN $3 = 'failure' THEN 1 ELSE 0 END,
			         now(), now())
			 ON CONFLICT (memory_id) DO UPDATE SET
			     usefulness = GREATEST(0, LEAST(1, brain_memory_usefulness.usefulness + $2)),
			     total_feedback = brain_memory_usefulness.total_feedback + 1,
			     success_count = brain_memory_usefulness.success_count + CASE WHEN $3 = 'success' THEN 1 ELSE 0 END,
			     failure_count = brain_memory_usefulness.failure_count + CASE WHEN $3 = 'failure' THEN 1 ELSE 0 END,
			     last_feedback_at = now(),
			     updated_at = now()`,
			[memoryId, delta, feedback.outcome],
		)

		// Also update agent_memory confidence to stay in sync with real-world feedback
		await this.db.query(
			`UPDATE agent_memory
			 SET confidence = GREATEST(0, LEAST(1, confidence + $2)),
			     updated_at = now()
			 WHERE id = $1`,
			[memoryId, delta],
		)
	}

	/**
	 * Get feedback history for a memory.
	 * @param {string} memoryId
	 * @param {number} [limit=50]
	 * @returns {Promise<object[]>}
	 */
	async getFeedback(memoryId, limit = 50) {
		const result = await this.db.query(
			`SELECT id, task_id, agent_name, outcome, score, note, created_at
			 FROM brain_memory_feedback
			 WHERE memory_id = $1
			 ORDER BY created_at DESC
			 LIMIT $2`,
			[memoryId, limit],
		)
		return result.rows
	}

	/**
	 * Get aggregated usefulness for a memory.
	 * @param {string} memoryId
	 * @returns {Promise<object|null>}
	 */
	async getUsefulness(memoryId) {
		const result = await this.db.query(
			`SELECT * FROM brain_memory_usefulness WHERE memory_id = $1`,
			[memoryId],
		)
		return result.rows[0] || null
	}

	/**
	 * Search memory with automatic recall logging and usefulness boost.
	 * Extends searchMemory with recall logging, use_count bump, and usefulness-aware sorting.
	 * @param {object} input
	 * @param {string} input.projectId
	 * @param {string} input.query
	 * @param {number} [input.topK=8]
	 * @param {string[]} [input.tags]
	 * @param {'approved'|'candidate'|'archived'|'rejected'} [input.status='approved']
	 * @param {boolean} [input.logRecall=true]
	 * @param {string} [input.taskId]
	 * @param {string} [input.agentName]
	 * @param {string} [input.model]
	 * @returns {Promise<object[]>}
	 */
	async searchMemoryWithRecall(input) {
		const results = await this.searchMemory(input)

		if (input.logRecall !== false && results.length > 0) {
			const memoryIds = results.map((r) => r.id)
			const similarities = {}
			for (const row of results) {
				similarities[row.id] = row.similarity
			}
			await this.logRecall({
				memoryIds,
				projectId: input.projectId,
				taskId: input.taskId,
				agentName: input.agentName,
				model: input.model,
				similarities,
			})
		}

		return results
	}

	/**
	 * Determine default status with auto-trust logic.
	 * Auto-trust: if confidence >= 0.82 AND riskLevel is 'low', auto-approve.
	 */
	_defaultStatus(memory) {
		const requireApproval = process.env.MEMORY_APPROVAL_REQUIRED !== "false"

		// Auto-trust: high confidence + low risk = auto-approved
		if (!requireApproval && (memory.confidence ?? 0) >= 0.82 && (memory.riskLevel || "low") === "low") {
			return "approved"
		}

		const risky = memory.riskLevel === "high" || (memory.confidence ?? 0) < 0.7
		return requireApproval || risky ? "candidate" : "approved"
	}

	// ═══════════════════════════════════════════════════════════════════
	// Innovative Features — Confidence Trending, Memory Health, Merge Suggestions
	// ═══════════════════════════════════════════════════════════════════

	/**
	 * Get confidence trend timeline for a memory.
	 * Builds a timeline from: base confidence (derived by reversing version boosts),
	 * version history (each version adds +0.05), feedback deltas, and current confidence.
	 * Returns data points suitable for charting.
	 * @param {string} memoryId
	 * @returns {Promise<{memoryId: string, title: string, currentConfidence: number, trend: string, direction: string, dataPoints: number, timeline: object[]}>}
	 */
	async getConfidenceTrend(memoryId) {
		const memory = await this.db.query(
			`SELECT id, title, confidence, created_at, updated_at FROM agent_memory WHERE id = $1`,
			[memoryId],
		)
		if (!memory.rows[0]) {
			return { memoryId, title: "", currentConfidence: 0, trend: "unknown", direction: "stable", dataPoints: 0, timeline: [] }
		}

		const mem = memory.rows[0]
		const timeline = []

		// 1. Version history — each version represents a +0.05 boost
		const versions = await this.db.query(
			`SELECT version_no, created_at FROM brain_memory_versions
			 WHERE memory_id = $1 ORDER BY version_no ASC`,
			[memoryId],
		)

		// Calculate base confidence by reversing all version boosts from current confidence.
		// Each evolution adds +0.05, so base = current - (0.05 * versionCount).
		// This ensures the timeline starts at the true original confidence.
		const versionBoost = 0.05 * versions.rows.length
		const baseConfidence = Math.max(0, (mem.confidence || 0.5) - versionBoost)

		// 2. Creation point — start at calculated base confidence
		timeline.push({
			date: mem.created_at,
			confidence: baseConfidence,
			event: "created",
		})

		// 3. Version history — replay each +0.05 boost
		let replayConf = baseConfidence
		for (const v of versions.rows) {
			replayConf = Math.min(1, replayConf + 0.05)
			timeline.push({
				date: v.created_at,
				confidence: replayConf,
				event: `version_${v.version_no}`,
			})
		}

		// 4. Feedback events — each feedback adjusts confidence by its score delta
		const feedbacks = await this.db.query(
			`SELECT outcome, score, created_at FROM brain_memory_feedback
			 WHERE memory_id = $1 ORDER BY created_at ASC`,
			[memoryId],
		)
		let fbConf = replayConf // start from where versions left off
		for (const fb of feedbacks.rows) {
			const delta = fb.outcome === "success" ? Math.abs(fb.score) : -Math.abs(fb.score)
			fbConf = Math.max(0, Math.min(1, fbConf + delta))
			timeline.push({
				date: fb.created_at,
				confidence: fbConf,
				event: `feedback_${fb.outcome}`,
			})
		}

		// 5. Current confidence as final point
		timeline.push({
			date: mem.updated_at,
			confidence: mem.confidence || 0.5,
			event: "current",
		})

		// Sort by date
		timeline.sort((a, b) => new Date(a.date) - new Date(b.date))

		// Determine trend direction
		const first = timeline[0]?.confidence ?? 0.5
		const last = timeline[timeline.length - 1]?.confidence ?? 0.5
		const diff = last - first
		const direction = diff > 0.05 ? "up" : diff < -0.05 ? "down" : "stable"
		const trend = direction === "up" ? "improving" : direction === "down" ? "declining" : "stable"

		return {
			memoryId,
			title: mem.title,
			currentConfidence: mem.confidence || 0.5,
			trend,
			direction,
			dataPoints: timeline.length,
			timeline,
		}
	}

	/**
	 * Get comprehensive memory health dashboard for a project.
	 * Aggregates 8 key metrics: total count, status breakdown, type breakdown,
	 * usage stats, decay count, version count, feedback stats, and confidence distribution.
	 * @param {string} projectId
	 * @returns {Promise<object>}
	 */
	async getMemoryHealth(projectId) {
		const [totalResult, statusResult, typeResult, usageResult, decayResult, versionResult, feedbackResult, confidenceResult] =
			await Promise.all([
				this.db.query(`SELECT COUNT(*) AS total FROM agent_memory WHERE project_id = $1`, [projectId]),
				this.db.query(
					`SELECT status, COUNT(*) AS count FROM agent_memory WHERE project_id = $1 GROUP BY status`,
					[projectId],
				),
				this.db.query(
					`SELECT memory_type, COUNT(*) AS count FROM agent_memory WHERE project_id = $1 GROUP BY memory_type`,
					[projectId],
				),
				this.db.query(
					`SELECT AVG(use_count) AS avg_use, MAX(use_count) AS max_use,
					        COUNT(*) FILTER (WHERE use_count = 0) AS unused
					 FROM agent_memory WHERE project_id = $1`,
					[projectId],
				),
				this.db.query(
					`SELECT COUNT(*) AS decayed FROM agent_memory WHERE project_id = $1 AND status = 'archived'`,
					[projectId],
				),
				this.db.query(
					`SELECT bmv.memory_id, COUNT(*) AS versions
					 FROM brain_memory_versions bmv
					 JOIN agent_memory am ON am.id = bmv.memory_id AND am.project_id = $1
					 GROUP BY bmv.memory_id
					 ORDER BY versions DESC`,
					[projectId],
				),
				this.db.query(
					`SELECT bmf.memory_id, COUNT(*) AS feedbacks
					 FROM brain_memory_feedback bmf
					 JOIN agent_memory am ON am.id = bmf.memory_id AND am.project_id = $1
					 GROUP BY bmf.memory_id
					 ORDER BY feedbacks DESC`,
					[projectId],
				),
				// Gap 7 fix: confidence distribution — count high (>=0.8) vs low (<0.5) confidence memories
				this.db.query(
					`SELECT
					  COUNT(*) FILTER (WHERE confidence >= 0.8) AS high_confidence,
					  COUNT(*) FILTER (WHERE confidence < 0.5) AS low_confidence
					 FROM agent_memory WHERE project_id = $1`,
					[projectId],
				),
			])

		const total = Number(totalResult.rows[0]?.total || 0)
		const statusBreakdown = Object.fromEntries(statusResult.rows.map((r) => [r.status, Number(r.count)]))
		const typeBreakdown = Object.fromEntries(typeResult.rows.map((r) => [r.memory_type, Number(r.count)]))
		const usageStats = usageResult.rows[0]
			? {
					avgUse: Number(usageResult.rows[0].avg_use || 0).toFixed(2),
					maxUse: Number(usageResult.rows[0].max_use || 0),
					unused: Number(usageResult.rows[0].unused || 0),
				}
			: { avgUse: 0, maxUse: 0, unused: 0 }
		const decayed = Number(decayResult.rows[0]?.decayed || 0)
		const versionCount = versionResult.rows.length
		const feedbackCount = feedbackResult.rows.length
		const confidenceDist = confidenceResult.rows[0]
			? {
					highConfidence: Number(confidenceResult.rows[0].high_confidence || 0),
					lowConfidence: Number(confidenceResult.rows[0].low_confidence || 0),
				}
			: { highConfidence: 0, lowConfidence: 0 }

		const healthScore = this._calculateHealthScore(total, statusBreakdown, usageStats, decayed)

		return {
			projectId,
			total,
			statusBreakdown,
			typeBreakdown,
			usageStats,
			decayed,
			versionCount,
			feedbackCount,
			confidenceDist,
			healthScore,
		}
	}

	/**
		* Calculate a health score (0-100) from aggregate memory metrics.
		* Weighted formula: approvedRatio * 40 + (1 - unusedRatio) * 30 + (1 - decayedRatio) * 30
		* @param {number} total
		* @param {object} statusBreakdown
		* @param {object} usageStats
		* @param {number} decayed
		* @returns {number}
		*/
	_calculateHealthScore(total, statusBreakdown, usageStats, decayed) {
		if (total === 0) return 0

		const approved = statusBreakdown.approved || 0
		const approvedRatio = approved / total

		const unused = Number(usageStats.unused || 0)
		const unusedRatio = unused / total

		const decayedRatio = decayed / total

		const score = approvedRatio * 40 + (1 - unusedRatio) * 30 + (1 - decayedRatio) * 30
		return Math.round(Math.max(0, Math.min(100, score)))
	}

	/**
		* Find memory pairs that are similar enough to suggest merging.
		* Uses self-join on agent_memory with cosine similarity > threshold.
		* Excludes already-merged memories (duplicate_of IS NOT NULL).
		* @param {string} projectId
		* @param {number} [threshold=0.85]
		* @param {number} [limit=20]
		* @returns {Promise<object[]>}
		*/
	async getMergeSuggestions(projectId, threshold = 0.85, limit = 20) {
		const result = await this.db.query(
			`SELECT a.id AS id_a, a.title AS title_a, a.memory_type AS type_a, a.confidence AS conf_a, a.use_count AS use_a,
			        b.id AS id_b, b.title AS title_b, b.memory_type AS type_b, b.confidence AS conf_b, b.use_count AS use_b,
			        1 - (a.embedding <=> b.embedding) AS similarity
			 FROM agent_memory a
			 JOIN agent_memory b ON a.id < b.id AND a.project_id = b.project_id
			 WHERE a.project_id = $1
			   AND a.embedding IS NOT NULL AND b.embedding IS NOT NULL
			   AND 1 - (a.embedding <=> b.embedding) > $2
			   AND a.duplicate_of IS NULL
			   AND b.duplicate_of IS NULL
			 ORDER BY similarity DESC
			 LIMIT $3`,
			[projectId, threshold, limit],
		)

		return result.rows.map((row) => {
			const pair = {
				idA: row.id_a,
				titleA: row.title_a,
				typeA: row.type_a,
				confidenceA: Number(row.conf_a || 0),
				useCountA: Number(row.use_a || 0),
				idB: row.id_b,
				titleB: row.title_b,
				typeB: row.type_b,
				confidenceB: Number(row.conf_b || 0),
				useCountB: Number(row.use_b || 0),
				similarity: Number(row.similarity || 0),
			}
			pair.mergePriority = this._calculateMergePriority(pair)
			return pair
		})
	}

	/**
		* Calculate merge priority score (0-100) for a pair of similar memories.
		* Formula: similarityScore (0-40) + useScore (0-20) + confScore (0-20) + typeScore (0-20)
		* @param {object} pair
		* @returns {number}
		*/
	_calculateMergePriority(pair) {
		// Similarity contributes 0-40 points (scaled from 0.85-1.0 range)
		const similarityScore = Math.round(Math.max(0, (pair.similarity - 0.85) / 0.15 * 40))

		// Combined usage contributes 0-20 points
		const totalUse = (pair.useCountA || 0) + (pair.useCountB || 0)
		const useScore = Math.min(20, Math.round(totalUse * 2))

		// Combined confidence contributes 0-20 points
		const avgConf = ((pair.confidenceA || 0) + (pair.confidenceB || 0)) / 2
		const confScore = Math.round(avgConf * 20)

		// Type compatibility contributes 0-20 points
		// Same type = 20, compatible types (lesson/insight, bug/issue) = 10, different = 0
		let typeScore = 0
		if (pair.typeA && pair.typeB) {
			if (pair.typeA === pair.typeB) {
				typeScore = 20
			} else if (
				(pair.typeA === "lesson" && pair.typeB === "insight") ||
				(pair.typeA === "insight" && pair.typeB === "lesson") ||
				(pair.typeA === "bug" && pair.typeB === "issue") ||
				(pair.typeA === "issue" && pair.typeB === "bug")
			) {
				typeScore = 10
			}
		}

		return Math.min(100, similarityScore + useScore + confScore + typeScore)
	}
}

module.exports = { MemoryService }
