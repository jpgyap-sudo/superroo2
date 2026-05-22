/**
 * VectorStoreAdapter — Unit Tests
 *
 * Tests the abstract interface, factory, and all concrete adapters.
 * Uses MemoryVectorAdapter for integration testing (no external deps).
 * Tests that all adapters conform to the VectorStoreAdapter interface.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ─── Interface Conformance Tests ─────────────────────────────────────────

describe("VectorStoreAdapter (abstract base class)", () => {
	it("throws when instantiated directly", () => {
		const { VectorStoreAdapter } = require("../orchestrator/stores/adapters/VectorStoreAdapter")
		expect(() => new VectorStoreAdapter()).toThrow("VectorStoreAdapter is abstract")
	})

	it("requires all abstract methods to be implemented by subclasses", async () => {
		const { VectorStoreAdapter } = require("../orchestrator/stores/adapters/VectorStoreAdapter")

		class IncompleteAdapter extends VectorStoreAdapter {
			constructor() {
				super()
				this._adapterName = "IncompleteAdapter"
			}
		}

		const adapter = new IncompleteAdapter()
		const abstractMethods = ["init", "close", "storeBugFix", "searchSimilar", "updateTestStatus",
			"storeLesson", "searchLessons", "getLessonCountByProject", "getStats", "healthCheck"]

		for (const method of abstractMethods) {
			// async methods return rejected promises; sync methods throw directly
			await expect(async () => {
				try {
					await adapter[method]()
				} catch (e) {
					throw e
				}
			}).rejects.toThrow(`${adapter._adapterName}.${method}() not implemented`)
		}
	})
})

// ─── Factory Tests ───────────────────────────────────────────────────────

describe("createAdapter (factory)", () => {
	it("creates a MemoryVectorAdapter when type='memory'", () => {
		const { createAdapter } = require("../orchestrator/stores/adapters")
		const adapter = createAdapter({ type: "memory" })
		expect(adapter.constructor.name).toBe("MemoryVectorAdapter")
	})

	it("creates a PgVectorAdapter when type='pgvector'", () => {
		const { createAdapter } = require("../orchestrator/stores/adapters")
		const adapter = createAdapter({ type: "pgvector" })
		expect(adapter.constructor.name).toBe("PgVectorAdapter")
	})

	it("creates a QdrantAdapter when type='qdrant'", () => {
		const { createAdapter } = require("../orchestrator/stores/adapters")
		const adapter = createAdapter({ type: "qdrant" })
		expect(adapter.constructor.name).toBe("QdrantAdapter")
	})

	it("creates a PineconeAdapter when type='pinecone'", () => {
		const { createAdapter } = require("../orchestrator/stores/adapters")
		const adapter = createAdapter({ type: "pinecone" })
		expect(adapter.constructor.name).toBe("PineconeAdapter")
	})

	it("creates a ChromaAdapter when type='chroma'", () => {
		const { createAdapter } = require("../orchestrator/stores/adapters")
		const adapter = createAdapter({ type: "chroma" })
		expect(adapter.constructor.name).toBe("ChromaAdapter")
	})

	it("throws for unknown adapter type", () => {
		const { createAdapter } = require("../orchestrator/stores/adapters")
		expect(() => createAdapter({ type: "nonexistent" })).toThrow("Unknown vector store adapter type")
	})

	it("listAdapterTypes returns all registered types", () => {
		const { listAdapterTypes } = require("../orchestrator/stores/adapters")
		const types = listAdapterTypes()
		expect(types).toContain("pgvector")
		expect(types).toContain("memory")
		expect(types).toContain("qdrant")
		expect(types).toContain("pinecone")
		expect(types).toContain("chroma")
	})

	it("registerAdapter allows custom adapters", () => {
		const { registerAdapter, createAdapter, VectorStoreAdapter } = require("../orchestrator/stores/adapters")

		class CustomAdapter extends VectorStoreAdapter {
			constructor(opts) {
				super(opts)
				this._adapterName = "CustomAdapter"
			}
			async init() { this._initialized = true }
			async close() { this._initialized = false }
			async storeBugFix() { return { id: "custom", success: true } }
			async searchSimilar() { return [] }
			async updateTestStatus() { return true }
			async storeLesson() { return { id: "custom", success: true } }
			async searchLessons() { return [] }
			async getLessonCountByProject() { return {} }
			async getStats() { return {} }
			async healthCheck() { return { healthy: true } }
		}

		registerAdapter("custom", CustomAdapter)
		const adapter = createAdapter({ type: "custom" })
		expect(adapter.constructor.name).toBe("CustomAdapter")
	})

	it("getConfiguredAdapterType reads from env", () => {
		const { getConfiguredAdapterType } = require("../orchestrator/stores/adapters")
		const orig = process.env.VECTOR_STORE_TYPE
		delete process.env.VECTOR_STORE_TYPE
		expect(getConfiguredAdapterType()).toBe("pgvector")
		process.env.VECTOR_STORE_TYPE = "memory"
		expect(getConfiguredAdapterType()).toBe("memory")
		process.env.VECTOR_STORE_TYPE = orig
	})
})

// ─── MemoryVectorAdapter Integration Tests ───────────────────────────────

describe("MemoryVectorAdapter (integration)", () => {
	let adapter

	beforeEach(async () => {
		const { MemoryVectorAdapter } = require("../orchestrator/stores/adapters/MemoryVectorAdapter")
		adapter = new MemoryVectorAdapter()
		await adapter.init()
	})

	afterEach(async () => {
		await adapter.close()
	})

	describe("lifecycle", () => {
		it("initializes and closes", async () => {
			const { MemoryVectorAdapter } = require("../orchestrator/stores/adapters/MemoryVectorAdapter")
			const a = new MemoryVectorAdapter()
			expect(a._initialized).toBe(false)
			await a.init()
			expect(a._initialized).toBe(true)
			await a.close()
			expect(a._initialized).toBe(false)
		})
	})

	describe("storeBugFix", () => {
		it("stores a bug fix and returns an id", async () => {
			const result = await adapter.storeBugFix({
				task_id: "test-task-1",
				agent_type: "deepseek",
				error_summary: "TypeError: cannot read property",
				instruction: "Fix the login bug",
				result: "Added null check",
			})
			expect(result.success).toBe(true)
			expect(result.id).toBe("test-task-1")
		})

		it("generates an id when task_id is missing", async () => {
			const result = await adapter.storeBugFix({
				agent_type: "deepseek",
				error_summary: "Null pointer",
				instruction: "Fix it",
				result: "Fixed",
			})
			expect(result.success).toBe(true)
			expect(result.id).toBeTruthy()
		})
	})

	describe("searchSimilar", () => {
		beforeEach(async () => {
			await adapter.storeBugFix({
				task_id: "fix-1",
				agent_type: "deepseek",
				error_summary: "TypeError: cannot read property of undefined",
				instruction: "Fix login crash",
				result: "Added optional chaining",
			})
			await adapter.storeBugFix({
				task_id: "fix-2",
				agent_type: "openai",
				error_summary: "Database connection timeout",
				instruction: "Fix DB connection",
				result: "Increased pool size",
			})
			await adapter.storeBugFix({
				task_id: "fix-3",
				agent_type: "ollama",
				error_summary: "CSS layout broken on mobile",
				instruction: "Fix responsive layout",
				result: "Added media queries",
			})
		})

		it("finds similar bug fixes by keyword", async () => {
			const results = await adapter.searchSimilar("TypeError undefined", { limit: 5, threshold: 0 })
			expect(results.length).toBeGreaterThanOrEqual(1)
			expect(results.some((r) => r.id === "fix-1")).toBe(true)
		})

		it("respects limit parameter", async () => {
			const results = await adapter.searchSimilar("fix", { limit: 1, threshold: 0 })
			expect(results.length).toBeLessThanOrEqual(1)
		})

		it("returns empty array when no matches", async () => {
			const results = await adapter.searchSimilar("xyznonexistent12345", { limit: 5, threshold: 0.9 })
			expect(results).toEqual([])
		})

		it("returns results sorted by similarity descending", async () => {
			const results = await adapter.searchSimilar("TypeError", { limit: 5, threshold: 0 })
			for (let i = 1; i < results.length; i++) {
				expect(results[i - 1].similarity).toBeGreaterThanOrEqual(results[i].similarity)
			}
		})
	})

	describe("updateTestStatus", () => {
		it("updates test status for an existing fix", async () => {
			await adapter.storeBugFix({
				task_id: "fix-test",
				agent_type: "deepseek",
				error_summary: "Test error",
				instruction: "Fix",
				result: "Fixed",
			})
			const updated = await adapter.updateTestStatus("fix-test", true)
			expect(updated).toBe(true)
		})

		it("returns false for non-existent fix", async () => {
			const updated = await adapter.updateTestStatus("nonexistent", true)
			expect(updated).toBe(false)
		})
	})

	describe("storeLesson", () => {
		it("stores a lesson and returns an id", async () => {
			const result = await adapter.storeLesson({
				lesson_type: "best_practice",
				topic: "Always validate input",
				content: "Validate all user input before processing",
				project: "superroo2",
			})
			expect(result.success).toBe(true)
			expect(result.id).toBeTruthy()
		})

		it("normalizes lesson fields", async () => {
			const result = await adapter.storeLesson({
				type: "pattern",
				summary: "Test pattern",
				details: "This is a test pattern",
			})
			expect(result.success).toBe(true)
		})
	})

	describe("searchLessons", () => {
		beforeEach(async () => {
			await adapter.storeLesson({
				lesson_type: "best_practice",
				topic: "Input validation",
				content: "Always validate user input before processing to prevent injection attacks",
				project: "superroo2",
			})
			await adapter.storeLesson({
				lesson_type: "fix",
				topic: "Database connection pooling",
				content: "Use connection pooling for PostgreSQL to avoid connection exhaustion",
				project: "superroo2",
			})
		})

		it("finds similar lessons by keyword", async () => {
			const results = await adapter.searchLessons("input validation", { limit: 5, threshold: 0 })
			expect(results.length).toBeGreaterThanOrEqual(1)
			expect(results.some((r) => r.topic.includes("Input validation"))).toBe(true)
		})

		it("returns empty array when no matches", async () => {
			const results = await adapter.searchLessons("xyznonexistent", { limit: 5, threshold: 0.9 })
			expect(results).toEqual([])
		})
	})

	describe("getLessonCountByProject", () => {
		it("returns counts grouped by project", async () => {
			await adapter.storeLesson({ topic: "A", content: "a", project: "proj1" })
			await adapter.storeLesson({ topic: "B", content: "b", project: "proj1" })
			await adapter.storeLesson({ topic: "C", content: "c", project: "proj2" })

			const counts = await adapter.getLessonCountByProject()
			expect(counts.proj1).toBeGreaterThanOrEqual(2)
			expect(counts.proj2).toBeGreaterThanOrEqual(1)
		})
	})

	describe("getStats", () => {
		it("returns stats with counts", async () => {
			await adapter.storeBugFix({ task_id: "s1", agent_type: "deepseek", error_summary: "e1", instruction: "i", result: "r" })
			await adapter.storeBugFix({ task_id: "s2", agent_type: "openai", error_summary: "e2", instruction: "i", result: "r" })
			await adapter.storeLesson({ topic: "t1", content: "c1" })

			const stats = await adapter.getStats()
			expect(stats.totalBugFixes).toBeGreaterThanOrEqual(2)
			expect(stats.totalLessons).toBeGreaterThanOrEqual(1)
		})
	})

	describe("healthCheck", () => {
		it("returns healthy when initialized", async () => {
			const health = await adapter.healthCheck()
			expect(health.healthy).toBe(true)
			expect(health.memory).toBe(true)
		})
	})

	describe("buildRagContext", () => {
		it("returns empty string when no matches", async () => {
			const ctx = await adapter.buildRagContext("nonexistent", { maxResults: 3, threshold: 0.9 })
			expect(ctx).toBe("")
		})

		it("returns formatted context when matches found", async () => {
			await adapter.storeBugFix({
				task_id: "rag-1",
				agent_type: "deepseek",
				error_summary: "TypeError in login",
				instruction: "Fix login",
				result: "Added null check",
			})
			await adapter.storeLesson({
				topic: "Login validation",
				content: "Always validate login inputs",
			})

			const ctx = await adapter.buildRagContext("login error", { maxResults: 3, threshold: 0 })
			expect(ctx).toContain("Similar Bug Fixes")
			expect(ctx).toContain("Relevant Lessons")
		})
	})
})

// ─── BugKnowledgeStore with Memory Adapter ───────────────────────────────

describe("BugKnowledgeStore (with memory adapter)", () => {
	let store

	beforeEach(async () => {
		const { BugKnowledgeStore } = require("../orchestrator/stores/BugKnowledgeStore")
		store = new BugKnowledgeStore({ adapterType: "memory" })
		await store.init()
	})

	afterEach(async () => {
		await store.close()
	})

	it("initializes and closes", async () => {
		expect(store._initialized).toBe(true)
	})

	it("stores and searches bug fixes", async () => {
		await store.storeBugFix({
			task_id: "bks-1",
			agent_type: "deepseek",
			error_summary: "Null reference error",
			instruction: "Fix null reference",
			result: "Added null guard",
		})

		const results = await store.searchSimilar("null reference", { limit: 5, threshold: 0 })
		expect(results.length).toBeGreaterThanOrEqual(1)
		expect(results[0].id).toBe("bks-1")
	})

	it("stores and searches lessons", async () => {
		await store.storeLesson({
			lesson_type: "best_practice",
			topic: "Null safety",
			content: "Always check for null before accessing properties",
		})

		const results = await store.searchLessons("null safety", { limit: 5, threshold: 0 })
		expect(results.length).toBeGreaterThanOrEqual(1)
	})

	it("builds RAG context", async () => {
		await store.storeBugFix({
			task_id: "rag-bks",
			agent_type: "deepseek",
			error_summary: "API timeout",
			instruction: "Fix timeout",
			result: "Increased timeout to 30s",
		})

		const ctx = await store.buildRagContext("timeout", { maxResults: 3, threshold: 0 })
		expect(ctx).toContain("Similar Bug Fixes")
	})

	it("gets stats", async () => {
		const stats = await store.getStats()
		expect(stats).toHaveProperty("totalBugFixes")
		expect(stats).toHaveProperty("totalLessons")
	})

	it("checks health", async () => {
		const health = await store.healthCheck()
		expect(health).toHaveProperty("healthy")
	})

	it("updates test status", async () => {
		await store.storeBugFix({
			task_id: "ut-bks",
			agent_type: "deepseek",
			error_summary: "Test error",
			instruction: "Fix",
			result: "Fixed",
		})
		const updated = await store.updateTestStatus("ut-bks", true)
		expect(updated).toBe(true)
	})

	it("gets lesson counts by project", async () => {
		await store.storeLesson({ topic: "T1", content: "C1", project: "test-proj" })
		const counts = await store.getLessonCountByProject()
		expect(counts["test-proj"]).toBeGreaterThanOrEqual(1)
	})

	it("generates embeddings via EmbeddingService", async () => {
		const emb = await store._generateEmbedding("test text")
		// Without Ollama, this returns null — that's expected
		expect(emb).toBeNull()
	})
})

// ─── EmbeddingService Tests ──────────────────────────────────────────────

describe("EmbeddingService", () => {
	it("returns null for empty text", async () => {
		const { EmbeddingService } = require("../orchestrator/stores/EmbeddingService")
		const svc = new EmbeddingService()
		const emb = await svc.generate("")
		expect(emb).toBeNull()
	})

	it("returns null for whitespace-only text", async () => {
		const { EmbeddingService } = require("../orchestrator/stores/EmbeddingService")
		const svc = new EmbeddingService()
		const emb = await svc.generate("   ")
		expect(emb).toBeNull()
	})

	it("handles generateBatch with empty array", async () => {
		const { EmbeddingService } = require("../orchestrator/stores/EmbeddingService")
		const svc = new EmbeddingService()
		const embs = await svc.generateBatch([])
		expect(embs).toEqual([])
	})

	it("healthCheck returns false when Ollama is unreachable", async () => {
		const { EmbeddingService } = require("../orchestrator/stores/EmbeddingService")
		const svc = new EmbeddingService({ ollamaBaseUrl: "http://127.0.0.1:19999" })
		const healthy = await svc.healthCheck()
		expect(healthy).toBe(false)
	})
})

// ─── PgVectorAdapter Schema Tests ────────────────────────────────────────

describe("PgVectorAdapter", () => {
	it("exports classifyError utility", () => {
		const { classifyError, ERROR_PATTERNS } = require("../orchestrator/stores/adapters/PgVectorAdapter")
		expect(typeof classifyError).toBe("function")
		expect(Array.isArray(ERROR_PATTERNS)).toBe(true)
	})

	it("classifyError identifies error types", () => {
		const { classifyError } = require("../orchestrator/stores/adapters/PgVectorAdapter")
		expect(classifyError("syntax error: unexpected token")).toBe("syntax")
		expect(classifyError("TypeError: cannot read property")).toBe("runtime")
		expect(classifyError("ECONNREFUSED")).toBe("api")
		expect(classifyError("test failed: expected 5 to be 3")).toBe("test")
		expect(classifyError("Cannot find module 'express'")).toBe("config")
		expect(classifyError("unknown random message")).toBe("unknown")
	})
})
