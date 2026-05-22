/**
 * Cloud Orchestrator — Super Debug Loop.
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
 * Ported from src/super-roo/debug-team/SuperDebugLoop.ts for the cloud runtime.
 */

// ─── Default Config ─────────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
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

// ─── SuperDebugLoop ─────────────────────────────────────────────────────────

class SuperDebugLoop {
	/**
	 * @param {object} orchestrator - Cloud orchestrator instance
	 * @param {object} [config={}] - Partial config overrides
	 * @param {object} [deps={}] - Optional dependency injections (for testing)
	 * @param {object} [deps.phaseEngine]
	 * @param {object} [deps.hypothesisEngine]
	 * @param {object} [deps.sandbox]
	 * @param {object} [deps.rollbackManager]
	 * @param {object} [deps.featureSync]
	 * @param {object} [deps.skillsGen]
	 * @param {object} [deps.openClaw]
	 * @param {object} [deps.hermesClaw]
	 * @param {object} [deps.aceTeamReporter]
	 * @param {object} [deps.mlLoop]
	 */
	constructor(orchestrator, config = {}, deps = {}) {
		this.orchestrator = orchestrator
		this.config = { ...DEFAULT_CONFIG, ...config }

		this.running = false
		this.handle = null
		this.jobs = new Map()
		this.jobQueue = []
		this.startedAt = 0

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

		// Sub-engines (lazy init with optional injection)
		this.phaseEngine = deps.phaseEngine || null
		this.hypothesisEngine = deps.hypothesisEngine || null
		this.sandbox = deps.sandbox || null
		this.rollbackManager = deps.rollbackManager || null
		this.featureSync = deps.featureSync || null
		this.skillsGen = deps.skillsGen || null

		// Adapters (lazy init with optional injection)
		this.openClaw = deps.openClaw || null
		this.hermesClaw = deps.hermesClaw || null

		// Ace Team
		this.aceTeamReporter = deps.aceTeamReporter || null
		this.aceTeamReportTimer = null
		this.aceTeamOnReport = null

		// ML Integration
		this.mlLoop = deps.mlLoop || null

		// Sleeper for the main loop
		this._sleeperResolve = null
		this._sleeperTimer = null
	}

	// ── Internal: Lazy init helpers ────────────────────────────────────────

	_getPhaseEngine() {
		if (!this.phaseEngine) {
			const { PhaseBreakdownEngine } = require("./engines/PhaseBreakdownEngine")
			this.phaseEngine = new PhaseBreakdownEngine()
		}
		return this.phaseEngine
	}

	_getHypothesisEngine() {
		if (!this.hypothesisEngine) {
			const { HypothesisEngine } = require("./engines/HypothesisEngine")
			this.hypothesisEngine = new HypothesisEngine({
				confidenceThreshold: this.config.confidenceThreshold,
			})
		}
		return this.hypothesisEngine
	}

	_getSandbox() {
		if (!this.sandbox) {
			const { ContainerSandbox } = require("./sandbox/ContainerSandbox")
			this.sandbox = new ContainerSandbox({
				image: this.config.sandboxImage,
				network: this.config.sandboxNetwork,
			})
		}
		return this.sandbox
	}

	_getRollbackManager() {
		if (!this.rollbackManager) {
			const { RollbackManager } = require("./sandbox/RollbackManager")
			this.rollbackManager = new RollbackManager()
		}
		return this.rollbackManager
	}

	_getFeatureSync() {
		if (!this.featureSync) {
			const { FeatureSyncOrchestrator } = require("./engines/FeatureSyncOrchestrator")
			this.featureSync = new FeatureSyncOrchestrator()
		}
		return this.featureSync
	}

	_getSkillsGen() {
		if (!this.skillsGen) {
			const { SkillsGenerator } = require("./engines/SkillsGenerator")
			this.skillsGen = new SkillsGenerator({
				workspaceRoot: this.config.workspaceRoot,
			})
		}
		return this.skillsGen
	}

	_getOpenClaw() {
		if (!this.openClaw) {
			const { OpenClawAdapter } = require("./adapters/OpenClawAdapter")
			this.openClaw = new OpenClawAdapter({
				cliPath: this.config.openClawCliPath,
			})
		}
		return this.openClaw
	}

