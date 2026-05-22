import { describe, expect, it } from "vitest"
import { validateSkillToolUse, validateSkillToolUseMulti } from "../SkillToolPolicy"
import type { SkillToolPolicy } from "../SkillToolPolicy"

describe("SkillToolPolicy", () => {
	describe("validateSkillToolUse", () => {
		it("allows any tool when policy is undefined", () => {
			expect(validateSkillToolUse(undefined, "read_file").allowed).toBe(true)
			expect(validateSkillToolUse(null, "write_to_file").allowed).toBe(true)
		})

		it("allows any tool when policy has no restrictions", () => {
			const policy: SkillToolPolicy = {}
			expect(validateSkillToolUse(policy, "read_file").allowed).toBe(true)
			expect(validateSkillToolUse(policy, "execute_command").allowed).toBe(true)
		})

		it("allows tools in allowedTools list", () => {
			const policy: SkillToolPolicy = {
				allowedTools: ["read_file", "search_files"],
			}
			expect(validateSkillToolUse(policy, "read_file").allowed).toBe(true)
			expect(validateSkillToolUse(policy, "search_files").allowed).toBe(true)
		})

		it("denies tools not in allowedTools list", () => {
			const policy: SkillToolPolicy = {
				allowedTools: ["read_file", "search_files"],
			}
			const result = validateSkillToolUse(policy, "execute_command")
			expect(result.allowed).toBe(false)
			expect(result.reason).toContain("execute_command")
			expect(result.reason).toContain("allowedTools")
		})

		it("denies tools in deniedTools list", () => {
			const policy: SkillToolPolicy = {
				deniedTools: ["execute_command", "write_to_file"],
			}
			const result = validateSkillToolUse(policy, "execute_command")
			expect(result.allowed).toBe(false)
			expect(result.reason).toContain("execute_command")
			expect(result.reason).toContain("deniedTools")
		})

		it("deniedTools takes precedence over allowedTools", () => {
			const policy: SkillToolPolicy = {
				allowedTools: ["read_file", "execute_command"],
				deniedTools: ["execute_command"],
			}
			// execute_command is in allowedTools but also in deniedTools — denied wins
			const result = validateSkillToolUse(policy, "execute_command")
			expect(result.allowed).toBe(false)
			expect(result.reason).toContain("deniedTools")
		})

		it("allows tools in allowedTools when deniedTools is empty", () => {
			const policy: SkillToolPolicy = {
				allowedTools: ["read_file"],
				deniedTools: [],
			}
			expect(validateSkillToolUse(policy, "read_file").allowed).toBe(true)
		})

		it("denies tools not in allowedTools even when deniedTools is empty", () => {
			const policy: SkillToolPolicy = {
				allowedTools: ["read_file"],
				deniedTools: [],
			}
			expect(validateSkillToolUse(policy, "write_to_file").allowed).toBe(false)
		})
	})

	describe("validateSkillToolUseMulti", () => {
		it("allows when all policies pass", () => {
			const policies: Array<SkillToolPolicy | undefined> = [
				{ allowedTools: ["read_file", "search_files"] },
				{ deniedTools: ["execute_command"] },
			]
			expect(validateSkillToolUseMulti(policies, "read_file").allowed).toBe(true)
			expect(validateSkillToolUseMulti(policies, "search_files").allowed).toBe(true)
		})

		it("denies when any policy denies", () => {
			const policies: Array<SkillToolPolicy | undefined> = [
				{ allowedTools: ["read_file", "search_files"] },
				{ deniedTools: ["search_files"] },
			]
			const result = validateSkillToolUseMulti(policies, "search_files")
			expect(result.allowed).toBe(false)
		})

		it("returns first denial reason", () => {
			const policies: Array<SkillToolPolicy | undefined> = [
				{ deniedTools: ["tool_a"] },
				{ deniedTools: ["tool_b"] },
			]
			const result = validateSkillToolUseMulti(policies, "tool_a")
			expect(result.allowed).toBe(false)
			expect(result.reason).toContain("tool_a")
		})

		it("handles undefined and null policies gracefully", () => {
			const policies: Array<SkillToolPolicy | undefined | null> = [
				undefined,
				null,
				{ allowedTools: ["read_file"] },
			]
			expect(validateSkillToolUseMulti(policies, "read_file").allowed).toBe(true)
			expect(validateSkillToolUseMulti(policies, "write_to_file").allowed).toBe(false)
		})

		it("returns allowed for empty policies array", () => {
			expect(validateSkillToolUseMulti([], "any_tool").allowed).toBe(true)
		})
	})
})
