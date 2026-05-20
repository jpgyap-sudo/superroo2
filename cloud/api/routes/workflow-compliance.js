/**
 * Workflow Compliance API Routes
 *
 * Provides endpoints for the dashboard to view workflow compliance data,
 * DeepSeek delegation statistics, and API usage tracking.
 */

const fs = require("fs").promises
const fsSync = require("fs")
const path = require("path")
const os = require("os")
const { execFile } = require("child_process")

// Paths to memory files (same as local VS Code extension)
const MEMORY_DIR = path.join(__dirname, "../../..", "server/src/memory")
const COMMIT_LOG_FILE = path.join(MEMORY_DIR, "commit-deploy-log.json")
const USAGE_LOG_FILE = path.join(MEMORY_DIR, "model-usage-log.json")
const TASK_SUMMARIES_FILE = path.join(MEMORY_DIR, "task-usage-summaries.json")
const LESSON_INDEX_FILE = path.join(__dirname, "../../..", "memory/lesson-index.jsonl")
const LESSONS_MD_FILE = path.join(__dirname, "../../..", "memory/lessons-learned.md")
const SYNC_STATE_FILE = path.join(__dirname, "../../..", "memory/.sync-state.json")
const SUPERROO_DIR = path.join(os.homedir(), ".superroo")
const SUPERROO_CONFIG_FILE = path.join(SUPERROO_DIR, "config.json")
const RETRY_QUEUE_FILE = path.join(SUPERROO_DIR, "retry-queue.json")
const HOOK_LOG_FILE = path.join(SUPERROO_DIR, "claude-hook.log")
const GLOBAL_BRIDGE_CMD = path.join(SUPERROO_DIR, "bin/superroo-codex-bridge.cmd")
const GLOBAL_HOOK_FILE = path.join(SUPERROO_DIR, "bin/global-post-commit")
const SUPERROO_LEARN_CMD = path.join(SUPERROO_DIR, "bin/superroo-learn.cmd")
const VERIFY_HOOK_CMD = path.join(SUPERROO_DIR, "bin/superroo-verify-hook.cmd")

// ── Helper Functions ──────────────────────────────────────────────────────────

function sendJson(res, status, payload) {
	res.writeHead(status, { "Content-Type": "application/json" })
	res.end(JSON.stringify(payload))
}

async function readRequestJson(req) {
	return new Promise((resolve) => {
		let body = ""
		req.on("data", (chunk) => {
			body += chunk
			if (body.length > 1024 * 1024) req.destroy()
		})
		req.on("end", () => {
			try {
				resolve(body ? JSON.parse(body) : {})
			} catch {
				resolve({})
			}
		})
		req.on("error", () => resolve({}))
	})
}

/**
 * Parse query parameters from URL.
 */
function parseQuery(url) {
	try {
		const parsed = new URL(url, "http://localhost")
		return Object.fromEntries(parsed.searchParams.entries())
	} catch {
		return {}
	}
}

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

async function loadJsonDiagnostic(filePath, fallback = null) {
	try {
		const raw = await fs.readFile(filePath, "utf-8")
		return { available: true, malformed: false, data: JSON.parse(raw), error: null }
	} catch (err) {
		if (err.code === "ENOENT") {
			return { available: false, malformed: false, data: fallback, error: "missing" }
		}
		return { available: true, malformed: true, data: fallback, error: err.message }
	}
}

