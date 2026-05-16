/**
 * SuperRoo — Conversation History Manager
 *
 * Manages the persistent JSON store of all SuperRoo conversations and replies.
 * Provides atomic CRUD operations, querying, and periodic cleanup.
 * The JSON file is the single source of truth for the monitoring agent.
 */

import * as path from "path"
import { v4 as uuidv4 } from "uuid"
import { safeWriteJson } from "../../utils/safeWriteJson"
import type {
	ConversationRecord,
	ConversationHistoryState,
	ConversationFilter,
	MessageRecord,
	DetectedIssue,
	DetectedWeakness,
	DetectedImprovement,
	DetectedError,
	ConversationSource,
	ConversationStatus,
	MessageRole,
	IssueSeverity,
	WeaknessCategory,
	ImprovementCategory,
	AnalysisSummary,
} from "./types"

// ─── Defaults ──────────────────────────────────────────────────────────────

const DEFAULT_STATE: ConversationHistoryState = {
	schemaVersion: 1,
	conversations: {},
	issues: {},
	errors: {},
	weaknesses: {},
	improvements: {},
	monitor: {
		lastAnalysisAt: null,
		totalRuns: 0,
		totalIssuesDetected: 0,
		totalIssuesResolved: 0,
		totalErrorsDetected: 0,
		totalImprovementsSuggested: 0,
		totalImprovementsImplemented: 0,
		agentVersion: "1.0.0",
	},
	lastUpdatedAt: new Date().toISOString(),
}

const DEFAULT_DATA_DIR = path.join(__dirname, "..", "..", "..", "cloud", "data")
const HISTORY_FILE = "conversation-history.json"
const MAX_CONVERSATIONS = 10_000
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24 hours

// ─── Manager ───────────────────────────────────────────────────────────────

export class ConversationHistoryManager {
	private state: ConversationHistoryState
	private readonly filePath: string
	private loaded: boolean = false
	private lastCleanupAt: number = 0

	constructor(dataDir?: string) {
		const dir = dataDir ?? DEFAULT_DATA_DIR
		this.filePath = path.join(dir, HISTORY_FILE)
		this.state = this._cloneDefault()
	}

	// ─── Initialization ───────────────────────────────────────────────────

	/** Load state from disk or initialize fresh */
	async init(): Promise<void> {
		if (this.loaded) return
		try {
			const fs = await import("fs/promises")
			const content = await fs.readFile(this.filePath, "utf-8")
			const parsed = JSON.parse(content) as ConversationHistoryState
			this.state = {
				...this._cloneDefault(),
				...parsed,
				conversations: parsed.conversations ?? {},
				issues: parsed.issues ?? {},
				errors: parsed.errors ?? {},
				weaknesses: parsed.weaknesses ?? {},
				improvements: parsed.improvements ?? {},
				monitor: {
					...this._cloneDefault().monitor,
					...parsed.monitor,
				},
			}
			this.loaded = true
			console.log(
				`[conversation-history] Loaded ${Object.keys(this.state.conversations).length} conversations from ${this.filePath}`,
			)
		} catch {
			// File doesn't exist yet — start fresh
			this.state = this._cloneDefault()
			this.loaded = true
			console.log("[conversation-history] Initialized fresh state")
		}
	}

	/** Persist current state to disk atomically */
	private async _persist(): Promise<void> {
		this.state.lastUpdatedAt = new Date().toISOString()
		await safeWriteJson(this.filePath, this.state, { prettyPrint: true })
	}

	// ─── Conversation CRUD ────────────────────────────────────────────────

	/** Create a new conversation record */
	async createConversation(params: {
		source: ConversationSource
		chatId: string | number
		title?: string
		userId?: string
		username?: string
		projectId?: string
		projectName?: string
		tags?: string[]
		metadata?: Record<string, unknown>
	}): Promise<ConversationRecord> {
		await this._ensureLoaded()
		const now = new Date().toISOString()
		const id = uuidv4()

		const conversation: ConversationRecord = {
			id,
			source: params.source,
			chatId: params.chatId,
			title: params.title ?? `Conversation ${id.slice(0, 8)}`,
			status: "active",
			startedAt: now,
			updatedAt: now,
			messages: [],
			messageCount: 0,
			userId: params.userId,
			username: params.username,
			projectId: params.projectId,
			projectName: params.projectName,
			tags: params.tags,
			metadata: params.metadata,
		}

		this.state.conversations[id] = conversation
		await this._persist()
		return conversation
	}

