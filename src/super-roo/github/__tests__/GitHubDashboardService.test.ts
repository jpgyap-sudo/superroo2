/**
 * Tests for GitHubDashboardService.
 *
 * Verifies that the service correctly aggregates data from CommitDeployLog,
 * HealingBus, and other backend sources into the GitHubDashboardData shape.
 */

import { describe, test, expect, vi, beforeEach } from "vitest"

import { GitHubDashboardService } from "../GitHubDashboardService"
import type { CommitDeployLog, CommitRecord, DeployRecord } from "../../product-memory/CommitDeployLog"
import type { HealingBus } from "../../healing/HealingBus"
import type { EventLog } from "../../logging/EventLog"
import type { IncidentRecord } from "../../types"

// ── Helpers ───────────────────────────────────────────────────────────────────

function createMockEvents(): EventLog {
	return {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	} as unknown as EventLog
}

function createMockCommitDeployLog(): CommitDeployLog {
	return {
		getStats: vi.fn().mockResolvedValue({
			totalCommits: 42,
			totalDeploys: 10,
			successfulDeploys: 8,
			failedDeploys: 2,
			rolledBackDeploys: 0,
			commitsByAgent: { "coder-agent": 30, "fixer-agent": 12 },
			commitsByType: { feature: 20, bugfix: 15, refactor: 7 },
			lastCommit: {
				id: "commit-1",
				commitSha: "abc123def456",
				agent: "coder-agent",
				type: "feature",
				title: "Add user authentication",
				description: "Implements OAuth2 login flow",
				filesChanged: ["src/auth.ts", "src/login.tsx"],
				featuresAffected: ["auth"],
				bugsFixed: [],
				timestamp: new Date(Date.now() - 3600000).toISOString(),
			} as CommitRecord,
			lastDeploy: {
				id: "deploy-1",
				version: "v1.2.3",
				commitSha: "abc123def456",
				agent: "deployer-agent",
				status: "healthy",
				environment: "production",
				commitsIncluded: ["abc123"],
				featuresDeployed: ["auth"],
				healthCheckPassed: true,
				healthCheckLatencyMs: 1200,
				startedAt: new Date(Date.now() - 7200000).toISOString(),
				completedAt: new Date(Date.now() - 7000000).toISOString(),
			} as DeployRecord,
		}),
		getCommits: vi.fn().mockResolvedValue([
			{
				id: "commit-1",
				commitSha: "abc123def456",
				agent: "coder-agent",
				type: "feature",
				title: "Add user authentication",
				description: "Implements OAuth2 login flow",
				filesChanged: ["src/auth.ts"],
				featuresAffected: ["auth"],
				bugsFixed: [],
				timestamp: new Date(Date.now() - 3600000).toISOString(),
				deployId: "deploy-1",
			} as CommitRecord,
			{
				id: "commit-2",
				commitSha: "def789abc012",
				agent: "fixer-agent",
				type: "bugfix",
				title: "Fix login redirect",
				description: "Fixes redirect after login",
				filesChanged: ["src/login.tsx"],
				featuresAffected: ["auth"],
				bugsFixed: ["bug-1"],
				timestamp: new Date(Date.now() - 86400000).toISOString(),
			} as CommitRecord,
		]),
		getDeploys: vi.fn().mockResolvedValue([
			{
				id: "deploy-1",
				version: "v1.2.3",
				commitSha: "abc123def456",
				agent: "deployer-agent",
				status: "healthy",
				environment: "production",
				commitsIncluded: ["abc123"],
				featuresDeployed: ["auth"],
				healthCheckPassed: true,
				healthCheckLatencyMs: 1200,
				startedAt: new Date(Date.now() - 7200000).toISOString(),
				completedAt: new Date(Date.now() - 7000000).toISOString(),
			} as DeployRecord,
		]),
		getLatestDeploy: vi.fn().mockResolvedValue({
			id: "deploy-1",
			version: "v1.2.3",
			commitSha: "abc123def456",
			agent: "deployer-agent",
			status: "healthy",
			environment: "production",
			commitsIncluded: ["abc123"],
			featuresDeployed: ["auth"],
			healthCheckPassed: true,
			healthCheckLatencyMs: 1200,
			startedAt: new Date(Date.now() - 7200000).toISOString(),
			completedAt: new Date(Date.now() - 7000000).toISOString(),
		} as DeployRecord),
	} as unknown as CommitDeployLog
}

