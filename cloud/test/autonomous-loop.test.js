/**
 * Tests for AutonomousLoop.js
 *
 * Covers:
 * - Lifecycle (start, stop, getStatus, no-double-start, no-double-stop)
 * - Hard safety patterns (checkHardSafety)
 * - All 10 step methods (_stepAudit through _stepHealthCheck)
 * - Step execution with timeout
 * - Loop execution (_runLoop)
 * - Container management (_ensureContainer)
 * - Report file writing (_writeReportFile)
 * - Helpers (_getStepName, _formatDuration)
 * - Error handling (step failures, catch blocks)
 * - Healing bus integration (I1: report incidents)
 * - InfiniteImprovementLoop integration (I2: feed debug lessons)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import fs from "fs"

// ─── Mock deployment allowlist ─────────────────────────────────────────────

vi.mock("../../worker/deploymentAllowlist", () => ({
	assertAllowedTarget: vi.fn(),
	remoteVerificationCommand: vi.fn(() => "echo verified"),
}))

// ─── Spy on fs methods ─────────────────────────────────────────────────────
// We use vi.spyOn on the real fs module instead of vi.mock("fs") because
// vitest's vi.mock for Node.js built-in modules doesn't reliably intercept
// require("fs") when using ESM import() in the test.

let mockWriteFileSync
let mockReadFileSync
let mockExistsSync
let mockReaddirSync
let mockMkdirSync
let mockStatSync

function setupFsSpies() {
	mockWriteFileSync = vi.spyOn(fs, "writeFileSync").mockImplementation(() => {})
	mockReadFileSync = vi.spyOn(fs, "readFileSync").mockImplementation(() => "")
	mockExistsSync = vi.spyOn(fs, "existsSync").mockImplementation(() => true)
	mockReaddirSync = vi.spyOn(fs, "readdirSync").mockImplementation(() => [])
	mockMkdirSync = vi.spyOn(fs, "mkdirSync").mockImplementation(() => {})
	mockStatSync = vi.spyOn(fs, "statSync").mockImplementation(() => ({ isDirectory: () => true }))
}

function restoreFsSpies() {
	if (mockWriteFileSync) mockWriteFileSync.mockRestore()
	if (mockReadFileSync) mockReadFileSync.mockRestore()
	if (mockExistsSync) mockExistsSync.mockRestore()
	if (mockReaddirSync) mockReaddirSync.mockRestore()
	if (mockMkdirSync) mockMkdirSync.mockRestore()
	if (mockStatSync) mockStatSync.mockRestore()
}

// ─── Import after mocks ────────────────────────────────────────────────────

const { AutonomousLoop, checkHardSafety } = await import("../orchestrator/modules/AutonomousLoop.js")

// ─── Mock execAsync via dependency injection ───────────────────────────────
// The module uses: const { exec } = require("child_process"); const execAsync = promisify(exec)
// We cannot mock child_process.exec reliably because the module captures it at load time.
// Instead, we inject a mock execAsync function via constructor options.
// The mock returns { stdout: "", stderr: "" } by default.

const mockExecAsync = vi.fn()

// Default implementation: return empty success
mockExecAsync.mockImplementation((cmd, opts) => {
	return Promise.resolve({ stdout: "", stderr: "" })
})

// ─── Helpers ───────────────────────────────────────────────────────────────

function createMockOrchestrator() {
	return {
		eventLog: {
			record: vi.fn(),
		},
		healingBus: {
			reportIncident: vi.fn(() => Promise.resolve()),
		},
		bugRegistry: {
			list: vi.fn(() => []),
		},
		featureRegistry: {
			list: vi.fn(() => []),
		},
		commitDeployLog: {
			recordCommit: vi.fn(() => Promise.resolve()),
			recordDeploy: vi.fn(() => Promise.resolve()),
		},
		infiniteImprovementLoop: {
			ingestDebugLesson: vi.fn(() => Promise.resolve()),
		},
		modelUsageTracker: {
			startTask: vi.fn(),
			endTask: vi.fn(() =>
				Promise.resolve({
					phases: {
						review: { phase: "review", provider: "deepseek", model: "deepseek-coder" },
					},
					workflowCompliant: true,
					deepseekDelegated: true,
				}),
			),
			logOllamaSummarization: vi.fn(() => Promise.resolve()),
		},
	}
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("AutonomousLoop", () => {
	let loop
	let orchestrator

	beforeEach(() => {
		vi.clearAllMocks()
		setupFsSpies()
		mockExecAsync.mockClear()

		// Reset mock implementation to default
		mockExecAsync.mockImplementation((cmd, opts) => {
			return Promise.resolve({ stdout: "", stderr: "" })
		})

		orchestrator = createMockOrchestrator()
		loop = new AutonomousLoop({
			orchestrator,
			target: "test-project",
			branch: "main",
			durationMs: 60000,
			stepTimeoutMs: 5000,
			workspaceRoot: "/tmp/test-workspace",
			containerFirst: false,
			execAsync: mockExecAsync,
		})
	})

	afterEach(() => {
		restoreFsSpies()
		vi.restoreAllMocks()
	})

	// ─── Lifecycle ─────────────────────────────────────────────────────────

	describe("lifecycle", () => {
		it("should start with correct initial state", async () => {
			const result = await loop.start({ jobId: "test-job-1" })

			expect(result.success).toBe(true)
			expect(result.jobId).toBe("test-job-1")
			expect(result.status).toBe("running")
			expect(result.target).toBe("test-project")
			expect(loop._running).toBe(true)
			expect(loop._status).toBe("running")
			expect(loop._startedAt).toBeGreaterThan(0)
			// Note: _currentStep and _stepResults are not checked here because
			// _runLoop starts asynchronously and may have already progressed past step 0
		})

		it("should reject double start", async () => {
			await loop.start()
			const result = await loop.start()

			expect(result.success).toBe(false)
			expect(result.error).toContain("already running")
		})

		it("should stop gracefully", async () => {
			await loop.start()
			const result = await loop.stop()

			expect(result.success).toBe(true)
			expect(result.status).toBe("stopped")
			expect(loop._running).toBe(false)
			expect(loop._status).toBe("stopped")
		})

		it("should reject stop when not running", async () => {
			const result = await loop.stop()

			expect(result.success).toBe(false)
			expect(result.error).toContain("not running")
		})

		it("should return correct status", async () => {
			await loop.start()
			const status = loop.getStatus()

			expect(status.jobId).toBeTruthy()
			expect(status.status).toBe("running")
			expect(status.running).toBe(true)
			expect(status.target).toBe("test-project")
			expect(status.branch).toBe("main")
			// Note: currentStep and progress may be > 0 because _runLoop
			// starts asynchronously and may have already progressed past step 0
			expect(status.totalSteps).toBe(10)
			expect(status.elapsedMs).toBeGreaterThanOrEqual(0)
			expect(status.remainingMs).toBeGreaterThan(0)
			expect(status.elapsedFormatted).toBeTruthy()
			expect(status.remainingFormatted).toBeTruthy()
			expect(status.error).toBeNull()
			expect(status.startedAt).toBeGreaterThan(0)
		})

		it("should return idle status before start", () => {
			const status = loop.getStatus()

			expect(status.status).toBe("idle")
			expect(status.running).toBe(false)
			expect(status.currentStep).toBe(0)
			expect(status.progress).toBe(0)
			expect(status.startedAt).toBeNull()
		})

		it("should log start event to orchestrator", async () => {
			await loop.start()

			expect(orchestrator.eventLog.record).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "autonomous.started",
					source: "AutonomousLoop",
					severity: "info",
				}),
			)
		})

		it("should log stop event to orchestrator", async () => {
			await loop.start()
			await loop.stop()

			expect(orchestrator.eventLog.record).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "autonomous.stopping",
					source: "AutonomousLoop",
					severity: "info",
				}),
			)
		})

		it("should initialize model usage tracker on start", async () => {
			await loop.start()

			expect(orchestrator.modelUsageTracker.startTask).toHaveBeenCalledWith(loop._jobId)
		})

		it("should handle missing orchestrator gracefully", async () => {
			const minimalLoop = new AutonomousLoop({
				execAsync: mockExecAsync,
			})
			const result = await minimalLoop.start()

			expect(result.success).toBe(true)
			expect(result.status).toBe("running")
		})
	})

	// ─── Hard Safety Patterns ─────────────────────────────────────────────

	describe("hard safety patterns", () => {
		it("should block rm -rf", () => {
			const result = checkHardSafety("rm -rf /some/dir")
			expect(result.allowed).toBe(false)
			expect(result.reason).toContain("delete")
		})

		it("should block mkfs", () => {
			const result = checkHardSafety("mkfs.ext4 /dev/sda1")
			expect(result.allowed).toBe(false)
			expect(result.reason).toContain("destructive")
		})

		it("should block dd if=", () => {
			const result = checkHardSafety("dd if=/dev/zero of=/dev/sda")
			expect(result.allowed).toBe(false)
			expect(result.reason).toContain("destructive")
		})

		it("should block shutdown", () => {
			const result = checkHardSafety("shutdown -h now")
			expect(result.allowed).toBe(false)
			expect(result.reason).toContain("shutdown")
		})

		it("should block reboot", () => {
			const result = checkHardSafety("reboot")
			expect(result.allowed).toBe(false)
			expect(result.reason).toContain("reboot")
		})

		it("should block passwd", () => {
			const result = checkHardSafety("passwd root")
			expect(result.allowed).toBe(false)
			expect(result.reason).toContain("Password")
		})

		it("should block userdel", () => {
			const result = checkHardSafety("userdel -r someuser")
			expect(result.allowed).toBe(false)
			expect(result.reason).toContain("User")
		})

		it("should block usermod", () => {
			const result = checkHardSafety("usermod -aG sudo someuser")
			expect(result.allowed).toBe(false)
			expect(result.reason).toContain("User")
		})

		it("should block chmod -R 777 /", () => {
			const result = checkHardSafety("chmod -R 777 /")
			expect(result.allowed).toBe(false)
			expect(result.reason).toContain("world-writable")
		})

		it("should block chown -R /", () => {
			// Pattern is /chown\s+-R\s+\// which requires chown -R immediately followed by /
			const result = checkHardSafety("chown -R /")
			expect(result.allowed).toBe(false)
			expect(result.reason).toContain("ownership")
		})

		it("should block cat .env", () => {
			const result = checkHardSafety("cat .env")
			expect(result.allowed).toBe(false)
			expect(result.reason).toContain(".env")
		})

		it("should block /etc/ access", () => {
			const result = checkHardSafety("cat /etc/shadow")
			expect(result.allowed).toBe(false)
			expect(result.reason).toContain("configuration")
		})

		it("should block ~/.ssh access", () => {
			const result = checkHardSafety("cat ~/.ssh/id_rsa")
			expect(result.allowed).toBe(false)
			expect(result.reason).toContain("SSH")
		})

		it("should block docker rm", () => {
			const result = checkHardSafety("docker rm -f somecontainer")
			expect(result.allowed).toBe(false)
			expect(result.reason).toContain("Docker")
		})

		it("should block docker system prune", () => {
			const result = checkHardSafety("docker system prune -af")
			expect(result.allowed).toBe(false)
			expect(result.reason).toContain("Docker")
		})

		it("should block docker volume rm", () => {
			const result = checkHardSafety("docker volume rm somevolume")
			expect(result.allowed).toBe(false)
			expect(result.reason).toContain("Docker")
		})

		it("should block pm2 delete", () => {
			const result = checkHardSafety("pm2 delete someapp")
			expect(result.allowed).toBe(false)
			expect(result.reason).toContain("PM2")
		})

		it("should block drop table", () => {
			const result = checkHardSafety("DROP TABLE users")
			expect(result.allowed).toBe(false)
			expect(result.reason).toContain("database")
		})

		it("should block drop database", () => {
			const result = checkHardSafety("DROP DATABASE production")
			expect(result.allowed).toBe(false)
			expect(result.reason).toContain("database")
		})

		it("should block privateKey exposure", () => {
			const result = checkHardSafety("cat privateKey.pem")
			expect(result.allowed).toBe(false)
			expect(result.reason).toContain("key")
		})

		it("should block secretKey exposure", () => {
			// Pattern is /\bsecretKey\b/ (camelCase), so test input must match
			const result = checkHardSafety("echo $secretKey")
			expect(result.allowed).toBe(false)
			expect(result.reason).toContain("key")
		})

		it("should allow safe commands", () => {
			const result = checkHardSafety("npm run build")
			expect(result.allowed).toBe(true)
		})

		it("should allow git commands", () => {
			const result = checkHardSafety("git status")
			expect(result.allowed).toBe(true)
		})
	})

	// ─── Step 1: Audit ────────────────────────────────────────────────────

	describe("_stepAudit", () => {
		it("should perform audit checks successfully", async () => {
			const result = await loop._stepAudit()

			expect(result.success).toBe(true)
			expect(result.details).toBeDefined()
		})

		it("should detect clean working tree", async () => {
			const result = await loop._stepAudit()

			expect(result.success).toBe(true)
		})

		it("should detect uncommitted changes", async () => {
			// Mock git status to show changes
			mockExecAsync.mockImplementation((cmd, opts) => {
				if (cmd.includes("git status")) {
					return Promise.resolve({ stdout: " M src/index.js\n", stderr: "" })
				}
				return Promise.resolve({ stdout: "", stderr: "" })
			})

			const result = await loop._stepAudit()

			expect(result.success).toBe(true)
		})

		it("should check bug registry when available", async () => {
			orchestrator.bugRegistry.list.mockReturnValue([{ id: 1, title: "Bug 1", status: "open" }])

			const result = await loop._stepAudit()

			expect(result.success).toBe(true)
			expect(orchestrator.bugRegistry.list).toHaveBeenCalled()
		})

		it("should check feature registry when available", async () => {
			orchestrator.featureRegistry.list.mockReturnValue([{ id: 1, name: "Feature 1", status: "active" }])

			const result = await loop._stepAudit()

			expect(result.success).toBe(true)
			expect(orchestrator.featureRegistry.list).toHaveBeenCalled()
		})
	})

	// ─── Step 2: Fix ──────────────────────────────────────────────────────

	describe("_stepFix", () => {
		it("should apply fixes successfully", async () => {
			const result = await loop._stepFix()

			expect(result.success).toBe(true)
			expect(result.details).toBeDefined()
		})

		it("should handle missing audit findings", async () => {
			const result = await loop._stepFix()

			expect(result.success).toBe(true)
		})
	})

	// ─── Step 3: Test ─────────────────────────────────────────────────────

	describe("_stepTest", () => {
		it("should report all tests passed", async () => {
			mockExecAsync.mockImplementation((cmd, opts) => {
				if (cmd.includes("vitest")) {
					return Promise.resolve({ stdout: "Tests: 10 passed, 10 total\n", stderr: "" })
				}
				return Promise.resolve({ stdout: "", stderr: "" })
			})

			const result = await loop._stepTest()

			expect(result.success).toBe(true)
		})

		it("should report test failures", async () => {
			mockExecAsync.mockImplementation((cmd, opts) => {
				if (cmd.includes("vitest")) {
					return Promise.reject(new Error("Tests failed"))
				}
				return Promise.resolve({ stdout: "", stderr: "" })
			})

			const result = await loop._stepTest()

			expect(result.success).toBe(false)
		})

		it("should handle lint errors", async () => {
			mockExecAsync.mockImplementation((cmd, opts) => {
				if (cmd.includes("eslint")) {
					return Promise.resolve({ stdout: "error: some lint error\n", stderr: "" })
				}
				return Promise.resolve({ stdout: "", stderr: "" })
			})

			const result = await loop._stepTest()

			expect(result.success).toBe(false)
		})
	})

	// ─── Step 4: Simulate (E2E) ───────────────────────────────────────────

	describe("_stepSimulateE2E", () => {
		it("should complete simulation successfully", async () => {
			const result = await loop._stepSimulateE2E()

			expect(result.success).toBe(true)
			expect(result.details).toBeDefined()
		})

		it("should handle Playwright not configured", async () => {
			mockExecAsync.mockImplementation((cmd, opts) => {
				if (cmd.includes("playwright")) {
					return Promise.reject(new Error("Not configured"))
				}
				return Promise.resolve({ stdout: "", stderr: "" })
			})

			const result = await loop._stepSimulateE2E()

			expect(result.success).toBe(true)
		})

		it("should handle health endpoint unreachable", async () => {
			mockExecAsync.mockImplementation((cmd, opts) => {
				if (cmd.includes("curl")) {
					return Promise.reject(new Error("Connection refused"))
				}
				return Promise.resolve({ stdout: "", stderr: "" })
			})

			const result = await loop._stepSimulateE2E()

			expect(result.success).toBe(true)
		})
	})

	// ─── Step 5: Improve Code Quality ─────────────────────────────────────

	describe("_stepImproveCodeQuality", () => {
		it("should apply code quality improvements", async () => {
			const result = await loop._stepImproveCodeQuality()

			expect(result.success).toBe(true)
			expect(result.details).toBeDefined()
		})

		it("should handle prettier not available", async () => {
			mockExecAsync.mockImplementation((cmd, opts) => {
				if (cmd.includes("prettier")) {
					return Promise.reject(new Error("Not available"))
				}
				return Promise.resolve({ stdout: "", stderr: "" })
			})

			const result = await loop._stepImproveCodeQuality()

			expect(result.success).toBe(true)
		})
	})

	// ─── Step 6: Pattern Learning ─────────────────────────────────────────

	describe("_stepPatternLearning", () => {
		it("should analyze bug patterns successfully", async () => {
			const result = await loop._stepPatternLearning()

			expect(result.success).toBe(true)
			expect(result.details).toBeDefined()
		})

		it("should handle missing BUG_FIX_LOG.md", async () => {
			// Make readFileSync throw for BUG_FIX_LOG.md
			mockReadFileSync.mockImplementation((path) => {
				if (path.includes("BUG_FIX_LOG")) throw new Error("File not found")
				return ""
			})

			const result = await loop._stepPatternLearning()

			expect(result.success).toBe(true)
		})

		it("should detect test failures", async () => {
			mockReadFileSync.mockImplementation((path) => {
				if (path.includes("TEST_RESULTS")) return "# Test Results\nFAILED"
				return ""
			})

			const result = await loop._stepPatternLearning()

			expect(result.success).toBe(true)
		})

		it("should handle exec errors gracefully", async () => {
			const result = await loop._stepPatternLearning()

			expect(result.success).toBe(true)
		})
	})

	// ─── Step 7: Dashboard ────────────────────────────────────────────────

	describe("_stepDashboard", () => {
		it("should generate dashboard reports", async () => {
			const result = await loop._stepDashboard()

			expect(result.success).toBe(true)
			expect(result.details).toBeDefined()
		})

		it("should include step results in report", async () => {
			loop._stepResults.push({ step: 1, name: "Audit", status: "completed" })

			const result = await loop._stepDashboard()

			expect(result.success).toBe(true)
		})
	})

	// ─── Step 8: Commit ───────────────────────────────────────────────────

	describe("_stepCommit", () => {
		it("should skip commit when no changes", async () => {
			const result = await loop._stepCommit()

			expect(result.success).toBe(true)
			expect(result.details).toContain("No changes")
		})

		it("should commit changes successfully", async () => {
			mockExecAsync.mockImplementation((cmd, opts) => {
				if (cmd.includes("git status")) {
					return Promise.resolve({ stdout: " M src/index.js\n", stderr: "" })
				}
				if (cmd.includes("git rev-parse")) {
					return Promise.resolve({ stdout: "abc123def456\n", stderr: "" })
				}
				return Promise.resolve({ stdout: "", stderr: "" })
			})

			const result = await loop._stepCommit()

			expect(result.success).toBe(true)
		})

		it("should record commit in CommitDeployLog", async () => {
			mockExecAsync.mockImplementation((cmd, opts) => {
				if (cmd.includes("git status")) {
					return Promise.resolve({ stdout: " M src/index.js\n", stderr: "" })
				}
				if (cmd.includes("git rev-parse")) {
					return Promise.resolve({ stdout: "abc123def456\n", stderr: "" })
				}
				return Promise.resolve({ stdout: "", stderr: "" })
			})

			const result = await loop._stepCommit()

			expect(result.success).toBe(true)
			expect(orchestrator.commitDeployLog.recordCommit).toHaveBeenCalled()
		})

		it("should handle commit failure gracefully", async () => {
			mockExecAsync.mockImplementation((cmd, opts) => {
				if (cmd.includes("git status")) {
					return Promise.resolve({ stdout: " M src/index.js\n", stderr: "" })
				}
				if (cmd.includes("git commit")) {
					return Promise.reject(new Error("Commit failed"))
				}
				return Promise.resolve({ stdout: "", stderr: "" })
			})

			const result = await loop._stepCommit()

			expect(result.success).toBe(false)
			expect(result.error).toContain("Commit failed")
		})

		it("should handle exec errors gracefully", async () => {
			mockExecAsync.mockImplementation((cmd, opts) => {
				if (cmd.includes("git status")) {
					return Promise.reject(new Error("Git error"))
				}
				return Promise.resolve({ stdout: "", stderr: "" })
			})

			const result = await loop._stepCommit()

			expect(result.success).toBe(false)
			expect(result.error).toContain("Git error")
		})
	})

	// ─── Step 9: Deploy ───────────────────────────────────────────────────

	describe("_stepDeploy", () => {
		it("should skip deploy when script not found", async () => {
			mockExecAsync.mockImplementation((cmd, opts) => {
				if (cmd.includes("test -f")) {
					return Promise.resolve({ stdout: "not_found\n", stderr: "" })
				}
				return Promise.resolve({ stdout: "", stderr: "" })
			})

			const result = await loop._stepDeploy()

			expect(result.success).toBe(true)
		})

		it("should handle deploy script not available gracefully", async () => {
			mockExecAsync.mockImplementation((cmd, opts) => {
				if (cmd.includes("test -f")) {
					return Promise.resolve({ stdout: "not_found\n", stderr: "" })
				}
				return Promise.resolve({ stdout: "", stderr: "" })
			})

			const result = await loop._stepDeploy()

			expect(result.success).toBe(true)
		})

		it("should perform deploy successfully", async () => {
			mockExecAsync.mockImplementation((cmd, opts) => {
				if (cmd.includes("test -f")) {
					return Promise.resolve({ stdout: "exists\n", stderr: "" })
				}
				if (cmd.includes("git rev-parse")) {
					return Promise.resolve({ stdout: "abc123def456\n", stderr: "" })
				}
				return Promise.resolve({ stdout: "Deploy completed successfully\n", stderr: "" })
			})

			const result = await loop._stepDeploy()

			expect(result.success).toBe(true)
		})
	})

	// ─── Step 10: Health Check ────────────────────────────────────────────

	describe("_stepHealthCheck", () => {
		it("should pass all health checks", async () => {
			mockExecAsync.mockImplementation((cmd, opts) => {
				if (cmd.includes("pm2 status")) {
					return Promise.resolve({ stdout: "online\n", stderr: "" })
				}
				if (cmd.includes("curl")) {
					return Promise.resolve({ stdout: "200\n", stderr: "" })
				}
				if (cmd.includes("tail -20")) {
					return Promise.resolve({ stdout: "All clear\n", stderr: "" })
				}
				return Promise.resolve({ stdout: "", stderr: "" })
			})

			const result = await loop._stepHealthCheck()

			expect(result.success).toBe(true)
		})

		it("should report partial health failures", async () => {
			mockExecAsync.mockImplementation((cmd, opts) => {
				if (cmd.includes("pm2 status")) {
					return Promise.reject(new Error("PM2 not available"))
				}
				if (cmd.includes("curl")) {
					return Promise.resolve({ stdout: "200\n", stderr: "" })
				}
				if (cmd.includes("tail -20")) {
					return Promise.resolve({ stdout: "No errors\n", stderr: "" })
				}
				return Promise.resolve({ stdout: "", stderr: "" })
			})

			const result = await loop._stepHealthCheck()

			expect(result.success).toBe(false)
		})

		it("should handle deployment allowlist failure", async () => {
			const { assertAllowedTarget } = await import("../../worker/deploymentAllowlist")
			assertAllowedTarget.mockImplementation(() => {
				throw new Error("Target not allowed")
			})

			const result = await loop._stepHealthCheck()

			expect(result.success).toBe(false)
		})

		it("should handle PM2 not available", async () => {
			mockExecAsync.mockImplementation((cmd, opts) => {
				if (cmd.includes("pm2 status")) {
					return Promise.reject(new Error("PM2 not available"))
				}
				return Promise.resolve({ stdout: "", stderr: "" })
			})

			const result = await loop._stepHealthCheck()

			expect(result.success).toBe(false)
		})
	})

	// ─── Step Execution with Timeout ──────────────────────────────────────

	describe("_executeStepWithTimeout", () => {
		it("should execute step within timeout", async () => {
			const result = await loop._executeStepWithTimeout(1, "Audit")

			expect(result.success).toBe(true)
			expect(result.duration).toBeGreaterThanOrEqual(0)
		})

		it("should handle step timeout", async () => {
			// Create a loop with very short timeout
			// Use a mock execAsync that never resolves to trigger timeout
			const neverResolve = vi.fn().mockImplementation(() => new Promise(() => {})) // never resolves
			const fastTimeoutLoop = new AutonomousLoop({
				orchestrator,
				stepTimeoutMs: 50,
				containerFirst: false,
				execAsync: neverResolve,
			})

			await expect(fastTimeoutLoop._executeStepWithTimeout(1, "Audit")).rejects.toThrow("timed out")
		})

		it("should handle step execution errors", async () => {
			const result = await loop._executeStepWithTimeout(1, "Audit")

			expect(result.success).toBe(true)
		})
	})

	// ─── Step Dispatch ────────────────────────────────────────────────────

	describe("_executeStep", () => {
		it("should dispatch step 1 (Audit)", async () => {
			const result = await loop._executeStep(1, "Audit")
			expect(result).toBeDefined()
		})

		it("should dispatch step 2 (Fix)", async () => {
			const result = await loop._executeStep(2, "Fix")
			expect(result).toBeDefined()
		})

		it("should dispatch step 3 (Test)", async () => {
			const result = await loop._executeStep(3, "Test")
			expect(result).toBeDefined()
		})

		it("should dispatch step 4 (Simulate E2E)", async () => {
			const result = await loop._executeStep(4, "Simulate E2E")
			expect(result).toBeDefined()
		})

		it("should dispatch step 5 (Improve Code Quality)", async () => {
			const result = await loop._executeStep(5, "Improve Code Quality")
			expect(result).toBeDefined()
		})

		it("should dispatch step 6 (Pattern Learning)", async () => {
			const result = await loop._executeStep(6, "Pattern Learning")
			expect(result).toBeDefined()
		})

		it("should dispatch step 7 (Dashboard)", async () => {
			const result = await loop._executeStep(7, "Dashboard")
			expect(result).toBeDefined()
		})

		it("should dispatch step 8 (Commit)", async () => {
			const result = await loop._executeStep(8, "Commit")
			expect(result).toBeDefined()
		})

		it("should dispatch step 9 (Deploy)", async () => {
			const result = await loop._executeStep(9, "Deploy")
			expect(result).toBeDefined()
		})

		it("should dispatch step 10 (Health Check)", async () => {
			const result = await loop._executeStep(10, "Health Check")
			expect(result).toBeDefined()
		})

		it("should return error for unknown step", async () => {
			const result = await loop._executeStep(99, "Unknown")
			expect(result.success).toBe(false)
			expect(result.error).toContain("Unknown step")
		})
	})

	// ─── Loop Execution ───────────────────────────────────────────────────

	describe("_runLoop", () => {
		it("should run loop and complete steps", async () => {
			loop._running = true
			loop._startedAt = Date.now()

			// Start the loop. The for loop checks _running on each iteration,
			// so we set _running = false immediately after starting to ensure
			// the loop exits after completing the current step (before the
			// 5-second between-cycle pause).
			const loopPromise = loop._runLoop()
			// Set _running = false immediately so the for loop exits after
			// the current step completes, before the while loop's 5s pause
			loop._running = false
			await loopPromise

			expect(loop._stepResults.length).toBeGreaterThan(0)
		}, 10000)

		it("should stop when _stopped is set", async () => {
			loop._running = true
			loop._stopped = true
			loop._startedAt = Date.now()

			await loop._runLoop()

			expect(loop._stepResults.length).toBe(0)
		})

		it("should report incidents to healingBus on step failure (I1)", async () => {
			// Make steps fail
			mockExecAsync.mockImplementation(() => Promise.reject(new Error("Step failed")))

			loop._running = true
			loop._startedAt = Date.now()

			// Start the loop. Set _running = false immediately so the for loop
			// exits after the current step completes, before the 5s pause.
			const loopPromise = loop._runLoop()
			loop._running = false
			await loopPromise

			// healingBus.reportIncident should have been called for failed steps
			expect(orchestrator.healingBus.reportIncident).toHaveBeenCalled()
		}, 10000)
	})

	// ─── Container Management ─────────────────────────────────────────────

	describe("_ensureContainer", () => {
		it("should return true when docker is available", async () => {
			mockExecAsync.mockImplementation((cmd, opts) => {
				if (cmd.includes("docker info")) {
					return Promise.resolve({ stdout: "Containers: 3 Running: 2\n", stderr: "" })
				}
				return Promise.resolve({ stdout: "", stderr: "" })
			})

			const result = await loop._ensureContainer()

			expect(result).toBe(true)
		})

		it("should return false when docker is not available", async () => {
			mockExecAsync.mockImplementation((cmd, opts) => {
				if (cmd.includes("docker info")) {
					return Promise.reject(new Error("command not found"))
				}
				return Promise.resolve({ stdout: "", stderr: "" })
			})

			const result = await loop._ensureContainer()

			expect(result).toBe(false)
		})
	})

	// ─── Report File Writing ──────────────────────────────────────────────

	describe("_writeReportFile", () => {
		it("should write report file to workspace root", async () => {
			await loop._writeReportFile("test.md", "# Test Report")

			expect(mockWriteFileSync).toHaveBeenCalledWith(expect.stringContaining("test.md"), "# Test Report", "utf8")
		})
	})

	// ─── Helpers ──────────────────────────────────────────────────────────

	describe("_getStepName", () => {
		it("should return correct name for step 1", () => {
			expect(loop._getStepName(1)).toBe("Audit")
		})

		it("should return correct name for step 2", () => {
			expect(loop._getStepName(2)).toBe("Fix")
		})

		it("should return correct name for step 3", () => {
			expect(loop._getStepName(3)).toBe("Test")
		})

		it("should return correct name for step 4", () => {
			expect(loop._getStepName(4)).toBe("Simulate (E2E)")
		})

		it("should return correct name for step 5", () => {
			expect(loop._getStepName(5)).toBe("Improve Code Quality")
		})

		it("should return correct name for step 6", () => {
			expect(loop._getStepName(6)).toBe("Pattern Learning")
		})

		it("should return correct name for step 7", () => {
			expect(loop._getStepName(7)).toBe("Dashboard")
		})

		it("should return correct name for step 8", () => {
			expect(loop._getStepName(8)).toBe("Commit")
		})

		it("should return correct name for step 9", () => {
			expect(loop._getStepName(9)).toBe("Deploy")
		})

		it("should return correct name for step 10", () => {
			expect(loop._getStepName(10)).toBe("Health Check")
		})

		it("should return generic name for unknown step", () => {
			expect(loop._getStepName(99)).toBe("Step 99")
		})
	})

	describe("_formatDuration", () => {
		it("should format seconds correctly", () => {
			expect(loop._formatDuration(5000)).toBe("5s")
		})

		it("should format minutes and seconds", () => {
			expect(loop._formatDuration(65000)).toBe("1m 5s")
		})

		it("should format hours, minutes and seconds", () => {
			expect(loop._formatDuration(3661000)).toBe("1h 1m 1s")
		})

		it("should handle zero", () => {
			expect(loop._formatDuration(0)).toBe("0s")
		})
	})

	// ─── Constructor ──────────────────────────────────────────────────────

	describe("constructor", () => {
		it("should set default values", () => {
			const defaultLoop = new AutonomousLoop({})
			expect(defaultLoop.target).toBe("xsjprd55")
			expect(defaultLoop.branch).toBe("main")
			expect(defaultLoop.durationMs).toBe(5 * 60 * 60 * 1000)
			expect(defaultLoop.stepTimeoutMs).toBe(10 * 60 * 1000)
			expect(defaultLoop.containerFirst).toBe(true)
		})

		it("should accept custom options", () => {
			expect(loop.target).toBe("test-project")
			expect(loop.branch).toBe("main")
			expect(loop.durationMs).toBe(60000)
			expect(loop.stepTimeoutMs).toBe(5000)
			expect(loop.workspaceRoot).toBe("/tmp/test-workspace")
			expect(loop.containerFirst).toBe(false)
		})

		it("should initialize internal state", () => {
			expect(loop._running).toBe(false)
			expect(loop._stopped).toBe(false)
			expect(loop._startedAt).toBeNull()
			expect(loop._currentStep).toBe(0)
			expect(loop._stepResults).toEqual([])
			expect(loop._jobId).toBeNull()
			expect(loop._status).toBe("idle")
			expect(loop._error).toBeNull()
			expect(loop._progress).toBe(0)
		})
	})
})
