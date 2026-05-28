import { describe, it, expect } from "vitest"
import {
	buildComparisonPairs,
	filterComparisonPairs,
	pairCategoryCounts,
	formatComparisonText,
	serializeComparisonPairs,
} from "../SlowUpdate"
import type { RolloutResult } from "../types"

function makeRollout(taskId: string, success: boolean, quality?: number): RolloutResult {
	return {
		taskId,
		success,
		skillContent: "# Skill",
		trajectory: `Trajectory for ${taskId}`,
		quality,
		durationMs: 100,
	}
}

describe("buildComparisonPairs", () => {
	it("categorizes improved (failed → succeeded)", () => {
		const prev = [makeRollout("t1", false)]
		const curr = [makeRollout("t1", true)]
		const pairs = buildComparisonPairs(prev, curr)
		expect(pairs).toHaveLength(1)
		expect(pairs[0].category).toBe("improved")
	})

	it("categorizes regressed (succeeded → failed)", () => {
		const prev = [makeRollout("t1", true)]
		const curr = [makeRollout("t1", false)]
		const pairs = buildComparisonPairs(prev, curr)
		expect(pairs[0].category).toBe("regressed")
	})

	it("categorizes persistent_fail (failed → failed)", () => {
		const prev = [makeRollout("t1", false)]
		const curr = [makeRollout("t1", false)]
		const pairs = buildComparisonPairs(prev, curr)
		expect(pairs[0].category).toBe("persistent_fail")
	})

	it("categorizes stable_success (succeeded → succeeded)", () => {
		const prev = [makeRollout("t1", true)]
		const curr = [makeRollout("t1", true)]
		const pairs = buildComparisonPairs(prev, curr)
		expect(pairs[0].category).toBe("stable_success")
	})

	it("skips tasks not in previous epoch", () => {
		const prev = [makeRollout("t1", true)]
		const curr = [makeRollout("t2", true)]
		const pairs = buildComparisonPairs(prev, curr)
		expect(pairs).toHaveLength(0)
	})
})

describe("filterComparisonPairs", () => {
	const pairs = [
		{
			taskId: "t1",
			category: "improved" as const,
			previousTrajectory: "",
			currentTrajectory: "",
			previousScore: 0.2,
			currentScore: 0.8,
		},
		{
			taskId: "t2",
			category: "regressed" as const,
			previousTrajectory: "",
			currentTrajectory: "",
			previousScore: 0.8,
			currentScore: 0.2,
		},
		{
			taskId: "t3",
			category: "persistent_fail" as const,
			previousTrajectory: "",
			currentTrajectory: "",
			previousScore: 0.2,
			currentScore: 0.2,
		},
		{
			taskId: "t4",
			category: "stable_success" as const,
			previousTrajectory: "",
			currentTrajectory: "",
			previousScore: 0.8,
			currentScore: 0.8,
		},
	]

	it("returns all when policy is 'all'", () => {
		expect(filterComparisonPairs(pairs, "all")).toHaveLength(4)
	})

	it("returns only improved when policy is 'improved_only'", () => {
		const filtered = filterComparisonPairs(pairs, "improved_only")
		expect(filtered).toHaveLength(1)
		expect(filtered[0].category).toBe("improved")
	})

	it("returns only regressed when policy is 'regressed_only'", () => {
		const filtered = filterComparisonPairs(pairs, "regressed_only")
		expect(filtered).toHaveLength(1)
		expect(filtered[0].category).toBe("regressed")
	})

	it("returns failures when policy is 'failures_only'", () => {
		const filtered = filterComparisonPairs(pairs, "failures_only")
		expect(filtered).toHaveLength(2)
		expect(filtered.map((p) => p.category).sort()).toEqual(["improved", "persistent_fail"])
	})
})

describe("pairCategoryCounts", () => {
	it("counts each category", () => {
		const pairs = [
			{
				taskId: "t1",
				category: "improved" as const,
				previousTrajectory: "",
				currentTrajectory: "",
				previousScore: 0,
				currentScore: 0,
			},
			{
				taskId: "t2",
				category: "improved" as const,
				previousTrajectory: "",
				currentTrajectory: "",
				previousScore: 0,
				currentScore: 0,
			},
			{
				taskId: "t3",
				category: "regressed" as const,
				previousTrajectory: "",
				currentTrajectory: "",
				previousScore: 0,
				currentScore: 0,
			},
		]
		const counts = pairCategoryCounts(pairs)
		expect(counts.improved).toBe(2)
		expect(counts.regressed).toBe(1)
		expect(counts.persistent_fail).toBe(0)
		expect(counts.stable_success).toBe(0)
	})
})

describe("formatComparisonText", () => {
	it("formats pairs by category", () => {
		const pairs = [
			{
				taskId: "t1",
				category: "improved" as const,
				previousTrajectory: "old",
				currentTrajectory: "new",
				previousScore: 0.2,
				currentScore: 0.8,
			},
		]
		const text = formatComparisonText(pairs)
		expect(text).toContain("IMPROVED")
		expect(text).toContain("t1")
		expect(text).toContain("0.200")
		expect(text).toContain("0.800")
	})
})

describe("serializeComparisonPairs", () => {
	it("produces JSON-safe output", () => {
		const pairs = [
			{
				taskId: "t1",
				category: "improved" as const,
				previousTrajectory: "old",
				currentTrajectory: "new",
				previousScore: 0.2,
				currentScore: 0.8,
			},
		]
		const serialized = serializeComparisonPairs(pairs)
		expect(serialized[0]).toHaveProperty("taskId", "t1")
		expect(serialized[0]).toHaveProperty("previousTrajectoryLength", 3)
		expect(serialized[0]).toHaveProperty("currentTrajectoryLength", 3)
	})
})
