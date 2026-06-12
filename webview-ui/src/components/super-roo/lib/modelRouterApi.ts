/**
 * AI Model Router — frontend API client.
 *
 * Provides typed fetch wrappers for all model router backend endpoints.
 * Types are defined inline to avoid cross-package import issues.
 */

// ── Types (mirrored from backend for frontend use) ──────────────────────────

export type ProviderStatus = "missing_key" | "untested" | "tested" | "error"

export type TaskRouteType =
	| "planning"
	| "coding"
	| "debugging"
	| "crawling"
	| "research"
	| "testing"
	| "deployment"
	| "architecture"
	| "fast_fix"
	| "condense_autocomplete"

export type ModelCapability =
	| "chat"
	| "vision"
	| "function-calling"
	| "structured-output"
	| "reasoning"
	| "coding"
	| "research"
	| "fast"
	| "condense_autocomplete"

export interface ProviderModel {
	id: string
	label: string
	providerId: string
	capabilities: string[]
	inputCostPerMTok?: number
	outputCostPerMTok?: number
	averageLatencyMs?: number
}

export interface ProviderMetadata {
	providerId: string
	displayName: string
	status: ProviderStatus
	maskedKey?: string
	models: ProviderModel[]
	capabilities: string[]
	lastTestedAt?: string
	errorMessage?: string
}

export interface ModelRoute {
	id: string
	taskType: TaskRouteType
	primaryProvider: string
	primaryModel: string
	fallbackProvider1?: string
	fallbackModel1?: string
	fallbackProvider2?: string
	fallbackModel2?: string
	enabled: boolean
	requireApproval: boolean
	costLimitUsd?: number
	maxLatencyMs?: number
	createdAt: string
	updatedAt: string
}

export interface FallbackRules {
	retryPrimaryOnce: boolean
	switchToFallback1AfterRetry: boolean
	switchToFallback2AfterFallback1: boolean
	switchIfLatencyAboveMs: number
	switchIfQuotaExceeded: boolean
	switchIfApiKeyUnavailable: boolean
}

export interface SafetyRules {
	requireDeploymentApproval: boolean
	requireExpensiveModelApproval: boolean
	expensiveModelUsdPerMTok: number
	requireLongRunningTaskApproval: boolean
	longRunningTaskMinutes: number
	blockUntestedProviders: boolean
}

export interface RouteTestResult {
	ok: boolean
	taskType?: TaskRouteType
	selectedProvider?: string
	selectedModel?: string
	latencyMs?: number
	message?: string
	reason?: string
}

export interface UsageSummaryEntry {
	providerId: string
	modelId: string
	modelLabel: string
	latencyAvgMs: number
	successRate: number
	errorRate: number
	tokensAvg: number
	costPerMTok: number
}

// ── API client ──────────────────────────────────────────────────────────────

const API_BASE = "/api/model-router"

async function json<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(`${API_BASE}${path}`, {
		headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
		...init,
	})
	if (!res.ok) throw new Error(await res.text())
	return res.json()
}

export const modelRouterApi = {
	/** Get all providers with metadata and status. */
	providers: () => json<{ providers: ProviderMetadata[] }>("/providers"),

	/** Get all task-to-model routes. */
	routes: () => json<{ routes: ModelRoute[] }>("/routes"),

	/** Get usage summary for all models. */
	usage: () => json<{ usage: UsageSummaryEntry[] }>("/usage"),

	/** Sync provider status from API Keys vault. */
	syncApiKeys: () =>
		json<{ ok: boolean; providers: ProviderMetadata[]; syncedAt: string }>("/sync-api-keys", {
			method: "POST",
		}),

	/** Test a specific route by task type. */
	testRoute: (taskType: TaskRouteType) =>
		json<RouteTestResult>("/test-route", {
			method: "POST",
			body: JSON.stringify({ taskType }),
		}),

	/** Create or update a route. */
	upsertRoute: (route: Partial<ModelRoute> & { taskType: TaskRouteType }) =>
		json<{ route: ModelRoute }>("/routes", {
			method: "POST",
			body: JSON.stringify(route),
		}),

	/** Update a specific route by ID. */
	updateRoute: (id: string, patch: Partial<ModelRoute>) =>
		json<{ route: ModelRoute }>(`/routes/${id}`, {
			method: "PATCH",
			body: JSON.stringify(patch),
		}),

	/** Delete a route by ID. */
	deleteRoute: (id: string) =>
		json<{ ok: boolean }>(`/routes/${id}`, {
			method: "DELETE",
		}),

	/** Get current fallback rules. */
	fallbackRules: () => json<{ fallbackRules: FallbackRules }>("/fallback-rules"),

	/** Update fallback rules. */
	updateFallbackRules: (patch: Partial<FallbackRules>) =>
		json<{ fallbackRules: FallbackRules }>("/fallback-rules", {
			method: "PATCH",
			body: JSON.stringify(patch),
		}),

	/** Get current safety rules. */
	safetyRules: () => json<{ safetyRules: SafetyRules }>("/safety-rules"),

	/** Update safety rules. */
	updateSafetyRules: (patch: Partial<SafetyRules>) =>
		json<{ safetyRules: SafetyRules }>("/safety-rules", {
			method: "PATCH",
			body: JSON.stringify(patch),
		}),

	/** Generate condense autocomplete completion. */
	generateAutocomplete: (body: {
		partialMessage: string
		context?: string
		maxTokens?: number
	}) =>
		json<
			| {
					completion: string
					provider: string
					model: string
					isLocalFallback: boolean
					latencyMs: number
			  }
			| { error: string; code: string }
		>("/condense-autocomplete/generate", {
			method: "POST",
			body: JSON.stringify(body),
		}),

	/** Check if condense autocomplete is available. */
	isAutocompleteAvailable: () => json<{ available: boolean }>("/condense-autocomplete/available"),
}