function normalizeIsoTimestamp(value) {
	if (!value) return null
	const date = typeof value === "number" ? new Date(value) : new Date(value)
	return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function normalizeCommit(commit, index = 0) {
	const issues = []
	const normalized = { ...commit }
	if (!normalized.id) {
		normalized.id = `unkeyed_commit_${index}`
		issues.push("missing id")
	}
	if (!normalized.commitSha) {
		normalized.commitSha = "unknown"
		issues.push("missing commitSha")
	}
	const isoTimestamp = normalizeIsoTimestamp(normalized.timestamp)
	if (!isoTimestamp) {
		issues.push("invalid timestamp")
	} else {
		normalized.timestamp = isoTimestamp
	}
	if (!Array.isArray(normalized.modelsUsed)) {
		normalized.modelsUsed = []
		issues.push("missing modelsUsed")
	}
	if (!normalized.workflowCompliance) {
		issues.push("missing workflowCompliance")
	}
	normalized.dataQualityIssues = issues
	return normalized
}

function normalizeCommits(commits = []) {
	const normalized = commits.map(normalizeCommit)
	return {
		commits: normalized,
		dataQuality: {
			malformedRecords: normalized.filter((c) => c.dataQualityIssues?.length > 0).length,
			missingSha: normalized.filter((c) => c.dataQualityIssues?.includes("missing commitSha")).length,
			missingWorkflowCompliance: normalized.filter((c) =>
				c.dataQualityIssues?.includes("missing workflowCompliance"),
			).length,
			missingModelUsage: normalized.filter((c) => c.dataQualityIssues?.includes("missing modelsUsed")).length,
			invalidTimestamp: normalized.filter((c) => c.dataQualityIssues?.includes("invalid timestamp")).length,
		},
	}
}

async function readJsonlDiagnostic(filePath) {
	try {
		const raw = await fs.readFile(filePath, "utf-8")
		const records = []
		let malformedLines = 0
		for (const line of raw.split(/\r?\n/)) {
			if (!line.trim()) continue
			try {
				records.push(JSON.parse(line))
			} catch {
				malformedLines++
			}
		}
		return { available: true, records, malformedLines, error: null }
	} catch (err) {
		return { available: false, records: [], malformedLines: 0, error: err.code || err.message }
	}
}

async function fileExists(filePath) {
	try {
		await fs.access(filePath)
		return true
	} catch {
		return false
	}
}

function runCommand(command, args = [], timeoutMs = 8000) {
	return new Promise((resolve) => {
		const isCmd = command.toLowerCase().endsWith(".cmd") || command.toLowerCase().endsWith(".bat")
		const execCommand = isCmd ? "cmd.exe" : command
		const execArgs = isCmd ? ["/c", command, ...args] : args
		execFile(execCommand, execArgs, { timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
			if (error) {
				return resolve({ ok: false, error: error.message, stderr: String(stderr || ""), stdout: String(stdout || "") })
			}
			resolve({ ok: true, stdout: String(stdout || ""), stderr: String(stderr || "") })
		})
	})
}

function parseBridgeJson(result) {
	if (!result.ok) return { status: "unreachable", error: result.error || result.stderr || "command failed" }
	try {
		return JSON.parse(result.stdout)
	} catch {
		return { status: "unknown", raw: result.stdout.slice(0, 500) }
	}
}

async function readHookVerificationStatus() {
	try {
		const raw = await fs.readFile(HOOK_LOG_FILE, "utf-8")
		const lines = raw.split(/\r?\n/).filter(Boolean).slice(-80)
		const text = lines.join("\n").toLowerCase()
		let status = "unknown"
		if (text.includes("stored")) status = "stored"
		else if (text.includes("queued") || text.includes("retry-queue")) status = "queued"
		else if (text.includes("triggered") || text.includes("extract-commit")) status = "triggered"
		else if (text.includes("blocked") || text.includes("hookspath")) status = "blocked"
		else if (text.includes("fail") || text.includes("error")) status = "failure"
		return {
			status,
			lastLines: lines.slice(-8),
		}
	} catch {
		return { status: "unknown", lastLines: [] }
	}
}

async function getGitHeadSha() {
	const result = await runCommand("git", ["rev-parse", "HEAD"], 5000)
	return result.ok ? result.stdout.trim() : ""
}

async function buildGitSubjectMap() {
	const result = await runCommand("git", ["log", "--all", "--format=%H%x09%s", "-n", "500"], 10000)
	const map = new Map()
	if (!result.ok) return map
	for (const line of result.stdout.split(/\r?\n/)) {
		const [sha, ...subjectParts] = line.split("\t")
		const subject = subjectParts.join("\t").trim()
		if (sha && subject) map.set(subject.toLowerCase(), sha)
	}
	return map
}

async function repairCommitMetadata() {
	const commitLogResult = await loadJsonDiagnostic(COMMIT_LOG_FILE, { commits: [], deploys: [] })
	const log = commitLogResult.data || { commits: [], deploys: [] }
	const subjectMap = await buildGitSubjectMap()
	let repaired = 0
	const commits = (log.commits || []).map((commit, index) => {
		const next = { ...commit }
		let changed = false
		if (!next.id) {
			next.id = `commit_repaired_${index}_${Date.now()}`
			changed = true
		}
		if (!next.commitSha && next.sha) {
			next.commitSha = next.sha
			changed = true
		}
		if (!next.commitSha || next.commitSha === "unknown") {
			const matched = subjectMap.get(String(next.title || "").toLowerCase())
			if (matched) {
				next.commitSha = matched
				changed = true
			}
		}
		const iso = normalizeIsoTimestamp(next.timestamp)
		if (iso && next.timestamp !== iso) {
			next.timestamp = iso
			changed = true
		}
		if (!Array.isArray(next.modelsUsed)) {
			next.modelsUsed = []
			changed = true
		}
		if (!("workflowCompliance" in next)) {
			next.workflowCompliance = null
			changed = true
		}
		if (changed) repaired++
		return next
	})
	if (repaired > 0) {
		await fs.writeFile(COMMIT_LOG_FILE, JSON.stringify({ ...log, commits }, null, 2), "utf-8")
	}
	return { repaired, total: commits.length }
}

function summarizeFileDiagnostic(result) {
	return {
		available: result.available,
		malformed: result.malformed,
		error: result.error,
	}
}

function calculateStats(commits, usageLog, taskSummaries) {
	const { commits: normalizedCommits, dataQuality } = normalizeCommits(commits || [])
	const totalCommits = normalizedCommits.length || 0
	const trackedCommits = normalizedCommits.filter((c) => c.workflowCompliance).length || 0
	const untrackedCommits = totalCommits - trackedCommits
	const withModelUsage = normalizedCommits.filter((c) => c.modelsUsed?.length > 0).length || 0

	const withDeepSeek =
		normalizedCommits.filter((c) => c.modelsUsed?.some((m) => m.phase === "coding" && m.provider === "deepseek")).length || 0

	const withoutDeepSeek = withModelUsage - withDeepSeek

	const fullyCompliant = normalizedCommits.filter((c) => c.workflowCompliance?.isCompliant).length || 0
	const trackedNonCompliant = trackedCommits - fullyCompliant

	const deepseekRecords = usageLog?.records?.filter((r) => r.phase === "coding" && r.provider === "deepseek") || []
	const taskIds = new Set(normalizedCommits.map((c) => c.id).filter(Boolean) || [])
	const linkedUsageRecords = usageLog?.records?.filter((r) => r.taskId && taskIds.has(r.taskId)).length || 0
	const orphanedUsageRecords = usageLog?.records?.filter((r) => r.taskId && !taskIds.has(r.taskId)).length || 0

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
		trackedCommits,
		untrackedCommits,
		fullyCompliant,
		trackedNonCompliant,
		deepseekUsage: {
			totalCalls: deepseekRecords.length,
			totalTokens,
			averageLatencyMs: Math.round(avgLatency),
		},
		complianceRate: trackedCommits > 0 ? ((fullyCompliant / trackedCommits) * 100).toFixed(1) : null,
		trackingCoverage: totalCommits > 0 ? ((trackedCommits / totalCommits) * 100).toFixed(1) : 0,
		delegationRate: withModelUsage > 0 ? ((withDeepSeek / withModelUsage) * 100).toFixed(1) : 0,
		linkage: {
			linkedUsageRecords,
			orphanedUsageRecords,
		},
		dataQuality,
	}
}