function createMockHealingBus(): HealingBus {
	return {
		list: vi.fn().mockReturnValue([
			{
				id: "incident-1",
				fingerprint: "fp1",
				featureKey: "auth",
				sourceAgent: "monitor-agent",
				title: "TypeScript error in auth.ts",
				symptom: "Type 'string | undefined' is not assignable to type 'string'",
				severity: "high",
				status: "investigating",
				rootCauseCategory: null,
				affectedFiles: ["src/auth.ts"],
				recommendedAction: "Add type guard",
				evidence: {},
				autoFixAllowed: true,
				fixAttempts: 0,
				createdAt: Date.now() - 1800000,
				updatedAt: Date.now() - 1800000,
			} as IncidentRecord,
			{
				id: "incident-2",
				fingerprint: "fp2",
				featureKey: "api",
				sourceAgent: "monitor-agent",
				title: "ESLint warning in api.ts",
				symptom: "Unused variable 'result'",
				severity: "low",
				status: "new",
				rootCauseCategory: null,
				affectedFiles: ["src/api.ts"],
				recommendedAction: "Remove unused variable",
				evidence: {},
				autoFixAllowed: true,
				fixAttempts: 0,
				createdAt: Date.now() - 3600000,
				updatedAt: Date.now() - 3600000,
			} as IncidentRecord,
		]),
	} as unknown as HealingBus
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GitHubDashboardService", () => {
	let service: GitHubDashboardService
	let commitDeployLog: CommitDeployLog
	let healingBus: HealingBus
	let events: EventLog

	beforeEach(() => {
		events = createMockEvents()
		commitDeployLog = createMockCommitDeployLog()
		healingBus = createMockHealingBus()

		service = new GitHubDashboardService({
			commitDeployLog,
			healingBus,
			events,
			repoName: "test-repo",
		})
	})

	describe("getDashboardData", () => {
		test("returns complete dashboard data shape", async () => {
			const data = await service.getDashboardData()

			expect(data).toHaveProperty("repoStatus")
			expect(data).toHaveProperty("activityEvents")
			expect(data).toHaveProperty("healthMetrics")
			expect(data).toHaveProperty("aiSuggestions")
			expect(data).toHaveProperty("workingTreeFiles")
			expect(data).toHaveProperty("pipelineStages")
			expect(data).toHaveProperty("autonomousTask")
			expect(data).toHaveProperty("aiCommits")
			expect(data).toHaveProperty("pullRequests")
		})

		test("repoStatus contains expected fields", async () => {
			const data = await service.getDashboardData()
			const status = data.repoStatus

			expect(status.repoName).toBe("test-repo")
			expect(status.branch).toBe("main")
			expect(status.syncStatus).toBe("synced")
			expect(status.lastCommit.message).toBe("Add user authentication")
			expect(status.lastCommit.author).toBe("coder-agent")
			expect(status.deployment.status).toBe("healthy")
			expect(status.deployment.environment).toBe("production")
		})

		test("activityEvents includes incidents and deploys", async () => {
			const data = await service.getDashboardData()

			expect(data.activityEvents.length).toBeGreaterThanOrEqual(2)

			// Should have deploy events
			const deployEvents = data.activityEvents.filter((e) => e.role === "Deployer")
			expect(deployEvents.length).toBeGreaterThanOrEqual(1)
			expect(deployEvents[0].title).toContain("deployed")
		})

		test("healthMetrics contains expected metrics", async () => {
			const data = await service.getDashboardData()

			const labels = data.healthMetrics.map((m) => m.label)
			expect(labels).toContain("TypeScript Errors")
			expect(labels).toContain("ESLint Warnings")
			expect(labels).toContain("Tests Passing")
			expect(labels).toContain("Build Status")
			expect(labels).toContain("Last Deployment")

			// TypeScript Errors should be 1 (from mock incidents)
			const tsErrors = data.healthMetrics.find((m) => m.label === "TypeScript Errors")
			expect(tsErrors?.value).toBe(1)
			expect(tsErrors?.status).toBe("failed")
		})

		test("aiSuggestions generated from open incidents", async () => {
			const data = await service.getDashboardData()

			expect(data.aiSuggestions.length).toBeGreaterThanOrEqual(1)
			expect(data.aiSuggestions[0]).toHaveProperty("title")
			expect(data.aiSuggestions[0]).toHaveProperty("severity")
			expect(data.aiSuggestions[0]).toHaveProperty("description")
		})

		test("pipelineStages has 5 stages", async () => {
			const data = await service.getDashboardData()

			expect(data.pipelineStages).toHaveLength(5)
			expect(data.pipelineStages[0].name).toBe("Code")
			expect(data.pipelineStages[3].name).toBe("Deploy")
			expect(data.pipelineStages[4].name).toBe("Verify")
		})

		test("autonomousTask returns default when no task active", async () => {
			const data = await service.getDashboardData()

			expect(data.autonomousTask.title).toBe("No active task")
			expect(data.autonomousTask.progress).toBe(0)
			expect(data.autonomousTask.safetyMode).toBe("Manual Approval")
		})

		test("aiCommits maps from CommitDeployLog", async () => {
			const data = await service.getDashboardData()

			expect(data.aiCommits.length).toBeGreaterThanOrEqual(1)
			expect(data.aiCommits[0]).toHaveProperty("sha")
			expect(data.aiCommits[0]).toHaveProperty("message")
			expect(data.aiCommits[0]).toHaveProperty("author")
			expect(data.aiCommits[0]).toHaveProperty("risk")
		})

		test("pullRequests returns empty array (not yet wired)", async () => {
			const data = await service.getDashboardData()

			expect(data.pullRequests).toEqual([])
		})

		test("workingTreeFiles returns empty array (not yet wired)", async () => {
			const data = await service.getDashboardData()

			expect(data.workingTreeFiles).toEqual([])
		})
	})

	describe("error resilience", () => {
		test("handles HealingBus failure gracefully", async () => {
			const brokenBus = {
				list: vi.fn().mockImplementation(() => {
					throw new Error("DB connection failed")
				}),
			} as unknown as HealingBus

			const resilientService = new GitHubDashboardService({
				commitDeployLog,
				healingBus: brokenBus,
				events,
				repoName: "test-repo",
			})

			const data = await resilientService.getDashboardData()

			// Should still return data, just with empty activity/suggestions
			expect(data.repoStatus.repoName).toBe("test-repo")
			expect(data.activityEvents.length).toBeGreaterThanOrEqual(0)
			expect(data.aiSuggestions).toEqual([])
		})

		test("handles CommitDeployLog failure gracefully", async () => {
			const brokenLog = {
				getStats: vi.fn().mockRejectedValue(new Error("File not found")),
				getCommits: vi.fn().mockRejectedValue(new Error("File not found")),
				getDeploys: vi.fn().mockRejectedValue(new Error("File not found")),
				getLatestDeploy: vi.fn().mockRejectedValue(new Error("File not found")),
			} as unknown as CommitDeployLog

			const resilientService = new GitHubDashboardService({
				commitDeployLog: brokenLog,
				healingBus,
				events,
				repoName: "test-repo",
			})

			const data = await resilientService.getDashboardData()

			// Should still return data with defaults
			expect(data.repoStatus.repoName).toBe("test-repo")
			expect(data.repoStatus.lastCommit.message).toBe("No commits yet")
		})
	})
})
