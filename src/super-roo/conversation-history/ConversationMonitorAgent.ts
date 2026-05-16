/**
 * SuperRoo — Conversation Monitor Agent
 *
 * Analyzes the conversational history JSON store to detect:
 * - Errors in conversation processing
 * - Weaknesses in response quality and system behavior
 * - Improvement opportunities for making Telegram frictionless with coding
 *
 * Runs periodic analysis cycles and produces actionable recommendations.
 * Integrates with the HealingBus for incident reporting and the Telegram
 * bot for real-time friction detection.
 */

import { ConversationHistoryManager, getConversationHistoryManager } from "./ConversationHistoryManager"
import type {
	ConversationRecord,
	MessageRecord,
	DetectedWeakness,
	DetectedImprovement,
	DetectedError,
	WeaknessCategory,
	ImprovementCategory,
	IssueSeverity,
	AnalysisSummary,
} from "./types"

// ─── Configuration ─────────────────────────────────────────────────────────

export interface MonitorAgentConfig {
	/** How often to run analysis (ms) — default: 1 hour */
	analysisIntervalMs: number
	/** Minimum messages in a conversation before analysis */
	minMessagesForAnalysis: number
	/** Maximum latency before flagging as slow (ms) */
	slowResponseThresholdMs: number
	/** Error rate threshold before flagging (errors per conversation) */
	errorRateThreshold: number
	/** Whether to auto-report to HealingBus */
	enableHealingBusIntegration: boolean
	/** Whether to send Telegram notifications for critical issues */
	enableTelegramNotifications: boolean
	/** Telegram chat ID for notifications */
	telegramChatId?: number
}

const DEFAULT_CONFIG: MonitorAgentConfig = {
	analysisIntervalMs: 60 * 60 * 1000, // 1 hour
	minMessagesForAnalysis: 2,
	slowResponseThresholdMs: 30_000, // 30 seconds
	errorRateThreshold: 0.3, // 30% of messages have errors
	enableHealingBusIntegration: false,
	enableTelegramNotifications: false,
}

// ─── Friction Patterns ─────────────────────────────────────────────────────

/** Patterns that indicate Telegram friction */
const TELEGRAM_FRICTION_PATTERNS = [
	// Auth-related friction
	{
		pattern: /login|authenticate|session expired|otp/i,
		category: "telegram_friction" as WeaknessCategory,
		severity: "warning" as IssueSeverity,
	},
	// Formatting issues
	{
		pattern: /markdown|parse|formatting|entities/i,
		category: "poor_formatting" as WeaknessCategory,
		severity: "warning" as IssueSeverity,
	},
	// Command confusion
	{
		pattern: /unknown command|invalid command|not recognized/i,
		category: "telegram_friction" as WeaknessCategory,
		severity: "warning" as IssueSeverity,
	},
	// Timeout / slow
	{
		pattern: /timeout|timed? out|taking too long/i,
		category: "slow_response" as WeaknessCategory,
		severity: "warning" as IssueSeverity,
	},
	// Group chat issues
	{
		pattern: /group|not in a group|chat not found/i,
		category: "telegram_friction" as WeaknessCategory,
		severity: "error" as IssueSeverity,
	},
	// Webhook issues
	{
		pattern: /webhook|polling|connection/i,
		category: "telegram_friction" as WeaknessCategory,
		severity: "critical" as IssueSeverity,
	},
]

/** Patterns that indicate coding workflow friction */
const CODING_FRICTION_PATTERNS = [
	{
		pattern: /didn't work|not working|failed|error|bug/i,
		category: "coding_error" as WeaknessCategory,
		severity: "error" as IssueSeverity,
	},
	{
		pattern: /wrong|incorrect|that's not|not what/i,
		category: "misunderstanding" as WeaknessCategory,
		severity: "warning" as IssueSeverity,
	},
	{
		pattern: /more context|need more|not enough/i,
		category: "lack_of_context" as WeaknessCategory,
		severity: "warning" as IssueSeverity,
	},
	{
		pattern: /repeat|again|still|same issue/i,
		category: "redundant_question" as WeaknessCategory,
		severity: "warning" as IssueSeverity,
	},
	{
		pattern: /incomplete|partial|missing|not finished/i,
		category: "incomplete_response" as WeaknessCategory,
		severity: "warning" as IssueSeverity,
	},
]

