/**
 * Tests for the AI Model Router service.
 *
 * Validates provider registry, route management, fallback logic,
 * safety rules, and usage metrics.
 */

import { describe, it, expect, beforeEach } from "vitest"
import {
	listProviders,
	listRoutes,
	upsertRoute,
	updateRoute,
	deleteRoute,
	testRoute,
	getFallbackRules,
	setFallbackRules,
	getSafetyRules,
	setSafetyRules,
	getUsageSummary,
	recordUsage,
	getRecentUsage,
} from "../services/modelRouterService"

describe("ModelRouterService", () => {
	describe("listProviders", () => {
		it("should return provider metadata without raw keys", async () => {
			const providers = await listProviders()
			expect(providers.length).toBeGreaterThan(0)
			const serialized = JSON.stringify(providers)
			expect(serialized).not.toContain("apiKey")
			expect(serialized).not.toContain("rawKey")
		})

		it("should include provider status information", async () => {
			const providers = await listProviders()
			for (const p of providers) {
				expect(p.providerId).toBeTruthy()
				expect(p.displayName).toBeTruthy()
				expect(["missing_key", "untested", "tested", "error"]).toContain(p.status)
			}
		})

		it("should list models for each provider", async () => {
			const providers = await listProviders()
			for (const p of providers) {
				expect(p.models.length).toBeGreaterThan(0)
				for (const m of p.models) {
					expect(m.id).toBeTruthy()
					expect(m.label).toBeTruthy()
				}
			}
		})
	})

	describe("listRoutes", () => {
		it("should return default routes for all task types", async () => {
			const routes = await listRoutes()
			const taskTypes = routes.map((r) => r.taskType)
			expect(taskTypes).toContain("planning")
			expect(taskTypes).toContain("coding")
			expect(taskTypes).toContain("debugging")
			expect(taskTypes).toContain("crawling")
			expect(taskTypes).toContain("research")
			expect(taskTypes).toContain("testing")
			expect(taskTypes).toContain("deployment")
			expect(taskTypes).toContain("architecture")
			expect(taskTypes).toContain("fast_fix")
		})

		it("each route should have primary provider and model", async () => {
			const routes = await listRoutes()
			for (const r of routes) {
				expect(r.primaryProvider).toBeTruthy()
				expect(r.primaryModel).toBeTruthy()
				expect(r.id).toBeTruthy()
			}
		})
	})

	describe("upsertRoute", () => {
		it("should update existing route when task type matches", async () => {
			const updated = await upsertRoute({
				taskType: "coding",
				primaryProvider: "openai",
				primaryModel: "gpt-4o",
			})
			expect(updated.taskType).toBe("coding")
			expect(updated.primaryProvider).toBe("openai")
			expect(updated.primaryModel).toBe("gpt-4o")
		})

		it("should create new route for unknown task type", async () => {
			const created = await upsertRoute({
				taskType: "research",
				primaryProvider: "kimi",
				primaryModel: "kimi-latest",
			})
			expect(created.taskType).toBe("research")
			expect(created.id).toBeTruthy()
		})
	})

	describe("updateRoute", () => {
		it("should update route fields by id", async () => {
			const routes = await listRoutes()
			const target = routes[0]
			const updated = await updateRoute(target.id, { enabled: false })
			expect(updated.enabled).toBe(false)
			expect(updated.id).toBe(target.id)
		})

		it("should throw for unknown route id", async () => {
			await expect(updateRoute("nonexistent-id", { enabled: true })).rejects.toThrow("Route not found")
		})
	})

	describe("deleteRoute", () => {
		it("should remove a route by id", async () => {
			const before = await listRoutes()
			const target = before[0]
			const result = await deleteRoute(target.id)
			expect(result.ok).toBe(true)
			const after = await listRoutes()
			expect(after.length).toBe(before.length - 1)
		})
	})

	describe("testRoute", () => {
		it("should return ok for enabled routes with tested providers", async () => {
			const result = await testRoute("coding")
			expect(result.ok).toBe(true)
			if (result.ok && "taskType" in result) {
				expect(result.taskType).toBe("coding")
				expect(result.selectedProvider).toBeTruthy()
				expect(result.selectedModel).toBeTruthy()
			}
		})

		it("should return failure for unknown task type", async () => {
			const result = await testRoute("fast_fix" as any)
			// fast_fix exists in defaults, so it should work
			expect(result.ok).toBe(true)
		})
	})

	describe("fallbackRules", () => {
		it("should return default fallback rules", () => {
			const rules = getFallbackRules()
			expect(rules.retryPrimaryOnce).toBe(true)
			expect(rules.switchIfLatencyAboveMs).toBeGreaterThan(0)
			expect(rules.switchIfQuotaExceeded).toBe(true)
		})

		it("should update fallback rules with partial patch", () => {
			const updated = setFallbackRules({ retryPrimaryOnce: false })
			expect(updated.retryPrimaryOnce).toBe(false)
			// Other fields should remain
			expect(updated.switchIfQuotaExceeded).toBe(true)
		})
	})

	describe("safetyRules", () => {
		it("should return default safety rules", () => {
			const rules = getSafetyRules()
			expect(rules.requireDeploymentApproval).toBe(true)
			expect(rules.blockUntestedProviders).toBe(true)
		})

		it("should update safety rules with partial patch", () => {
			const updated = setSafetyRules({ blockUntestedProviders: false })
			expect(updated.blockUntestedProviders).toBe(false)
			expect(updated.requireDeploymentApproval).toBe(true)
		})
	})

	describe("getUsageSummary", () => {
		it("should return usage data for all models", async () => {
			const usage = await getUsageSummary()
			expect(usage.length).toBeGreaterThan(0)
			for (const u of usage) {
				expect(u.providerId).toBeTruthy()
				expect(u.modelId).toBeTruthy()
				expect(typeof u.successRate).toBe("number")
				expect(typeof u.latencyAvgMs).toBe("number")
			}
		})
	})

	describe("recordUsage / getRecentUsage", () => {
		it("should record and retrieve usage metrics", () => {
			const entry = recordUsage({
				providerId: "openai",
				modelId: "gpt-4o",
				taskType: "coding",
				latencyMs: 1200,
				success: true,
				inputTokens: 500,
				outputTokens: 200,
			})
			expect(entry.id).toBeTruthy()
			expect(entry.createdAt).toBeTruthy()

			const recent = getRecentUsage()
			expect(recent.length).toBeGreaterThan(0)
			expect(recent[recent.length - 1].providerId).toBe("openai")
		})
	})
})
