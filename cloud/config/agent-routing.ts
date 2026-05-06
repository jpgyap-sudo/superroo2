/**
 * Agent routing configuration for SuperRoo.
 *
 * Defines which provider/model each agent uses as primary and fallback.
 * Routes are validated against provider availability before deployment.
 *
 * @see cloud/api/api.js — Runtime routing (source of truth for API)
 * @see cloud/dashboard/src/components/views/api-keys.tsx — Dashboard UI
 */

export type AgentName = "planner" | "coder" | "debugger" | "crawler" | "tester" | "deployChecker"

export type AgentRoute = {
	agent: AgentName
	label: string
	primary: {
		provider: string
		model: string
	}
	fallbacks: Array<{
		provider: string
		model: string
	}>
	requiredCapabilities: string[]
}

export const DEFAULT_AGENT_ROUTES: AgentRoute[] = [
	{
		agent: "planner",
		label: "Planner",
		primary: { provider: "openai", model: "gpt-4o" },
		fallbacks: [
			{ provider: "anthropic", model: "claude-sonnet-4-20250514" },
			{ provider: "deepseek", model: "deepseek-chat" },
		],
		requiredCapabilities: ["reasoning", "long_context"],
	},
	{
		agent: "coder",
		label: "Coder",
		primary: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
		fallbacks: [
			{ provider: "openai", model: "gpt-4o" },
			{ provider: "deepseek", model: "deepseek-chat" },
		],
		requiredCapabilities: ["code"],
	},
	{
		agent: "debugger",
		label: "Debugger",
		primary: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
		fallbacks: [
			{ provider: "openai", model: "gpt-4o" },
			{ provider: "deepseek", model: "deepseek-chat" },
		],
		requiredCapabilities: ["code", "reasoning"],
	},
	{
		agent: "crawler",
		label: "Crawler",
		primary: { provider: "openai", model: "gpt-4o-mini" },
		fallbacks: [
			{ provider: "groq", model: "llama-3.3-70b-versatile" },
			{ provider: "deepseek", model: "deepseek-chat" },
		],
		requiredCapabilities: ["tool_use"],
	},
	{
		agent: "tester",
		label: "Tester",
		primary: { provider: "openai", model: "gpt-4o-mini" },
		fallbacks: [
			{ provider: "groq", model: "llama-3.3-70b-versatile" },
			{ provider: "deepseek", model: "deepseek-chat" },
		],
		requiredCapabilities: ["code", "tool_use"],
	},
	{
		agent: "deployChecker",
		label: "Deploy Checker",
		primary: { provider: "openai", model: "gpt-4o-mini" },
		fallbacks: [
			{ provider: "groq", model: "llama-3.3-70b-versatile" },
			{ provider: "deepseek", model: "deepseek-chat" },
		],
		requiredCapabilities: ["reasoning", "tool_use"],
	},
]
