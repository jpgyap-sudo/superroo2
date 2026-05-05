/**
 * Tests for CommitDeployLog.
 *
 * Verifies that the centralized commit & deploy log correctly records
 * commits and deploys, provides filtering, and maintains an append-only
 * audit trail.
 */

import { describe, test, expect, vi, beforeEach } from "vitest"
import { CommitDeployLog } from "../CommitDeployLog"
import type { EventLog } from "../../logging/EventLog"
import fs from "fs/promises"
import path from "path"
import os from "os"

// ── Helpers ───────────────────────────────────────────────────────────────────

function createMockEvents(): EventLog {
	return {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	} as unknown as EventLog
}

async function createTempLog(events: EventLog): Promise<{ log: CommitDeployLog; dir: string }> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "commit-deploy-log-test-"))
	const log = new CommitDeployLog(events, dir)
	await log.initialize()
	return { log, dir }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("CommitDeployLog", () => {
	let events: EventLog

	beforeEach(() => {
		events = createMockEvents()
	})

	describe("commits", () => {
		test("records a commit and returns it", async () => {
			const { log, dir } = await createTempLog(events)

			const commit = await log.recordCommit({
				commitSha: "abc123",
				agent: "coder-agent",
				type: "feature",
				title: "Add working tree tab",
				description: "Interactive tree visualization of all 17 modules",
				filesChanged: ["cloud/dashboard/src/components/views/working-tree.tsx"],
				featuresAffected: ["feat_orchestrator"],
			})

			expect(commit.id).toMatch(/^commit_/)
			expect(commit.commitSha).toBe("abc123")
			expect(commit.agent).toBe("coder-agent")
			expect(commit.type).toBe("feature")
			expect(commit.title).toBe("Add working tree tab")
			expect(commit.filesChanged).toHaveLength(1)
			expect(commit.featuresAffected).toHaveLength(1)

			// Cleanup
			await fs.rm(dir, { recursive: true })
		})

		test("records multiple commits and lists them in reverse chronological order", async () => {
			const { log, dir } = await createTempLog(events)

			await log.recordCommit({ commitSha: "abc", agent: "agent-1", type: "feature", title: "First" })
			await log.recordCommit({ commitSha: "def", agent: "agent-2", type: "bugfix", title: "Second" })
			await log.recordCommit({ commitSha: "ghi", agent: "agent-1", type: "refactor", title: "Third" })

			const commits = await log.getCommits()
			expect(commits).toHaveLength(3)
			expect(commits[0].title).toBe("Third") // most recent first
			expect(commits[1].title).toBe("Second")
			expect(commits[2].title).toBe("First")

			await fs.rm(dir, { recursive: true })
		})

		test("filters commits by agent", async () => {
			const { log, dir } = await createTempLog(events)

			await log.recordCommit({ commitSha: "abc", agent: "coder-agent", type: "feature", title: "Feature A" })
			await log.recordCommit({ commitSha: "def", agent: "debugger-agent", type: "bugfix", title: "Bugfix B" })
			await log.recordCommit({ commitSha: "ghi", agent: "coder-agent", type: "refactor", title: "Refactor C" })

			const coderCommits = await log.getCommits({ agent: "coder-agent" })
			expect(coderCommits).toHaveLength(2)
			expect(coderCommits[0].title).toBe("Refactor C")
			expect(coderCommits[1].title).toBe("Feature A")

			await fs.rm(dir, { recursive: true })
		})

		test("filters commits by type", async () => {
			const { log, dir } = await createTempLog(events)

			await log.recordCommit({ commitSha: "abc", agent: "agent", type: "feature", title: "Feature" })
			await log.recordCommit({ commitSha: "def", agent: "agent", type: "bugfix", title: "Bugfix" })
			await log.recordCommit({ commitSha: "ghi", agent: "agent", type: "docs", title: "Docs" })

			const bugfixes = await log.getCommits({ type: "bugfix" })
			expect(bugfixes).toHaveLength(1)
			expect(bugfixes[0].title).toBe("Bugfix")

			await fs.rm(dir, { recursive: true })
		})

		test("filters commits by feature ID", async () => {
			const { log, dir } = await createTempLog(events)

			await log.recordCommit({
				commitSha: "abc",
				agent: "agent",
				type: "feature",
				title: "Feature A",
				featuresAffected: ["feat_1"],
			})
			await log.recordCommit({
				commitSha: "def",
				agent: "agent",
				type: "bugfix",
				title: "Bugfix B",
				featuresAffected: ["feat_2"],
			})
			await log.recordCommit({
				commitSha: "ghi",
				agent: "agent",
				type: "feature",
				title: "Feature C",
				featuresAffected: ["feat_1"],
			})

			const feat1Commits = await log.getCommits({ featureId: "feat_1" })
			expect(feat1Commits).toHaveLength(2)

			await fs.rm(dir, { recursive: true })
		})

		test("limits results", async () => {
			const { log, dir } = await createTempLog(events)

			for (let i = 0; i < 10; i++) {
				await log.recordCommit({
					commitSha: `sha${i}`,
					agent: "agent",
					type: "feature",
					title: `Commit ${i}`,
				})
			}

			const limited = await log.getCommits({ limit: 3 })
			expect(limited).toHaveLength(3)
			expect(limited[0].title).toBe("Commit 9")

			await fs.rm(dir, { recursive: true })
		})
	})

	describe("deploys", () => {
		test("records a deploy and returns it", async () => {
			const { log, dir } = await createTempLog(events)

			const deploy = await log.recordDeploy({
				version: "v1.0.0",
				commitSha: "abc123",
				agent: "deploy-agent",
				environment: "production",
				commitsIncluded: ["abc123", "def456"],
				featuresDeployed: ["feat_1"],
			})

			expect(deploy.id).toMatch(/^deploy_/)
			expect(deploy.version).toBe("v1.0.0")
			expect(deploy.agent).toBe("deploy-agent")
			expect(deploy.status).toBe("pending")
			expect(deploy.commitsIncluded).toHaveLength(2)

			await fs.rm(dir, { recursive: true })
		})

		test("updates deploy status through the lifecycle", async () => {
			const { log, dir } = await createTempLog(events)

			const deploy = await log.recordDeploy({
				version: "v1.0.0",
				commitSha: "abc123",
				agent: "deploy-agent",
			})

			expect(deploy.status).toBe("pending")

			// Building
			const building = await log.updateDeployStatus(deploy.id, { status: "building" })
			expect(building.status).toBe("building")

			// Deploying
			const deploying = await log.updateDeployStatus(deploy.id, { status: "deploying" })
			expect(deploying.status).toBe("deploying")

			// Healthy
			const healthy = await log.updateDeployStatus(deploy.id, {
				status: "healthy",
				healthCheckPassed: true,
				healthCheckLatencyMs: 250,
			})
			expect(healthy.status).toBe("healthy")
			expect(healthy.healthCheckPassed).toBe(true)
			expect(healthy.healthCheckLatencyMs).toBe(250)
			expect(healthy.completedAt).not.toBeNull()

			await fs.rm(dir, { recursive: true })
		})

		test("records rollback", async () => {
			const { log, dir } = await createTempLog(events)

			const deploy = await log.recordDeploy({
				version: "v2.0.0",
				commitSha: "abc123",
				agent: "deploy-agent",
			})

			await log.updateDeployStatus(deploy.id, {
				status: "rolled_back",
				rollbackFrom: "v1.0.0",
				error: "Health check failed",
			})

			const updated = await log.getDeploys({ status: "rolled_back" })
			expect(updated).toHaveLength(1)
			expect(updated[0].rollbackFrom).toBe("v1.0.0")
			expect(updated[0].error).toBe("Health check failed")

			await fs.rm(dir, { recursive: true })
		})

		test("filters deploys by status", async () => {
			const { log, dir } = await createTempLog(events)

			const d1 = await log.recordDeploy({ version: "v1", commitSha: "a", agent: "agent" })
			const d2 = await log.recordDeploy({ version: "v2", commitSha: "b", agent: "agent" })
			const d3 = await log.recordDeploy({ version: "v3", commitSha: "c", agent: "agent" })

			await log.updateDeployStatus(d1.id, { status: "healthy" })
			await log.updateDeployStatus(d2.id, { status: "failed", error: "Build error" })
			await log.updateDeployStatus(d3.id, { status: "healthy" })

			const healthy = await log.getDeploys({ status: "healthy" })
			expect(healthy).toHaveLength(2)

			const failed = await log.getDeploys({ status: "failed" })
			expect(failed).toHaveLength(1)

			await fs.rm(dir, { recursive: true })
		})
	})

	describe("stats", () => {
		test("returns accurate statistics", async () => {
			const { log, dir } = await createTempLog(events)

			// Record some commits
			await log.recordCommit({ commitSha: "a", agent: "coder", type: "feature", title: "F1" })
			await log.recordCommit({ commitSha: "b", agent: "coder", type: "bugfix", title: "B1" })
			await log.recordCommit({ commitSha: "c", agent: "debugger", type: "bugfix", title: "B2" })

			// Record some deploys
			const d1 = await log.recordDeploy({ version: "v1", commitSha: "a", agent: "deploy" })
			const d2 = await log.recordDeploy({ version: "v2", commitSha: "c", agent: "deploy" })
			await log.updateDeployStatus(d1.id, { status: "healthy" })
			await log.updateDeployStatus(d2.id, { status: "rolled_back", error: "Bad deploy" })

			const stats = await log.getStats()

			expect(stats.totalCommits).toBe(3)
			expect(stats.totalDeploys).toBe(2)
			expect(stats.successfulDeploys).toBe(1)
			expect(stats.rolledBackDeploys).toBe(1)
			expect(stats.commitsByAgent).toEqual({ coder: 2, debugger: 1 })
			expect(stats.commitsByType).toEqual({ feature: 1, bugfix: 2 })
			expect(stats.lastCommit).not.toBeNull()
			expect(stats.lastDeploy).not.toBeNull()

			await fs.rm(dir, { recursive: true })
		})
	})

	describe("persistence", () => {
		test("survives across instances", async () => {
			const events = createMockEvents()
			const dir = await fs.mkdtemp(path.join(os.tmpdir(), "commit-deploy-log-persist-"))

			// First instance
			const log1 = new CommitDeployLog(events, dir)
			await log1.initialize()
			await log1.recordCommit({ commitSha: "abc", agent: "agent", type: "feature", title: "Persisted commit" })
			const d1 = await log1.recordDeploy({ version: "v1", commitSha: "abc", agent: "deploy" })
			await log1.updateDeployStatus(d1.id, { status: "healthy" })

			// Second instance (new object, same directory)
			const log2 = new CommitDeployLog(events, dir)
			await log2.initialize()

			const commits = await log2.getCommits()
			expect(commits).toHaveLength(1)
			expect(commits[0].title).toBe("Persisted commit")

			const deploys = await log2.getDeploys()
			expect(deploys).toHaveLength(1)
			expect(deploys[0].status).toBe("healthy")

			await fs.rm(dir, { recursive: true })
		})
	})
})