	_getHermesClaw() {
		if (!this.hermesClaw) {
			const { HermesClawAdapter } = require("./adapters/HermesClawAdapter")
			this.hermesClaw = new HermesClawAdapter({
				apiKey: this.config.hermesClawApiKey,
				model: this.config.hermesClawModel,
			})
		}
		return this.hermesClaw
	}

	_getAceTeamReporter() {
		if (!this.aceTeamReporter) {
			const { AceTeamReportGenerator } = require("./reporting/AceTeamReportGenerator")
			this.aceTeamReporter = new AceTeamReportGenerator()
		}
		return this.aceTeamReporter
	}

	_getMlLoop() {
		if (!this.mlLoop && this.config.enableML) {
			const { InfiniteImprovementLoop } = require("../ml/loop/InfiniteImprovementLoop")
			this.mlLoop = new InfiniteImprovementLoop(this.orchestrator, {
				minSamples: 3,
				maxIterations: 100,
				idleSleepMs: 60000,
				trainEpochs: 10,
				confidenceThreshold: 0.7,
				maxActionsPerIteration: 5,
			})
		}
		return this.mlLoop
	}

	// ── Lifecycle ──────────────────────────────────────────────────────────

	start() {
		if (this.running) return
		this.running = true
		this.startedAt = Date.now()
		this.stats.isRunning = true
		this.stats.autoApprovalMode = this.config.autoApprovalMode

		const modeMsg = this.config.autoApprovalMode
			? "AUTO-APPROVAL MODE ACTIVE — all approvals auto-granted, all deployments auto-run"
			: "Manual approval mode — waiting for human gates"

		if (this.orchestrator && this.orchestrator.events) {
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
		}
		this.handle = this._loop()
	}

	async stop() {
		if (!this.running) return
		this.running = false
		this.stats.isRunning = false
		this._sleeperStop()
		if (this.handle) {
			try {
				await this.handle
			} catch {
				// loop will have logged
			}
		}
		if (this.orchestrator && this.orchestrator.events) {
			this.orchestrator.events.info("debug-team.loop.stopped", "Super Debug Loop stopped")
		}
	}

	getStats() {
		return { ...this.stats, uptimeMs: this.startedAt ? Date.now() - this.startedAt : 0 }
	}

	getConfig() {
		return { ...this.config }
	}

	/**
	 * Toggle auto-approval mode at runtime.
	 * @param {boolean} enabled
	 */
	setAutoApprovalMode(enabled) {
		this.config.autoApprovalMode = enabled
		this.stats.autoApprovalMode = enabled
		if (this.orchestrator && this.orchestrator.events) {
			this.orchestrator.events.info(
				"debug-team.auto_approval",
				`Auto-approval mode ${enabled ? "ENABLED" : "DISABLED"}`,
			)
		}
	}

	// ── Ace Team Mode (/aceteam) ─────────────────────────────────────────────

	/**
	 * Enable Ace Team mode. When active, comprehensive logs are kept,
	 * accomplishment reports are generated, and ML insights are collected.
	 * Reports can be sent to a Telegram chat.
	 *
	 * @param {object} config
	 * @param {string} [config.telegramChatId]
	 * @param {string} [config.telegramBotToken]
	 * @param {number} [config.reportIntervalMs]
	 * @param {function} [config.onReport]
	 */
	enableAceTeam(config = {}) {
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
		this._getAceTeamReporter().startSession()

		// Start periodic report timer
		this._startAceTeamReportTimer()

		if (this.orchestrator && this.orchestrator.events) {
			this.orchestrator.events.info(
				"debug-team.ace_team.enabled",
				`Ace Team mode enabled. Reports to chat: ${config.telegramChatId || "none"}`,
			)
		}
	}

