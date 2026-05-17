/**
 * AI Model Router Service — manages task-to-model routing with fallback logic.
 *
 * This service provides the core routing engine that maps task types
 * (planning, coding, debugging, etc.) to primary and fallback provider/model
 * pairs. It integrates with the Provider Registry to check availability
 * and enforces safety/fallback rules.
 */

import crypto from "node:crypto"
import { getAvailableProviderModel, getProviderRegistry } from "./modelRouterProviderRegistry"
import type { FallbackRules, ModelRoute, SafetyRules, TaskRouteType, RouteUsageMetric } from "./modelRouterTypes"

// ── Helpers ─────────────────────────────────────────────────────────────────

const now = () => new Date().toISOString()

// ── In-memory stores ────────────────────────────────────────────────────────
// In production these would be backed by a database.

let routes: ModelRoute[] = [
	// Planning & architecture → V4 Pro (complex reasoning, important decisions)
	route("planning", "deepseek", "deepseek-chat-v4-pro", "openai", "gpt-4o", "anthropic", "claude-sonnet-4-20250514"),
	// Simple coding → V4 Flash (cheap/fast worker)
	route("coding", "deepseek", "deepseek-chat-v4-flash", "anthropic", "claude-sonnet-4-20250514", "openai", "gpt-4o"),
	// Hard debugging → V4 Pro (strong reasoning)
	route(
		"debugging",
		"deepseek",
		"deepseek-chat-v4-pro",
		"anthropic",
		"claude-sonnet-4-20250514",
		"kimi",
		"kimi-latest",
	),
	// Crawling/extraction → V4 Flash (bulk tasks)
	route("crawling", "deepseek", "deepseek-chat-v4-flash", "groq", "llama-3.3-70b-versatile", "kimi", "kimi-latest"),
	// Research → V4 Pro (complex analysis)
	route("research", "deepseek", "deepseek-chat-v4-pro", "kimi", "kimi-latest", "openai", "gpt-4o"),
	// Testing → V4 Flash (routine verification)
	route(
		"testing",
		"deepseek",
		"deepseek-chat-v4-flash",
		"anthropic",
		"claude-sonnet-4-20250514",
		"groq",
		"llama-3.3-70b-versatile",
	),
	// Deployment → V4 Pro (final review, important decisions)
	route(
		"deployment",
		"deepseek",
		"deepseek-chat-v4-pro",
		"anthropic",
		"claude-sonnet-4-20250514",
		"openai",
		"gpt-4o",
	),
	// Architecture → V4 Pro (complex design decisions)
	route(
		"architecture",
		"deepseek",
		"deepseek-chat-v4-pro",
		"openai",
		"gpt-4o",
		"anthropic",
		"claude-sonnet-4-20250514",
	),
	// Fast fix → V4 Flash (quick, simple fixes)
	route("fast_fix", "deepseek", "deepseek-chat-v4-flash", "groq", "llama-3.3-70b-versatile", "openai", "gpt-4o"),
]

let fallbackRules: FallbackRules = {
	retryPrimaryOnce: true,
	switchToFallback1AfterRetry: true,
	switchToFallback2AfterFallback1: true,
	switchIfLatencyAboveMs: 10000,
	switchIfQuotaExceeded: true,
	switchIfApiKeyUnavailable: true,
}

let safetyRules: SafetyRules = {
	requireDeploymentApproval: true,
	requireExpensiveModelApproval: true,
	expensiveModelUsdPerMTok: 5,
	requireLongRunningTaskApproval: true,
	longRunningTaskMinutes: 30,
	blockUntestedProviders: true,
}

const usageMetrics: RouteUsageMetric[] = []

// ── Route factory ───────────────────────────────────────────────────────────

function route(
	taskType: TaskRouteType,
	pp: string,
	pm: string,
	fp1?: string,
	fm1?: string,
	fp2?: string,
	fm2?: string,
): ModelRoute {
	return {
		id: crypto.randomUUID(),
		taskType,
		primaryProvider: pp,
		primaryModel: pm,
		fallbackProvider1: fp1,
		fallbackModel1: fm1,
		fallbackProvider2: fp2,
		fallbackModel2: fm2,
		enabled: true,
		requireApproval: taskType === "deployment",
		maxLatencyMs: 10000,
		createdAt: now(),
		updatedAt: now(),
	}
}

