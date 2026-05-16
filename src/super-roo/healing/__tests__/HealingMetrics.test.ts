/**
 * Tests for the HealingMetrics module.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"

import { HealingMetrics } from "../HealingMetrics"
import type { RepairPlan, RootCauseCategory } from "../../types"

describe("HealingMetrics", () => {
	let metrics: HealingMetrics
	let tempDir: string
	let persistPath: string

	const createMockPlan = (category: RootCauseCategory): RepairPlan => ({
		incidentId: "inc_test",
		featureKey: null,
		severity: "medium",
		rootCauseCategory: category,
		affectedFiles: ["src/test.ts"],
		diagnosticSteps: ["Check logs"],
		safePatchPlan: ["Apply fix"],
		testsToRun: ["npx vitest run"],
		approvalRequired: false,
		executionStatus: "pending",
	})

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "healing-metrics-test-"))
		persistPath = path.join(tempDir, "healing-metrics.json")
		metrics = new HealingMetrics({ persistPath, autoPersist: false })
	})

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true })
	})

	describe("recordOutcome", () => {
		it("should record a successful outcome", () => {
			const plan = createMockPlan("ENV_MISSING")
			metrics.recordOutcome("inc_1", "ENV_MISSING", true, plan)

			expect(metrics.getTotalAttempts()).toBe(1)
			expect(metrics.getTotalSuccesses()).toBe(1)
			expect(metrics.getTotalFailures()).toBe(0)
		})

		it("should record a failed outcome", () => {
			const plan = createMockPlan("DB_SCHEMA_MISMATCH")
			metrics.recordOutcome("inc_2", "DB_SCHEMA_MISMATCH", false, plan)

			expect(metrics.getTotalAttempts()).toBe(1)
			expect(metrics.getTotalSuccesses()).toBe(0)
			expect(metrics.getTotalFailures()).toBe(1)
		})

		it("should track multiple outcomes for the same category", () => {
			const plan = createMockPlan("MEMORY_LEAK")

			metrics.recordOutcome("inc_1", "MEMORY_LEAK", true, plan)
			metrics.recordOutcome("inc_2", "MEMORY_LEAK", false, plan)
			metrics.recordOutcome("inc_3", "MEMORY_LEAK", true, plan)

			const catMetrics = metrics.getCategoryMetrics("MEMORY_LEAK")
			expect(catMetrics.successCount).toBe(2)
			expect(catMetrics.failureCount).toBe(1)
			expect(catMetrics.totalAttempts).toBe(3)
		})

		it("should track outcomes across different categories", () => {
			const plan1 = createMockPlan("ENV_MISSING")
			const plan2 = createMockPlan("NETWORK_TIMEOUT")

			metrics.recordOutcome("inc_1", "ENV_MISSING", true, plan1)
			metrics.recordOutcome("inc_2", "ENV_MISSING", false, plan1)
			metrics.recordOutcome("inc_3", "NETWORK_TIMEOUT", true, plan2)

			expect(metrics.getCategoryMetrics("ENV_MISSING").successCount).toBe(1)
			expect(metrics.getCategoryMetrics("ENV_MISSING").failureCount).toBe(1)
			expect(metrics.getCategoryMetrics("NETWORK_TIMEOUT").successCount).toBe(1)
			expect(metrics.getCategoryMetrics("NETWORK_TIMEOUT").failureCount).toBe(0)
		})
	})

	describe("getSuccessRate", () => {
		it("should return 0 for categories with no attempts", () => {
			const rate = metrics.getSuccessRate("ENV_MISSING")
			expect(rate).toBe(0)
		})

		it("should calculate correct success rate", () => {
			const plan = createMockPlan("ENV_MISSING")

			metrics.recordOutcome("inc_1", "ENV_MISSING", true, plan)
			metrics.recordOutcome("inc_2", "ENV_MISSING", true, plan)
			metrics.recordOutcome("inc_3", "ENV_MISSING", false, plan)

			const rate = metrics.getSuccessRate("ENV_MISSING")
			expect(rate).toBeCloseTo(2 / 3)
		})

		it("should return 1.0 for all successes", () => {
			const plan = createMockPlan("API_RATE_LIMIT")

			metrics.recordOutcome("inc_1", "API_RATE_LIMIT", true, plan)
			metrics.recordOutcome("inc_2", "API_RATE_LIMIT", true, plan)

			expect(metrics.getSuccessRate("API_RATE_LIMIT")).toBe(1)
		})

		it("should return 0 for all failures", () => {
			const plan = createMockPlan("WORKER_CRASH")

			metrics.recordOutcome("inc_1", "WORKER_CRASH", false, plan)
			metrics.recordOutcome("inc_2", "WORKER_CRASH", false, plan)

			expect(metrics.getSuccessRate("WORKER_CRASH")).toBe(0)
		})
	})

	describe("getOverallSuccessRate", () => {
		it("should return 0 when no attempts recorded", () => {
			expect(metrics.getOverallSuccessRate()).toBe(0)
		})

		it("should calculate overall rate across all categories", () => {
			const plan1 = createMockPlan("ENV_MISSING")
			const plan2 = createMockPlan("DB_SCHEMA_MISMATCH")

			metrics.recordOutcome("inc_1", "ENV_MISSING", true, plan1)
			metrics.recordOutcome("inc_2", "ENV_MISSING", true, plan1)
			metrics.recordOutcome("inc_3", "DB_SCHEMA_MISMATCH", false, plan2)

			expect(metrics.getOverallSuccessRate()).toBeCloseTo(2 / 3)
		})
	})

	describe("getPlanTypeSuccessRate", () => {
		it("should return 0 for plan types with no attempts", () => {
			expect(metrics.getPlanTypeSuccessRate("ENV_MISSING")).toBe(0)
		})

		it("should calculate rate for a specific plan type", () => {
			const plan = createMockPlan("ENV_MISSING")

			metrics.recordOutcome("inc_1", "ENV_MISSING", true, plan)
			metrics.recordOutcome("inc_2", "ENV_MISSING", false, plan)

			expect(metrics.getPlanTypeSuccessRate("ENV_MISSING")).toBeCloseTo(0.5)
		})
	})

	describe("getAllCategoryMetrics", () => {
		it("should return empty map when no outcomes recorded", () => {
			const all = metrics.getAllCategoryMetrics()
			expect(all.size).toBe(0)
		})

		it("should return all categories with recorded outcomes", () => {
			const plan1 = createMockPlan("ENV_MISSING")
			const plan2 = createMockPlan("MEMORY_LEAK")

			metrics.recordOutcome("inc_1", "ENV_MISSING", true, plan1)
			metrics.recordOutcome("inc_2", "MEMORY_LEAK", false, plan2)

			const all = metrics.getAllCategoryMetrics()
			expect(all.size).toBe(2)
			expect(all.get("ENV_MISSING")?.successCount).toBe(1)
			expect(all.get("MEMORY_LEAK")?.failureCount).toBe(1)
		})
	})

	describe("snapshot", () => {
		it("should return a snapshot of current metrics", () => {
			const plan = createMockPlan("ENV_MISSING")
			metrics.recordOutcome("inc_1", "ENV_MISSING", true, plan)

			const snapshot = metrics.snapshot()
			expect(snapshot.overall.totalAttempts).toBe(1)
			expect(snapshot.overall.successCount).toBe(1)
			expect(snapshot.byCategory["ENV_MISSING"]).toBeDefined()
			expect(snapshot.byCategory["ENV_MISSING"].successCount).toBe(1)
			expect(snapshot.lastUpdated).toBeGreaterThan(0)
		})
	})

	describe("persistence", () => {
		it("should persist and reload metrics", () => {
			const plan = createMockPlan("ENV_MISSING")
			metrics.recordOutcome("inc_1", "ENV_MISSING", true, plan)
			metrics.persist()

			// Create a new instance pointing to the same file
			const metrics2 = new HealingMetrics({ persistPath, autoPersist: false })
			expect(metrics2.getTotalAttempts()).toBe(1)
			expect(metrics2.getTotalSuccesses()).toBe(1)
			expect(metrics2.getSuccessRate("ENV_MISSING")).toBe(1)
		})

		it("should handle missing persist file gracefully", () => {
			const metrics2 = new HealingMetrics({ persistPath: "/nonexistent/path/metrics.json", autoPersist: false })
			expect(metrics2.getTotalAttempts()).toBe(0)
		})

		it("should handle corrupted persist file gracefully", () => {
			fs.writeFileSync(persistPath, "not valid json", "utf-8")
			const metrics2 = new HealingMetrics({ persistPath, autoPersist: false })
			expect(metrics2.getTotalAttempts()).toBe(0)
		})
	})

	describe("reset", () => {
		it("should clear all metrics", () => {
			const plan = createMockPlan("ENV_MISSING")
			metrics.recordOutcome("inc_1", "ENV_MISSING", true, plan)
			expect(metrics.getTotalAttempts()).toBe(1)

			metrics.reset()
			expect(metrics.getTotalAttempts()).toBe(0)
			expect(metrics.getOverallSuccessRate()).toBe(0)
		})
	})
})