	/**
	 * Disable Ace Team mode and generate a final report.
	 * @returns {object|null}
	 */
	disableAceTeam() {
		if (!this.config.aceTeamMode) return null

		this.config.aceTeamMode = false
		this.stats.aceTeamMode = false
		this.stats.aceTeamSessionActive = false

		// Stop the report timer
		this._stopAceTeamReportTimer()

		// Generate final report
		const report = this._getAceTeamReporter().generateReport({
			uptimeMs: this.startedAt ? Date.now() - this.startedAt : 0,
			activeJobs: this.stats.activeJobs,
			queuedJobs: this.stats.queuedJobs,
			autoApprovalMode: this.config.autoApprovalMode,
		})

		this.stats.aceTeamReportsGenerated++
		this._sendAceTeamReport(report)

		if (this.orchestrator && this.orchestrator.events) {
			this.orchestrator.events.info(
				"debug-team.ace_team.disabled",
				`Ace Team mode disabled. Report: ${report.reportId}`,
			)
		}

		return report
	}

	/**
	 * Check if Ace Team mode is active.
	 * @returns {boolean}
	 */
	isAceTeamActive() {
		return this.config.aceTeamMode
	}

	/**
	 * Get the latest Ace Team report (without generating a new one).
	 * @returns {object|null}
	 */
	getAceTeamReport() {
		if (!this.config.aceTeamMode) return null
		return this._getAceTeamReporter().generateReport({
			uptimeMs: this.startedAt ? Date.now() - this.startedAt : 0,
			activeJobs: this.stats.activeJobs,
			queuedJobs: this.stats.queuedJobs,
			autoApprovalMode: this.config.autoApprovalMode,
		})
	}

	/**
	 * Get Ace Team session stats for real-time monitoring.
	 * @returns {object|null}
	 */
	getAceTeamSessionStats() {
		if (!this.config.aceTeamMode) return null
		return this._getAceTeamReporter().getSessionStats()
	}

	/**
	 * Set a callback for when Ace Team reports are generated.
	 * @param {function} callback
	 */
	onAceTeamReport(callback) {
		this.aceTeamOnReport = callback
	}

	// ── ML Integration ───────────────────────────────────────────────────────