// ─── Monitor Agent ─────────────────────────────────────────────────────────

export class ConversationMonitorAgent {
	private readonly historyManager: ConversationHistoryManager
	private readonly config: MonitorAgentConfig
	private analysisTimer: ReturnType<typeof setInterval> | null = null
	private running: boolean = false

	constructor(historyManager?: ConversationHistoryManager, config?: Partial<MonitorAgentConfig>) {
		this.historyManager = historyManager ?? getConversationHistoryManager()
		this.config = { ...DEFAULT_CONFIG, ...config }
	}

	// ─── Lifecycle ────────────────────────────────────────────────────────

	/** Start periodic analysis */
	async start(): Promise<void> {
		if (this.analysisTimer) return
		console.log(
			"[conversation-monitor] Starting periodic analysis (every " +
				this.config.analysisIntervalMs / 1000 / 60 +
				" min)",
		)

		// Run immediately on start
		await this.runAnalysis()

		// Then run on interval
		this.analysisTimer = setInterval(() => {
			this.runAnalysis().catch((err) => {
				console.error("[conversation-monitor] Analysis error:", err)
			})
		}, this.config.analysisIntervalMs)
	}

	/** Stop periodic analysis */
	stop(): void {
		if (this.analysisTimer) {
			clearInterval(this.analysisTimer)
			this.analysisTimer = null
		}
		console.log("[conversation-monitor] Stopped periodic analysis")
	}

	/** Check if the agent is currently running analysis */
	isRunning(): boolean {
		return this.running
	}

	// ─── Analysis Engine ──────────────────────────────────────────────────

	/**
	 * Run a full analysis cycle on all unanalyzed conversations.
	 * Returns the number of new issues detected.
	 */
	async runAnalysis(): Promise<{
		newErrors: number
		newWeaknesses: number
		newImprovements: number
		summary: AnalysisSummary
	}> {
		if (this.running) {
			console.log("[conversation-monitor] Analysis already running, skipping")
			return {
				newErrors: 0,
				newWeaknesses: 0,
				newImprovements: 0,
				summary: this.historyManager.generateSummary(),
			}
		}

		this.running = true
		const state = this.historyManager.getState()
		const beforeErrorCount = Object.keys(state.errors).length
		const beforeWeaknessCount = Object.keys(state.weaknesses).length
		const beforeImprovementCount = Object.keys(state.improvements).length

		try {
			// Get conversations not yet analyzed (no issues recorded for them)
			const conversations = this.historyManager.findConversations({ limit: 100 })

			for (const conversation of conversations) {
				if (conversation.messageCount < this.config.minMessagesForAnalysis) continue

				// Skip if already analyzed
				const existingIssues = this.historyManager.getIssues({
					conversationId: conversation.id,
				})
				if (existingIssues.length > 0) continue

				await this._analyzeConversation(conversation)
			}

			// Update monitor state
			state.monitor.lastAnalysisAt = new Date().toISOString()
			state.monitor.totalRuns++

			// Generate summary
			const summary = this.historyManager.generateSummary()

			console.log(
				`[conversation-monitor] Analysis complete: ` +
					`${Object.keys(state.errors).length - beforeErrorCount} new errors, ` +
					`${Object.keys(state.weaknesses).length - beforeWeaknessCount} new weaknesses, ` +
					`${Object.keys(state.improvements).length - beforeImprovementCount} new improvements`,
			)

			return {
				newErrors: Object.keys(state.errors).length - beforeErrorCount,
				newWeaknesses: Object.keys(state.weaknesses).length - beforeWeaknessCount,
				newImprovements: Object.keys(state.improvements).length - beforeImprovementCount,
				summary,
			}
		} finally {
			this.running = false
		}
	}

