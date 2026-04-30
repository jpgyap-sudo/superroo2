/**
 * Tests for the RootCauseClassifier module.
 */

import { describe, it, expect } from "vitest"

import {
	classifyRootCause,
	classifyFromText,
	isSecurityRisk,
	requiresHumanApproval,
	getDiagnosticSteps,
} from "../RootCauseClassifier"
import type { IncidentRecord } from "../../types"

describe("RootCauseClassifier", () => {
	describe("classifyFromText", () => {
		it("should classify ENV_MISSING from environment-related text", () => {
			const result = classifyFromText("Missing SUPABASE_URL env variable")
			expect(result.category).toBe("ENV_MISSING")
			expect(result.confidence).toBeGreaterThan(0.5)
		})

		it("should classify DB_SCHEMA_MISMATCH from schema errors", () => {
			const result = classifyFromText("Column 'users.name' does not exist in table")
			expect(result.category).toBe("DB_SCHEMA_MISMATCH")
			expect(result.confidence).toBeGreaterThan(0.4)
		})

		it("should classify API_AUTH_FAILURE from 401 errors", () => {
			const result = classifyFromText("401 Unauthorized when calling API")
			expect(result.category).toBe("API_AUTH_FAILURE")
			expect(result.confidence).toBeGreaterThan(0.5)
		})

		it("should classify API_RATE_LIMIT from 429 errors", () => {
			const result = classifyFromText("429 Rate limit exceeded")
			expect(result.category).toBe("API_RATE_LIMIT")
			expect(result.confidence).toBeGreaterThan(0.5)
		})

		it("should classify BROKEN_ROUTE from 404 errors", () => {
			const result = classifyFromText("404 Not Found - route /api/test missing")
			expect(result.category).toBe("BROKEN_ROUTE")
			expect(result.confidence).toBeGreaterThan(0.5)
		})

		it("should classify FRONTEND_CORS from CORS errors", () => {
			const result = classifyFromText("CORS policy blocked request")
			expect(result.category).toBe("FRONTEND_CORS")
			expect(result.confidence).toBeGreaterThan(0.5)
		})

		it("should classify SECURITY_RISK from security-related text", () => {
			const result = classifyFromText("Private key exposed in logs")
			expect(result.category).toBe("SECURITY_RISK")
			expect(result.confidence).toBeGreaterThan(0.5)
		})

		it("should use default category for unknown patterns", () => {
			const result = classifyFromText("Something random happened", "TEST_FAILURE")
			expect(result.category).toBe("TEST_FAILURE")
		})
	})

	describe("classifyRootCause", () => {
		const createMockIncident = (overrides: Partial<IncidentRecord> = {}): IncidentRecord => ({
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
		})

		it("should classify based on title and symptom", () => {
			const incident = createMockIncident({
				title: "Database connection failed",
				symptom: "relation 'users' does not exist",
			})
			const result = classifyRootCause(incident)
			expect(result.category).toBe("DB_SCHEMA_MISMATCH")
		})

		it("should consider evidence in classification", () => {
			const incident = createMockIncident({
				title: "API Error",
				symptom: "Request failed",
				evidence: { errorCode: "401", message: "Unauthorized" },
			})
			const result = classifyRootCause(incident)
			expect(result.category).toBe("API_AUTH_FAILURE")
		})
	})

	describe("isSecurityRisk", () => {
		it("should return true for SECURITY_RISK category", () => {
			expect(isSecurityRisk("SECURITY_RISK")).toBe(true)
		})

		it("should return false for other categories", () => {
			expect(isSecurityRisk("ENV_MISSING")).toBe(false)
			expect(isSecurityRisk("DB_SCHEMA_MISMATCH")).toBe(false)
			expect(isSecurityRisk("UNKNOWN")).toBe(false)
		})
	})

	describe("requiresHumanApproval", () => {
		it("should return true for SECURITY_RISK", () => {
			expect(requiresHumanApproval("SECURITY_RISK")).toBe(true)
		})

		it("should return true for TRADING_GATE_BLOCKED", () => {
			expect(requiresHumanApproval("TRADING_GATE_BLOCKED")).toBe(true)
		})

		it("should return true for DEPLOY_DRIFT", () => {
			expect(requiresHumanApproval("DEPLOY_DRIFT")).toBe(true)
		})

		it("should return false for routine issues", () => {
			expect(requiresHumanApproval("ENV_MISSING")).toBe(false)
			expect(requiresHumanApproval("TEST_FAILURE")).toBe(false)
		})
	})

	describe("getDiagnosticSteps", () => {
		it("should return steps for ENV_MISSING", () => {
			const steps = getDiagnosticSteps("ENV_MISSING")
			expect(steps).toContain("Check .env file and environment variables")
			expect(steps.length).toBeGreaterThan(0)
		})

		it("should return steps for DB_SCHEMA_MISMATCH", () => {
			const steps = getDiagnosticSteps("DB_SCHEMA_MISMATCH")
			expect(steps).toContain("Check Supabase migration status")
			expect(steps.length).toBeGreaterThan(0)
		})

		it("should return steps for SECURITY_RISK", () => {
			const steps = getDiagnosticSteps("SECURITY_RISK")
			expect(steps).toContain("STOP - Do not auto-fix")
			expect(steps.length).toBeGreaterThan(0)
		})

		it("should return default steps for UNKNOWN", () => {
			const steps = getDiagnosticSteps("UNKNOWN")
			expect(steps.length).toBeGreaterThan(0)
		})
	})
})
