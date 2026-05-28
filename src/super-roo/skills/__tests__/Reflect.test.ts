import { describe, it, expect } from "vitest"
import { formatTrajectory, formatMinibatchTrajectories, shuffleForMinibatch, groupIntoMinibatches } from "../Reflect"
import type { RolloutResult } from "../types"

describe("formatTrajectory", () => {
	it("formats a rollout result into text", () => {
		const result: RolloutResult = {
			taskId: "task-1",
			success: true,
			skillContent: "# Skill",
			trajectory: "Step 1: did X\nStep 2: did Y",
			quality: 0.9,
			durationMs: 1500,
		}
		const text = formatTrajectory(result)
		expect(text).toContain("task-1")
		expect(text).toContain("Success: true")
		expect(text).toContain("Quality: 0.9")
		expect(text).toContain("Step 1: did X")
	})

	it("includes error message for failed rollouts", () => {
		const result: RolloutResult = {
			taskId: "task-2",
			success: false,
			skillContent: "# Skill",
			trajectory: "Step 1: did X",
			error: "AssertionError: expected 5 to be 3",
			durationMs: 500,
		}
		const text = formatTrajectory(result)
		expect(text).toContain("AssertionError")
	})
})

describe("formatMinibatchTrajectories", () => {
	it("formats multiple trajectories with separators", () => {
		const results: RolloutResult[] = [
			{ taskId: "t1", success: true, skillContent: "", trajectory: "A", durationMs: 100 },
			{ taskId: "t2", success: false, skillContent: "", trajectory: "B", durationMs: 200 },
		]
		const text = formatMinibatchTrajectories(results)
		expect(text).toContain("[Trajectory 1/2]")
		expect(text).toContain("[Trajectory 2/2]")
		expect(text).toContain("---")
	})
})

describe("shuffleForMinibatch", () => {
	it("returns same length array", () => {
		const items = [1, 2, 3, 4, 5]
		const shuffled = shuffleForMinibatch(items)
		expect(shuffled).toHaveLength(items.length)
	})

	it("contains all original elements", () => {
		const items = [1, 2, 3, 4, 5]
		const shuffled = shuffleForMinibatch(items)
		expect(shuffled.sort()).toEqual(items.sort())
	})

	it("is deterministic with same seed", () => {
		const items = [1, 2, 3, 4, 5, 6, 7, 8]
		const a = shuffleForMinibatch(items, 42)
		const b = shuffleForMinibatch(items, 42)
		expect(a).toEqual(b)
	})

	it("produces different order with different seed", () => {
		const items = [1, 2, 3, 4, 5, 6, 7, 8]
		const a = shuffleForMinibatch(items, 42)
		const b = shuffleForMinibatch(items, 99)
		expect(a).not.toEqual(b)
	})
})

describe("groupIntoMinibatches", () => {
	it("groups items into batches of specified size", () => {
		const items = [1, 2, 3, 4, 5, 6, 7]
		const batches = groupIntoMinibatches(items, 3)
		expect(batches).toHaveLength(3)
		expect(batches[0]).toHaveLength(3)
		expect(batches[1]).toHaveLength(3)
		expect(batches[2]).toHaveLength(1)
	})

	it("returns single batch when batch size >= items length", () => {
		const items = [1, 2, 3]
		const batches = groupIntoMinibatches(items, 10)
		expect(batches).toHaveLength(1)
		expect(batches[0]).toHaveLength(3)
	})

	it("returns empty array for empty input", () => {
		expect(groupIntoMinibatches([], 3)).toEqual([])
	})
})