	/**
	 * Analyze a single conversation for errors, weaknesses, and improvements.
	 */
	private async _analyzeConversation(conversation: ConversationRecord): Promise<void> {
		const messages = conversation.messages

		// ── Detect Errors ──────────────────────────────────────────────
		for (const msg of messages) {
			if (msg.hadError && msg.errorDetails) {
				await this.historyManager.recordError({
					conversationId: conversation.id,
					messageId: msg.id,
					errorType: this._classifyErrorType(msg.errorDetails),
					errorMessage: msg.errorDetails,
					stackTrace: undefined,
					resolved: false,
				})
			}
		}

		// ── Detect Slow Responses ──────────────────────────────────────
		for (const msg of messages) {
			if (msg.role === "assistant" && msg.latencyMs && msg.latencyMs > this.config.slowResponseThresholdMs) {
				await this.historyManager.recordWeakness({
					conversationId: conversation.id,
					severity: "warning",
					category: "slow_response",
					title: "Slow response detected",
					description: `Assistant response took ${msg.latencyMs}ms (threshold: ${this.config.slowResponseThresholdMs}ms)`,
					messageIds: [msg.id],
					suggestion: "Optimize response generation or implement streaming for long responses",
					resolved: false,
				})
			}
		}

		// ── Detect Telegram Friction ───────────────────────────────────
		if (conversation.source === "telegram") {
			for (const msg of messages) {
				if (msg.role === "user" || msg.role === "system") {
					for (const { pattern, category, severity } of TELEGRAM_FRICTION_PATTERNS) {
						if (pattern.test(msg.content)) {
							await this.historyManager.recordWeakness({
								conversationId: conversation.id,
								severity,
								category,
								title: `Telegram friction: ${category.replace(/_/g, " ")}`,
								description: `Detected friction pattern in message: "${msg.content.slice(0, 200)}"`,
								messageIds: [msg.id],
								suggestion: this._getTelegramFrictionSuggestion(category),
								resolved: false,
							})
							break // One weakness per message
						}
					}
				}
			}
		}

		// ── Detect Coding Friction ─────────────────────────────────────
		for (const msg of messages) {
			if (msg.role === "user") {
				for (const { pattern, category, severity } of CODING_FRICTION_PATTERNS) {
					if (pattern.test(msg.content)) {
						await this.historyManager.recordWeakness({
							conversationId: conversation.id,
							severity,
							category,
							title: `Coding friction: ${category.replace(/_/g, " ")}`,
							description: `Detected coding friction in message: "${msg.content.slice(0, 200)}"`,
							messageIds: [msg.id],
							suggestion: this._getCodingFrictionSuggestion(category),
							resolved: false,
						})
						break
					}
				}
			}
		}

		// ── Detect Improvement Opportunities ───────────────────────────
		await this._detectImprovements(conversation)
	}

