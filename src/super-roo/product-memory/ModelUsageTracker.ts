/**
 * Model Usage Tracker — Real-time tracking of AI model API calls.
 *
 * This service logs every AI API call made during task execution,
 * tracking provider, model, tokens, latency, and success/failure.
 * It integrates with CommitDeployLog to provide complete workflow visibility.
 *
 * Features:
 * - Real-time API call logging
 * - Token usage tracking
 * - Latency measurement
 * - Fallback detection
 * - DeepSeek delegation verification
 * - Workflow compliance auditing
 */

import { v4 as uuidv4 } from "uuid"
import fs from "fs/promises"
import path from "path"
import type { EventLog } from "../logging/EventLog"
import type { ModelUsage, WorkflowCompliance } from "./CommitDeployLog"

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ModelUsageRecord extends ModelUsage {
	/** Unique ID for this usage record */
	id: string
	/** Associated task/commit ID */
	taskId?: string
	/** The actual API endpoint called */
	endpoint?: string
	/** Error message if call failed */
	error?: string
	/** Raw request size in bytes */
	requestSizeBytes?: number
	/** Raw response size in bytes */
	responseSizeBytes?: number
}

export interface TaskUsageSummary {
	taskId: string
	startTime: string
	endTime?: string
	phases: {
		planning?: ModelUsageRecord
		coding?: ModelUsageRecord
		review?: ModelUsageRecord
		summarization?: ModelUsageRecord
		memory_storage?: ModelUsageRecord
	}
	totalTokens: number
	totalLatencyMs: number
	workflowCompliant: boolean
	deepseekDelegated: boolean
}

export interface ModelUsageStats {
	/** Total API calls made */
	totalCalls: number
	/** Calls by provider */
	callsByProvider: Record<string, number>
	/** Calls by model */
	callsByModel: Record<string, number>
	/** Total tokens consumed */
	totalTokens: number
	/** Average latency per call */
	averageLatencyMs: number
	/** Fallback usage rate (0-1) */
	fallbackRate: number
	/** Success rate (0-1) */
	successRate: number
	/** DeepSeek delegation rate (0-1) */
	deepseekDelegationRate: number
}

// ── Constants ─────────────────────────────────────────────────────────────────

const USAGE_LOG_FILE = "model-usage-log.json"
const TASK_SUMMARY_FILE = "task-usage-summaries.json"

const DEFAULT_USAGE_LOG: { records: ModelUsageRecord[] } = {
	records: [],
}

const DEFAULT_TASK_SUMMARIES: { summaries: TaskUsageSummary[] } = {
	summaries: [],
}

// ── Service ───────────────────────────────────────────────────────────────────

export class ModelUsageTracker {
	private logDir: string
	private usageLogPath: string
	private taskSummaryPath: string
	private currentTask?: TaskUsageSummary
	private inMemoryCache: ModelUsageRecord[] = []
	private readonly CACHE_FLUSH_SIZE = 10

	constructor(
		private readonly events: EventLog,
		memoryDir?: string,
	) {
		this.logDir = memoryDir
			|| process.env.SUPERROO_PRODUCT_MEMORY_DIR
			|| (process.env.SUPERROO_HOME ? `${process.env.SUPERROO_HOME}/product-memory` : null)
			|| path.join(require("os").homedir(), ".superroo", "product-memory")
		this.usageLogPath = path.join(this.logDir, USAGE_LOG_FILE)
		this.taskSummaryPath = path.join(this.logDir, TASK_SUMMARY_FILE)
	}

	setMemoryDir(dir: string): void {
		this.logDir = dir
		this.usageLogPath = path.join(this.logDir, USAGE_LOG_FILE)
		this.taskSummaryPath = path.join(this.logDir, TASK_SUMMARY_FILE)
	}

	async initialize(): Promise<void> {
		await fs.mkdir(this.logDir, { recursive: true })
		try {
			await fs.access(this.usageLogPath)
		} catch {
			await this.writeUsageLog(DEFAULT_USAGE_LOG)
		}
		try {
			await fs.access(this.taskSummaryPath)
		} catch {
			await this.writeTaskSummaries(DEFAULT_TASK_SUMMARIES)
		}
		this.events.info("model_usage_tracker.initialized", `Model Usage Tracker initialized at ${this.logDir}`)
	}

