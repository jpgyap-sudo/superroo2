import { describe, expect, it } from "vitest"
import {
	deepseekReasoningMapper,
	openaiReasoningMapper,
	anthropicReasoningMapper,
	noopReasoningMapper,
	getReasoningMapper,
	applyReasoning,
	REASONING_MAPPERS,
} from "../reasoning-mappers"

describe("reasoning-mappers", () => {
	describe("deepseekReasoningMapper", () => {
		it("returns empty object for off level", () => {
			expect(deepseekReasoningMapper("off")).toEqual({})
		})

		it("maps minimal to thinking budget", () => {
			const result = deepseekReasoningMapper("minimal")
			expect(result).toHaveProperty("thinking")
			expect((result.thinking as { budget_tokens: number }).budget_tokens).toBeGreaterThan(0)
		})

		it("maps high to thinking budget", () => {
			const result = deepseekReasoningMapper("high")
			expect(result).toHaveProperty("thinking")
			expect((result.thinking as { budget_tokens: number }).budget_tokens).toBe(32768)
		})
	})

	describe("openaiReasoningMapper", () => {
		it("returns empty object for off level", () => {
			expect(openaiReasoningMapper("off")).toEqual({})
		})

		it("maps minimal to low effort", () => {
			expect(openaiReasoningMapper("minimal")).toEqual({ reasoning_effort: "low" })
		})

		it("maps medium to medium effort", () => {
			expect(openaiReasoningMapper("medium")).toEqual({ reasoning_effort: "medium" })
		})

		it("maps high to high effort", () => {
			expect(openaiReasoningMapper("high")).toEqual({ reasoning_effort: "high" })
		})

		it("maps auto to medium effort", () => {
			expect(openaiReasoningMapper("auto")).toEqual({ reasoning_effort: "medium" })
		})
	})

	describe("anthropicReasoningMapper", () => {
		it("returns empty object for off level", () => {
			expect(anthropicReasoningMapper("off")).toEqual({})
		})

		it("maps medium to extended thinking", () => {
			const result = anthropicReasoningMapper("medium")
			expect(result).toHaveProperty("thinking")
			expect((result.thinking as { type: string; budget_tokens: number }).type).toBe("enabled")
			expect((result.thinking as { type: string; budget_tokens: number }).budget_tokens).toBe(8192)
		})
	})

	describe("noopReasoningMapper", () => {
		it("always returns empty object", () => {
			expect(noopReasoningMapper("off")).toEqual({})
			expect(noopReasoningMapper("high")).toEqual({})
			expect(noopReasoningMapper("auto")).toEqual({})
		})
	})

	describe("getReasoningMapper", () => {
		it("returns deepseek mapper for deepseek", () => {
			const mapper = getReasoningMapper("deepseek")
			expect(mapper("high")).toHaveProperty("thinking")
		})

		it("returns openai mapper for openai", () => {
			const mapper = getReasoningMapper("openai")
			expect(mapper("high")).toHaveProperty("reasoning_effort")
		})

		it("returns anthropic mapper for anthropic", () => {
			const mapper = getReasoningMapper("anthropic")
			expect(mapper("high")).toHaveProperty("thinking")
		})

		it("returns noop mapper for unknown provider", () => {
			const mapper = getReasoningMapper("unknown")
			expect(mapper("high")).toEqual({})
		})

		it("returns noop mapper for ollama", () => {
			const mapper = getReasoningMapper("ollama")
			expect(mapper("high")).toEqual({})
		})
	})

	describe("applyReasoning", () => {
		it("applies deepseek reasoning", () => {
			const result = applyReasoning("deepseek", "medium")
			expect(result).toHaveProperty("thinking")
		})

		it("applies openai reasoning", () => {
			const result = applyReasoning("openai", "high")
			expect(result).toEqual({ reasoning_effort: "high" })
		})

		it("applies noop for unknown provider", () => {
			expect(applyReasoning("unknown", "high")).toEqual({})
		})

		it("applies off level for deepseek", () => {
			expect(applyReasoning("deepseek", "off")).toEqual({})
		})
	})

	describe("REASONING_MAPPERS registry", () => {
		it("contains all expected providers", () => {
			const expectedProviders = ["deepseek", "openai", "anthropic", "ollama", "kimi", "openrouter", "groq"]
			for (const id of expectedProviders) {
				expect(REASONING_MAPPERS).toHaveProperty(id)
			}
		})

		it("has correct number of mappers", () => {
			expect(Object.keys(REASONING_MAPPERS)).toHaveLength(7)
		})
	})
})
