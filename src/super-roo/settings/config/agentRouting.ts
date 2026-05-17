/**
 * Agent routing configuration.
 *
 * Maps each SuperRoo agent type to a primary provider/model and fallback options.
 * This is the configuration that users can customize in the Advanced VPS Settings.
 */

export type AgentName = "planner" | "coder" | "debugger" | "crawler" | "tester" | "deployChecker"

export interface AgentRoute {
	agent: AgentName
	label: string
	primary: { provider: string; model: string }
	fallbacks: Array<{ provider: string; model: string }>
}

export const DEFAULT_AGENT_ROUTES: AgentRoute[] = [
	{
		agent: "planner",
		label: "Planner",
		primary: { provider: "deepseek", model: "deepseek-chat-v4-pro" },
		fallbacks: [
			{ provider: "openai", model: "gpt-4o" },
			{ provider: "anthropic", model: "claude-sonnet-4-20250514" },
		],
	},
	{
		agent: "coder",
		label: "Coder",
		primary: { provider: "deepseek", model: "deepseek-chat-v4-flash" },
		fallbacks: [
			{ provider: "anthropic", model: "claude-sonnet-4-20250514" },
			{ provider: "openai", model: "gpt-4o" },
		],
	},
	{
		agent: "debugger",
		label: "Debugger",
		primary: { provider: "deepseek", model: "deepseek-chat-v4-pro" },
		fallbacks: [
			{ provider: "anthropic", model: "claude-sonnet-4-20250514" },
			{ provider: "openai", model: "gpt-4o" },
		],
	},
	{
		agent: "crawler",
		label: "Crawler",
		primary: { provider: "deepseek", model: "deepseek-chat-v4-flash" },
		fallbacks: [
			{ provider: "groq", model: "llama-3.3-70b-versatile" },
			{ provider: "openai", model: "gpt-4o-mini" },
		],
	},
	{
		agent: "tester",
		label: "Tester",
		primary: { provider: "deepseek", model: "deepseek-chat-v4-flash" },
		fallbacks: [
			{ provider: "groq", model: "llama-3.3-70b-versatile" },
			{ provider: "openai", model: "gpt-4o-mini" },
		],
	},
	{
		agent: "deployChecker",
		label: "Deploy Checker",
		primary: { provider: "deepseek", model: "deepseek-chat-v4-pro" },
		fallbacks: [
			{ provider: "groq", model: "llama-3.3-70b-versatile" },
			{ provider: "openai", model: "gpt-4o-mini" },
		],
	},
]
