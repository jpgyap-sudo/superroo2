/**
 * Tests for the ProviderSync service.
 *
 * Validates runtime config loading, provider-to-agent mapping,
 * and connection testing (without actual network calls).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import type { ProviderRuntimeConfig } from "../services/providerSync"

const ORIGINAL_VAULT_KEY = process.env.SUPERROO_VAULT_KEY
const TEST_VAULT_KEY = "zLjC8awzE+s24XzsTLPueidCH4ZwxWrnXQOlFOl9aRs="

beforeEach(() => {
	process.env.SUPERROO_VAULT_KEY = TEST_VAULT_KEY
})

afterEach(() => {
	if (ORIGINAL_VAULT_KEY === undefined) {
		delete process.env.SUPERROO_VAULT_KEY
	} else {
		process.env.SUPERROO_VAULT_KEY = ORIGINAL_VAULT_KEY
	}
})

describe("providerSync", () => {
	describe("loadProviderRuntimeConfig", () => {
		it("should mark providers as available when enabled and have key", async () => {
			const { loadProviderRuntimeConfig } = await import("../services/providerSync")
			const config: ProviderRuntimeConfig = {
				providers: {
					openai: { apiKeyEncrypted: "some-encrypted-key", enabled: true },
					anthropic: { apiKeyEncrypted: "another-key", enabled: true },
				},
			}
			const availability = loadProviderRuntimeConfig(config)
			expect(availability.openai).toBe(true)
			expect(availability.anthropic).toBe(true)
		})

		it("should mark providers as unavailable when disabled", async () => {
			const { loadProviderRuntimeConfig } = await import("../services/providerSync")
			const config: ProviderRuntimeConfig = {
				providers: {
					openai: { apiKeyEncrypted: "some-key", enabled: false },
				},
			}
			const availability = loadProviderRuntimeConfig(config)
			expect(availability.openai).toBe(false)
		})

		it("should mark providers as unavailable when no key", async () => {
			const { loadProviderRuntimeConfig } = await import("../services/providerSync")
			const config: ProviderRuntimeConfig = {
				providers: {
					openai: { enabled: true },
				},
			}
			const availability = loadProviderRuntimeConfig(config)
			expect(availability.openai).toBe(false)
		})

		it("should handle empty config", async () => {
			const { loadProviderRuntimeConfig } = await import("../services/providerSync")
			const config: ProviderRuntimeConfig = { providers: {} }
			const availability = loadProviderRuntimeConfig(config)
			expect(Object.keys(availability).length).toBe(0)
		})
	})

	describe("getProviderForAgent", () => {
		it("should return primary provider when available", async () => {
			const { getProviderForAgent } = await import("../services/providerSync")
			const config: ProviderRuntimeConfig = {
				providers: {
					openai: { apiKeyEncrypted: "key", enabled: true },
					anthropic: { apiKeyEncrypted: "key2", enabled: true },
				},
			}
			const routes = [
				{ agent: "planner", primary: { provider: "openai" }, fallbacks: [{ provider: "anthropic" }] },
			]
			const result = getProviderForAgent("planner", config, routes)
			expect(result).toBe("openai")
		})

		it("should return fallback when primary is unavailable", async () => {
			const { getProviderForAgent } = await import("../services/providerSync")
			const config: ProviderRuntimeConfig = {
				providers: {
					openai: { enabled: true }, // no key
					anthropic: { apiKeyEncrypted: "key2", enabled: true },
				},
			}
			const routes = [
				{ agent: "planner", primary: { provider: "openai" }, fallbacks: [{ provider: "anthropic" }] },
			]
			const result = getProviderForAgent("planner", config, routes)
			expect(result).toBe("anthropic")
		})

		it("should return null when no provider is available", async () => {
			const { getProviderForAgent } = await import("../services/providerSync")
			const config: ProviderRuntimeConfig = {
				providers: {
					openai: { enabled: true },
					anthropic: { enabled: true },
				},
			}
			const routes = [
				{ agent: "planner", primary: { provider: "openai" }, fallbacks: [{ provider: "anthropic" }] },
			]
			const result = getProviderForAgent("planner", config, routes)
			expect(result).toBeNull()
		})

		it("should return null for unknown agent", async () => {
			const { getProviderForAgent } = await import("../services/providerSync")
			const config: ProviderRuntimeConfig = { providers: {} }
			const result = getProviderForAgent("unknown" as any, config, [])
			expect(result).toBeNull()
		})
	})

	describe("testProviderConnection", () => {
		it("should return failure when no encrypted key is provided", async () => {
			const { testProviderConnection } = await import("../services/providerSync")
			const result = await testProviderConnection("openai", undefined)
			expect(result.ok).toBe(false)
			expect(result.message).toContain("No API key stored")
		})

		it("should return failure for unknown provider", async () => {
			const { encryptSecret } = await import("../services/secretVault")
			const { testProviderConnection } = await import("../services/providerSync")
			const encrypted = encryptSecret("sk-test-key")
			const result = await testProviderConnection("unknown-provider", encrypted)
			expect(result.ok).toBe(false)
			expect(result.message).toContain("Unknown provider")
		})
	})
})