	/**
	 * Feed ML insights from a completed job into the InfiniteImprovementLoop.
	 * @param {object} job
	 */
	async _feedMLInsights(job) {
		const mlLoop = this._getMlLoop()
		if (!mlLoop || !this.config.enableML) return

		try {
			// Feed the job as a task to the ML loop for pattern learning
			const task = {
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
			if (this.orchestrator && typeof this.orchestrator.submit === "function") {
				this.orchestrator.submit(task)
			}

			// Detect patterns from job history
			const patterns = this._detectPatterns(job)
			if (patterns.length > 0) {
				this._getAceTeamReporter().recordPatterns(patterns)
				this.stats.mlPatternsDetected += patterns.length
			}

			// Detect common failures
			const failures = this._detectCommonFailures(job)
			if (failures.length > 0) {
				this._getAceTeamReporter().recordFailures(failures)
			}

			// Generate suggestions
			const suggestions = this._generateSuggestions(job)
			if (suggestions.length > 0) {
				this._getAceTeamReporter().recordSuggestions(suggestions)
				this.stats.mlSuggestionsGenerated += suggestions.length
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			this._addLog(job, `ML insight feeding skipped: ${msg}`)
		}
	}

	/**
	 * Detect patterns across jobs for ML insights.
	 * @param {object} job
	 * @returns {string[]}
	 */
	_detectPatterns(job) {
		const patterns = []

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
	 * @param {object} job
	 * @returns {string[]}
	 */
	_detectCommonFailures(job) {
		const failures = []
		const typeCounts = new Map()

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
	 * @param {object} job
	 * @returns {string[]}
	 */
	_generateSuggestions(job) {
		const suggestions = []

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

	_startAceTeamReportTimer() {
		this._stopAceTeamReportTimer()
		this.aceTeamReportTimer = setInterval(() => {
			if (!this.config.aceTeamMode) {
				this._stopAceTeamReportTimer()
				return
			}
			const report = this._getAceTeamReporter().generateReport({
				uptimeMs: this.startedAt ? Date.now() - this.startedAt : 0,
				activeJobs: this.stats.activeJobs,
				queuedJobs: this.stats.queuedJobs,
				autoApprovalMode: this.config.autoApprovalMode,
			})
			this.stats.aceTeamReportsGenerated++
			this._sendAceTeamReport(report)
		}, this.config.aceTeamReportIntervalMs)
	}

	_stopAceTeamReportTimer() {
		if (this.aceTeamReportTimer !== null) {
			clearInterval(this.aceTeamReportTimer)
			this.aceTeamReportTimer = null
		}
	}

	_sendAceTeamReport(report) {
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
			this._sendTelegramReport(report).catch((err) => {
				console.error("[debug-team] Ace Team Telegram report failed:", err.message)
			})
		}
	}

	async _sendTelegramReport(report) {
		const formatted = this._getAceTeamReporter().formatForTelegram(report)
		const chatId = this.config.aceTeamTelegramChatId
		const botToken = this.config.aceTeamTelegramBotToken

		if (!chatId || !botToken) return

		// Split message if too long (Telegram limit: 4096 chars)
		const maxLen = 4000
		if (formatted.length <= maxLen) {
			await this._telegramSend(botToken, chatId, formatted)
		} else {
			// Send in parts
			const parts = this._splitMessage(formatted, maxLen)
			for (const part of parts) {
				await this._telegramSend(botToken, chatId, part)
			}
		}
	}

	async _telegramSend(botToken, chatId, text) {
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

	_splitMessage(text, maxLen) {
		const parts = []
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
	 *
	 * @param {object} input
	 * @param {string} input.goal
	 * @param {string} [input.repo]
	 * @param {string} [input.source]
	 * @param {string} [input.requestedBy]
	 * @param {string} [input.priority]
	 * @param {string} [input.severity]
	 * @param {string[]} [input.featureIds]
	 * @returns {object} The created DebugJob
	 */
	createJob(input) {
		const id = `debug_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
		const job = {
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

		if (this.orchestrator && this.orchestrator.events) {
			this.orchestrator.events.info("debug-team.job.created", `Debug job ${id} created`, {
				data: { goal: input.goal, repo: input.repo, source: input.source },
			})
		}

		return job
	}

	/**
	 * Get a job by ID.
	 * @param {string} jobId
	 * @returns {object|undefined}
	 */
	getJob(jobId) {
		return this.jobs.get(jobId)
	}

	/**
	 * List all jobs, optionally filtered by status.
	 * @param {string} [status]
	 * @returns {object[]}
	 */
	listJobs(status) {
		const all = Array.from(this.jobs.values())
		return status ? all.filter((j) => j.status === status) : all
	}

	/**
	 * Stop a running job.
	 * @param {string} jobId
	 * @returns {boolean}
	 */
	stopJob(jobId) {
		const job = this.jobs.get(jobId)
		if (!job) return false
		if (job.status === "success" || job.status === "failed" || job.status === "stopped") return false

		job.status = "stopped"
		job.updatedAt = Date.now()
		this._addLog(job, "Job stopped by user")

		if (this.orchestrator && this.orchestrator.events) {
			this.orchestrator.events.info("debug-team.job.stopped", `Debug job ${jobId} stopped`)
		}
		return true
	}

	/**
	 * Cancel all queued jobs.
	 * @returns {number} Number of jobs cancelled
	 */
	cancelAllQueued() {
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

	async _loop() {
		while (this.running) {
			try {
				await this._processQueue()
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err)
				if (this.orchestrator && this.orchestrator.events) {
					this.orchestrator.events.error("debug-team.loop.error", `Loop error: ${msg}`)
				}
			}
			await this._sleeperSleep(this.config.cycleIntervalMs)
		}
	}

	async _processQueue() {
		const activeCount = Array.from(this.jobs.values()).filter(
			(j) =>
				j.status === "analyzing" ||
				j.status === "planning" ||
				j.status === "patching" ||
				j.status === "testing",
		).length

		// Dispatch new jobs if capacity allows
		while (activeCount + this._getRunningCount() < this.config.maxConcurrentJobs && this.jobQueue.length > 0) {
			const jobId = this.jobQueue.shift()
			this.stats.queuedJobs = this.jobQueue.length
			const job = this.jobs.get(jobId)
			if (!job || job.status !== "queued") continue

			// Start processing this job asynchronously
			this._processJob(job).catch((err) => {
				const msg = err instanceof Error ? err.message : String(err)
				if (this.orchestrator && this.orchestrator.events) {
					this.orchestrator.events.error("debug-team.job.error", `Job ${jobId} error: ${msg}`)
				}
				job.status = "failed"
				job.error = msg
				job.updatedAt = Date.now()
				this.stats.totalJobsFailed++
			})
		}
	}

	_getRunningCount() {
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

	async _processJob(job) {
		this._addLog(job, "Starting debug job processing")

		// Phase 1: Analyze — understand the goal and inspect the repo
		await this._transitionJob(job, "analyzing")
		const breakdown = await this._analyzeGoal(job)
		job.phases = breakdown.phases.map((p, i) => ({
			id: `phase_${i}`,
			name: p.title,
			description: p.description,
			order: i,
			status: "pending",
		}))

		// Phase 2: Plan — create phase breakdown and hypotheses
		await this._transitionJob(job, "planning")

		// ── HermesClaw: Context recall before hypothesis creation ──
		if (this.config.enableHermesClaw) {
			try {
				const hermes = this._getHermesClaw()
				const memoryResult = await hermes.recallContext(
					`Planning hypothesis for: ${job.goal}. Previous attempts: ${job.attempts}. Lessons learned: ${job.lessons.length}`,
				)
				if (memoryResult.success && memoryResult.output) {
					this._addLog(job, `HermesClaw context: ${memoryResult.output.slice(0, 200)}`)
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err)
				this._addLog(job, `HermesClaw context recall skipped (non-blocking): ${msg}`)
			}
		}

		const hypothesisEngine = this._getHypothesisEngine()
		const initialHypothesis = hypothesisEngine.createHypothesis({
			goal: job.goal,
			phases: breakdown.phases,
			repo: job.repo,
		})
		job.hypotheses.push(initialHypothesis)

		// Main attempt loop
		for (let attempt = 1; attempt <= job.maxAttempts; attempt++) {
			job.attempts = attempt
			this.stats.totalAttempts++
			this._addLog(job, `Attempt ${attempt}/${job.maxAttempts}`)

			// Phase 3: Snapshot
			await this._transitionJob(job, "snapshotting")
			const snapshot = await this._createSnapshot(job, attempt)
			job.snapshots.push(snapshot)

			// Phase 4: Patch — implement the smallest viable change
			await this._transitionJob(job, "patching")
			const patchOk = await this._executePatch(job, attempt)
			if (!patchOk) {
				await this._handleFailure(job, attempt, "patch_failed")
				continue
			}

			// Phase 5: Test — run in sandbox
			await this._transitionJob(job, "testing")
			const testResult = await this._runTests(job, attempt)
			if (!testResult.ok) {
				await this._handleFailure(job, attempt, testResult.error ?? "test_failed")
				continue
			}

			// Phase 6: Critic Review
			await this._transitionJob(job, "critic_review")
			const criticOk = await this._runCriticReview(job, attempt)
			if (!criticOk) {
				await this._handleFailure(job, attempt, "critic_rejected")
				continue
			}

			// Phase 7: Feature Sync (if enabled)
			if (this.config.featureSyncEnabled) {
				const fsync = this._getFeatureSync()
				const syncPlan = await fsync.createSyncPlan({
					jobId: job.id,
					goal: job.goal,
					featureIds: job.featureIds,
					affectedFiles: job.affectedFiles,
				})
				const syncOk = await fsync.executeSyncPlan(syncPlan)
				if (!syncOk) {
					this._addLog(job, `Feature sync failed: ${syncPlan.error ?? "unknown"}`)
				}
			}

			// Phase 8: Commit
			await this._transitionJob(job, "committing")
			await this._commitSuccess(job, attempt)

			// Phase 9: Auto-Deploy (if enabled and auto-approval mode is active)
			if (this.config.autoApprovalMode && this.config.autoDeploy) {
				await this._transitionJob(job, "deploying")
				await this._autoDeploy(job, attempt)
			}

			// Generate skills from lessons if enabled
			if (this.config.autoGenerateSkills && job.lessons.length > 0) {
				await this._generateSkillsFromLessons(job)
			}

			// ── HermesClaw: Memory summary on success ──
			if (this.config.enableHermesClaw) {
				try {
					const hermes = this._getHermesClaw()
					const summaryResult = await hermes.generateMemorySummary({
						jobId: job.id,
						goal: job.goal,
						attempts: attempt,
						hypotheses: job.hypotheses.map((h) => ({
							description: h.description,
							confidence: h.confidence,
							status: h.status,
						})),
						finalStatus: "success",
					})
					if (summaryResult.success && summaryResult.output) {
						this._addLog(job, `HermesClaw memory: ${summaryResult.output.slice(0, 200)}`)
					}
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err)
					this._addLog(job, `HermesClaw memory summary skipped (non-blocking): ${msg}`)
				}
			}

			job.status = "success"
			job.updatedAt = Date.now()
			this.stats.totalJobsCompleted++
			this._addLog(job, "Job completed successfully")
			if (this.orchestrator && this.orchestrator.events) {
				this.orchestrator.events.info("debug-team.job.success", `Job ${job.id} completed`, {
					data: {
						attempts: attempt,
						phases: job.phases.length,
						lessons: job.lessons.length,
						autoApprovalMode: this.config.autoApprovalMode,
					},
				})
			}
			return
		}

		// All attempts exhausted
		job.status = "failed"
		job.error = `All ${job.maxAttempts} attempts exhausted`
		job.updatedAt = Date.now()
		this.stats.totalJobsFailed++
		this._addLog(job, `Job failed after ${job.maxAttempts} attempts`)
		if (this.orchestrator && this.orchestrator.events) {
			this.orchestrator.events.error(
				"debug-team.job.failed",
				`Job ${job.id} failed after ${job.maxAttempts} attempts`,
			)
		}
	}

	// ── Pipeline Steps ─────────────────────────────────────────────────────

	async _analyzeGoal(job) {
		this._addLog(job, "Analyzing goal and inspecting repo")

		// ── OpenClaw: Repo Investigation (analysis-only, no coding) ──
		if (this.config.enableOpenClaw) {
			try {
				const openClaw = this._getOpenClaw()
				const repoPath = `${this.config.workspaceRoot}/${job.repo}`
				this._addLog(job, `OpenClaw investigating repo: ${repoPath}`)
				const investigation = await openClaw.investigateRepo(repoPath)
				if (investigation.success) {
					this._addLog(
						job,
						`OpenClaw analysis: ${investigation.keyFindings.length} findings, ${investigation.riskFlags.length} risk flags`,
					)
					job.affectedFiles = investigation.filesAnalyzed

					// Log key findings
					for (const finding of investigation.keyFindings) {
						this._addLog(job, `  🔍 ${finding}`)
					}

					// Log risk flags
					for (const flag of investigation.riskFlags) {
						this._addLog(job, `  ⚠️ Risk: ${flag}`)
					}
				} else {
					this._addLog(job, `OpenClaw investigation returned no results: ${investigation.error ?? "unknown"}`)
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err)
				this._addLog(job, `OpenClaw analysis skipped (non-blocking): ${msg}`)
			}
		}

		// ── HermesClaw: Context Recall (before creating breakdown) ──
		if (this.config.enableHermesClaw) {
			try {
				const hermes = this._getHermesClaw()
				const contextResult = await hermes.recallContext(
					`Debug goal: ${job.goal}. Repo: ${job.repo}. Features: ${job.featureIds.join(", ")}`,
					3,
				)
				if (contextResult.success && contextResult.output) {
					this._addLog(job, `HermesClaw context recall: ${contextResult.output.slice(0, 300)}`)
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err)
				this._addLog(job, `HermesClaw context recall skipped (non-blocking): ${msg}`)
			}
		}

		const phaseEngine = this._getPhaseEngine()
		const breakdown = await phaseEngine.createBreakdown({
			goal: job.goal,
			context: `Repo: ${job.repo}, Workspace: ${this.config.workspaceRoot}`,
			constraints: [],
			availableCapabilities: ["coding", "testing", "code-review", "deployment"],
		})
		this._addLog(
			job,
			`Breakdown created: ${breakdown.phases.length} phases, critical path: ${breakdown.criticalPath.length} phases`,
		)
		return breakdown
	}

	async _createSnapshot(job, attempt) {
		const rm = this._getRollbackManager()
		const repoPath = `${this.config.workspaceRoot}/${job.repo}`
		const snapshot = await rm.createSnapshot(repoPath, {
			label: `attempt-${attempt}`,
			metadata: { jobId: job.id, goal: job.goal, attempt },
		})
		this._addLog(job, `Snapshot created: ${snapshot.rev}`)
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

	async _executePatch(job, attempt) {
		const currentHypothesis = job.hypotheses[job.hypotheses.length - 1]
		if (!currentHypothesis) {
			this._addLog(job, "No hypothesis to test")
			return false
		}

		this._addLog(job, `Executing patch for hypothesis: ${currentHypothesis.description}`)

		// Queue a coder task for the patch
		const patchTask = {
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

		if (this.orchestrator && typeof this.orchestrator.submit === "function") {
			this.orchestrator.submit(patchTask)
		}
		return true
	}

	async _runTests(job, attempt) {
		const repoPath = `${this.config.workspaceRoot}/${job.repo}`

		if (this.config.useSandbox) {
			this._addLog(job, "Running tests in Docker sandbox")
			const sandbox = this._getSandbox()
			const result = await sandbox.runCommand({
				repoRoot: repoPath,
				command:
					"corepack enable 2>/dev/null; pnpm install --frozen-lockfile 2>/dev/null || pnpm install; pnpm build 2>&1; pnpm test 2>&1 || true",
				timeout: 300,
			})
			this._addLog(job, `Sandbox result: exit=${result.exitCode}, output=${result.output.slice(0, 500)}`)
			if (result.exitCode !== 0) {
				return { ok: false, error: `sandbox_test_failed: exit ${result.exitCode}` }
			}
		} else {
			// Queue a tester task
			const testTask = {
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
			if (this.orchestrator && typeof this.orchestrator.submit === "function") {
				this.orchestrator.submit(testTask)
			}
		}

		return { ok: true }
	}

	async _runCriticReview(job, attempt) {
		this._addLog(job, "Running critic review")

		// Verify assumptions
		const currentHypothesis = job.hypotheses[job.hypotheses.length - 1]
		if (!currentHypothesis) return false

		const allVerified = currentHypothesis.assumptions.every((a) => a.status === "verified")
		if (!allVerified) {
			const unverified = currentHypothesis.assumptions.filter((a) => a.status !== "verified")
			this._addLog(job, `Critic: ${unverified.length} unverified assumptions`)
			return false
		}

		// Check confidence threshold
		if (currentHypothesis.confidence < this.config.confidenceThreshold) {
			this._addLog(
				job,
				`Critic: confidence ${currentHypothesis.confidence} < threshold ${this.config.confidenceThreshold}`,
			)
			return false
		}

		return true
	}

	async _handleFailure(job, attempt, reason) {
		this._addLog(job, `Attempt ${attempt} failed: ${reason}`)

		// Record lesson
		const lesson = {
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
				const hermes = this._getHermesClaw()
				const lessonResult = await hermes.extractLessons({
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
					this._addLog(job, `HermesClaw lesson: ${lessonResult.output.slice(0, 300)}`)
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err)
				this._addLog(job, `HermesClaw lesson extraction skipped (non-blocking): ${msg}`)
			}
		}

		// Rollback if enabled
		if (this.config.autoRollback && job.snapshots.length > 0) {
			const latestSnapshot = job.snapshots[job.snapshots.length - 1]
			const repoPath = `${this.config.workspaceRoot}/${job.repo}`
			try {
				const rm = this._getRollbackManager()
				await rm.rollback(repoPath, latestSnapshot.rev)
				this.stats.totalRollbacks++
				this._addLog(job, `Rolled back to snapshot ${latestSnapshot.rev}`)
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err)
				this._addLog(job, `Rollback failed: ${msg}`)
			}
		}

		// Generate new hypothesis for next attempt
		const hypothesisEngine = this._getHypothesisEngine()
		const newHypothesis = hypothesisEngine.refineHypothesis({
			previousHypothesis: job.hypotheses[job.hypotheses.length - 1],
			failureReason: reason,
			attempt,
			lessons: job.lessons,
		})
		job.hypotheses.push(newHypothesis)
		this._addLog(job, `New hypothesis: ${newHypothesis.description} (confidence: ${newHypothesis.confidence})`)

		// Generate skill from failure if enabled
		if (this.config.autoGenerateSkills) {
			try {
				const skillsGen = this._getSkillsGen()
				const artifact = await skillsGen.generateFromFailure({
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
				this._addLog(job, `Skill generated: ${artifact.path}`)
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err)
				this._addLog(job, `Skill generation failed: ${msg}`)
			}
		}

		if (this.orchestrator && this.orchestrator.events) {
			this.orchestrator.events.info(
				"debug-team.job.retry",
				`Job ${job.id} retrying (${attempt}/${job.maxAttempts})`,
				{
					data: { reason, newConfidence: newHypothesis.confidence },
				},
			)
		}
	}

	async _commitSuccess(job, attempt) {
		const repoPath = `${this.config.workspaceRoot}/${job.repo}`
		try {
			const rm = this._getRollbackManager()
			await rm.commitSuccess(repoPath, {
				message: `debug-team: ${job.goal} (job ${job.id}, attempt ${attempt})`,
				author: "super-roo-debug-team",
			})
			this._addLog(job, "Changes committed")
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			this._addLog(job, `Commit note: ${msg} (non-blocking)`)
		}
	}

	async _autoDeploy(job, attempt) {
		this._addLog(job, `Auto-deploying to ${this.config.deployTarget} (auto-approval mode)`)

		const deployTask = {
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

		if (this.orchestrator && typeof this.orchestrator.submit === "function") {
			this.orchestrator.submit(deployTask)
		}
		this.stats.totalDeployments++
		this._addLog(job, `Deploy task submitted to ${this.config.deployTarget}`)
	}

	async _generateSkillsFromLessons(job) {
		for (const lesson of job.lessons) {
			if (!lesson.skillGenerated) {
				try {
					const skillsGen = this._getSkillsGen()
					const artifact = await skillsGen.generateFromLesson(lesson)
					job.artifactsGenerated.push(artifact)
					lesson.skillGenerated = true
					lesson.skillPath = artifact.path
					this.stats.totalSkillsGenerated++
					this._addLog(job, `Skill generated from lesson: ${artifact.path}`)
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err)
					this._addLog(job, `Skill generation from lesson failed: ${msg}`)
				}
			}
		}
	}

	// ── Helpers ────────────────────────────────────────────────────────────

	async _transitionJob(job, newStatus) {
		const oldStatus = job.status
		job.status = newStatus
		job.updatedAt = Date.now()
		this._addLog(job, `Status: ${oldStatus} → ${newStatus}`)
		if (this.orchestrator && this.orchestrator.events) {
			this.orchestrator.events.info("debug-team.job.transition", `Job ${job.id}: ${oldStatus} → ${newStatus}`)
		}
	}

	_addLog(job, message) {
		job.logs.push(`[${new Date().toISOString()}] ${message}`)
		if (job.logs.length > this.config.maxLogsPerJob) {
			job.logs = job.logs.slice(-this.config.maxLogsPerJob)
		}
	}

	// ── Sleeper ────────────────────────────────────────────────────────────

	_sleeperSleep(ms) {
		return new Promise((resolve) => {
			this._sleeperResolve = resolve
			this._sleeperTimer = setTimeout(() => {
				this._sleeperResolve = null
				this._sleeperTimer = null
				resolve()
			}, ms)
		})
	}

	_sleeperStop() {
		if (this._sleeperTimer !== null) {
			clearTimeout(this._sleeperTimer)
			this._sleeperTimer = null
		}
		if (this._sleeperResolve) {
			this._sleeperResolve()
			this._sleeperResolve = null
		}
	}
}

module.exports = { SuperDebugLoop }
