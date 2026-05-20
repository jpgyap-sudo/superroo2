/**
 * Telegram Metrics Unit Tests
 */
import { describe, it, expect } from "vitest"

// Load the bot module to access metrics internals
const bot = require("../api/telegramBot")

describe("telegramMetrics", () => {
	it("getTelegramMetrics returns a structured object", () => {
		var metrics = bot.getTelegramMetrics()
		expect(metrics).toHaveProperty("timestamp")
		expect(metrics).toHaveProperty("messagesReceived")
		expect(metrics).toHaveProperty("messagesSent")
		expect(metrics).toHaveProperty("errors")
		expect(metrics).toHaveProperty("autoModeChainsCompleted")
		expect(metrics).toHaveProperty("llmProviderLatency")
		expect(metrics).toHaveProperty("commandLatency")
		expect(metrics).toHaveProperty("providerMetrics")
		expect(metrics).toHaveProperty("activeSessions")
		expect(metrics).toHaveProperty("conversationHistorySize")
		expect(metrics).toHaveProperty("callbackRegistrySize")
		expect(metrics).toHaveProperty("userTasks")
		expect(metrics).toHaveProperty("processedUpdateIds")
		expect(metrics).toHaveProperty("rateLimitMapSize")
		expect(metrics).toHaveProperty("webhookHealth")
	})

	it("records messages received", () => {
		bot.recordMessageReceived("/code")
		bot.recordMessageReceived("/code")
		bot.recordMessageReceived("/ask")
		var metrics = bot.getTelegramMetrics()
		expect(metrics.messagesReceived["/code"]).toBe(2)
		expect(metrics.messagesReceived["/ask"]).toBe(1)
	})

	it("records messages sent", () => {
		bot.recordMessageSent("message")
		bot.recordMessageSent("message")
		var metrics = bot.getTelegramMetrics()
		expect(metrics.messagesSent["message"]).toBe(2)
	})

	it("records errors", () => {
		bot.recordError("network")
		bot.recordError("network")
		bot.recordError("timeout")
		var metrics = bot.getTelegramMetrics()
		expect(metrics.errors["network"]).toBe(2)
		expect(metrics.errors["timeout"]).toBe(1)
	})

	it("records auto mode chains", () => {
		var before = bot.getTelegramMetrics().autoModeChainsCompleted
		bot.recordAutoModeChainCompleted()
		bot.recordAutoModeChainCompleted()
		var after = bot.getTelegramMetrics().autoModeChainsCompleted
		expect(after - before).toBe(2)
	})

	it("records LLM provider latency", () => {
		bot.recordLlmProviderLatency("deepseek", 1200)
		bot.recordLlmProviderLatency("deepseek", 800)
		bot.recordLlmProviderLatency("openai", 500)
		var metrics = bot.getTelegramMetrics()
		expect(metrics.llmProviderLatency["deepseek"].count).toBe(2)
		expect(metrics.llmProviderLatency["deepseek"].avg).toBe(1000)
		expect(metrics.llmProviderLatency["openai"].count).toBe(1)
		expect(metrics.llmProviderLatency["openai"].avg).toBe(500)
	})
})
