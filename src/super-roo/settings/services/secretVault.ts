import crypto from "crypto"

const ALGO = "aes-256-gcm"

/**
 * Get the vault encryption key from environment.
 * Falls back to a derived key from SUPERROO_VAULT_KEY or generates a warning.
 */
function getVaultKey(): Buffer {
	const raw = process.env.SUPERROO_VAULT_KEY
	if (!raw) {
		throw new Error(
			"SUPERROO_VAULT_KEY is missing. Generate a 32-byte base64 key with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
		)
	}
	const key = Buffer.from(raw, "base64")
	if (key.length !== 32) {
		throw new Error("SUPERROO_VAULT_KEY must be exactly 32 bytes (44 base64 chars).")
	}
	return key
}

/**
 * Encrypt a plaintext secret using AES-256-GCM.
 * Returns a dot-delimited string: iv.tag.data (all base64).
 */
export function encryptSecret(plainText: string): string {
	const key = getVaultKey()
	const iv = crypto.randomBytes(12)
	const cipher = crypto.createCipheriv(ALGO, key, iv)
	const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()])
	const tag = cipher.getAuthTag()
	return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`
}

/**
 * Decrypt a payload previously produced by encryptSecret.
 */
export function decryptSecret(payload: string): string {
	const key = getVaultKey()
	const [ivB64, tagB64, dataB64] = payload.split(".")
	const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivB64, "base64"))
	decipher.setAuthTag(Buffer.from(tagB64, "base64"))
	return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8")
}

/**
 * Mask an API key for safe display: sk-••••••••abcd
 */
export function maskSecret(value?: string): string {
	if (!value || value.length < 8) return ""
	const prefix = value.slice(0, 4)
	const suffix = value.slice(-4)
	return `${prefix}••••••••${suffix}`
}

/**
 * SHA-256 hash of an API key (for dedup / change detection).
 */
export function hashApiKey(key: string): string {
	return crypto.createHash("sha256").update(key).digest("hex")
}