	/** Add a message to an existing conversation */
	async addMessage(
		conversationId: string,
		message: Omit<MessageRecord, "id" | "timestamp"> & { id?: string; timestamp?: string },
	): Promise<MessageRecord> {
		await this._ensureLoaded()
		const conversation = this.state.conversations[conversationId]
		if (!conversation) {
			throw new Error(`Conversation ${conversationId} not found`)
		}

		const record: MessageRecord = {
			...message,
			id: message.id ?? uuidv4(),
			timestamp: message.timestamp ?? new Date().toISOString(),
		}

		conversation.messages.push(record)
		conversation.messageCount = conversation.messages.length
		conversation.updatedAt = new Date().toISOString()

		// Update totals
		if (record.tokenCount) {
			conversation.totalTokens = (conversation.totalTokens ?? 0) + record.tokenCount
		}
		if (record.latencyMs) {
			conversation.totalLatencyMs = (conversation.totalLatencyMs ?? 0) + record.latencyMs
		}

		await this._persist()
		return record
	}

	/** Update conversation status */
	async updateConversationStatus(conversationId: string, status: ConversationStatus): Promise<void> {
		await this._ensureLoaded()
		const conversation = this.state.conversations[conversationId]
		if (!conversation) {
			throw new Error(`Conversation ${conversationId} not found`)
		}

		conversation.status = status
		conversation.updatedAt = new Date().toISOString()
		if (status === "completed" || status === "abandoned" || status === "failed" || status === "resolved") {
			conversation.endedAt = conversation.updatedAt
		}

		await this._persist()
	}

	/** Get a conversation by ID */
	getConversation(id: string): ConversationRecord | undefined {
		return this.state.conversations[id]
	}

	/** Find conversations matching filter criteria */
	findConversations(filter?: ConversationFilter): ConversationRecord[] {
		let results = Object.values(this.state.conversations)

		if (filter) {
			if (filter.source) {
				results = results.filter((c) => c.source === filter.source)
			}
			if (filter.status) {
				results = results.filter((c) => c.status === filter.status)
			}
			if (filter.userId) {
				results = results.filter((c) => c.userId === filter.userId)
			}
			if (filter.projectId) {
				results = results.filter((c) => c.projectId === filter.projectId)
			}
			if (filter.tags && filter.tags.length > 0) {
				results = results.filter((c) => c.tags?.some((t) => filter.tags!.includes(t)))
			}
			if (filter.startDate) {
				results = results.filter((c) => c.startedAt >= filter.startDate!)
			}
			if (filter.endDate) {
				results = results.filter((c) => c.startedAt <= filter.endDate!)
			}
		}

		// Sort by most recent first
		results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

		if (filter?.offset) {
			results = results.slice(filter.offset)
		}
		if (filter?.limit) {
			results = results.slice(0, filter.limit)
		}

		return results
	}

	/** Delete a conversation and all its associated issues/errors */
	async deleteConversation(conversationId: string): Promise<boolean> {
		await this._ensureLoaded()
		if (!this.state.conversations[conversationId]) {
			return false
		}

		// Remove associated issues, errors, weaknesses, improvements
		for (const key of ["issues", "errors", "weaknesses", "improvements"] as const) {
			for (const [id, record] of Object.entries(this.state[key])) {
				if (record.conversationId === conversationId) {
					delete this.state[key][id]
				}
			}
		}

		delete this.state.conversations[conversationId]
		await this._persist()
		return true
	}

	// ─── Issue/Error/Weakness/Improvement CRUD ────────────────────────────

	/** Record a detected issue */
	async recordIssue(issue: Omit<DetectedIssue, "id" | "detectedAt">): Promise<DetectedIssue> {
		await this._ensureLoaded()
		const record: DetectedIssue = {
			...issue,
			id: uuidv4(),
			detectedAt: new Date().toISOString(),
		}

		// Route to the correct sub-collection based on category
		if (this._isWeaknessCategory(issue.category)) {
			const weakness: DetectedWeakness = { ...record, category: issue.category as WeaknessCategory }
			this.state.weaknesses[weakness.id] = weakness
		} else if (this._isImprovementCategory(issue.category)) {
			const improvement: DetectedImprovement = {
				...record,
				category: issue.category as ImprovementCategory,
				priority: 50,
				estimatedEffort: "medium",
			}
			this.state.improvements[improvement.id] = improvement
		}

		this.state.issues[record.id] = record
		this.state.monitor.totalIssuesDetected++
		await this._persist()
		return record
	}