	// ── Task Lifecycle ────────────────────────────────────────────────────

	/**
	 * Start tracking a new task
	 */
	startTask(taskId?: string): string {
		const id = taskId || `task_${uuidv4()}`
		this.currentTask = {
			taskId: id,
			startTime: new Date().toISOString(),
			phases: {},
			totalTokens: 0,
			totalLatencyMs: 0,
			workflowCompliant: false,
			deepseekDelegated: false,
		}
		this.events.info("model_usage_tracker.task_started", `Started tracking task: ${id}`)
		return id
	}

	/**
	 * End the current task and save summary
	 */
	async endTask(): Promise<TaskUsageSummary | undefined> {
		if (!this.currentTask) {
			this.events.warn("model_usage_tracker.no_active_task", "No active task to end")
			return undefined
		}

		this.currentTask.endTime = new Date().toISOString()

		// Calculate workflow compliance
		const hasPlanning = !!this.currentTask.phases.planning
		const hasCoding = !!this.currentTask.phases.coding
		const hasReview = !!this.currentTask.phases.review
		const hasSummarization = !!this.currentTask.phases.summarization

		this.currentTask.workflowCompliant = hasPlanning && hasCoding && hasReview
		this.currentTask.deepseekDelegated = this.currentTask.phases.coding?.provider === "deepseek"

		// Save to task summaries
		const summaries = await this.readTaskSummaries()
		summaries.summaries.unshift(this.currentTask)
		await this.writeTaskSummaries(summaries)

		this.events.info(
			"model_usage_tracker.task_completed",
			`Task ${this.currentTask.taskId} completed - DeepSeek delegated: ${this.currentTask.deepseekDelegated}`,
			{
				data: {
					taskId: this.currentTask.taskId,
					workflowCompliant: this.currentTask.workflowCompliant,
					deepseekDelegated: this.currentTask.deepseekDelegated,
					totalTokens: this.currentTask.totalTokens,
				} as unknown as Record<string, unknown>,
			},
		)

		const summary = this.currentTask
		this.currentTask = undefined
		return summary
	}

	// ── API Call Logging ──────────────────────────────────────────────────

	/**
	 * Log a model API call
	 */
	async logApiCall(record: Omit<ModelUsageRecord, "id" | "timestamp">): Promise<ModelUsageRecord> {
		const fullRecord: ModelUsageRecord = {
			...record,
			id: `usage_${uuidv4()}`,
			timestamp: new Date().toISOString(),
		}

		// Add to in-memory cache
		this.inMemoryCache.push(fullRecord)

		// Update current task if tracking
		if (this.currentTask && record.phase) {
			this.currentTask.phases[record.phase] = fullRecord
			this.currentTask.totalTokens += (record.promptTokens || 0) + (record.completionTokens || 0)
			this.currentTask.totalLatencyMs += record.latencyMs || 0
		}

		// Flush cache if needed
		if (this.inMemoryCache.length >= this.CACHE_FLUSH_SIZE) {
			await this.flushCache()
		}

		this.events.info(
			"model_usage_tracker.api_call",
			`API call: ${record.provider}/${record.model} (${record.phase}) - ${record.success ? "success" : "failed"}`,
			{
				data: {
					usageId: fullRecord.id,
					provider: record.provider,
					model: record.model,
					phase: record.phase,
					success: record.success,
					tokens: (record.promptTokens || 0) + (record.completionTokens || 0),
				} as unknown as Record<string, unknown>,
			},
		)

		return fullRecord
	}

	/**
	 * Log a DeepSeek delegation attempt
	 */
	async logDeepSeekDelegation(
		success: boolean,
		model: string,
		apiKeyLast4?: string,
		latencyMs?: number,
		tokens?: { prompt: number; completion: number },
		error?: string,
	): Promise<ModelUsageRecord> {
		return this.logApiCall({
			phase: "coding",
			provider: "deepseek",
			model,
			apiKeyLast4,
			latencyMs,
			promptTokens: tokens?.prompt,
			completionTokens: tokens?.completion,
			success,
			fallbackUsed: !success,
			error,
		})
	}

	/**
	 * Log Ollama summarization
	 */
	async logOllamaSummarization(
		model: string,
		latencyMs: number,
		success: boolean,
		error?: string,
	): Promise<ModelUsageRecord> {
		return this.logApiCall({
			phase: "summarization",
			provider: "ollama",
			model,
			latencyMs,
			success,
			error,
		})
	}

