import { describe, expect, it, beforeEach } from "vitest"
import { ProviderRegistry } from "../ProviderRegistry"
import type { LanguageModelProvider } from "../types"

function makeProvider(overrides: Partial<LanguageModelProvider> & { id: string }): LanguageModelProvider {
	return {
		name: overrides.id,
		capabilities: ["chat"],
		chat: async () => ({ content: "", finishReason: "stop" }),
		...overrides,
	}
}

describe("ProviderRegistry", () => {
	let registry: ProviderRegistry

	beforeEach(() => {
		registry = new ProviderRegistry()
	})

	describe("registration", () => {
		it("registers a single provider", () => {
			const p = makeProvider({ id: "deepseek" })
			registry.register(p)
			expect(registry.getProvider("deepseek")).toBe(p)
			expect(registry.size).toBe(1)
		})

		it("registers multiple providers at once", () => {
			registry.registerProviders([
				makeProvider({ id: "deepseek" }),
				makeProvider({ id: "openai" }),
				makeProvider({ id: "anthropic" }),
			])
			expect(registry.size).toBe(3)
			expect(registry.getProvider("deepseek")).toBeDefined()
			expect(registry.getProvider("openai")).toBeDefined()
			expect(registry.getProvider("anthropic")).toBeDefined()
		})

		it("overwrites a provider with the same id", () => {
			const p1 = makeProvider({ id: "deepseek", name: "DeepSeek V1" })
			const p2 = makeProvider({ id: "deepseek", name: "DeepSeek V2" })
			registry.register(p1)
			registry.register(p2)
			expect(registry.getProvider("deepseek")?.name).toBe("DeepSeek V2")
			expect(registry.size).toBe(1)
		})

		it("returns undefined for unknown provider", () => {
			expect(registry.getProvider("nonexistent")).toBeUndefined()
		})
	})

	describe("getProviders", () => {
		it("returns all registered providers", () => {
			registry.registerProviders([
				makeProvider({ id: "a" }),
				makeProvider({ id: "b" }),
			])
			const all = registry.getProviders()
			expect(all).toHaveLength(2)
			expect(all.map((p) => p.id).sort()).toEqual(["a", "b"])
		})

		it("returns empty array when no providers registered", () => {
			expect(registry.getProviders()).toEqual([])
		})
	})

	describe("selectProvider", () => {
		beforeEach(() => {
			registry.registerProviders([
				makeProvider({ id: "deepseek", capabilities: ["chat", "reasoning"] }),
				makeProvider({ id: "openai", capabilities: ["chat", "vision"] }),
				makeProvider({ id: "ollama", capabilities: ["chat"] }),
			])
		})

		it("returns preferred provider when specified", () => {
			const result = registry.selectProvider({ preferredProvider: "openai" })
			expect(result?.id).toBe("openai")
		})

		it("returns preferred provider only if it matches capabilities", () => {
			const result = registry.selectProvider({
				preferredProvider: "ollama",
				requiredCapabilities: ["vision"],
			})
			expect(result?.id).not.toBe("ollama") // ollama doesn't have vision
		})

		it("returns provider matching required capabilities", () => {
			const result = registry.selectProvider({ requiredCapabilities: ["reasoning"] })
			expect(result?.id).toBe("deepseek")
		})

		it("returns first provider when no preferences given", () => {
			const result = registry.selectProvider({})
			expect(result).toBeDefined()
		})

		it("returns undefined when no providers registered", () => {
			const empty = new ProviderRegistry()
			expect(empty.selectProvider({})).toBeUndefined()
		})
	})

	describe("capability checks", () => {
		beforeEach(() => {
			registry.register(
				makeProvider({ id: "deepseek", capabilities: ["chat", "reasoning", "tool-use"] }),
			)
		})

		it("returns true when provider has capability", () => {
			expect(registry.hasCapability("deepseek", "reasoning")).toBe(true)
		})

		it("returns false when provider lacks capability", () => {
			expect(registry.hasCapability("deepseek", "vision")).toBe(false)
		})

		it("returns false for unknown provider", () => {
			expect(registry.hasCapability("unknown", "chat")).toBe(false)
		})
	})

	describe("reasoning support", () => {
		it("returns supported reasoning levels for a provider", () => {
			registry.register(
				makeProvider({
					id: "deepseek",
					reasoning: {
						supportedLevels: ["off", "low", "medium", "high"] as const,
						defaultLevel: "medium",
					},
				}),
			)
			const levels = registry.getSupportedReasoningLevels("deepseek")
			expect(levels).toContain("off")
			expect(levels).toContain("high")
			expect(levels).not.toContain("auto")
		})

		it("returns empty array when provider has no reasoning support", () => {
			registry.register(makeProvider({ id: "ollama" }))
			expect(registry.getSupportedReasoningLevels("ollama")).toEqual([])
		})

		it("returns empty array for unknown provider", () => {
			expect(registry.getSupportedReasoningLevels("unknown")).toEqual([])
		})
	})

	describe("lifecycle", () => {
		it("unregisters a provider", () => {
			registry.register(makeProvider({ id: "deepseek" }))
			expect(registry.unregister("deepseek")).toBe(true)
			expect(registry.getProvider("deepseek")).toBeUndefined()
			expect(registry.size).toBe(0)
		})

		it("returns false when unregistering unknown provider", () => {
			expect(registry.unregister("unknown")).toBe(false)
		})

		it("clears all providers", () => {
			registry.registerProviders([
				makeProvider({ id: "a" }),
				makeProvider({ id: "b" }),
			])
			registry.clear()
			expect(registry.size).toBe(0)
			expect(registry.getProviders()).toEqual([])
		})
	})
})
