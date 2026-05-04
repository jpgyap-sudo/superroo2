/**
 * Tests for the SecretVault service.
 *
 * These tests validate AES-256-GCM encryption/decryption, key masking,
 * and API key hashing. They do NOT require network access.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"

const ORIGINAL_VAULT_KEY = process.env.SUPERROO_VAULT_KEY

// A valid 32-byte base64 key for testing (generated via crypto.randomBytes(32).toString('base64'))
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

describe("secretVault", () => {
	describe("encryptSecret / decryptSecret", () => {
		it("should encrypt and decrypt a simple string", async () => {
			const { encryptSecret, decryptSecret } = await import("../services/secretVault")
			const plain = "sk-test-api-key-12345"
			const encrypted = encryptSecret(plain)
			expect(encrypted).toBeTruthy()
			expect(encrypted).toContain(".")
			const decrypted = decryptSecret(encrypted)
			expect(decrypted).toBe(plain)
		})

		it("should produce different ciphertexts for the same plaintext (random IV)", async () => {
			const { encryptSecret } = await import("../services/secretVault")
			const plain = "sk-test-key"
			const a = encryptSecret(plain)
			const b = encryptSecret(plain)
			expect(a).not.toBe(b)
		})

		it("should handle empty string", async () => {
			const { encryptSecret, decryptSecret } = await import("../services/secretVault")
			const encrypted = encryptSecret("")
			const decrypted = decryptSecret(encrypted)
			expect(decrypted).toBe("")
		})

		it("should handle special characters", async () => {
			const { encryptSecret, decryptSecret } = await import("../services/secretVault")
			const plain = "sk-!@#$%^&*()_+-=[]{}|;':\",./<>?`~你好"
			const encrypted = encryptSecret(plain)
			const decrypted = decryptSecret(encrypted)
			expect(decrypted).toBe(plain)
		})

		it("should throw on invalid payload format", async () => {
			const { decryptSecret } = await import("../services/secretVault")
			expect(() => decryptSecret("invalid-payload")).toThrow()
		})

		it("should throw when SUPERROO_VAULT_KEY is missing", async () => {
			delete process.env.SUPERROO_VAULT_KEY
			const { encryptSecret } = await import("../services/secretVault")
			expect(() => encryptSecret("test")).toThrow("SUPERROO_VAULT_KEY")
		})
	})

	describe("maskSecret", () => {
		it("should mask a long API key showing first 4 and last 4 chars", async () => {
			const { maskSecret } = await import("../services/secretVault")
			const result = maskSecret("sk-abcdefghijklmnop")
			// slice(0,4) = "sk-a", slice(-4) = "mnop"
			expect(result).toBe("sk-a••••••••mnop")
		})

		it("should return empty string for undefined", async () => {
			const { maskSecret } = await import("../services/secretVault")
			expect(maskSecret(undefined)).toBe("")
		})

		it("should return empty string for short values (< 8 chars)", async () => {
			const { maskSecret } = await import("../services/secretVault")
			expect(maskSecret("short")).toBe("")
		})

		it("should handle exactly 8 chars", async () => {
			const { maskSecret } = await import("../services/secretVault")
			const result = maskSecret("12345678")
			// slice(0,4) = "1234", slice(-4) = "5678"
			expect(result).toBe("1234••••••••5678")
		})
	})

	describe("hashApiKey", () => {
		it("should produce a SHA-256 hex hash", async () => {
			const { hashApiKey } = await import("../services/secretVault")
			const hash = hashApiKey("sk-test-key")
			expect(hash).toMatch(/^[a-f0-9]{64}$/)
		})

		it("should be deterministic for the same input", async () => {
			const { hashApiKey } = await import("../services/secretVault")
			const a = hashApiKey("sk-test-key")
			const b = hashApiKey("sk-test-key")
			expect(a).toBe(b)
		})

		it("should produce different hashes for different inputs", async () => {
			const { hashApiKey } = await import("../services/secretVault")
			const a = hashApiKey("sk-key-one")
			const b = hashApiKey("sk-key-two")
			expect(a).not.toBe(b)
		})
	})
})