	// ── Queries ───────────────────────────────────────────────────────────

	/**
	 * Get usage records with filters
	 */
	async getUsageRecords(filter?: {
		provider?: string
		model?: string
		phase?: string
		success?: boolean
		fallbackUsed?: boolean
		since?: Date
		limit?: number
	}): Promise<ModelUsageRecord[]> {
		// Flush cache first to ensure consistency
		await this.flushCache()

		const log = await this.readUsageLog()
		let records = log.records

		if (filter?.provider) {
			records = records.filter((r) => r.provider === filter.provider)
		}
		if (filter?.model) {
			records = records.filter((r) => r.model === filter.model)
		}
		if (filter?.phase) {
			records = records.filter((r) => r.phase === filter.phase)
		}
		if (filter?.success !== undefined) {
			records = records.filter((r) => r.success === filter.success)
		}
		if (filter?.fallbackUsed !== undefined) {
			records = records.filter((r) => r.fallbackUsed === filter.fallbackUsed)
		}
		if (filter?.since) {
			records = records.filter((r) => new Date(r.timestamp) >= filter.since!)
		}
		if (filter?.limit) {
			records = records.slice(0, filter.limit)
		}

		return records
	}

	/**
	 * Get DeepSeek delegation statistics
	 */
	async getDeepSeekStats(): Promise<{
		totalCodingTasks: number
		deepseekUsed: number
		deepseekSkipped: number
		delegationRate: number
		averageLatencyMs: number
		totalTokens: number
		lastUsed?: string
	}> {
		await this.flushCache()
		const log = await this.readUsageLog()

		const codingRecords = log.records.filter((r) => r.phase === "coding")
		const totalCodingTasks = codingRecords.length
		const deepseekRecords = codingRecords.filter((r) => r.provider === "deepseek")
		const deepseekUsed = deepseekRecords.length
		const deepseekSkipped = totalCodingTasks - deepseekUsed

		const totalLatency = deepseekRecords.reduce((sum, r) => sum + (r.latencyMs || 0), 0)
		const totalTokens = deepseekRecords.reduce(
			(sum, r) => sum + (r.promptTokens || 0) + (r.completionTokens || 0),
			0,
		)

		return {
			totalCodingTasks,
			deepseekUsed,
			deepseekSkipped,
			delegationRate: totalCodingTasks > 0 ? deepseekUsed / totalCodingTasks : 0,
			averageLatencyMs: deepseekUsed > 0 ? totalLatency / deepseekUsed : 0,
			totalTokens,
			lastUsed: deepseekRecords[0]?.timestamp,
		}
	}

	/**
	 * Get comprehensive usage statistics
	 */
	async getStats(): Promise<ModelUsageStats> {
		await this.flushCache()
		const log = await this.readUsageLog()

		const totalCalls = log.records.length
		if (totalCalls === 0) {
			return {
				totalCalls: 0,
				callsByProvider: {},
				callsByModel: {},
				totalTokens: 0,
				averageLatencyMs: 0,
				fallbackRate: 0,
				successRate: 0,
				deepseekDelegationRate: 0,
			}
		}

		const callsByProvider: Record<string, number> = {}
		const callsByModel: Record<string, number> = {}
		let totalTokens = 0
		let totalLatency = 0
		let fallbackCount = 0
		let successCount = 0
		let codingCount = 0
		let deepseekCodingCount = 0

		for (const record of log.records) {
			callsByProvider[record.provider] = (callsByProvider[record.provider] || 0) + 1
			callsByModel[record.model] = (callsByModel[record.model] || 0) + 1
			totalTokens += (record.promptTokens || 0) + (record.completionTokens || 0)
			totalLatency += record.latencyMs || 0
			if (record.fallbackUsed) fallbackCount++
			if (record.success) successCount++
			if (record.phase === "coding") {
				codingCount++
				if (record.provider === "deepseek") deepseekCodingCount++
			}
		}

		return {
			totalCalls,
			callsByProvider,
			callsByModel,
			totalTokens,
			averageLatencyMs: totalLatency / totalCalls,
			fallbackRate: fallbackCount / totalCalls,
			successRate: successCount / totalCalls,
			deepseekDelegationRate: codingCount > 0 ? deepseekCodingCount / codingCount : 0,
		}
	}

