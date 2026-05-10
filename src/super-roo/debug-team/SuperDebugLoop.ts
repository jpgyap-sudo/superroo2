/**
 * Super Roo — Super Debug Loop
 *
 * The main orchestrating loop for the Super Debugging Team.
 * Coordinates all sub-engines to solve complex feature problems through
 * phase-by-phase breakdown, hypothesis-driven iteration, safe container
 * execution, automatic rollback, and skill generation.
 *
 * ⚠️ AUTO-APPROVAL MODE
 * When this loop is ACTIVE, ALL approvals are auto-approved and ALL
 * deployments are auto-run. The debug team has full discretion to do
 * everything in a loop as long as it is tested in the container sandbox
 * FIRST. This means:
 *   - No human approval gates for code changes
 *   - No human approval gates for deployments
 *   - Automatic rollback on any test failure
 *   - Automatic retry with improved hypothesis
 *   - Automatic skill generation from failures
 *
 * State Machine:
 *   idle → analyzing → planning → snapshot → patching → testing →
 *   critic_review → [pass: committing/deploying | fail: rollback_retry | danger: stop]
 *
 * Integrates with:
 *   - SelfHealingLoop (for reactive incident handling)
 *   - InfiniteImprovementLoop (for ML-based learning)
 *   - ParallelExecutor (for concurrent agent execution)
 *   - HealingBus (for incident reporting)
 *   - BugRegistry (for bug tracking)
 *   - FeatureRegistry (for feature tracking)
 */

import type { SuperRooOrchestrator } from "../orchestrator/SuperRooOrchestrator"
import type { TaskInputRaw, BugSeverity, TaskPriority } from "../types"
import { CancellableSleep } from "../utils/CancellableSleep"
import { PhaseBreakdownEngine } from "./engines/PhaseBreakdownEngine"
import type { PhaseBreakdown } from "./engines/PhaseBreakdownEngine"
import { HypothesisEngine } from "./engines/HypothesisEngine"
import type { Hypothesis, Assumption, HypothesisEngineConfig } from "./engines/HypothesisEngine"
import { ContainerSandbox } from "./sandbox/ContainerSandbox"
import type { SandboxResult } from "./sandbox/ContainerSandbox"
import { RollbackManager } from "./sandbox/RollbackManager"
import type { RollbackConfig } from "./sandbox/RollbackManager"
import { FeatureSyncOrchestrator } from "./engines/FeatureSyncOrchestrator"
import type { FeatureSyncPlan } from "./engines/FeatureSyncOrchestrator"
import { SkillsGenerator } from "./engines/SkillsGenerator"
import type { SkillsGeneratorConfig, GeneratedArtifact } from "./engines/SkillsGenerator"
import { OpenClawAdapter } from "./adapters/OpenClawAdapter"
import type { OpenClawAnalysisResult } from "./adapters/OpenClawAdapter"
import { HermesClawAdapter } from "./adapters/HermesClawAdapter"
import type { HermesClawResult } from "./adapters/HermesClawAdapter"
import { AceTeamReportGenerator } from "./reporting/AceTeamReportGenerator"
import type { AceTeamReport } from "./reporting/AceTeamReportGenerator"
import { InfiniteImprovementLoop } from "../ml/loop/InfiniteImprovementLoop"

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export type DebugJobStatus =
	| "queued"
	| "analyzing"
	| "planning"
	| "snapshotting"
	| "patching"
	| "testing"
	| "critic_review"
	| "committing"
	| "deploying"
	| "success"
	| "failed"
	| "rolled_back"
	| "stopped"
	| "blocked"

export interface DebugJob {
	id: string
	goal: string
	repo: string
	source: "telegram" | "api" | "dashboard" | "internal"
	requestedBy?: string
	status: DebugJobStatus
	priority: TaskPriority
	severity: BugSeverity
	createdAt: number
	updatedAt: number
	attempts: number
	maxAttempts: number
	rollbacks: number
	phases: DebugPhase[]
	hypotheses: DebugHypothesis[]
	snapshots: DebugSnapshot[]
	lessons: DebugLesson[]
	logs: string[]
	error?: string
	featureIds: string[]
	affectedFiles: string[]
	artifactsGenerated: GeneratedArtifact[]
}

export interface DebugPhase {
	id: string
	name: string
	description: string
	order: number
	status: "pending" | "running" | "passed" | "failed" | "skipped"
	startedAt?: number
	completedAt?: number
	output?: string
}

// Re-use the Hypothesis type from the engine as the canonical type
export type DebugHypothesis = Hypothesis

export interface DebugAssumption {
	id: string
	description: string
	category: "architecture" | "data" | "dependency" | "behavior" | "environment" | "integration"
	risk: "low" | "medium" | "high" | "critical"
	verificationStrategy: string
	rollbackStrategy: string
	status: "unverified" | "verified" | "falsified" | "unknown"
}

export interface DebugSnapshot {
	id: string
	rev: string
	branch: string
	timestamp: number
	phase: string
	attempt: number
	description: string
}

export interface DebugLesson {
	id: string
	jobId: string
	attempt: number
	failureType: string
	rootCause: string
	filesInvolved: string[]
	nextHypothesis: string
	skillGenerated: boolean
	skillPath?: string
	createdAt: number
}

export interface SuperDebugConfig {
	/** Max attempts per job before permanent failure. Default: 12 */
	maxAttemptsPerJob: number
	/** Milliseconds between loop cycles. Default: 5000 (5s) */
	cycleIntervalMs: number
	/** Max concurrent debug jobs. Default: 2 */
	maxConcurrentJobs: number
	/** Whether to auto-generate skills from failures. Default: true */
	autoGenerateSkills: boolean
	/** Whether to use Docker sandbox for testing. Default: true */
	useSandbox: boolean
	/** Whether to auto-rollback on failure. Default: true */
	autoRollback: boolean
	/** Whether to sync features before marking success. Default: true */
	featureSyncEnabled: boolean
	/** Confidence threshold for hypothesis acceptance. Default: 0.7 */
	confidenceThreshold: number
	/** Sandbox Docker image. Default: "node:20-bookworm" */
	sandboxImage: string
	/** Sandbox network mode. Default: "none" */
	sandboxNetwork: string
	/** Workspace root for repos. Default: "/srv/superroo/workspaces" */
	workspaceRoot: string
	/** Default repo name. Default: "superroo2" */
	defaultRepo: string
	/** Max logs to keep per job. Default: 1000 */
	maxLogsPerJob: number

