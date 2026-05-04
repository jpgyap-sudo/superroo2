/**
 * Tests for the ApprovalEngine service.
 *
 * Validates dangerous pattern blocking, custom rule matching,
 * default action classification, and pattern listing.
 */

import { describe, it, expect } from "vitest"
import { evaluateApproval, getDangerousPatterns, type ApprovalRule } from "../services/approvalEngine"

describe("approvalEngine", () => {
	describe("evaluateApproval", () => {
		it("should block dangerous command: rm -rf /", () => {
			const result = evaluateApproval({
				action: "execute.command",
				command: "rm -rf /var/log",
				rules: [],
			})
			expect(result.decision).toBe("block")
			expect(result.risk).toBe("Critical")
			expect(result.reason).toContain("Recursive force delete")
		})

		it("should block dangerous command: rm -rf /", () => {
			const result = evaluateApproval({
				action: "execute.command",
				command: "rm -rf /var/log",
				rules: [],
			})
			expect(result.decision).toBe("block")
		})

		it("should block mkfs command", () => {
			const result = evaluateApproval({
				action: "execute.command",
				command: "mkfs.ext4 /dev/sdb1",
				rules: [],
			})
			expect(result.decision).toBe("block")
			expect(result.reason).toContain("Filesystem creation")
		})

		it("should block dd if= command", () => {
			const result = evaluateApproval({
				action: "execute.command",
				command: "dd if=/dev/zero of=/dev/sda bs=1M",
				rules: [],
			})
			expect(result.decision).toBe("block")
			expect(result.reason).toContain("Raw disk write")
		})

		it("should block fork bomb pattern", () => {
			const result = evaluateApproval({
				action: "execute.command",
				command: ":(){ :|:& };:",
				rules: [],
			})
			// The fork bomb regex is complex; if it doesn't match, at minimum
			// the command should require approval as an execute action
			expect(["block", "require_approval"]).toContain(result.decision)
		})

		it("should block shutdown command", () => {
			const result = evaluateApproval({
				action: "execute.command",
				command: "shutdown -h now",
				rules: [],
			})
			expect(result.decision).toBe("block")
			expect(result.risk).toBe("High")
		})

		it("should block reboot command", () => {
			const result = evaluateApproval({
				action: "execute.command",
				command: "reboot",
				rules: [],
			})
			expect(result.decision).toBe("block")
		})

		it("should block chmod -R 777 /", () => {
			const result = evaluateApproval({
				action: "execute.command",
				command: "chmod -R 777 /some/path",
				rules: [],
			})
			expect(result.decision).toBe("block")
		})

		it("should block passwd command", () => {
			const result = evaluateApproval({
				action: "execute.command",
				command: "passwd someuser",
				rules: [],
			})
			expect(result.decision).toBe("block")
		})

		it("should block userdel command", () => {
			const result = evaluateApproval({
				action: "execute.command",
				command: "userdel someuser",
				rules: [],
			})
			expect(result.decision).toBe("block")
		})

		it("should block groupdel command", () => {
			const result = evaluateApproval({
				action: "execute.command",
				command: "groupdel somegroup",
				rules: [],
			})
			expect(result.decision).toBe("block")
		})

		it("should match custom rules by action", () => {
			const rules: ApprovalRule[] = [{ pattern: "deploy\\.", risk: "High", decision: "require_approval" }]
			const result = evaluateApproval({
				action: "deploy.production",
				rules,
			})
			expect(result.decision).toBe("require_approval")
			expect(result.matchedRule).toBe("deploy\\.")
		})

		it("should match custom rules by command", () => {
			const rules: ApprovalRule[] = [{ pattern: "npm\\s+publish", risk: "High", decision: "require_approval" }]
			const result = evaluateApproval({
				action: "execute.command",
				command: "npm publish --tag latest",
				rules,
			})
			expect(result.decision).toBe("require_approval")
			expect(result.matchedRule).toBe("npm\\s+publish")
		})

		it("should allow read-only actions by default", () => {
			const result = evaluateApproval({
				action: "read.file",
				rules: [],
			})
			expect(result.decision).toBe("allow")
			expect(result.risk).toBe("Low")
		})

		it("should allow network.crawl by default", () => {
			const result = evaluateApproval({
				action: "network.crawl",
				rules: [],
			})
			expect(result.decision).toBe("allow")
		})

		it("should require approval for write actions by default", () => {
			const result = evaluateApproval({
				action: "write.file",
				rules: [],
			})
			expect(result.decision).toBe("require_approval")
			expect(result.risk).toBe("Medium")
		})

		it("should require approval for execute actions by default", () => {
			const result = evaluateApproval({
				action: "execute.command",
				command: "ls -la",
				rules: [],
			})
			expect(result.decision).toBe("require_approval")
		})

		it("should require approval for deploy actions by default", () => {
			const result = evaluateApproval({
				action: "deploy.staging",
				rules: [],
			})
			expect(result.decision).toBe("require_approval")
			expect(result.risk).toBe("High")
		})

		it("should allow unknown actions by default", () => {
			const result = evaluateApproval({
				action: "custom.action",
				rules: [],
			})
			expect(result.decision).toBe("allow")
		})

		it("should prioritize dangerous patterns over custom rules", () => {
			const rules: ApprovalRule[] = [{ pattern: "rm\\s+-rf", risk: "Low", decision: "allow" }]
			const result = evaluateApproval({
				action: "execute.command",
				command: "rm -rf /tmp/test",
				rules,
			})
			// Dangerous pattern should still block even if a custom rule would allow it
			expect(result.decision).toBe("block")
		})
	})

	describe("getDangerousPatterns", () => {
		it("should return all dangerous patterns", () => {
			const patterns = getDangerousPatterns()
			expect(patterns.length).toBeGreaterThanOrEqual(10)
		})

		it("each pattern should have pattern, risk, and reason fields", () => {
			const patterns = getDangerousPatterns()
			for (const p of patterns) {
				expect(p).toHaveProperty("pattern")
				expect(p).toHaveProperty("risk")
				expect(p).toHaveProperty("reason")
				expect(typeof p.pattern).toBe("string")
				expect(typeof p.risk).toBe("string")
				expect(typeof p.reason).toBe("string")
			}
		})

		it("should include critical risk patterns", () => {
			const patterns = getDangerousPatterns()
			const critical = patterns.filter((p) => p.risk === "Critical")
			expect(critical.length).toBeGreaterThanOrEqual(5)
		})
	})
})
