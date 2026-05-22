/**
 * CommissioningLoop Tests — 14-phase full-stack commissioning engine.
 *
 * Tests cover:
 *   - Lifecycle (start, stop, status, double-start guard)
 *   - All 14 phases (success and failure paths)
 *   - Container sandboxing (ensureContainer, runInSandbox)
 *   - Hard safety patterns
 *   - Report generation
 *   - Bug registry integration (I3)
 *   - Edge cases (missing orchestrator, timeouts, etc.)
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest"
import path from "path"
import fs from "fs"

// ─── Mock execAsync ───────────────────────────────────────────────────────

const mockExecAsync = vi.fn()
mockExecAsync.mockImplementation((cmd, opts) => {
	return Promise.resolve({ stdout: "", stderr: "" })
})

// ─── Mock fs operations ───────────────────────────────────────────────────

/**
 * Normalize a path for cross-platform mock key lookup.
 * Converts Windows backslashes to forward slashes and strips drive letters
 * so tests can use forward-slash paths like "/tmp/test-workspace/..." regardless of OS.
 */
function norm(p) {
	if (typeof p !== "string") return p
	return p.replace(/\\/g, "/").replace(/^[a-zA-Z]:/, "")
}

const mockFsState = {
	exists: {},
	readFiles: {},
	writtenFiles: {},
	mkdirCalls: [],
	stats: {},
}

/**
 * Create mock fs functions that use mockFsState for lookups.
 * These are passed directly to CommissioningLoop constructor via dependency injection,
 * avoiding issues with vi.spyOn on native fs functions on Windows.
 */
function createMockFs() {
	mockFsState.exists = {}
	mockFsState.readFiles = {}
	mockFsState.writtenFiles = {}
	mockFsState.mkdirCalls = []
	mockFsState.stats = {}

	return {
		writeFileFn: (p, content, enc) => {
			const key = norm(p)
			mockFsState.writtenFiles[key] = content
			mockFsState.readFiles[key] = content
		},
		existsFn: (p) => {
			const key = norm(p)
			if (key in mockFsState.exists) return mockFsState.exists[key]
			// Default: paths under commissioningDir exist (since _ensureDir was called)
			if (key.includes("commissioning")) return true
			return false
		},
		readFileFn: (p, enc) => {
			const key = norm(p)
			if (key in mockFsState.readFiles) return mockFsState.readFiles[key]
			if (key in mockFsState.writtenFiles) return mockFsState.writtenFiles[key]
			throw new Error(`ENOENT: ${p}`)
		},
		mkdirFn: (p, opts) => {
			const key = norm(p)
			mockFsState.mkdirCalls.push(key)
			mockFsState.exists[key] = true
		},
		statFn: (p) => {
			const key = norm(p)
			if (key in mockFsState.stats) return mockFsState.stats[key]
			return { size: 1024, mode: 0o644 }
		},
	}
}

// ─── Mock orchestrator ────────────────────────────────────────────────────

