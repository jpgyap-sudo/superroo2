/**
 * Workflow Compliance API Routes
 *
 * Provides endpoints for the dashboard to view workflow compliance data,
 * DeepSeek delegation statistics, and API usage tracking.
 */

const fs = require("fs").promises
const path = require("path")

// Paths to memory files (same as local VS Code extension)
const MEMORY_DIR = path.join(__dirname, "../../..", "server/src/memory")
const COMMIT_LOG_FILE = path.join(MEMORY_DIR, "commit-deploy-log.json")
const USAGE_LOG_FILE = path.join(MEMORY_DIR, "model-usage-log.json")
const TASK_SUMMARIES_FILE = path.join(MEMORY_DIR, "task-usage-summaries.json")

// ── Helper Functions ──────────────────────────────────────────────────────────

async function loadJson(filePath) {
	try {
		const raw = await fs.readFile(filePath, "utf-8")
		return JSON.parse(raw)
	} catch (err) {
		if (err.code === "ENOENT") {
			return null
		}
		throw err
	}
}

function calculateStats(commits, usageLog, taskSummaries) {
	const totalCommits = commits?.length || 0
	const withModelUsage = commits?.filter((c) => c.modelsUsed?.length > 0).length || 0

	const withDeepSeek =
		commits?.filter((c) => c.modelsUsed?.some((m) => m.phase === "coding" && m.provider === "deepseek")).length || 0

	const withoutDeepSeek = withModelUsage - withDeepSeek

	const fullyCompliant = commits?.filter((c) => c.workflowCompliance?.isCompliant).length || 0

	const deepseekRecords = usageLog?.records?.filter((r) => r.phase === "coding" && r.provider === "deepseek") || []

	const totalTokens = deepseekRecords.reduce((sum, r) => sum + (r.promptTokens || 0) + (r.completionTokens || 0), 0)

	const avgLatency =
		deepseekRecords.length > 0
			? deepseekRecords.reduce((sum, r) => sum + (r.latencyMs || 0), 0) / deepseekRecords.length
			: 0

	return {
		totalCommits,
		withModelUsage,
		withDeepSeek,
		withoutDeepSeek,
		fullyCompliant,
		deepseekUsage: {
			totalCalls: deepseekRecords.length,
			totalTokens,
			averageLatencyMs: Math.round(avgLatency),
		},
		complianceRate: totalCommits > 0 ? ((fullyCompliant / totalCommits) * 100).toFixed(1) : 0,
		delegationRate: withModelUsage > 0 ? ((withDeepSeek / withModelUsage) * 100).toFixed(1) : 0,
	}
}

// ── Route Handlers ────────────────────────────────────────────────────────────

/**
 * GET /api/workflow-compliance/stats
 * Returns overall workflow compliance statistics
 */
async function getStats(req, res) {
	try {
		const [commitLog, usageLog, taskSummaries] = await Promise.all([
			loadJson(COMMIT_LOG_FILE),
			loadJson(USAGE_LOG_FILE),
			loadJson(TASK_SUMMARIES_FILE),
		])

		const stats = calculateStats(commitLog?.commits, usageLog, taskSummaries?.summaries)

		res.json({
			success: true,
			data: stats,
		})
	} catch (error) {
		console.error("[workflow-compliance] Error getting stats:", error)
		res.status(500).json({
			success: false,
			error: error.message,
		})
	}
}

/**
 * GET /api/workflow-compliance/commits
 * Returns commits with workflow compliance data
 */
async function getCommits(req, res) {
	try {
		const { limit = 50, since, deepseekOnly, nonCompliantOnly } = req.query
		const commitLog = await loadJson(COMMIT_LOG_FILE)

		if (!commitLog?.commits) {
			return res.json({ success: true, data: [] })
		}

		let commits = commitLog.commits

		// Filter by date
		if (since) {
			const sinceDate = new Date(since)
			commits = commits.filter((c) => new Date(c.timestamp) >= sinceDate)
		}

		// Filter by DeepSeek usage
		if (deepseekOnly === "true") {
			commits = commits.filter((c) =>
				c.modelsUsed?.some((m) => m.phase === "coding" && m.provider === "deepseek"),
			)
		}

		// Filter by compliance
		if (nonCompliantOnly === "true") {
			commits = commits.filter((c) => c.workflowCompliance && !c.workflowCompliance.isCompliant)
		}

		// Limit results
		commits = commits.slice(0, parseInt(limit))

		res.json({
			success: true,
			data: commits,
		})
	} catch (error) {
		console.error("[workflow-compliance] Error getting commits:", error)
		res.status(500).json({
			success: false,
			error: error.message,
		})
	}
}

/**
 * GET /api/workflow-compliance/usage
 * Returns API usage records
 */
