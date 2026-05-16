/**
 * Super Roo — Ace Team Report Generator
 *
 * Generates comprehensive accomplishment reports for the Super Debug Team
 * when running in /aceteam mode. Reports include:
 * - What was attempted
 * - What was achieved
 * - What errors were encountered
 * - ML-driven insights and patterns
 * - Skills generated
 * - Rollbacks and failures
 *
 * These reports are sent to the Telegram group when /aceteam is active.
 */

export interface AceTeamReport {
	/** Unique report ID */
	reportId: string
	/** When the ace team session started */
	sessionStart: string
	/** When this report was generated */
	generatedAt: string
	/** Session duration in ms */
	sessionDurationMs: number
	/** Overall session summary */
	summary: AceSessionSummary
	/** Per-job details */
	jobs: AceJobReport[]
	/** ML insights from InfiniteImprovementLoop */
	mlInsights: AceMLInsights
	/** Skills generated during this session */
	skillsGenerated: AceSkillRecord[]
	/** Errors encountered */
	errors: AceErrorRecord[]
	/** System health metrics */
	systemHealth: AceSystemHealth
}

export interface AceSessionSummary {
	/** Total jobs created */
	totalJobs: number
	/** Jobs completed successfully */
	jobsCompleted: number
	/** Jobs that failed */
	jobsFailed: number
	/** Total attempts across all jobs */
	totalAttempts: number
	/** Total rollbacks performed */
	totalRollbacks: number
	/** Total skills generated */
	totalSkillsGenerated: number
	/** Total deployments made */
	totalDeployments: number
	/** Overall success rate (0-1) */
	successRate: number
	/** Average attempts per job */
	avgAttemptsPerJob: number
	/** Top-level narrative summary */
	narrative: string
}

export interface AceJobReport {
	/** Job ID */
	jobId: string
	/** The goal/objective */
	goal: string
	/** Final status */
	status: string
	/** Number of attempts */
	attempts: number
	/** Number of rollbacks */
	rollbacks: number
	/** Duration in ms */
	durationMs: number
	/** Phases completed */
	phases: string[]
	/** Key lessons learned */
	lessons: string[]
	/** Whether skills were generated */
	skillsGenerated: boolean
	/** Whether deployment happened */
	deployed: boolean
	/** Errors specific to this job */
	errors: string[]
	/** Confidence score at completion */
	finalConfidence: number
}

export interface AceMLInsights {
	/** Patterns detected across jobs */
	patterns: string[]
	/** Common failure modes */
	commonFailures: string[]
	/** Improvement suggestions */
	suggestions: string[]
	/** Confidence in ML analysis (0-1) */
	confidence: number
}

export interface AceSkillRecord {
	/** Skill name */
	name: string
	/** Skill path */
	path: string
	/** Source (lesson, pattern, manual) */
	source: string
	/** When it was generated */
	generatedAt: string
}

export interface AceErrorRecord {
	/** Job ID where error occurred */
	jobId: string
	/** Attempt number */
	attempt: number
	/** Error message */
	message: string
	/** Error type/category */
	type: string
	/** Whether it was recovered from */
	recovered: boolean
}

export interface AceSystemHealth {
	/** Loop uptime in ms */
	uptimeMs: number
	/** Active job count */
	activeJobs: number
	/** Queued job count */
	queuedJobs: number
	/** Memory estimate (rough) */
	memoryEstimate: string
	/** Auto-approval mode status */
	autoApprovalMode: boolean
}

export interface AceTeamReportConfig {
	/** Max jobs to include in report. Default: 50 */
	maxJobsInReport: number
	/** Whether to include full error details. Default: true */
	includeFullErrors: boolean
	/** Whether to include ML insights. Default: true */
	includeMLInsights: boolean
	/** Whether to include system health. Default: true */
	includeSystemHealth: boolean
}

const DEFAULT_REPORT_CONFIG: AceTeamReportConfig = {
	maxJobsInReport: 50,
	includeFullErrors: true,
	includeMLInsights: true,
	includeSystemHealth: true,
}

/**
 * Generates comprehensive accomplishment reports for the Ace Team.
 */
export class AceTeamReportGenerator {
	private config: AceTeamReportConfig
	private sessionStart: number = 0
	private sessionJobs: Map<string, AceJobReport> = new Map()
	private sessionErrors: AceErrorRecord[] = []
	private sessionSkills: AceSkillRecord[] = []
	private sessionPatterns: string[] = []
	private sessionFailures: string[] = []
	private sessionSuggestions: string[] = []