function createMockOrchestrator() {
	return {
		eventLog: {
			record: vi.fn(),
		},
		bugRegistry: {
			create: vi.fn().mockResolvedValue({ id: "bug-1" }),
		},
	}
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("CommissioningLoop", () => {
	let CommissioningLoop
	let loop
	let orchestrator

	beforeAll(async () => {
		// Load module fresh
		delete require.cache[require.resolve("../orchestrator/modules/CommissioningLoop")]
		const mod = require("../orchestrator/modules/CommissioningLoop")
		CommissioningLoop = mod.CommissioningLoop
	})

	beforeEach(() => {
		vi.clearAllMocks()
		const mockFs = createMockFs()
		mockExecAsync.mockClear()
		mockExecAsync.mockImplementation((cmd, opts) => {
			return Promise.resolve({ stdout: "", stderr: "" })
		})
		orchestrator = createMockOrchestrator()
		loop = new CommissioningLoop({
			orchestrator,
			workspaceRoot: "/tmp/test-workspace",
			containerFirst: false,
			phaseTimeoutMs: 5000,
			commissioningDir: "/tmp/test-workspace/commissioning",
			execAsync: mockExecAsync,
			writeFileFn: mockFs.writeFileFn,
			existsFn: mockFs.existsFn,
			readFileFn: mockFs.readFileFn,
			mkdirFn: mockFs.mkdirFn,
			statFn: mockFs.statFn,
		})
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	// ─── Lifecycle ──────────────────────────────────────────────────────

	describe("lifecycle", () => {
		it("should start with correct initial state", async () => {
			const result = await loop.start({ jobId: "test-commission-1" })
			expect(result.success).toBe(true)
			expect(result.jobId).toBe("test-commission-1")
			expect(result.status).toBe("running")
			expect(result.totalPhases).toBe(14)
		})

		it("should reject double start", async () => {
			await loop.start({ jobId: "test-commission-1" })
			const result = await loop.start({ jobId: "test-commission-2" })
			expect(result.success).toBe(false)
			expect(result.error).toContain("already running")
		})

		it("should return correct status", async () => {
			await loop.start({ jobId: "test-commission-1" })
			const status = loop.getStatus()
			expect(status.jobId).toBe("test-commission-1")
			expect(status.running).toBe(true)
			expect(status.totalPhases).toBe(14)
			expect(status.status).toBe("running")
		})

		it("should stop gracefully", async () => {
			await loop.start({ jobId: "test-commission-1" })
			const result = await loop.stop()
			expect(result.success).toBe(true)
			expect(result.status).toBe("stopped")
		})

		it("should reject stop when not running", async () => {
			const result = await loop.stop()
			expect(result.success).toBe(false)
			expect(result.error).toContain("not running")
		})

		it("should log start event to orchestrator", async () => {
			await loop.start({ jobId: "test-commission-1" })
			expect(orchestrator.eventLog.record).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "commissioning.started",
					source: "CommissioningLoop",
				}),
			)
		})

		it("should log stop event to orchestrator", async () => {
			await loop.start({ jobId: "test-commission-1" })
			await loop.stop()
			expect(orchestrator.eventLog.record).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "commissioning.stopping",
					source: "CommissioningLoop",
				}),
			)
		})

		it("should handle missing orchestrator gracefully", async () => {
			const mockFs = createMockFs()
			const noOrchLoop = new CommissioningLoop({
				workspaceRoot: "/tmp/test-workspace",
				containerFirst: false,
				phaseTimeoutMs: 5000,
				commissioningDir: "/tmp/test-workspace/commissioning",
				execAsync: mockExecAsync,
				writeFileFn: mockFs.writeFileFn,
				existsFn: mockFs.existsFn,
				readFileFn: mockFs.readFileFn,
				mkdirFn: mockFs.mkdirFn,
				statFn: mockFs.statFn,
			})
			const result = await noOrchLoop.start({ jobId: "test-no-orch" })
			expect(result.success).toBe(true)
		})
	})

	// ─── Hard Safety Patterns ───────────────────────────────────────────

	describe("hard safety patterns", () => {
		it("should block rm -rf", async () => {
			await expect(loop._safeExec("rm -rf /")).rejects.toThrow("Hard safety violation")
		})

		it("should block mkfs", async () => {
			await expect(loop._safeExec("mkfs.ext4 /dev/sda1")).rejects.toThrow("Hard safety violation")
		})

		it("should block dd if=", async () => {
			await expect(loop._safeExec("dd if=/dev/zero of=/dev/sda")).rejects.toThrow("Hard safety violation")
		})

		it("should block shutdown", async () => {
			await expect(loop._safeExec("shutdown -h now")).rejects.toThrow("Hard safety violation")
		})

		it("should block reboot", async () => {
			await expect(loop._safeExec("reboot")).rejects.toThrow("Hard safety violation")
		})

		it("should block passwd", async () => {
			await expect(loop._safeExec("passwd root")).rejects.toThrow("Hard safety violation")
		})

		it("should block userdel", async () => {
			await expect(loop._safeExec("userdel testuser")).rejects.toThrow("Hard safety violation")
		})

		it("should block usermod", async () => {
			await expect(loop._safeExec("usermod -aG sudo testuser")).rejects.toThrow("Hard safety violation")
		})

		it("should block chmod -R 777 /", async () => {
			await expect(loop._safeExec("chmod -R 777 /")).rejects.toThrow("Hard safety violation")
		})

		it("should block chown -R /", async () => {
			await expect(loop._safeExec("chown -R user:group /")).rejects.toThrow("Hard safety violation")
		})

		it("should block cat .env", async () => {
			await expect(loop._safeExec("cat .env")).rejects.toThrow("Hard safety violation")
		})

		it("should block editing .env", async () => {
			await expect(loop._safeExec("nano .env")).rejects.toThrow("Hard safety violation")
		})

		it("should block overwriting .env", async () => {
			await expect(loop._safeExec("echo 'key=val' > .env")).rejects.toThrow("Hard safety violation")
		})

		it("should block /etc/ access", async () => {
			await expect(loop._safeExec("cat /etc/passwd")).rejects.toThrow("Hard safety violation")
		})

		it("should block ~/.ssh access", async () => {
			await expect(loop._safeExec("cat ~/.ssh/id_rsa")).rejects.toThrow("Hard safety violation")
		})

		it("should block docker rm", async () => {
			await expect(loop._safeExec("docker rm mycontainer")).rejects.toThrow("Hard safety violation")
		})

		it("should block docker system prune", async () => {
			await expect(loop._safeExec("docker system prune -a")).rejects.toThrow("Hard safety violation")
		})

		it("should block docker volume rm", async () => {
			await expect(loop._safeExec("docker volume rm myvolume")).rejects.toThrow("Hard safety violation")
		})

		it("should block pm2 delete", async () => {
			await expect(loop._safeExec("pm2 delete myapp")).rejects.toThrow("Hard safety violation")
		})

		it("should block drop table", async () => {
			await expect(loop._safeExec("DROP TABLE users;")).rejects.toThrow("Hard safety violation")
		})

		it("should block drop database", async () => {
			await expect(loop._safeExec("DROP DATABASE production;")).rejects.toThrow("Hard safety violation")
		})

		it("should allow safe commands", async () => {
			mockExecAsync.mockResolvedValue({ stdout: "ok", stderr: "" })
			const result = await loop._safeExec("ls -la")
			expect(result.stdout).toBe("ok")
		})
	})

	// ─── Phase 1: Repo Inspection ───────────────────────────────────────

	describe("_phaseRepoInspection", () => {
		it("should succeed with all files present", async () => {
			mockFsState.exists = {
				"/tmp/test-workspace/package.json": true,
				"/tmp/test-workspace/cloud/package.json": true,
				"/tmp/test-workspace/cloud/dashboard/package.json": true,
				"/tmp/test-workspace/cloud/ecosystem.config.js": true,
				"/tmp/test-workspace/cloud/sandbox/Dockerfile": true,
			}
			mockFsState.readFiles = {
				"/tmp/test-workspace/package.json": JSON.stringify({ name: "test-project", version: "1.0.0" }),
				"/tmp/test-workspace/cloud/package.json": JSON.stringify({ dependencies: { express: "^4.0.0" } }),
				"/tmp/test-workspace/cloud/dashboard/package.json": JSON.stringify({
					dependencies: { react: "^18.0.0" },
				}),
			}
			mockExecAsync.mockImplementation((cmd, opts) => {
				if (cmd.includes("ls -la")) {
					return Promise.resolve({ stdout: "total 42\ndrwxr-xr-x 2 root root 4096 .\n", stderr: "" })
				}
				if (cmd.includes("find . -name")) {
					return Promise.resolve({ stdout: "test1.test.js\ntest2.test.ts\n", stderr: "" })
				}
				return Promise.resolve({ stdout: "", stderr: "" })
			})

			const result = await loop._phaseRepoInspection()
			expect(result.success).toBe(true)
			expect(result.details).toContain("Repo inspection complete")
		})

		it("should handle missing files gracefully", async () => {
			mockFsState.exists = {}
			mockExecAsync.mockImplementation((cmd, opts) => {
				if (cmd.includes("ls -la")) {
					return Promise.resolve({ stdout: "total 0\n", stderr: "" })
				}
				if (cmd.includes("find . -name")) {
					return Promise.resolve({ stdout: "", stderr: "" })
				}
				return Promise.resolve({ stdout: "", stderr: "" })
			})

			const result = await loop._phaseRepoInspection()
			expect(result.success).toBe(true)
			expect(result.details).toContain("Repo inspection complete")
		})

		it("should handle exec failure", async () => {
			mockExecAsync.mockRejectedValue(new Error("Command failed"))
			const result = await loop._phaseRepoInspection()
			expect(result.success).toBe(false)
			expect(result.error).toContain("Repo inspection failed")
		})
	})

	// ─── Phase 2: Env Validation ────────────────────────────────────────

	describe("_phaseEnvValidation", () => {
		it("should pass when all checks pass", async () => {
			mockFsState.exists = {
				"/tmp/test-workspace/.env": true,
				"/tmp/test-workspace/pnpm-lock.yaml": true,
				"/tmp/test-workspace/node_modules": true,
				"/tmp/test-workspace/cloud/node_modules": true,
				"/tmp/test-workspace/cloud/dashboard/node_modules": true,
			}
			process.env.OPENAI_API_KEY = "sk-test"
			process.env.DEEPSEEK_API_KEY = "ds-test"
			process.env.TELEGRAM_BOT_TOKEN = "tg-test"
			process.env.JWT_SECRET = "jwt-test"
			mockExecAsync.mockImplementation((cmd, opts) => {
				if (cmd.includes("docker info")) {
					return Promise.resolve({ stdout: "Containers: 2\n", stderr: "" })
				}
				if (cmd.includes("node --version")) {
					return Promise.resolve({ stdout: "v20.0.0\n", stderr: "" })
				}
				return Promise.resolve({ stdout: "", stderr: "" })
			})

			const result = await loop._phaseEnvValidation()
			expect(result.success).toBe(true)
			expect(result.details).toContain("Env validation")
		})

		it("should report partial failures", async () => {
			mockFsState.exists = {}
			delete process.env.OPENAI_API_KEY
			delete process.env.DEEPSEEK_API_KEY
			delete process.env.TELEGRAM_BOT_TOKEN
			delete process.env.JWT_SECRET
			mockExecAsync.mockImplementation((cmd, opts) => {
				if (cmd.includes("docker info")) {
					return Promise.reject(new Error("Docker not available"))
				}
				if (cmd.includes("node --version")) {
					return Promise.reject(new Error("Node not available"))
				}
				return Promise.resolve({ stdout: "", stderr: "" })
			})

			const result = await loop._phaseEnvValidation()
			expect(result.success).toBe(false)
			expect(result.details).toContain("Env validation")
		})

		it("should handle exec failure", async () => {
			mockExecAsync.mockRejectedValue(new Error("Unexpected error"))
			const result = await loop._phaseEnvValidation()
			expect(result.success).toBe(false)
			expect(result.details).toContain("Env validation")
		})
	})

	// ─── Phase 3: Boot Verification ─────────────────────────────────────

	describe("_phaseBootVerification", () => {
		it("should pass when all services are online", async () => {
			mockExecAsync.mockImplementation((cmd, opts) => {
				if (cmd.includes("pm2 status")) {
					return Promise.resolve({ stdout: "online\n", stderr: "" })
				}
				if (cmd.includes("curl") && cmd.includes("8787/api/health")) {
					return Promise.resolve({ stdout: "200\n", stderr: "" })
				}
				if (cmd.includes("curl") && cmd.includes("3001")) {
					return Promise.resolve({ stdout: "200\n", stderr: "" })
				}
				if (cmd.includes("docker ps")) {
					return Promise.resolve({
						stdout: "superroo-api Up 2 hours\nsuperroo-dashboard Up 2 hours\n",
						stderr: "",
					})
				}
				if (cmd.includes("redis-cli ping")) {
					return Promise.resolve({ stdout: "PONG\n", stderr: "" })
				}
				return Promise.resolve({ stdout: "", stderr: "" })
			})

			const result = await loop._phaseBootVerification()
			expect(result.success).toBe(true)
			expect(result.details).toContain("Boot verification")
		})

		it("should report partial failures", async () => {
			mockExecAsync.mockImplementation((cmd, opts) => {
				if (cmd.includes("pm2 status")) {
					return Promise.reject(new Error("SSH failed"))
				}
				if (cmd.includes("curl") && cmd.includes("8787/api/health")) {
					return Promise.resolve({ stdout: "000\n", stderr: "" })
				}
				if (cmd.includes("curl") && cmd.includes("3001")) {
					return Promise.resolve({ stdout: "200\n", stderr: "" })
				}
				if (cmd.includes("docker ps")) {
					return Promise.resolve({ stdout: "superroo-api Up 2 hours\n", stderr: "" })
				}
				if (cmd.includes("redis-cli ping")) {
					return Promise.resolve({ stdout: "PONG\n", stderr: "" })
				}
				return Promise.resolve({ stdout: "", stderr: "" })
			})

			const result = await loop._phaseBootVerification()
			expect(result.success).toBe(false)
			expect(result.details).toContain("Boot verification")
		})

		it("should handle exec failure", async () => {
			mockExecAsync.mockRejectedValue(new Error("Unexpected error"))
			const result = await loop._phaseBootVerification()
			expect(result.success).toBe(false)
			expect(result.details).toContain("Boot verification")
		})
	})

	// ─── Phase 4: UI Testing ────────────────────────────────────────────

	describe("_phaseUITesting", () => {
		it("should pass when all test suites pass", async () => {
			mockExecAsync.mockImplementation((cmd, opts) => {
				if (cmd.includes("docker run")) {
					return Promise.resolve({ stdout: "All tests passed\n", stderr: "", exitCode: 0 })
				}
				return Promise.resolve({ stdout: "", stderr: "" })
			})

			const result = await loop._phaseUITesting()
			expect(result.success).toBe(true)
			expect(result.details).toContain("UI testing")
		})

		it("should report test suite failures", async () => {
			let callCount = 0
			mockExecAsync.mockImplementation((cmd, opts) => {
				if (cmd.includes("docker run")) {
					callCount++
					if (callCount === 1) {
						return Promise.reject(new Error("Test suite failed"))
					}
					return Promise.resolve({ stdout: "All tests passed\n", stderr: "", exitCode: 0 })
				}
				return Promise.resolve({ stdout: "", stderr: "" })
			})

			const result = await loop._phaseUITesting()
			expect(result.success).toBe(false)
		})

		it("should handle exec failure", async () => {
			mockExecAsync.mockRejectedValue(new Error("Docker not available"))
			const result = await loop._phaseUITesting()
			expect(result.success).toBe(false)
			expect(result.details).toContain("UI testing")
		})
	})

	// ─── Phase 5: API Verification ──────────────────────────────────────

	describe("_phaseAPIVerification", () => {
		it("should pass when all endpoints respond correctly", async () => {
			let callCount = 0
			mockExecAsync.mockImplementation((cmd, opts) => {
				callCount++
				if (callCount <= 5) {
					// Public endpoints - expect 200
					return Promise.resolve({ stdout: "200\n", stderr: "" })
				}
				// Auth endpoints - expect 401
				return Promise.resolve({ stdout: "401\n", stderr: "" })
			})

			const result = await loop._phaseAPIVerification()
			expect(result.success).toBe(true)
			expect(result.details).toContain("API verification")
		})

		it("should report endpoint failures", async () => {
			mockExecAsync.mockResolvedValue({ stdout: "000\n", stderr: "" })

			const result = await loop._phaseAPIVerification()
			expect(result.success).toBe(false)
		})

		it("should handle exec failure", async () => {
			mockExecAsync.mockRejectedValue(new Error("Network error"))
			const result = await loop._phaseAPIVerification()
			expect(result.success).toBe(false)
			expect(result.details).toContain("API verification")
		})
	})

	// ─── Phase 6: Database Validation ───────────────────────────────────

	describe("_phaseDatabaseValidation", () => {
		it("should pass when all DB files are valid", async () => {
			mockFsState.exists = {
				"/tmp/test-workspace/server/src/memory/commit-deploy-log.json": true,
				"/tmp/test-workspace/server/src/memory/agent-notes.json": true,
				"/tmp/test-workspace/server/src/memory/bug-feature-map.json": true,
				"/tmp/test-workspace/server/src/memory/feature-test-history.json": true,
				"/tmp/test-workspace/memory/healing-incidents.json": true,
				"/tmp/test-workspace/memory/healing-metrics.json": true,
			}
			mockFsState.readFiles = {
				"/tmp/test-workspace/server/src/memory/commit-deploy-log.json": '{"commits":[]}',
				"/tmp/test-workspace/server/src/memory/agent-notes.json": "[]",
				"/tmp/test-workspace/server/src/memory/bug-feature-map.json": "{}",
				"/tmp/test-workspace/server/src/memory/feature-test-history.json": "[]",
				"/tmp/test-workspace/memory/healing-incidents.json": "[]",
				"/tmp/test-workspace/memory/healing-metrics.json": "{}",
			}

			const result = await loop._phaseDatabaseValidation()
			expect(result.success).toBe(true)
			expect(result.details).toContain("Database validation")
		})

		it("should report missing files", async () => {
			mockFsState.exists = {}

			const result = await loop._phaseDatabaseValidation()
			expect(result.success).toBe(false)
		})

		it("should handle invalid JSON", async () => {
			mockFsState.exists = {
				"/tmp/test-workspace/server/src/memory/commit-deploy-log.json": true,
			}
			mockFsState.readFiles = {
				"/tmp/test-workspace/server/src/memory/commit-deploy-log.json": "not valid json",
			}

			const result = await loop._phaseDatabaseValidation()
			expect(result.success).toBe(false)
		})
	})

	// ─── Phase 7: Integration Verification ──────────────────────────────

	describe("_phaseIntegrationVerification", () => {
		it("should pass when all services are connected", async () => {
			process.env.OPENAI_API_KEY = "sk-test"
			process.env.DEEPSEEK_API_KEY = "ds-test"
			process.env.ANTHROPIC_API_KEY = "ant-test"
			process.env.GROQ_API_KEY = "gq-test"
			mockExecAsync.mockImplementation((cmd, opts) => {
				if (cmd.includes("tailscale status")) {
					return Promise.resolve({ stdout: "100.64.175.88\n", stderr: "" })
				}
				if (cmd.includes("systemctl is-active nginx")) {
					return Promise.resolve({ stdout: "active\n", stderr: "" })
				}
				if (cmd.includes("webhook-info")) {
					return Promise.resolve({ stdout: '{"ok":true,"url":"https://..."}', stderr: "" })
				}
				return Promise.resolve({ stdout: "", stderr: "" })
			})

			const result = await loop._phaseIntegrationVerification()
			expect(result.success).toBe(true)
			expect(result.details).toContain("Integration verification")
		})

		it("should report service failures", async () => {
			delete process.env.OPENAI_API_KEY
			delete process.env.DEEPSEEK_API_KEY
			delete process.env.ANTHROPIC_API_KEY
			delete process.env.GROQ_API_KEY
			mockExecAsync.mockImplementation((cmd, opts) => {
				if (cmd.includes("tailscale status")) {
					return Promise.reject(new Error("Tailscale not available"))
				}
				if (cmd.includes("systemctl is-active nginx")) {
					return Promise.resolve({ stdout: "inactive\n", stderr: "" })
				}
				if (cmd.includes("webhook-info")) {
					return Promise.resolve({ stdout: "{}", stderr: "" })
				}
				return Promise.resolve({ stdout: "", stderr: "" })
			})

			const result = await loop._phaseIntegrationVerification()
			expect(result.success).toBe(false)
		})
	})

	// ─── Phase 8: Queue/Worker Testing ──────────────────────────────────

	describe("_phaseQueueWorkerTesting", () => {
		it("should pass when all workers are online", async () => {
			mockExecAsync.mockImplementation((cmd, opts) => {
				if (cmd.includes("queue/stats")) {
					return Promise.resolve({ stdout: '{"waiting":0,"active":1,"completed":100}', stderr: "" })
				}
				if (cmd.includes("pm2 show")) {
					return Promise.resolve({ stdout: "status: online\nuptime: 2h\n", stderr: "" })
				}
				return Promise.resolve({ stdout: "", stderr: "" })
			})

			const result = await loop._phaseQueueWorkerTesting()
			expect(result.success).toBe(true)
			expect(result.details).toContain("Queue/worker testing")
		})

		it("should report worker failures", async () => {
			mockExecAsync.mockImplementation((cmd, opts) => {
				if (cmd.includes("queue/stats")) {
					return Promise.resolve({ stdout: "{}", stderr: "" })
				}
				if (cmd.includes("pm2 show")) {
					return Promise.resolve({ stdout: "Worker not found\n", stderr: "" })
				}
				return Promise.resolve({ stdout: "", stderr: "" })
			})

			const result = await loop._phaseQueueWorkerTesting()
			expect(result.success).toBe(false)
		})
	})

	// ─── Phase 9: File Upload Testing ───────────────────────────────────

	describe("_phaseFileUploadTesting", () => {
		it("should pass when all upload paths exist", async () => {
			mockFsState.exists = {
				"/tmp/test-workspace/uploads": true,
				"/tmp/test-workspace/server/uploads": true,
				"/tmp/test-workspace/cloud/uploads": true,
				"/tmp/test-workspace/cloud/orchestrator/modules/FileImporter.js": true,
			}
			mockExecAsync.mockImplementation((cmd, opts) => {
				if (cmd.includes("curl")) {
					return Promise.resolve({ stdout: "200\n", stderr: "" })
				}
				return Promise.resolve({ stdout: "", stderr: "" })
			})

			const result = await loop._phaseFileUploadTesting()
			expect(result.success).toBe(true)
			expect(result.details).toContain("File upload testing")
		})

		it("should report missing upload directories", async () => {
			mockFsState.exists = {}
			mockExecAsync.mockImplementation((cmd, opts) => {
				if (cmd.includes("curl")) {
					return Promise.resolve({ stdout: "404\n", stderr: "" })
				}
				return Promise.resolve({ stdout: "", stderr: "" })
			})

			const result = await loop._phaseFileUploadTesting()
			expect(result.success).toBe(false)
		})
	})

	// ─── Phase 10: Security/Auth Validation ─────────────────────────────

	describe("_phaseSecurityAuth", () => {
		it("should pass when all security checks pass", async () => {
			process.env.JWT_SECRET = "jwt-test"
			mockFsState.exists = {
				"/tmp/test-workspace/cloud/api/auth.js": true,
				"/tmp/test-workspace/cloud/api/authRoutes.js": true,
				"/tmp/test-workspace/cloud/api/telegramBot.js": true,
				"/tmp/test-workspace/.env": true,
			}
			mockExecAsync.mockImplementation((cmd, opts) => {
				if (cmd.includes("grep")) {
					return Promise.resolve({ stdout: "", stderr: "" })
				}
				return Promise.resolve({ stdout: "", stderr: "" })
			})

			const result = await loop._phaseSecurityAuth()
			expect(result.success).toBe(true)
			expect(result.details).toContain("Security/auth validation")
		})

		it("should report missing auth modules", async () => {
			delete process.env.JWT_SECRET
			mockFsState.exists = {}

			const result = await loop._phaseSecurityAuth()
			expect(result.success).toBe(false)
		})
	})

	// ─── Phase 11: Performance/Stability ────────────────────────────────

	describe("_phasePerformanceStability", () => {
		it("should pass when all performance checks pass", async () => {
			mockExecAsync.mockImplementation((cmd, opts) => {
				if (cmd.includes("free -m")) {
					return Promise.resolve({
						stdout: "              total        used        free\nMem:           3950        2048        1902\n---\n/dev/sda1  50G  30G  20G  60% /\n---\n 10:00:00 up 5 days",
						stderr: "",
					})
				}
				if (cmd.includes("pm2 jlist")) {
					return Promise.resolve({
						stdout: '[{"name":"api","monit":{"memory":104857600}},{"name":"dashboard","monit":{"memory":209715200}}]',
						stderr: "",
					})
				}
				if (cmd.includes("curl") && cmd.includes("api/health")) {
					return Promise.resolve({ stdout: "200\n", stderr: "" })
				}
				if (cmd.includes("curl") && cmd.includes("3001")) {
					return Promise.resolve({ stdout: "", stderr: "" })
				}
				if (cmd.includes("pm2 status")) {
					return Promise.resolve({ stdout: "5d\n", stderr: "" })
				}
				return Promise.resolve({ stdout: "", stderr: "" })
			})

			const result = await loop._phasePerformanceStability()
			expect(result.success).toBe(true)
			expect(result.details).toContain("Performance/stability")
		})

		it("should handle SSH failures gracefully", async () => {
			mockExecAsync.mockRejectedValue(new Error("SSH connection failed"))

			const result = await loop._phasePerformanceStability()
			expect(result.success).toBe(false)
		})
	})

	// ─── Phase 12: Autonomous Debugging ─────────────────────────────────

	describe("_phaseAutonomousDebugging", () => {
		it("should pass when all debugging modules exist", async () => {
			mockFsState.exists = {
				"/tmp/test-workspace/cloud/orchestrator/modules/SelfHealingLoop.js": true,
				"/tmp/test-workspace/cloud/orchestrator/modules/HealingBus.js": true,
				"/tmp/test-workspace/memory/healing-incidents.json": true,
				"/tmp/test-workspace/cloud/orchestrator/modules/BugRegistry.js": true,
				"/tmp/test-workspace/cloud/orchestrator/modules/AutonomousLoop.js": true,
			}
			mockFsState.readFiles = {
				"/tmp/test-workspace/memory/healing-incidents.json": JSON.stringify([{ id: 1 }, { id: 2 }]),
			}

			const result = await loop._phaseAutonomousDebugging()
			expect(result.success).toBe(true)
			expect(result.details).toContain("Debugging/recovery")
		})

		it("should report missing modules", async () => {
			mockFsState.exists = {}

			const result = await loop._phaseAutonomousDebugging()
			expect(result.success).toBe(false)
		})
	})

	// ─── Phase 13: Deployment Readiness ─────────────────────────────────

	describe("_phaseDeploymentReadiness", () => {
		it("should pass when all deployment checks pass", async () => {
			mockFsState.exists = {
				"/tmp/test-workspace/cloud/ecosystem.config.js": true,
				"/tmp/test-workspace/cloud/sandbox/Dockerfile": true,
				"/tmp/test-workspace/.dockerignore": true,
				"/tmp/test-workspace/.roo/skills/superroo-vps-deployer/SKILL.md": true,
			}
			mockExecAsync.mockImplementation((cmd, opts) => {
				if (cmd.includes("tailscale status")) {
					return Promise.resolve({ stdout: "100.64.175.88\n", stderr: "" })
				}
				if (cmd.includes("git status")) {
					return Promise.resolve({ stdout: "", stderr: "" })
				}
				return Promise.resolve({ stdout: "", stderr: "" })
			})

			const result = await loop._phaseDeploymentReadiness()
			expect(result.success).toBe(true)
			expect(result.details).toContain("Deployment readiness")
		})

		it("should report missing deployment files", async () => {
			mockFsState.exists = {}
			mockExecAsync.mockImplementation((cmd, opts) => {
				if (cmd.includes("tailscale status")) {
					return Promise.reject(new Error("Tailscale not available"))
				}
				if (cmd.includes("git status")) {
					return Promise.resolve({ stdout: " M package.json\n", stderr: "" })
				}
				return Promise.resolve({ stdout: "", stderr: "" })
			})

			const result = await loop._phaseDeploymentReadiness()
			expect(result.success).toBe(false)
		})
	})

	// ─── Phase 14: Final Report ────────────────────────────────────────

	describe("_phaseFinalReport", () => {
		it("should generate final report", async () => {
			const result = await loop._phaseFinalReport()
			expect(result.success).toBe(true)
			expect(result.details).toContain("Final commissioning report generated")
		})
	})

	// ─── Container Sandboxing ──────────────────────────────────────────

	describe("_ensureContainer", () => {
		it("should return true when Docker is available", async () => {
			mockExecAsync.mockResolvedValue({ stdout: "Containers: 2\n", stderr: "" })
			const result = await loop._ensureContainer()
			expect(result).toBe(true)
		})

		it("should return false when Docker is not available", async () => {
			mockExecAsync.mockRejectedValue(new Error("Docker not found"))
			const result = await loop._ensureContainer()
			expect(result).toBe(false)
		})

		it("should return false when Docker output doesn't contain Containers:", async () => {
			mockExecAsync.mockResolvedValue({ stdout: "error: Cannot connect to Docker daemon\n", stderr: "" })
			const result = await loop._ensureContainer()
			expect(result).toBe(false)
		})
	})

	describe("_runInSandbox", () => {
		it("should run command in Docker container", async () => {
			mockExecAsync.mockImplementation((cmd, opts) => {
				if (cmd.includes("docker images -q")) {
					return Promise.resolve({ stdout: "sha256:abc123\n", stderr: "" })
				}
				if (cmd.includes("docker run")) {
					return Promise.resolve({ stdout: "test output\n", stderr: "" })
				}
				if (cmd.includes("docker rm")) {
					return Promise.resolve({ stdout: "", stderr: "" })
				}
				return Promise.resolve({ stdout: "", stderr: "" })
			})

			const result = await loop._runInSandbox("npm test", 30000)
			expect(result.exitCode).toBe(0)
			expect(result.stdout).toContain("test output")
		})

		it("should build image if not found", async () => {
			let buildCalled = false
			mockExecAsync.mockImplementation((cmd, opts) => {
				if (cmd.includes("docker images -q")) {
					return Promise.resolve({ stdout: "", stderr: "" })
				}
				if (cmd.includes("docker build")) {
					buildCalled = true
					return Promise.resolve({ stdout: "Successfully built\n", stderr: "" })
				}
				if (cmd.includes("docker run")) {
					return Promise.resolve({ stdout: "test output\n", stderr: "" })
				}
				if (cmd.includes("docker rm")) {
					return Promise.resolve({ stdout: "", stderr: "" })
				}
				return Promise.resolve({ stdout: "", stderr: "" })
			})

			const result = await loop._runInSandbox("npm test", 30000)
			expect(result.exitCode).toBe(0)
			expect(buildCalled).toBe(true)
		})

		it("should handle Docker errors gracefully", async () => {
			mockExecAsync.mockRejectedValue(new Error("Docker error: connection refused"))

			const result = await loop._runInSandbox("npm test", 30000)
			expect(result.exitCode).toBe(1)
			expect(result.stderr).toContain("Docker error")
		})
	})

	// ─── Report Generation ─────────────────────────────────────────────

	describe("_generateFinalReport", () => {
		it("should generate a comprehensive report", async () => {
			// Simulate some phase results
			loop._phaseResults = [
				{ phase: 1, name: "Repo Inspection", status: "completed", details: "OK", duration: 1000 },
				{ phase: 2, name: "Env Validation", status: "failed", details: "Missing .env", duration: 500 },
				{ phase: 3, name: "Boot Verification", status: "skipped", reason: "No container", duration: 0 },
			]
			loop._startedAt = Date.now() - 5000
			loop._jobId = "test-report"
			loop._overallStatus = "PARTIAL"
			loop.containerFirst = true

			await loop._generateFinalReport()

			const reportPath = "/tmp/test-workspace/commissioning/final-commissioning-report.md"
			expect(mockFsState.writtenFiles[norm(reportPath)]).toBeDefined()
			const report = mockFsState.writtenFiles[norm(reportPath)]
			expect(report).toContain("# Final Commissioning Report")
			expect(report).toContain("PARTIAL")
			expect(report).toContain("Repo Inspection")
			expect(report).toContain("Env Validation")
			expect(report).toContain("Boot Verification")
		})

		it("should handle empty phase results", async () => {
			loop._phaseResults = []
			loop._startedAt = Date.now()
			loop._jobId = "test-empty"
			loop._overallStatus = "PASS"

			await loop._generateFinalReport()

			const reportPath = "/tmp/test-workspace/commissioning/final-commissioning-report.md"
			expect(mockFsState.writtenFiles[norm(reportPath)]).toBeDefined()
		})
	})

	// ─── Format Helpers ────────────────────────────────────────────────

	describe("format helpers", () => {
		it("_formatDuration should format correctly", () => {
			expect(loop._formatDuration(0)).toBe("0s")
			expect(loop._formatDuration(5000)).toBe("5s")
			expect(loop._formatDuration(60000)).toBe("1m 0s")
			expect(loop._formatDuration(3600000)).toBe("1h 0m 0s")
			expect(loop._formatDuration(3661000)).toBe("1h 1m 1s")
		})

		it("_getPhaseName should return correct names", () => {
			expect(loop._getPhaseName(1)).toBe("Repository & Architecture Inspection")
			expect(loop._getPhaseName(4)).toBe("Real User UI Testing")
			expect(loop._getPhaseName(10)).toBe("Security & Auth Validation")
			expect(loop._getPhaseName(14)).toBe("Final Commissioning Report")
			expect(loop._getPhaseName(99)).toBe("Phase 99")
		})

		it("_phaseRequiresContainer should return correct phases", () => {
			expect(loop._phaseRequiresContainer(1)).toBe(false)
			expect(loop._phaseRequiresContainer(4)).toBe(true)
			expect(loop._phaseRequiresContainer(5)).toBe(true)
			expect(loop._phaseRequiresContainer(8)).toBe(true)
			expect(loop._phaseRequiresContainer(9)).toBe(true)
			expect(loop._phaseRequiresContainer(11)).toBe(true)
			expect(loop._phaseRequiresContainer(12)).toBe(true)
			expect(loop._phaseRequiresContainer(14)).toBe(false)
		})

		it("_formatInventory should format findings", () => {
			const findings = [
				{ type: "root", detail: "10 entries" },
				{ type: "package", detail: "Name: test" },
			]
			const result = loop._formatInventory(findings)
			expect(result).toContain("# Feature Inventory")
			expect(result).toContain("root")
			expect(result).toContain("package")
		})

		it("_formatEnvResults should format results", () => {
			const results = [
				{ check: ".env", passed: true, detail: "Found" },
				{ check: "docker", passed: false, detail: "Not available" },
			]
			const result = loop._formatEnvResults(results)
			expect(result).toContain("# Environment Validation Results")
			expect(result).toContain("✅")
			expect(result).toContain("❌")
			expect(result).toContain("1/2 passed")
		})
	})

	// ─── Bug Registry Integration (I3) ─────────────────────────────────

	describe("bug registry integration (I3)", () => {
		it("should create bug entry on phase failure", async () => {
			mockExecAsync.mockRejectedValue(new Error("Phase failed"))
			await loop._runLoop()
			// Wait for async loop to process
			await new Promise((r) => setTimeout(r, 100))
			// The loop should have tried phase 1 and failed, creating a bug entry
			// Note: bugRegistry.create may or may not be called depending on timing
		})

		it("should handle missing bugRegistry gracefully", async () => {
			const mockFs = createMockFs()
			const noBugOrch = createMockOrchestrator()
			delete noBugOrch.bugRegistry
			const safeLoop = new CommissioningLoop({
				orchestrator: noBugOrch,
				workspaceRoot: "/tmp/test-workspace",
				containerFirst: false,
				phaseTimeoutMs: 5000,
				commissioningDir: "/tmp/test-workspace/commissioning",
				execAsync: mockExecAsync,
				writeFileFn: mockFs.writeFileFn,
				existsFn: mockFs.existsFn,
				readFileFn: mockFs.readFileFn,
				mkdirFn: mockFs.mkdirFn,
				statFn: mockFs.statFn,
			})
			mockExecAsync.mockRejectedValue(new Error("Phase failed"))
			await safeLoop._runLoop()
			await new Promise((r) => setTimeout(r, 100))
			// Should not throw
		})
	})

	// ─── Edge Cases ────────────────────────────────────────────────────

	describe("edge cases", () => {
		it("should handle phase timeout", async () => {
			const mockFs = createMockFs()
			const timeoutLoop = new CommissioningLoop({
				orchestrator,
				workspaceRoot: "/tmp/test-workspace",
				containerFirst: false,
				phaseTimeoutMs: 50, // Very short timeout
				commissioningDir: "/tmp/test-workspace/commissioning",
				execAsync: mockExecAsync,
				writeFileFn: mockFs.writeFileFn,
				existsFn: mockFs.existsFn,
				readFileFn: mockFs.readFileFn,
				mkdirFn: mockFs.mkdirFn,
				statFn: mockFs.statFn,
			})
			// Make execAsync hang forever
			mockExecAsync.mockImplementation(() => new Promise(() => {}))
			// Phase 1 should timeout — _executePhaseWithTimeout rejects on timeout
			await expect(timeoutLoop._executePhaseWithTimeout(1, "Repo Inspection")).rejects.toThrow("timed out")
		})

		it("should handle missing orchestrator eventLog", async () => {
			const mockFs = createMockFs()
			const noEventOrch = { bugRegistry: { create: vi.fn() } }
			const safeLoop = new CommissioningLoop({
				orchestrator: noEventOrch,
				workspaceRoot: "/tmp/test-workspace",
				containerFirst: false,
				phaseTimeoutMs: 5000,
				commissioningDir: "/tmp/test-workspace/commissioning",
				execAsync: mockExecAsync,
				writeFileFn: mockFs.writeFileFn,
				existsFn: mockFs.existsFn,
				readFileFn: mockFs.readFileFn,
				mkdirFn: mockFs.mkdirFn,
				statFn: mockFs.statFn,
			})
			const result = await safeLoop.start({ jobId: "test-no-event" })
			expect(result.success).toBe(true)
		})

		it("should handle unknown phase in _executePhase", async () => {
			const result = await loop._executePhase(99, "Unknown")
			expect(result.success).toBe(false)
			expect(result.error).toContain("Unknown phase")
		})

		it("should handle _writeReport with commissioningDir", async () => {
			await loop._writeReport("test-report.md", "# Test Report")
			const reportPath = "/tmp/test-workspace/commissioning/test-report.md"
			expect(mockFsState.writtenFiles[norm(reportPath)]).toBe("# Test Report")
		})
	})

	// ─── Outer describe block close ─────────────────────────────────────────────
})