	/**
	 * Detect improvement opportunities from a conversation.
	 */
	private async _detectImprovements(conversation: ConversationRecord): Promise<void> {
		const messages = conversation.messages

		// Check for repeated user questions (same user asking similar things)
		const userMessages = messages.filter((m) => m.role === "user")
		const seenTopics = new Set<string>()
		for (const msg of userMessages) {
			const topic = msg.content.slice(0, 50).toLowerCase().trim()
			if (seenTopics.has(topic)) {
				await this.historyManager.recordImprovement({
					conversationId: conversation.id,
					severity: "info",
					category: "clarification",
					title: "Repetitive user questions detected",
					description: "User asked similar questions, suggesting the initial response was insufficient",
					messageIds: [msg.id],
					suggestion: "Improve initial response completeness to reduce follow-up questions",
					priority: 60,
					estimatedEffort: "medium",
					resolved: false,
				})
				break
			}
			seenTopics.add(topic)
		}

		// Check for Telegram-specific improvements
		if (conversation.source === "telegram") {
			const hasFormattingIssues = messages.some((m) => /format|markdown|layout|display/i.test(m.content))
			if (hasFormattingIssues) {
				await this.historyManager.recordImprovement({
					conversationId: conversation.id,
					severity: "warning",
					category: "telegram_ux",
					title: "Telegram message formatting improvement needed",
					description:
						"Conversation contains formatting-related issues, suggesting Telegram message rendering could be improved",
					messageIds: messages
						.filter((m) => /format|markdown|layout|display/i.test(m.content))
						.map((m) => m.id),
					suggestion: "Review Telegram markdown parsing and ensure all messages use plain text fallback",
					priority: 70,
					estimatedEffort: "low",
					resolved: false,
				})
			}

			// Check for auth friction
			const hasAuthIssues = messages.some((m) => /login|auth|session|otp|verify/i.test(m.content))
			if (hasAuthIssues && messages.length > 3) {
				await this.historyManager.recordImprovement({
					conversationId: conversation.id,
					severity: "warning",
					category: "friction_reduction",
					title: "Authentication flow friction detected",
					description: "Multiple messages about authentication suggest the login flow could be smoother",
					messageIds: messages
						.filter((m) => /login|auth|session|otp|verify/i.test(m.content))
						.map((m) => m.id),
					suggestion: "Consider extending session TTL, adding biometric auth, or streamlining OTP flow",
					priority: 80,
					estimatedEffort: "medium",
					resolved: false,
				})
			}
		}

		// Check for coding workflow improvements
		const hasCodingIssues = messages.some((m) => /code|deploy|test|commit|push|branch/i.test(m.content))
		if (hasCodingIssues && messages.length > 5) {
			await this.historyManager.recordImprovement({
				conversationId: conversation.id,
				severity: "info",
				category: "coding_workflow",
				title: "Coding workflow optimization opportunity",
				description: "Long coding conversation suggests the workflow could be streamlined",
				messageIds: [messages[messages.length - 1].id],
				suggestion:
					"Consider adding quick-action buttons for common coding tasks, or implementing /code shortcuts",
				priority: 50,
				estimatedEffort: "medium",
				resolved: false,
			})
		}

		// Check for response quality issues (assistant messages that are very short)
		const assistantMessages = messages.filter((m) => m.role === "assistant")
		for (const msg of assistantMessages) {
			if (msg.content.length < 20 && userMessages.length > 0) {
				await this.historyManager.recordImprovement({
					conversationId: conversation.id,
					severity: "info",
					category: "response_quality",
					title: "Very short assistant response",
					description: `Assistant response was only ${msg.content.length} characters — may be insufficient`,
					messageIds: [msg.id],
					suggestion: "Ensure assistant responses are comprehensive and address the full user query",
					priority: 40,
					estimatedEffort: "low",
					resolved: false,
				})
				break
			}
		}
	}

	// ─── Classification Helpers ──────────────────────────────────────────

	private _classifyErrorType(errorDetails: string): string {
		if (/timeout|timed out/i.test(errorDetails)) return "timeout"
		if (/network|fetch|connection|ECONNREFUSED/i.test(errorDetails)) return "network"
		if (/parse|syntax|json/i.test(errorDetails)) return "parsing"
		if (/auth|unauthorized|forbidden|401|403/i.test(errorDetails)) return "authentication"
		if (/rate limit|429|too many/i.test(errorDetails)) return "rate_limit"
		if (/not found|404/i.test(errorDetails)) return "not_found"
		if (/internal|500|502|503/i.test(errorDetails)) return "server_error"
		return "unknown"
	}

