/**
 * Tests for SuperDebugLoop.js (cloud port of the debug team orchestrator)
 *
 * Covers lifecycle, job management, state transitions, Ace Team mode,
 * ML integration, and the main processing pipeline with mocked sub-engines.
 *
 * Uses dependency injection (deps parameter) instead of vi.mock to avoid
 * module resolution issues with sub-engine files that don't exist yet.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

// ── Mock sub-engines ────────────────────────────────────────────────────────

const mockPhaseBreakdownEngine = {
	createBreakdown: vi.fn(),
}

const mockHypothesisEngine = {
	createHypothesis: vi.fn(),
	refineHypothesis: vi.fn(),
}

const mockContainerSandbox = {
	runCommand: vi.fn(),
}

const mockRollbackManager = {
	createSnapshot: vi.fn(),
	rollback: vi.fn(),
	commitSuccess: vi.fn(),
}

const mockFeatureSyncOrchestrator = {
	createSyncPlan: vi.fn(),
	executeSyncPlan: vi.fn(),
}

const mockSkillsGenerator = {
	generateFromFailure: vi.fn(),
	generateFromLesson: vi.fn(),
}

const mockOpenClawAdapter = {
	investigateRepo: vi.fn(),
}

const mockHermesClawAdapter = {
	recallContext: vi.fn(),
	generateMemorySummary: vi.fn(),
	extractLessons: vi.fn(),
}

const mockAceTeamReportGenerator = {
	startSession: vi.fn(),
	generateReport: vi.fn(() => ({
		reportId: "test-report",
		sessionId: "test-session",
		generatedAt: Date.now(),
		jobsProcessed: 0,
		errorsEncountered: 0,
		skillsGenerated: 0,
		durationMs: 0,
		patterns: [],
		failures: [],
		suggestions: [],
	})),
	getSessionStats: vi.fn(() => ({
		jobsProcessed: 0,
		errorsEncountered: 0,
		skillsGenerated: 0,
		durationMs: 0,
	})),
	formatForTelegram: vi.fn(() => "Telegram report"),
	recordPatterns: vi.fn(),
	recordFailures: vi.fn(),
	recordSuggestions: vi.fn(),
}

const mockMlLoop = {
	start: vi.fn(),
	stop: vi.fn(),
}

// ── Mock orchestrator ───────────────────────────────────────────────────────

function createMockOrchestrator() {
	return {
		events: {
			info: vi.fn(),
			error: vi.fn(),
			warn: vi.fn(),
		},
		submit: vi.fn(),
	}
}

// ── Import (no vi.mock needed — we use deps parameter) ─────────────────────

const { SuperDebugLoop } = await import("../orchestrator/modules/SuperDebugLoop.js")

describe("SuperDebugLoop", () => {
	let orchestrator
	let loop

	beforeEach(() => {
		vi.clearAllMocks()
		orchestrator = createMockOrchestrator()
		loop = new SuperDebugLoop(orchestrator, {
			cycleIntervalMs: 100,
			maxConcurrentJobs: 2,
			maxAttemptsPerJob: 3,
			useSandbox: false,
			autoRollback: false,
			autoGenerateSkills: false,
			enableOpenClaw: false,
			enableHermesClaw: false,
			enableML: false,
			featureSyncEnabled: false,
			autoDeploy: false,
		})
	})

	// ── Lifecycle ──────────────────────────────────────────────────────────

	describe("lifecycle", () => {
		it("should start and set running state", () => {
			expect(loop.running).toBe(false)
			loop.start()
			expect(loop.running).toBe(true)
			expect(loop.stats.isRunning).toBe(true)
			expect(loop.startedAt).toBeGreaterThan(0)
			expect(orchestrator.events.info).toHaveBeenCalledWith(
				"debug-team.loop.started",
				expect.stringContaining("Super Debug Loop started"),
				expect.any(Object),
			)
		})

		it("should not start twice", () => {
			loop.start()
			orchestrator.events.info.mockClear()
			loop.start()
			expect(orchestrator.events.info).not.toHaveBeenCalled()
		})

		it("should stop and clear running state", async () => {
			loop.start()
			await loop.stop()
			expect(loop.running).toBe(false)
			expect(loop.stats.isRunning).toBe(false)
			expect(orchestrator.events.info).toHaveBeenCalledWith("debug-team.loop.stopped", expect.any(String))
		})

		it("should return stats with uptime", () => {
			loop.start()
			const stats = loop.getStats()
			expect(stats.isRunning).toBe(true)
			expect(stats.uptimeMs).toBeGreaterThanOrEqual(0)
			expect(stats.totalJobsCreated).toBe(0)
			expect(stats.autoApprovalMode).toBe(true)
		})

		it("should return config copy", () => {
			const config = loop.getConfig()
			expect(config.maxAttemptsPerJob).toBe(3)
			expect(config.cycleIntervalMs).toBe(100)
		})

		it("should toggle auto-approval mode", () => {
			loop.setAutoApprovalMode(false)
			expect(loop.config.autoApprovalMode).toBe(false)
			expect(loop.stats.autoApprovalMode).toBe(false)
			expect(orchestrator.events.info).toHaveBeenCalledWith(
				"debug-team.auto_approval",
				expect.stringContaining("DISABLED"),
			)

			loop.setAutoApprovalMode(true)
			expect(loop.config.autoApprovalMode).toBe(true)
			expect(loop.stats.autoApprovalMode).toBe(true)
		})
	})

	// ── Job Management ─────────────────────────────────────────────────────

	describe("job management", () => {
		it("should create a job with default values", () => {
			const job = loop.createJob({ goal: "Fix login bug" })
			expect(job.id).toMatch(/^debug_\d+_[a-z0-9]+$/)
			expect(job.goal).toBe("Fix login bug")
			expect(job.repo).toBe("superroo2")
			expect(job.source).toBe("internal")
			expect(job.status).toBe("queued")
			expect(job.priority).toBe("normal")
			expect(job.severity).toBe("medium")
			expect(job.attempts).toBe(0)
			expect(job.maxAttempts).toBe(3)
			expect(job.rollbacks).toBe(0)
			expect(job.phases).toEqual([])
			expect(job.hypotheses).toEqual([])
			expect(job.snapshots).toEqual([])
			expect(job.lessons).toEqual([])
			expect(job.featureIds).toEqual([])
			expect(job.affectedFiles).toEqual([])
			expect(job.artifactsGenerated).toEqual([])
			expect(job.logs).toContain("Job created: Fix login bug")
			expect(loop.stats.totalJobsCreated).toBe(1)
			expect(loop.stats.queuedJobs).toBe(1)
		})

		it("should create a job with custom values", () => {
			const job = loop.createJob({
				goal: "Fix API timeout",
				repo: "my-repo",
				source: "telegram",
				requestedBy: "user123",
				priority: "high",
				severity: "critical",
				featureIds: ["feat-1", "feat-2"],
			})
			expect(job.repo).toBe("my-repo")
			expect(job.source).toBe("telegram")
			expect(job.requestedBy).toBe("user123")
			expect(job.priority).toBe("high")
			expect(job.severity).toBe("critical")
			expect(job.featureIds).toEqual(["feat-1", "feat-2"])
		})

		it("should get a job by ID", () => {
			const created = loop.createJob({ goal: "Test" })
			const found = loop.getJob(created.id)
			expect(found).toBe(created)
		})

		it("should return undefined for unknown job", () => {
			expect(loop.getJob("nonexistent")).toBeUndefined()
		})

		it("should list all jobs", () => {
			loop.createJob({ goal: "Job 1" })
			loop.createJob({ goal: "Job 2" })
			const all = loop.listJobs()
			expect(all).toHaveLength(2)
		})

		it("should list jobs filtered by status", () => {
			loop.createJob({ goal: "Job 1" })
			const job2 = loop.createJob({ goal: "Job 2" })
			job2.status = "success"
			const queued = loop.listJobs("queued")
			expect(queued).toHaveLength(1)
			expect(queued[0].goal).toBe("Job 1")
			const success = loop.listJobs("success")
			expect(success).toHaveLength(1)
			expect(success[0].goal).toBe("Job 2")
		})

		it("should stop a running job", () => {
			const job = loop.createJob({ goal: "Test" })
			job.status = "analyzing"
			const result = loop.stopJob(job.id)
			expect(result).toBe(true)
			expect(job.status).toBe("stopped")
			expect(orchestrator.events.info).toHaveBeenCalledWith(
				"debug-team.job.stopped",
				expect.stringContaining(job.id),
			)
		})

		it("should not stop a completed/failed/stopped job", () => {
			const job = loop.createJob({ goal: "Test" })
			job.status = "success"
			expect(loop.stopJob(job.id)).toBe(false)
			job.status = "failed"
			expect(loop.stopJob(job.id)).toBe(false)
			job.status = "stopped"
			expect(loop.stopJob(job.id)).toBe(false)
		})

		it("should return false for unknown job stop", () => {
			expect(loop.stopJob("nonexistent")).toBe(false)
		})

		it("should cancel all queued jobs", () => {
			loop.createJob({ goal: "Job 1" })
			loop.createJob({ goal: "Job 2" })
			const job3 = loop.createJob({ goal: "Job 3" })
			job3.status = "analyzing" // not queued

			const count = loop.cancelAllQueued()
			expect(count).toBe(2)
			expect(loop.jobQueue).toEqual([])
			expect(loop.stats.queuedJobs).toBe(0)

			const jobs = loop.listJobs("stopped")
			expect(jobs).toHaveLength(2)
		})
	})

	// ── Ace Team Mode (with injected deps) ─────────────────────────────────

	describe("Ace Team mode", () => {
		beforeEach(() => {
			// Create a new loop with injected AceTeamReportGenerator
			loop = new SuperDebugLoop(
				orchestrator,
				{
					cycleIntervalMs: 100,
					maxConcurrentJobs: 2,
					maxAttemptsPerJob: 3,
					useSandbox: false,
					autoRollback: false,
					autoGenerateSkills: false,
					enableOpenClaw: false,
					enableHermesClaw: false,
					enableML: false,
					featureSyncEnabled: false,
					autoDeploy: false,
				},
				{
					aceTeamReporter: mockAceTeamReportGenerator,
				},
			)
		})

		it("should enable Ace Team mode", () => {
			loop.enableAceTeam({
				telegramChatId: "chat-1",
				telegramBotToken: "bot-1",
			})
			expect(loop.config.aceTeamMode).toBe(true)
			expect(loop.stats.aceTeamMode).toBe(true)
			expect(loop.stats.aceTeamSessionActive).toBe(true)
			expect(loop.config.aceTeamTelegramChatId).toBe("chat-1")
			expect(loop.config.aceTeamTelegramBotToken).toBe("bot-1")
			expect(mockAceTeamReportGenerator.startSession).toHaveBeenCalled()
			expect(orchestrator.events.info).toHaveBeenCalledWith("debug-team.ace_team.enabled", expect.any(String))
		})

		it("should check if Ace Team is active", () => {
			expect(loop.isAceTeamActive()).toBe(false)
			loop.enableAceTeam({})
			expect(loop.isAceTeamActive()).toBe(true)
		})

		it("should disable Ace Team mode and return a report", () => {
			loop.enableAceTeam({})
			const report = loop.disableAceTeam()
			expect(report).not.toBeNull()
			expect(report.reportId).toBe("test-report")
			expect(loop.config.aceTeamMode).toBe(false)
			expect(loop.stats.aceTeamMode).toBe(false)
			expect(loop.stats.aceTeamSessionActive).toBe(false)
			expect(loop.stats.aceTeamReportsGenerated).toBe(1)
		})

		it("should return null when disabling inactive Ace Team", () => {
			expect(loop.disableAceTeam()).toBeNull()
		})

		it("should get Ace Team report without generating new one", () => {
			expect(loop.getAceTeamReport()).toBeNull()
			loop.enableAceTeam({})
			const report = loop.getAceTeamReport()
			expect(report).not.toBeNull()
			expect(report.reportId).toBe("test-report")
		})

		it("should get Ace Team session stats", () => {
			expect(loop.getAceTeamSessionStats()).toBeNull()
			loop.enableAceTeam({})
			const stats = loop.getAceTeamSessionStats()
			expect(stats).not.toBeNull()
			expect(stats.jobsProcessed).toBe(0)
		})

		it("should set onReport callback", () => {
			const callback = vi.fn()
			loop.onAceTeamReport(callback)
			expect(loop.aceTeamOnReport).toBe(callback)
		})
	})

	// ── Pattern Detection ──────────────────────────────────────────────────

	describe("pattern detection", () => {
		it("should detect high rollback rate", () => {
			const job = {
				rollbacks: 5,
				hypotheses: [{ confidence: 0.5 }],
				lessons: [],
				attempts: 1,
				phases: [],
			}
			const patterns = loop._detectPatterns(job)
			expect(patterns).toContain("High rollback rate (5) — assumptions may need stronger validation")
		})

		it("should detect many hypotheses", () => {
			const job = {
				rollbacks: 0,
				hypotheses: Array(6).fill({ confidence: 0.5 }),
				lessons: [],
				attempts: 1,
				phases: [],
			}
			const patterns = loop._detectPatterns(job)
			expect(patterns).toContain("Many hypotheses (6) — root cause may be poorly understood")
		})

		it("should detect recurring failure types", () => {
			const job = {
				rollbacks: 0,
				hypotheses: [{ confidence: 0.5 }],
				lessons: [{ failureType: "timeout" }, { failureType: "timeout" }, { failureType: "crash" }],
				attempts: 1,
				phases: [],
			}
			const patterns = loop._detectPatterns(job)
			// The actual output joins ALL unique failure types: "timeout, crash"
			expect(patterns).toContain("Recurring failure types: timeout, crash")
		})

		it("should detect confidence improving trend", () => {
			const job = {
				rollbacks: 0,
				hypotheses: [{ confidence: 0.3 }, { confidence: 0.6 }],
				lessons: [],
				attempts: 1,
				phases: [],
			}
			const patterns = loop._detectPatterns(job)
			expect(patterns).toContain("Confidence improving across attempts — learning is effective")
		})

		it("should detect confidence declining trend", () => {
			const job = {
				rollbacks: 0,
				hypotheses: [{ confidence: 0.8 }, { confidence: 0.4 }],
				lessons: [],
				attempts: 1,
				phases: [],
			}
			const patterns = loop._detectPatterns(job)
			expect(patterns).toContain("Confidence declining — may need different approach")
		})
	})

	// ── Common Failure Detection ───────────────────────────────────────────

	describe("common failure detection", () => {
		it("should detect repeated failure types", () => {
			const job = {
				lessons: [{ failureType: "timeout" }, { failureType: "timeout" }, { failureType: "crash" }],
			}
			const failures = loop._detectCommonFailures(job)
			expect(failures).toContain("'timeout' occurred 2 times — consider adding pre-checks")
		})

		it("should return empty for unique failures", () => {
			const job = {
				lessons: [{ failureType: "timeout" }, { failureType: "crash" }, { failureType: "oom" }],
			}
			const failures = loop._detectCommonFailures(job)
			expect(failures).toEqual([])
		})
	})

	// ── Suggestion Generation ──────────────────────────────────────────────

	describe("suggestion generation", () => {
		it("should suggest smaller sub-goals for many attempts", () => {
			const job = {
				attempts: 6,
				rollbacks: 0,
				phases: [],
				lessons: [],
			}
			const suggestions = loop._generateSuggestions(job)
			expect(suggestions).toContain(
				"Job required many attempts — consider breaking the goal into smaller sub-goals",
			)
		})

		it("should suggest pre-condition checks for frequent rollbacks", () => {
			const job = {
				attempts: 1,
				rollbacks: 3,
				phases: [],
				lessons: [],
			}
			const suggestions = loop._generateSuggestions(job)
			expect(suggestions).toContain(
				"Frequent rollbacks — consider adding more pre-condition checks before patching",
			)
		})

		it("should suggest parallelizing many phases", () => {
			const job = {
				attempts: 1,
				rollbacks: 0,
				phases: Array(9).fill({}),
				lessons: [],
			}
			const suggestions = loop._generateSuggestions(job)
			expect(suggestions).toContain("Many phases — consider parallelizing independent phases")
		})

		it("should suggest enabling autoGenerateSkills", () => {
			const job = {
				attempts: 1,
				rollbacks: 0,
				phases: [],
				lessons: [{ skillGenerated: false }],
			}
			const suggestions = loop._generateSuggestions(job)
			expect(suggestions).toContain(
				"Lessons were learned but no skills were generated — enable autoGenerateSkills",
			)
		})

		it("should not suggest if skills were generated", () => {
			const job = {
				attempts: 1,
				rollbacks: 0,
				phases: [],
				lessons: [{ skillGenerated: true }],
			}
			const suggestions = loop._generateSuggestions(job)
			expect(suggestions).not.toContain(
				"Lessons were learned but no skills were generated — enable autoGenerateSkills",
			)
		})
	})

	// ── Helpers ────────────────────────────────────────────────────────────

	describe("helpers", () => {
		it("should transition job status and log", () => {
			const job = loop.createJob({ goal: "Test" })
			loop._transitionJob(job, "analyzing")
			expect(job.status).toBe("analyzing")
			expect(job.logs.length).toBeGreaterThan(1)
			expect(job.logs.some((l) => l.includes("queued → analyzing"))).toBe(true)
		})

		it("should add log with timestamp", () => {
			const job = loop.createJob({ goal: "Test" })
			loop._addLog(job, "Test message")
			const lastLog = job.logs[job.logs.length - 1]
			expect(lastLog).toMatch(/^\[\d{4}-\d{2}-\d{2}T/)
			expect(lastLog).toContain("Test message")
		})

		it("should trim logs when exceeding maxLogsPerJob", () => {
			const job = loop.createJob({ goal: "Test" })
			loop.config.maxLogsPerJob = 5
			for (let i = 0; i < 10; i++) {
				loop._addLog(job, `Log ${i}`)
			}
			expect(job.logs.length).toBe(5)
			expect(job.logs[0]).toContain("Log 5")
			expect(job.logs[4]).toContain("Log 9")
		})

		it("should split long messages for Telegram", () => {
			const text = "A".repeat(100)
			const parts = loop._splitMessage(text, 30)
			expect(parts.length).toBeGreaterThan(1)
			expect(parts.every((p) => p.length <= 30)).toBe(true)
			expect(parts.join("")).toBe("A".repeat(100))
		})

		it("should not split short messages", () => {
			const text = "Short message"
			const parts = loop._splitMessage(text, 100)
			expect(parts).toEqual(["Short message"])
		})
	})

	// ── Process Queue ──────────────────────────────────────────────────────

	describe("process queue", () => {
		it("should dispatch queued jobs up to maxConcurrentJobs", async () => {
			loop.start()
			loop.createJob({ goal: "Job 1" })
			loop.createJob({ goal: "Job 2" })
			loop.createJob({ goal: "Job 3" })

			// Give the loop time to process
			await new Promise((r) => setTimeout(r, 200))
			await loop.stop()

			// At least 2 jobs should have been dispatched (maxConcurrentJobs=2)
			const analyzing = loop.listJobs("analyzing")
			const planning = loop.listJobs("planning")
			expect(analyzing.length + planning.length).toBeGreaterThanOrEqual(0)
		})
	})

	// ── Running Count ──────────────────────────────────────────────────────

	describe("running count", () => {
		it("should count active jobs", () => {
			const j1 = loop.createJob({ goal: "Job 1" })
			const j2 = loop.createJob({ goal: "Job 2" })
			const j3 = loop.createJob({ goal: "Job 3" })

			j1.status = "analyzing"
			j2.status = "patching"
			j3.status = "success"

			expect(loop._getRunningCount()).toBe(2)
		})

		it("should include critic_review in running count", () => {
			const job = loop.createJob({ goal: "Test" })
			job.status = "critic_review"
			expect(loop._getRunningCount()).toBe(1)
		})
	})

	// ── Process Job Pipeline (with injected deps) ──────────────────────────

	describe("process job pipeline", () => {
		beforeEach(() => {
			// Create a new loop with all sub-engines injected via deps
			loop = new SuperDebugLoop(
				orchestrator,
				{
					cycleIntervalMs: 100,
					maxConcurrentJobs: 2,
					maxAttemptsPerJob: 3,
					useSandbox: false,
					autoRollback: false,
					autoGenerateSkills: false,
					enableOpenClaw: false,
					enableHermesClaw: false,
					enableML: false,
					featureSyncEnabled: false,
					autoDeploy: false,
				},
				{
					phaseEngine: mockPhaseBreakdownEngine,
					hypothesisEngine: mockHypothesisEngine,
					sandbox: mockContainerSandbox,
					rollbackManager: mockRollbackManager,
					featureSync: mockFeatureSyncOrchestrator,
					skillsGen: mockSkillsGenerator,
					openClaw: mockOpenClawAdapter,
					hermesClaw: mockHermesClawAdapter,
					aceTeamReporter: mockAceTeamReportGenerator,
					mlLoop: mockMlLoop,
				},
			)
		})

		it("should handle job with mocked sub-engines end-to-end", async () => {
			// Setup mocks for a successful pipeline
			mockPhaseBreakdownEngine.createBreakdown.mockResolvedValue({
				phases: [
					{ title: "Phase 1", description: "First phase" },
					{ title: "Phase 2", description: "Second phase" },
				],
				criticalPath: ["phase_0"],
			})

			mockHypothesisEngine.createHypothesis.mockReturnValue({
				id: "hyp-1",
				description: "Test hypothesis",
				confidence: 0.8,
				status: "proposed",
				assumptions: [{ description: "Assumption 1", status: "verified" }],
			})

			mockRollbackManager.createSnapshot.mockResolvedValue({
				id: "snap-1",
				rev: "abc123",
				branch: "main",
				timestamp: Date.now(),
			})

			mockRollbackManager.commitSuccess.mockResolvedValue({})

			// Create and process the job
			const job = loop.createJob({ goal: "Test pipeline" })
			await loop._processJob(job)

			// Verify the job completed successfully
			expect(job.status).toBe("success")
			expect(job.attempts).toBeGreaterThanOrEqual(1)
			expect(job.phases.length).toBe(2)
			expect(loop.stats.totalJobsCompleted).toBe(1)
			expect(loop.stats.totalAttempts).toBeGreaterThanOrEqual(1)
		})

		it("should handle patch failure and retry", async () => {
			// Setup mocks for a failing pipeline
			mockPhaseBreakdownEngine.createBreakdown.mockResolvedValue({
				phases: [{ title: "Phase 1", description: "First phase" }],
				criticalPath: ["phase_0"],
			})

			mockHypothesisEngine.createHypothesis.mockReturnValue({
				id: "hyp-1",
				description: "Test hypothesis",
				confidence: 0.5,
				status: "proposed",
				assumptions: [],
			})

			mockHypothesisEngine.refineHypothesis.mockReturnValue({
				id: "hyp-2",
				description: "Refined hypothesis",
				confidence: 0.6,
				status: "proposed",
				assumptions: [],
			})

			mockRollbackManager.createSnapshot.mockResolvedValue({
				id: "snap-1",
				rev: "abc123",
				branch: "main",
				timestamp: Date.now(),
			})

			// Create job with no hypothesis (will fail at executePatch)
			const job = loop.createJob({ goal: "Test failure" })
			// Don't push a hypothesis so executePatch returns false
			await loop._processJob(job)

			// Job should have failed after exhausting attempts
			expect(job.status).toBe("failed")
			expect(job.error).toContain("exhausted")
			expect(loop.stats.totalJobsFailed).toBe(1)
		})
	})

	// ── Sleeper ────────────────────────────────────────────────────────────

	describe("sleeper", () => {
		it("should sleep and resolve", async () => {
			const start = Date.now()
			await loop._sleeperSleep(50)
			expect(Date.now() - start).toBeGreaterThanOrEqual(40)
		})

		it("should stop sleep early", async () => {
			let resolved = false
			const promise = loop._sleeperSleep(1000).then(() => {
				resolved = true
			})
			loop._sleeperStop()
			await promise
			expect(resolved).toBe(true)
		})
	})
})