	// ── Auto-Approval Mode ──
	/**
	 * When true, ALL approvals are auto-approved and ALL deployments are auto-run.
	 * The debug team has full discretion to do everything in a loop as long as
	 * it is tested in the container sandbox FIRST.
	 * Default: true (this is the whole point of the system)
	 */
	autoApprovalMode: boolean
	/**
	 * Whether to auto-deploy after successful commit. Default: false
	 * Only effective when autoApprovalMode is true.
	 */
	autoDeploy: boolean
	/**
	 * Deployment target when autoDeploy is true. Default: "staging"
	 */
	deployTarget: "staging" | "production"

	// ── OpenClaw (Analysis Agent) ──
	/**
	 * Whether to use OpenClaw for repo investigation and analysis.
	 * OpenClaw is ANALYSIS-ONLY — it never writes code.
	 * Default: true
	 */
	enableOpenClaw: boolean
	/**
	 * OpenClaw CLI path. Default: env OPENCLAW_CLI or "openclaw"
	 */
	openClawCliPath: string

	// ── HermesClaw (Memory & Context Agent) ──
	/**
	 * Whether to use HermesClaw for memory, context recall, and skill generation.
	 * Uses OpenAI API for natural language understanding.
	 * Default: true
	 */
	enableHermesClaw: boolean
	/**
	 * OpenAI API key for HermesClaw. Default: env OPENAI_API_KEY
	 */
	hermesClawApiKey: string
	/**
	 * OpenAI model for HermesClaw. Default: "gpt-4o-mini"
	 */
	hermesClawModel: string

	// ── Ace Team Mode (/aceteam) ──
	/**
	 * Whether Ace Team mode is active. When true, comprehensive logs are kept,
	 * accomplishment reports are generated, and ML insights are collected.
	 * Default: false
	 */
	aceTeamMode: boolean
	/**
	 * Telegram chat ID to send accomplishment reports to.
	 * When set, reports are sent to this chat on job completion or session end.
	 * Default: "" (disabled)
	 */
	aceTeamTelegramChatId: string
	/**
	 * Telegram bot token for sending reports.
	 * Default: env TELEGRAM_BOT_TOKEN
	 */
	aceTeamTelegramBotToken: string
	/**
	 * How often (in ms) to send progress reports during ace team mode.
	 * Default: 60000 (1 minute)
	 */
	aceTeamReportIntervalMs: number

	// ── ML Integration ──
	/**
	 * Whether to enable ML integration via InfiniteImprovementLoop.
	 * When enabled, patterns are detected across jobs and fed back into the loop.
	 * Default: true
	 */
	enableML: boolean
}

export interface SuperDebugStats {
	totalJobsCreated: number
	totalJobsCompleted: number
	totalJobsFailed: number
	totalAttempts: number
	totalRollbacks: number
	totalSkillsGenerated: number
	totalDeployments: number
	activeJobs: number
	queuedJobs: number
	isRunning: boolean
	autoApprovalMode: boolean
	uptimeMs: number
	// Ace Team stats
	aceTeamMode: boolean
	aceTeamReportsGenerated: number
	aceTeamSessionActive: boolean
	// ML stats
	mlPatternsDetected: number
	mlSuggestionsGenerated: number
}

// ──────────────────────────────────────────────────────────────────────────────
// Defaults
// ──────────────────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: SuperDebugConfig = {
	maxAttemptsPerJob: 12,
	cycleIntervalMs: 5000,
	maxConcurrentJobs: 2,
	autoGenerateSkills: true,
	useSandbox: true,
	autoRollback: true,
	featureSyncEnabled: true,
	confidenceThreshold: 0.7,
	sandboxImage: "node:20-bookworm",
	sandboxNetwork: "none",
	workspaceRoot: "/srv/superroo/workspaces",
	defaultRepo: "superroo2",
	maxLogsPerJob: 1000,
	autoApprovalMode: true,
	autoDeploy: false,
	deployTarget: "staging",
	enableOpenClaw: true,
	openClawCliPath: process.env.OPENCLAW_CLI || "openclaw",
	enableHermesClaw: true,
	hermesClawApiKey: process.env.OPENAI_API_KEY || "",
	hermesClawModel: "gpt-4o-mini",
	aceTeamMode: false,
	aceTeamTelegramChatId: "",
	aceTeamTelegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",
	aceTeamReportIntervalMs: 60000,
	enableML: true,
}

// ──────────────────────────────────────────────────────────────────────────────
// SuperDebugLoop
// ──────────────────────────────────────────────────────────────────────────────

export class SuperDebugLoop {
	private running = false
	private handle: Promise<void> | null = null
	private config: SuperDebugConfig
	private stats: SuperDebugStats
	private jobs: Map<string, DebugJob> = new Map()
	private jobQueue: string[] = []
	private sleeper = new CancellableSleep()
	private startedAt = 0

	// Sub-engines
	private phaseEngine: PhaseBreakdownEngine
	private hypothesisEngine: HypothesisEngine
	private sandbox: ContainerSandbox
	private rollbackManager: RollbackManager
	private featureSync: FeatureSyncOrchestrator
	private skillsGen: SkillsGenerator

	// Adapters
	private openClaw: OpenClawAdapter
	private hermesClaw: HermesClawAdapter

	// Ace Team
	private aceTeamReporter: AceTeamReportGenerator
	private aceTeamReportTimer: ReturnType<typeof setInterval> | null = null
	private aceTeamOnReport: ((report: AceTeamReport) => void) | null = null

	// ML Integration
	private mlLoop: InfiniteImprovementLoop | null = null