	private _getTelegramFrictionSuggestion(category: WeaknessCategory): string {
		switch (category) {
			case "telegram_friction":
				return "Review Telegram bot command routing and ensure all commands have clear error messages"
			case "poor_formatting":
				return "Ensure all Telegram messages use plain text fallback when markdown parsing fails"
			case "slow_response":
				return "Implement response streaming or optimize AI response generation for Telegram"
			default:
				return "Review Telegram integration for friction points"
		}
	}

	private _getCodingFrictionSuggestion(category: WeaknessCategory): string {
		switch (category) {
			case "coding_error":
				return "Improve error handling and provide clearer error messages for coding tasks"
			case "misunderstanding":
				return "Enhance context gathering before responding to coding requests"
			case "lack_of_context":
				return "Implement automatic context collection (project files, recent changes) before coding"
			case "redundant_question":
				return "Improve response completeness to reduce follow-up questions"
			case "incomplete_response":
				return "Ensure coding responses include complete code, not partial snippets"
			default:
				return "Review coding workflow for friction points"
		}
	}

	// ─── Query Helpers ───────────────────────────────────────────────────

	/** Get unresolved weaknesses related to Telegram */
	getTelegramFrictionIssues(): DetectedWeakness[] {
		return this.historyManager.getWeaknesses({
			category: "telegram_friction",
			resolved: false,
		})
	}

	/** Get unresolved weaknesses related to coding */
	getCodingFrictionIssues(): DetectedWeakness[] {
		return this.historyManager.getWeaknesses({
			category: "coding_error",
			resolved: false,
		})
	}

	/** Get all high-priority unresolved improvements */
	getHighPriorityImprovements(): DetectedImprovement[] {
		return this.historyManager.getImprovements({ resolved: false }).filter((i) => i.priority >= 70)
	}

	/** Get unresolved critical errors */
	getCriticalErrors(): DetectedError[] {
		return this.historyManager.getErrors({ resolved: false })
	}

	/** Get a friction report summary for Telegram */
	getTelegramFrictionReport(): string {
		const telegramIssues = this.getTelegramFrictionIssues()
		const codingIssues = this.getCodingFrictionIssues()
		const highPriority = this.getHighPriorityImprovements()
		const criticalErrors = this.getCriticalErrors()
		const summary = this.historyManager.generateSummary(1)

		const lines: string[] = [
			"📊 *Telegram Friction Report*",
			"",
			`*Period:* Last 24 hours`,
			`*Conversations:* ${summary.totalConversations}`,
			`*Messages:* ${summary.totalMessages}`,
			`*Telegram Friction Score:* ${summary.telegramFrictionScore}/100`,
			`*Coding Friction Score:* ${summary.codingFrictionScore}/100`,
			"",
			`*Unresolved Issues:*`,
			`• Telegram friction: ${telegramIssues.length}`,
			`• Coding friction: ${codingIssues.length}`,
			`• Critical errors: ${criticalErrors.length}`,
			`• High-priority improvements: ${highPriority.length}`,
			"",
		]

		if (summary.recommendations.length > 0) {
			lines.push("*Recommendations:*")
			for (const rec of summary.recommendations) {
				lines.push(`• ${rec}`)
			}
			lines.push("")
		}

		if (summary.topFrictionPoints.length > 0) {
			lines.push("*Top Friction Points:*")
			for (const point of summary.topFrictionPoints) {
				lines.push(`• ${point}`)
			}
		}

		return lines.join("\n")
	}
}

// ─── Singleton ─────────────────────────────────────────────────────────────

let _monitorInstance: ConversationMonitorAgent | null = null

/** Get or create the singleton monitor agent instance */
export function getConversationMonitorAgent(
	historyManager?: ConversationHistoryManager,
	config?: Partial<MonitorAgentConfig>,
): ConversationMonitorAgent {
	if (!_monitorInstance) {
		_monitorInstance = new ConversationMonitorAgent(historyManager, config)
	}
	return _monitorInstance
}

/** Reset the singleton (for testing) */
export function resetConversationMonitorAgent(): void {
	_monitorInstance = null
}
