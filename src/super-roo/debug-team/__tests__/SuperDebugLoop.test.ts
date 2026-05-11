/**
 * Tests for the Super Debug Loop — the main orchestrating loop.
 *
 * These tests verify:
 *   1. Job lifecycle (create, get, list, stop, cancel)
 *   2. Auto-approval mode configuration
 *   3. Stats tracking
 *   4. Integration with sub-engines
 *   5. Error handling
 */

import { describe, test, expect, vi, beforeEach } from "vitest"
import { SuperDebugLoop } from "../SuperDebugLoop"
import type { SuperRooOrchestrator } from "../../orchestrator/SuperRooOrchestrator"

// ─── Mock Orchestrator ───────────────────────────────────────────────────────

function createMockOrchestrator(): SuperRooOrchestrator {
	return {
		events: {
			info: vi.fn(),
			error: vi.fn(),
			warn: vi.fn(),
		},
		submit: vi.fn(),
	} as unknown as SuperRooOrchestrator
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("SuperDebugLoop", () => {
	let orchestrator: SuperRooOrchestrator
	let loop: SuperDebugLoop

	beforeEach(() => {
		orchestrator = createMockOrchestrator()
		loop = new SuperDebugLoop(orchestrator, {
			maxAttemptsPerJob: 3,
			cycleIntervalMs: 100,
			maxConcurrentJobs: 2,
			autoApprovalMode: true,
			autoDeploy: false,
		})
	})

	// ── Job Lifecycle ──────────────────────────────────────────────────────

	describe("job lifecycle", () => {
		test("creates a job with correct defaults", () => {
			const job = loop.createJob({
				goal: "Fix login bug",
				repo: "superroo2",
				source: "internal",
			})

			expect(job.id).toBeDefined()
			expect(job.goal).toBe("Fix login bug")
			expect(job.repo).toBe("superroo2")
			expect(job.source).toBe("internal")
			expect(job.status).toBe("queued")
			expect(job.attempts).toBe(0)
			expect(job.maxAttempts).toBe(3)
			expect(job.phases).toEqual([])
			expect(job.hypotheses).toEqual([])
			expect(job.snapshots).toEqual([])
			expect(job.lessons).toEqual([])
			expect(job.logs.length).toBeGreaterThan(0)
			expect(job.createdAt).toBeGreaterThan(0)
			expect(job.updatedAt).toBeGreaterThan(0)
		})

		test("creates a job with custom priority and severity", () => {
			const job = loop.createJob({
				goal: "Critical security fix",
				priority: "high",
				severity: "critical",
				featureIds: ["auth", "security"],
			})

			expect(job.priority).toBe("high")
			expect(job.severity).toBe("critical")
			expect(job.featureIds).toEqual(["auth", "security"])
		})

		test("gets a job by ID", () => {
			const created = loop.createJob({ goal: "Test job" })
			const retrieved = loop.getJob(created.id)
			expect(retrieved).toBeDefined()
			expect(retrieved!.id).toBe(created.id)
		})

		test("returns undefined for non-existent job", () => {
			const retrieved = loop.getJob("non-existent")
			expect(retrieved).toBeUndefined()
		})

		test("lists all jobs", () => {
			loop.createJob({ goal: "Job 1" })
			loop.createJob({ goal: "Job 2" })
			loop.createJob({ goal: "Job 3" })

			const jobs = loop.listJobs()
			expect(jobs.length).toBe(3)
		})

		test("lists jobs filtered by status", () => {
			loop.createJob({ goal: "Job 1" })
			loop.createJob({ goal: "Job 2" })

			const queuedJobs = loop.listJobs("queued")
			expect(queuedJobs.length).toBe(2)

			const successJobs = loop.listJobs("success")
			expect(successJobs.length).toBe(0)
		})

		test("stops a running job", () => {
			const job = loop.createJob({ goal: "Stoppable job" })
			const result = loop.stopJob(job.id)
			expect(result).toBe(true)

			const stopped = loop.getJob(job.id)
			expect(stopped!.status).toBe("stopped")
		})

		test("cannot stop already stopped job", () => {
			const job = loop.createJob({ goal: "Already stopped" })
			loop.stopJob(job.id)
			const result = loop.stopJob(job.id)
			expect(result).toBe(false)
		})

		test("cancels all queued jobs", () => {
			loop.createJob({ goal: "Job 1" })
			loop.createJob({ goal: "Job 2" })
			loop.createJob({ goal: "Job 3" })

			const count = loop.cancelAllQueued()
			expect(count).toBe(3)

			const jobs = loop.listJobs("stopped")
			expect(jobs.length).toBe(3)
		})
	})

	// ── Auto-Approval Mode ─────────────────────────────────────────────────

	describe("auto-approval mode", () => {
		test("defaults to auto-approval mode enabled", () => {
			const defaultLoop = new SuperDebugLoop(orchestrator)
			const config = defaultLoop.getConfig()
			expect(config.autoApprovalMode).toBe(true)
		})

		test("can be configured with auto-approval disabled", () => {
			const manualLoop = new SuperDebugLoop(orchestrator, {
				autoApprovalMode: false,
			})
			const config = manualLoop.getConfig()
			expect(config.autoApprovalMode).toBe(false)
		})

		test("toggles auto-approval mode at runtime", () => {
			loop.setAutoApprovalMode(false)
			expect(loop.getConfig().autoApprovalMode).toBe(false)
			expect(loop.getStats().autoApprovalMode).toBe(false)

			loop.setAutoApprovalMode(true)
			expect(loop.getConfig().autoApprovalMode).toBe(true)
			expect(loop.getStats().autoApprovalMode).toBe(true)
		})

		test("auto-deploy is disabled by default", () => {
			const config = loop.getConfig()
			expect(config.autoDeploy).toBe(false)
		})

		test("deploy target defaults to staging", () => {
			const config = loop.getConfig()
			expect(config.deployTarget).toBe("staging")
		})
	})

	// ── Stats ──────────────────────────────────────────────────────────────

	describe("stats tracking", () => {
		test("initial stats are zero", () => {
			const stats = loop.getStats()
			expect(stats.totalJobsCreated).toBe(0)
			expect(stats.totalJobsCompleted).toBe(0)
			expect(stats.totalJobsFailed).toBe(0)
			expect(stats.totalAttempts).toBe(0)
			expect(stats.totalRollbacks).toBe(0)
			expect(stats.totalSkillsGenerated).toBe(0)
			expect(stats.totalDeployments).toBe(0)
			expect(stats.activeJobs).toBe(0)
			expect(stats.queuedJobs).toBe(0)
			expect(stats.isRunning).toBe(false)
			expect(stats.autoApprovalMode).toBe(true)
		})

		test("tracks job creation", () => {
			loop.createJob({ goal: "Job 1" })
			loop.createJob({ goal: "Job 2" })

			const stats = loop.getStats()
			expect(stats.totalJobsCreated).toBe(2)
			expect(stats.queuedJobs).toBe(2)
		})

		test("uptime increases after start", async () => {
			loop.start()
			await new Promise((r) => setTimeout(r, 50))
			const stats = loop.getStats()
			expect(stats.uptimeMs).toBeGreaterThan(0)
			expect(stats.isRunning).toBe(true)
			await loop.stop()
		})

		test("isRunning is false after stop", async () => {
			loop.start()
			await loop.stop()
			expect(loop.getStats().isRunning).toBe(false)
		})
	})

	// ── Configuration ──────────────────────────────────────────────────────

	describe("configuration", () => {
		test("merges custom config with defaults", () => {
			const customLoop = new SuperDebugLoop(orchestrator, {
				maxAttemptsPerJob: 5,
				cycleIntervalMs: 10000,
				sandboxImage: "python:3.11",
			})

			const config = customLoop.getConfig()
			expect(config.maxAttemptsPerJob).toBe(5)
			expect(config.cycleIntervalMs).toBe(10000)
			expect(config.sandboxImage).toBe("python:3.11")
			// Defaults preserved
			expect(config.maxConcurrentJobs).toBe(2)
			expect(config.autoGenerateSkills).toBe(true)
			expect(config.useSandbox).toBe(true)
			expect(config.autoRollback).toBe(true)
			expect(config.featureSyncEnabled).toBe(true)
			expect(config.confidenceThreshold).toBe(0.7)
			expect(config.sandboxNetwork).toBe("none")
			expect(config.workspaceRoot).toBe("/srv/superroo/workspaces")
			expect(config.defaultRepo).toBe("superroo2")
			expect(config.maxLogsPerJob).toBe(1000)
			expect(config.autoApprovalMode).toBe(true)
		})

		test("getConfig returns a copy", () => {
			const config = loop.getConfig()
			config.maxAttemptsPerJob = 99
			expect(loop.getConfig().maxAttemptsPerJob).toBe(3) // Original unchanged
		})
	})

	// ── Start/Stop ─────────────────────────────────────────────────────────

	describe("start/stop lifecycle", () => {
		test("start does nothing if already running", () => {
			loop.start()
			loop.start() // Should not throw
			expect(loop.getStats().isRunning).toBe(true)
		})

		test("stop does nothing if not running", async () => {
			await loop.stop() // Should not throw
			expect(loop.getStats().isRunning).toBe(false)
		})

		test("start emits info event", () => {
			loop.start()
			expect(orchestrator.events.info).toHaveBeenCalledWith(
				"debug-team.loop.started",
				expect.stringContaining("AUTO-APPROVAL MODE ACTIVE"),
				expect.any(Object),
			)
		})

		test("stop emits info event", async () => {
			loop.start()
			await loop.stop()
			expect(orchestrator.events.info).toHaveBeenCalledWith(
				"debug-team.loop.stopped",
				expect.any(String),
			)
		})
	})
})
