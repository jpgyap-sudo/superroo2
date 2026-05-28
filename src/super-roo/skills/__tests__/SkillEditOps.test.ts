import { describe, it, expect } from "vitest"
import {
	isInSlowUpdateRegion,
	stripSlowUpdateMarkers,
	injectEmptySlowUpdateField,
	extractSlowUpdateField,
	stripAllSlowUpdateFields,
	replaceSlowUpdateField,
	applyEdit,
	applyEditWithReport,
	applyPatch,
	applyPatchWithReport,
} from "../SkillEditOps"
import type { Edit, Patch } from "../types"

describe("slow update field helpers", () => {
	const skillWithSlowUpdate = `# My Skill

Some content here.

<!-- SLOW_UPDATE_START -->
Strategic guidance content
<!-- SLOW_UPDATE_END -->

More content.`

	const skillWithoutSlowUpdate = "# My Skill\n\nSome content here."

	describe("isInSlowUpdateRegion", () => {
		it("returns true for content inside slow update region", () => {
			expect(isInSlowUpdateRegion(skillWithSlowUpdate, "Strategic guidance")).toBe(true)
		})

		it("returns false for content outside slow update region", () => {
			expect(isInSlowUpdateRegion(skillWithSlowUpdate, "Some content")).toBe(false)
		})

		it("returns false when no slow update field exists", () => {
			expect(isInSlowUpdateRegion(skillWithoutSlowUpdate, "Some content")).toBe(false)
		})
	})

	describe("stripSlowUpdateMarkers", () => {
		it("removes markers but keeps content", () => {
			const result = stripSlowUpdateMarkers(
				"before <!-- SLOW_UPDATE_START -->content<!-- SLOW_UPDATE_END --> after",
			)
			expect(result).toBe("before content after")
		})
	})

	describe("injectEmptySlowUpdateField", () => {
		it("injects field when not present", () => {
			const result = injectEmptySlowUpdateField(skillWithoutSlowUpdate)
			expect(result).toContain("<!-- SLOW_UPDATE_START -->")
			expect(result).toContain("<!-- SLOW_UPDATE_END -->")
		})

		it("does not duplicate when already present", () => {
			const result = injectEmptySlowUpdateField(skillWithSlowUpdate)
			expect(result).toBe(skillWithSlowUpdate)
		})
	})

	describe("extractSlowUpdateField", () => {
		it("extracts content between markers", () => {
			const result = extractSlowUpdateField(skillWithSlowUpdate)
			expect(result).toBe("Strategic guidance content")
		})

		it("returns empty string when no field exists", () => {
			expect(extractSlowUpdateField(skillWithoutSlowUpdate)).toBe("")
		})
	})

	describe("stripAllSlowUpdateFields", () => {
		it("removes entire slow update block", () => {
			const result = stripAllSlowUpdateFields(skillWithSlowUpdate)
			expect(result).not.toContain("SLOW_UPDATE_START")
			expect(result).not.toContain("Strategic guidance")
		})
	})

	describe("replaceSlowUpdateField", () => {
		it("replaces content between markers", () => {
			const result = replaceSlowUpdateField(skillWithSlowUpdate, "New guidance")
			expect(result).toContain("<!-- SLOW_UPDATE_START -->")
			expect(result).toContain("New guidance")
			expect(result).toContain("<!-- SLOW_UPDATE_END -->")
			expect(result).not.toContain("Strategic guidance content")
		})

		it("injects field when not present", () => {
			const result = replaceSlowUpdateField(skillWithoutSlowUpdate, "New guidance")
			expect(result).toContain("<!-- SLOW_UPDATE_START -->")
			expect(result).toContain("New guidance")
		})
	})
})

