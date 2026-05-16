/**
 * AI Model Router — shared types for the model routing system.
 *
 * These types define the data structures used by the backend service,
 * frontend API client, and messaging protocol. They are designed to
 * integrate with the existing API Keys / Provider Secret Vault system.
 */

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

export type ModelCapability =
	| "chat"
	| "vision"
	| "function-calling"
	| "structured-output"
	| "reasoning"
	| "coding"
	| "research"
	| "fast"

export interface ProviderModel {
	id: string
	label: string
	providerId: string
	capabilities: ModelCapability[]
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
	capabilities: ModelCapability[]
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

export interface RouteUsageMetric {
	id: string
	providerId: string
	modelId: string
	taskType: TaskRouteType
	latencyMs: number
	success: boolean
	errorCode?: string
	inputTokens: number
	outputTokens: number
	createdAt: string
}
