/**
 * Tests for the ConversationHistoryManager module.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs"
import * as path from "path"
import { ConversationHistoryManager, resetConversationHistoryManager } from "../ConversationHistoryManager"
import { ConversationMonitorAgent, resetConversationMonitorAgent } from "../ConversationMonitorAgent"
import type { ConversationRecord, DetectedWeakness, DetectedImprovement } from "../types"

// ─── Helpers ───────────────────────────────────────────────────────────────

const TEST_DATA_DIR = path.join(__dirname, "..", "..", "..", "..", "cloud", "data")
const TEST_HISTORY_FILE = path.join(TEST_DATA_DIR, "conversation-history.json")

function cleanupTestFile() {
	try {
		if (fs.existsSync(TEST_HISTORY_FILE)) {
			fs.unlinkSync(TEST_HISTORY_FILE)
		}
	} catch {
		// Ignore
	}
}

// ─── ConversationHistoryManager Tests ──────────────────────────────────────

describe("ConversationHistoryManager", () => {
	let manager: ConversationHistoryManager

	beforeEach(async () => {
		cleanupTestFile()
		resetConversationHistoryManager()
		manager = new ConversationHistoryManager()
		await manager.init()
	})

	afterEach(() => {
		cleanupTestFile()
	})

	describe("init", () => {
		it("should initialize with empty state when no file exists", async () => {
			expect(manager.getConversationCount()).toBe(0)
			expect(manager.getErrorCount()).toBe(0)
			expect(manager.getWeaknessCount()).toBe(0)
			expect(manager.getImprovementCount()).toBe(0)
		})

		it("should load existing state from disk", async () => {
			const conv = await manager.createConversation({
				source: "telegram",
				chatId: 12345,
				title: "Test conversation",
			})
			expect(conv.id).toBeTruthy()
			expect(manager.getConversationCount()).toBe(1)

			// Create a new manager instance and verify it loads the persisted state
			resetConversationHistoryManager()
			const manager2 = new ConversationHistoryManager()
			await manager2.init()
			expect(manager2.getConversationCount()).toBe(1)
			const loaded = manager2.getConversation(conv.id)
			expect(loaded).toBeDefined()
			expect(loaded!.title).toBe("Test conversation")
		})
	})

	describe("createConversation", () => {
		it("should create a conversation with default values", async () => {
			const conv = await manager.createConversation({
				source: "telegram",
				chatId: 12345,
			})
			expect(conv.id).toBeTruthy()
			expect(conv.source).toBe("telegram")
			expect(conv.chatId).toBe(12345)
			expect(conv.status).toBe("active")
			expect(conv.messages).toEqual([])
			expect(conv.messageCount).toBe(0)
			expect(conv.title).toContain("Conversation")
		})

		it("should create a conversation with all optional fields", async () => {
			const conv = await manager.createConversation({
				source: "vscode",
				chatId: "chat-abc",
				title: "Debug session",
				userId: "user1",
				username: "jpgy888",
				projectId: "proj-1",
				projectName: "superroo2",
				tags: ["debug", "urgent"],
				metadata: { priority: "high" },
			})
			expect(conv.title).toBe("Debug session")
			expect(conv.userId).toBe("user1")
			expect(conv.username).toBe("jpgy888")
			expect(conv.projectId).toBe("proj-1")
			expect(conv.projectName).toBe("superroo2")
			expect(conv.tags).toEqual(["debug", "urgent"])
			expect(conv.metadata).toEqual({ priority: "high" })
		})
	})

	describe("addMessage", () => {
		it("should add a message to a conversation", async () => {
			const conv = await manager.createConversation({
				source: "telegram",
				chatId: 12345,
			})

			const msg = await manager.addMessage(conv.id, {
				role: "user",
				content: "Hello, can you help me debug this?",
				platformMessageId: 1001,
				userId: "user1",
				username: "jpgy888",
			})

			expect(msg.id).toBeTruthy()
			expect(msg.role).toBe("user")
			expect(msg.content).toBe("Hello, can you help me debug this?")
			expect(msg.platformMessageId).toBe(1001)

			const updated = manager.getConversation(conv.id)
			expect(updated!.messageCount).toBe(1)
			expect(updated!.messages.length).toBe(1)
		})

		it("should track token counts and latency", async () => {
			const conv = await manager.createConversation({
				source: "telegram",
				chatId: 12345,
			})

			await manager.addMessage(conv.id, {
				role: "user",
				content: "Hello",
				tokenCount: 5,
			})

			await manager.addMessage(conv.id, {
				role: "assistant",
				content: "Hi there!",
				tokenCount: 10,
				latencyMs: 1500,
			})

			const updated = manager.getConversation(conv.id)
			expect(updated!.totalTokens).toBe(15)
			expect(updated!.totalLatencyMs).toBe(1500)
		})

		it("should throw for non-existent conversation", async () => {
			await expect(
				manager.addMessage("non-existent", {
					role: "user",
					content: "test",
				}),
			).rejects.toThrow()
		})
	})

	describe("updateConversationStatus", () => {
		it("should update status and set endedAt for terminal states", async () => {
			const conv = await manager.createConversation({
				source: "telegram",
				chatId: 12345,
			})

			await manager.updateConversationStatus(conv.id, "completed")
			const updated = manager.getConversation(conv.id)
			expect(updated!.status).toBe("completed")
			expect(updated!.endedAt).toBeTruthy()
		})
	})

	describe("findConversations", () => {
		it("should filter by source", async () => {
			await manager.createConversation({ source: "telegram", chatId: 1 })
			await manager.createConversation({ source: "vscode", chatId: 2 })
			await manager.createConversation({ source: "telegram", chatId: 3 })

			const telegrams = manager.findConversations({ source: "telegram" })
			expect(telegrams.length).toBe(2)
		})

		it("should filter by status", async () => {
			const conv = await manager.createConversation({ source: "telegram", chatId: 1 })
			await manager.createConversation({ source: "telegram", chatId: 2 })
			await manager.updateConversationStatus(conv.id, "completed")

			const active = manager.findConversations({ status: "active" })
			expect(active.length).toBe(1)
		})

		it("should respect limit and offset", async () => {
			for (let i = 0; i < 10; i++) {
				await manager.createConversation({ source: "telegram", chatId: i })
			}

			const limited = manager.findConversations({ limit: 3 })
			expect(limited.length).toBe(3)

			const offset = manager.findConversations({ offset: 8, limit: 5 })
			expect(offset.length).toBe(2) // Only 2 remaining after offset 8
		})
	})

	describe("deleteConversation", () => {
		it("should delete a conversation and its associated issues", async () => {
			const conv = await manager.createConversation({ source: "telegram", chatId: 1 })
			await manager.addMessage(conv.id, { role: "user", content: "test" })

			await manager.recordIssue({
				conversationId: conv.id,
				severity: "warning",
				category: "telegram_friction",
				title: "Test issue",
				description: "Test",
				messageIds: [],
				resolved: false,
			})

			const deleted = await manager.deleteConversation(conv.id)
			expect(deleted).toBe(true)
			expect(manager.getConversation(conv.id)).toBeUndefined()
			expect(manager.getIssues({ conversationId: conv.id }).length).toBe(0)
		})
	})

	describe("recordIssue / recordWeakness / recordImprovement", () => {
		it("should record and retrieve issues", async () => {
			const conv = await manager.createConversation({ source: "telegram", chatId: 1 })

			const issue = await manager.recordIssue({
				conversationId: conv.id,
				severity: "error",
				category: "telegram_friction",
				title: "Login failed",
				description: "User could not log in via Telegram",
				messageIds: [],
				resolved: false,
			})

			expect(issue.id).toBeTruthy()
			expect(issue.severity).toBe("error")

			const issues = manager.getIssues({ severity: "error" })
			expect(issues.length).toBe(1)
		})

		it("should record weaknesses separately", async () => {
			const conv = await manager.createConversation({ source: "telegram", chatId: 1 })

			await manager.recordWeakness({
				conversationId: conv.id,
				severity: "warning",
				category: "slow_response",
				title: "Slow response",
				description: "Response took 60s",
				messageIds: [],
				suggestion: "Optimize",
				resolved: false,
			})

			const weaknesses = manager.getWeaknesses({ category: "slow_response" })
			expect(weaknesses.length).toBe(1)
			expect(weaknesses[0].title).toBe("Slow response")
		})

		it("should record improvements with priority and effort", async () => {
			const conv = await manager.createConversation({ source: "telegram", chatId: 1 })

			await manager.recordImprovement({
				conversationId: conv.id,
				severity: "warning",
				category: "telegram_ux",
				title: "Better formatting",
				description: "Messages need better formatting",
				messageIds: [],
				suggestion: "Use markdown properly",
				priority: 80,
				estimatedEffort: "low",
				resolved: false,
			})

			const improvements = manager.getImprovements({ category: "telegram_ux" })
			expect(improvements.length).toBe(1)
			expect(improvements[0].priority).toBe(80)
			expect(improvements[0].estimatedEffort).toBe("low")
		})
	})

	describe("resolveIssue / resolveError / markImprovementImplemented", () => {
		it("should resolve issues", async () => {
			const conv = await manager.createConversation({ source: "telegram", chatId: 1 })
			const issue = await manager.recordIssue({
				conversationId: conv.id,
				severity: "warning",
				category: "telegram_friction",
				title: "Test",
				description: "Test",
				messageIds: [],
				resolved: false,
			})

			const resolved = await manager.resolveIssue(issue.id)
			expect(resolved).toBe(true)

			const issues = manager.getIssues({ resolved: true })
			expect(issues.length).toBe(1)
		})

		it("should resolve errors with root cause", async () => {
			const conv = await manager.createConversation({ source: "telegram", chatId: 1 })
			const error = await manager.recordError({
				conversationId: conv.id,
				messageId: "msg-1",
				errorType: "timeout",
				errorMessage: "Request timed out",
				resolved: false,
			})

			const resolved = await manager.resolveError(error.id, "Network congestion")
			expect(resolved).toBe(true)

			const errors = manager.getErrors({ resolved: true })
			expect(errors.length).toBe(1)
			expect(errors[0].rootCause).toBe("Network congestion")
		})

		it("should mark improvements as implemented", async () => {
			const conv = await manager.createConversation({ source: "telegram", chatId: 1 })
			const improvement = await manager.recordImprovement({
				conversationId: conv.id,
				severity: "info",
				category: "response_quality",
				title: "Better responses",
				description: "Need better responses",
				messageIds: [],
				priority: 50,
				estimatedEffort: "medium",
				resolved: false,
			})

			const marked = await manager.markImprovementImplemented(improvement.id)
			expect(marked).toBe(true)

			const implemented = manager.getImprovements({ resolved: true })
			expect(implemented.length).toBe(1)
		})
	})

	describe("generateSummary", () => {
		it("should generate a summary with friction scores", async () => {
			const conv = await manager.createConversation({ source: "telegram", chatId: 1 })
			await manager.addMessage(conv.id, { role: "user", content: "login failed again" })
			await manager.addMessage(conv.id, {
				role: "assistant",
				content: "Please try again",
				latencyMs: 500,
			})

			await manager.recordWeakness({
				conversationId: conv.id,
				severity: "warning",
				category: "telegram_friction",
				title: "Login issue",
				description: "Login friction detected",
				messageIds: [],
				resolved: false,
			})

			const summary = manager.generateSummary(30)
			expect(summary.totalConversations).toBeGreaterThanOrEqual(1)
			expect(summary.telegramFrictionScore).toBeGreaterThanOrEqual(0)
			expect(summary.recommendations).toBeDefined()
		})
	})
})

// ─── ConversationMonitorAgent Tests ────────────────────────────────────────

describe("ConversationMonitorAgent", () => {
	let manager: ConversationHistoryManager
	let agent: ConversationMonitorAgent

	beforeEach(async () => {
		cleanupTestFile()
		resetConversationHistoryManager()
		resetConversationMonitorAgent()
		manager = new ConversationHistoryManager()
		await manager.init()
		agent = new ConversationMonitorAgent(manager, {
			minMessagesForAnalysis: 1,
			analysisIntervalMs: 999999, // Don't auto-run
		})
	})

	afterEach(() => {
		agent.stop()
		cleanupTestFile()
	})

	describe("runAnalysis", () => {
		it("should detect slow responses as weaknesses", async () => {
			const conv = await manager.createConversation({ source: "telegram", chatId: 1 })
			await manager.addMessage(conv.id, { role: "user", content: "Hello" })
			await manager.addMessage(conv.id, {
				role: "assistant",
				content: "Hi!",
				latencyMs: 60000, // 60 seconds — above threshold
			})

			const result = await agent.runAnalysis()
			expect(result.newWeaknesses).toBeGreaterThanOrEqual(1)
		})

		it("should detect Telegram friction patterns", async () => {
			const conv = await manager.createConversation({ source: "telegram", chatId: 1 })
			await manager.addMessage(conv.id, { role: "user", content: "login failed, session expired" })
			await manager.addMessage(conv.id, { role: "assistant", content: "Please login again" })

			const result = await agent.runAnalysis()
			expect(result.newWeaknesses).toBeGreaterThanOrEqual(1)

			const telegramIssues = agent.getTelegramFrictionIssues()
			expect(telegramIssues.length).toBeGreaterThanOrEqual(1)
		})

		it("should detect coding friction patterns", async () => {
			const conv = await manager.createConversation({ source: "telegram", chatId: 1 })
			await manager.addMessage(conv.id, { role: "user", content: "the code didn't work, it has a bug" })
			await manager.addMessage(conv.id, { role: "assistant", content: "Let me fix that" })

			const result = await agent.runAnalysis()
			expect(result.newWeaknesses).toBeGreaterThanOrEqual(1)

			const codingIssues = agent.getCodingFrictionIssues()
			expect(codingIssues.length).toBeGreaterThanOrEqual(1)
		})

		it("should detect errors in messages", async () => {
			const conv = await manager.createConversation({ source: "telegram", chatId: 1 })
			await manager.addMessage(conv.id, { role: "user", content: "Hello" })
			await manager.addMessage(conv.id, {
				role: "assistant",
				content: "Error occurred",
				hadError: true,
				errorDetails: "TimeoutError: Request timed out after 30s",
			})

			const result = await agent.runAnalysis()
			expect(result.newErrors).toBeGreaterThanOrEqual(1)
		})

		it("should detect improvement opportunities", async () => {
			const conv = await manager.createConversation({ source: "telegram", chatId: 1 })
			await manager.addMessage(conv.id, { role: "user", content: "deploy the code please" })
			await manager.addMessage(conv.id, { role: "assistant", content: "ok" }) // Very short response
			await manager.addMessage(conv.id, { role: "user", content: "also test it" })
			await manager.addMessage(conv.id, { role: "assistant", content: "Running tests..." })
			await manager.addMessage(conv.id, { role: "user", content: "and commit" })
			await manager.addMessage(conv.id, { role: "assistant", content: "Done" })

			const result = await agent.runAnalysis()
			expect(result.newImprovements).toBeGreaterThanOrEqual(1)
		})

		it("should not re-analyze already analyzed conversations", async () => {
			const conv = await manager.createConversation({ source: "telegram", chatId: 1 })
			await manager.addMessage(conv.id, { role: "user", content: "login failed" })
			await manager.addMessage(conv.id, { role: "assistant", content: "Try again" })

			const first = await agent.runAnalysis()
			expect(first.newWeaknesses).toBeGreaterThanOrEqual(1)

			const second = await agent.runAnalysis()
			expect(second.newWeaknesses).toBe(0) // No new weaknesses
		})
	})

	describe("getTelegramFrictionReport", () => {
		it("should generate a formatted report", async () => {
			const conv = await manager.createConversation({ source: "telegram", chatId: 1 })
			await manager.addMessage(conv.id, { role: "user", content: "login failed, session expired" })
			await manager.addMessage(conv.id, { role: "assistant", content: "Please login again" })
			await manager.addMessage(conv.id, {
				role: "assistant",
				content: "Error",
				hadError: true,
				errorDetails: "Timeout",
			})

			await agent.runAnalysis()
			const report = agent.getTelegramFrictionReport()
			expect(report).toContain("Telegram Friction Report")
			expect(report).toContain("Friction Score")
		})
	})

	describe("start / stop", () => {
		it("should start and stop periodic analysis", () => {
			expect(agent.isRunning()).toBe(false)
			agent.start()
			// After runAnalysis completes, isRunning should be false again
			expect(agent.isRunning()).toBe(false)
			agent.stop()
		})
	})
})