describe("edit application", () => {
	const skill = "# My Skill\n\nSome content here.\n\nMore content."

	describe("applyEdit", () => {
		it("applies replace edit", () => {
			const edit: Edit = { op: "replace", search: "Some content", replace: "Replaced content" }
			const result = applyEdit(skill, edit)
			expect(result).toContain("Replaced content")
			expect(result).not.toContain("Some content")
		})

		it("applies insert edit", () => {
			const edit: Edit = { op: "insert", search: "More content", replace: "Inserted content" }
			const result = applyEdit(skill, edit)
			expect(result).toContain("Inserted content")
			expect(result).toContain("More content")
		})

		it("appends when insert search not found", () => {
			const edit: Edit = { op: "insert", search: "nonexistent", replace: "Appended content" }
			const result = applyEdit(skill, edit)
			expect(result).toContain("Appended content")
		})

		it("applies delete edit", () => {
			const edit: Edit = { op: "delete", search: "Some content", replace: "" }
			const result = applyEdit(skill, edit)
			expect(result).not.toContain("Some content")
		})

		it("returns original when replace search not found", () => {
			const edit: Edit = { op: "replace", search: "nonexistent", replace: "New" }
			const result = applyEdit(skill, edit)
			expect(result).toBe(skill)
		})

		it("returns original for unknown op", () => {
			const edit: Edit = { op: "unknown" as any, search: "test", replace: "test" }
			const result = applyEdit(skill, edit)
			expect(result).toBe(skill)
		})
	})

	describe("applyEditWithReport", () => {
		it("returns report with applied=true on success", () => {
			const edit: Edit = { op: "replace", search: "Some content", replace: "Replaced" }
			const [, report] = applyEditWithReport(skill, edit)
			expect(report.applied).toBe(true)
			expect(report.position).toBeGreaterThanOrEqual(0)
		})

		it("returns report with applied=false on failure", () => {
			const edit: Edit = { op: "replace", search: "nonexistent", replace: "New" }
			const [, report] = applyEditWithReport(skill, edit)
			expect(report.applied).toBe(false)
			expect(report.reason).toBeTruthy()
		})
	})
})

describe("patch application", () => {
	const skill = "# My Skill\n\nSome content here.\n\nMore content."

	it("applies all edits in a patch", () => {
		const patch: Patch = {
			reasoning: "Test patch",
			edits: [
				{ op: "replace", search: "Some content", replace: "Replaced A" },
				{ op: "replace", search: "More content", replace: "Replaced B" },
			],
			sourceType: "test",
			supportCount: 1,
		}
		const result = applyPatch(skill, patch)
		expect(result).toContain("Replaced A")
		expect(result).toContain("Replaced B")
		expect(result).not.toContain("Some content")
	})

	it("skips edits targeting slow update regions", () => {
		const skillWithSlowUpdate = `# My Skill\n\nSome content.\n\n<!-- SLOW_UPDATE_START -->\nProtected\n<!-- SLOW_UPDATE_END -->`
		const patch: Patch = {
			reasoning: "Test",
			edits: [
				{ op: "replace", search: "Protected", replace: "Should not change" },
				{ op: "replace", search: "Some content", replace: "Changed" },
			],
			sourceType: "test",
			supportCount: 1,
		}
		const [result, reports] = applyPatchWithReport(skillWithSlowUpdate, patch)
		expect(result).toContain("Protected") // unchanged
		expect(result).toContain("Changed")
		expect(reports[0].applied).toBe(false)
		expect(reports[0].reason).toContain("slow update")
		expect(reports[1].applied).toBe(true)
	})

	it("returns reports for each edit", () => {
		const patch: Patch = {
			reasoning: "Test",
			edits: [
				{ op: "replace", search: "Some content", replace: "Replaced" },
				{ op: "replace", search: "nonexistent", replace: "Nope" },
			],
			sourceType: "test",
			supportCount: 1,
		}
		const [, reports] = applyPatchWithReport(skill, patch)
		expect(reports).toHaveLength(2)
		expect(reports[0].applied).toBe(true)
		expect(reports[1].applied).toBe(false)
	})
})
