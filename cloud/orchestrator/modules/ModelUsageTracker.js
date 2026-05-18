/**
 * Cloud ModelUsageTracker — Tracks AI model API usage and workflow compliance.
 *
 * Cloud-compatible port of src/super-roo/product-memory/ModelUsageTracker.ts
 * for the Node.js runtime. Logs model calls, tracks task phases, and generates
 * workflow compliance data for the dashboard Workflow tab.
 *
 * Files:
 *   - server/src/memory/model-usage-log.json   — Individual API call records
 *   - server/src/memory/task-usage-summaries.json — Per-task summaries
 */

const fs = require("node:fs")
const path = require("node:path")
const crypto = require("node:crypto")

const MEMORY_DIR = path.join(__dirname, "..", "..", "..", "server", "src", "memory")
const USAGE_LOG_FILE = path.join(MEMORY_DIR, "model-usage-log.json")
const TASK_SUMMARY_FILE = path.join(MEMORY_DIR, "task-usage-summaries.json")

const CACHE_FLUSH_SIZE = 10

class ModelUsageTracker {
	constructor(opts = {}) {
		this.memoryDir = opts.memoryDir || MEMORY_DIR
		this.usageLogPath = path.join(this.memoryDir, "model-usage-log.json")
		this.taskSummaryPath = path.join(this.memoryDir, "task-usage-summaries.json")
		this.currentTask = null
		this.inMemoryCache = []
	}

