/**
 * Telegram Classifier Unit Tests
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

var classifier
var fetchSpy

beforeEach(() => {
	// Reset module cache to get fresh state
	delete require.cache[require.resolve("../api/telegramClassifier")]
	classifier = require("../api/telegramClassifier")
	fetchSpy = vi.fn()
	global.fetch = fetchSpy
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe("telegramClassifier", () => {
	describe("classifyIntent", () => {
		it("classifies coding intent correctly", async () => {
			fetchSpy.mockResolvedValue({
				ok: true,
				json: async () => ({
					choices: [
						{
							message: {
								content: JSON.stringify({
									kind: "code_task",
									target: "login",
									message: "fix login bug",
									confidence: 0.95,
								}),
							},
						},
					],
				}),
			})

			var result = await classifier.classifyIntent("fix the login bug", [
				{ providerId: "deepseek", apiKey: "test" },
			])
			expect(result.kind).toBe("code_task")
			expect(result.confidence).toBeGreaterThan(0.9)
		})

		it("classifies chat intent when no coding keywords present", async () => {
			fetchSpy.mockResolvedValue({
				ok: true,
				json: async () => ({
					choices: [
						{ message: { content: JSON.stringify({ kind: "chat", message: "hello", confidence: 0.8 }) } },
					],
				}),
			})

			var result = await classifier.classifyIntent("hello there", [{ providerId: "deepseek", apiKey: "test" }])
			expect(result.kind).toBe("chat")
		})

		it("returns chat fallback when all providers fail", async () => {
			fetchSpy.mockRejectedValue(new Error("Network error"))

			var result = await classifier.classifyIntent("hello", [{ providerId: "deepseek", apiKey: "test" }])
			expect(result.kind).toBe("chat")
			expect(result.confidence).toBeLessThanOrEqual(0.5)
		})

		it("handles malformed JSON from LLM gracefully", async () => {
			fetchSpy.mockResolvedValue({
				ok: true,
				json: async () => ({
					choices: [{ message: { content: "not valid json" } }],
				}),
			})

			var result = await classifier.classifyIntent("test", [{ providerId: "deepseek", apiKey: "test" }])
			expect(result.kind).toBe("chat")
		})

		it("routes follow-up requests to implement recommendations as code_task", async () => {
			var context =
				"Assistant: Recommended improvements: add onboarding, improve data quality, and upgrade search."
			var result = await classifier.classifyIntent("ask coder to proceed with those improvements", [], context)
			expect(result.kind).toBe("code_task")
			expect(result.confidence).toBeGreaterThanOrEqual(0.9)
		})

		it("routes explicit recommendation implementation to code_task without LLM", async () => {
			fetchSpy.mockResolvedValue({
				ok: true,
				json: async () => ({
					choices: [{ message: { content: JSON.stringify({ kind: "chat", confidence: 0.99 }) } }],
				}),
			})

			var result = await classifier.classifyIntent("ask coder to implement the recommendations", [
				{ providerId: "deepseek", apiKey: "test" },
			])
			expect(result.kind).toBe("code_task")
		})

		it("keeps explicit bot self-upgrade phrases as upgrade_self in keyword fallback", () => {
			expect(classifier.keywordFallback("ask coder to upgrade you")).toBe("upgrade_self")
			expect(classifier.keywordFallback("upgrade yourself")).toBe("upgrade_self")
			expect(classifier.keywordFallback("ask the coder to improve the bot")).toBe("upgrade_self")
		})

		it("keeps explicit bot self-upgrade phrases as upgrade_self even with recommendation context", async () => {
			var context = "Assistant: Recommended improvements: add onboarding and upgrade search."
			var result = await classifier.classifyIntent("ask coder to upgrade you", [], context)
			expect(result.kind).toBe("upgrade_self")
		})

		it("does not treat vague proceed as code_task without recommendation context", async () => {
			var result = await classifier.classifyIntent("ask coder to proceed", [])
			expect(result.kind).toBe("chat")
		})
	})
})
