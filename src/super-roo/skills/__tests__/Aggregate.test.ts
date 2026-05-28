import { describe, it, expect } from "vitest"
import { rawPatchToPatch, sortPatchesByPriority, deduplicatePatches } from "../Aggregate"
import type { RawPatch, Patch } from "../types"

describe("rawPatchToPatch", () => {
	it("converts raw patch with failure summary", () => {
		const raw: RawPatch = {
			failureSummary: [
				{
					summary: "Missing error handling",
					category: "error_handling",
					suggestion: "Add try-catch",
					confidence: 0.9,
				},
			],
			edits: [{ op: "replace", search: "old", replace: "new" }],
			sourceType: "error_analyst",
			isSuccess: false,
		}
		const patch = rawPatchToPatch(raw, "error_analyst")
		expect(patch.reasoning).toContain("Missing error handling")
		expect(patch.edits).toHaveLength(1)
		expect(patch.sourceType).toBe("error_analyst")
		expect(patch.supportCount).toBe(1)
	})

	it("handles raw patch without failure summary", () => {
		const raw: RawPatch = {
			edits: [{ op: "replace", search: "old", replace: "new" }],
			sourceType: "success_analyst",
			isSuccess: true,
		}
		const patch = rawPatchToPatch(raw, "success_analyst")
		expect(patch.reasoning).toBe("No reasoning")
	})
})

describe("sortPatchesByPriority", () => {
	it("puts error analyst patches first", () => {
		const patches: Patch[] = [
			{ reasoning: "A", edits: [], sourceType: "success_analyst", supportCount: 1 },
			{ reasoning: "B", edits: [], sourceType: "error_analyst", supportCount: 1 },
		]
		const sorted = sortPatchesByPriority(patches)
		expect(sorted[0].sourceType).toBe("error_analyst")
		expect(sorted[1].sourceType).toBe("success_analyst")
	})

	it("sorts by support count descending within same type", () => {
		const patches: Patch[] = [
			{ reasoning: "A", edits: [], sourceType: "error_analyst", supportCount: 1 },
			{ reasoning: "B", edits: [], sourceType: "error_analyst", supportCount: 5 },
		]
		const sorted = sortPatchesByPriority(patches)
		expect(sorted[0].supportCount).toBe(5)
		expect(sorted[1].supportCount).toBe(1)
	})
})

describe("deduplicatePatches", () => {
	it("removes patches with identical edits", () => {
		const patches: Patch[] = [
			{
				reasoning: "A",
				edits: [{ op: "replace", search: "foo", replace: "bar" }],
				sourceType: "error",
				supportCount: 1,
			},
			{
				reasoning: "B",
				edits: [{ op: "replace", search: "foo", replace: "bar" }],
				sourceType: "error",
				supportCount: 1,
			},
		]
		const deduped = deduplicatePatches(patches)
		expect(deduped).toHaveLength(1)
	})

	it("keeps patches with different edits", () => {
		const patches: Patch[] = [
			{
				reasoning: "A",
				edits: [{ op: "replace", search: "foo", replace: "bar" }],
				sourceType: "error",
				supportCount: 1,
			},
			{
				reasoning: "B",
				edits: [{ op: "replace", search: "baz", replace: "qux" }],
				sourceType: "error",
				supportCount: 1,
			},
		]
		const deduped = deduplicatePatches(patches)
		expect(deduped).toHaveLength(2)
	})
})