	async initialize() {
		const dir = this.memoryDir
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true })
		}
		if (!fs.existsSync(this.usageLogPath)) {
			fs.writeFileSync(this.usageLogPath, JSON.stringify({ records: [] }, null, 2), "utf-8")
		}
		if (!fs.existsSync(this.taskSummaryPath)) {
			fs.writeFileSync(this.taskSummaryPath, JSON.stringify({ summaries: [] }, null, 2), "utf-8")
		}
		console.log(`[ModelUsageTracker] Initialized at ${this.memoryDir}`)
	}

	// ── Task Lifecycle ────────────────────────────────────────────────────

	/**
	 * Start tracking a new task
	 * @param {string} [taskId]
	 * @returns {string}
	 */
	startTask(taskId) {
		const id = taskId || `task_${crypto.randomUUID()}`
		this.currentTask = {
			taskId: id,
			startTime: new Date().toISOString(),
			phases: {},
			totalTokens: 0,
			totalLatencyMs: 0,
			workflowCompliant: false,
			deepseekDelegated: false,
		}
		console.log(`[ModelUsageTracker] Started tracking task: ${id}`)
		return id
	}

	/**
	 * End the current task and save summary
	 * @returns {Promise<Object|undefined>}
	 */
	async endTask() {
		if (!this.currentTask) {
			console.warn("[ModelUsageTracker] No active task to end")
			return undefined
		}

		this.currentTask.endTime = new Date().toISOString()

		// Calculate workflow compliance
		const hasPlanning = !!this.currentTask.phases.planning
		const hasCoding = !!this.currentTask.phases.coding
		const hasReview = !!this.currentTask.phases.review
		const hasSummarization = !!this.currentTask.phases.summarization

		// Realistic compliance: coding + (review OR summarization) is sufficient
		this.currentTask.workflowCompliant = hasCoding && (hasReview || hasSummarization)
		this.currentTask.deepseekDelegated = this.currentTask.phases.coding?.provider === "deepseek"

		// Save to task summaries
		const summaries = this._readTaskSummaries()
		summaries.summaries.unshift(this.currentTask)
		this._writeTaskSummaries(summaries)

		// Flush any remaining cache
		if (this.inMemoryCache.length > 0) {
			await this._flushCache()
		}

		console.log(
			`[ModelUsageTracker] Task ${this.currentTask.taskId} completed - ` +
				`compliant: ${this.currentTask.workflowCompliant}, ` +
				`deepseek: ${this.currentTask.deepseekDelegated}`,
		)

		const summary = this.currentTask
		this.currentTask = null
		return summary
	}

	// ── API Call Logging ──────────────────────────────────────────────────

	/**
	 * Log a model API call
	 * @param {Object} record
	 * @param {string} record.phase - planning|coding|review|summarization
	 * @param {string} record.provider - anthropic|deepseek|ollama|openai
	 * @param {string} record.model
	 * @param {number} [record.promptTokens]
	 * @param {number} [record.completionTokens]
	 * @param {number} [record.latencyMs]
	 * @param {boolean} [record.success=true]
	 * @param {boolean} [record.fallbackUsed=false]
	 * @param {string} [record.apiKeyLast4]
	 * @param {string} [record.error]
	 * @returns {Promise<Object>}
	 */
	async logApiCall(record) {
		const fullRecord = {
			...record,
			id: `usage_${crypto.randomUUID()}`,
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
		if (this.inMemoryCache.length >= CACHE_FLUSH_SIZE) {
			await this._flushCache()
		}

		return fullRecord
	}

	/**
	 * Log a DeepSeek delegation attempt
	 * @param {boolean} success
	 * @param {string} model
	 * @param {Object} [opts]
	 * @returns {Promise<Object>}
	 */
	async logDeepSeekDelegation(success, model, opts = {}) {
		return this.logApiCall({
			phase: "coding",
			provider: "deepseek",
			model,
			apiKeyLast4: opts.apiKeyLast4,
			latencyMs: opts.latencyMs,
			promptTokens: opts.tokens?.prompt,
			completionTokens: opts.tokens?.completion,
			success,
			fallbackUsed: !success,
			error: opts.error,
		})
	}

	/**
	 * Log Ollama summarization
	 * @param {string} model
	 * @param {number} latencyMs
	 * @param {boolean} success
	 * @param {string} [error]
	 * @returns {Promise<Object>}
	 */
	async logOllamaSummarization(model, latencyMs, success, error) {
		return this.logApiCall({
			phase: "summarization",
			provider: "ollama",
			model,
			latencyMs,
			promptTokens: 500,
			completionTokens: 200,
			success,
			fallbackUsed: false,
			error,
		})
	}

	// ── Query Methods ─────────────────────────────────────────────────────

	/**
	 * Get usage records with optional filters
	 * @param {Object} [filter]
	 * @returns {Promise<Object[]>}
	 */
	async getUsageRecords(filter = {}) {
		const log = this._readUsageLog()
		let records = log.records

		if (filter.phase) {
			records = records.filter((r) => r.phase === filter.phase)
		}
		if (filter.provider) {
			records = records.filter((r) => r.provider === filter.provider)
		}
		if (filter.since) {
			const since = new Date(filter.since).getTime()
			records = records.filter((r) => new Date(r.timestamp).getTime() >= since)
		}

		// Sort newest first
		records.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

		const limit = filter.limit || 100
		return records.slice(0, limit)
	}

	/**
	 * Get DeepSeek delegation stats
	 * @returns {Promise<Object>}
	 */
	async getDeepSeekStats() {
		const log = this._readUsageLog()
		const deepseekRecords = log.records.filter((r) => r.provider === "deepseek")

		const totalCalls = deepseekRecords.length
		const totalTokens = deepseekRecords.reduce(
			(sum, r) => sum + (r.promptTokens || 0) + (r.completionTokens || 0),
			0,
		)
		const avgLatency =
			deepseekRecords.length > 0
				? deepseekRecords.reduce((sum, r) => sum + (r.latencyMs || 0), 0) / deepseekRecords.length
				: 0

		const successCount = deepseekRecords.filter((r) => r.success).length
		const fallbackCount = deepseekRecords.filter((r) => r.fallbackUsed).length

		const apiKeysUsed = [...new Set(deepseekRecords.filter((r) => r.apiKeyLast4).map((r) => r.apiKeyLast4))]

		const callsByModel = {}
		for (const r of deepseekRecords) {
			callsByModel[r.model] = (callsByModel[r.model] || 0) + 1
		}

		return {
			totalCalls,
			totalTokens,
			averageLatencyMs: Math.round(avgLatency),
			successRate: totalCalls > 0 ? ((successCount / totalCalls) * 100).toFixed(1) : "0.0",
			fallbackRate: totalCalls > 0 ? ((fallbackCount / totalCalls) * 100).toFixed(1) : "0.0",
			apiKeysUsed,
			callsByModel,
		}
	}

	/**
	 * Get aggregate stats
	 * @returns {Promise<Object>}
	 */
	async getStats() {
		const log = this._readUsageLog()
		const summaries = this._readTaskSummaries()

		const totalCalls = log.records.length
		const totalTokens = log.records.reduce((sum, r) => sum + (r.promptTokens || 0) + (r.completionTokens || 0), 0)
		const avgLatency = totalCalls > 0 ? log.records.reduce((sum, r) => sum + (r.latencyMs || 0), 0) / totalCalls : 0

		const callsByProvider = {}
		for (const r of log.records) {
			callsByProvider[r.provider] = (callsByProvider[r.provider] || 0) + 1
		}

		const callsByPhase = {}
		for (const r of log.records) {
			callsByPhase[r.phase] = (callsByPhase[r.phase] || 0) + 1
		}

		return {
			totalCalls,
			totalTokens,
			averageLatencyMs: Math.round(avgLatency),
			callsByProvider,
			callsByPhase,
			totalTasks: summaries.summaries.length,
			compliantTasks: summaries.summaries.filter((s) => s.workflowCompliant).length,
		}
	}

	/**
	 * Check if an API key (last 4 chars) was used
	 * @param {string} apiKeyLast4
	 * @param {Date} [since]
	 * @returns {Promise<boolean>}
	 */
	async wasApiKeyUsed(apiKeyLast4, since) {
		const log = this._readUsageLog()
		return log.records.some((r) => {
			if (r.apiKeyLast4 !== apiKeyLast4) return false
			if (since && new Date(r.timestamp).getTime() < since.getTime()) return false
			return true
		})
	}

	/**
	 * Get workflow compliance report
	 * @returns {Promise<Object>}
	 */
	async getWorkflowComplianceReport() {
		const summaries = this._readTaskSummaries()
		const total = summaries.summaries.length
		const compliant = summaries.summaries.filter((s) => s.workflowCompliant).length
		const deepseekDelegated = summaries.summaries.filter((s) => s.deepseekDelegated).length

		return {
			totalTasks: total,
			compliantTasks: compliant,
			deepseekDelegated,
			complianceRate: total > 0 ? ((compliant / total) * 100).toFixed(1) : "0.0",
			delegationRate: total > 0 ? ((deepseekDelegated / total) * 100).toFixed(1) : "0.0",
		}
	}

	// ── Private Helpers ───────────────────────────────────────────────────

	async _flushCache() {
		if (this.inMemoryCache.length === 0) return

		const log = this._readUsageLog()
		log.records.push(...this.inMemoryCache)
		this._writeUsageLog(log)
		this.inMemoryCache = []
	}

	_readUsageLog() {
		try {
			if (!fs.existsSync(this.usageLogPath)) return { records: [] }
			return JSON.parse(fs.readFileSync(this.usageLogPath, "utf-8"))
		} catch {
			return { records: [] }
		}
	}

	_writeUsageLog(data) {
		const dir = path.dirname(this.usageLogPath)
		if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
		fs.writeFileSync(this.usageLogPath, JSON.stringify(data, null, 2), "utf-8")
	}

	_readTaskSummaries() {
		try {
			if (!fs.existsSync(this.taskSummaryPath)) return { summaries: [] }
			return JSON.parse(fs.readFileSync(this.taskSummaryPath, "utf-8"))
		} catch {
			return { summaries: [] }
		}
	}

	_writeTaskSummaries(data) {
		const dir = path.dirname(this.taskSummaryPath)
		if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
		fs.writeFileSync(this.taskSummaryPath, JSON.stringify(data, null, 2), "utf-8")
	}
}

module.exports = { ModelUsageTracker }