	/** Record a detected error */
	async recordError(error: Omit<DetectedError, "id" | "timestamp">): Promise<DetectedError> {
		await this._ensureLoaded()
		const record: DetectedError = {
			...error,
			id: uuidv4(),
			timestamp: new Date().toISOString(),
		}
		this.state.errors[record.id] = record
		this.state.monitor.totalErrorsDetected++
		await this._persist()
		return record
	}

	/** Record a detected weakness */
	async recordWeakness(weakness: Omit<DetectedWeakness, "id" | "detectedAt">): Promise<DetectedWeakness> {
		await this._ensureLoaded()
		const record: DetectedWeakness = {
			...weakness,
			id: uuidv4(),
			detectedAt: new Date().toISOString(),
		}
		this.state.weaknesses[record.id] = record
		this.state.issues[record.id] = record
		this.state.monitor.totalIssuesDetected++
		await this._persist()
		return record
	}

	/** Record a detected improvement */
	async recordImprovement(improvement: Omit<DetectedImprovement, "id" | "detectedAt">): Promise<DetectedImprovement> {
		await this._ensureLoaded()
		const record: DetectedImprovement = {
			...improvement,
			id: uuidv4(),
			detectedAt: new Date().toISOString(),
		}
		this.state.improvements[record.id] = record
		this.state.issues[record.id] = record
		this.state.monitor.totalImprovementsSuggested++
		await this._persist()
		return record
	}

	/** Mark an issue as resolved */
	async resolveIssue(issueId: string): Promise<boolean> {
		await this._ensureLoaded()
		const issue = this.state.issues[issueId]
		if (!issue) return false

		issue.resolved = true
		issue.resolvedAt = new Date().toISOString()
		this.state.monitor.totalIssuesResolved++

		// Also update in sub-collections
		if (this.state.weaknesses[issueId]) {
			this.state.weaknesses[issueId].resolved = true
			this.state.weaknesses[issueId].resolvedAt = issue.resolvedAt
		}
		if (this.state.improvements[issueId]) {
			this.state.improvements[issueId].resolved = true
			this.state.improvements[issueId].resolvedAt = issue.resolvedAt
		}

		await this._persist()
		return true
	}

	/** Mark an error as resolved */
	async resolveError(errorId: string, rootCause?: string): Promise<boolean> {
		await this._ensureLoaded()
		const error = this.state.errors[errorId]
		if (!error) return false

		error.resolved = true
		if (rootCause) {
			error.rootCause = rootCause
		}
		await this._persist()
		return true
	}

	/** Mark an improvement as implemented */
	async markImprovementImplemented(improvementId: string): Promise<boolean> {
		await this._ensureLoaded()
		const improvement = this.state.improvements[improvementId]
		if (!improvement) return false

		improvement.resolved = true
		improvement.resolvedAt = new Date().toISOString()
		this.state.monitor.totalImprovementsImplemented++
		await this._persist()
		return true
	}

	// ─── Query Methods ────────────────────────────────────────────────────

	/** Get all issues with optional filtering */
	getIssues(filter?: {
		severity?: IssueSeverity
		resolved?: boolean
		conversationId?: string
		limit?: number
	}): DetectedIssue[] {
		let results = Object.values(this.state.issues)
		if (filter?.severity) {
			results = results.filter((i) => i.severity === filter.severity)
		}
		if (filter?.resolved !== undefined) {
			results = results.filter((i) => i.resolved === filter.resolved)
		}
		if (filter?.conversationId) {
			results = results.filter((i) => i.conversationId === filter.conversationId)
		}
		results.sort((a, b) => b.detectedAt.localeCompare(a.detectedAt))
		if (filter?.limit) {
			results = results.slice(0, filter.limit)
		}
		return results
	}

	/** Get all weaknesses with optional filtering */
	getWeaknesses(filter?: { category?: WeaknessCategory; resolved?: boolean; limit?: number }): DetectedWeakness[] {
		let results = Object.values(this.state.weaknesses)
		if (filter?.category) {
			results = results.filter((w) => w.category === filter.category)
		}
		if (filter?.resolved !== undefined) {
			results = results.filter((w) => w.resolved === filter.resolved)
		}
		results.sort((a, b) => b.detectedAt.localeCompare(a.detectedAt))
		if (filter?.limit) {
			results = results.slice(0, filter.limit)
		}
		return results
	}