	/**
	 * Check if a specific API key was used
	 */
	async wasApiKeyUsed(apiKeyLast4: string, since?: Date): Promise<boolean> {
		await this.flushCache()
		const log = await this.readUsageLog()

		return log.records.some((r) => {
			const matchesKey = r.apiKeyLast4 === apiKeyLast4
			const matchesTime = since ? new Date(r.timestamp) >= since : true
			return matchesKey && matchesTime
		})
	}

	/**
	 * Generate workflow compliance report
	 */
	async getWorkflowComplianceReport(): Promise<{
		totalTasks: number
		compliantTasks: number
		nonCompliantTasks: number
		missingPlanning: number
		missingCoding: number
		missingReview: number
		missingSummarization: number
		deepseekSkipped: number
	}> {
		const summaries = await this.readTaskSummaries()

		const totalTasks = summaries.summaries.length
		const compliantTasks = summaries.summaries.filter((s) => s.workflowCompliant).length
		const nonCompliantTasks = totalTasks - compliantTasks

		const missingPlanning = summaries.summaries.filter((s) => !s.phases.planning).length
		const missingCoding = summaries.summaries.filter((s) => !s.phases.coding).length
		const missingReview = summaries.summaries.filter((s) => !s.phases.review).length
		const missingSummarization = summaries.summaries.filter((s) => !s.phases.summarization).length

		const deepseekSkipped = summaries.summaries.filter((s) => !s.deepseekDelegated).length

		return {
			totalTasks,
			compliantTasks,
			nonCompliantTasks,
			missingPlanning,
			missingCoding,
			missingReview,
			missingSummarization,
			deepseekSkipped,
		}
	}

	// ── Internal ──────────────────────────────────────────────────────────

	private async flushCache(): Promise<void> {
		if (this.inMemoryCache.length === 0) return

		const log = await this.readUsageLog()
		log.records.push(...this.inMemoryCache)
		await this.writeUsageLog(log)

		this.events.info(
			"model_usage_tracker.cache_flushed",
			`Flushed ${this.inMemoryCache.length} usage records to disk`,
		)

		this.inMemoryCache = []
	}

	private async readUsageLog(): Promise<{ records: ModelUsageRecord[] }> {
		try {
			const raw = await fs.readFile(this.usageLogPath, "utf-8")
			return JSON.parse(raw) as { records: ModelUsageRecord[] }
		} catch (err: unknown) {
			if (isNodeError(err) && err.code === "ENOENT") {
				await this.writeUsageLog(DEFAULT_USAGE_LOG)
				return JSON.parse(JSON.stringify(DEFAULT_USAGE_LOG))
			}
			throw err
		}
	}

	private async writeUsageLog(data: { records: ModelUsageRecord[] }): Promise<void> {
		await fs.writeFile(this.usageLogPath, JSON.stringify(data, null, 2), "utf-8")
	}

	private async readTaskSummaries(): Promise<{ summaries: TaskUsageSummary[] }> {
		try {
			const raw = await fs.readFile(this.taskSummaryPath, "utf-8")
			return JSON.parse(raw) as { summaries: TaskUsageSummary[] }
		} catch (err: unknown) {
			if (isNodeError(err) && err.code === "ENOENT") {
				await this.writeTaskSummaries(DEFAULT_TASK_SUMMARIES)
				return JSON.parse(JSON.stringify(DEFAULT_TASK_SUMMARIES))
			}
			throw err
		}
	}

	private async writeTaskSummaries(data: { summaries: TaskUsageSummary[] }): Promise<void> {
		await fs.writeFile(this.taskSummaryPath, JSON.stringify(data, null, 2), "utf-8")
	}
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
	return err instanceof Error && "code" in err
}

// ── Singleton Instance ────────────────────────────────────────────────────────

let globalTracker: ModelUsageTracker | null = null

export function initializeModelUsageTracker(events: EventLog, memoryDir?: string): ModelUsageTracker {
	globalTracker = new ModelUsageTracker(events, memoryDir)
	return globalTracker
}

export function getModelUsageTracker(): ModelUsageTracker {
	if (!globalTracker) {
		throw new Error("ModelUsageTracker not initialized. Call initializeModelUsageTracker first.")
	}
	return globalTracker
}
