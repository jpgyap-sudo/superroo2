/**
 * Tests for the ModelRouter service.
 *
 * Validates agent-to-provider routing with fallback logic,
 * default route definitions, and route validation.
 */

import { describe, it, expect } from "vitest"
import {
	getRouteForAgent,
	validateRoutes,
	DEFAULT_AGENT_ROUTES,
	type AgentRoute,
	type AgentName,
	type ProviderAvailability,
} from "../services/modelRouter"

describe("modelRouter", () => {
	describe("DEFAULT_AGENT_ROUTES", () => {
		it("should define routes for all 6 agents", () => {
			const agents = DEFAULT_AGENT_ROUTES.map((r) => r.agent)
			expect(agents).toContain("planner")
			expect(agents).toContain("coder")
			expect(agents).toContain("debugger")
			expect(agents).toContain("crawler")
			expect(agents).toContain("tester")
			expect(agents).toContain("deployChecker")
			expect(agents.length).toBe(6)
		})

		it("each route should have a primary provider and at least one fallback", () => {
			for (const route of DEFAULT_AGENT_ROUTES) {
				expect(route.primary.provider).toBeTruthy()
				expect(route.primary.model).toBeTruthy()
				expect(route.fallbacks.length).toBeGreaterThanOrEqual(1)
			}
		})
	})

	describe("getRouteForAgent", () => {
		const routes: AgentRoute[] = [
			{
				agent: "planner",
				primary: { provider: "openai", model: "gpt-4o" },
				fallbacks: [
					{ provider: "anthropic", model: "claude-sonnet-4-20250514" },
					{ provider: "deepseek", model: "deepseek-chat" },
				],
			},
			{
				agent: "coder",
				primary: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
				fallbacks: [{ provider: "openai", model: "gpt-4o" }],
			},
		]

		it("should return primary when available", () => {
			const availability: ProviderAvailability = { openai: true, anthropic: true }
			const result = getRouteForAgent("planner", routes, availability)
			expect(result).not.toBeNull()
			expect(result!.provider).toBe("openai")
			expect(result!.model).toBe("gpt-4o")
			expect(result!.usedFallback).toBe(false)
			expect(result!.fallbackIndex).toBe(-1)
		})

		it("should fall back when primary is unavailable", () => {
			const availability: ProviderAvailability = { openai: false, anthropic: true }
			const result = getRouteForAgent("planner", routes, availability)
			expect(result).not.toBeNull()
			expect(result!.provider).toBe("anthropic")
			expect(result!.usedFallback).toBe(true)
			expect(result!.fallbackIndex).toBe(0)
		})

		it("should fall back to second fallback when first is unavailable", () => {
			const availability: ProviderAvailability = { openai: false, anthropic: false, deepseek: true }
			const result = getRouteForAgent("planner", routes, availability)
			expect(result).not.toBeNull()
			expect(result!.provider).toBe("deepseek")
			expect(result!.usedFallback).toBe(true)
			expect(result!.fallbackIndex).toBe(1)
		})

		it("should return null when no provider is available", () => {
			const availability: ProviderAvailability = { openai: false, anthropic: false, deepseek: false }
			const result = getRouteForAgent("planner", routes, availability)
			expect(result).toBeNull()
		})

		it("should return null for unknown agent", () => {
			const availability: ProviderAvailability = { openai: true }
			const result = getRouteForAgent("deployChecker" as AgentName, routes, availability)
			expect(result).toBeNull()
		})

		it("should handle empty fallbacks array", () => {
			const singleRoute: AgentRoute[] = [
				{
					agent: "tester",
					primary: { provider: "groq", model: "llama-3.3-70b-versatile" },
					fallbacks: [],
				},
			]
			const availability: ProviderAvailability = { groq: false }
			const result = getRouteForAgent("tester", singleRoute, availability)
			expect(result).toBeNull()
		})
	})

	describe("validateRoutes", () => {
		const routes: AgentRoute[] = [
			{
				agent: "planner",
				primary: { provider: "openai", model: "gpt-4o" },
				fallbacks: [{ provider: "anthropic", model: "claude-sonnet-4-20250514" }],
			},
			{
				agent: "coder",
				primary: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
				fallbacks: [],
			},
		]

		it("should return empty unreachable when all agents have available providers", () => {
			const availability: ProviderAvailability = { openai: true, anthropic: true }
			const unreachable = validateRoutes(routes, availability)
			expect(unreachable).toEqual([])
		})

		it("should return unreachable agents when no provider is available", () => {
			const availability: ProviderAvailability = { openai: false, anthropic: false }
			const unreachable = validateRoutes(routes, availability)
			expect(unreachable).toContain("planner")
			expect(unreachable).toContain("coder")
		})

		it("should return only the agents that are unreachable", () => {
			const availability: ProviderAvailability = { openai: true, anthropic: false }
			const unreachable = validateRoutes(routes, availability)
			expect(unreachable).not.toContain("planner")
			expect(unreachable).toContain("coder")
		})

		it("should handle empty routes array", () => {
			const unreachable = validateRoutes([], {})
			expect(unreachable).toEqual([])
		})
	})
})
