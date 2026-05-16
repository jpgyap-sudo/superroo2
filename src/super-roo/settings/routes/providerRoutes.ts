/**
 * Provider API routes.
 *
 * These routes manage provider configurations and API keys.
 * Keys are encrypted at rest using AES-256-GCM via the secret vault.
 */

import { Router, Request, Response } from "express"
import { encryptSecret, decryptSecret, maskSecret, hashApiKey } from "../services/secretVault"
import { testProviderKey } from "../services/providerTest"
import { PROVIDERS } from "../config/providers"
import type { ProviderEntry, ProviderStatus } from "../types"

export function createProviderRouter(): Router {
	const router = Router()

	// In-memory store (will be replaced with DB persistence in Phase 2)
	const encryptedSecrets = new Map<string, string>()
	const providerMeta = new Map<
		string,
		{
			status: ProviderStatus
			hasKey: boolean
			lastTestedAt: number | null
			latencyMs: number | null
			models: string[]
		}
	>()

	// Initialize provider meta from config
	for (const p of PROVIDERS) {
		providerMeta.set(p.id, {
			status: "missing",
			hasKey: false,
			lastTestedAt: null,
			latencyMs: null,
			models: p.models.map((m) => m.id),
		})
	}

	/**
	 * GET / — List all providers with their status.
	 */
	router.get("/", async (_req: Request, res: Response) => {
		const entries: ProviderEntry[] = PROVIDERS.map((p) => {
			const meta = providerMeta.get(p.id)!
			return {
				id: p.id,
				name: p.name,
				description: p.description,
				status: meta.status,
				hasKey: encryptedSecrets.has(p.id),
				lastTestedAt: meta.lastTestedAt,
				latencyMs: meta.latencyMs,
				models: meta.models,
				capabilities: p.capabilities,
			}
		})
		res.json({ providers: entries })
	})

	/**
	 * POST /:providerId/key — Save (and optionally test) an API key.
	 *
	 * Body: { apiKey: string, test?: boolean }
	 * The key is encrypted before storage and never returned raw.
	 */
	router.post("/:providerId/key", async (req: Request, res: Response) => {
		const { providerId } = req.params
		const { apiKey, test } = req.body as { apiKey: string; test?: boolean }

		if (!apiKey || typeof apiKey !== "string") {
			res.status(400).json({ error: "apiKey is required" })
			return
		}

		const provider = PROVIDERS.find((p) => p.id === providerId)
		if (!provider) {
			res.status(404).json({ error: `Provider "${providerId}" not found` })
			return
		}

		// Encrypt and store
		const encrypted = encryptSecret(apiKey)
		encryptedSecrets.set(providerId, encrypted)

		const meta = providerMeta.get(providerId)!
		meta.hasKey = true

		// Optionally test the key
		if (test) {
			const result = await testProviderKey(providerId, apiKey)
			meta.status = result.ok ? "connected" : "invalid"
			meta.lastTestedAt = Date.now()
			meta.latencyMs = result.latencyMs
			if (result.models) {
				meta.models = result.models
			}
		} else {
			meta.status = "not_tested"
		}

		res.json({
			ok: true,
			providerId,
			status: meta.status,
			masked: maskSecret(apiKey),
			hash: hashApiKey(apiKey),
		})
	})

	/**
	 * POST /:providerId/test — Test an already-stored key.
	 */
	router.post("/:providerId/test", async (req: Request, res: Response) => {
		const { providerId } = req.params

		const encrypted = encryptedSecrets.get(providerId)
		if (!encrypted) {
			res.status(400).json({ error: "No API key stored for this provider" })
			return
		}

		const apiKey = decryptSecret(encrypted)
		const result = await testProviderKey(providerId, apiKey)

		const meta = providerMeta.get(providerId)!
		meta.status = result.ok ? "connected" : "invalid"
		meta.lastTestedAt = Date.now()
		meta.latencyMs = result.latencyMs
		if (result.models) {
			meta.models = result.models
		}

		res.json({
			ok: result.ok,
			providerId,
			status: meta.status,
			latencyMs: result.latencyMs,
			message: result.message,
		})
	})

	/**
	 * PATCH /:providerId — Update provider metadata (e.g., enabled, models).
	 */
	router.patch("/:providerId", async (req: Request, res: Response) => {
		const { providerId } = req.params
		const updates = req.body as Partial<Pick<ProviderEntry, "models">>

		const meta = providerMeta.get(providerId)
		if (!meta) {
			res.status(404).json({ error: `Provider "${providerId}" not found` })
			return
		}

		if (updates.models) {
			meta.models = updates.models
		}

		res.json({ ok: true, providerId })
	})

	/**
	 * DELETE /:providerId/key — Remove a stored API key.
	 */
	router.delete("/:providerId/key", async (req: Request, res: Response) => {
		const { providerId } = req.params

		encryptedSecrets.delete(providerId)
		const meta = providerMeta.get(providerId)
		if (meta) {
			meta.status = "missing"
			meta.lastTestedAt = null
			meta.latencyMs = null
		}

		res.json({ ok: true, providerId })
	})

	return router
}
