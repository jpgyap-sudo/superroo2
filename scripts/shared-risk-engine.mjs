import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import crypto from "node:crypto"

const DEFAULT_HOME = process.env.SUPERROO_HOME || path.join(os.homedir(), ".superroo")
const DEFAULT_RISK_DIR = process.env.SUPERROO_RISK_DIR || path.join(DEFAULT_HOME, "memory", "predictive-risk")
const ASSESSMENTS_PATH = path.join(DEFAULT_RISK_DIR, "assessments.jsonl")
const PATTERNS_PATH = path.join(DEFAULT_RISK_DIR, "patterns.jsonl")

const ACTION_BASE_RISKS = Object.freeze({
	code: 0.08,
	test: 0.04,
	docs: 0.02,
	config_change: 0.15,
	large_refactor: 0.3,
	db_migration: 0.25,
	docker_build: 0.15,
	deploy: 0.2,
	delete: 0.7,
	restart: 0.1,
})

const SENSITIVE_FILE_PATTERNS = [
	{ pattern: /docker|compose|Dockerfile/i, risk: 0.2, reason: "Docker or compose files changed" },
	{ pattern: /auth|secret|credential|token|password|session/i, risk: 0.25, reason: "Auth or secret-related files changed" },
	{ pattern: /(^|[/\\])\.?env(\.|$)|environment/i, risk: 0.15, reason: "Environment configuration changed" },
	{ pattern: /payment|billing|stripe|checkout|invoice/i, risk: 0.3, reason: "Payment or billing files changed" },
	{ pattern: /migration|schema|migrate|database|sql/i, risk: 0.2, reason: "Database schema or migration files changed" },
	{ pattern: /deploy|release|ci|cd|pipeline|workflow/i, risk: 0.15, reason: "Deployment or CI files changed" },
	{ pattern: /settings|config|configuration/i, risk: 0.1, reason: "Configuration files changed" },
	{ pattern: /api|route|endpoint|controller|server/i, risk: 0.1, reason: "API or server files changed" },
	{ pattern: /admin|sudo|root|privilege|permission/i, risk: 0.2, reason: "Privilege-related files changed" },
	{ pattern: /package\.json|pnpm-lock|package-lock|yarn\.lock/i, risk: 0.12, reason: "Dependency graph changed" },
]

const FAILURE_LOG_KEYWORDS = [
	{ pattern: /timeout|timed?\s*out/i, risk: 0.2, reason: "Logs mention timeout" },
	{ pattern: /out\s*of\s*memory|oom|memory\s*exhausted/i, risk: 0.25, reason: "Logs mention memory exhaustion" },
	{ pattern: /failed|failure|error\s*occurred/i, risk: 0.15, reason: "Logs mention failure" },
	{ pattern: /exception|uncaught|unhandled/i, risk: 0.2, reason: "Logs mention unhandled exception" },
	{ pattern: /permission\s*denied|access\s*denied|forbidden|unauthorized|401|403/i, risk: 0.2, reason: "Logs mention authorization failure" },
	{ pattern: /crash|segfault|abort|panic/i, risk: 0.3, reason: "Logs mention crash" },
	{ pattern: /disk\s*full|no\s*space|quota\s*exceeded/i, risk: 0.2, reason: "Logs mention disk space pressure" },
	{ pattern: /connection\s*refused|econnrefused|cannot\s*connect/i, risk: 0.15, reason: "Logs mention connection failure" },
	{ pattern: /rate\s*limit|too\s*many\s*requests|429/i, risk: 0.1, reason: "Logs mention rate limiting" },
]

const DANGEROUS_COMMANDS = [
	{ pattern: /\brm\s+-rf\s+(\/|~|\$HOME)\b/i, risk: 0.6, reason: "Dangerous recursive delete target" },
	{ pattern: /\bmkfs\b|\bdd\s+if=/i, risk: 0.7, reason: "Disk destructive command" },
	{ pattern: /\bchmod\s+-R\s+777\b/i, risk: 0.35, reason: "Recursive world-writable permissions" },
	{ pattern: /\bnpm\s+publish\b|\bpnpm\s+publish\b/i, risk: 0.35, reason: "Package publishing command" },
	{ pattern: /\bshutdown\b|\breboot\b/i, risk: 0.3, reason: "Host restart or shutdown command" },
]

function ensureDir() {
	fs.mkdirSync(DEFAULT_RISK_DIR, { recursive: true })
}