	constructor(config: Partial<AceTeamReportConfig> = {}) {
		this.config = { ...DEFAULT_REPORT_CONFIG, ...config }
	}

	/**
	 * Start a new ace team session.
	 */
	startSession(): void {
		this.sessionStart = Date.now()
		this.sessionJobs.clear()
		this.sessionErrors = []
		this.sessionSkills = []
		this.sessionPatterns = []
		this.sessionFailures = []
		this.sessionSuggestions = []
	}

	/**
	 * Record a job completion (success or failure).
	 */
	recordJob(job: {
		jobId: string
		goal: string
		status: string
		attempts: number
		rollbacks: number
		durationMs: number
		phases: string[]
		lessons: string[]
		skillsGenerated: boolean
		deployed: boolean
		errors: string[]
		finalConfidence: number
	}): void {
		this.sessionJobs.set(job.jobId, {
			jobId: job.jobId,
			goal: job.goal,
			status: job.status,
			attempts: job.attempts,
			rollbacks: job.rollbacks,
			durationMs: job.durationMs,
			phases: job.phases,
			lessons: job.lessons,
			skillsGenerated: job.skillsGenerated,
			deployed: job.deployed,
			errors: job.errors,
			finalConfidence: job.finalConfidence,
		})
	}

	/**
	 * Record an error during a job.
	 */
	recordError(error: { jobId: string; attempt: number; message: string; type: string; recovered: boolean }): void {
		this.sessionErrors.push({ ...error })
	}

	/**
	 * Record a skill that was generated.
	 */
	recordSkill(skill: { name: string; path: string; source: string; generatedAt: string }): void {
		this.sessionSkills.push({ ...skill })
	}

	/**
	 * Record ML-detected patterns.
	 */
	recordPatterns(patterns: string[]): void {
		this.sessionPatterns.push(...patterns)
	}

	/**
	 * Record common failure modes.
	 */
	recordFailures(failures: string[]): void {
		this.sessionFailures.push(...failures)
	}

	/**
	 * Record improvement suggestions.
	 */
	recordSuggestions(suggestions: string[]): void {
		this.sessionSuggestions.push(...suggestions)
	}

	/**
	 * Generate the final accomplishment report.
	 */
	generateReport(extraContext?: {
		uptimeMs?: number
		activeJobs?: number
		queuedJobs?: number
		autoApprovalMode?: boolean
	}): AceTeamReport {
		const now = Date.now()
		const sessionDurationMs = this.sessionStart > 0 ? now - this.sessionStart : 0
		const jobs = Array.from(this.sessionJobs.values())
		const totalJobs = jobs.length
		const jobsCompleted = jobs.filter((j) => j.status === "success").length
		const jobsFailed = jobs.filter((j) => j.status === "failed").length
		const totalAttempts = jobs.reduce((sum, j) => sum + j.attempts, 0)
		const totalRollbacks = jobs.reduce((sum, j) => sum + j.rollbacks, 0)
		const totalSkillsGenerated = this.sessionSkills.length
		const totalDeployments = jobs.filter((j) => j.deployed).length
		const successRate = totalJobs > 0 ? jobsCompleted / totalJobs : 0
		const avgAttemptsPerJob = totalJobs > 0 ? totalAttempts / totalJobs : 0

		// Build narrative summary
		const narrative = this.buildNarrative({
			totalJobs,
			jobsCompleted,
			jobsFailed,
			totalAttempts,
			totalRollbacks,
			totalSkillsGenerated,
			totalDeployments,
			successRate,
			avgAttemptsPerJob,
		})

		// Truncate jobs if needed
		const maxJobs = this.config.maxJobsInReport
		const reportedJobs = jobs.length > maxJobs ? jobs.slice(0, maxJobs) : jobs

		const report: AceTeamReport = {
			reportId: "ACE-" + Date.now().toString(36).toUpperCase(),
			sessionStart: new Date(this.sessionStart).toISOString(),
			generatedAt: new Date(now).toISOString(),
			sessionDurationMs,
			summary: {
				totalJobs,
				jobsCompleted,
				jobsFailed,
				totalAttempts,
				totalRollbacks,
				totalSkillsGenerated,
				totalDeployments,
				successRate,
				avgAttemptsPerJob,
				narrative,
			},
			jobs: reportedJobs,
			mlInsights: {
				patterns: this.sessionPatterns.slice(0, 10),
				commonFailures: this.sessionFailures.slice(0, 10),
				suggestions: this.sessionSuggestions.slice(0, 10),
				confidence: jobs.length > 3 ? 0.75 : 0.4,
			},
			skillsGenerated: this.sessionSkills,
			errors: this.config.includeFullErrors ? this.sessionErrors : this.sessionErrors.slice(0, 20),
			systemHealth: this.config.includeSystemHealth
				? {
						uptimeMs: extraContext?.uptimeMs || sessionDurationMs,
						activeJobs: extraContext?.activeJobs || 0,
						queuedJobs: extraContext?.queuedJobs || 0,
						memoryEstimate: this.estimateMemory(),
						autoApprovalMode: extraContext?.autoApprovalMode ?? true,
					}
				: {
						uptimeMs: 0,
						activeJobs: 0,
						queuedJobs: 0,
						memoryEstimate: "unknown",
						autoApprovalMode: true,
					},
		}

		return report
	}

