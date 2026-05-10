/**
 * Tests for telegramEngineer.js
 *
 * Run with: cd src && npx vitest run ../cloud/api/__tests__/test-telegram-engineer.test.js
 */

const path = require("path")
const engineerPath = path.join(__dirname, "..", "telegramEngineer.js")
const engineer = require(engineerPath)

describe("telegramEngineer", () => {
	describe("formatDebugPlan", () => {
		test("formats debug plan with incident ID and phases", () => {
			const result = {
				incidentId: "DBG-TEST123",
				phases: ["Reproduce the issue", "Check logs", "Fix the bug"],
			}
			const formatted = engineer.formatDebugPlan(result)
			expect(formatted).toContain("Debug Plan")
			expect(formatted).toContain("DBG-TEST123")
			expect(formatted).toContain("Reproduce the issue")
			expect(formatted).toContain("Check logs")
			expect(formatted).toContain("Fix the bug")
		})

		test("handles missing incidentId", () => {
			const result = { phases: ["Phase 1", "Phase 2"] }
			const formatted = engineer.formatDebugPlan(result)
			expect(formatted).toContain("Debug Plan")
			expect(formatted).toContain("Phase 1")
		})

		test("handles empty result", () => {
			const formatted = engineer.formatDebugPlan({})
			expect(formatted).toContain("Debug Plan")
		})
	})

	describe("formatLogsResult", () => {
		test("formats log entries", () => {
			const result = {
				logs: ["line 1", "line 2", "line 3"],
				target: "superroo-api",
			}
			const formatted = engineer.formatLogsResult(result)
			expect(formatted).toContain("Log Results")
			expect(formatted).toContain("line 1")
			expect(formatted).toContain("superroo-api")
		})

		test("limits to 10 log lines", () => {
			const logs = Array.from({ length: 15 }, (_, i) => "line " + (i + 1))
			const result = { logs, target: "test" }
			const formatted = engineer.formatLogsResult(result)
			const lineCount = (formatted.match(/line \d+/g) || []).length
			expect(lineCount).toBeLessThanOrEqual(12) // 10 lines + "+5 more" text
		})

		test("handles empty logs", () => {
			const formatted = engineer.formatLogsResult({})
			expect(formatted).toContain("Log Results")
		})
	})

	describe("formatTestResult", () => {
		test("formats passed tests", () => {
			const result = {
				passed: true,
				command: "npx vitest run",
				summary: "Tests: 10 passed, 10 total",
				output: "All tests passed!",
			}
			const formatted = engineer.formatTestResult(result)
			expect(formatted).toContain("Tests Passed")
			expect(formatted).toContain("npx vitest run")
			expect(formatted).toContain("10 passed")
		})

		test("formats failed tests", () => {
			const result = {
				passed: false,
				command: "npx vitest run",
				summary: "Tests: 8 passed, 2 failed",
				output: "Some tests failed",
			}
			const formatted = engineer.formatTestResult(result)
			expect(formatted).toContain("Tests Failed")
		})

		test("handles minimal result", () => {
			const formatted = engineer.formatTestResult({ passed: true })
			expect(formatted).toContain("Tests Passed")
		})
	})

	describe("formatBranchResult", () => {
		test("formats branch creation", () => {
			const result = {
				branch: "feature/test-branch",
				baseBranch: "main",
			}
			const formatted = engineer.formatBranchResult(result)
			expect(formatted).toContain("Branch Created")
			expect(formatted).toContain("feature/test-branch")
			expect(formatted).toContain("main")
		})

		test("handles missing baseBranch", () => {
			const formatted = engineer.formatBranchResult({ branch: "fix/thing" })
			expect(formatted).toContain("Branch Created")
			expect(formatted).toContain("fix/thing")
		})
	})

	describe("formatPrResult", () => {
		test("formats PR creation", () => {
			const result = {
				prUrl: "https://github.com/owner/repo/pull/42",
				prNumber: 42,
				title: "Fix the bug",
			}
			const formatted = engineer.formatPrResult(result)
			expect(formatted).toContain("Pull Request Created")
			expect(formatted).toContain("github.com")
			expect(formatted).toContain("#42")
			expect(formatted).toContain("Fix the bug")
		})

		test("handles missing fields", () => {
			const formatted = engineer.formatPrResult({})
			expect(formatted).toContain("Pull Request Created")
		})
	})

	describe("formatRestartResult", () => {
		test("formats successful restart", () => {
			const result = {
				ok: true,
				restarted: "superroo-api",
				message: "Worker restarted successfully",
			}
			const formatted = engineer.formatRestartResult(result)
			expect(formatted).toContain("Worker Restarted")
			expect(formatted).toContain("superroo-api")
		})

		test("formats failed restart", () => {
			const result = {
				ok: false,
				restarted: "superroo-api",
				message: "Failed to restart",
			}
			const formatted = engineer.formatRestartResult(result)
			expect(formatted).toContain("Restart Failed")
		})
	})

	describe("formatFallback", () => {
		test("formats JSON object as bullet list", () => {
			const input = JSON.stringify({ status: "ok", count: 42 })
			const formatted = engineer.formatFallback(input)
			expect(formatted).toContain("status")
			expect(formatted).toContain("count")
		})

		test("truncates long strings", () => {
			const long = "x".repeat(2000)
			const formatted = engineer.formatFallback(long)
			expect(formatted.length).toBeLessThanOrEqual(1000)
		})

		test("returns short strings as-is", () => {
			const formatted = engineer.formatFallback("hello world")
			expect(formatted).toBe("hello world")
		})
	})

	describe("seniorEngineerReply", () => {
		test("falls back to formatFallback when no providers", async () => {
			const result = await engineer.seniorEngineerReply("test input", [])
			expect(typeof result).toBe("string")
			expect(result.length).toBeGreaterThan(0)
		})

		test("falls back to formatFallback when providers is null", async () => {
			const result = await engineer.seniorEngineerReply("test input", null)
			expect(typeof result).toBe("string")
		})
	})
})
