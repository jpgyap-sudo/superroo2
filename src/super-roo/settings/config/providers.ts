/**
 * Provider configurations for the SuperRoo settings system.
 *
 * Defines the known AI providers with their display names, models,
 * cost info, and capabilities.
 */

export interface ProviderModel {
	id: string
	name: string
	costPer1kInput: number
	costPer1kOutput: number
	contextWindow: number
}

export interface ProviderConfig {
	id: string
	name: string
	description: string
	website: string
	docsUrl: string
	apiBaseUrl: string
	models: ProviderModel[]
	capabilities: string[]
	enabled: boolean
}

export const PROVIDERS: ProviderConfig[] = [
	{
		id: "openai",
		name: "OpenAI",
		description: "GPT-4o, GPT-4o-mini, and o-series models",
		website: "https://openai.com",
		docsUrl: "https://platform.openai.com/docs",
		apiBaseUrl: "https://api.openai.com/v1",
		models: [
			{ id: "gpt-4o", name: "GPT-4o", costPer1kInput: 0.0025, costPer1kOutput: 0.01, contextWindow: 128000 },
			{
				id: "gpt-4o-mini",
				name: "GPT-4o Mini",
				costPer1kInput: 0.00015,
				costPer1kOutput: 0.0006,
				contextWindow: 128000,
			},
			{ id: "o3-mini", name: "o3-mini", costPer1kInput: 0.0011, costPer1kOutput: 0.0044, contextWindow: 200000 },
		],
		capabilities: ["chat", "vision", "function-calling", "structured-output"],
		enabled: true,
	},
	{
		id: "anthropic",
		name: "Anthropic",
		description: "Claude Sonnet 4, Haiku 3.5, and Opus models",
		website: "https://anthropic.com",
		docsUrl: "https://docs.anthropic.com",
		apiBaseUrl: "https://api.anthropic.com/v1",
		models: [
			{
				id: "claude-sonnet-4-20250514",
				name: "Claude Sonnet 4",
				costPer1kInput: 0.003,
				costPer1kOutput: 0.015,
				contextWindow: 200000,
			},
			{
				id: "claude-3-5-haiku-20241022",
				name: "Claude 3.5 Haiku",
				costPer1kInput: 0.0008,
				costPer1kOutput: 0.004,
				contextWindow: 200000,
			},
		],
		capabilities: ["chat", "vision", "function-calling", "extended-thinking"],
		enabled: true,
	},
	{
		id: "deepseek",
		name: "DeepSeek",
		description: "DeepSeek V3, V4 Flash, V4 Pro, and R1 reasoning models",
		website: "https://deepseek.com",
		docsUrl: "https://platform.deepseek.com/docs",
		apiBaseUrl: "https://api.deepseek.com/v1",
		models: [
			{
				id: "deepseek-chat",
				name: "DeepSeek V3",
				costPer1kInput: 0.00027,
				costPer1kOutput: 0.0011,
				contextWindow: 64000,
			},
			{
				id: "deepseek-reasoner",
				name: "DeepSeek R1",
				costPer1kInput: 0.00055,
				costPer1kOutput: 0.00219,
				contextWindow: 64000,
			},
			{
				id: "deepseek-chat-v4-flash",
				name: "DeepSeek V4 Flash",
				costPer1kInput: 0.00015,
				costPer1kOutput: 0.00025,
				contextWindow: 64000,
			},
			{
				id: "deepseek-chat-v4-pro",
				name: "DeepSeek V4 Pro",
				costPer1kInput: 0.00055,
				costPer1kOutput: 0.00085,
				contextWindow: 128000,
			},
		],
		capabilities: ["chat", "reasoning"],
		enabled: true,
	},
	{
		id: "kimi",
		name: "Kimi (Moonshot)",
		description: "Moonshot AI's Kimi models",
		website: "https://moonshot.cn",
		docsUrl: "https://platform.moonshot.cn/docs",
		apiBaseUrl: "https://api.moonshot.cn/v1",
		models: [
			{
				id: "kimi-latest",
				name: "Kimi Latest",
				costPer1kInput: 0.001,
				costPer1kOutput: 0.002,
				contextWindow: 128000,
			},
		],
		capabilities: ["chat", "vision"],
		enabled: true,
	},
	{
		id: "openrouter",
		name: "OpenRouter",
		description: "Unified API for 200+ models across providers",
		website: "https://openrouter.ai",
		docsUrl: "https://openrouter.ai/docs",
		apiBaseUrl: "https://openrouter.ai/api/v1",
		models: [
			{
				id: "openrouter/auto",
				name: "Auto (best model)",
				costPer1kInput: 0,
				costPer1kOutput: 0,
				contextWindow: 128000,
			},
		],
		capabilities: ["chat", "vision", "function-calling", "multi-provider"],
		enabled: true,
	},
	{
		id: "groq",
		name: "Groq",
		description: "Fast inference on open-source models (Llama, Mixtral)",
		website: "https://groq.com",
		docsUrl: "https://console.groq.com/docs",
		apiBaseUrl: "https://api.groq.com/openai/v1",
		models: [
			{
				id: "llama-3.3-70b-versatile",
				name: "Llama 3.3 70B",
				costPer1kInput: 0.00059,
				costPer1kOutput: 0.00079,
				contextWindow: 128000,
			},
			{
				id: "mixtral-8x7b-32768",
				name: "Mixtral 8x7B",
				costPer1kInput: 0.00024,
				costPer1kOutput: 0.00024,
				contextWindow: 32768,
			},
		],
		capabilities: ["chat", "fast-inference"],
		enabled: true,
	},
]
