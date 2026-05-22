/**
 * MemoryService — Unit Tests
 *
 * Tests all 14 methods of MemoryService using a mocked Postgres pool.
 * The pg module is lazy-loaded via MemoryService.getPool(), so we can
 * test without actually connecting to Postgres.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

describe("MemoryService", () => {
	let memoryService
	let mockDb
	let mockEmbeddings

	beforeEach(() => {
		mockDb = {
			query: vi.fn(async () => ({ rows: [] })),
		}
		mockEmbeddings = {
			generate: vi.fn(async (text) => {
				if (!text || text.trim().length === 0) return null
				return [0.1, 0.2, 0.3, 0.4, 0.5]
			}),
			toPgVector: vi.fn((vec) => `[${vec.join(",")}]`),
			dimensions: 768,
		}

		const { MemoryService } = require("../orchestrator/stores/brain/MemoryService")
		memoryService = new MemoryService(mockDb, mockEmbeddings)
	})

	// ─── createMemory ──────────────────────────────────────────────────────

	it("createMemory inserts a new memory and returns its id", async () => {
		mockDb.query = vi.fn(async (sql, params) => {
			return { rows: [{ id: "mem-1" }] }
		})

		const id = await memoryService.createMemory({
			projectId: "default",
			content: "Test memory content",
			title: "Test memory",
			memoryType: "lesson",
			tags: ["test"],
			relatedFiles: ["test.js"],
			relatedAgents: ["agent-a"],
			riskLevel: "low",
			confidence: 0.85,
			importance: 3,
			createdBy: "test-agent",
		})

		expect(id).toBe("mem-1")
		expect(mockEmbeddings.generate).toHaveBeenCalledWith("Test memory\nTest memory content")
		expect(mockDb.query).toHaveBeenCalled()
		// First call is findDuplicate (SELECT), second call is INSERT
		const sqlCall = mockDb.query.mock.calls[1][0]
		expect(sqlCall).toContain("INSERT INTO agent_memory")
	})

	it("createMemory auto-merges duplicate with >0.96 similarity", async () => {
		// First call: findDuplicate returns a match
		mockEmbeddings.generate = vi.fn(async () => [0.1, 0.2, 0.3])
		mockDb.query = vi.fn(async (sql) => {
			if (sql.includes("ORDER BY embedding <=>")) {
				return { rows: [{ id: "existing-id", similarity: "0.97" }] }
			}
			if (sql.includes("UPDATE agent_memory")) {
				return { rows: [] }
			}
			return { rows: [{ id: "existing-id" }] }
		})

		const id = await memoryService.createMemory({
			projectId: "default",
			content: "Similar content",
			title: "Similar",
			tags: ["test"],
		})

		// Should return the existing ID (auto-merge)
		expect(id).toBe("existing-id")
		// Should have called mergeInto (UPDATE), not INSERT
		const updateCalls = mockDb.query.mock.calls.filter((c) => c[0].includes("UPDATE agent_memory"))
		expect(updateCalls.length).toBeGreaterThan(0)
	})

	it("createMemory generates embedding and uses toPgVector format", async () => {
		let capturedParams = null
		mockDb.query = vi.fn(async (sql, params) => {
			capturedParams = params
			return { rows: [{ id: "mem-1" }] }
		})

		await memoryService.createMemory({
			projectId: "default",
			content: "Test content",
		})

		// The embedding parameter should be in pgvector format
		const embeddingParam = capturedParams[13]
		expect(typeof embeddingParam).toBe("string")
		expect(embeddingParam).toMatch(/^\[[\d.,]+\]$/)
	})

	it("createMemory uses default status when not provided", async () => {
		mockDb.query = vi.fn(async () => ({ rows: [{ id: "mem-1" }] }))

		await memoryService.createMemory({
			projectId: "default",
			content: "Test",
			riskLevel: "low",
			confidence: 0.85,
		})

		// First call is findDuplicate (SELECT), second call is INSERT
		const params = mockDb.query.mock.calls[1][1]
		// Status is at index 12 (0-based) in INSERT params
		expect(params[12]).toBe("candidate") // MEMORY_APPROVAL_REQUIRED defaults to true
	})

	it("createMemory sets candidate status for high risk memories", async () => {
		mockDb.query = vi.fn(async () => ({ rows: [{ id: "mem-1" }] }))

		await memoryService.createMemory({
			projectId: "default",
			content: "Risky content",
			riskLevel: "high",
			confidence: 0.5,
		})

		// First call is findDuplicate (SELECT), second call is INSERT
		const params = mockDb.query.mock.calls[1][1]
		expect(params[12]).toBe("candidate")
	})

	// ─── searchMemory ──────────────────────────────────────────────────────

	it("searchMemory performs semantic search with cosine similarity", async () => {
		mockDb.query = vi.fn(async () => ({
			rows: [
				{ id: "mem-1", title: "Result 1", content: "Content 1", similarity: 0.92 },
				{ id: "mem-2", title: "Result 2", content: "Content 2", similarity: 0.85 },
			],
		}))

		const results = await memoryService.searchMemory({
			projectId: "default",
			query: "test query",
			topK: 5,
			status: "approved",
		})

		expect(results).toHaveLength(2)
		expect(results[0].similarity).toBe(0.92)
		expect(mockEmbeddings.generate).toHaveBeenCalledWith("test query")
	})

	it("searchMemory falls back to text search when embedding fails", async () => {
		mockEmbeddings.generate = vi.fn(async () => null)

		mockDb.query = vi.fn(async () => ({
			rows: [
				{ id: "mem-1", title: "Text result", content: "Found by text", similarity: 0 },
			],
		}))

		const results = await memoryService.searchMemory({
			projectId: "default",
			query: "text search",
			topK: 5,
		})

		expect(results).toHaveLength(1)
		expect(results[0].id).toBe("mem-1")
		// Should use text search SQL (to_tsvector)
		const sqlCall = mockDb.query.mock.calls[0][0]
		expect(sqlCall).toContain("to_tsvector")
	})

	it("searchMemory filters by tags when provided", async () => {
		mockDb.query = vi.fn(async () => ({ rows: [] }))

		await memoryService.searchMemory({
			projectId: "default",
			query: "test",
			tags: ["important", "bug"],
		})

		const params = mockDb.query.mock.calls[0][1]
		// Tags parameter (index 3, 0-based)
		expect(params[3]).toEqual(["important", "bug"])
	})

	// ─── listMemories ──────────────────────────────────────────────────────

	it("listMemories returns memories with decay-aware sorting", async () => {
		mockDb.query = vi.fn(async () => ({
			rows: [
				{ id: "mem-1", title: "Recent", importance: 5, decay_score: 4.5 },
				{ id: "mem-2", title: "Old", importance: 3, decay_score: 1.5 },
			],
		}))

		const results = await memoryService.listMemories({
			projectId: "default",
			limit: 10,
			offset: 0,
		})

		expect(results).toHaveLength(2)
		expect(results[0].decay_score).toBeGreaterThan(results[1].decay_score)
	})

	it("listMemories filters by status, tag, agent, riskLevel, confidence, importance, and q", async () => {
		mockDb.query = vi.fn(async () => ({ rows: [] }))

		await memoryService.listMemories({
			projectId: "default",
			status: "approved",
			tag: "bug",
			agent: "test-agent",
			riskLevel: "low",
			minConfidence: 0.7,
			minImportance: 2,
			q: "search term",
			limit: 20,
			offset: 5,
		})

		// Verify the SQL contains all filter conditions
		const sqlCall = mockDb.query.mock.calls[0][0]
		expect(sqlCall).toContain("status =")
		expect(sqlCall).toContain("ANY(tags)")
		expect(sqlCall).toContain("ANY(related_agents)")
		expect(sqlCall).toContain("risk_level =")
		expect(sqlCall).toContain("confidence >=")
		expect(sqlCall).toContain("importance >=")
		expect(sqlCall).toContain("ILIKE")
		expect(sqlCall).toContain("decay_score")
	})

	// ─── updateStatus ──────────────────────────────────────────────────────

	it("updateStatus updates memory status and sets approved_at for approved", async () => {
		mockDb.query = vi.fn(async () => ({ rows: [] }))

		await memoryService.updateStatus("mem-1", "approved", "reviewer-1")

		const sqlCall = mockDb.query.mock.calls[0][0]
		expect(sqlCall).toContain("UPDATE agent_memory")
		expect(sqlCall).toContain("status = $2")
		expect(sqlCall).toContain("approved_at")
		expect(mockDb.query.mock.calls[0][1]).toEqual(["mem-1", "approved", "reviewer-1"])
	})

	it("updateStatus rejects a memory", async () => {
		mockDb.query = vi.fn(async () => ({ rows: [] }))

		await memoryService.updateStatus("mem-1", "rejected", "reviewer-1")

		const params = mockDb.query.mock.calls[0][1]
		expect(params[1]).toBe("rejected")
	})

	// ─── updateMemory ──────────────────────────────────────────────────────

	it("updateMemory partially updates a memory record", async () => {
		mockDb.query = vi.fn(async () => ({ rows: [] }))

		await memoryService.updateMemory("mem-1", {
			title: "New title",
			content: "New content",
			tags: ["updated"],
			importance: 5,
			confidence: 0.95,
			riskLevel: "medium",
		})

		const sqlCall = mockDb.query.mock.calls[0][0]
		expect(sqlCall).toContain("UPDATE agent_memory")
		expect(sqlCall).toContain("title = $2")
		expect(sqlCall).toContain("content = $3")
		expect(sqlCall).toContain("tags = $4")
		expect(sqlCall).toContain("importance = $5")
		expect(sqlCall).toContain("confidence = $6")
		expect(sqlCall).toContain("risk_level = $7")
	})

	it("updateMemory does nothing when patch is empty", async () => {
		mockDb.query = vi.fn(async () => ({ rows: [] }))

		await memoryService.updateMemory("mem-1", {})

		expect(mockDb.query).not.toHaveBeenCalled()
	})

	// ─── deleteMemory ──────────────────────────────────────────────────────

	it("deleteMemory deletes a memory permanently", async () => {
		mockDb.query = vi.fn(async () => ({ rows: [] }))

		await memoryService.deleteMemory("mem-1")

		const sqlCall = mockDb.query.mock.calls[0][0]
		expect(sqlCall).toContain("DELETE FROM agent_memory")
		expect(mockDb.query.mock.calls[0][1]).toEqual(["mem-1"])
	})

	// ─── logRecall ─────────────────────────────────────────────────────────

	it("logRecall inserts recall logs and updates use_count", async () => {
		mockDb.query = vi.fn(async () => ({ rows: [] }))

		await memoryService.logRecall({
			memoryIds: ["mem-1", "mem-2"],
			projectId: "default",
			taskId: "task-1",
			runId: "run-1",
			agentName: "test-agent",
			model: "deepseek",
			similarities: { "mem-1": 0.92, "mem-2": 0.85 },
		})

		// Should have 4 queries: 2 INSERT + 2 UPDATE
		expect(mockDb.query).toHaveBeenCalledTimes(4)
		// First call should be INSERT for mem-1
		expect(mockDb.query.mock.calls[0][0]).toContain("INSERT INTO memory_recall_logs")
		// Second call should be UPDATE for mem-1
		expect(mockDb.query.mock.calls[1][0]).toContain("UPDATE agent_memory")
	})

	// ─── getRecallLogs ─────────────────────────────────────────────────────

	it("getRecallLogs returns recall logs for a memory", async () => {
		mockDb.query = vi.fn(async () => ({
			rows: [
				{ id: "log-1", memory_id: "mem-1", agent_name: "test-agent", similarity: 0.92 },
			],
		}))

		const logs = await memoryService.getRecallLogs("mem-1", 10)

		expect(logs).toHaveLength(1)
		expect(logs[0].agent_name).toBe("test-agent")
	})

	// ─── findDuplicates ────────────────────────────────────────────────────

	it("findDuplicates returns pairs with similarity above threshold", async () => {
		mockDb.query = vi.fn(async () => ({
			rows: [
				{ id1: "mem-1", id2: "mem-2", title1: "First", title2: "Second", similarity: 0.92 },
			],
		}))

		const duplicates = await memoryService.findDuplicates("default", 0.85)

		expect(duplicates).toHaveLength(1)
		expect(duplicates[0].similarity).toBe(0.92)
	})

	// ─── findDuplicate ─────────────────────────────────────────────────────

	it("findDuplicate returns closest match above 0.94 threshold", async () => {
		mockDb.query = vi.fn(async () => ({
			rows: [{ id: "mem-1", similarity: "0.96" }],
		}))

		const result = await memoryService.findDuplicate("default", [0.1, 0.2, 0.3])

		expect(result).not.toBeNull()
		expect(result.id).toBe("mem-1")
	})

	it("findDuplicate returns null when similarity is below 0.94", async () => {
		mockDb.query = vi.fn(async () => ({
			rows: [{ id: "mem-1", similarity: "0.80" }],
		}))

		const result = await memoryService.findDuplicate("default", [0.1, 0.2, 0.3])

		expect(result).toBeNull()
	})

	it("findDuplicate returns null when no results", async () => {
		mockDb.query = vi.fn(async () => ({ rows: [] }))

		const result = await memoryService.findDuplicate("default", [0.1, 0.2, 0.3])

		expect(result).toBeNull()
	})

	// ─── mergeInto ─────────────────────────────────────────────────────────

	it("mergeInto merges tags and increments use_count on target", async () => {
		mockDb.query = vi.fn(async () => ({ rows: [] }))

		await memoryService.mergeInto(
			{ tags: ["new-tag", "existing-tag"] },
			"target-id",
		)

		const sqlCall = mockDb.query.mock.calls[0][0]
		expect(sqlCall).toContain("UPDATE agent_memory")
		expect(sqlCall).toContain("array_cat")
		expect(sqlCall).toContain("use_count = use_count + 1")
	})

	// ─── applyDecay ────────────────────────────────────────────────────────

	it("applyDecay reduces importance of unused memories", async () => {
		mockDb.query = vi.fn(async () => ({ rowCount: 3 }))

		const count = await memoryService.applyDecay("default")

		expect(count).toBe(3)
		const sqlCall = mockDb.query.mock.calls[0][0]
		expect(sqlCall).toContain("UPDATE agent_memory")
		expect(sqlCall).toContain("importance = GREATEST(1, importance - 1)")
		expect(sqlCall).toContain("INTERVAL '90 days'")
	})

	it("applyDecay returns 0 when no memories affected", async () => {
		mockDb.query = vi.fn(async () => ({ rowCount: 0 }))

		const count = await memoryService.applyDecay("default")

		expect(count).toBe(0)
	})

	// ─── getAgentScores ────────────────────────────────────────────────────

	it("getAgentScores returns agent scores with success_rate", async () => {
		mockDb.query = vi.fn(async () => ({
			rows: [
				{ agent: "agent-a", success_count: 8, failure_count: 2, success_rate: "0.8" },
				{ agent: "agent-b", success_count: 5, failure_count: 5, success_rate: "0.5" },
			],
		}))

		const scores = await memoryService.getAgentScores("default")

		expect(scores).toHaveLength(2)
		expect(scores[0].agent).toBe("agent-a")
		expect(scores[0].success_rate).toBe("0.8")
	})

	// ─── getBrainEvents ────────────────────────────────────────────────────

	it("getBrainEvents returns brain events for a project", async () => {
		mockDb.query = vi.fn(async () => ({
			rows: [
				{ id: "evt-1", event_type: "memory.created", actor: "test" },
				{ id: "evt-2", event_type: "memory.recall", actor: "test" },
			],
		}))

		const events = await memoryService.getBrainEvents("default", 10)

		expect(events).toHaveLength(2)
		expect(events[0].event_type).toBe("memory.created")
	})

	// ─── _defaultStatus ────────────────────────────────────────────────────

	it("_defaultStatus returns 'approved' for low-risk, high-confidence memories when approval not required", () => {
		// MEMORY_APPROVAL_REQUIRED env var controls the default
		const orig = process.env.MEMORY_APPROVAL_REQUIRED
		process.env.MEMORY_APPROVAL_REQUIRED = "false"
		try {
			const status = memoryService._defaultStatus({
				riskLevel: "low",
				confidence: 0.85,
			})
			expect(status).toBe("approved")
		} finally {
			process.env.MEMORY_APPROVAL_REQUIRED = orig
		}
	})

	it("_defaultStatus returns 'candidate' for high-risk memories", () => {
		const status = memoryService._defaultStatus({
			riskLevel: "high",
			confidence: 0.85,
		})
		expect(status).toBe("candidate")
	})

	it("_defaultStatus returns 'candidate' for low-confidence memories", () => {
		const status = memoryService._defaultStatus({
			riskLevel: "low",
			confidence: 0.5,
		})
		expect(status).toBe("candidate")
	})

	// ─── getPool (static) ──────────────────────────────────────────────────

	it("getPool returns the pg Pool class", () => {
		const { MemoryService } = require("../orchestrator/stores/brain/MemoryService")
		const Pool = MemoryService.getPool()
		expect(typeof Pool).toBe("function")
	})

	it("getPool caches the Pool class after first call", () => {
		const { MemoryService } = require("../orchestrator/stores/brain/MemoryService")
		const first = MemoryService.getPool()
		const second = MemoryService.getPool()
		expect(first).toBe(second)
	})

	// ═══════════════════════════════════════════════════════════════════
	// Memory Evolution v3 — evolveMemory, getVersionHistory, diffVersions
	// ═══════════════════════════════════════════════════════════════════

	describe("Memory Evolution v3", () => {
		it("evolveMemory creates a new version and updates content + embedding", async () => {
			let callCount = 0
			mockDb.query = vi.fn(async (sql) => {
				callCount++
				if (callCount === 1) {
					// SELECT MAX(version_no)
					return { rows: [{ next: 3 }] }
				}
				if (callCount === 2) {
					// INSERT INTO brain_memory_versions
					return { rows: [] }
				}
				if (callCount === 3) {
					// UPDATE agent_memory
					return { rows: [] }
				}
				return { rows: [] }
			})

			const result = await memoryService.evolveMemory("mem-1", "Updated content", "fix typo", { agent: "test-agent" })

			expect(result.versionNo).toBe(3)
			expect(mockEmbeddings.generate).toHaveBeenCalledWith("Updated content")
			// First call: get next version
			expect(mockDb.query.mock.calls[0][0]).toContain("SELECT COALESCE(MAX(version_no)")
			// Second call: insert version
			expect(mockDb.query.mock.calls[1][0]).toContain("INSERT INTO brain_memory_versions")
			expect(mockDb.query.mock.calls[1][1]).toEqual(["mem-1", 3, "Updated content", null, "fix typo", "test-agent"])
			// Third call: update memory
			expect(mockDb.query.mock.calls[2][0]).toContain("UPDATE agent_memory")
			expect(mockDb.query.mock.calls[2][0]).toContain("confidence = LEAST(confidence + 0.05, 1)")
		})

		it("evolveMemory handles first version (no existing versions)", async () => {
			mockDb.query = vi.fn(async () => ({ rows: [{ next: 1 }] }))

			const result = await memoryService.evolveMemory("mem-new", "First version", "initial")

			expect(result.versionNo).toBe(1)
		})

		it("getVersionHistory returns versions ordered by version_no DESC", async () => {
			const mockVersions = [
				{ id: "v3", version_no: 3, content: "v3 content", change_reason: "update", created_by_agent: "agent-a", created_at: "2026-01-03" },
				{ id: "v2", version_no: 2, content: "v2 content", change_reason: "fix", created_by_agent: "agent-b", created_at: "2026-01-02" },
				{ id: "v1", version_no: 1, content: "v1 content", change_reason: "create", created_by_agent: "system", created_at: "2026-01-01" },
			]
			mockDb.query = vi.fn(async () => ({ rows: mockVersions }))

			const versions = await memoryService.getVersionHistory("mem-1", 10)

			expect(versions).toHaveLength(3)
			expect(versions[0].version_no).toBe(3)
			expect(versions[2].version_no).toBe(1)
			expect(mockDb.query.mock.calls[0][0]).toContain("ORDER BY version_no DESC")
			expect(mockDb.query.mock.calls[0][1]).toEqual(["mem-1", 10])
		})

		it("diffVersions returns line-by-line changes between two versions", async () => {
			const version1Row = { version_no: 1, content: "line1\nline2\nline3", change_reason: "create", created_at: "2026-01-01" }
			const version2Row = { version_no: 2, content: "line1\nline2_modified\nline3\nline4", change_reason: "update", created_at: "2026-01-02" }
			mockDb.query = vi.fn(async (sql, params) => {
				if (params && params[1] === 1) return { rows: [version1Row] }
				if (params && params[1] === 2) return { rows: [version2Row] }
				return { rows: [] }
			})

			const diff = await memoryService.diffVersions("mem-1", 1, 2)

			expect(diff.from.version_no).toBe(1)
			expect(diff.to.version_no).toBe(2)
			expect(diff.changes).toHaveLength(2) // line 2 changed, line 4 added
			expect(diff.changes[0]).toContain("Line 2")
			expect(diff.changes[0]).toContain("→")
			expect(diff.changes[1]).toContain("Line 4")
		})

		it("diffVersions returns empty changes when versions are identical", async () => {
			mockDb.query = vi.fn(async () => ({
				rows: [{ version_no: 1, content: "same content", change_reason: "create", created_at: "2026-01-01" }],
			}))

			const diff = await memoryService.diffVersions("mem-1", 1, 2)

			expect(diff.changes).toHaveLength(0)
		})

		it("diffVersions returns null for missing versions", async () => {
			mockDb.query = vi.fn(async () => ({ rows: [] }))

			const diff = await memoryService.diffVersions("mem-1", 99, 100)

			expect(diff.from).toBeNull()
			expect(diff.to).toBeNull()
			expect(diff.changes).toHaveLength(0)
		})
	})

	// ═══════════════════════════════════════════════════════════════════
	// Feedback & Usefulness — addFeedback, getFeedback, getUsefulness
	// ═══════════════════════════════════════════════════════════════════

	describe("Feedback & Usefulness", () => {
		it("addFeedback inserts feedback and upserts usefulness for success outcome", async () => {
			let callCount = 0
			mockDb.query = vi.fn(async () => {
				callCount++
				return { rows: [] }
			})

			await memoryService.addFeedback("mem-1", {
				taskId: "task-1",
				agentName: "agent-a",
				outcome: "success",
				score: 0.3,
				note: "Great memory",
			})

			// First call: INSERT feedback
			expect(mockDb.query.mock.calls[0][0]).toContain("INSERT INTO brain_memory_feedback")
			expect(mockDb.query.mock.calls[0][1]).toEqual(["mem-1", "task-1", "agent-a", "success", 0.3, "Great memory"])
			// Second call: UPSERT usefulness
			expect(mockDb.query.mock.calls[1][0]).toContain("INSERT INTO brain_memory_usefulness")
			expect(mockDb.query.mock.calls[1][0]).toContain("ON CONFLICT (memory_id) DO UPDATE")
		})

		it("addFeedback uses negative delta for failure outcome", async () => {
			mockDb.query = vi.fn(async () => ({ rows: [] }))

			await memoryService.addFeedback("mem-1", {
				outcome: "failure",
				score: 0.2,
			})

			// Delta should be negative for failure
			const usefulnessParams = mockDb.query.mock.calls[1][1]
			expect(usefulnessParams[1]).toBe(-0.2) // negative delta
		})

		it("addFeedback uses neutral delta for neutral outcome", async () => {
			mockDb.query = vi.fn(async () => ({ rows: [] }))

			await memoryService.addFeedback("mem-1", {
				outcome: "neutral",
				score: 0,
			})

			const usefulnessParams = mockDb.query.mock.calls[1][1]
			expect(usefulnessParams[1]).toBeCloseTo(0) // neutral delta (handles -0 vs 0)
		})

		it("getFeedback returns feedback history ordered by created_at DESC", async () => {
			const mockFeedback = [
				{ id: "fb-2", outcome: "success", score: 0.3, created_at: "2026-01-02" },
				{ id: "fb-1", outcome: "failure", score: -0.2, created_at: "2026-01-01" },
			]
			mockDb.query = vi.fn(async () => ({ rows: mockFeedback }))

			const feedback = await memoryService.getFeedback("mem-1", 5)

			expect(feedback).toHaveLength(2)
			expect(feedback[0].id).toBe("fb-2")
			expect(mockDb.query.mock.calls[0][0]).toContain("ORDER BY created_at DESC")
		})

		it("getUsefulness returns aggregated usefulness for a memory", async () => {
			const mockUsefulness = {
				memory_id: "mem-1",
				usefulness: 0.75,
				total_feedback: 4,
				success_count: 3,
				failure_count: 1,
			}
			mockDb.query = vi.fn(async () => ({ rows: [mockUsefulness] }))

			const result = await memoryService.getUsefulness("mem-1")

			expect(result.usefulness).toBe(0.75)
			expect(result.total_feedback).toBe(4)
		})

		it("getUsefulness returns null for memories with no feedback", async () => {
			mockDb.query = vi.fn(async () => ({ rows: [] }))

			const result = await memoryService.getUsefulness("mem-no-feedback")

			expect(result).toBeNull()
		})
	})

	// ═══════════════════════════════════════════════════════════════════
	// Auto-Trust Logic — _defaultStatus with confidence >= 0.82
	// ═══════════════════════════════════════════════════════════════════

	describe("Auto-Trust Logic", () => {
		it("_defaultStatus auto-approves when confidence >= 0.82 and risk is low and approval not required", () => {
			const originalEnv = process.env.MEMORY_APPROVAL_REQUIRED
			process.env.MEMORY_APPROVAL_REQUIRED = "false"

			const status = memoryService._defaultStatus({
				confidence: 0.85,
				riskLevel: "low",
			})

			expect(status).toBe("approved")

			process.env.MEMORY_APPROVAL_REQUIRED = originalEnv
		})

		it("_defaultStatus does NOT auto-approve when confidence < 0.82 even if risk is low", () => {
			const originalEnv = process.env.MEMORY_APPROVAL_REQUIRED
			process.env.MEMORY_APPROVAL_REQUIRED = "false"

			const status = memoryService._defaultStatus({
				confidence: 0.7,
				riskLevel: "low",
			})

			expect(status).toBe("approved") // falls through to default: not risky, not required

			process.env.MEMORY_APPROVAL_REQUIRED = originalEnv
		})

		it("_defaultStatus returns 'candidate' when approval is required even with high confidence", () => {
			const originalEnv = process.env.MEMORY_APPROVAL_REQUIRED
			process.env.MEMORY_APPROVAL_REQUIRED = "true"

			const status = memoryService._defaultStatus({
				confidence: 0.9,
				riskLevel: "low",
			})

			expect(status).toBe("candidate")

			process.env.MEMORY_APPROVAL_REQUIRED = originalEnv
		})
	})

	// ═══════════════════════════════════════════════════════════════════
	// searchMemoryWithRecall — Search + auto-log recall
	// ═══════════════════════════════════════════════════════════════════

	describe("searchMemoryWithRecall", () => {
		it("searches memory and logs recall for each result", async () => {
			const mockResults = [
				{ id: "mem-1", similarity: 0.92, content: "result 1" },
				{ id: "mem-2", similarity: 0.85, content: "result 2" },
			]
			// Mock searchMemory
			memoryService.searchMemory = vi.fn(async () => mockResults)
			// Mock logRecall
			memoryService.logRecall = vi.fn(async () => {})

			const results = await memoryService.searchMemoryWithRecall({
				projectId: "default",
				query: "test query",
				taskId: "task-1",
				agentName: "agent-a",
				model: "test-model",
			})

			expect(results).toEqual(mockResults)
			expect(memoryService.searchMemory).toHaveBeenCalledWith({
				projectId: "default",
				query: "test query",
				taskId: "task-1",
				agentName: "agent-a",
				model: "test-model",
			})
			expect(memoryService.logRecall).toHaveBeenCalledWith({
				memoryIds: ["mem-1", "mem-2"],
				projectId: "default",
				taskId: "task-1",
				agentName: "agent-a",
				model: "test-model",
				similarities: { "mem-1": 0.92, "mem-2": 0.85 },
			})
		})

		it("does not log recall when logRecall is false", async () => {
			memoryService.searchMemory = vi.fn(async () => [{ id: "mem-1", similarity: 0.9, content: "result" }])
			memoryService.logRecall = vi.fn(async () => {})

			await memoryService.searchMemoryWithRecall({
				projectId: "default",
				query: "test",
				logRecall: false,
			})

			expect(memoryService.logRecall).not.toHaveBeenCalled()
		})

		it("does not log recall when results are empty", async () => {
			memoryService.searchMemory = vi.fn(async () => [])
			memoryService.logRecall = vi.fn(async () => {})

			await memoryService.searchMemoryWithRecall({
				projectId: "default",
				query: "nothing",
			})

			expect(memoryService.logRecall).not.toHaveBeenCalled()
		})
	})

	// ═══════════════════════════════════════════════════════════════════
	// Innovative Features — getConfidenceTrend, getMemoryHealth, getMergeSuggestions
	// ═══════════════════════════════════════════════════════════════════

	describe("Innovative Features", () => {
		describe("getConfidenceTrend", () => {
			it("returns timeline with creation, version, and feedback data points", async () => {
				let callCount = 0
				mockDb.query = vi.fn(async (sql) => {
					callCount++
					if (callCount === 1) {
						// SELECT agent_memory
						return { rows: [{ id: "mem-1", title: "Test Memory", confidence: 0.85, created_at: "2026-01-01", updated_at: "2026-01-03" }] }
					}
					if (callCount === 2) {
						// SELECT brain_memory_versions
						return { rows: [
							{ version_no: 1, created_at: "2026-01-02" },
						] }
					}
					if (callCount === 3) {
						// SELECT brain_memory_feedback
						return { rows: [
							{ outcome: "success", score: 0.1, created_at: "2026-01-03" },
						] }
					}
					return { rows: [] }
				})

				const trend = await memoryService.getConfidenceTrend("mem-1")

				expect(trend.memoryId).toBe("mem-1")
				expect(trend.title).toBe("Test Memory")
				expect(trend.currentConfidence).toBe(0.85)
				expect(trend.dataPoints).toBeGreaterThanOrEqual(4) // created + version + feedback + current
				expect(trend.timeline.length).toBeGreaterThanOrEqual(4)
				expect(trend.timeline[0].event).toBe("created")
				expect(trend.timeline[trend.timeline.length - 1].event).toBe("current")
			})

			it("returns unknown trend for non-existent memory", async () => {
				mockDb.query = vi.fn(async () => ({ rows: [] }))

				const trend = await memoryService.getConfidenceTrend("nonexistent")

				expect(trend.memoryId).toBe("nonexistent")
				expect(trend.trend).toBe("unknown")
				expect(trend.dataPoints).toBe(0)
			})
		})

		describe("getMemoryHealth", () => {
			it("returns comprehensive health dashboard with all 7 metrics", async () => {
				let callCount = 0
				mockDb.query = vi.fn(async (sql) => {
					callCount++
					if (callCount === 1) return { rows: [{ total: 50 }] }
					if (callCount === 2) return { rows: [{ status: "approved", count: 30 }, { status: "candidate", count: 15 }, { status: "archived", count: 5 }] }
					if (callCount === 3) return { rows: [{ memory_type: "lesson", count: 25 }, { memory_type: "bug", count: 15 }, { memory_type: "pattern", count: 10 }] }
					if (callCount === 4) return { rows: [{ avg_use: 3.5, max_use: 20, unused: 5 }] }
					if (callCount === 5) return { rows: [{ decayed: 5 }] }
					if (callCount === 6) return { rows: [{ memory_id: "mem-1", versions: 3 }] }
					if (callCount === 7) return { rows: [{ memory_id: "mem-1", feedbacks: 2 }] }
					return { rows: [] }
				})

				const health = await memoryService.getMemoryHealth("project-1")

				expect(health.projectId).toBe("project-1")
				expect(health.total).toBe(50)
				expect(health.statusBreakdown).toEqual({ approved: 30, candidate: 15, archived: 5 })
				expect(health.typeBreakdown).toEqual({ lesson: 25, bug: 15, pattern: 10 })
				expect(health.usageStats.avgUse).toBe("3.50")
				expect(health.usageStats.maxUse).toBe(20)
				expect(health.usageStats.unused).toBe(5)
				expect(health.decayed).toBe(5)
				expect(health.versionCount).toBe(1)
				expect(health.feedbackCount).toBe(1)
				expect(health.healthScore).toBeGreaterThanOrEqual(0)
				expect(health.healthScore).toBeLessThanOrEqual(100)
			})

			it("returns zero health score for empty project", async () => {
				mockDb.query = vi.fn(async () => ({ rows: [] }))

				const health = await memoryService.getMemoryHealth("empty-project")

				expect(health.total).toBe(0)
				expect(health.healthScore).toBe(0)
			})
		})

		describe("_calculateHealthScore", () => {
			it("calculates score based on approved ratio, unused ratio, and decayed ratio", () => {
				const score = memoryService._calculateHealthScore(
					100,
					{ approved: 60, candidate: 30, archived: 10 },
					{ unused: 10 },
					5,
				)
				// approvedRatio = 60/100 = 0.6 → 0.6 * 40 = 24
				// unusedRatio = 10/100 = 0.1 → (1-0.1) * 30 = 27
				// decayedRatio = 5/100 = 0.05 → (1-0.05) * 30 = 28.5
				// total = 24 + 27 + 28.5 = 79.5 → round to 80
				expect(score).toBe(80)
			})

			it("returns 0 when total is 0", () => {
				const score = memoryService._calculateHealthScore(0, {}, { unused: 0 }, 0)
				expect(score).toBe(0)
			})

			it("caps score at 100", () => {
				const score = memoryService._calculateHealthScore(
					10,
					{ approved: 10 },
					{ unused: 0 },
					0,
				)
				// approvedRatio = 1.0 * 40 = 40
				// unusedRatio = 0 → (1-0) * 30 = 30
				// decayedRatio = 0 → (1-0) * 30 = 30
				// total = 100
				expect(score).toBe(100)
			})
		})

		describe("getMergeSuggestions", () => {
			it("returns merge suggestions sorted by similarity", async () => {
				const mockPairs = [
					{ id_a: "mem-1", title_a: "Memory A", type_a: "lesson", conf_a: 0.9, use_a: 10, id_b: "mem-2", title_b: "Memory B", type_b: "lesson", conf_b: 0.85, use_b: 5, similarity: 0.92 },
					{ id_a: "mem-3", title_a: "Memory C", type_a: "bug", conf_a: 0.7, use_a: 2, id_b: "mem-4", title_b: "Memory D", type_b: "bug", conf_b: 0.65, use_b: 1, similarity: 0.88 },
				]
				mockDb.query = vi.fn(async () => ({ rows: mockPairs }))

				const suggestions = await memoryService.getMergeSuggestions("project-1", 0.85, 10)

				expect(suggestions).toHaveLength(2)
				expect(suggestions[0].idA).toBe("mem-1")
				expect(suggestions[0].similarity).toBe(0.92)
				expect(suggestions[0].mergePriority).toBeGreaterThanOrEqual(0)
				expect(suggestions[0].mergePriority).toBeLessThanOrEqual(100)
				expect(suggestions[1].idA).toBe("mem-3")
				expect(mockDb.query.mock.calls[0][0]).toContain("<=>")
				expect(mockDb.query.mock.calls[0][0]).toContain("a.id < b.id")
			})

			it("returns empty array when no similar pairs found", async () => {
				mockDb.query = vi.fn(async () => ({ rows: [] }))

				const suggestions = await memoryService.getMergeSuggestions("project-1", 0.95, 10)

				expect(suggestions).toHaveLength(0)
			})
		})

		describe("_calculateMergePriority", () => {
			it("calculates priority based on similarity, usage, confidence, and type compatibility", () => {
				const priority = memoryService._calculateMergePriority({
					similarity: 0.95,
					useCountA: 10,
					useCountB: 5,
					confidenceA: 0.9,
					confidenceB: 0.8,
					typeA: "lesson",
					typeB: "lesson",
				})
				// similarityScore: (0.95-0.85)/0.15*40 = 26.67 → 27
				// useScore: min(20, 15*2) = min(20, 30) = 20
				// confScore: (0.9+0.8)/2*20 = 0.85*20 = 17
				// typeScore: same type = 20
				// total: 27 + 20 + 17 + 20 = 84
				expect(priority).toBe(84)
			})

			it("caps priority at 100", () => {
				const priority = memoryService._calculateMergePriority({
					similarity: 1.0,
					useCountA: 100,
					useCountB: 100,
					confidenceA: 1.0,
					confidenceB: 1.0,
					typeA: "lesson",
					typeB: "lesson",
				})
				expect(priority).toBe(100)
			})

			it("returns minimum priority for barely similar pairs", () => {
				const priority = memoryService._calculateMergePriority({
					similarity: 0.85,
					useCountA: 0,
					useCountB: 0,
					confidenceA: 0,
					confidenceB: 0,
					typeA: "lesson",
					typeB: "bug",
				})
				// similarityScore: (0.85-0.85)/0.15*40 = 0
				// useScore: min(20, 0) = 0
				// confScore: 0*20 = 0
				// typeScore: different types = 0
				// total: 0
				expect(priority).toBe(0)
			})

			it("awards partial typeScore for compatible types (lesson + insight)", () => {
				const priority = memoryService._calculateMergePriority({
					similarity: 0.95,
					useCountA: 5,
					useCountB: 3,
					confidenceA: 0.8,
					confidenceB: 0.7,
					typeA: "lesson",
					typeB: "insight",
				})
				// typeScore: compatible types = 10
				expect(priority).toBeGreaterThan(0)
				// Verify typeScore contributed exactly 10
				const sameTypePriority = memoryService._calculateMergePriority({
					similarity: 0.95,
					useCountA: 5,
					useCountB: 3,
					confidenceA: 0.8,
					confidenceB: 0.7,
					typeA: "lesson",
					typeB: "lesson",
				})
				expect(priority).toBe(sameTypePriority - 10)
			})

			it("awards full typeScore for same type", () => {
				const priority = memoryService._calculateMergePriority({
					similarity: 0.95,
					useCountA: 5,
					useCountB: 3,
					confidenceA: 0.8,
					confidenceB: 0.7,
					typeA: "bug",
					typeB: "bug",
				})
				// typeScore: same type = 20
				expect(priority).toBeGreaterThan(0)
			})
		})

		describe("diffVersions — word-level diff", () => {
			it("returns wordChanges alongside changes", async () => {
				mockDb.query = vi.fn()
					.mockResolvedValueOnce({
						rows: [{ version_no: 1, content: "hello world foo", change_reason: "initial", created_at: "2026-01-01" }],
					})
					.mockResolvedValueOnce({
						rows: [{ version_no: 2, content: "hello bar foo", change_reason: "updated", created_at: "2026-01-02" }],
					})

				const result = await memoryService.diffVersions("mem-1", 1, 2)

				expect(result.changes).toBeDefined()
				expect(result.wordChanges).toBeDefined()
				expect(Array.isArray(result.wordChanges)).toBe(true)
				// "world" → "bar" at word position 2
				expect(result.wordChanges.some((wc) => wc.includes("world") && wc.includes("bar"))).toBe(true)
			})

			it("returns empty wordChanges when one version is missing", async () => {
				mockDb.query = vi.fn()
					.mockResolvedValueOnce({ rows: [] })
					.mockResolvedValueOnce({
						rows: [{ version_no: 2, content: "new content", change_reason: "updated", created_at: "2026-01-02" }],
					})

				const result = await memoryService.diffVersions("mem-1", 1, 2)

				expect(result.wordChanges).toEqual([])
				expect(result.changes).toEqual([])
			})
		})

		describe("getMemoryHealth — confidence distribution", () => {
			it("includes confidenceDist in health response", async () => {
				// Mock all 8 queries: total, status, type, usage, decay, versions, feedback, confidence
				mockDb.query = vi.fn()
					.mockResolvedValueOnce({ rows: [{ total: 10 }] })
					.mockResolvedValueOnce({ rows: [{ status: "approved", count: 8 }, { status: "candidate", count: 2 }] })
					.mockResolvedValueOnce({ rows: [{ memory_type: "lesson", count: 6 }, { memory_type: "bug", count: 4 }] })
					.mockResolvedValueOnce({ rows: [{ avg_use: 5, max_use: 20, unused: 1 }] })
					.mockResolvedValueOnce({ rows: [{ decayed: 0 }] })
					.mockResolvedValueOnce({ rows: [] })
					.mockResolvedValueOnce({ rows: [] })
					.mockResolvedValueOnce({ rows: [{ high_confidence: 7, low_confidence: 1 }] })

				const health = await memoryService.getMemoryHealth("project-1")

				expect(health.confidenceDist).toBeDefined()
				expect(health.confidenceDist.highConfidence).toBe(7)
				expect(health.confidenceDist.lowConfidence).toBe(1)
			})

			it("defaults confidenceDist to zeros when no data", async () => {
				mockDb.query = vi.fn()
					.mockResolvedValueOnce({ rows: [{ total: 0 }] })
					.mockResolvedValueOnce({ rows: [] })
					.mockResolvedValueOnce({ rows: [] })
					.mockResolvedValueOnce({ rows: [{ avg_use: null, max_use: null, unused: 0 }] })
					.mockResolvedValueOnce({ rows: [{ decayed: 0 }] })
					.mockResolvedValueOnce({ rows: [] })
					.mockResolvedValueOnce({ rows: [] })
					.mockResolvedValueOnce({ rows: [{ high_confidence: 0, low_confidence: 0 }] })

				const health = await memoryService.getMemoryHealth("project-1")

				expect(health.confidenceDist).toEqual({ highConfidence: 0, lowConfidence: 0 })
			})
		})

		describe("getMergeSuggestions — excludes merged memories", () => {
			it("includes duplicate_of IS NULL in SQL query", async () => {
				mockDb.query = vi.fn(async () => ({ rows: [] }))

				await memoryService.getMergeSuggestions("project-1", 0.85, 10)

				const sql = mockDb.query.mock.calls[0][0]
				expect(sql).toContain("duplicate_of IS NULL")
			})
		})

		describe("evolveMemory — title/summary and brain_events", () => {
			it("updates title when provided in options", async () => {
				mockDb.query = vi.fn()
					.mockResolvedValueOnce({ rows: [{ next: 2 }] }) // version_no
					.mockResolvedValueOnce({ rows: [] }) // INSERT version
					.mockResolvedValueOnce({ rows: [] }) // UPDATE agent_memory
					.mockResolvedValueOnce({ rows: [] }) // INSERT brain_events

				mockEmbeddings.generate.mockResolvedValue([0.1, 0.2, 0.3])

				await memoryService.evolveMemory("mem-1", "new content", "refinement", {
					title: "Updated Title",
					agent: "test-agent",
				})

				// The UPDATE should include title = $4
				const updateCall = mockDb.query.mock.calls[2]
				expect(updateCall[0]).toContain("title = $4")
				expect(updateCall[1]).toContain("Updated Title")
			})

			it("records brain_events entry on evolution", async () => {
				mockDb.query = vi.fn()
					.mockResolvedValueOnce({ rows: [{ next: 1 }] })
					.mockResolvedValueOnce({ rows: [] })
					.mockResolvedValueOnce({ rows: [] })
					.mockResolvedValueOnce({ rows: [] })

				mockEmbeddings.generate.mockResolvedValue([0.1, 0.2, 0.3])

				await memoryService.evolveMemory("mem-1", "new content", "refinement", { agent: "test-agent" })

				// Last query should be INSERT INTO brain_events
				const brainEventsCall = mockDb.query.mock.calls[3]
				expect(brainEventsCall[0]).toContain("brain_events")
				expect(brainEventsCall[0]).toContain("memory.evolved")
			})
		})

		describe("addFeedback — confidence sync", () => {
			it("updates agent_memory confidence after feedback", async () => {
				let callCount = 0
				mockDb.query = vi.fn(async () => {
					callCount++
					return { rows: [] }
				})

				await memoryService.addFeedback("mem-1", {
					outcome: "success",
					score: 0.3,
					taskId: "task-1",
					agentName: "test-agent",
				})

				// Third query should be UPDATE agent_memory SET confidence
				const confidenceUpdateCall = mockDb.query.mock.calls[2]
				expect(confidenceUpdateCall[0]).toContain("UPDATE agent_memory")
				expect(confidenceUpdateCall[0]).toContain("confidence = GREATEST(0, LEAST(1, confidence + $2))")
			})
		})
	})
})
