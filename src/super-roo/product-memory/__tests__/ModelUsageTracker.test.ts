import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { ModelUsageTracker } from "../ModelUsageTracker"
import type { EventLog } from "../../logging/EventLog"
import fs from "fs/promises"
import path from "path"
import os from "os"

describe("ModelUsageTracker", () => {
	let tracker: ModelUsageTracker
	let tempDir: string
	let mockEventLog: EventLog

	beforeEach(async () => {
		// Create temp directory for test files
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "model-usage-test-"))

		// Mock event log
		mockEventLog = {
			info: () => {},
			warn: () => {},
			error: () => {},
		} as unknown as EventLog

		tracker = new ModelUsageTracker(mockEventLog, tempDir)
		await tracker.initialize()
	})

	afterEach(async () => {
		// Clean up temp directory
		await fs.rm(tempDir, { recursive: true, force: true })
	})

	describe("task lifecycle", () => {
		it("should start a new task", () => {
			const taskId = tracker.startTask("test-task-1")
			expect(taskId).toBe("test-task-1")
		})

		it("should generate task ID if not provided", () => {
			const taskId = tracker.startTask()
			expect(taskId).toMatch(/^task_/)
		})

		it("should end task and save summary", async () => {
			tracker.startTask("test-task-2")

			// Log some API calls for all required phases
			await tracker.logApiCall({
				phase: "planning",
				provider: "codex",
				model: "codex-latest",
				success: true,
			})

			await tracker.logApiCall({
				phase: "coding",
				provider: "deepseek",
				model: "deepseek-chat",
				success: true,
				promptTokens: 100,
				completionTokens: 50,
			})

			await tracker.logApiCall({
				phase: "review",
				provider: "codex",
				model: "codex-latest",
				success: true,
			})

			await tracker.logApiCall({
				phase: "summarization",
				provider: "ollama",
				model: "qwen2.5:3b",
				success: true,
			})

			const summary = await tracker.endTask()

			expect(summary).toBeDefined()
			expect(summary?.taskId).toBe("test-task-2")
			expect(summary?.workflowCompliant).toBe(true)
			expect(summary?.deepseekDelegated).toBe(true)
			expect(summary?.totalTokens).toBe(150)
		})

		it("should detect non-compliant tasks (no DeepSeek)", async () => {
			tracker.startTask("test-task-3")

			await tracker.logApiCall({
				phase: "coding",
				provider: "openai",
				model: "gpt-4o",
				success: true,
			})

			const summary = await tracker.endTask()

			expect(summary?.deepseekDelegated).toBe(false)
		})
	})

	describe("API call logging", () => {
		it("should log an API call", async () => {
			const record = await tracker.logApiCall({
				phase: "coding",
				provider: "deepseek",
				model: "deepseek-chat",
				success: true,
				promptTokens: 100,
				completionTokens: 50,
				latencyMs: 1234,
			})

			expect(record.id).toMatch(/^usage_/)
			expect(record.provider).toBe("deepseek")
			expect(record.timestamp).toBeDefined()
		})

		it("should log DeepSeek delegation with API key", async () => {
			const record = await tracker.logDeepSeekDelegation(true, "deepseek-chat", "ab12", 1234, {
				prompt: 100,
				completion: 50,
			})

			expect(record.provider).toBe("deepseek")
			expect(record.phase).toBe("coding")
			expect(record.apiKeyLast4).toBe("ab12")
			expect(record.promptTokens).toBe(100)
			expect(record.completionTokens).toBe(50)
		})

		it("should log Ollama summarization", async () => {
			const record = await tracker.logOllamaSummarization("qwen2.5:3b", 500, true)

			expect(record.provider).toBe("ollama")
			expect(record.phase).toBe("summarization")
			expect(record.model).toBe("qwen2.5:3b")
		})
	})

	describe("statistics", () => {
		it("should get DeepSeek statistics", async () => {
			// Log some API calls
			await tracker.logApiCall({
				phase: "coding",
				provider: "deepseek",
				model: "deepseek-chat",
				success: true,
				promptTokens: 100,
				completionTokens: 50,
				latencyMs: 1000,
			})

			await tracker.logApiCall({
				phase: "coding",
				provider: "openai",
				model: "gpt-4o",
				success: true,
			})

			const stats = await tracker.getDeepSeekStats()

			expect(stats.totalCodingTasks).toBe(2)
			expect(stats.deepseekUsed).toBe(1)
			expect(stats.deepseekSkipped).toBe(1)
			expect(stats.delegationRate).toBe(0.5)
			expect(stats.totalTokens).toBe(150)
			expect(stats.averageLatencyMs).toBe(1000)
		})

		it("should get overall statistics", async () => {
			await tracker.logApiCall({
				phase: "planning",
				provider: "codex",
				model: "codex-latest",
				success: true,
			})

			await tracker.logApiCall({
				phase: "coding",
				provider: "deepseek",
				model: "deepseek-chat",
				success: true,
				fallbackUsed: false,
			})

			await tracker.logApiCall({
				phase: "coding",
				provider: "openai",
				model: "gpt-4o",
				success: true,
				fallbackUsed: true,
			})

			const stats = await tracker.getStats()

			expect(stats.totalCalls).toBe(3)
			expect(stats.callsByProvider["deepseek"]).toBe(1)
			expect(stats.callsByProvider["codex"]).toBe(1)
			expect(stats.callsByProvider["openai"]).toBe(1)
			expect(stats.fallbackRate).toBe(1 / 3)
			expect(stats.successRate).toBe(1)
			expect(stats.deepseekDelegationRate).toBe(0.5)
		})
	})

	describe("API key verification", () => {
		it("should verify API key was used", async () => {
			await tracker.logDeepSeekDelegation(true, "deepseek-chat", "ab12", 1000, { prompt: 10, completion: 5 })

			const wasUsed = await tracker.wasApiKeyUsed("ab12")
			expect(wasUsed).toBe(true)

			const wasNotUsed = await tracker.wasApiKeyUsed("xy99")
			expect(wasNotUsed).toBe(false)
		})

		it("should filter by date when verifying API key", async () => {
			// This test would need more sophisticated date handling
			// For now, just verify the method exists and works
			await tracker.logDeepSeekDelegation(true, "deepseek-chat", "ab12", 1000, { prompt: 10, completion: 5 })

			const wasUsed = await tracker.wasApiKeyUsed("ab12", new Date(Date.now() - 1000))
			expect(wasUsed).toBe(true)
		})
	})

	describe("queries", () => {
		it("should get usage records with filters", async () => {
			await tracker.logApiCall({
				phase: "coding",
				provider: "deepseek",
				model: "deepseek-chat",
				success: true,
			})

			await tracker.logApiCall({
				phase: "planning",
				provider: "codex",
				model: "codex-latest",
				success: true,
			})

			const deepseekRecords = await tracker.getUsageRecords({ provider: "deepseek" })
			expect(deepseekRecords).toHaveLength(1)
			expect(deepseekRecords[0].provider).toBe("deepseek")

			const codingRecords = await tracker.getUsageRecords({ phase: "coding" })
			expect(codingRecords).toHaveLength(1)
			expect(codingRecords[0].phase).toBe("coding")
		})
	})

	describe("workflow compliance report", () => {
		it("should generate workflow compliance report", async () => {
			// Create a compliant task
			tracker.startTask("compliant-task")
			await tracker.logApiCall({ phase: "planning", provider: "codex", model: "codex", success: true })
			await tracker.logApiCall({ phase: "coding", provider: "deepseek", model: "deepseek-chat", success: true })
			await tracker.logApiCall({ phase: "review", provider: "codex", model: "codex", success: true })
			await tracker.logApiCall({ phase: "summarization", provider: "ollama", model: "qwen", success: true })
			await tracker.endTask()

			// Create a non-compliant task
			tracker.startTask("non-compliant-task")
			await tracker.logApiCall({ phase: "coding", provider: "openai", model: "gpt-4o", success: true })
			await tracker.endTask()

			const report = await tracker.getWorkflowComplianceReport()

			expect(report.totalTasks).toBe(2)
			expect(report.compliantTasks).toBe(1)
			expect(report.nonCompliantTasks).toBe(1)
			expect(report.deepseekSkipped).toBe(1)
			expect(report.missingReview).toBe(1)
			expect(report.missingSummarization).toBe(1)
		})
	})
})
