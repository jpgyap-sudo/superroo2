import type { ModelInfo } from "../model.js"

// https://platform.deepseek.com/docs/api
// preserveReasoning enables interleaved thinking mode for tool calls:
// DeepSeek requires reasoning_content to be passed back during tool call
// continuation within the same turn. See: https://api-docs.deepseek.com/guides/thinking_mode
export type DeepSeekModelId = keyof typeof deepSeekModels

export const deepSeekDefaultModelId: DeepSeekModelId = "deepseek-chat"

export const deepSeekModels = {
	"deepseek-chat": {
		maxTokens: 8192, // 8K max output
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0.28, // $0.28 per million tokens (cache miss) - Updated Dec 9, 2025
		outputPrice: 0.42, // $0.42 per million tokens - Updated Dec 9, 2025
		cacheWritesPrice: 0.28, // $0.28 per million tokens (cache miss) - Updated Dec 9, 2025
		cacheReadsPrice: 0.028, // $0.028 per million tokens (cache hit) - Updated Dec 9, 2025
		description: `DeepSeek-V3.2 (Non-thinking Mode) achieves a significant breakthrough in inference speed over previous models. It tops the leaderboard among open-source models and rivals the most advanced closed-source models globally. Supports JSON output, tool calls, chat prefix completion (beta), and FIM completion (beta).`,
	},
	"deepseek-reasoner": {
		maxTokens: 8192, // 8K max output
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: true,
		preserveReasoning: true,
		inputPrice: 0.28, // $0.28 per million tokens (cache miss) - Updated Dec 9, 2025
		outputPrice: 0.42, // $0.42 per million tokens - Updated Dec 9, 2025
		cacheWritesPrice: 0.28, // $0.28 per million tokens (cache miss) - Updated Dec 9, 2025
		cacheReadsPrice: 0.028, // $0.028 per million tokens (cache hit) - Updated Dec 9, 2025
		description: `DeepSeek-V3.2 (Thinking Mode) achieves performance comparable to OpenAI-o1 across math, code, and reasoning tasks. Supports Chain of Thought reasoning with up to 8K output tokens. Supports JSON output, tool calls, and chat prefix completion (beta).`,
	},
	"deepseek-chat-v4-flash": {
		maxTokens: 8192, // 8K max output
		contextWindow: 64_000, // Smaller context = cheaper/faster
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0.15, // $0.15 per million tokens — cheaper than V3.2
		outputPrice: 0.25, // $0.25 per million tokens — cheaper than V3.2
		cacheWritesPrice: 0.15, // $0.15 per million tokens (cache miss)
		cacheReadsPrice: 0.015, // $0.015 per million tokens (cache hit)
		description: `DeepSeek-V4-Flash — Cheaper, faster worker model optimized for simple coding, summaries, extraction, routing, compliance checks, Telegram replies, and bulk agent tasks. 64K context window for lower latency.`,
	},
	"deepseek-chat-v4-pro": {
		maxTokens: 8192, // 8K max output
		contextWindow: 128_000, // Full context for complex reasoning
		supportsImages: false,
		supportsPromptCache: true,
		preserveReasoning: true, // Supports thinking mode for complex reasoning
		inputPrice: 0.55, // $0.55 per million tokens — stronger but more expensive
		outputPrice: 0.85, // $0.85 per million tokens — stronger but more expensive
		cacheWritesPrice: 0.55, // $0.55 per million tokens (cache miss)
		cacheReadsPrice: 0.055, // $0.055 per million tokens (cache hit)
		description: `DeepSeek-V4-Pro — Stronger, slower expert model optimized for hard debugging, architecture, complex coding, long reasoning, final review, and important decisions. Full 128K context with thinking mode support.`,
	},
} as const satisfies Record<string, ModelInfo>

// https://api-docs.deepseek.com/quick_start/parameter_settings
export const DEEP_SEEK_DEFAULT_TEMPERATURE = 0.3