function readJsonl(file) {
	if (!fs.existsSync(file)) return []
	return fs.readFileSync(file, "utf8")
		.split(/\r?\n/)
		.filter(Boolean)
		.map((line) => {
			try { return JSON.parse(line) } catch { return null }
		})
		.filter(Boolean)
}

function appendJsonl(file, entry) {
	ensureDir()
	fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, "utf8")
}

function clampScore(value) {
	return Math.max(0, Math.min(1, Number(value) || 0))
}

function inferActionType(input) {
	if (input.actionType && ACTION_BASE_RISKS[input.actionType] !== undefined) return input.actionType
	const text = `${input.task || ""}\n${input.prompt || ""}`.toLowerCase()
	if (/\bdeploy|release|ship\b/.test(text)) return "deploy"
	if (/\bmigration|schema|database|sql\b/.test(text)) return "db_migration"
	if (/\bdocker|compose|container\b/.test(text)) return "docker_build"
	if (/\bdelete|remove\b/.test(text)) return "delete"
	if (/\brefactor|rewrite|redesign\b/.test(text)) return "large_refactor"
	if (/\bconfig|settings|env\b/.test(text)) return "config_change"
	if (/\btest|spec\b/.test(text)) return "test"
	if (/\bdoc|readme|comment\b/.test(text)) return "docs"
	return "code"
}

function normalizeFiles(input) {
	if (Array.isArray(input.filesChanged)) return input.filesChanged.filter(Boolean)
	if (Array.isArray(input.files)) return input.files.filter(Boolean)
	const text = `${input.task || ""}\n${input.prompt || ""}\n${input.context || ""}`
	return [...new Set((text.match(/[A-Za-z0-9_.:/\\-]+\.(?:ts|tsx|js|jsx|mjs|json|md|yml|yaml|sql|env|toml|ps1|sh|Dockerfile)/g) || []))]
}

function scoreLevel(score) {
	if (score >= 0.9) return "critical"
	if (score >= 0.75) return "high"
	if (score >= 0.4) return "medium"
	return "low"
}

function routeHint(level) {
	if (level === "critical" || level === "high") return "code_pro_verified"
	if (level === "medium") return "code_pro"
	return "code"
}

function dedupeReasons(reasons) {
	return [...new Set(reasons)]
}

function loadPatterns(projectId) {
	return readJsonl(PATTERNS_PATH)
		.filter((pattern) => !projectId || !pattern.projectId || pattern.projectId === projectId)
		.sort((a, b) => (b.occurrences || 1) - (a.occurrences || 1))
		.slice(0, 100)
}

function scoreHistoricalPatterns({ haystack, projectId, reasons }) {
	let score = 0
	const matchedPatterns = []
	for (const pattern of loadPatterns(projectId)) {
		const signature = String(pattern.signature || "").toLowerCase()
		if (!signature || !haystack.includes(signature)) continue
		const risk = pattern.severity === "critical" ? 0.35
			: pattern.severity === "high" ? 0.25
				: pattern.severity === "medium" ? 0.15
					: 0.05
		score += risk
		reasons.push(`Matched historical pattern: ${pattern.description || signature}`)
		matchedPatterns.push(pattern)
	}
	return { score, matchedPatterns }
}

