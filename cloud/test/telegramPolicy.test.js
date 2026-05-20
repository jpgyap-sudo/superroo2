/**
 * Telegram Policy Unit Tests
 */
import { describe, it, expect } from "vitest"

// Must set env before requiring the module
process.env.REQUIRE_CODING_APPROVAL = "false"
const policy = require("../api/telegramPolicy")

describe("telegramPolicy", () => {
	describe("canRunWithoutApproval", () => {
		it("returns true for safe actions", () => {
			expect(policy.canRunWithoutApproval("chat")).toBe(true)
			expect(policy.canRunWithoutApproval("debug_plan")).toBe(true)
			expect(policy.canRunWithoutApproval("read_logs")).toBe(true)
			expect(policy.canRunWithoutApproval("run_tests")).toBe(true)
			expect(policy.canRunWithoutApproval("create_branch")).toBe(true)
			expect(policy.canRunWithoutApproval("create_pr")).toBe(true)
			expect(policy.canRunWithoutApproval("restart_worker")).toBe(true)
		})

		it("returns false for blocked actions", () => {
			expect(policy.canRunWithoutApproval("deploy")).toBe(false)
			expect(policy.canRunWithoutApproval("delete_data")).toBe(false)
			expect(policy.canRunWithoutApproval("shell")).toBe(false)
		})

		it("allows safe shell commands (read-only)", () => {
			expect(policy.canRunWithoutApproval("shell", "ls -la")).toBe(true)
			expect(policy.canRunWithoutApproval("shell", "cat package.json")).toBe(true)
			expect(policy.canRunWithoutApproval("shell", "ps aux")).toBe(true)
			expect(policy.canRunWithoutApproval("shell", "df -h")).toBe(true)
		})

		it("blocks destructive shell commands", () => {
			expect(policy.canRunWithoutApproval("shell", "rm -rf /")).toBe(false)
			expect(policy.canRunWithoutApproval("shell", "dd if=/dev/zero")).toBe(false)
			expect(policy.canRunWithoutApproval("shell", "mkfs.ext4 /dev/sda1")).toBe(false)
		})
	})

	describe("getBlockedReason", () => {
		it("returns appropriate reason for deploy", () => {
			var reason = policy.getBlockedReason("deploy")
			expect(reason).toContain("deploy")
			expect(reason).toContain("approval")
		})

		it("returns appropriate reason for shell", () => {
			var reason = policy.getBlockedReason("shell", "rm -rf /")
			expect(reason).toContain("shell")
		})
	})

	describe("isSafeShellCommand", () => {
		it("identifies read-only commands as safe", () => {
			expect(policy.isSafeShellCommand("ls")).toBe(true)
			expect(policy.isSafeShellCommand("cat file.txt")).toBe(true)
			expect(policy.isSafeShellCommand("grep pattern file")).toBe(true)
			expect(policy.isSafeShellCommand("pwd")).toBe(true)
		})

		it("identifies destructive commands as unsafe", () => {
			expect(policy.isSafeShellCommand("rm file")).toBe(false)
			expect(policy.isSafeShellCommand("mv a b")).toBe(false)
			expect(policy.isSafeShellCommand("chmod 777 file")).toBe(false)
		})
	})
})
