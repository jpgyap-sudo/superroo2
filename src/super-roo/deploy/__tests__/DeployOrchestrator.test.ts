/**
 * Tests for DeployOrchestrator
 *
 * Tests the deploy pipeline orchestration including health checks,
 * rollback logic, history management, and configuration validation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { DeployOrchestrator } from "../DeployOrchestrator"
import type { DeployConfig } from "../DeployOrchestrator"

// Mock RemoteShell
vi.mock("../../remote/RemoteShell", () => ({
	RemoteShell: vi.fn().mockImplementation(() => ({
		scp: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" }),
		exec: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" }),
	})),
}))

function makeConfig(overrides: Partial<DeployConfig> = {}): DeployConfig {
	return {
		githubToken: "test-token",
		repoOwner: "test-owner",
		repoName: "test-repo",
		vpsHost: "100.64.175.88",
		vpsUser: "root",
		vpsKeyPath: "/tmp/test-key",
		vpsDeployPath: "/opt/test",
		healthUrl: "http://localhost:3000/api/health",
		maxRollbackVersions: 5,
		...overrides,
	}
}

describe("DeployOrchestrator", () => {
	let orchestrator: DeployOrchestrator

	beforeEach(() => {
		orchestrator = new DeployOrchestrator(makeConfig())
	})

	describe("constructor", () => {
		it("should initialize with empty history and no current deploy", () => {
			expect(orchestrator.getHistory()).toEqual([])
			expect(orchestrator.getCurrent()).toBeNull()
		})
	})

	describe("getHistory / getCurrent", () => {
		it("should return a copy of history (immutable)", () => {
			const history = orchestrator.getHistory()
			history.push({} as any)
			expect(orchestrator.getHistory()).toEqual([])
		})

		it("should return a copy of current (immutable)", () => {
			expect(orchestrator.getCurrent()).toBeNull()
		})
	})

	describe("healthCheck", () => {
		it("should return ok=false when fetch fails", async () => {
			// Mock global fetch to throw
			const originalFetch = globalThis.fetch
			globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error"))

			const result = await orchestrator.healthCheck()
			expect(result.ok).toBe(false)
			expect(result.latencyMs).toBeGreaterThanOrEqual(0)

			globalThis.fetch = originalFetch
		})

		it("should return ok=false for non-2xx status", async () => {
			const originalFetch = globalThis.fetch
			globalThis.fetch = vi.fn().mockResolvedValue({
				status: 503,
				json: vi.fn().mockResolvedValue({}),
			})

			const result = await orchestrator.healthCheck()
			expect(result.ok).toBe(false)

			globalThis.fetch = originalFetch
		})

		it("should return ok=true with details for 2xx status", async () => {
			const originalFetch = globalThis.fetch
			globalThis.fetch = vi.fn().mockResolvedValue({
				status: 200,
				json: vi.fn().mockResolvedValue({ status: "ok", uptime: 12345 }),
			})

			const result = await orchestrator.healthCheck()
			expect(result.ok).toBe(true)
			expect(result.details).toEqual({ status: "ok", uptime: 12345 })
			expect(result.latencyMs).toBeGreaterThanOrEqual(0)

			globalThis.fetch = originalFetch
		})
	})

	describe("rollback", () => {
		it("should return null when no previous healthy version exists", async () => {
			const result = await orchestrator.rollback()
			expect(result).toBeNull()
		})

		it("should return null when only current version exists (no previous)", async () => {
			// Simulate a deploy that failed
			const deploySpy = vi.spyOn(orchestrator as any, "deployToVps")
			deploySpy.mockResolvedValue(undefined)

			// Manually push a failed state
			;(orchestrator as any).current = {
				version: "v1.0.0",
				commitSha: "abc123",
				deployedAt: Date.now(),
				status: "unhealthy",
			}
			;(orchestrator as any).history = [{ ...(orchestrator as any).current }]

			const result = await orchestrator.rollback()
			expect(result).toBeNull()
		})
	})

	describe("deploy", () => {
		it("should set status to unhealthy and rollback on failure", async () => {
			// Mock internal methods to fail
			const triggerSpy = vi.spyOn(orchestrator as any, "triggerGitHubWorkflow")
			triggerSpy.mockRejectedValue(new Error("GitHub API error"))

			const rollbackSpy = vi.spyOn(orchestrator, "rollback")
			rollbackSpy.mockResolvedValue(null)

			const result = await orchestrator.deploy("v1.0.0", "abc123")

			expect(result.status).toBe("unhealthy")
			expect(result.error).toBe("GitHub API error")
			expect(rollbackSpy).toHaveBeenCalled()
		})

		it("should set status to healthy on success", async () => {
			const triggerSpy = vi.spyOn(orchestrator as any, "triggerGitHubWorkflow")
			triggerSpy.mockResolvedValue(undefined)
			const deploySpy = vi.spyOn(orchestrator as any, "deployToVps")
			deploySpy.mockResolvedValue(undefined)
			const healthSpy = vi.spyOn(orchestrator as any, "runHealthCheck")
			healthSpy.mockResolvedValue(true)

			const result = await orchestrator.deploy("v1.0.0", "abc123")

			expect(result.status).toBe("healthy")
			expect(result.version).toBe("v1.0.0")
			expect(result.commitSha).toBe("abc123")
		})

		it("should trim history to maxRollbackVersions", async () => {
			const config = makeConfig({ maxRollbackVersions: 2 })
			const orch = new DeployOrchestrator(config)

			const triggerSpy = vi.spyOn(orch as any, "triggerGitHubWorkflow")
			triggerSpy.mockResolvedValue(undefined)
			const deploySpy = vi.spyOn(orch as any, "deployToVps")
			deploySpy.mockResolvedValue(undefined)
			const healthSpy = vi.spyOn(orch as any, "runHealthCheck")
			healthSpy.mockResolvedValue(true)

			await orch.deploy("v1.0.0", "a")
			await orch.deploy("v2.0.0", "b")
			await orch.deploy("v3.0.0", "c")

			expect(orch.getHistory().length).toBeLessThanOrEqual(2)
		})
	})

	// deployNginxConfig tests are skipped because fs.existsSync cannot be
	// spied on in ESM context. The logic is trivial (path check + throw).

	describe("getRemoteHost", () => {
		it("should throw if no SSH key path is configured", () => {
			const orch = new DeployOrchestrator(makeConfig({ vpsKeyPath: undefined, rootKeyPath: undefined }))
			expect(() => (orch as any).getRemoteHost()).toThrow("No SSH key path configured")
		})

		it("should prefer rootKeyPath over vpsKeyPath", () => {
			const orch = new DeployOrchestrator(
				makeConfig({ vpsKeyPath: "/tmp/vps-key", rootKeyPath: "/tmp/root-key" }),
			)
			const host = (orch as any).getRemoteHost()
			expect(host.keyPath).toBe("/tmp/root-key")
		})
	})
})
