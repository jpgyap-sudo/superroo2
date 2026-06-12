import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

// Mock the model router service to avoid module state issues
vi.mock("../modelRouterService", () => ({
	listRoutes: vi.fn(),
	selectUsableModel: vi.fn(),
}))

const { listRoutes, selectUsableModel } = await import("../modelRouterService")

const moduleUnderTest = async () => {
	const mod = await import("../condenseAutocompleteService")
	return mod
}

describe("condenseAutocompleteService", () => {
	beforeEach(async () => {
		vi.resetAllMocks()
		;(listRoutes as any).mockResolvedValue([])
		;(selectUsableModel as any).mockResolvedValue({ ok: false, reason: "No route" })
		// Clear cache between tests
		const { clearAutocompleteCache } = await import("../condenseAutocompleteService")
		clearAutocompleteCache()
	})

	describe("isAutocompleteAvailable", () => {
		it("returns true when local Ollama is available", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					models: [{ name: "qwen2.5-coder:1.5b" }],
				}),
			})

			const { isAutocompleteAvailable } = await moduleUnderTest()
			const result = await isAutocompleteAvailable()
			expect(result).toBe(true)
		})

		it("returns false when local Ollama is unavailable", async () => {
			mockFetch.mockRejectedValueOnce(new Error("connection refused"))

			const { isAutocompleteAvailable } = await moduleUnderTest()
			const result = await isAutocompleteAvailable()
			expect(result).toBe(false)
		})
	})

	describe("generateAutocomplete", () => {
		it("throws on invalid input", async () => {
			const { generateAutocomplete } = await moduleUnderTest()
			await expect(generateAutocomplete({ partialMessage: "" })).rejects.toMatchObject({
				code: "invalid_input",
			})
			await expect(generateAutocomplete({ partialMessage: "a" })).rejects.toMatchObject({
				code: "invalid_input",
			})
		})

		it("falls back to local Ollama when router fails", async () => {
			// Router returns no usable route (mocked via listRoutes/selectUsableModel in beforeEach)
			// Local Ollama generation succeeds
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					response: " suggested completion",
					done: true,
				}),
			})

			const { generateAutocomplete } = await moduleUnderTest()
			const result = await generateAutocomplete({
				partialMessage: "hello world",
				maxTokens: 32,
			})

			expect(result.completion).toBe("suggested completion")
			expect(result.provider).toBe("ollama")
			expect(result.isLocalFallback).toBe(true)
			expect(result.latencyMs).toBeGreaterThanOrEqual(0)
		})

		it("throws when both router and local Ollama fail", async () => {
			mockFetch.mockRejectedValue(new Error("all providers down"))

			const { generateAutocomplete } = await moduleUnderTest()
			await expect(
				generateAutocomplete({
					partialMessage: "hello world",
				}),
			).rejects.toMatchObject({
				code: "generation_failed",
			})
		})
	})
})