	/**
	 * Format the report as a Telegram-friendly markdown message.
	 */
	formatForTelegram(report: AceTeamReport): string {
		const lines: string[] = []
		const emoji = report.summary.successRate >= 0.8 ? "🏆" : report.summary.successRate >= 0.5 ? "📊" : "⚠️"

		lines.push(`*${emoji} Ace Team — Accomplishment Report*`)
		lines.push("")
		lines.push(`*Report ID:* \`${report.reportId}\``)
		lines.push(`*Session:* ${this.formatDuration(report.sessionDurationMs)}`)
		lines.push("")
		lines.push("── *Summary* ──")
		lines.push(`📌 Total Jobs: ${report.summary.totalJobs}`)
		lines.push(`✅ Completed: ${report.summary.jobsCompleted}`)
		lines.push(`❌ Failed: ${report.summary.jobsFailed}`)
		lines.push(`🔄 Total Attempts: ${report.summary.totalAttempts}`)
		lines.push(`⏪ Rollbacks: ${report.summary.totalRollbacks}`)
		lines.push(`🎯 Success Rate: ${(report.summary.successRate * 100).toFixed(0)}%`)
		lines.push(`📚 Skills Generated: ${report.summary.totalSkillsGenerated}`)
		lines.push(`🚀 Deployments: ${report.summary.totalDeployments}`)
		lines.push("")
		lines.push("── *Narrative* ──")
		lines.push(report.summary.narrative)
		lines.push("")

		// Per-job details
		if (report.jobs.length > 0) {
			lines.push("── *Jobs* ──")
			for (const job of report.jobs) {
				const statusEmoji =
					job.status === "success"
						? "✅"
						: job.status === "failed"
							? "❌"
							: job.status === "running"
								? "🔄"
								: "⏸️"
				lines.push(
					`${statusEmoji} \`${job.jobId.slice(0, 8)}\` ${job.goal.slice(0, 60)} — ${job.attempts} attempts, ${job.finalConfidence.toFixed(2)} confidence`,
				)
				if (job.errors.length > 0) {
					lines.push(`   ⚠️ Errors: ${job.errors.slice(0, 3).join("; ")}`)
				}
			}
			lines.push("")
		}

		// ML Insights
		if (report.mlInsights.patterns.length > 0 || report.mlInsights.suggestions.length > 0) {
			lines.push("── *ML Insights* ──")
			if (report.mlInsights.patterns.length > 0) {
				lines.push("*Patterns detected:*")
				for (const p of report.mlInsights.patterns) {
					lines.push(`• ${p}`)
				}
			}
			if (report.mlInsights.commonFailures.length > 0) {
				lines.push("*Common failures:*")
				for (const f of report.mlInsights.commonFailures) {
					lines.push(`• ${f}`)
				}
			}
			if (report.mlInsights.suggestions.length > 0) {
				lines.push("*Suggestions:*")
				for (const s of report.mlInsights.suggestions) {
					lines.push(`• ${s}`)
				}
			}
			lines.push("")
		}

		// Skills generated
		if (report.skillsGenerated.length > 0) {
			lines.push("── *Skills Generated* ──")
			for (const skill of report.skillsGenerated) {
				lines.push(`📘 \`${skill.name}\` — ${skill.path}`)
			}
			lines.push("")
		}

		// Errors
		if (report.errors.length > 0) {
			lines.push("── *Errors Encountered* ──")
			for (const err of report.errors.slice(0, 10)) {
				const recovered = err.recovered ? "✅ Recovered" : "❌ Unresolved"
				lines.push(`• \`${err.jobId.slice(0, 8)}\` [${err.type}] ${err.message.slice(0, 80)} — ${recovered}`)
			}
			if (report.errors.length > 10) {
				lines.push(`• ... and ${report.errors.length - 10} more errors`)
			}
			lines.push("")
		}

		// System health
		lines.push("── *System Health* ──")
		lines.push(`⏱️ Uptime: ${this.formatDuration(report.systemHealth.uptimeMs)}`)
		lines.push(`⚡ Active Jobs: ${report.systemHealth.activeJobs}`)
		lines.push(`📥 Queued Jobs: ${report.systemHealth.queuedJobs}`)
		lines.push(`💾 Memory: ${report.systemHealth.memoryEstimate}`)
		lines.push(`🤖 Auto-Approval: ${report.systemHealth.autoApprovalMode ? "✅ ON" : "❌ OFF"}`)
		lines.push("")
		lines.push(`_Generated at ${new Date(report.generatedAt).toLocaleString()}_`)

		return lines.join("\n")
	}