function normalizeTimestamp(value) {
	const date = new Date(value)
	return Number.isNaN(date.getTime()) ? null : date
}

function buildTrendSeries(commits) {
	const byDay = new Map()
	const byAgent = new Map()

	for (const commit of commits || []) {
		const date = normalizeTimestamp(commit.timestamp)
		if (!date) continue
		const day = date.toISOString().slice(0, 10)
		const currentDay = byDay.get(day) || {
			date: day,
			totalCommits: 0,
			trackedCommits: 0,
			compliantCommits: 0,
			deepseekCommits: 0,
		}
		currentDay.totalCommits++
		if (commit.workflowCompliance) currentDay.trackedCommits++
		if (commit.workflowCompliance?.isCompliant) currentDay.compliantCommits++
		if (commit.modelsUsed?.some((m) => m.phase === "coding" && m.provider === "deepseek")) {
			currentDay.deepseekCommits++
		}
		byDay.set(day, currentDay)

		const agent = commit.agent || "Unknown"
		const currentAgent = byAgent.get(agent) || {
			agent,
			totalCommits: 0,
			trackedCommits: 0,
			compliantCommits: 0,
			deepseekCommits: 0,
		}
		currentAgent.totalCommits++
		if (commit.workflowCompliance) currentAgent.trackedCommits++
		if (commit.workflowCompliance?.isCompliant) currentAgent.compliantCommits++
		if (commit.modelsUsed?.some((m) => m.phase === "coding" && m.provider === "deepseek")) {
			currentAgent.deepseekCommits++
		}
		byAgent.set(agent, currentAgent)
	}

	return {
		byDay: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
		byAgent: [...byAgent.values()].sort((a, b) => b.totalCommits - a.totalCommits),
	}
}

