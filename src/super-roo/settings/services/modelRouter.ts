/**
 * Model Router — maps agents to provider/model pairs with fallback logic.
 *
 * Each agent can have a primary route and one or more fallback routes.
 * The router checks provider availability before returning a route.
 */

export type AgentName = "planner" | "coder" | "debugger" | "crawler" | "tester" | "deployChecker"

export interface AgentRoute {
	agent: AgentName
	primary: { provider: string; model: string }
	fallbacks: Array<{ provider: string; model: string }>
}

export interface RouteResult {
	provider: string
	model: string
	usedFallback: boolean
	fallbackIndex: number
}

export type ProviderAvailability = Record<string, boolean>

/**
 * Default agent-to-provider routes.
 * These are the recommended mappings for the SuperRoo agent system.
 */
export const DEFAULT_AGENT_ROUTES: AgentRoute[] = [
	{
		agent: "planner",
		primary: { provider: "deepseek", model: "deepseek-chat-v4-pro" },
		fallbacks: [
			{ provider: "openai", model: "gpt-4o" },
			{ provider: "anthropic", model: "claude-sonnet-4-20250514" },
		],
	},
	{
		agent: "coder",
		primary: { provider: "deepseek", model: "deepseek-chat-v4-flash" },
		fallbacks: [
			{ provider: "anthropic", model: "claude-sonnet-4-20250514" },
			{ provider: "openai", model: "gpt-4o" },
		],
	},
	{
		agent: "debugger",
		primary: { provider: "deepseek", model: "deepseek-chat-v4-pro" },
		fallbacks: [
			{ provider: "anthropic", model: "claude-sonnet-4-20250514" },
			{ provider: "openai", model: "gpt-4o" },
		],
	},
	{
		agent: "crawler",
		primary: { provider: "deepseek", model: "deepseek-chat-v4-flash" },
		fallbacks: [
			{ provider: "groq", model: "llama-3.3-70b-versatile" },
			{ provider: "openai", model: "gpt-4o-mini" },
		],
	},
	{
		agent: "tester",
		primary: { provider: "deepseek", model: "deepseek-chat-v4-flash" },
		fallbacks: [
			{ provider: "groq", model: "llama-3.3-70b-versatile" },
			{ provider: "openai", model: "gpt-4o-mini" },
		],
	},
	{
		agent: "deployChecker",
		primary: { provider: "deepseek", model: "deepseek-chat-v4-pro" },
		fallbacks: [
			{ provider: "groq", model: "llama-3.3-70b-versatile" },
			{ provider: "openai", model: "gpt-4o-mini" },
		],
	},
]

/**
 * Get the best available route for an agent.
 * Tries primary first, then falls back through the fallback list.
 * Returns null if no provider in the route is available.
 */
export function getRouteForAgent(
	agent: AgentName,
	routes: AgentRoute[],
	availability: ProviderAvailability,
): RouteResult | null {
	const route = routes.find((r) => r.agent === agent)
	if (!route) return null

	// Try primary
	if (availability[route.primary.provider]) {
		return { provider: route.primary.provider, model: route.primary.model, usedFallback: false, fallbackIndex: -1 }
	}

	// Try fallbacks
	for (let i = 0; i < route.fallbacks.length; i++) {
		const fb = route.fallbacks[i]
		if (availability[fb.provider]) {
			return { provider: fb.provider, model: fb.model, usedFallback: true, fallbackIndex: i }
		}
	}

	return null
}

/**
 * Validate a set of routes against current provider availability.
 * Returns a list of agents that have no available provider.
 */
export function validateRoutes(routes: AgentRoute[], availability: ProviderAvailability): AgentName[] {
	const unreachable: AgentName[] = []
	for (const route of routes) {
		const result = getRouteForAgent(route.agent, routes, availability)
		if (!result) {
			unreachable.push(route.agent)
		}
	}
	return unreachable
}