	/**
	 * Get current session stats (for real-time monitoring).
	 */
	getSessionStats(): {
		jobsProcessed: number
		errorsEncountered: number
		skillsGenerated: number
		durationMs: number
	} {
		return {
			jobsProcessed: this.sessionJobs.size,
			errorsEncountered: this.sessionErrors.length,
			skillsGenerated: this.sessionSkills.length,
			durationMs: this.sessionStart > 0 ? Date.now() - this.sessionStart : 0,
		}
	}

	/**
	 * Reset the session (start fresh).
	 */
	reset(): void {
		this.sessionStart = 0
		this.sessionJobs.clear()
		this.sessionErrors = []
		this.sessionSkills = []
		this.sessionPatterns = []
		this.sessionFailures = []
		this.sessionSuggestions = []
	}

	// ── Private Helpers ──

	private buildNarrative(summary: {
		totalJobs: number
		jobsCompleted: number
		jobsFailed: number
		totalAttempts: number
		totalRollbacks: number
		totalSkillsGenerated: number
		totalDeployments: number
		successRate: number
		avgAttemptsPerJob: number
	}): string {
		const parts: string[] = []

		if (summary.totalJobs === 0) {
			return "No jobs were processed during this session."
		}

		parts.push(
			`Processed ${summary.totalJobs} job(s): ${summary.jobsCompleted} completed, ${summary.jobsFailed} failed.`,
		)

		if (summary.successRate >= 0.8) {
			parts.push("High success rate — the team is performing well.")
		} else if (summary.successRate >= 0.5) {
			parts.push("Moderate success rate — some areas need improvement.")
		} else {
			parts.push("Low success rate — investigating systemic issues.")
		}

		if (summary.totalRollbacks > 0) {
			parts.push(`${summary.totalRollbacks} rollback(s) were performed to recover from failed assumptions.`)
		}

		if (summary.totalSkillsGenerated > 0) {
			parts.push(`${summary.totalSkillsGenerated} skill(s) were generated from lessons learned.`)
		}

		if (summary.totalDeployments > 0) {
			parts.push(`${summary.totalDeployments} deployment(s) were made.`)
		}

		parts.push(`Average ${summary.avgAttemptsPerJob.toFixed(1)} attempts per job.`)

		return parts.join(" ")
	}

	private formatDuration(ms: number): string {
		const seconds = Math.floor(ms / 1000)
		const minutes = Math.floor(seconds / 60)
		const hours = Math.floor(minutes / 60)

		if (hours > 0) {
			return `${hours}h ${minutes % 60}m ${seconds % 60}s`
		}
		if (minutes > 0) {
			return `${minutes}m ${seconds % 60}s`
		}
		return `${seconds}s`
	}

	private estimateMemory(): string {
		// Rough estimate using process.memoryUsage if available
		try {
			const usage = process.memoryUsage()
			const mb = Math.round(usage.heapUsed / 1024 / 1024)
			const total = Math.round(usage.heapTotal / 1024 / 1024)
			return `${mb}MB / ${total}MB`
		} catch {
			return "unknown"
		}
	}
}