	constructor(
		private readonly orchestrator: SuperRooOrchestrator,
		config: Partial<SuperDebugConfig> = {},
	) {
		this.config = { ...DEFAULT_CONFIG, ...config }

		this.stats = {
			totalJobsCreated: 0,
			totalJobsCompleted: 0,
			totalJobsFailed: 0,
			totalAttempts: 0,
			totalRollbacks: 0,
			totalSkillsGenerated: 0,
			totalDeployments: 0,
			activeJobs: 0,
			queuedJobs: 0,
			isRunning: false,
			autoApprovalMode: this.config.autoApprovalMode,
			uptimeMs: 0,
			aceTeamMode: this.config.aceTeamMode,
			aceTeamReportsGenerated: 0,
			aceTeamSessionActive: false,
			mlPatternsDetected: 0,
			mlSuggestionsGenerated: 0,
		}

		// Initialize sub-engines
		this.phaseEngine = new PhaseBreakdownEngine()
		this.hypothesisEngine = new HypothesisEngine({
			confidenceThreshold: this.config.confidenceThreshold,
		})
		this.sandbox = new ContainerSandbox({
			image: this.config.sandboxImage,
			network: this.config.sandboxNetwork as "none" | "bridge" | "host" | "isolated",
		})
		this.rollbackManager = new RollbackManager()
		this.featureSync = new FeatureSyncOrchestrator()
		this.skillsGen = new SkillsGenerator({
			workspaceRoot: this.config.workspaceRoot,
		})

		// Initialize adapters
		this.openClaw = new OpenClawAdapter({
			cliPath: this.config.openClawCliPath,
		})
		this.hermesClaw = new HermesClawAdapter({
			apiKey: this.config.hermesClawApiKey,
			model: this.config.hermesClawModel,
		})

		// Initialize Ace Team reporter
		this.aceTeamReporter = new AceTeamReportGenerator()

		// Initialize ML loop if enabled
		if (this.config.enableML) {
			this.mlLoop = new InfiniteImprovementLoop(orchestrator, {
				minSamples: 3,
				maxIterations: 100,
				idleSleepMs: 60_000,
				trainEpochs: 10,
				confidenceThreshold: 0.7,
				maxActionsPerIteration: 5,
			})
		}
	}

	// ── Lifecycle ──────────────────────────────────────────────────────────

	start(): void {
		if (this.running) return
		this.running = true
		this.startedAt = Date.now()
		this.stats.isRunning = true
		this.stats.autoApprovalMode = this.config.autoApprovalMode
		this.sleeper.start()

		const modeMsg = this.config.autoApprovalMode
			? "AUTO-APPROVAL MODE ACTIVE — all approvals auto-granted, all deployments auto-run"
			: "Manual approval mode — waiting for human gates"

		this.orchestrator.events.info("debug-team.loop.started", `Super Debug Loop started. ${modeMsg}`, {
			data: {
				maxAttemptsPerJob: this.config.maxAttemptsPerJob,
				maxConcurrentJobs: this.config.maxConcurrentJobs,
				useSandbox: this.config.useSandbox,
				autoRollback: this.config.autoRollback,
				autoGenerateSkills: this.config.autoGenerateSkills,
				autoApprovalMode: this.config.autoApprovalMode,
				autoDeploy: this.config.autoDeploy,
				deployTarget: this.config.deployTarget,
			},
		})
		this.handle = this.loop()
	}

	async stop(): Promise<void> {
		if (!this.running) return
		this.running = false
		this.stats.isRunning = false
		this.sleeper.stop()
		if (this.handle) {
			try {
				await this.handle
			} catch {
				// loop will have logged
			}
		}
		this.orchestrator.events.info("debug-team.loop.stopped", "Super Debug Loop stopped")
	}

	getStats(): SuperDebugStats {
		return { ...this.stats, uptimeMs: this.startedAt ? Date.now() - this.startedAt : 0 }
	}

	getConfig(): SuperDebugConfig {
		return { ...this.config }
	}

	/**
	 * Toggle auto-approval mode at runtime.
	 */
	setAutoApprovalMode(enabled: boolean): void {
		this.config.autoApprovalMode = enabled
		this.stats.autoApprovalMode = enabled
		this.orchestrator.events.info(
			"debug-team.auto_approval",
			`Auto-approval mode ${enabled ? "ENABLED" : "DISABLED"}`,
		)
	}

	// ── Ace Team Mode (/aceteam) ─────────────────────────────────────────────

	/**
	 * Enable Ace Team mode. When active, comprehensive logs are kept,
	 * accomplishment reports are generated, and ML insights are collected.
	 * Reports can be sent to a Telegram chat.
	 */
	enableAceTeam(config: {
		telegramChatId?: string
		telegramBotToken?: string
		reportIntervalMs?: number
		onReport?: (report: AceTeamReport) => void
	}): void {
		this.config.aceTeamMode = true
		this.stats.aceTeamMode = true
		this.stats.aceTeamSessionActive = true

		if (config.telegramChatId) {
			this.config.aceTeamTelegramChatId = config.telegramChatId
		}
		if (config.telegramBotToken) {
			this.config.aceTeamTelegramBotToken = config.telegramBotToken
		}
		if (config.reportIntervalMs) {
			this.config.aceTeamReportIntervalMs = config.reportIntervalMs
		}
		if (config.onReport) {
			this.aceTeamOnReport = config.onReport
		}

		// Start the ace team session
		this.aceTeamReporter.startSession()

		// Start periodic report timer
		this.startAceTeamReportTimer()

		this.orchestrator.events.info(
			"debug-team.ace_team.enabled",
			`Ace Team mode enabled. Reports to chat: ${config.telegramChatId || "none"}`,
		)
	}

	/**
	 * Disable Ace Team mode and generate a final report.
	 */
	disableAceTeam(): AceTeamReport | null {
		if (!this.config.aceTeamMode) return null

		this.config.aceTeamMode = false
		this.stats.aceTeamMode = false
		this.stats.aceTeamSessionActive = false

		// Stop the report timer
		this.stopAceTeamReportTimer()

		// Generate final report
		const report = this.aceTeamReporter.generateReport({
			uptimeMs: this.startedAt ? Date.now() - this.startedAt : 0,
			activeJobs: this.stats.activeJobs,
			queuedJobs: this.stats.queuedJobs,
			autoApprovalMode: this.config.autoApprovalMode,
		})

		this.stats.aceTeamReportsGenerated++
		this.sendAceTeamReport(report)

		this.orchestrator.events.info(
			"debug-team.ace_team.disabled",
			`Ace Team mode disabled. Report: ${report.reportId}`,
		)

		return report
	}