function buildSourceHealth(commitLog, usageLog) {
	const commits = commitLog?.commits || []
	const usageRecords = usageLog?.records || []
	const latestTrackedCommit = commits
		.filter((c) => c.workflowCompliance)
		.map((c) => normalizeTimestamp(c.timestamp))
		.filter(Boolean)
		.sort((a, b) => b.getTime() - a.getTime())[0]
	const latestUsageRecord = usageRecords
		.map((r) => normalizeTimestamp(r.timestamp))
		.filter(Boolean)
		.sort((a, b) => b.getTime() - a.getTime())[0]

	return {
		commitLogAvailable: Boolean(commitLog),
		usageLogAvailable: Boolean(usageLog),
		commitCount: commits.length,
		usageRecordCount: usageRecords.length,
		lastTrackedCommitAt: latestTrackedCommit?.toISOString() || null,
		lastUsageRecordAt: latestUsageRecord?.toISOString() || null,
	}
}

// ── Route Handlers ────────────────────────────────────────────────────────────

/**
 * GET /api/workflow-compliance/stats
 * Returns overall workflow compliance statistics
 */
async function getStats(req, res) {
	try {
		const [commitLogResult, usageLogResult, taskSummariesResult] = await Promise.all([
			loadJsonDiagnostic(COMMIT_LOG_FILE, { commits: [] }),
			loadJsonDiagnostic(USAGE_LOG_FILE, { records: [] }),
			loadJsonDiagnostic(TASK_SUMMARIES_FILE, { summaries: [] }),
		])
		const commitLog = commitLogResult.data
		const usageLog = usageLogResult.data
		const taskSummaries = taskSummariesResult.data

		const stats = calculateStats(commitLog?.commits, usageLog, taskSummaries?.summaries)
		const { commits: normalizedCommits } = normalizeCommits(commitLog?.commits || [])
		const trends = buildTrendSeries(normalizedCommits)
		const sourceHealth = {
			...buildSourceHealth({ commits: normalizedCommits }, usageLog),
			files: {
				commitLog: summarizeFileDiagnostic(commitLogResult),
				usageLog: summarizeFileDiagnostic(usageLogResult),
				taskSummaries: summarizeFileDiagnostic(taskSummariesResult),
			},
		}

		sendJson(res, 200, {
			success: true,
			data: {
				...stats,
				trends,
				sourceHealth,
			},
		})
	} catch (error) {
		console.error("[workflow-compliance] Error getting stats:", error)
		sendJson(res, 500, {
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
		const query = parseQuery(req.url)
		const { limit = "50", since, deepseekOnly, nonCompliantOnly } = query
		const commitLog = await loadJson(COMMIT_LOG_FILE)

		if (!commitLog?.commits) {
			return sendJson(res, 200, { success: true, data: [] })
		}

		let commits = normalizeCommits(commitLog.commits).commits

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

		sendJson(res, 200, {
			success: true,
			data: commits,
		})
	} catch (error) {
		console.error("[workflow-compliance] Error getting commits:", error)
		sendJson(res, 500, {
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
		const query = parseQuery(req.url)
		const { provider, phase, since, limit = "100" } = query
		const usageLog = await loadJson(USAGE_LOG_FILE)

		if (!usageLog?.records) {
			return sendJson(res, 200, { success: true, data: [] })
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

		sendJson(res, 200, {
			success: true,
			data: records,
		})
	} catch (error) {
		console.error("[workflow-compliance] Error getting usage:", error)
		sendJson(res, 500, {
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
			return sendJson(res, 200, {
				success: true,
				data: { wasUsed: false, count: 0 },
			})
		}

		const matchingRecords = usageLog.records.filter((r) => r.apiKeyLast4 === keyLast4)

		sendJson(res, 200, {
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
		sendJson(res, 500, {
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
		const query = parseQuery(req.url)
		const { since } = query
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

		sendJson(res, 200, {
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
		sendJson(res, 500, {
			success: false,
			error: error.message,
		})
	}
}

/**
 * GET /api/workflow-compliance/learning-health
 * Returns learning layer, lesson quality, sync, and hook verification health.
 */
async function getLearningHealth(req, res) {
	try {
		const [lessonIndex, syncStateResult, configResult] = await Promise.all([
			readJsonlDiagnostic(LESSON_INDEX_FILE),
			loadJsonDiagnostic(SYNC_STATE_FILE, { syncedIds: [] }),
			loadJsonDiagnostic(SUPERROO_CONFIG_FILE, { projects: {} }),
		])
		const lessonsMdAvailable = await fileExists(LESSONS_MD_FILE)
		const retryQueueResult = await loadJsonDiagnostic(RETRY_QUEUE_FILE, [])
		const hookLogAvailable = await fileExists(HOOK_LOG_FILE)
		const hookVerification = await readHookVerificationStatus()
		const globalHookAvailable = await fileExists(GLOBAL_HOOK_FILE)
		const bridgeAvailable = await fileExists(GLOBAL_BRIDGE_CMD)
		const hooksPathResult = await runCommand("git", ["config", "--get", "core.hooksPath"], 3000)
		const hooksPath = hooksPathResult.ok ? hooksPathResult.stdout.trim() : ""
		const blocksGlobalHook = Boolean(hooksPath && !hooksPath.includes(".superroo"))
		const superrooConfig = {
			...(configResult.data?.config || {}),
			...(configResult.data || {}),
			currentProject: configResult.data?.currentProject || configResult.data?.config?.currentProject,
		}
		const syncedIds = new Set(syncStateResult.data?.syncedIds || [])
		const lessons = lessonIndex.records
		const todoRuleCount = lessons.filter((l) => String(l.rule_summary || "").includes("TODO")).length
		const missingReusableRule = lessons.filter((l) => !l.rule_summary || String(l.rule_summary).includes("TODO")).length
		const missingTags = lessons.filter((l) => !Array.isArray(l.tags) || l.tags.length === 0).length
		const missingProject = lessons.filter((l) => !l.project).length
		const syncedCount = lessons.filter((l) => syncedIds.has(l.id)).length
		const lessonCount = lessons.length
		const qualityReady = lessonCount - Math.max(todoRuleCount, missingTags, missingProject)
		const learningScore = lessonCount > 0 ? Math.max(0, Math.round((qualityReady / lessonCount) * 100)) : 0
		const syncCoverage = lessonCount > 0 ? Math.round((syncedCount / lessonCount) * 100) : 0
		const retryQueue = Array.isArray(retryQueueResult.data)
			? retryQueueResult.data
			: retryQueueResult.data?.items || retryQueueResult.data?.queue || []

		sendJson(res, 200, {
			success: true,
			data: {
				centralBrainOnline: configResult.available && !configResult.malformed,
				fallbackEnabled: process.env.SUPERROO_NO_FALLBACK !== "1",
				currentProject: superrooConfig.currentProject || process.env.SUPERROO_PROJECT || path.basename(path.resolve(__dirname, "../../..")),
				knownProjects: Object.keys(superrooConfig.projects || {}).length,
				localFiles: {
					jsonl: { path: LESSON_INDEX_FILE, available: lessonIndex.available, malformedLines: lessonIndex.malformedLines },
					markdown: { path: LESSONS_MD_FILE, available: lessonsMdAvailable },
					syncState: { path: SYNC_STATE_FILE, available: syncStateResult.available, malformed: syncStateResult.malformed },
				},
				lessons: {
					total: lessonCount,
					draft: lessons.filter((l) => l.policy_status === "draft").length,
					promotable: lessons.filter((l) => l.policy_status === "promotable").length,
					standard: lessons.filter((l) => l.policy_status === "standard").length,
					todoRuleCount,
					missingReusableRule,
					missingTags,
					missingProject,
					lowQuality: lessons.filter((l) => Number(l.quality_score || 0) > 0 && Number(l.quality_score) < 0.7).length,
					malformedLines: lessonIndex.malformedLines,
					learningScore,
				},
				sync: {
					syncedCount,
					unsyncedCount: Math.max(lessonCount - syncedCount, 0),
					syncCoverage,
					retryQueueLength: retryQueue.length || 0,
					retryQueueAvailable: retryQueueResult.available,
				},
				hooks: {
					globalHookAvailable,
					bridgeAvailable,
					hookLogAvailable,
					hookLogPath: HOOK_LOG_FILE,
					retryQueuePath: RETRY_QUEUE_FILE,
					coreHooksPath: hooksPath || null,
					blocksGlobalHook,
					lastVerificationStatus: retryQueue.length > 0 ? "queued" : hookVerification.status,
					lastVerificationLines: hookVerification.lastLines,
				},
			},
		})
	} catch (error) {
		console.error("[workflow-compliance] Error getting learning health:", error)
		sendJson(res, 500, { success: false, error: error.message })
	}
}

/**
 * POST /api/workflow-compliance/action
 * Runs safe compliance maintenance actions.
 */
async function runAction(req, res) {
	try {
		const body = await readRequestJson(req)
		const action = String(body.action || "")
		if (action === "retry-sync") {
			const cmd = (await fileExists(SUPERROO_LEARN_CMD)) ? SUPERROO_LEARN_CMD : "superroo-learn"
			const result = await runCommand(cmd, ["retry", "--flush"], 60000)
			return sendJson(res, 200, { success: result.ok, action, output: result.stdout, error: result.error || result.stderr })
		}
		if (action === "verify-hook") {
			const sha = String(body.sha || "") || (await getGitHeadSha())
			if (!sha) return sendJson(res, 400, { success: false, error: "No commit SHA available" })
			const result = await runCommand(VERIFY_HOOK_CMD, ["--sha", sha], 60000)
			const hookVerification = await readHookVerificationStatus()
			return sendJson(res, 200, {
				success: result.ok,
				action,
				sha,
				status: hookVerification.status,
				output: result.stdout,
				error: result.error || result.stderr,
			})
		}
		if (action === "repair-commit-metadata") {
			const result = await repairCommitMetadata()
			return sendJson(res, 200, { success: true, action, ...result })
		}
		return sendJson(res, 400, { success: false, error: `Unknown action: ${action}` })
	} catch (error) {
		console.error("[workflow-compliance] Error running action:", error)
		sendJson(res, 500, { success: false, error: error.message })
	}
}

/**
 * GET /api/workflow-compliance/bridge-health
 * Returns required DeepSeek/Ollama bridge status via the global bridge command.
 */
async function getBridgeHealth(req, res) {
	try {
		const bridgeExists = await fileExists(GLOBAL_BRIDGE_CMD)
		if (!bridgeExists) {
			return sendJson(res, 200, {
				success: true,
				data: { bridgeAvailable: false, deepseek: { status: "missing" }, ollama: { status: "missing" } },
			})
		}
		const [deepseekResult, ollamaResult] = await Promise.all([
			runCommand(GLOBAL_BRIDGE_CMD, ["deepseek", "status"], 10000),
			runCommand(GLOBAL_BRIDGE_CMD, ["ollama", "status"], 10000),
		])
		const deepseek = parseBridgeJson(deepseekResult)
		const ollama = parseBridgeJson(ollamaResult)
		sendJson(res, 200, {
			success: true,
			data: {
				bridgeAvailable: true,
				healthy: deepseek.status === "healthy" && ollama.status === "healthy",
				deepseek,
				ollama,
			},
		})
	} catch (error) {
		console.error("[workflow-compliance] Error getting bridge health:", error)
		sendJson(res, 500, { success: false, error: error.message })
	}
}

// ── Export Route Handlers ─────────────────────────────────────────────────────

module.exports = {
	getStats,
	getCommits,
	getUsage,
	verifyApiKey,
	getDeepSeekStats,
	getLearningHealth,
	getBridgeHealth,
	runAction,
}
