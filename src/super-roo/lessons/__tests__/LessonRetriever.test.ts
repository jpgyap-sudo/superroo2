/**
 * Tests for LessonRetriever
 *
 * Tests lesson loading from JSONL, filtering by tags/files/type/relevance,
 * sorting, model preference boosting, formatting for different models,
 * statistics, and edge cases.
 *
 * NOTE: Uses vi.mock for fs/promises since vi.spyOn on ESM exports is not supported.
 * The mock factory is self-contained and returns a mock readFile.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { LessonRetriever } from "../LessonRetriever"
import type { Lesson } from "../LessonRetriever"

// Default mock data
const defaultLessons: Lesson[] = [
	{
		id: "1",
		title: "TS Lesson",
		type: "lesson",
		date: "2024-01-01",
		source: "test",
		model: "codex",
		confidence: "high",
		files: ["src/test.ts"],
		tags: ["typescript"],
		relevance_score: 0.9,
		relevance_factors: {
			has_tests: true,
			is_bug_fix: false,
			affects_multiple_files: false,
			has_reusable_rule: true,
			is_ml_related: false,
			affects_training: false,
			is_production_fix: false,
			affects_user_experience: false,
			affects_ui: false,
			affects_deployment: false,
			is_infrastructure: false,
			is_security_critical: false,
			affects_multi_agent: false,
			affects_data_integrity: false,
			is_build_fix: false,
			is_ai_related: false,
			affects_performance: false,
			is_reliability_fix: false,
			is_provider_config: false,
			affects_cost: false,
			affects_privacy: false,
			is_workflow: false,
			is_test_fix: false,
		},
		rule_summary: "Test rule",
		lesson_summary: "Test summary",
	},
	{
		id: "2",
		title: "Debug Lesson",
		type: "bugfix",
		date: "2024-01-02",
		source: "test",
		model: "deepseek",
		confidence: "medium",
		files: ["src/debug.ts"],
		tags: ["debugging"],
		relevance_score: 0.7,
		relevance_factors: {
			has_tests: false,
			is_bug_fix: true,
			affects_multiple_files: false,
			has_reusable_rule: false,
			is_ml_related: false,
			affects_training: false,
			is_production_fix: false,
			affects_user_experience: false,
			affects_ui: false,
			affects_deployment: false,
			is_infrastructure: false,
			is_security_critical: false,
			affects_multi_agent: false,
			affects_data_integrity: false,
			is_build_fix: false,
			is_ai_related: false,
			affects_performance: false,
			is_reliability_fix: false,
			is_provider_config: false,
			affects_cost: false,
			affects_privacy: false,
			is_workflow: false,
			is_test_fix: false,
		},
		rule_summary: "Debug rule",
		lesson_summary: "Debug summary",
	},
	{
		id: "3",
		title: "ML Lesson",
		type: "decision",
		date: "2024-01-03",
		source: "test",
		model: "codex",
		confidence: "high",
		files: ["src/ml.ts"],
		tags: ["ml-engine", "tensor"],
		relevance_score: 0.95,
		relevance_factors: {
			has_tests: false,
			is_bug_fix: false,
			affects_multiple_files: true,
			has_reusable_rule: true,
			is_ml_related: true,
			affects_training: true,
			is_production_fix: false,
			affects_user_experience: false,
			affects_ui: false,
			affects_deployment: false,
			is_infrastructure: false,
			is_security_critical: false,
			affects_multi_agent: false,
			affects_data_integrity: false,
			is_build_fix: false,
			is_ai_related: true,
			affects_performance: false,
			is_reliability_fix: false,
			is_provider_config: false,
			affects_cost: false,
			affects_privacy: false,
			is_workflow: false,
			is_test_fix: false,
		},
		rule_summary: "ML rule",
		lesson_summary: "ML summary",
	},
	{
		id: "4",
		title: "Low Relevance",
		type: "lesson",
		date: "2024-01-04",
		source: "test",
		model: "kimi",
		confidence: "low",
		files: ["src/low.ts"],
		tags: ["typescript"],
		relevance_score: 0.3,
		relevance_factors: {
			has_tests: false,
			is_bug_fix: false,
			affects_multiple_files: false,
			has_reusable_rule: false,
			is_ml_related: false,
			affects_training: false,
			is_production_fix: false,
			affects_user_experience: false,
			affects_ui: false,
			affects_deployment: false,
			is_infrastructure: false,
			is_security_critical: false,
			affects_multi_agent: false,
			affects_data_integrity: false,
			is_build_fix: false,
			is_ai_related: false,
			affects_performance: false,
			is_reliability_fix: false,
			is_provider_config: false,
			affects_cost: false,
			affects_privacy: false,
			is_workflow: false,
			is_test_fix: false,
		},
		rule_summary: "Low rule",
		lesson_summary: "Low summary",
	},
]

function makeJsonl(lessons: Lesson[]): string {
	return lessons.map((l) => JSON.stringify(l)).join("\n") + "\n"
}

// Use vi.hoisted() to create a mutable mock for fs/promises readFile.
// The mock factory is self-contained and cannot reference module-scoped variables.
const { mockReadFile } = vi.hoisted(() => {
	const mockReadFile = vi.fn()
	// Default: return all lessons as JSONL (computed inline since hoisted)
	mockReadFile.mockResolvedValue(makeJsonlInline())
	return { mockReadFile }

	function makeJsonlInline(): string {
		const lessons = [
			{
				id: "1",
				title: "TS Lesson",
				type: "lesson",
				date: "2024-01-01",
				source: "test",
				model: "codex",
				confidence: "high",
				files: ["src/test.ts"],
				tags: ["typescript"],
				relevance_score: 0.9,
				relevance_factors: {
					has_tests: true,
					is_bug_fix: false,
					affects_multiple_files: false,
					has_reusable_rule: true,
					is_ml_related: false,
					affects_training: false,
					is_production_fix: false,
					affects_user_experience: false,
					affects_ui: false,
					affects_deployment: false,
					is_infrastructure: false,
					is_security_critical: false,
					affects_multi_agent: false,
					affects_data_integrity: false,
					is_build_fix: false,
					is_ai_related: false,
					affects_performance: false,
					is_reliability_fix: false,
					is_provider_config: false,
					affects_cost: false,
					affects_privacy: false,
					is_workflow: false,
					is_test_fix: false,
				},
				rule_summary: "Test rule",
				lesson_summary: "Test summary",
			},
			{
				id: "2",
				title: "Debug Lesson",
				type: "bugfix",
				date: "2024-01-02",
				source: "test",
				model: "deepseek",
				confidence: "medium",
				files: ["src/debug.ts"],
				tags: ["debugging"],
				relevance_score: 0.7,
				relevance_factors: {
					has_tests: false,
					is_bug_fix: true,
					affects_multiple_files: false,
					has_reusable_rule: false,
					is_ml_related: false,
					affects_training: false,
					is_production_fix: false,
					affects_user_experience: false,
					affects_ui: false,
					affects_deployment: false,
					is_infrastructure: false,
					is_security_critical: false,
					affects_multi_agent: false,
					affects_data_integrity: false,
					is_build_fix: false,
					is_ai_related: false,
					affects_performance: false,
					is_reliability_fix: false,
					is_provider_config: false,
					affects_cost: false,
					affects_privacy: false,
					is_workflow: false,
					is_test_fix: false,
				},
				rule_summary: "Debug rule",
				lesson_summary: "Debug summary",
			},
			{
				id: "3",
				title: "ML Lesson",
				type: "decision",
				date: "2024-01-03",
				source: "test",
				model: "codex",
				confidence: "high",
				files: ["src/ml.ts"],
				tags: ["ml-engine", "tensor"],
				relevance_score: 0.95,
				relevance_factors: {
					has_tests: false,
					is_bug_fix: false,
					affects_multiple_files: true,
					has_reusable_rule: true,
					is_ml_related: true,
					affects_training: true,
					is_production_fix: false,
					affects_user_experience: false,
					affects_ui: false,
					affects_deployment: false,
					is_infrastructure: false,
					is_security_critical: false,
					affects_multi_agent: false,
					affects_data_integrity: false,
					is_build_fix: false,
					is_ai_related: true,
					affects_performance: false,
					is_reliability_fix: false,
					is_provider_config: false,
					affects_cost: false,
					affects_privacy: false,
					is_workflow: false,
					is_test_fix: false,
				},
				rule_summary: "ML rule",
				lesson_summary: "ML summary",
			},
			{
				id: "4",
				title: "Low Relevance",
				type: "lesson",
				date: "2024-01-04",
				source: "test",
				model: "kimi",
				confidence: "low",
				files: ["src/low.ts"],
				tags: ["typescript"],
				relevance_score: 0.3,
				relevance_factors: {
					has_tests: false,
					is_bug_fix: false,
					affects_multiple_files: false,
					has_reusable_rule: false,
					is_ml_related: false,
					affects_training: false,
					is_production_fix: false,
					affects_user_experience: false,
					affects_ui: false,
					affects_deployment: false,
					is_infrastructure: false,
					is_security_critical: false,
					affects_multi_agent: false,
					affects_data_integrity: false,
					is_build_fix: false,
					is_ai_related: false,
					affects_performance: false,
					is_reliability_fix: false,
					is_provider_config: false,
					affects_cost: false,
					affects_privacy: false,
					is_workflow: false,
					is_test_fix: false,
				},
				rule_summary: "Low rule",
				lesson_summary: "Low summary",
			},
		]
		return lessons.map((l) => JSON.stringify(l)).join("\n") + "\n"
	}
})

vi.mock("fs/promises", () => {
	return {
		default: { readFile: mockReadFile },
		readFile: mockReadFile,
	}
})

/**
 * Helper to create a LessonRetriever pre-populated with test lessons.
 * This bypasses the load() method to avoid fs/promises mocking issues.
 */
