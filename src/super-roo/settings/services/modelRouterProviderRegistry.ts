/**
 * Provider Registry — bridges the existing API Keys / Secret Vault system
 * with the AI Model Router.
 *
 * This service reads provider availability, tested status, models, costs,
 * and usage metadata from the existing provider configuration. It NEVER
 * returns raw API keys to the frontend.
 */

import { PROVIDERS, type ProviderConfig } from "../config/providers"
import type { ProviderMetadata, ProviderModel, ModelCapability } from "./modelRouterTypes"

// ── Capability mapping ──────────────────────────────────────────────────────

const CAPABILITY_MAP: Record<string, ModelCapability[]> = {
	openai: ["chat", "vision", "function-calling", "structured-output", "reasoning"],
	anthropic: ["chat", "vision", "function-calling", "coding"],
	deepseek: ["chat", "reasoning", "coding"],
	kimi: ["chat", "vision", "research"],
	openrouter: ["chat", "vision", "function-calling"],
	groq: ["chat", "fast"],
}

// ── In-memory provider status store ─────────────────────────────────────────
// In production this would be backed by the encrypted secret vault.
// Status values: 'missing_key' | 'untested' | 'tested' | 'error'

interface ProviderStatusEntry {
	status: "missing_key" | "untested" | "tested" | "error"
	maskedKey?: string
	lastTestedAt?: string
	errorMessage?: string
}

const providerStatusStore: Record<string, ProviderStatusEntry> = {
	openai: { status: "tested", maskedKey: "sk-...abcd" },
	anthropic: { status: "tested", maskedKey: "sk-ant-...abcd" },
	deepseek: { status: "tested", maskedKey: "sk-...deep" },
	kimi: { status: "tested", maskedKey: "sk-...kimi" },
	openrouter: { status: "untested" },
	groq: { status: "untested" },
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Get the full provider registry with metadata, models, and status.
 * This is the primary data source for the AI Model Router frontend.
 * Raw API keys are NEVER exposed.
 */
export async function getProviderRegistry(): Promise<ProviderMetadata[]> {
	return PROVIDERS.map((config: ProviderConfig) => {
		const statusEntry = providerStatusStore[config.id] ?? { status: "missing_key" as const }
		const capabilities = CAPABILITY_MAP[config.id] ?? ["chat"]

		return {
			providerId: config.id,
			displayName: config.name,
			status: statusEntry.status,
			maskedKey: statusEntry.maskedKey,
			capabilities,
			models: config.models.map(
				(m): ProviderModel => ({
					id: m.id,
					label: m.name,
					providerId: config.id,
					capabilities: inferModelCapabilities(m.id, capabilities),
					inputCostPerMTok: m.costPer1kInput * 1000, // Convert per-1k to per-M
					outputCostPerMTok: m.costPer1kOutput * 1000,
					averageLatencyMs: undefined, // Populated from real usage data
				}),
			),
			lastTestedAt: statusEntry.lastTestedAt,
			errorMessage: statusEntry.errorMessage,
		}
	})
}

/**
 * Get a specific provider and model by ID.
 * Returns null for either if not found.
 */
export async function getAvailableProviderModel(
	providerId: string,
	modelId: string,
): Promise<{ provider: ProviderMetadata | null; model: ProviderModel | null }> {
	const providers = await getProviderRegistry()
	const provider = providers.find((p) => p.providerId === providerId) ?? null
	const model = provider?.models.find((m) => m.id === modelId) ?? null
	return { provider, model }
}

/**
 * Update the status of a provider (called after testing API keys).
 */
export function updateProviderStatus(providerId: string, status: "tested" | "error", errorMessage?: string): void {
	if (providerStatusStore[providerId]) {
		providerStatusStore[providerId].status = status
		providerStatusStore[providerId].lastTestedAt = new Date().toISOString()
		providerStatusStore[providerId].errorMessage = errorMessage
	}
}

/**
 * Set a provider's masked key (called when a key is saved).
 */
export function setProviderMaskedKey(providerId: string, maskedKey: string): void {
	if (providerStatusStore[providerId]) {
		providerStatusStore[providerId].maskedKey = maskedKey
		providerStatusStore[providerId].status = "untested"
	}
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function inferModelCapabilities(modelId: string, providerCaps: ModelCapability[]): ModelCapability[] {
	// Fast/cheap models get fewer capabilities
	if (modelId.includes("mini") || modelId.includes("haiku")) {
		return providerCaps.filter((c) => c !== "reasoning" && c !== "structured-output")
	}
	return providerCaps
}