async function getUsage(req, res) {
	try {
		const { provider, phase, since, limit = 100 } = req.query
		const usageLog = await loadJson(USAGE_LOG_FILE)

		if (!usageLog?.records) {
			return res.json({ success: true, data: [] })
		}

		let records = usageLog.records

		// Filter by provider
		if (provider) {
			records = records.filter((r) => r.provider === provider)
		}

		// Filter by phase
		if (phase) {
			records = records.filter((r) => r.phase === phase)
		}

		// Filter by date
		if (since) {
			const sinceDate = new Date(since)
			records = records.filter((r) => new Date(r.timestamp) >= sinceDate)
		}

		// Limit results
		records = records.slice(0, parseInt(limit))

		res.json({
			success: true,
			data: records,
		})
	} catch (error) {
		console.error("[workflow-compliance] Error getting usage:", error)
		res.status(500).json({
			success: false,
			error: error.message,
		})
	}
}

/**
 * GET /api/workflow-compliance/verify-key/:keyLast4
 * Verifies if a specific API key was used
 */
async function verifyApiKey(req, res) {
	try {
		const { keyLast4 } = req.params
		const usageLog = await loadJson(USAGE_LOG_FILE)

		if (!usageLog?.records) {
			return res.json({
				success: true,
				data: { wasUsed: false, count: 0 },
			})
		}

		const matchingRecords = usageLog.records.filter((r) => r.apiKeyLast4 === keyLast4)

		res.json({
			success: true,
			data: {
				wasUsed: matchingRecords.length > 0,
				count: matchingRecords.length,
				lastUsed: matchingRecords[matchingRecords.length - 1]?.timestamp,
				providers: [...new Set(matchingRecords.map((r) => r.provider))],
			},
		})
	} catch (error) {
		console.error("[workflow-compliance] Error verifying key:", error)
		res.status(500).json({
			success: false,
			error: error.message,
		})
	}
}

/**
 * GET /api/workflow-compliance/deepseek-stats
 * Returns DeepSeek-specific statistics
 */
async function getDeepSeekStats(req, res) {
	try {
		const { since } = req.query
		const [usageLog, commitLog] = await Promise.all([loadJson(USAGE_LOG_FILE), loadJson(COMMIT_LOG_FILE)])

		let records = usageLog?.records || []
		let commits = commitLog?.commits || []

		// Filter by date if specified
		if (since) {
			const sinceDate = new Date(since)
			records = records.filter((r) => new Date(r.timestamp) >= sinceDate)
			commits = commits.filter((c) => new Date(c.timestamp) >= sinceDate)
		}

		// Get DeepSeek records
		const deepseekRecords = records.filter((r) => r.provider === "deepseek" && r.phase === "coding")

		// Calculate statistics
		const totalCalls = deepseekRecords.length
		const totalTokens = deepseekRecords.reduce(
			(sum, r) => sum + (r.promptTokens || 0) + (r.completionTokens || 0),
			0,
		)
		const totalLatency = deepseekRecords.reduce((sum, r) => sum + (r.latencyMs || 0), 0)
		const avgLatency = totalCalls > 0 ? totalLatency / totalCalls : 0

		const successCount = deepseekRecords.filter((r) => r.success).length
		const fallbackCount = deepseekRecords.filter((r) => r.fallbackUsed).length

		// Get unique API keys used
		const apiKeysUsed = [...new Set(deepseekRecords.map((r) => r.apiKeyLast4).filter(Boolean))]

		// Calculate delegation rate from commits
		const codingCommits = commits.filter((c) => c.modelsUsed?.some((m) => m.phase === "coding"))
		const deepseekCommits = codingCommits.filter((c) =>
			c.modelsUsed?.some((m) => m.phase === "coding" && m.provider === "deepseek"),
		)
		const delegationRate = codingCommits.length > 0 ? (deepseekCommits.length / codingCommits.length) * 100 : 0

		res.json({
			success: true,
			data: {
				totalCalls,
				totalTokens,
				averageLatencyMs: Math.round(avgLatency),
				successRate: totalCalls > 0 ? ((successCount / totalCalls) * 100).toFixed(1) : 0,
				fallbackRate: totalCalls > 0 ? ((fallbackCount / totalCalls) * 100).toFixed(1) : 0,
				delegationRate: delegationRate.toFixed(1),
				apiKeysUsed,
				callsByModel: deepseekRecords.reduce((acc, r) => {
					acc[r.model] = (acc[r.model] || 0) + 1
					return acc
				}, {}),
			},
		})
	} catch (error) {
		console.error("[workflow-compliance] Error getting DeepSeek stats:", error)
		res.status(500).json({
			success: false,
			error: error.message,
		})
	}
}

// ── Export Route Handlers ─────────────────────────────────────────────────────

module.exports = {
	getStats,
	getCommits,
	getUsage,
	verifyApiKey,
	getDeepSeekStats,
}