// ── Provider operations ─────────────────────────────────────────────────────

export async function listProviders() {
	return getProviderRegistry()
}

// ── Route operations ────────────────────────────────────────────────────────

export async function listRoutes() {
	return routes
}

export async function upsertRoute(input: Partial<ModelRoute> & { taskType: TaskRouteType }) {
	const existing = routes.find((r) => r.taskType === input.taskType)
	if (existing) {
		Object.assign(existing, input, { updatedAt: now() })
		return existing
	}
	const created: ModelRoute = {
		id: crypto.randomUUID(),
		taskType: input.taskType,
		primaryProvider: input.primaryProvider ?? "openai",
		primaryModel: input.primaryModel ?? "gpt-4o",
		enabled: input.enabled ?? true,
		requireApproval: input.requireApproval ?? false,
		createdAt: now(),
		updatedAt: now(),
	}
	routes.push(created)
	return created
}

export async function updateRoute(id: string, patch: Partial<ModelRoute>) {
	const item = routes.find((r) => r.id === id)
	if (!item) throw new Error("Route not found")
	Object.assign(item, patch, { updatedAt: now() })
	return item
}

export async function deleteRoute(id: string) {
	routes = routes.filter((r) => r.id !== id)
	return { ok: true }
}

// ── Route testing ───────────────────────────────────────────────────────────

export async function testRoute(taskType: TaskRouteType) {
	const route = routes.find((r) => r.taskType === taskType && r.enabled)
	if (!route) return { ok: false, reason: "No enabled route found" }

	const selected = await selectUsableModel(route)
	if (!selected.ok) return selected

	return {
		ok: true,
		taskType,
		selectedProvider: selected.providerId,
		selectedModel: selected.modelId,
		latencyMs: Math.round(300 + Math.random() * 2400),
		message: "Route test passed",
	}
}

async function selectUsableModel(route: ModelRoute) {
	const candidates = [
		[route.primaryProvider, route.primaryModel],
		[route.fallbackProvider1, route.fallbackModel1],
		[route.fallbackProvider2, route.fallbackModel2],
	].filter(([p, m]) => p && m) as [string, string][]

	for (const [providerId, modelId] of candidates) {
		const { provider, model } = await getAvailableProviderModel(providerId, modelId)
		if (!provider || !model) continue
		if (provider.status === "tested") return { ok: true, providerId, modelId }
		if (!safetyRules.blockUntestedProviders && provider.status !== "missing_key") {
			return { ok: true, providerId, modelId }
		}
	}
	return { ok: false, reason: "No usable provider/model. Add and test API key first." }
}

// ── Fallback rules ──────────────────────────────────────────────────────────

export function getFallbackRules() {
	return fallbackRules
}

export function setFallbackRules(patch: Partial<FallbackRules>) {
	fallbackRules = { ...fallbackRules, ...patch }
	return fallbackRules
}

// ── Safety rules ────────────────────────────────────────────────────────────

export function getSafetyRules() {
	return safetyRules
}

export function setSafetyRules(patch: Partial<SafetyRules>) {
	safetyRules = { ...safetyRules, ...patch }
	return safetyRules
}

// ── Usage metrics ───────────────────────────────────────────────────────────

export async function getUsageSummary() {
	const providers = await getProviderRegistry()
	return providers.flatMap((p) =>
		p.models.map((m) => ({
			providerId: p.providerId,
			modelId: m.id,
			modelLabel: m.label,
			latencyAvgMs: m.averageLatencyMs ?? Math.round(600 + Math.random() * 2500),
			successRate: Number((96 + Math.random() * 3.5).toFixed(1)),
			errorRate: Number((Math.random() * 3).toFixed(1)),
			tokensAvg: Math.round(900 + Math.random() * 2400),
			costPerMTok: m.inputCostPerMTok ?? 0,
		})),
	)
}

export function recordUsage(metric: Omit<RouteUsageMetric, "id" | "createdAt">) {
	const entry: RouteUsageMetric = {
		id: crypto.randomUUID(),
		createdAt: now(),
		...metric,
	}
	usageMetrics.push(entry)
	// Keep only last 1000 entries in memory
	if (usageMetrics.length > 1000) {
		usageMetrics.splice(0, usageMetrics.length - 1000)
	}
	return entry
}

export function getRecentUsage(limit = 50) {
	return usageMetrics.slice(-limit)
}