function createPopulatedRetriever(lessons: Lesson[] = defaultLessons): LessonRetriever {
	const retriever = new LessonRetriever("/tmp/test-lessons.jsonl") as unknown as {
		lessons: Lesson[]
		loaded: boolean
	}
	// Use type assertion to directly set the private lessons array
	// This is a test-only pattern that avoids mocking fs/promises
	retriever.lessons = lessons
	retriever.loaded = true
	return retriever as unknown as LessonRetriever
}

describe("LessonRetriever", () => {
	beforeEach(() => {
		// Do NOT call mockClear() - it clears the resolved value in vitest 3.x
		// The mock retains its default implementation from vi.hoisted()
	})

	function createRetriever(): LessonRetriever {
		return new LessonRetriever("/tmp/test-lessons.jsonl")
	}

	describe("load", () => {
		it("should handle missing index file gracefully", async () => {
			mockReadFile.mockRejectedValue(new Error("File not found"))
			const retriever = new LessonRetriever("/tmp/missing.jsonl")
			await retriever.load()
			expect(retriever.getAllLessons()).toEqual([])
		})

		it("should parse JSONL content into lessons", async () => {
			// Re-set the resolved value since beforeEach cleared it
			mockReadFile.mockResolvedValue(makeJsonl(defaultLessons))
			const retriever = createRetriever()
			await retriever.load()
			const all = retriever.getAllLessons()
			expect(all.length).toBe(4)
			expect(all[0].title).toBe("TS Lesson")
		})

		it("should be idempotent (load only once)", async () => {
			mockReadFile.mockResolvedValue(makeJsonl(defaultLessons))
			const retriever = createRetriever()
			await retriever.load()
			await retriever.load() // second call should be no-op
			expect(retriever.getAllLessons().length).toBe(4)
		})
	})

	describe("retrieve", () => {
		it("should return all lessons when no filters applied", async () => {
			const retriever = createPopulatedRetriever()
			const results = await retriever.retrieve()
			expect(results.length).toBe(4)
		})

		it("should filter by tags (AND logic)", async () => {
			const retriever = createPopulatedRetriever()
			const results = await retriever.retrieve({ tags: ["typescript"] })
			expect(results.length).toBe(2)
			expect(results.every((l) => l.tags.includes("typescript"))).toBe(true)
		})

		it("should filter by type", async () => {
			const retriever = createPopulatedRetriever()
			const results = await retriever.retrieve({ type: "decision" })
			expect(results.length).toBe(1)
			expect(results[0].title).toBe("ML Lesson")
		})

		it("should filter by minimum relevance", async () => {
			const retriever = createPopulatedRetriever()
			const results = await retriever.retrieve({ minRelevance: 0.8 })
			expect(results.length).toBe(2)
			expect(results.every((l) => l.relevance_score >= 0.8)).toBe(true)
		})

		it("should sort by relevance descending by default", async () => {
			const retriever = createPopulatedRetriever()
			const results = await retriever.retrieve()
			for (let i = 1; i < results.length; i++) {
				expect(results[i - 1].relevance_score).toBeGreaterThanOrEqual(results[i].relevance_score)
			}
		})

		it("should apply limit", async () => {
			const retriever = createPopulatedRetriever()
			const results = await retriever.retrieve({ limit: 2 })
			expect(results.length).toBeLessThanOrEqual(2)
		})

		it("should boost preferred model", async () => {
			const retriever = createPopulatedRetriever()
			const results = await retriever.retrieve({ preferModel: "codex" })
			expect(results.length).toBeGreaterThan(0)
		})
	})

	describe("getTopLessons", () => {
		it("should return top N lessons by relevance", async () => {
			const retriever = createPopulatedRetriever()
			const results = await retriever.getTopLessons(2)
			expect(results.length).toBe(2)
			expect(results[0].relevance_score).toBeGreaterThanOrEqual(0.85)
		})
	})

	describe("getLessonsForFile", () => {
		it("should return lessons matching file pattern", async () => {
			const retriever = createPopulatedRetriever()
			const results = await retriever.getLessonsForFile("src/test.ts")
			expect(results.length).toBe(1)
			expect(results[0].id).toBe("1")
		})
	})

	describe("getLessonsForTask", () => {
		it("should return lessons for testing task", async () => {
			// Add a lesson with matching tags for the "testing" task
			const lessonsWithTesting = [
				...defaultLessons,
				{
					...defaultLessons[0],
					id: "5",
					title: "Testing Lesson",
					tags: ["testing", "vitest"],
				},
			]
			const retriever = createPopulatedRetriever(lessonsWithTesting)
			const results = await retriever.getLessonsForTask("testing")
			expect(results.length).toBeGreaterThan(0)
			expect(results.some((l) => l.title === "Testing Lesson")).toBe(true)
		})

		it("should return lessons for deployment task", async () => {
			// Add a lesson with matching tags for the "deployment" task
			const lessonsWithDeploy = [
				...defaultLessons,
				{
					...defaultLessons[0],
					id: "6",
					title: "Deploy Lesson",
					tags: ["deployment", "docker"],
				},
			]
			const retriever = createPopulatedRetriever(lessonsWithDeploy)
			const results = await retriever.getLessonsForTask("deployment")
			expect(results.length).toBeGreaterThan(0)
			expect(results.some((l) => l.title === "Deploy Lesson")).toBe(true)
		})
	})

	describe("formatForPrompt", () => {
		it("should return empty string for empty lessons", () => {
			const retriever = createPopulatedRetriever()
			const result = retriever.formatForPrompt([])
			expect(result).toBe("")
		})

		it("should format lessons for codex format", () => {
			const retriever = createPopulatedRetriever()
			const lessons = [defaultLessons[0]]
			const result = retriever.formatForPrompt(lessons, "codex")
			expect(result).toContain("TS Lesson")
			expect(result).toContain("0.90")
		})

		it("should format lessons for claude format", () => {
			const retriever = createPopulatedRetriever()
			const lessons = [defaultLessons[0]]
			const result = retriever.formatForPrompt(lessons, "claude")
			expect(result).toContain("TS Lesson")
			expect(result).toContain("high")
		})

		it("should format lessons for deepseek format", () => {
			const retriever = createPopulatedRetriever()
			const lessons = [defaultLessons[0]]
			const result = retriever.formatForPrompt(lessons, "deepseek")
			expect(result).toContain("TS Lesson")
			expect(result).toContain("RULE:")
		})

		it("should format lessons for kimi format", () => {
			const retriever = createPopulatedRetriever()
			const lessons = [defaultLessons[0]]
			const result = retriever.formatForPrompt(lessons, "kimi")
			expect(result).toContain("TS Lesson")
			expect(result).toContain("typescript")
		})
	})

	describe("getStats", () => {
		it("should return correct total count", () => {
			const retriever = createPopulatedRetriever()
			const stats = retriever.getStats()
			expect(stats.total).toBe(4)
		})

		it("should break down by type", () => {
			const retriever = createPopulatedRetriever()
			const stats = retriever.getStats()
			expect(stats.byType.lesson).toBe(2)
			expect(stats.byType.bugfix).toBe(1)
			expect(stats.byType.decision).toBe(1)
		})

		it("should break down by model", () => {
			const retriever = createPopulatedRetriever()
			const stats = retriever.getStats()
			expect(stats.byModel.codex).toBe(2)
			expect(stats.byModel.deepseek).toBe(1)
		})

		it("should calculate average relevance", () => {
			const retriever = createPopulatedRetriever()
			const stats = retriever.getStats()
			expect(stats.avgRelevance).toBeCloseTo((0.9 + 0.7 + 0.95 + 0.3) / 4, 1)
		})

		it("should handle empty lesson list", () => {
			const retriever = new LessonRetriever("/tmp/empty.jsonl")
			const stats = retriever.getStats()
			expect(stats.total).toBe(0)
			expect(stats.avgRelevance).toBe(0)
		})
	})
})
