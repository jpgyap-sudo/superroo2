/**
 * Provider Abstraction — Type definitions
 *
 * Inspired by Eclipse Theia's LanguageModelMessage, ReasoningLevel,
 * ReasoningSettings, and ReasoningSupport types.
 *
 * @see https://github.com/eclipse-theia/theia/blob/master/packages/ai-core/src/common/language-model.ts
 */

// ── Reasoning types ──────────────────────────────────────────────────────────

/** Reasoning effort levels supported across providers */
export type ReasoningLevel = "off" | "minimal" | "low" | "medium" | "high" | "auto"

/** The API mechanism a provider uses to control reasoning */
export type ReasoningApi = "effort" | "budget"

/** Settings for a single chat request */
export interface ReasoningSettings {
	level: ReasoningLevel
}

/** Describes what reasoning levels a provider supports */
export interface ReasoningSupport {
	supportedLevels: ReadonlyArray<ReasoningLevel>
	defaultLevel?: ReasoningLevel
}

// ── Language model message types ─────────────────────────────────────────────

export type LanguageModelMessageRole = "system" | "user" | "assistant" | "tool"

export interface TextMessage {
	role: LanguageModelMessageRole
	type: "text"
	text: string
}

export interface ToolUseMessage {
	role: "assistant"
	type: "tool_use"
	name: string
	id: string
	input: Record<string, unknown>
}

export interface ToolResultMessage {
	role: "tool"
	type: "tool_result"
	toolUseId: string
	content: string
	isError?: boolean
}

export interface ImageMessage {
	role: "user"
	type: "image"
	source: {
		type: "base64" | "url"
		mediaType: string
		data: string
	}
}

export type LanguageModelMessage = TextMessage | ToolUseMessage | ToolResultMessage | ImageMessage

// ── Chat options ─────────────────────────────────────────────────────────────

export interface ChatOptions {
	model?: string
	temperature?: number
	maxTokens?: number
	reasoning?: ReasoningSettings
	signal?: AbortSignal
}

export interface ChatResponse {
	content: string
	finishReason: "stop" | "length" | "error"
	usage?: {
		promptTokens: number
		completionTokens: number
		totalTokens: number
	}
}

// ── Provider interface ───────────────────────────────────────────────────────

export interface LanguageModelProvider {
	id: string
	name: string
	capabilities: string[]
	reasoning?: ReasoningSupport
	chat(messages: LanguageModelMessage[], options?: ChatOptions): Promise<ChatResponse>
}

// ── Provider selector ────────────────────────────────────────────────────────

export interface ProviderSelector {
	taskType?: string
	requiredCapabilities?: string[]
	preferredProvider?: string
	reasoningLevel?: ReasoningLevel
}