	/**
	 * Check if Ace Team mode is active.
	 */
	isAceTeamActive(): boolean {
		return this.config.aceTeamMode
	}

	/**
	 * Get the latest Ace Team report (without generating a new one).
	 */
	getAceTeamReport(): AceTeamReport | null {
		if (!this.config.aceTeamMode) return null
		return this.aceTeamReporter.generateReport({
			uptimeMs: this.startedAt ? Date.now() - this.startedAt : 0,
			activeJobs: this.stats.activeJobs,
			queuedJobs: this.stats.queuedJobs,
			autoApprovalMode: this.config.autoApprovalMode,
		})
	}

	/**
	 * Get Ace Team session stats for real-time monitoring.
	 */
	getAceTeamSessionStats(): {
		jobsProcessed: number
		errorsEncountered: number
		skillsGenerated: number
		durationMs: number
	} | null {
		if (!this.config.aceTeamMode) return null
		return this.aceTeamReporter.getSessionStats()
	}

	/**
	 * Set a callback for when Ace Team reports are generated.
	 */
	onAceTeamReport(callback: (report: AceTeamReport) => void): void {
		this.aceTeamOnReport = callback
	}

	// ── ML Integration ───────────────────────────────────────────────────────

	/**
	 * Feed ML insights from a completed job into the InfiniteImprovementLoop.
	 */
	private async feedMLInsights(job: DebugJob): Promise<void> {
		if (!this.mlLoop || !this.config.enableML) return

		try {
			// Feed the job as a task to the ML loop for pattern learning
			const task: TaskInputRaw = {
				agent: "debug-team",
				goal: job.goal,
				priority: job.priority,
				requiredCapabilities: ["debug.complex"],
				payload: {
					debugJobId: job.id,
					attempts: job.attempts,
					status: job.status,
					hypotheses: job.hypotheses.map((h) => ({
						description: h.description,
						confidence: h.confidence,
						status: h.status,
					})),
					lessons: job.lessons.map((l) => ({
						failureType: l.failureType,
						rootCause: l.rootCause,
					})),
				},
			}

			// Use the orchestrator to submit and track
			this.orchestrator.submit(task)

			// Detect patterns from job history
			const patterns = this.detectPatterns(job)
			if (patterns.length > 0) {
				this.aceTeamReporter.recordPatterns(patterns)
				this.stats.mlPatternsDetected += patterns.length
			}

			// Detect common failures
			const failures = this.detectCommonFailures(job)
			if (failures.length > 0) {
				this.aceTeamReporter.recordFailures(failures)
			}

			// Generate suggestions
			const suggestions = this.generateSuggestions(job)
			if (suggestions.length > 0) {
				this.aceTeamReporter.recordSuggestions(suggestions)
				this.stats.mlSuggestionsGenerated += suggestions.length
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			this.addLog(job, `ML insight feeding skipped: ${msg}`)
		}
	}

	/**
	 * Detect patterns across jobs for ML insights.
	 */
	private detectPatterns(job: DebugJob): string[] {
		const patterns: string[] = []

		// Pattern: High rollback count indicates unstable assumptions
		if (job.rollbacks > 3) {
			patterns.push(`High rollback rate (${job.rollbacks}) — assumptions may need stronger validation`)
		}

		// Pattern: Many hypotheses indicate unclear root cause
		if (job.hypotheses.length > 5) {
			patterns.push(`Many hypotheses (${job.hypotheses.length}) — root cause may be poorly understood`)
		}

		// Pattern: Specific failure types recurring
		const failureTypes = job.lessons.map((l) => l.failureType)
		const uniqueFailures = new Set(failureTypes)
		if (uniqueFailures.size < failureTypes.length) {
			patterns.push(`Recurring failure types: ${Array.from(uniqueFailures).join(", ")}`)
		}

		// Pattern: Confidence trends
		const confidences = job.hypotheses.map((h) => h.confidence)
		if (confidences.length > 1) {
			const trend = confidences[confidences.length - 1] - confidences[0]
			if (trend > 0.2) {
				patterns.push("Confidence improving across attempts — learning is effective")
			} else if (trend < -0.2) {
				patterns.push("Confidence declining — may need different approach")
			}
		}

		return patterns
	}

	/**
	 * Detect common failure modes from a job.
	 */
	private detectCommonFailures(job: DebugJob): string[] {
		const failures: string[] = []
		const typeCounts = new Map<string, number>()

		for (const lesson of job.lessons) {
			typeCounts.set(lesson.failureType, (typeCounts.get(lesson.failureType) || 0) + 1)
		}

		for (const [type, count] of typeCounts) {
			if (count > 1) {
				failures.push(`'${type}' occurred ${count} times — consider adding pre-checks`)
			}
		}

		return failures
	}

	/**
	 * Generate improvement suggestions based on job history.
	 */
	private generateSuggestions(job: DebugJob): string[] {
		const suggestions: string[] = []

		if (job.attempts > 5) {
			suggestions.push("Job required many attempts — consider breaking the goal into smaller sub-goals")
		}

		if (job.rollbacks > 2) {
			suggestions.push("Frequent rollbacks — consider adding more pre-condition checks before patching")
		}

		if (job.phases.length > 8) {
			suggestions.push("Many phases — consider parallelizing independent phases")
		}

		if (job.lessons.length > 0 && !job.lessons.some((l) => l.skillGenerated)) {
			suggestions.push("Lessons were learned but no skills were generated — enable autoGenerateSkills")
		}

		return suggestions
	}

	// ── Ace Team Report Timer ────────────────────────────────────────────────

	private startAceTeamReportTimer(): void {
		this.stopAceTeamReportTimer()
		this.aceTeamReportTimer = setInterval(() => {
			if (!this.config.aceTeamMode) {
				this.stopAceTeamReportTimer()
				return
			}
			const report = this.aceTeamReporter.generateReport({
				uptimeMs: this.startedAt ? Date.now() - this.startedAt : 0,
				activeJobs: this.stats.activeJobs,
				queuedJobs: this.stats.queuedJobs,
				autoApprovalMode: this.config.autoApprovalMode,
			})
			this.stats.aceTeamReportsGenerated++
			this.sendAceTeamReport(report)
		}, this.config.aceTeamReportIntervalMs)
	}

	private stopAceTeamReportTimer(): void {
		if (this.aceTeamReportTimer !== null) {
			clearInterval(this.aceTeamReportTimer)
			this.aceTeamReportTimer = null
		}
	}

	private sendAceTeamReport(report: AceTeamReport): void {
		// Call the onReport callback if set
		if (this.aceTeamOnReport) {
			try {
				this.aceTeamOnReport(report)
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err)
				console.error("[debug-team] Ace Team onReport callback failed:", msg)
			}
		}

		// Send via Telegram if configured
		if (this.config.aceTeamTelegramChatId && this.config.aceTeamTelegramBotToken) {
			this.sendTelegramReport(report).catch((err) => {
				console.error("[debug-team] Ace Team Telegram report failed:", err.message)
			})
		}
	}