	/** Get all improvements with optional filtering */
	getImprovements(filter?: {
		category?: ImprovementCategory
		resolved?: boolean
		limit?: number
	}): DetectedImprovement[] {
		let results = Object.values(this.state.improvements)
		if (filter?.category) {
			results = results.filter((i) => i.category === filter.category)
		}
		if (filter?.resolved !== undefined) {
			results = results.filter((i) => i.resolved === filter.resolved)
		}
		results.sort((a, b) => b.detectedAt.localeCompare(a.detectedAt))
		if (filter?.limit) {
			results = results.slice(0, filter.limit)
		}
		return results
	}

	/** Get all errors with optional filtering */
	getErrors(filter?: { resolved?: boolean; conversationId?: string; limit?: number }): DetectedError[] {
		let results = Object.values(this.state.errors)
		if (filter?.resolved !== undefined) {
			results = results.filter((e) => e.resolved === filter.resolved)
		}
		if (filter?.conversationId) {
			results = results.filter((e) => e.conversationId === filter.conversationId)
		}
		results.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
		if (filter?.limit) {
			results = results.slice(0, filter.limit)
		}
		return results
	}

	/** Get the current state (for inspection/debugging) */
	getState(): ConversationHistoryState {
		return this.state
	}

	/** Get total conversation count */
	getConversationCount(): number {
		return Object.keys(this.state.conversations).length
	}

	/** Get total error count */
	getErrorCount(): number {
		return Object.keys(this.state.errors).length
	}

	/** Get total weakness count */
	getWeaknessCount(): number {
		return Object.keys(this.state.weaknesses).length
	}

	/** Get total improvement count */
	getImprovementCount(): number {
		return Object.keys(this.state.improvements).length
	}

	// ─── Analysis Summary ─────────────────────────────────────────────────

	/** Generate an analysis summary for a time period */
	generateSummary(days: number = 7): AnalysisSummary {
		const now = new Date()
		const periodStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString()
		const periodEnd = now.toISOString()

		const conversations = Object.values(this.state.conversations).filter(
			(c) => c.startedAt >= periodStart && c.startedAt <= periodEnd,
		)

		const totalMessages = conversations.reduce((sum, c) => sum + c.messageCount, 0)
		const totalErrors = Object.values(this.state.errors).filter(
			(e) => e.timestamp >= periodStart && e.timestamp <= periodEnd,
		).length
		const totalWeaknesses = Object.values(this.state.weaknesses).filter(
			(w) => w.detectedAt >= periodStart && w.detectedAt <= periodEnd,
		).length
		const totalImprovements = Object.values(this.state.improvements).filter(
			(i) => i.detectedAt >= periodStart && i.detectedAt <= periodEnd,
		).length

		// Top weaknesses by category
		const weaknessCounts = new Map<WeaknessCategory, number>()
		for (const w of Object.values(this.state.weaknesses)) {
			if (w.detectedAt >= periodStart) {
				weaknessCounts.set(w.category, (weaknessCounts.get(w.category) ?? 0) + 1)
			}
		}
		const topWeaknesses = [...weaknessCounts.entries()]
			.sort((a, b) => b[1] - a[1])
			.slice(0, 5)
			.map(([category, count]) => ({ category, count }))

		// Top improvements by category
		const improvementCounts = new Map<ImprovementCategory, number>()
		for (const i of Object.values(this.state.improvements)) {
			if (i.detectedAt >= periodStart) {
				improvementCounts.set(i.category, (improvementCounts.get(i.category) ?? 0) + 1)
			}
		}
		const topImprovements = [...improvementCounts.entries()]
			.sort((a, b) => b[1] - a[1])
			.slice(0, 5)
			.map(([category, count]) => ({ category, count }))

		// Friction analysis
		const telegramFrictionIssues = Object.values(this.state.weaknesses).filter(
			(w) =>
				w.detectedAt >= periodStart && (w.category === "telegram_friction" || w.category === "poor_formatting"),
		).length

		const codingFrictionIssues = Object.values(this.state.weaknesses).filter(
			(w) => w.detectedAt >= periodStart && (w.category === "coding_error" || w.category === "misunderstanding"),
		).length

		const telegramConversations = conversations.filter((c) => c.source === "telegram").length
		const telegramFrictionScore =
			telegramConversations > 0
				? Math.min(100, Math.round((telegramFrictionIssues / telegramConversations) * 100))
				: 0

		const codingConversations = conversations.filter((c) => c.source === "telegram" || c.source === "vscode").length
		const codingFrictionScore =
			codingConversations > 0 ? Math.min(100, Math.round((codingFrictionIssues / codingConversations) * 100)) : 0

		// Top friction points
		const frictionPoints: string[] = []
		if (telegramFrictionScore > 30) {
			frictionPoints.push(`Telegram UX friction detected (score: ${telegramFrictionScore}/100)`)
		}
		if (codingFrictionScore > 30) {
			frictionPoints.push(`Coding workflow friction detected (score: ${codingFrictionScore}/100)`)
		}
		if (totalErrors > 10) {
			frictionPoints.push(`High error rate: ${totalErrors} errors in ${days} days`)
		}
		if (totalWeaknesses > 20) {
			frictionPoints.push(`High weakness rate: ${totalWeaknesses} weaknesses in ${days} days`)
		}

		// Recommendations
		const recommendations: string[] = []
		for (const { category, count } of topWeaknesses) {
			if (count >= 3) {
				recommendations.push(
					`Address "${category}" weakness (${count} occurrences) — review conversation patterns and improve response handling`,
				)
			}
		}
		for (const { category, count } of topImprovements) {
			if (count >= 3) {
				recommendations.push(
					`Implement "${category}" improvement (${count} suggestions) — prioritize based on user impact`,
				)
			}
		}
		if (telegramFrictionScore > 50) {
			recommendations.push(
				"CRITICAL: Telegram friction score is high — investigate message formatting, auth flow, and command routing",
			)
		}

		return {
			periodStart,
			periodEnd,
			totalConversations: conversations.length,
			totalMessages,
			totalErrors,
			totalWeaknesses,
			totalImprovements,
			topWeaknesses,
			topImprovements,
			topFrictionPoints: frictionPoints,
			telegramFrictionScore,
			codingFrictionScore,
			recommendations,
		}
	}

