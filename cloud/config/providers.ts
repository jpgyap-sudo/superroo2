/**
 * Provider definitions for SuperRoo API settings.
 *
 * This config defines all supported LLM providers, their models,
 * capabilities, and default settings. Used by the API Keys panel
 * and agent routing system.
 *
 * @see cloud/api/api.js — Runtime provider definitions (source of truth for API)
 * @see cloud/dashboard/src/components/views/api-keys.tsx — Dashboard UI
 */

export type ProviderStatus = "missing" | "connected" | "invalid" | "not_tested"

export type ProviderModel = {
	id: string
	label: string
	contextWindow: number
	supportsImages: boolean
	supportsTools: boolean
	inputCostPerMTok: number
	outputCostPerMTok: number
	bestFor: string[]
}

export type ProviderConfig = {
	id: string
	name: string
	envName: string
	docsUrl: string
	status: ProviderStatus
	maskedKey?: string
	defaultModel: string
	models: ProviderModel[]
}

export const PROVIDERS: ProviderConfig[] = [
	{
		id: "deepseek",
		name: "DeepSeek",
		envName: "DEEPSEEK_API_KEY",
		docsUrl: "https://api-docs.deepseek.com/",
		status: "missing",
		defaultModel: "deepseek-chat",
		models: [
			{
				id: "deepseek-chat",
				label: "deepseek-chat",
				contextWindow: 128000,
				supportsImages: false,
				supportsTools: true,
				inputCostPerMTok: 0.28,
				outputCostPerMTok: 0.42,
				bestFor: ["cheap coding", "debugging", "crawler repair"],
			},
		],
	},
	{
		id: "kimi",
		name: "Kimi / Moonshot",
		envName: "MOONSHOT_API_KEY",
		docsUrl: "https://platform.moonshot.ai/docs",
		status: "missing",
		defaultModel: "kimi-k2",
		models: [
			{
				id: "kimi-k2",
				label: "kimi-k2",
				contextWindow: 128000,
				supportsImages: false,
				supportsTools: true,
				inputCostPerMTok: 0,
				outputCostPerMTok: 0,
				bestFor: ["long context", "planning", "architecture"],
			},
		],
	},
	{
		id: "openai",
		name: "OpenAI",
		envName: "OPENAI_API_KEY",
		docsUrl: "https://platform.openai.com/docs",
		status: "missing",
		defaultModel: "gpt-4o",
		models: [
			{
				id: "gpt-4o",
				label: "GPT-4o",
				contextWindow: 128000,
				supportsImages: true,
				supportsTools: true,
				inputCostPerMTok: 2.5,
				outputCostPerMTok: 10,
				bestFor: ["planning", "orchestration", "reasoning"],
			},
		],
	},
	{
		id: "anthropic",
		name: "Anthropic Claude",
		envName: "ANTHROPIC_API_KEY",
		docsUrl: "https://docs.anthropic.com/",
		status: "missing",
		defaultModel: "claude-sonnet-4-20250514",
		models: [
			{
				id: "claude-sonnet-4-20250514",
				label: "Claude Sonnet 4",
				contextWindow: 200000,
				supportsImages: true,
				supportsTools: true,
				inputCostPerMTok: 3,
				outputCostPerMTok: 15,
				bestFor: ["UI debugging", "frontend review", "code review"],
			},
		],
	},
	{
		id: "openrouter",
		name: "OpenRouter",
		envName: "OPENROUTER_API_KEY",
		docsUrl: "https://openrouter.ai/docs",
		status: "missing",
		defaultModel: "openrouter/auto",
		models: [
			{
				id: "openrouter/auto",
				label: "Auto Router",
				contextWindow: 128000,
				supportsImages: true,
				supportsTools: true,
				inputCostPerMTok: 0,
				outputCostPerMTok: 0,
				bestFor: ["fallback routing", "multi-model access"],
			},
		],
	},
	{
		id: "groq",
		name: "Groq",
		envName: "GROQ_API_KEY",
		docsUrl: "https://console.groq.com/docs",
		status: "missing",
		defaultModel: "llama-3.3-70b-versatile",
		models: [
			{
				id: "llama-3.3-70b-versatile",
				label: "Llama 3.3 70B",
				contextWindow: 32768,
				supportsImages: false,
				supportsTools: true,
				inputCostPerMTok: 0,
				outputCostPerMTok: 0,
				bestFor: ["fast classification", "summaries", "cheap small tasks"],
			},
		],
	},
]