	private async sendTelegramReport(report: AceTeamReport): Promise<void> {
		const formatted = this.aceTeamReporter.formatForTelegram(report)
		const chatId = this.config.aceTeamTelegramChatId
		const botToken = this.config.aceTeamTelegramBotToken

		if (!chatId || !botToken) return

		// Split message if too long (Telegram limit: 4096 chars)
		const maxLen = 4000
		if (formatted.length <= maxLen) {
			await this.telegramSend(botToken, chatId, formatted)
		} else {
			// Send in parts
			const parts = this.splitMessage(formatted, maxLen)
			for (const part of parts) {
				await this.telegramSend(botToken, chatId, part)
			}
		}
	}

	private async telegramSend(botToken: string, chatId: string, text: string): Promise<void> {
		const url = `https://api.telegram.org/bot${botToken}/sendMessage`
		const res = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				chat_id: chatId,
				text,
				parse_mode: "Markdown",
			}),
		})
		if (!res.ok) {
			const body = await res.text()
			throw new Error(`Telegram API error ${res.status}: ${body}`)
		}
	}

	private splitMessage(text: string, maxLen: number): string[] {
		const parts: string[] = []
		let remaining = text
		while (remaining.length > 0) {
			if (remaining.length <= maxLen) {
				parts.push(remaining)
				break
			}
			// Try to split at a newline near the limit
			let splitAt = remaining.lastIndexOf("\n", maxLen)
			if (splitAt < maxLen / 2) {
				splitAt = maxLen
			}
			parts.push(remaining.slice(0, splitAt))
			remaining = remaining.slice(splitAt).trimStart()
		}
		return parts
	}

	// ── Job Management ─────────────────────────────────────────────────────

	/**
	 * Create a new debug job and queue it for processing.
	 */
	createJob(input: {
		goal: string
		repo?: string
		source?: DebugJob["source"]
		requestedBy?: string
		priority?: TaskPriority
		severity?: BugSeverity
		featureIds?: string[]
	}): DebugJob {
		const id = `debug_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
		const job: DebugJob = {
			id,
			goal: input.goal,
			repo: input.repo ?? this.config.defaultRepo,
			source: input.source ?? "internal",
			requestedBy: input.requestedBy,
			status: "queued",
			priority: input.priority ?? "normal",
			severity: input.severity ?? "medium",
			createdAt: Date.now(),
			updatedAt: Date.now(),
			attempts: 0,
			maxAttempts: this.config.maxAttemptsPerJob,
			rollbacks: 0,
			phases: [],
			hypotheses: [],
			snapshots: [],
			lessons: [],
			logs: [`Job created: ${input.goal}`],
			featureIds: input.featureIds ?? [],
			affectedFiles: [],
			artifactsGenerated: [],
		}

		this.jobs.set(id, job)
		this.jobQueue.push(id)
		this.stats.totalJobsCreated++
		this.stats.queuedJobs = this.jobQueue.length

		this.orchestrator.events.info("debug-team.job.created", `Debug job ${id} created`, {
			data: { goal: input.goal, repo: input.repo, source: input.source },
		})

		return job
	}

	/**
	 * Get a job by ID.
	 */
	getJob(jobId: string): DebugJob | undefined {
		return this.jobs.get(jobId)
	}

	/**
	 * List all jobs, optionally filtered by status.
	 */
	listJobs(status?: DebugJobStatus): DebugJob[] {
		const all = Array.from(this.jobs.values())
		return status ? all.filter((j) => j.status === status) : all
	}

	/**
	 * Stop a running job.
	 */
	stopJob(jobId: string): boolean {
		const job = this.jobs.get(jobId)
		if (!job) return false
		if (job.status === "success" || job.status === "failed" || job.status === "stopped") return false

		job.status = "stopped"
		job.updatedAt = Date.now()
		this.addLog(job, "Job stopped by user")

		this.orchestrator.events.info("debug-team.job.stopped", `Debug job ${jobId} stopped`)
		return true
	}

	/**
	 * Cancel all queued jobs.
	 */
	cancelAllQueued(): number {
		let count = 0
		for (const job of this.jobs.values()) {
			if (job.status === "queued") {
				job.status = "stopped"
				job.updatedAt = Date.now()
				count++
			}
		}
		this.jobQueue = []
		this.stats.queuedJobs = 0
		return count
	}

	// ── Main Loop ──────────────────────────────────────────────────────────

	private async loop(): Promise<void> {
		while (this.running) {
			try {
				await this.processQueue()
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err)
				this.orchestrator.events.error("debug-team.loop.error", `Loop error: ${msg}`)
			}
			await this.sleeper.sleep(this.config.cycleIntervalMs)
		}
	}

	private async processQueue(): Promise<void> {
		const activeCount = Array.from(this.jobs.values()).filter(
			(j) =>
				j.status === "analyzing" ||
				j.status === "planning" ||
				j.status === "patching" ||
				j.status === "testing",
		).length

		// Dispatch new jobs if capacity allows
		while (activeCount + this.getRunningCount() < this.config.maxConcurrentJobs && this.jobQueue.length > 0) {
			const jobId = this.jobQueue.shift()!
			this.stats.queuedJobs = this.jobQueue.length
			const job = this.jobs.get(jobId)
			if (!job || job.status !== "queued") continue

			// Start processing this job asynchronously
			this.processJob(job).catch((err) => {
				const msg = err instanceof Error ? err.message : String(err)
				this.orchestrator.events.error("debug-team.job.error", `Job ${jobId} error: ${msg}`)
				job.status = "failed"
				job.error = msg
				job.updatedAt = Date.now()
				this.stats.totalJobsFailed++
			})
		}
	}

	private getRunningCount(): number {
		let count = 0
		for (const job of this.jobs.values()) {
			if (
				job.status === "analyzing" ||
				job.status === "planning" ||
				job.status === "patching" ||
				job.status === "testing" ||
				job.status === "critic_review"
			) {
				count++
			}
		}
		return count
	}

	// ── Job Processing Pipeline ────────────────────────────────────────────

	private async processJob(job: DebugJob): Promise<void> {
		this.addLog(job, "Starting debug job processing")

		// Phase 1: Analyze — understand the goal and inspect the repo
		await this.transitionJob(job, "analyzing")
		const breakdown = await this.analyzeGoal(job)
		job.phases = breakdown.phases.map((p, i) => ({
			id: `phase_${i}`,
			name: p.title,
			description: p.description,
			order: i,
			status: "pending" as const,
		}))

		// Phase 2: Plan — create phase breakdown and hypotheses
		await this.transitionJob(job, "planning")

		// ── HermesClaw: Context recall before hypothesis creation ──
		if (this.config.enableHermesClaw) {
			try {
				const memoryResult = await this.hermesClaw.recallContext(
					`Planning hypothesis for: ${job.goal}. Previous attempts: ${job.attempts}. Lessons learned: ${job.lessons.length}`,
				)
				if (memoryResult.success && memoryResult.output) {
					this.addLog(job, `HermesClaw context: ${memoryResult.output.slice(0, 200)}`)
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err)
				this.addLog(job, `HermesClaw context recall skipped (non-blocking): ${msg}`)
			}
		}

		const initialHypothesis = this.hypothesisEngine.createHypothesis({
			goal: job.goal,
			phases: breakdown.phases,
			repo: job.repo,
		})
		job.hypotheses.push(initialHypothesis)

		// Main attempt loop
		for (let attempt = 1; attempt <= job.maxAttempts; attempt++) {
			job.attempts = attempt
			this.stats.totalAttempts++
			this.addLog(job, `Attempt ${attempt}/${job.maxAttempts}`)

			// Phase 3: Snapshot
			await this.transitionJob(job, "snapshotting")
			const snapshot = await this.createSnapshot(job, attempt)
			job.snapshots.push(snapshot)

			// Phase 4: Patch — implement the smallest viable change
			await this.transitionJob(job, "patching")
			const patchOk = await this.executePatch(job, attempt)
			if (!patchOk) {
				await this.handleFailure(job, attempt, "patch_failed")
				continue
			}

			// Phase 5: Test — run in sandbox
			await this.transitionJob(job, "testing")
			const testResult = await this.runTests(job, attempt)
			if (!testResult.ok) {
				await this.handleFailure(job, attempt, testResult.error ?? "test_failed")
				continue
			}

			// Phase 6: Critic Review
			await this.transitionJob(job, "critic_review")
			const criticOk = await this.runCriticReview(job, attempt)
			if (!criticOk) {
				await this.handleFailure(job, attempt, "critic_rejected")
				continue
			}

			// Phase 7: Feature Sync (if enabled)
			if (this.config.featureSyncEnabled) {
				const syncPlan = await this.featureSync.createSyncPlan({
					jobId: job.id,
					goal: job.goal,
					featureIds: job.featureIds,
					affectedFiles: job.affectedFiles,
				})
				const syncOk = await this.featureSync.executeSyncPlan(syncPlan)
				if (!syncOk) {
					this.addLog(job, `Feature sync failed: ${syncPlan.error ?? "unknown"}`)
				}
			}

			// Phase 8: Commit
			await this.transitionJob(job, "committing")
			await this.commitSuccess(job, attempt)

			// Phase 9: Auto-Deploy (if enabled and auto-approval mode is active)
			if (this.config.autoApprovalMode && this.config.autoDeploy) {
				await this.transitionJob(job, "deploying")
				await this.autoDeploy(job, attempt)
			}

			// Generate skills from lessons if enabled
			if (this.config.autoGenerateSkills && job.lessons.length > 0) {
				await this.generateSkillsFromLessons(job)
			}

			// ── HermesClaw: Memory summary on success ──
			if (this.config.enableHermesClaw) {
				try {
					const summaryResult = await this.hermesClaw.generateMemorySummary({
						jobId: job.id,
						goal: job.goal,
						attempts: attempt,
						hypotheses: job.hypotheses.map((h) => ({
							description: h.description,
							confidence: h.confidence,
							status: h.status,
						})),
						lessons: job.lessons.map((l) => ({
							failureType: l.failureType,
							rootCause: l.rootCause,
						})),
						finalStatus: "success",
					})
					if (summaryResult.success && summaryResult.output) {
						this.addLog(job, `HermesClaw memory: ${summaryResult.output.slice(0, 200)}`)
					}
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err)
					this.addLog(job, `HermesClaw memory summary skipped (non-blocking): ${msg}`)
				}
			}

			job.status = "success"
			job.updatedAt = Date.now()
			this.stats.totalJobsCompleted++
			this.addLog(job, "Job completed successfully")
			this.orchestrator.events.info("debug-team.job.success", `Job ${job.id} completed`, {
				data: {
					attempts: attempt,
					phases: job.phases.length,
					lessons: job.lessons.length,
					autoApprovalMode: this.config.autoApprovalMode,
				},
			})
			return
		}

		// All attempts exhausted
		job.status = "failed"
		job.error = `All ${job.maxAttempts} attempts exhausted`
		job.updatedAt = Date.now()
		this.stats.totalJobsFailed++
		this.addLog(job, `Job failed after ${job.maxAttempts} attempts`)
		this.orchestrator.events.error(
			"debug-team.job.failed",
			`Job ${job.id} failed after ${job.maxAttempts} attempts`,
		)
	}

	// ── Pipeline Steps ─────────────────────────────────────────────────────

	private async analyzeGoal(job: DebugJob): Promise<PhaseBreakdown> {
		this.addLog(job, "Analyzing goal and inspecting repo")

		// ── OpenClaw: Repo Investigation (analysis-only, no coding) ──
		if (this.config.enableOpenClaw) {
			try {
				const repoPath = `${this.config.workspaceRoot}/${job.repo}`
				this.addLog(job, `OpenClaw investigating repo: ${repoPath}`)
				const investigation = await this.openClaw.investigateRepo(repoPath)
				if (investigation.success) {
					this.addLog(
						job,
						`OpenClaw analysis: ${investigation.keyFindings.length} findings, ${investigation.riskFlags.length} risk flags`,
					)
					job.affectedFiles = investigation.filesAnalyzed

					// Log key findings
					for (const finding of investigation.keyFindings) {
						this.addLog(job, `  🔍 ${finding}`)
					}

					// Log risk flags
					for (const flag of investigation.riskFlags) {
						this.addLog(job, `  ⚠️ Risk: ${flag}`)
					}
				} else {
					this.addLog(job, `OpenClaw investigation returned no results: ${investigation.error ?? "unknown"}`)
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err)
				this.addLog(job, `OpenClaw analysis skipped (non-blocking): ${msg}`)
			}
		}

		// ── HermesClaw: Context Recall (before creating breakdown) ──
		if (this.config.enableHermesClaw) {
			try {
				const contextResult = await this.hermesClaw.recallContext(
					`Debug goal: ${job.goal}. Repo: ${job.repo}. Features: ${job.featureIds.join(", ")}`,
					3,
				)
				if (contextResult.success && contextResult.output) {
					this.addLog(job, `HermesClaw context recall: ${contextResult.output.slice(0, 300)}`)
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err)
				this.addLog(job, `HermesClaw context recall skipped (non-blocking): ${msg}`)
			}
		}

		const breakdown = await this.phaseEngine.createBreakdown({
			goal: job.goal,
			context: `Repo: ${job.repo}, Workspace: ${this.config.workspaceRoot}`,
			constraints: [],
			availableCapabilities: ["coding", "testing", "code-review", "deployment"],
		})
		this.addLog(
			job,
			`Breakdown created: ${breakdown.phases.length} phases, critical path: ${breakdown.criticalPath.length} phases`,
		)
		return breakdown
	}

	private async createSnapshot(job: DebugJob, attempt: number): Promise<DebugSnapshot> {
		const repoPath = `${this.config.workspaceRoot}/${job.repo}`
		const snapshot = await this.rollbackManager.createSnapshot(repoPath, {
			label: `attempt-${attempt}`,
			metadata: { jobId: job.id, goal: job.goal, attempt },
		})
		this.addLog(job, `Snapshot created: ${snapshot.rev}`)
		return {
			id: snapshot.id,
			rev: snapshot.rev,
			branch: snapshot.branch,
			timestamp: snapshot.timestamp,
			phase: "patching",
			attempt,
			description: `Before attempt ${attempt}`,
		}
	}

	private async executePatch(job: DebugJob, attempt: number): Promise<boolean> {
		const currentHypothesis = job.hypotheses[job.hypotheses.length - 1]
		if (!currentHypothesis) {
			this.addLog(job, "No hypothesis to test")
			return false
		}

		this.addLog(job, `Executing patch for hypothesis: ${currentHypothesis.description}`)

		// Queue a coder task for the patch
		const patchTask: TaskInputRaw = {
			agent: "coder",
			goal: `[Debug Team] Apply patch for job ${job.id}: ${job.goal}`,
			priority: job.priority,
			requiredCapabilities: ["read.file", "write.file", "execute.command"],
			payload: {
				debugJobId: job.id,
				hypothesisId: currentHypothesis.id,
				attempt,
				goal: job.goal,
				affectedFiles: job.affectedFiles,
				phases: job.phases.map((p) => ({ name: p.name, description: p.description })),
				systemPromptOverlay:
					`You are implementing a patch for debug job ${job.id}. ` +
					`Hypothesis: ${currentHypothesis.description}. ` +
					`Make the smallest viable change. Do not rewrite unrelated code. ` +
					`Run targeted tests after each change.`,
			},
		}

		this.orchestrator.submit(patchTask)
		return true
	}

	private async runTests(job: DebugJob, attempt: number): Promise<{ ok: boolean; error?: string }> {
		const repoPath = `${this.config.workspaceRoot}/${job.repo}`

		if (this.config.useSandbox) {
			this.addLog(job, "Running tests in Docker sandbox")
			const result = await this.sandbox.runCommand({
				repoRoot: repoPath,
				command:
					"corepack enable 2>/dev/null; pnpm install --frozen-lockfile 2>/dev/null || pnpm install; pnpm build 2>&1; pnpm test 2>&1 || true",
				timeout: 300,
			})
			this.addLog(job, `Sandbox result: exit=${result.exitCode}, output=${result.output.slice(0, 500)}`)
			if (result.exitCode !== 0) {
				return { ok: false, error: `sandbox_test_failed: exit ${result.exitCode}` }
			}
		} else {
			// Queue a tester task
			const testTask: TaskInputRaw = {
				agent: "tester",
				goal: `[Debug Team] Verify patch for job ${job.id}: ${job.goal}`,
				priority: job.priority,
				requiredCapabilities: ["read.file", "execute.command"],
				payload: {
					debugJobId: job.id,
					attempt,
					affectedFiles: job.affectedFiles,
					systemPromptOverlay:
						`Verify that the patch for debug job ${job.id} works. ` +
						`Run build first, then unit tests, then integration tests. ` +
						`Report pass/fail for each.`,
				},
			}
			this.orchestrator.submit(testTask)
		}

		return { ok: true }
	}

	private async runCriticReview(job: DebugJob, attempt: number): Promise<boolean> {
		this.addLog(job, "Running critic review")

		// Verify assumptions
		const currentHypothesis = job.hypotheses[job.hypotheses.length - 1]
		if (!currentHypothesis) return false

		const allVerified = currentHypothesis.assumptions.every((a) => a.status === "verified")
		if (!allVerified) {
			const unverified = currentHypothesis.assumptions.filter((a) => a.status !== "verified")
			this.addLog(job, `Critic: ${unverified.length} unverified assumptions`)
			return false
		}

		// Check confidence threshold
		if (currentHypothesis.confidence < this.config.confidenceThreshold) {
			this.addLog(
				job,
				`Critic: confidence ${currentHypothesis.confidence} < threshold ${this.config.confidenceThreshold}`,
			)
			return false
		}

		return true
	}

	private async handleFailure(job: DebugJob, attempt: number, reason: string): Promise<void> {
		this.addLog(job, `Attempt ${attempt} failed: ${reason}`)

		// Record lesson
		const lesson: DebugLesson = {
			id: `lesson_${Date.now()}`,
			jobId: job.id,
			attempt,
			failureType: reason,
			rootCause: "unknown",
			filesInvolved: [...job.affectedFiles],
			nextHypothesis: "",
			skillGenerated: false,
			createdAt: Date.now(),
		}
		job.lessons.push(lesson)

		// ── HermesClaw: Extract lessons from failure ──
		if (this.config.enableHermesClaw) {
			try {
				const lessonResult = await this.hermesClaw.extractLessons({
					jobId: job.id,
					goal: job.goal,
					attempts: [
						{
							number: attempt,
							hypothesis: job.hypotheses[job.hypotheses.length - 1]?.description ?? "unknown",
							result: reason,
							error: reason,
						},
					],
					finalStatus: "failed",
				})
				if (lessonResult.success && lessonResult.output) {
					this.addLog(job, `HermesClaw lesson: ${lessonResult.output.slice(0, 300)}`)
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err)
				this.addLog(job, `HermesClaw lesson extraction skipped (non-blocking): ${msg}`)
			}
		}

		// Rollback if enabled
		if (this.config.autoRollback && job.snapshots.length > 0) {
			const latestSnapshot = job.snapshots[job.snapshots.length - 1]
			const repoPath = `${this.config.workspaceRoot}/${job.repo}`
			try {
				await this.rollbackManager.rollback(repoPath, latestSnapshot.rev)
				this.stats.totalRollbacks++
				this.addLog(job, `Rolled back to snapshot ${latestSnapshot.rev}`)
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err)
				this.addLog(job, `Rollback failed: ${msg}`)
			}
		}

		// Generate new hypothesis for next attempt
		const newHypothesis = this.hypothesisEngine.refineHypothesis({
			previousHypothesis: job.hypotheses[job.hypotheses.length - 1],
			failureReason: reason,
			attempt,
			lessons: job.lessons,
		})
		job.hypotheses.push(newHypothesis)
		this.addLog(job, `New hypothesis: ${newHypothesis.description} (confidence: ${newHypothesis.confidence})`)

		// Generate skill from failure if enabled
		if (this.config.autoGenerateSkills) {
			try {
				const artifact = await this.skillsGen.generateFromFailure({
					goal: job.goal,
					failureType: reason,
					attempt,
					lessons: job.lessons,
					affectedFiles: job.affectedFiles,
				})
				job.artifactsGenerated.push(artifact)
				lesson.skillGenerated = true
				lesson.skillPath = artifact.path
				this.stats.totalSkillsGenerated++
				this.addLog(job, `Skill generated: ${artifact.path}`)
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err)
				this.addLog(job, `Skill generation failed: ${msg}`)
			}
		}

		this.orchestrator.events.info(
			"debug-team.job.retry",
			`Job ${job.id} retrying (${attempt}/${job.maxAttempts})`,
			{
				data: { reason, newConfidence: newHypothesis.confidence },
			},
		)
	}

	private async commitSuccess(job: DebugJob, attempt: number): Promise<void> {
		const repoPath = `${this.config.workspaceRoot}/${job.repo}`
		try {
			await this.rollbackManager.commitSuccess(repoPath, {
				message: `debug-team: ${job.goal} (job ${job.id}, attempt ${attempt})`,
				author: "super-roo-debug-team",
			})
			this.addLog(job, "Changes committed")
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			this.addLog(job, `Commit note: ${msg} (non-blocking)`)
		}
	}

	private async autoDeploy(job: DebugJob, attempt: number): Promise<void> {
		this.addLog(job, `Auto-deploying to ${this.config.deployTarget} (auto-approval mode)`)

		const deployTask: TaskInputRaw = {
			agent: "deploy-checker",
			goal: `[Debug Team] Auto-deploy job ${job.id}: ${job.goal}`,
			priority: job.priority,
			requiredCapabilities: ["deploy.staging"],
			payload: {
				debugJobId: job.id,
				attempt,
				deployTarget: this.config.deployTarget,
				autoApproved: true,
				systemPromptOverlay:
					`Auto-deploy triggered by Debug Team (auto-approval mode). ` +
					`Deploy to ${this.config.deployTarget}. ` +
					`Run health checks after deploy. ` +
					`If health check fails, trigger rollback.`,
			},
		}

		this.orchestrator.submit(deployTask)
		this.stats.totalDeployments++
		this.addLog(job, `Deploy task submitted to ${this.config.deployTarget}`)
	}

	private async generateSkillsFromLessons(job: DebugJob): Promise<void> {
		for (const lesson of job.lessons) {
			if (!lesson.skillGenerated) {
				try {
					const artifact = await this.skillsGen.generateFromLesson(lesson)
					job.artifactsGenerated.push(artifact)
					lesson.skillGenerated = true
					lesson.skillPath = artifact.path
					this.stats.totalSkillsGenerated++
					this.addLog(job, `Skill generated from lesson: ${artifact.path}`)
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err)
					this.addLog(job, `Skill generation from lesson failed: ${msg}`)
				}
			}
		}
	}

	// ── Helpers ────────────────────────────────────────────────────────────

	private async transitionJob(job: DebugJob, newStatus: DebugJobStatus): Promise<void> {
		const oldStatus = job.status
		job.status = newStatus
		job.updatedAt = Date.now()
		this.addLog(job, `Status: ${oldStatus} → ${newStatus}`)
		this.orchestrator.events.info("debug-team.job.transition", `Job ${job.id}: ${oldStatus} → ${newStatus}`)
	}

	private addLog(job: DebugJob, message: string): void {
		job.logs.push(`[${new Date().toISOString()}] ${message}`)
		if (job.logs.length > this.config.maxLogsPerJob) {
			job.logs = job.logs.slice(-this.config.maxLogsPerJob)
		}
	}
}