export function assessRisk(input = {}) {
	const actionType = inferActionType(input)
	const projectId = input.projectId || input.project || "default"
	const task = input.task || input.prompt || ""
	const logs = input.logs || ""
	const filesChanged = normalizeFiles(input)
	const commands = Array.isArray(input.commands) ? input.commands : []
	const context = input.context || ""
	const text = `${task}\n${context}\n${logs}\n${filesChanged.join("\n")}\n${commands.join("\n")}`
	const haystack = text.toLowerCase()
	const reasons = []
	let score = ACTION_BASE_RISKS[actionType] ?? ACTION_BASE_RISKS.code
	reasons.push(`Action type "${actionType}" base risk ${score}`)

	for (const filePattern of SENSITIVE_FILE_PATTERNS) {
		if (filePattern.pattern.test(filesChanged.join("\n"))) {
			score += filePattern.risk
			reasons.push(filePattern.reason)
		}
	}

	for (const logPattern of FAILURE_LOG_KEYWORDS) {
		if (logs && logPattern.pattern.test(logs)) {
			score += logPattern.risk
			reasons.push(logPattern.reason)
		}
	}

	for (const commandPattern of DANGEROUS_COMMANDS) {
		if (commandPattern.pattern.test(commands.join("\n"))) {
			score += commandPattern.risk
			reasons.push(commandPattern.reason)
		}
	}

	if (filesChanged.length > 8) {
		score += 0.12
		reasons.push("Large file blast radius")
	} else if (filesChanged.length > 3) {
		score += 0.06
		reasons.push("Moderate file blast radius")
	}

	const hasTestSignal = filesChanged.some((file) => /test|spec|__tests__/i.test(file)) || /\b(test|spec|verify|vitest|jest|pytest|pnpm test|npm test)\b/i.test(text)
	if (!hasTestSignal && ["large_refactor", "db_migration", "deploy", "config_change"].includes(actionType)) {
		score += 0.12
		reasons.push("No verification or test signal for risky action")
	}

	if (/\bproduction|customer|payment|auth|security|credential|secret\b/i.test(text)) {
		score += 0.12
		reasons.push("Production, security, or customer-impacting language")
	}

	const historical = scoreHistoricalPatterns({ haystack, projectId, reasons })
	score += historical.score

	score = clampScore(score)
	const riskLevel = scoreLevel(score)
	const recommendation = riskLevel === "critical"
		? "Block automatic execution; require human approval and rollback plan."
		: riskLevel === "high"
			? "Use verified coder, run targeted tests, and require review before merge/deploy."
			: riskLevel === "medium"
				? "Use pro coder and run focused verification."
				: "Fast path is acceptable; keep normal verification."

	const assessment = {
		id: crypto.randomUUID(),
		projectId,
		taskId: input.taskId || null,
		actionType,
		riskScore: score,
		riskLevel,
		routeHint: routeHint(riskLevel),
		reasons: dedupeReasons(reasons),
		filesChanged,
		matchedPatterns: historical.matchedPatterns,
		recommendation,
		source: input.source || "shared-risk-engine",
		createdAt: new Date().toISOString(),
	}

	if (input.persist !== false) appendJsonl(ASSESSMENTS_PATH, assessment)
	return assessment
}

export function recordRiskPattern(input = {}) {
	if (!input.signature || !input.description) {
		throw new Error("recordRiskPattern requires signature and description")
	}
	const entry = {
		id: crypto.randomUUID(),
		projectId: input.projectId || input.project || "default",
		patternType: input.patternType || "failure",
		signature: String(input.signature).toLowerCase(),
		description: input.description,
		severity: input.severity || "medium",
		suggestedFix: input.suggestedFix || null,
		source: input.source || "manual",
		occurrences: Number(input.occurrences || 1),
		createdAt: new Date().toISOString(),
	}
	appendJsonl(PATTERNS_PATH, entry)
	return entry
}

export function riskStats(projectId = null) {
	const assessments = readJsonl(ASSESSMENTS_PATH).filter((entry) => !projectId || entry.projectId === projectId)
	const patterns = readJsonl(PATTERNS_PATH).filter((entry) => !projectId || entry.projectId === projectId)
	const byLevel = { critical: 0, high: 0, medium: 0, low: 0 }
	const byActionType = {}
	for (const assessment of assessments) {
		byLevel[assessment.riskLevel] = (byLevel[assessment.riskLevel] || 0) + 1
		byActionType[assessment.actionType] = (byActionType[assessment.actionType] || 0) + 1
	}
	const maxRiskScore = assessments.reduce((max, item) => Math.max(max, item.riskScore || 0), 0)
	const avgRiskScore = assessments.length
		? assessments.reduce((sum, item) => sum + (item.riskScore || 0), 0) / assessments.length
		: 0
	return {
		totalAssessments: assessments.length,
		totalPatterns: patterns.length,
		byLevel,
		byActionType,
		avgRiskScore: Number(avgRiskScore.toFixed(3)),
		maxRiskScore: Number(maxRiskScore.toFixed(3)),
		store: DEFAULT_RISK_DIR,
	}
}

export function formatRiskAssessment(assessment) {
	return [
		`Risk: ${assessment.riskLevel} (${assessment.riskScore.toFixed(2)})`,
		`Route hint: ${assessment.routeHint}`,
		`Action: ${assessment.actionType}`,
		`Recommendation: ${assessment.recommendation}`,
		"",
		"Reasons:",
		...assessment.reasons.map((reason) => `- ${reason}`),
		assessment.filesChanged.length ? `\nFiles:\n${assessment.filesChanged.map((file) => `- ${file}`).join("\n")}` : "",
	].filter(Boolean).join("\n")
}

