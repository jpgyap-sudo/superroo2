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

		// ── New category tests ────────────────────────────────────────────────

		it("should classify MEMORY_LEAK from memory-related text", () => {
			const result = classifyFromText("Heap exhausted - out of memory error")
			expect(result.category).toBe("MEMORY_LEAK")
			expect(result.confidence).toBeGreaterThan(0.5)
		})

		it("should classify RACE_CONDITION from concurrency text", () => {
			const result = classifyFromText("Race condition detected in concurrent access")
			expect(result.category).toBe("RACE_CONDITION")
			expect(result.confidence).toBeGreaterThan(0.4)
		})

		it("should classify CONFIGURATION_ERROR from config text", () => {
			const result = classifyFromText("Invalid config - misconfiguration detected")
			expect(result.category).toBe("CONFIGURATION_ERROR")
			expect(result.confidence).toBeGreaterThan(0.5)
		})

		it("should classify DEPENDENCY_CONFLICT from dependency text", () => {
			const result = classifyFromText("Dependency conflict: peer dependency version mismatch")
			expect(result.category).toBe("DEPENDENCY_CONFLICT")
			expect(result.confidence).toBeGreaterThan(0.5)
		})

		it("should classify AUTHENTICATION_FAILURE from auth failure text", () => {
			const result = classifyFromText("Auth failed - invalid credentials provided")
			expect(result.category).toBe("AUTHENTICATION_FAILURE")
			expect(result.confidence).toBeGreaterThan(0.5)
		})

		it("should classify NETWORK_TIMEOUT from timeout text", () => {
			const result = classifyFromText("ETIMEDOUT - connection timed out")
			expect(result.category).toBe("NETWORK_TIMEOUT")
			expect(result.confidence).toBeGreaterThan(0.5)
		})

		it("should classify FILE_SYSTEM_ERROR from file system text", () => {
			const result = classifyFromText("ENOENT: file not found")
			expect(result.category).toBe("FILE_SYSTEM_ERROR")
			expect(result.confidence).toBeGreaterThan(0.5)
		})

		it("should classify DNS_RESOLUTION from DNS text", () => {
			const result = classifyFromText("DNS resolution failed - ENOTFOUND")
			expect(result.category).toBe("DNS_RESOLUTION")
			expect(result.confidence).toBeGreaterThan(0.5)
		})

		it("should classify SSL_TLS_ERROR from SSL text", () => {
			const result = classifyFromText("SSL certificate verification failed")
			expect(result.category).toBe("SSL_TLS_ERROR")
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

		it("should classify MEMORY_LEAK from incident evidence", () => {
			const incident = createMockIncident({
				title: "Memory pressure warning",
				symptom: "GC overhead limit exceeded",
				evidence: { error: "heap limit reached, allocation failure" },
			})
			const result = classifyRootCause(incident)
			expect(result.category).toBe("MEMORY_LEAK")
		})

		it("should classify NETWORK_TIMEOUT from incident evidence", () => {
			const incident = createMockIncident({
				title: "API call failed",
				symptom: "Request timed out after 30s",
				evidence: { code: "ETIMEDOUT", message: "connection timed out" },
			})
			const result = classifyRootCause(incident)
			expect(result.category).toBe("NETWORK_TIMEOUT")
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

		it("should return true for SSL_TLS_ERROR", () => {
			expect(requiresHumanApproval("SSL_TLS_ERROR")).toBe(true)
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

		it("should return steps for MEMORY_LEAK", () => {
			const steps = getDiagnosticSteps("MEMORY_LEAK")
			expect(steps).toContain("Check heap usage over time")
			expect(steps.length).toBeGreaterThan(0)
		})

		it("should return steps for NETWORK_TIMEOUT", () => {
			const steps = getDiagnosticSteps("NETWORK_TIMEOUT")
			expect(steps).toContain("Check network connectivity")
			expect(steps.length).toBeGreaterThan(0)
		})

		it("should return steps for SSL_TLS_ERROR", () => {
			const steps = getDiagnosticSteps("SSL_TLS_ERROR")
			expect(steps).toContain("STOP - Do not auto-fix certificate issues")
			expect(steps.length).toBeGreaterThan(0)
		})

		it("should return default steps for UNKNOWN", () => {
			const steps = getDiagnosticSteps("UNKNOWN")
			expect(steps.length).toBeGreaterThan(0)
		})
	})
})
