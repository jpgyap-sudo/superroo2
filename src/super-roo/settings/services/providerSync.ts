/**
 * Provider Sync — loads runtime provider configuration and maps agents
 * to available providers.
 *
 * This service bridges the gap between stored provider configs (with encrypted keys)
 * and the agent routing system that needs to know which providers are available.
 */

import { testProviderKey } from "./providerTest"
import { decryptSecret } from "./secretVault"

export type AgentName = "planner" | "coder" | "debugger" | "crawler" | "tester" | "deployChecker"

export interface ProviderRuntimeConfig {
	providers: Record<
		string,
		{
			apiKeyEncrypted?: string
			baseUrl?: string
			enabled: boolean
			models?: string[]
		}
	>
}

export interface ProviderStatus {
	id: string
	enabled: boolean
	hasKey: boolean
	connected: boolean | null
	lastTestedAt: number | null
	latencyMs: number | null
}

/**
 * Load provider runtime config and return a map of provider ID -> availability.
 */
export function loadProviderRuntimeConfig(config: ProviderRuntimeConfig): Record<string, boolean> {
	const availability: Record<string, boolean> = {}
	for (const [id, provider] of Object.entries(config.providers)) {
		availability[id] = provider.enabled && !!provider.apiKeyEncrypted
	}
	return availability
}

/**
 * Get the best available provider for a given agent based on runtime config.
 * Returns the provider ID or null if none available.
 */
export function getProviderForAgent(
	agent: AgentName,
	config: ProviderRuntimeConfig,
	routes: Array<{ agent: string; primary: { provider: string }; fallbacks: Array<{ provider: string }> }>,
): string | null {
	const availability = loadProviderRuntimeConfig(config)
	const route = routes.find((r) => r.agent === agent)
	if (!route) return null

	if (availability[route.primary.provider]) {
		return route.primary.provider
	}

	for (const fb of route.fallbacks) {
		if (availability[fb.provider]) {
			return fb.provider
		}
	}

	return null
}

/**
 * Test a provider connection by decrypting its stored key and testing it.
 */
export async function testProviderConnection(
	providerId: string,
	apiKeyEncrypted: string | undefined,
): Promise<{ ok: boolean; latencyMs: number; message: string }> {
	if (!apiKeyEncrypted) {
		return { ok: false, latencyMs: 0, message: "No API key stored" }
	}

	try {
		const apiKey = decryptSecret(apiKeyEncrypted)
		return await testProviderKey(providerId, apiKey)
	} catch (err: unknown) {
		return { ok: false, latencyMs: 0, message: (err as Error).message }
	}
}
