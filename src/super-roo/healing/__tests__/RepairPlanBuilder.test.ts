/**
 * Tests for the RepairPlanBuilder module.
 *
 * Tests cover:
 * - buildRepairPlan with various categories
 * - Plan execution status tracking
 * - Severity to priority mapping
 * - Stack trace file extraction
 * - Plan summarization
 */

import { describe, it, expect } from "vitest"

import {
	buildRepairPlan,
	severityToPriority,
	summarizeRepairPlan,
	markPlanExecuted,
	markPlanInProgress,
	markPlanCancelled,
} from "../RepairPlanBuilder"
import type { IncidentRecord, RepairPlan } from "../../types"

describe("RepairPlanBuilder", () => {
	describe("buildRepairPlan", () => {
		it("should generate a plan for ENV_MISSING incidents", () => {
			const incident = createMockIncident({
				title: "Missing env variable",
				symptom: "SUPABASE_URL not found",
				affectedFiles: [".env"],
			})

			const plan = buildRepairPlan(incident, { rootCauseCategory: "ENV_MISSING" })
			expect(plan.rootCauseCategory).toBe("ENV_MISSING")
			expect(plan.diagnosticSteps.length).toBeGreaterThan(0)
			expect(plan.safePatchPlan.length).toBeGreaterThan(0)
			expect(plan.testsToRun.length).toBeGreaterThan(0)
			expect(plan.executionStatus).toBe("pending")
		})

		it("should generate a plan for DB_SCHEMA_MISMATCH incidents", () => {
			const incident = createMockIncident({
				title: "Schema mismatch",
				symptom: "Column does not exist",
				affectedFiles: ["src/db/schema.ts"],
			})

			const plan = buildRepairPlan(incident, { rootCauseCategory: "DB_SCHEMA_MISMATCH" })
			expect(plan.rootCauseCategory).toBe("DB_SCHEMA_MISMATCH")
			expect(plan.diagnosticSteps.length).toBeGreaterThan(0)
		})

		it("should generate a plan for SECURITY_RISK incidents with approval required", () => {
			const incident = createMockIncident({
				title: "Secret exposed",
				symptom: "API key found in logs",
				severity: "critical",
			})

			const plan = buildRepairPlan(incident, { rootCauseCategory: "SECURITY_RISK" })
			expect(plan.rootCauseCategory).toBe("SECURITY_RISK")
			expect(plan.approvalRequired).toBe(true)
			expect(plan.approvalReason).toBeDefined()
		})

		it("should generate a plan for MEMORY_LEAK incidents", () => {
			const incident = createMockIncident({
				title: "Memory pressure",
				symptom: "Heap exhausted",
				affectedFiles: ["src/services/processor.ts"],
			})

			const plan = buildRepairPlan(incident, { rootCauseCategory: "MEMORY_LEAK" })
			expect(plan.rootCauseCategory).toBe("MEMORY_LEAK")
			expect(plan.diagnosticSteps.length).toBeGreaterThan(0)
		})

		it("should generate a plan for RACE_CONDITION incidents", () => {
			const incident = createMockIncident({
				title: "Race condition",
				symptom: "Concurrent access detected",
				affectedFiles: ["src/services/shared-state.ts"],
			})

			const plan = buildRepairPlan(incident, { rootCauseCategory: "RACE_CONDITION" })
			expect(plan.rootCauseCategory).toBe("RACE_CONDITION")
			expect(plan.diagnosticSteps.length).toBeGreaterThan(0)
		})

		it("should generate a plan for NETWORK_TIMEOUT incidents", () => {
			const incident = createMockIncident({
				title: "Connection timeout",
				symptom: "ETIMEDOUT",
				affectedFiles: ["src/api/client.ts"],
			})

			const plan = buildRepairPlan(incident, { rootCauseCategory: "NETWORK_TIMEOUT" })
			expect(plan.rootCauseCategory).toBe("NETWORK_TIMEOUT")
			expect(plan.diagnosticSteps.length).toBeGreaterThan(0)
		})

		it("should generate a plan for UNKNOWN incidents", () => {
			const incident = createMockIncident({
				title: "Something broke",
				symptom: "Unknown error",
			})

			const plan = buildRepairPlan(incident, { rootCauseCategory: "UNKNOWN" })
			expect(plan.rootCauseCategory).toBe("UNKNOWN")
			expect(plan.diagnosticSteps.length).toBeGreaterThan(0)
		})

		it("should classify incident when no category is provided", () => {
			const incident = createMockIncident({
				title: "Missing env variable",
				symptom: "SUPABASE_URL not found",
			})

			const plan = buildRepairPlan(incident)
			expect(plan.rootCauseCategory).toBe("ENV_MISSING")
		})

		it("should include affected files from incident", () => {
			const incident = createMockIncident({
				title: "Config error",
				symptom: "Invalid config",
				affectedFiles: ["src/config.ts", "src/app.ts"],
			})

			const plan = buildRepairPlan(incident, { rootCauseCategory: "CONFIGURATION_ERROR" })
			expect(plan.affectedFiles).toContain("src/config.ts")
			expect(plan.affectedFiles).toContain("src/app.ts")
		})

		it("should force approval when forceApproval is set", () => {
			const incident = createMockIncident({
				title: "Env missing",
				symptom: "Missing env",
				severity: "low",
			})

			const plan = buildRepairPlan(incident, {
				rootCauseCategory: "ENV_MISSING",
				forceApproval: true,
			})
			expect(plan.approvalRequired).toBe(true)
		})
	})

	describe("markPlanExecuted", () => {
		it("should mark a plan as executed with success", () => {
			const incident = createMockIncident({
				title: "Env missing",
				symptom: "Missing env",
			})

			const plan = buildRepairPlan(incident, { rootCauseCategory: "ENV_MISSING" })
			const executed = markPlanExecuted(plan, { success: true, message: "Fix applied" })

			expect(executed.executionStatus).toBe("completed")
			expect(executed.executedAt).toBeGreaterThan(0)
			expect(executed.executionResult?.success).toBe(true)
			expect(executed.executionResult?.message).toBe("Fix applied")
		})

		it("should mark a plan as executed with failure", () => {
			const incident = createMockIncident({
				title: "Env missing",
				symptom: "Missing env",
			})

			const plan = buildRepairPlan(incident, { rootCauseCategory: "ENV_MISSING" })
			const executed = markPlanExecuted(plan, { success: false, message: "Fix failed" })

			expect(executed.executionStatus).toBe("failed")
			expect(executed.executionResult?.success).toBe(false)
		})
	})

	describe("markPlanInProgress", () => {
		it("should mark a plan as in progress", () => {
			const incident = createMockIncident({
				title: "Env missing",
				symptom: "Missing env",
			})

			const plan = buildRepairPlan(incident, { rootCauseCategory: "ENV_MISSING" })
			const inProgress = markPlanInProgress(plan)

			expect(inProgress.executionStatus).toBe("in_progress")
		})
	})

	describe("markPlanCancelled", () => {
		it("should mark a plan as cancelled", () => {
			const incident = createMockIncident({
				title: "Env missing",
				symptom: "Missing env",
			})

			const plan = buildRepairPlan(incident, { rootCauseCategory: "ENV_MISSING" })
			const cancelled = markPlanCancelled(plan)

			expect(cancelled.executionStatus).toBe("cancelled")
		})
	})

	describe("severityToPriority", () => {
		it("should map critical severity to critical priority", () => {
			expect(severityToPriority("critical")).toBe("critical")
		})

		it("should map high severity to high priority", () => {
			expect(severityToPriority("high")).toBe("high")
		})

		it("should map medium severity to normal priority", () => {
			expect(severityToPriority("medium")).toBe("normal")
		})

		it("should map low severity to low priority", () => {
			expect(severityToPriority("low")).toBe("low")
		})
	})

	describe("summarizeRepairPlan", () => {
		it("should produce a readable summary", () => {
			const incident = createMockIncident({
				title: "Missing env variable",
				symptom: "SUPABASE_URL not found",
				affectedFiles: [".env"],
			})

			const plan = buildRepairPlan(incident, { rootCauseCategory: "ENV_MISSING" })
			const summary = summarizeRepairPlan(plan)

			expect(summary).toContain("ENV_MISSING")
			expect(summary).toContain("Diagnostic Steps")
			expect(summary).toContain("Tests to Run")
		})

		it("should include approval info when required", () => {
			const incident = createMockIncident({
				title: "Secret exposed",
				symptom: "API key in logs",
				severity: "critical",
			})

			const plan = buildRepairPlan(incident, { rootCauseCategory: "SECURITY_RISK" })
			const summary = summarizeRepairPlan(plan)

			expect(summary).toContain("Approval Required")
		})
	})
})

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function createMockIncident(overrides: Partial<IncidentRecord> = {}): IncidentRecord {
	return {
		id: "test",
		fingerprint: "test",
		featureKey: null,
		sourceAgent: "test",
		title: "Test",
		symptom: "Test symptom",
		severity: "medium",
		status: "new",
		rootCauseCategory: null,
		affectedFiles: [],
		recommendedAction: null,
		evidence: {},
		autoFixAllowed: false,
		fixAttempts: 0,
		createdAt: Date.now(),
		updatedAt: Date.now(),
		...overrides,
	}
}
