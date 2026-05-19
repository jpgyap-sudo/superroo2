/**
 * Tests for the MLClassifier module.
 *
 * Tests cover:
 * - Feature extraction dimension
 * - Training from examples
 * - Classification after training
 * - Fallback to keyword classifier when not trained
 * - Low confidence fallback
 * - Reset behavior
 * - Example distribution tracking
 */

import { describe, it, expect } from "vitest"

import { MLClassifier, getFeatureDimension } from "../MLClassifier"
import type { IncidentRecord } from "../../types"

describe("MLClassifier", () => {
	describe("getFeatureDimension", () => {
		it("should return a positive number of features", () => {
			const dim = getFeatureDimension()
			expect(dim).toBeGreaterThan(0)
		})
	})

	describe("initial state", () => {
		it("should not be trained initially", () => {
			const classifier = new MLClassifier({ autoTrain: false })
			expect(classifier.isTrained()).toBe(false)
			expect(classifier.getExampleCount()).toBe(0)
		})

		it("should fall back to keyword classifier when not trained", () => {
			const classifier = new MLClassifier({ autoTrain: false })
			const incident = createMockIncident({
				title: "Missing SUPABASE_URL env variable",
				symptom: "Environment variable not found",
			})
			const result = classifier.classify(incident)
			expect(result.category).toBe("ENV_MISSING")
			expect(result.confidence).toBeGreaterThan(0)
		})

		it("should classify from text when not trained", () => {
			const classifier = new MLClassifier({ autoTrain: false })
			const result = classifier.classifyFromText("401 Unauthorized when calling API")
			expect(result.category).toBe("API_AUTH_FAILURE")
		})
	})

	describe("training", () => {
		it("should not train with fewer than 2 examples", () => {
			const classifier = new MLClassifier({ autoTrain: false })
			const incident = createMockIncident({
				title: "Missing env",
				symptom: "ENV_MISSING",
				rootCauseCategory: "ENV_MISSING",
			})
			classifier.addExample(incident)
			expect(classifier.isTrained()).toBe(false)
		})

		it("should train with sufficient examples across categories", () => {
			const classifier = new MLClassifier({
				autoTrain: false,
				minExamplesPerCategory: 1,
				epochsPerBatch: 30,
			})

			// Add examples for 2 categories
			classifier.addExample(
				createMockIncident({
					title: "Missing env variable",
					symptom: "SUPABASE_URL not found in environment",
					rootCauseCategory: "ENV_MISSING",
				}),
			)
			classifier.addExample(
				createMockIncident({
					title: "401 auth error",
					symptom: "Unauthorized - token expired",
					rootCauseCategory: "API_AUTH_FAILURE",
				}),
			)

			// Train manually
			classifier.train()
			expect(classifier.isTrained()).toBe(true)
			expect(classifier.getExampleCount()).toBe(2)
		})

		it("should auto-train when autoTrain is enabled", () => {
			const classifier = new MLClassifier({
				autoTrain: true,
				minExamplesPerCategory: 1,
				epochsPerBatch: 30,
			})

			classifier.addExample(
				createMockIncident({
					title: "Missing env variable",
					symptom: "SUPABASE_URL not found",
					rootCauseCategory: "ENV_MISSING",
				}),
			)
			classifier.addExample(
				createMockIncident({
					title: "401 auth error",
					symptom: "Unauthorized",
					rootCauseCategory: "API_AUTH_FAILURE",
				}),
			)

			expect(classifier.isTrained()).toBe(true)
		})

		it("should reject examples with UNKNOWN category", () => {
			const classifier = new MLClassifier({ autoTrain: false })
			const result = classifier.addExample(
				createMockIncident({
					title: "Something random",
					symptom: "No clear pattern",
					rootCauseCategory: "UNKNOWN",
				}),
			)
			expect(result).toBe(false)
			expect(classifier.getExampleCount()).toBe(0)
		})
	})

	describe("classification after training", () => {
		it("should classify env-related incidents correctly after training", () => {
			const classifier = new MLClassifier({
				autoTrain: false,
				minExamplesPerCategory: 1,
				epochsPerBatch: 50,
			})

			// Train on env and auth examples
			classifier.addExample(
				createMockIncident({
					title: "Missing env variable",
					symptom: "SUPABASE_URL not found in environment variables",
					rootCauseCategory: "ENV_MISSING",
				}),
			)
			classifier.addExample(
				createMockIncident({
					title: "401 auth error",
					symptom: "Unauthorized - token expired",
					rootCauseCategory: "API_AUTH_FAILURE",
				}),
			)
			classifier.train()

			// Classify a new env-related incident
			const result = classifier.classify(
				createMockIncident({
					title: "API key missing",
					symptom: "process.env.API_KEY is undefined",
				}),
			)

			// Should match ENV_MISSING (either via ML or keyword fallback)
			expect(result.category).toBe("ENV_MISSING")
			expect(result.confidence).toBeGreaterThan(0)
		})

		it("should fall back to keyword classifier for text with no keyword overlap", () => {
			const classifier = new MLClassifier({
				autoTrain: false,
				minExamplesPerCategory: 1,
				epochsPerBatch: 30,
			})

			classifier.addExample(
				createMockIncident({
					title: "Missing env",
					symptom: "SUPABASE_URL not found",
					rootCauseCategory: "ENV_MISSING",
				}),
			)
			classifier.addExample(
				createMockIncident({
					title: "Auth error",
					symptom: "401 unauthorized",
					rootCauseCategory: "API_AUTH_FAILURE",
				}),
			)
			classifier.train()

			// Text with no keywords at all should fall back
			const result = classifier.classifyFromText("Something completely random happened")
			expect(result.category).toBe("UNKNOWN")
		})
	})

	describe("example distribution", () => {
		it("should track example counts by category", () => {
			const classifier = new MLClassifier({ autoTrain: false })

			classifier.addExample(
				createMockIncident({
					title: "Missing env",
					symptom: "env not found",
					rootCauseCategory: "ENV_MISSING",
				}),
			)
			classifier.addExample(
				createMockIncident({
					title: "Auth error",
					symptom: "401",
					rootCauseCategory: "API_AUTH_FAILURE",
				}),
			)
			classifier.addExample(
				createMockIncident({
					title: "Another env",
					symptom: "missing env var",
					rootCauseCategory: "ENV_MISSING",
				}),
			)

			const dist = classifier.getExampleDistribution()
			expect(dist["ENV_MISSING"]).toBe(2)
			expect(dist["API_AUTH_FAILURE"]).toBe(1)
		})
	})

	describe("reset", () => {
		it("should clear all state on reset", () => {
			const classifier = new MLClassifier({ autoTrain: false })

			classifier.addExample(
				createMockIncident({
					title: "Missing env",
					symptom: "env not found",
					rootCauseCategory: "ENV_MISSING",
				}),
			)
			classifier.addExample(
				createMockIncident({
					title: "Auth error",
					symptom: "401",
					rootCauseCategory: "API_AUTH_FAILURE",
				}),
			)
			classifier.train()
			expect(classifier.isTrained()).toBe(true)

			classifier.reset()
			expect(classifier.isTrained()).toBe(false)
			expect(classifier.getExampleCount()).toBe(0)
			expect(classifier.getNetwork()).toBeNull()
		})
	})

	describe("addExamples batch", () => {
		it("should add multiple examples at once", () => {
			const classifier = new MLClassifier({ autoTrain: false })

			const count = classifier.addExamples([
				createMockIncident({
					title: "Missing env",
					symptom: "env not found",
					rootCauseCategory: "ENV_MISSING",
				}),
				createMockIncident({
					title: "Auth error",
					symptom: "401",
					rootCauseCategory: "API_AUTH_FAILURE",
				}),
				createMockIncident({
					title: "Unknown",
					symptom: "random",
					rootCauseCategory: "UNKNOWN",
				}),
			])

			expect(count).toBe(2) // UNKNOWN is rejected
			expect(classifier.getExampleCount()).toBe(2)
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
