/**
 * Reasoning Mappers — Maps ReasoningLevel to each provider's native API format.
 *
 * Each provider uses a different API mechanism for reasoning:
 * - DeepSeek R1: `thinking.budget_tokens`
 * - OpenAI o-series: `reasoning_effort`
 * - Anthropic Claude: `thinking.type` + `thinking.budget_tokens`
 * - Others: no reasoning support (returns empty object)
 *
 * Inspired by Eclipse Theia's reasoning API types.
 *
 * @see https://github.com/eclipse-theia/theia/blob/master/packages/ai-core/src/common/language-model.ts
 */

import type { ReasoningLevel } from "./types"

// ── Token budgets per level ──────────────────────────────────────────────────

/**
 * Default token budgets for each reasoning level.
 * These are reasonable defaults; providers may have their own limits.
 */
export const REASONING_TOKENS: Record<Exclude<ReasoningLevel, "off">, number> = {
	minimal: 512,
	low: 2048,
	medium: 8192,
	high: 32768,
	auto: 0, // let the provider decide
}

// ── Provider-specific mappers ────────────────────────────────────────────────

export type ReasoningMapper = (level: ReasoningLevel) => Record<string, unknown>

/**
 * Maps ReasoningLevel to DeepSeek's API format.
 * DeepSeek R1 uses `thinking.budget_tokens` to control reasoning depth.
 */
export const deepseekReasoningMapper: ReasoningMapper = (level) => {
	if (level === "off") return {}
	return { thinking: { budget_tokens: REASONING_TOKENS[level] || 8192 } }
}

/**
 * Maps ReasoningLevel to OpenAI's API format.
 * OpenAI o-series uses `reasoning_effort` parameter.
 */
export const openaiReasoningMapper: ReasoningMapper = (level) => {
	if (level === "off") return {}
	// OpenAI uses: "low" | "medium" | "high"
	const effort = level === "minimal" ? "low" : level === "auto" ? "medium" : level
	return { reasoning_effort: effort }
}

/**
 * Maps ReasoningLevel to Anthropic's API format.
 * Claude uses `thinking.type` + `thinking.budget_tokens` for extended thinking.
 */
export const anthropicReasoningMapper: ReasoningMapper = (level) => {
	if (level === "off") return {}
	return {
		thinking: {
			type: "enabled",
			budget_tokens: REASONING_TOKENS[level] || 8192,
		},
	}
}

/**
 * No-op mapper for providers that don't support reasoning.
 */
export const noopReasoningMapper: ReasoningMapper = () => ({})

// ── Registry of all mappers ──────────────────────────────────────────────────

/**
 * Registry of reasoning mappers keyed by provider ID.
 * Add new providers here as they gain reasoning support.
 */
export const REASONING_MAPPERS: Record<string, ReasoningMapper> = {
	deepseek: deepseekReasoningMapper,
	openai: openaiReasoningMapper,
	anthropic: anthropicReasoningMapper,
	ollama: noopReasoningMapper,
	kimi: noopReasoningMapper,
	openrouter: noopReasoningMapper,
	groq: noopReasoningMapper,
}

/**
 * Get the reasoning mapper for a given provider ID.
 * Falls back to noop mapper if the provider is unknown.
 */
export function getReasoningMapper(providerId: string): ReasoningMapper {
	return REASONING_MAPPERS[providerId] ?? noopReasoningMapper
}

/**
 * Apply reasoning settings to a provider's API parameters.
 * Returns the provider-specific parameters to merge into the request body.
 */
export function applyReasoning(
	providerId: string,
	level: ReasoningLevel,
): Record<string, unknown> {
	const mapper = getReasoningMapper(providerId)
	return mapper(level)
}
