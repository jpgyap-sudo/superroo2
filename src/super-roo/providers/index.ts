/**
 * Provider Abstraction — Barrel exports
 *
 * Provides a provider-agnostic reasoning abstraction and modular provider system
 * inspired by Eclipse Theia's ai-core package.
 *
 * @see https://github.com/eclipse-theia/theia/blob/master/packages/ai-core/
 */

export { ProviderRegistry } from "./ProviderRegistry"
export {
	REASONING_TOKENS,
	REASONING_MAPPERS,
	getReasoningMapper,
	applyReasoning,
	deepseekReasoningMapper,
	openaiReasoningMapper,
	anthropicReasoningMapper,
	noopReasoningMapper,
} from "./reasoning-mappers"
export type { ReasoningMapper } from "./reasoning-mappers"

export type {
	ReasoningLevel,
	ReasoningApi,
	ReasoningSettings,
	ReasoningSupport,
	LanguageModelMessage,
	LanguageModelMessageRole,
	TextMessage,
	ToolUseMessage,
	ToolResultMessage,
	ImageMessage,
	ChatOptions,
	ChatResponse,
	LanguageModelProvider,
	ProviderSelector,
} from "./types"
