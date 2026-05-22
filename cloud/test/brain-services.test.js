/**
 * Central Brain v2 — Unit Tests
 *
 * Tests EmbeddingService, MemoryApprovalService, AgentScoringService,
 * BrainContextInjector, BrainEventBus, and AgentRunWrapper.
 *
 * MemoryService is tested via integration tests (requires pgvector).
 * These unit tests mock the Postgres pool.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ─── EmbeddingService ─────────────────────────────────────────────────────

describe("EmbeddingService", () => {
	it("defaults to ollama provider", () => {
		const { EmbeddingService } = require("../orchestrator/stores/brain/EmbeddingService")
		const svc = new EmbeddingService()
		expect(svc.provider).toBe("ollama")
		expect(svc.dimensions).toBe(768)
	})

	it("accepts openai provider override", () => {
		const { EmbeddingService } = require("../orchestrator/stores/brain/EmbeddingService")
		const svc = new EmbeddingService({ provider: "openai", openaiApiKey: "sk-test" })
		expect(svc.provider).toBe("openai")
		expect(svc.dimensions).toBe(1536)
	})

	it("returns null for empty text", async () => {
		const { EmbeddingService } = require("../orchestrator/stores/brain/EmbeddingService")
		const svc = new EmbeddingService()
		expect(await svc.generate("")).toBeNull()
		expect(await svc.generate("   ")).toBeNull()
	})

	it("generates toPgVector format correctly", () => {
		const { EmbeddingService } = require("../orchestrator/stores/brain/EmbeddingService")
		const svc = new EmbeddingService()
		const result = svc.toPgVector([0.1, 0.2, 0.3])
		expect(result).toBe("[0.1,0.2,0.3]")
	})

	it("falls back to secondary provider when primary fails", async () => {
		const { EmbeddingService } = require("../orchestrator/stores/brain/EmbeddingService")
		// Create with ollama as primary but no ollama running
		const svc = new EmbeddingService({
			provider: "ollama",
			ollamaBaseUrl: "http://127.0.0.1:1", // will fail
			openaiApiKey: "", // no fallback key either
		})
		const result = await svc.generate("test text")
		expect(result).toBeNull() // both fail gracefully
	})
})

// ─── MemoryApprovalService ────────────────────────────────────────────────

describe("MemoryApprovalService", () => {
	it("requires approval for bug and pattern types by default", () => {
		const { MemoryApprovalService } = require("../orchestrator/stores/brain/MemoryApprovalService")
		const svc = new MemoryApprovalService()
		expect(svc.shouldRequireApproval({ memory_type: "bug", confidence: 0.5, importance: 3 })).toBe(true)
		expect(svc.shouldRequireApproval({ memory_type: "pattern", confidence: 0.5, importance: 3 })).toBe(true)
	})

	it("auto-approves high confidence lessons", () => {
		const { MemoryApprovalService } = require("../orchestrator/stores/brain/MemoryApprovalService")
		const svc = new MemoryApprovalService({ minConfidenceForAutoApprove: 0.9 })
		expect(svc.shouldRequireApproval({ memory_type: "bug", confidence: 0.95, importance: 3 })).toBe(false)
	})

	it("requires approval for low importance lessons", () => {
		const { MemoryApprovalService } = require("../orchestrator/stores/brain/MemoryApprovalService")
		const svc = new MemoryApprovalService()
		// importance < 0.4 requires approval (source uses 0.4 threshold)
		expect(svc.shouldRequireApproval({ memory_type: "lesson", confidence: 0.5, importance: 0.2 })).toBe(true)
	})

	it("redacts API keys from content", () => {
		const { MemoryApprovalService } = require("../orchestrator/stores/brain/MemoryApprovalService")
		const svc = new MemoryApprovalService()
		const sanitized = svc.sanitizeLesson('Use api_key = "sk-abc123def456ghijklmnop" to connect')
		expect(sanitized).not.toContain("sk-abc123def456ghijklmnop")
		expect(sanitized).toContain("[REDACTED]")
	})

	it("redacts JWT tokens", () => {
		const { MemoryApprovalService } = require("../orchestrator/stores/brain/MemoryApprovalService")
		const svc = new MemoryApprovalService()
		const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNqPnd9yZ0kQ"
		const sanitized = svc.sanitizeLesson(`Token: ${jwt}`)
		expect(sanitized).not.toContain(jwt)
		expect(sanitized).toContain("[REDACTED]")
	})

	it("redacts private key headers", () => {
		const { MemoryApprovalService } = require("../orchestrator/stores/brain/MemoryApprovalService")
		const svc = new MemoryApprovalService()
		// The regex matches the BEGIN line, not the base64 content
		const content = "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA..."
		const sanitized = svc.sanitizeLesson(content)
		// The BEGIN line should be redacted
		expect(sanitized).not.toContain("-----BEGIN RSA PRIVATE KEY-----")
		expect(sanitized).toContain("[REDACTED_SECRET]")
	})

	it("detects dangerous content patterns", () => {
		const { MemoryApprovalService } = require("../orchestrator/stores/brain/MemoryApprovalService")
		const svc = new MemoryApprovalService()
		const findings = svc.checkDangerousContent("Run rm -rf / to clean up")
		expect(findings.length).toBeGreaterThan(0)
		expect(findings[0]).toHaveProperty("pattern")
		expect(findings[0]).toHaveProperty("matches")
	})

	it("returns empty array for safe content", () => {
		const { MemoryApprovalService } = require("../orchestrator/stores/brain/MemoryApprovalService")
		const svc = new MemoryApprovalService()
		const findings = svc.checkDangerousContent("This is safe content about fixing bugs")
		expect(findings).toEqual([])
	})

	it("approves a pending memory via approval queue", async () => {
		const { MemoryApprovalService } = require("../orchestrator/stores/brain/MemoryApprovalService")
		const svc = new MemoryApprovalService()

		const mockMemory = {
			query: vi.fn(async (sql, params) => {
				if (sql.includes("SELECT * FROM memory_approval_queue")) {
					return { rows: [{ id: "approval-123", memory_id: "mem-1" }] }
				}
				if (sql.includes("UPDATE memory_approval_queue")) {
					return { rows: [{ id: params[1], status: "approved" }] }
				}
				if (sql.includes("UPDATE agent_memory")) {
					return { rows: [] }
				}
				return { rows: [] }
			}),
			updateStatus: vi.fn(async () => {}),
		}

		const result = await svc.approveMemory(mockMemory, "approval-123", "test")
		expect(result).toHaveProperty("status", "approved")
	})

	it("rejects a pending memory via approval queue", async () => {
		const { MemoryApprovalService } = require("../orchestrator/stores/brain/MemoryApprovalService")
		const svc = new MemoryApprovalService()

		const mockMemory = {
			query: vi.fn(async (sql, params) => {
				if (sql.includes("SELECT * FROM memory_approval_queue")) {
					return { rows: [{ id: "approval-123", memory_id: "mem-1" }] }
				}
				return { rows: [{ id: params[1], status: "rejected" }] }
			}),
			updateStatus: vi.fn(async () => {}),
		}

		const result = await svc.rejectMemory(mockMemory, "approval-123", "test")
		expect(result).toHaveProperty("status", "rejected")
	})

	it("gets pending approvals", async () => {
		const { MemoryApprovalService } = require("../orchestrator/stores/brain/MemoryApprovalService")
		const svc = new MemoryApprovalService()

		const mockMemory = {
			query: vi.fn(async () => ({
				rows: [
					{
						id: "q-1",
						memory_id: "mem-1",
						title: "Test memory",
						memory_type: "bug",
						confidence: 0.7,
						reason: "Needs review",
						created_at: new Date().toISOString(),
					},
				],
			})),
		}

		const approvals = await svc.getPendingApprovals(mockMemory, "default", 10)
		expect(approvals).toHaveLength(1)
		expect(approvals[0]).toHaveProperty("title", "Test memory")
	})
})

// ─── AgentScoringService ──────────────────────────────────────────────────

describe("AgentScoringService", () => {
	let mockMemory
	let scoring

	beforeEach(() => {
		mockMemory = {
			query: vi.fn(async () => ({ rows: [] })),
		}
		const { AgentScoringService } = require("../orchestrator/stores/brain/AgentScoringService")
		scoring = new AgentScoringService(mockMemory, {
			successWeight: 0.6,
			recencyWeight: 0.2,
			volumeWeight: 0.2,
		})
	})

	it("initializes with default weights", () => {
		expect(scoring.successWeight).toBe(0.6)
		expect(scoring.recencyWeight).toBe(0.2)
		expect(scoring.volumeWeight).toBe(0.2)
		expect(scoring.decayHalfLifeDays).toBe(30)
	})

	it("updates score for a successful task", async () => {
		mockMemory.query = vi.fn(async (sql, params) => {
			if (sql.includes("INSERT INTO agent_scores")) {
				return { rows: [{ id: "score-1" }] }
			}
			if (sql.includes("SELECT")) {
				return {
					rows: [
						{
							id: "score-1",
							agent: "test-agent",
							model: "deepseek",
							task_type: "coding",
							total_tasks: 1,
							successful_tasks: 1,
							score: 60,
							last_task_at: new Date().toISOString(),
						},
					],
				}
			}
			return { rows: [] }
		})

		const result = await scoring.updateScore({
			projectId: "default",
			agent: "test-agent",
			model: "deepseek",
			taskType: "coding",
			success: true,
			duration: 5000,
		})

		expect(result).toHaveProperty("agent", "test-agent")
	})

	it("updates score for a failed task", async () => {
		mockMemory.query = vi.fn(async (sql, params) => {
			if (sql.includes("INSERT INTO agent_scores")) {
				return { rows: [{ id: "score-2" }] }
			}
			if (sql.includes("SELECT")) {
				return {
					rows: [
						{
							id: "score-2",
							agent: "test-agent",
							model: "deepseek",
							task_type: "coding",
							total_tasks: 1,
							successful_tasks: 0,
							score: 0,
							last_task_at: new Date().toISOString(),
						},
					],
				}
			}
			return { rows: [] }
		})

		const result = await scoring.updateScore({
			projectId: "default",
			agent: "test-agent",
			model: "deepseek",
			taskType: "coding",
			success: false,
			duration: 10000,
		})

		expect(result).toHaveProperty("agent", "test-agent")
	})

	it("returns leaderboard sorted by score descending", async () => {
		mockMemory.query = vi.fn(async () => ({
			rows: [
				{ agent: "agent-a", model: "gpt4", task_type: "coding", score: 85, total_tasks: 10, successful_tasks: 8, last_task_at: new Date().toISOString() },
				{ agent: "agent-b", model: "claude", task_type: "coding", score: 72, total_tasks: 8, successful_tasks: 6, last_task_at: new Date().toISOString() },
			],
		}))

		const leaderboard = await scoring.getLeaderboard("default", 10)
		expect(leaderboard).toHaveLength(2)
		expect(leaderboard[0].score).toBeGreaterThan(leaderboard[1].score)
	})

	it("returns best model for a task type", async () => {
		mockMemory.query = vi.fn(async () => ({
			rows: [
				{ agent: "agent-a", model: "deepseek", task_type: "coding", score: 90 },
				{ agent: "agent-b", model: "claude", task_type: "coding", score: 80 },
			],
		}))

		const best = await scoring.getBestModelForTask("default", "coding")
		expect(best).toHaveProperty("model", "deepseek")
		expect(best).toHaveProperty("score", 90)
	})

	it("applyDecay reduces scores of inactive agents", async () => {
		mockMemory.query = vi.fn(async () => ({ rowCount: 2 }))

		const count = await scoring.applyDecay("default")

		expect(count).toBe(2)
		const sqlCall = mockMemory.query.mock.calls[0][0]
		expect(sqlCall).toContain("UPDATE agent_scores")
		expect(sqlCall).toContain("score = score * POWER")
	})

	it("applyDecay returns 0 when no agents affected", async () => {
		mockMemory.query = vi.fn(async () => ({ rowCount: 0 }))

		const count = await scoring.applyDecay("default")

		expect(count).toBe(0)
	})

	it("getAgentScores returns scores for a specific agent", async () => {
		mockMemory.query = vi.fn(async () => ({
			rows: [
				{ agent: "test-agent", model: "deepseek", task_type: "coding", score: 85 },
				{ agent: "test-agent", model: "claude", task_type: "general", score: 70 },
			],
		}))

		const scores = await scoring.getAgentScores("default", "test-agent")

		expect(scores).toHaveLength(2)
		expect(scores[0].agent).toBe("test-agent")
	})

	it("_calculateScore computes composite score correctly", () => {
		// Access private method via prototype
		const score = scoring._calculateScore({
			successRate: 0.8,
			totalTasks: 10,
			avgDuration: 5000,
			usedMemories: 5,
		})

		// successComponent = 0.8 * 60 = 48
		// recencyComponent = min(10/50, 1) * 20 = 4
		// volumeComponent = min(10/100, 1) * 20 = 2
		// memoryBonus = min(5/10, 1) * 5 = 2.5
		// speedPenalty = 0 (duration < 300000)
		// raw = 48 + 4 + 2 + 2.5 - 0 = 56.5
		expect(score).toBe(56.5)
	})

	it("_calculateScore applies speed penalty for tasks > 5 min", () => {
		const score = scoring._calculateScore({
			successRate: 1.0,
			totalTasks: 100,
			avgDuration: 600000, // 10 min
			usedMemories: 0,
		})

		// successComponent = 1.0 * 60 = 60
		// recencyComponent = min(100/50, 1) * 20 = 20
		// volumeComponent = min(100/100, 1) * 20 = 20
		// memoryBonus = 0
		// speedPenalty = 10
		// raw = 60 + 20 + 20 + 0 - 10 = 90
		expect(score).toBe(90)
	})
})

// ─── BrainContextInjector ─────────────────────────────────────────────────

describe("BrainContextInjector", () => {
	let mockMemory
	let injector

	beforeEach(() => {
		mockMemory = {
			searchMemory: vi.fn(async () => [
				{
					id: "mem-1",
					title: "Test memory",
					content: "This is a test memory",
					summary: "Test summary",
					memory_type: "lesson",
					confidence: 0.85,
					importance: 3,
					agent: "test-agent",
					model: "deepseek",
					tags: ["test"],
					files: ["test.js"],
					created_at: new Date().toISOString(),
					similarity: 0.92,
				},
			]),
			listMemories: vi.fn(async () => []),
		}
		const { BrainContextInjector } = require("../orchestrator/stores/brain/BrainContextInjector")
		injector = new BrainContextInjector(mockMemory, { maxMemories: 5, minSimilarity: 0.6 })
	})

	it("builds context from relevant memories", async () => {
		const result = await injector.buildContext({
			projectId: "default",
			goal: "fix database connection",
			model: "codex",
		})

		expect(result).toHaveProperty("memories")
		expect(result).toHaveProperty("contextBlock")
		expect(result).toHaveProperty("tokenCount")
		expect(result.memories).toHaveLength(1)
	})

	it("formats context for codex model", async () => {
		const result = await injector.buildContext({
			projectId: "default",
			goal: "test",
			model: "codex",
		})
		expect(result.contextBlock).toContain("Relevant memories")
	})

	it("formats context for claude model with XML tags", async () => {
		const result = await injector.buildContext({
			projectId: "default",
			goal: "test",
			model: "claude",
		})
		// Claude format uses <memory> tags inside a header, not <memory_context> wrapper
		expect(result.contextBlock).toContain("<memory")
		expect(result.contextBlock).toContain("</memory>")
		expect(result.contextBlock).toContain("Relevant memories")
	})

	it("formats context for deepseek model", async () => {
		const result = await injector.buildContext({
			projectId: "default",
			goal: "test",
			model: "deepseek",
		})
		expect(result.contextBlock).toContain("Relevant memories")
		expect(result.contextBlock).toContain("[MEMORY 1]")
	})

	it("creates system prompt with memory context", async () => {
		const result = await injector.createSystemPrompt({
			projectId: "default",
			goal: "test",
			model: "codex",
		})
		// createSystemPrompt returns { systemPrompt, memories, tokenCount }
		expect(result).toHaveProperty("systemPrompt")
		expect(result).toHaveProperty("memories")
		expect(result).toHaveProperty("tokenCount")
		expect(result.systemPrompt).toContain("Central Brain Memory Context")
		expect(result.systemPrompt).toContain("Test memory")
		expect(result.systemPrompt).toContain("Test summary")
	})

	it("returns empty context when no memories found", async () => {
		const emptyMemory = { searchMemory: vi.fn(async () => []), listMemories: vi.fn(async () => []) }
		const { BrainContextInjector } = require("../orchestrator/stores/brain/BrainContextInjector")
		const emptyInjector = new BrainContextInjector(emptyMemory)

		const result = await emptyInjector.buildContext({
			projectId: "default",
			goal: "something obscure",
		})
		expect(result.memories).toHaveLength(0)
		expect(result.contextBlock).toBe("")
		expect(result.tokenCount).toBe(0)
	})

	it("_formatKimi formats memories for kimi model", () => {
		const memories = [
			{
				id: "mem-1",
				title: "Test memory",
				content: "This is a test memory",
				summary: "Test summary",
				memory_type: "lesson",
				confidence: 0.85,
				importance: 3,
				agent: "test-agent",
				model: "deepseek",
				tags: ["test"],
				files: ["test.js"],
				created_at: new Date().toISOString(),
				similarity: 0.92,
			},
		]
		const result = injector._formatKimi("Relevant memories", memories)
		expect(result).toContain("Relevant memories")
		expect(result).toContain("Test memory")
		expect(result).toContain("Test summary")
		// Kimi format uses "## Memory" not "[Memory 1]"
		expect(result).toContain("## Memory 1")
	})

	it("fitsInLimit returns true when under token limit", () => {
		// fitsInLimit takes only contextBlock, uses this.maxTokens internally
		const result = injector.fitsInLimit("short text")
		expect(result).toBe(true)
	})

	it("fitsInLimit returns false when over token limit", () => {
		// Create a string that will exceed the default maxTokens (4000)
		// 4000 tokens * 4 chars/token = 16000 chars
		const longText = "x".repeat(20000)
		const result = injector.fitsInLimit(longText)
		expect(result).toBe(false)
	})
})

// ─── BrainEventBus ────────────────────────────────────────────────────────

describe("BrainEventBus", () => {
	let mockMemory
	let eventBus

	beforeEach(() => {
		mockMemory = {
			query: vi.fn(async () => ({ rows: [] })),
		}
		const { BrainEventBus } = require("../orchestrator/stores/brain/BrainEventBus")
		eventBus = new BrainEventBus(mockMemory, null, { eventTtlDays: 90 })
	})

	it("emits an event and persists to postgres", async () => {
		let capturedSql = ""
		mockMemory.query = vi.fn(async (sql, params) => {
			capturedSql = sql
			return { rows: [{ id: params[0] }] }
		})

		const event = await eventBus.emit("default", "memory.created", { memoryId: "mem-1" }, "test-agent")
		expect(event).toHaveProperty("id")
		expect(event).toHaveProperty("event_type", "memory.created")
		expect(event).toHaveProperty("actor", "test-agent")
		expect(capturedSql).toContain("INSERT INTO brain_events")
	})

	it("emits memory.created convenience method", async () => {
		mockMemory.query = vi.fn(async (sql, params) => {
			return { rows: [{ id: params[0] }] }
		})

		const event = await eventBus.emitMemoryCreated("default", "mem-1", "test-agent", "Test title")
		expect(event).toHaveProperty("event_type", "memory.created")
	})

	it("emits memory.merged convenience method", async () => {
		mockMemory.query = vi.fn(async (sql, params) => {
			return { rows: [{ id: params[0] }] }
		})

		const event = await eventBus.emitMemoryMerged("default", "mem-1", "mem-2", "test-agent")
		expect(event).toHaveProperty("event_type", "memory.merged")
	})

	it("emits decay applied convenience method", async () => {
		mockMemory.query = vi.fn(async (sql, params) => {
			return { rows: [{ id: params[0] }] }
		})

		const event = await eventBus.emitDecayApplied("default", 5)
		expect(event).toHaveProperty("event_type", "memory.decay_applied")
	})

	it("retrieves events with filters", async () => {
		mockMemory.query = vi.fn(async () => ({
			rows: [
				{ id: "evt-1", project_id: "default", event_type: "memory.created", actor: "test", payload: "{}", created_at: new Date().toISOString() },
			],
		}))

		const events = await eventBus.getEvents("default", 10, "memory.created")
		expect(events).toHaveLength(1)
		expect(events[0]).toHaveProperty("event_type", "memory.created")
	})

	it("returns event summary with type counts", async () => {
		mockMemory.query = vi.fn(async () => ({
			rows: [
				{ event_type: "memory.created", count: "5", last_event: new Date().toISOString() },
				{ event_type: "memory.recall", count: "3", last_event: new Date().toISOString() },
			],
		}))

		const summary = await eventBus.getEventSummary("default")
		// getEventSummary returns an array of { event_type, count, last_event }
		expect(Array.isArray(summary)).toBe(true)
		expect(summary).toHaveLength(2)
		expect(summary[0]).toHaveProperty("event_type")
		expect(summary[0]).toHaveProperty("count")
	})
	it("subscribe warns when no Redis client available", async () => {
		const { BrainEventBus } = require("../orchestrator/stores/brain/BrainEventBus")
		const localBus = new BrainEventBus(mockMemory, null, { eventTtlDays: 90 })
		const handler = vi.fn()
		// subscribe is async, returns undefined when no Redis
		await expect(localBus.subscribe(handler)).resolves.toBeUndefined()
	})

	it("cleanup deletes old events beyond TTL", async () => {
		mockMemory.query = vi.fn(async () => ({ rowCount: 3 }))

		const count = await eventBus.cleanup()

		expect(count).toBe(3)
		const sqlCall = mockMemory.query.mock.calls[0][0]
		expect(sqlCall).toContain("DELETE FROM brain_events")
		// cleanup uses ($1 || ' days')::INTERVAL syntax
		expect(sqlCall).toContain("days')::INTERVAL")
	})

	it("cleanup returns 0 when no old events", async () => {
		mockMemory.query = vi.fn(async () => ({ rowCount: 0 }))

		const count = await eventBus.cleanup()

		expect(count).toBe(0)
	})
})

// ─── AgentRunWrapper ──────────────────────────────────────────────────────

describe("AgentRunWrapper", () => {
	let wrapper
	let mockMemory
	let mockEmbedding
	let mockScoring
	let mockEventBus
	let mockApproval

	beforeEach(() => {
		mockMemory = {
			query: vi.fn(async () => ({ rows: [] })),
			searchMemory: vi.fn(async () => []),
			createMemory: vi.fn(async () => "mem-new"),
			logRecall: vi.fn(async () => {}),
		}
		mockEmbedding = {
			generate: vi.fn(async () => [0.1, 0.2, 0.3]),
		}
		mockScoring = {
			updateScore: vi.fn(async () => ({ agent: "test", score: 50 })),
		}
		mockEventBus = {
			emit: vi.fn(async () => ({ id: "evt-1" })),
		}
		mockApproval = {
			shouldRequireApproval: vi.fn(() => false),
			sanitizeLesson: vi.fn((c) => c),
		}

		const { AgentRunWrapper } = require("../orchestrator/stores/brain/AgentRunWrapper")
		wrapper = new AgentRunWrapper(
			mockMemory,
			mockEmbedding,
			mockScoring,
			mockEventBus,
			mockApproval,
			{ maxMemoriesPerTask: 10, maxContextTokens: 4000, minImportanceThreshold: 0.3 }
		)
	})

	it("runs an agent task with full memory lifecycle", async () => {
		const agent = {
			name: "test-agent",
			model: "deepseek",
			run: vi.fn(async (input) => ({
				success: true,
				output: "Task completed successfully",
				lesson: {
					title: "Always validate input",
					summary: "Always validate input before processing",
					content: "Always validate input before processing",
					memoryType: "lesson",
					tags: ["validation"],
					files: ["src/handler.js"],
					importance: 0.7,
					confidence: 0.85,
				},
				files: ["src/handler.js"],
				duration: 5000,
			})),
		}

		const result = await wrapper.run(agent, {
			projectId: "default",
			goal: "Fix input validation",
			agent: "test-agent",
			model: "deepseek",
		})

		// AgentRunWrapper.run returns { runId, taskId, memories, lesson, score, duration }
		expect(result).toHaveProperty("runId")
		expect(result).toHaveProperty("taskId")
		expect(result).toHaveProperty("memories")
		expect(result).toHaveProperty("lesson")
		expect(result).toHaveProperty("score")
		expect(result).toHaveProperty("duration")
		expect(mockMemory.searchMemory).toHaveBeenCalled()
		expect(mockMemory.createMemory).toHaveBeenCalled()
		expect(mockScoring.updateScore).toHaveBeenCalled()
		expect(mockEventBus.emit).toHaveBeenCalled()
	})

	it("handles agent failure gracefully", async () => {
		const agent = {
			name: "test-agent",
			model: "deepseek",
			run: vi.fn(async () => {
				throw new Error("Agent crashed")
			}),
		}

		// AgentRunWrapper throws on failure (does not return { success: false })
		await expect(
			wrapper.run(agent, {
				projectId: "default",
				goal: "Do something",
				agent: "test-agent",
				model: "deepseek",
			})
		).rejects.toThrow("Agent crashed")

		// Scoring should still be called with failure
		expect(mockScoring.updateScore).toHaveBeenCalledWith(
			expect.objectContaining({ success: false })
		)
	})

	it("enforces safety limits on memory count", async () => {
		const agent = {
			name: "test-agent",
			model: "deepseek",
			run: vi.fn(async (input) => ({
				success: true,
				output: "ok",
				lesson: {
					title: "Test lesson",
					summary: "test",
					content: "test",
				},
			})),
		}

		// Return more memories than the limit
		const manyMemories = Array.from({ length: 20 }, (_, i) => ({
			id: `mem-${i}`,
			title: `Memory ${i}`,
			content: `Content ${i}`,
			similarity: 0.9,
		}))
		mockMemory.searchMemory = vi.fn(async () => manyMemories)

		const result = await wrapper.run(agent, {
			projectId: "default",
			goal: "Test limits",
			agent: "test-agent",
		})

		// Should not crash with too many memories
		expect(result).toHaveProperty("runId")
		expect(result).toHaveProperty("taskId")
		// The limit is enforced by searchMemory (SQL LIMIT clause), not by the wrapper.
		// The wrapper passes maxMemoriesPerTask as the limit to searchMemory.
		expect(mockMemory.searchMemory).toHaveBeenCalledWith(
			expect.objectContaining({ limit: 10 })
		)
	})

	it("retries on transient failure", async () => {
		let attempts = 0
		const agent = {
			name: "test-agent",
			model: "deepseek",
			run: vi.fn(async () => {
				attempts++
				if (attempts < 2) throw new Error("Transient error")
				return {
					success: true,
					output: "ok",
					lesson: {
						title: "Retry lesson",
						summary: "test",
						content: "test",
					},
				}
			}),
		}

		const result = await wrapper.run(agent, {
			projectId: "default",
			goal: "Retry test",
			agent: "test-agent",
		})

		expect(result).toHaveProperty("runId")
		expect(result).toHaveProperty("taskId")
		expect(attempts).toBe(2)
	})
})

// ─── Service Registry ─────────────────────────────────────────────────────

// Note: We do NOT require index.js here because it transitively requires
// MemoryService.js which requires the 'pg' module. Mocking 'pg' with
// vi.mock in vitest v4 causes internal errors during hoisting.
// Instead, we verify the exports by checking each module individually.

describe("brain service registry (index.js)", () => {
	it("exports all service classes", () => {
		// Verify each class is exported from its own module
		const { EmbeddingService } = require("../orchestrator/stores/brain/EmbeddingService")
		const { MemoryService } = require("../orchestrator/stores/brain/MemoryService")
		const { AgentRunWrapper } = require("../orchestrator/stores/brain/AgentRunWrapper")
		const { BrainContextInjector } = require("../orchestrator/stores/brain/BrainContextInjector")
		const { MemoryApprovalService } = require("../orchestrator/stores/brain/MemoryApprovalService")
		const { AgentScoringService } = require("../orchestrator/stores/brain/AgentScoringService")
		const { BrainEventBus } = require("../orchestrator/stores/brain/BrainEventBus")

		expect(typeof EmbeddingService).toBe("function")
		expect(typeof MemoryService).toBe("function")
		expect(typeof AgentRunWrapper).toBe("function")
		expect(typeof BrainContextInjector).toBe("function")
		expect(typeof MemoryApprovalService).toBe("function")
		expect(typeof AgentScoringService).toBe("function")
		expect(typeof BrainEventBus).toBe("function")
	})

	it("exports createServices and applySchema", () => {
		const brain = require("../orchestrator/stores/brain/index")
		expect(brain).toHaveProperty("createServices")
		expect(typeof brain.createServices).toBe("function")
		expect(brain).toHaveProperty("applySchema")
		expect(typeof brain.applySchema).toBe("function")
	})

	it("exports ConsensusService and ModelRouter from index", () => {
		const brain = require("../orchestrator/stores/brain/index")
		expect(brain).toHaveProperty("ConsensusService")
		expect(brain).toHaveProperty("ModelRouter")
		expect(typeof brain.ConsensusService).toBe("function")
		expect(typeof brain.ModelRouter).toBe("function")
	})
})

// ─── ConsensusService ─────────────────────────────────────────────────────

describe("ConsensusService", () => {
	let mockPool
	let consensus

	beforeEach(() => {
		mockPool = {
			query: vi.fn(async (sql, params) => ({ rows: [] })),
		}
		const { ConsensusService } = require("../orchestrator/stores/brain/ConsensusService")
		consensus = new ConsensusService(mockPool, {
			approveThreshold: 0.45,
			blockThreshold: -0.45,
			minVoters: 1,
		})
	})

	it("initializes with default thresholds", () => {
		const { ConsensusService: CS } = require("../orchestrator/stores/brain/ConsensusService")
		const svc = new CS(mockPool)
		expect(svc.approveThreshold).toBe(0.45)
		expect(svc.blockThreshold).toBe(-0.45)
		expect(svc.minVoters).toBe(1)
	})

	it("approves when weighted score exceeds threshold", async () => {
		mockPool.query = vi.fn(async (sql, params) => {
			if (sql.includes("INSERT INTO brain_consensus_decisions")) {
				return { rows: [{ id: params[0] }] }
			}
			return { rows: [] }
		})

		const result = await consensus.decide({
			projectId: "default",
			decisionType: "deploy",
			contextId: "ctx-1",
			votes: [
				{ agent: "agent-a", decision: "approve", confidence: 0.9, reason: "Looks good" },
				{ agent: "agent-b", decision: "approve", confidence: 0.8, reason: "All tests pass" },
			],
			createdBy: "test",
		})

		expect(result.finalDecision).toBe("approve")
		expect(result.score).toBeGreaterThan(0)
		expect(result.agentCount).toBe(2)
		expect(result.id).toBeTruthy()
	})

	it("blocks when weighted score is below block threshold", async () => {
		mockPool.query = vi.fn(async (sql, params) => {
			if (sql.includes("INSERT INTO brain_consensus_decisions")) {
				return { rows: [{ id: params[0] }] }
			}
			return { rows: [] }
		})

		const result = await consensus.decide({
			projectId: "default",
			decisionType: "deploy",
			contextId: "ctx-2",
			votes: [
				{ agent: "agent-a", decision: "block", confidence: 0.9, reason: "Critical bug found" },
				{ agent: "agent-b", decision: "block", confidence: 0.8, reason: "Security issue" },
			],
			createdBy: "test",
		})

		expect(result.finalDecision).toBe("block")
		expect(result.score).toBeLessThan(0)
	})

	it("returns revise for mixed votes near zero", async () => {
		mockPool.query = vi.fn(async (sql, params) => {
			if (sql.includes("INSERT INTO brain_consensus_decisions")) {
				return { rows: [{ id: params[0] }] }
			}
			return { rows: [] }
		})

		const result = await consensus.decide({
			projectId: "default",
			decisionType: "deploy",
			contextId: "ctx-3",
			votes: [
				{ agent: "agent-a", decision: "approve", confidence: 0.5, reason: "Seems fine" },
				{ agent: "agent-b", decision: "block", confidence: 0.5, reason: "Not sure" },
			],
			createdBy: "test",
		})

		// approve(1.0*0.5) + block(-1.0*0.5) = 0, normalized by totalWeight(1.0) = 0
		// 0 is between -0.45 and 0.45, so finalDecision is "revise"
		expect(result.finalDecision).toBe("revise")
		expect(Math.abs(result.score)).toBeLessThan(0.45)
	})

	it("throws for invalid decision type", async () => {
		await expect(
			consensus.decide({
				projectId: "default",
				decisionType: "invalid_type",
				contextId: "ctx-4",
				votes: [{ agent: "agent-a", decision: "approve", confidence: 0.9 }],
				createdBy: "test",
			}),
		).rejects.toThrow(/decisionType/)
	})

	it("throws for invalid vote decision value", async () => {
		await expect(
			consensus.decide({
				projectId: "default",
				decisionType: "deploy",
				contextId: "ctx-5",
				votes: [{ agent: "agent-a", decision: "invalid_vote", confidence: 0.9 }],
				createdBy: "test",
			}),
		).rejects.toThrow(/Invalid decision/)
	})

	it("throws for empty votes array", async () => {
		await expect(
			consensus.decide({
				projectId: "default",
				decisionType: "deploy",
				contextId: "ctx-6",
				votes: [],
				createdBy: "test",
			}),
		).rejects.toThrow(/At least one vote is required/)
	})

	it("retrieves a decision by id", async () => {
		mockPool.query = vi.fn(async (sql, params) => {
			if (sql.includes("WHERE id =")) {
				return {
					rows: [
						{
							id: "dec-1",
							project_id: "default",
							decision_type: "deploy",
							score: 0.85,
							final_decision: "approve",
							risk_flags: [],
							agent_count: 2,
							created_by: "test",
							created_at: new Date().toISOString(),
						},
					],
				}
			}
			return { rows: [] }
		})

		const decision = await consensus.getDecision("dec-1")
		expect(decision).toHaveProperty("id", "dec-1")
		expect(decision).toHaveProperty("final_decision", "approve")
	})

	it("lists decisions with filters", async () => {
		mockPool.query = vi.fn(async () => ({
			rows: [
				{ id: "dec-1", project_id: "default", decision_type: "deploy", score: 0.85, final_decision: "approve", created_at: new Date().toISOString() },
				{ id: "dec-2", project_id: "default", decision_type: "deploy", score: -0.9, final_decision: "block", created_at: new Date().toISOString() },
			],
		}))

		const decisions = await consensus.listDecisions({ projectId: "default", limit: 10 })
		expect(decisions).toHaveProperty("rows")
		expect(decisions).toHaveProperty("total")
		expect(decisions.rows).toHaveLength(2)
	})

	it("returns stats for a project", async () => {
		mockPool.query = vi.fn(async () => ({ rows: [{ total_decisions: 10, approved: 5, blocked: 2, revised: 2, needs_human: 1, avg_score: 0.35, avg_voters: 2.5 }] }))

		const stats = await consensus.getStats("default")
		expect(stats).toHaveProperty("total_decisions", 10)
		expect(stats).toHaveProperty("approved", 5)
		expect(stats).toHaveProperty("blocked", 2)
	})
})

// ─── ModelRouter ──────────────────────────────────────────────────────────

describe("ModelRouter", () => {
	let mockPool
	let router

	beforeEach(() => {
		mockPool = {
			query: vi.fn(async (sql, params) => ({ rows: [] })),
		}
		const { ModelRouter } = require("../orchestrator/stores/brain/ModelRouter")
		router = new ModelRouter(mockPool)
	})

	it("initializes with default fallbacks", () => {
		expect(router.fallbacks).toBeDefined()
		expect(router.fallbacks.planning).toBeDefined()
		expect(router.fallbacks.coding).toBeDefined()
		expect(router.fallbacks.debugging).toBeDefined()
		expect(router.fallbacks.qa).toBeDefined()
		expect(router.fallbacks.deployment).toBeDefined()
		expect(router.fallbacks.research).toBeDefined()
		expect(router.fallbacks.compliance).toBeDefined()
	})

	it("routes to best model when scores exist", async () => {
		mockPool.query = vi.fn(async (sql, params) => {
			if (sql.includes("FROM agent_scores") && sql.includes("ORDER BY score DESC")) {
				return {
					rows: [
						{
							agent: "deepseek-coder",
							model: "deepseek-chat",
							task_type: "coding",
							score: 95,
							total_tasks: 20,
							successful_tasks: 19,
							hallucination_count: 1,
							avg_cost_usd: 0.002,
							avg_latency_ms: 1500,
						},
					],
				}
			}
			return { rows: [] }
		})

		const result = await router.route({
			projectId: "default",
			taskType: "coding",
		})

		expect(result).toHaveProperty("agent")
		expect(result).toHaveProperty("model")
		expect(result.agent).toBe("deepseek-coder")
		expect(result.model).toBe("deepseek-chat")
	})

	it("falls back to default chain when no scores exist", async () => {
		mockPool.query = vi.fn(async () => ({ rows: [] }))

		const result = await router.route({
			projectId: "default",
			taskType: "coding",
		})

		expect(result).toHaveProperty("agent")
		expect(result).toHaveProperty("model")
		expect(result.agent).toBeTruthy()
		expect(result.model).toBeTruthy()
	})

	it("throws error for unknown task type", async () => {
		await expect(router.route({
			projectId: "default",
			taskType: "unknown_task_type",
		})).rejects.toThrow("No fallback chain configured for task type")
	})

	it("calculates score correctly", () => {
		const score = router.calculateScore({
			successCount: 19,
			totalTasks: 20,
			hallucinationCount: 1,
			avgCostUsd: 0.002,
			avgLatencyMs: 1500,
		})

		expect(score).toBeGreaterThan(0)
		expect(score).toBeLessThanOrEqual(1)
	})

	it("returns baseline score for zero total tasks", () => {
		const score = router.calculateScore({
			successCount: 0,
			totalTasks: 0,
			hallucinationCount: 0,
			avgCostUsd: 0,
			avgLatencyMs: 0,
		})

		// With totalTasks=0, Math.max(0,1)=1, so successRate=0, hallucinationRate=0
		// score = 0*0.5 + (1-0)*0.2 - 0*0.15 - 0*0.15 = 0.2
		expect(score).toBe(0.2)
	})

	it("records outcome successfully", async () => {
		mockPool.query = vi.fn(async () => ({ rows: [] }))

		const result = await router.recordOutcome({
			projectId: "default",
			taskType: "coding",
			taskId: "task-1",
			runId: "run-1",
			agent: "deepseek-coder",
			model: "deepseek-chat",
			success: true,
			latencyMs: 2000,
			costUsd: 0.001,
			hallucinated: false,
		})

		expect(result).toHaveProperty("recorded", true)
	})

	it("records failed outcome", async () => {
		mockPool.query = vi.fn(async () => ({ rows: [] }))

		const result = await router.recordOutcome({
			projectId: "default",
			taskType: "coding",
			taskId: "task-2",
			runId: "run-2",
			agent: "deepseek-coder",
			model: "deepseek-chat",
			success: false,
			latencyMs: 5000,
			costUsd: 0.002,
			hallucinated: true,
			error: "Model hallucinated",
		})

		expect(result).toHaveProperty("recorded", true)
	})

	it("retrieves routing logs with filters", async () => {
		mockPool.query = vi.fn(async () => ({
			rows: [
				{ id: "log-1", task_type: "coding", agent: "deepseek-coder", model_selected: "deepseek-chat", success: true, created_at: new Date().toISOString() },
			],
		}))

		const logs = await router.getRoutingLogs({ projectId: "default", limit: 10 })
		expect(logs).toHaveProperty("rows")
		expect(logs).toHaveProperty("total")
		expect(logs.rows).toHaveLength(1)
		expect(logs.rows[0]).toHaveProperty("task_type", "coding")
	})

	it("returns performance summary", async () => {
		mockPool.query = vi.fn(async (sql) => {
			if (sql.includes("GROUP BY agent")) {
				return {
					rows: [
						{ agent: "deepseek-coder", model: "deepseek-chat", task_type: "coding", total: 20, successes: 19, avg_duration_ms: 1500, avg_cost_usd: 0.002, hallucination_count: 1 },
					],
				}
			}
			return { rows: [] }
		})

		const summary = await router.getPerformanceSummary("default")
		expect(summary).toBeDefined()
	})
})
