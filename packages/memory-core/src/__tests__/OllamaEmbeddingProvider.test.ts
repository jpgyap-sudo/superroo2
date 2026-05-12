import { describe, it, expect, vi } from "vitest"
import { OllamaEmbeddingProvider } from "../OllamaEmbeddingProvider.js"

describe("OllamaEmbeddingProvider", () => {
	it("constructs with defaults", () => {
		const p = new OllamaEmbeddingProvider()
		expect(p).toBeDefined()
	})

	it("constructs with custom options", () => {
		const p = new OllamaEmbeddingProvider({
			baseUrl: "http://ollama:11434",
			model: "custom-model",
			maxChars: 1000,
			requestTimeoutMs: 5000,
		})
		expect(p).toBeDefined()
	})

	it("throws on empty embedding response", async () => {
		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ embedding: [] }),
		} as Response)

		const p = new OllamaEmbeddingProvider({ requestTimeoutMs: 100 })
		await expect(p.embed("test")).rejects.toThrow("empty vector")
	})

	it("throws on HTTP error", async () => {
		global.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 500,
			text: async () => "Internal Server Error",
		} as Response)

		const p = new OllamaEmbeddingProvider({ requestTimeoutMs: 100 })
		await expect(p.embed("test")).rejects.toThrow("Ollama embedding failed: 500")
	})

	it("returns embedding on success", async () => {
		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ embedding: [0.1, 0.2, 0.3] }),
		} as Response)

		const p = new OllamaEmbeddingProvider({ requestTimeoutMs: 100 })
		const result = await p.embed("hello")
		expect(result).toEqual([0.1, 0.2, 0.3])
	})
})
