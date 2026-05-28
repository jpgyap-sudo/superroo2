import { describe, it, expect } from "vitest"
import { truncateEdits } from "../Clip"
import type { Edit, Patch } from "../types"

describe("truncateEdits", () => {
	it("keeps first L edits", () => {
		const edits: Edit[] = [
			{ op: "replace", search: "a", replace: "1" },
			{ op: "replace", search: "b", replace: "2" },
			{ op: "replace", search: "c", replace: "3" },
			{ op: "replace", search: "d", replace: "4" },
		]
		const result = truncateEdits(edits, 2)
		expect(result).toHaveLength(2)
		expect(result[0].search).toBe("a")
		expect(result[1].search).toBe("b")
	})

	it("returns all edits when within budget", () => {
		const edits: Edit[] = [
			{ op: "replace", search: "a", replace: "1" },
			{ op: "replace", search: "b", replace: "2" },
		]
		const result = truncateEdits(edits, 10)
		expect(result).toHaveLength(2)
	})

	it("returns empty array for empty input", () => {
		expect(truncateEdits([], 5)).toEqual([])
	})
})
