import { describe, it, expect } from "vitest"
import { formatMetaSkillContext } from "../MetaSkill"

describe("formatMetaSkillContext", () => {
	it("returns content when present", () => {
		expect(formatMetaSkillContext("Some meta skill")).toBe("Some meta skill")
	})

	it("returns fallback when empty", () => {
		expect(formatMetaSkillContext("")).toBe("No previous meta skill available.")
	})

	it("returns fallback when whitespace only", () => {
		expect(formatMetaSkillContext("   ")).toBe("No previous meta skill available.")
	})
})