	// ─── Cleanup ──────────────────────────────────────────────────────────

	/** Remove old conversations beyond the retention limit */
	async cleanup(maxConversations: number = MAX_CONVERSATIONS): Promise<number> {
		await this._ensureLoaded()
		const now = Date.now()
		if (now - this.lastCleanupAt < CLEANUP_INTERVAL_MS) {
			return 0 // Not time yet
		}

		const keys = Object.keys(this.state.conversations)
		if (keys.length <= maxConversations) {
			this.lastCleanupAt = now
			return 0
		}

		// Sort by updatedAt ascending (oldest first)
		const sorted = keys
			.map((id) => ({ id, updatedAt: this.state.conversations[id].updatedAt }))
			.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))

		const toDelete = sorted.slice(0, keys.length - maxConversations)
		for (const { id } of toDelete) {
			await this.deleteConversation(id)
		}

		this.lastCleanupAt = now
		console.log(`[conversation-history] Cleaned up ${toDelete.length} old conversations`)
		return toDelete.length
	}

	// ─── Helpers ──────────────────────────────────────────────────────────

	private _cloneDefault(): ConversationHistoryState {
		return JSON.parse(JSON.stringify(DEFAULT_STATE))
	}

	private async _ensureLoaded(): Promise<void> {
		if (!this.loaded) {
			await this.init()
		}
	}

	private _isWeaknessCategory(category: string): category is WeaknessCategory {
		const weaknessCategories: WeaknessCategory[] = [
			"misunderstanding",
			"incomplete_response",
			"incorrect_answer",
			"slow_response",
			"error_prone",
			"lack_of_context",
			"poor_formatting",
			"redundant_question",
			"telegram_friction",
			"coding_error",
			"other",
		]
		return weaknessCategories.includes(category as WeaknessCategory)
	}

	private _isImprovementCategory(category: string): category is ImprovementCategory {
		const improvementCategories: ImprovementCategory[] = [
			"response_quality",
			"error_handling",
			"performance",
			"usability",
			"accuracy",
			"completeness",
			"timeliness",
			"friction_reduction",
			"telegram_ux",
			"coding_workflow",
			"clarification",
			"other",
		]
		return improvementCategories.includes(category as ImprovementCategory)
	}
}

// ─── Singleton ─────────────────────────────────────────────────────────────

let _instance: ConversationHistoryManager | null = null

/** Get or create the singleton instance */
export function getConversationHistoryManager(dataDir?: string): ConversationHistoryManager {
	if (!_instance) {
		_instance = new ConversationHistoryManager(dataDir)
	}
	return _instance
}

/** Reset the singleton (for testing) */
export function resetConversationHistoryManager(): void {
	_instance = null
}
