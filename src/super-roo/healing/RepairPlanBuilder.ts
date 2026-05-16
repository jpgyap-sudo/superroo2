/**
 * Super Roo — Repair Plan Builder.
 *
 * Generates structured repair plans based on incident classification.
 * Each plan includes diagnostic steps, safe patch guidance, and tests to run.
 */

import type {
	IncidentRecord,
	RootCauseCategory,
	BugSeverity,
	RepairPlan,
	TaskPriority,
	ExecutionResult,
} from "../types"
import { classifyRootCause, getDiagnosticSteps, requiresHumanApproval } from "./RootCauseClassifier"

export interface RepairPlanOptions {
	/** Override the root cause category (use classification if not provided) */
	rootCauseCategory?: RootCauseCategory
	/** Additional context to include in the plan */
	context?: Record<string, unknown>
	/** Whether to require explicit approval regardless of category */
	forceApproval?: boolean
}

/**
 * Build a comprehensive repair plan for an incident.
 */
export function buildRepairPlan(incident: IncidentRecord, options: RepairPlanOptions = {}): RepairPlan {
	const classification = options.rootCauseCategory
		? { category: options.rootCauseCategory, confidence: 1, reasoning: "Manual override" }
		: classifyRootCause(incident)

	const category = classification.category
	const affectedFiles = determineAffectedFiles(incident, category)
	const diagnosticSteps = getDiagnosticSteps(category)
	const safePatchPlan = buildSafePatchPlan(category, affectedFiles)
	const testsToRun = determineTestsToRun(category, affectedFiles)

	const needsApproval =
		options.forceApproval ||
		requiresHumanApproval(category) ||
		incident.severity === "critical" ||
		incident.autoFixAllowed === false

	const approvalReason = needsApproval
		? buildApprovalReason(category, incident.severity, incident.autoFixAllowed)
		: undefined

	return {
		incidentId: incident.id,
		featureKey: incident.featureKey,
		severity: incident.severity,
		rootCauseCategory: category,
		affectedFiles,
		diagnosticSteps,
		safePatchPlan,
		testsToRun,
		approvalRequired: needsApproval,
		approvalReason,
		executionStatus: "pending",
	}
}

/**
 * Mark a repair plan as executed with a result.
 */
export function markPlanExecuted(plan: RepairPlan, result: ExecutionResult): RepairPlan {
	return {
		...plan,
		executionStatus: result.success ? "completed" : "failed",
		executedAt: Date.now(),
		executionResult: result,
	}
}

/**
 * Mark a repair plan as in progress.
 */
export function markPlanInProgress(plan: RepairPlan): RepairPlan {
	return {
		...plan,
		executionStatus: "in_progress",
	}
}

/**
 * Mark a repair plan as cancelled.
 */
export function markPlanCancelled(plan: RepairPlan): RepairPlan {
	return {
		...plan,
		executionStatus: "cancelled",
		executedAt: Date.now(),
		executionResult: { success: false, message: "Plan was cancelled" },
	}
}

/**
 * Determine which files are likely affected based on category and evidence.
 */
function determineAffectedFiles(incident: IncidentRecord, category: RootCauseCategory): string[] {
	// Use explicitly listed files if available
	if (incident.affectedFiles.length > 0) {
		return [...incident.affectedFiles]
	}

	// Infer from evidence
	const evidenceFiles: string[] = []
	if (incident.evidence?.stackTrace) {
		const stackFiles = extractFilesFromStackTrace(String(incident.evidence.stackTrace))
		evidenceFiles.push(...stackFiles)
	}

	// Category-specific defaults
	const defaultsByCategory: Record<RootCauseCategory, string[]> = {
		ENV_MISSING: [".env", ".env.example", "src/config/", "lib/config/"],
		DB_SCHEMA_MISMATCH: ["supabase/migrations/", "src/db/", "lib/db/"],
		API_AUTH_FAILURE: ["src/api/", "lib/api/", "src/auth/"],
		API_RATE_LIMIT: ["src/api/", "lib/rate-limit/", "src/middleware/"],
		BROKEN_ROUTE: ["src/routes/", "api/", "src/pages/api/"],
		FRONTEND_CORS: ["src/middleware/", "api/", "next.config.js", "vite.config.ts"],
		WORKER_CRASH: ["workers/", "src/workers/", "pm2.config.js"],
		STALE_DATA: ["src/cache/", "lib/cache/", "src/sync/"],
		TRADING_GATE_BLOCKED: ["src/trading/", "lib/trading/", "src/risk/"],
		DEPLOY_DRIFT: [".github/workflows/", "scripts/deploy/", "ops/"],
		TEST_FAILURE: ["src/", "tests/", "__tests__/"],
		SECURITY_RISK: [], // Don't suggest files for security issues
		MEMORY_LEAK: ["src/", "lib/", "workers/"],
		RACE_CONDITION: ["src/", "lib/", "workers/"],
		CONFIGURATION_ERROR: [".env", "src/config/", "lib/config/"],
		DEPENDENCY_CONFLICT: ["package.json", "package-lock.json", "node_modules/"],
		AUTHENTICATION_FAILURE: ["src/auth/", "lib/auth/", "src/middleware/"],
		NETWORK_TIMEOUT: ["src/api/", "lib/api/", "src/middleware/"],
		FILE_SYSTEM_ERROR: ["src/", "lib/", "scripts/"],
		DNS_RESOLUTION: ["src/api/", "lib/api/", "src/config/"],
		SSL_TLS_ERROR: [], // Don't suggest files for certificate issues
		UNKNOWN: ["src/", "lib/", "api/"],
	}

	const defaults = defaultsByCategory[category] ?? defaultsByCategory.UNKNOWN
	return [...new Set([...evidenceFiles, ...defaults])]
}

/**
 * Build safe patch recommendations based on category.
 */
function buildSafePatchPlan(category: RootCauseCategory, affectedFiles: string[]): string[] {
	const basePlan = [
		`Inspect files: ${affectedFiles.join(", ") || "project root"}`,
		"Reproduce or add a diagnostic test first",
		"Apply the smallest safe patch",
		"Run targeted tests and smoke checks",
		"Update DEBUGGING.md if pattern is reusable",
	]

	const categorySpecific: Record<RootCauseCategory, string[]> = {
		ENV_MISSING: [
			"Add missing environment variable to .env.example",
			"Add dotenv loading in standalone entry points",
			"Fail loudly if required env is missing on startup",
			"Consider env validation schema (zod/env-var)",
		],
		DB_SCHEMA_MISMATCH: [
			"Check Supabase migration columns before changing code",
			"Add startup schema validation if missing",
			"Verify RLS policies match code expectations",
			"Consider adding migration version check",
		],
		API_AUTH_FAILURE: [
			"Check token refresh logic",
			"Verify auth middleware order",
			"Add auth error handling with clear messages",
			"Check token storage (secure cookies vs localStorage)",
		],
		API_RATE_LIMIT: [
			"Add exponential backoff to retry logic",
			"Consider request queuing/batching",
			"Add rate limit monitoring/alerting",
			"Document rate limits in code comments",
		],
		BROKEN_ROUTE: [
			"Check server route discovery logic",
			"Verify handler default exports",
			"Check frontend endpoint paths match backend",
			"Review middleware that might block routes",
		],
		FRONTEND_CORS: [
			"Check CORS origin whitelist",
			"Verify credentials: true if using cookies",
			"Add OPTIONS handler for preflight",
			"Test from actual frontend origin",
		],
		WORKER_CRASH: [
			"Add process.on('unhandledRejection') handler",
			"Add process.on('uncaughtException') handler",
			"Check PM2 memory limits",
			"Add graceful shutdown handling",
		],
		STALE_DATA: [
			"Add cache TTL validation",
			"Implement cache invalidation triggers",
			"Add data freshness monitoring",
			"Consider stale-while-revalidate pattern",
		],
		TRADING_GATE_BLOCKED: [
			"HUMAN APPROVAL REQUIRED",
			"Review trading gate configuration",
			"Verify risk limit calculations",
			"Check paper/live mode toggles",
		],
		DEPLOY_DRIFT: [
			"Check GitHub HEAD vs VPS HEAD",
			"Verify PM2 restart status",
			"Check /api/deploy-status endpoint",
			"Review deployment pipeline logs",
		],
		TEST_FAILURE: [
			"Run test in isolation: npx vitest run <path>",
			"Check for flaky test patterns (timers, async)",
			"Verify test fixtures/mock data",
			"Check if test reflects actual bug vs outdated expectation",
		],
		SECURITY_RISK: [
			"STOP - DO NOT AUTO-FIX",
			"Escalate to security team immediately",
			"Document exposure scope and timeline",
			"Prepare formal incident report",
		],
		MEMORY_LEAK: [
			"Add heap snapshot before/after comparison",
			"Review object lifecycle and disposal patterns",
			"Check for event listener leaks",
			"Consider WeakRef for cache-like structures",
		],
		RACE_CONDITION: [
			"Add mutex/lock around shared state",
			"Review async operation ordering",
			"Consider using atomic operations",
			"Add integration tests for concurrent scenarios",
		],
		CONFIGURATION_ERROR: [
			"Add config schema validation",
			"Provide clear error messages for invalid config",
			"Add config migration path for breaking changes",
			"Consider config health check on startup",
		],
		DEPENDENCY_CONFLICT: [
			"Run npm dedupe to flatten dependencies",
			"Check for peer dependency mismatches",
			"Consider using overrides/resolutions in package.json",
			"Verify lockfile is up to date",
		],
		AUTHENTICATION_FAILURE: [
			"Check session/cookie configuration",
			"Verify credential storage mechanism",
			"Review auth middleware chain order",
			"Add auth failure logging with context",
		],
		NETWORK_TIMEOUT: [
			"Add retry with exponential backoff",
			"Implement circuit breaker pattern",
			"Review timeout configuration values",
			"Add connectivity health checks",
		],
		FILE_SYSTEM_ERROR: [
			"Add file existence checks before operations",
			"Implement proper error handling for file ops",
			"Use temp files for atomic writes",
			"Add disk space monitoring",
		],
		DNS_RESOLUTION: [
			"Verify DNS server configuration",
			"Add DNS caching layer",
			"Consider using IP as fallback",
			"Add DNS resolution health checks",
		],
		SSL_TLS_ERROR: [
			"HUMAN APPROVAL REQUIRED",
			"Verify certificate chain and expiry",
			"Check SSL/TLS library configuration",
			"Review certificate pinning logic",
		],
		UNKNOWN: [
			"Gather more diagnostic data",
			"Check related logs and metrics",
			"Consider manual code review",
			"Add temporary debug logging",
		],
	}

	return [...basePlan, "", "Category-specific guidance:", ...(categorySpecific[category] ?? categorySpecific.UNKNOWN)]
}

/**
 * Determine which tests should be run based on category and files.
 */
function determineTestsToRun(category: RootCauseCategory, affectedFiles: string[]): string[] {
	const baseTests = ["npx vitest run --reporter=verbose"]

	if (affectedFiles.some((f) => f.includes("api/") || f.includes("routes/"))) {
		baseTests.push("npm run test:api")
	}

	if (affectedFiles.some((f) => f.includes("db/") || f.includes("supabase/"))) {
		baseTests.push("npm run test:db")
	}

	if (category === "TEST_FAILURE") {
		baseTests.unshift("Run failing test first, then full suite")
	}

	if (category === "WORKER_CRASH") {
		baseTests.push("pm2 logs check")
	}

	return baseTests
}

/**
 * Build human-readable approval reason.
 */
function buildApprovalReason(category: RootCauseCategory, severity: BugSeverity, autoFixAllowed: boolean): string {
	if (category === "SECURITY_RISK") {
		return "Security risk detected - requires security team review"
	}

	if (category === "TRADING_GATE_BLOCKED") {
		return "Trading/risk configuration change - requires explicit approval"
	}

	if (severity === "critical") {
		return "Critical severity - manual verification required"
	}

	if (autoFixAllowed === false) {
		return "Auto-fix explicitly disabled for this incident"
	}

	return "Category requires human approval per policy"
}

/**
 * Convert severity to task priority.
 */
export function severityToPriority(severity: BugSeverity): TaskPriority {
	return (
		{
			critical: "critical",
			high: "high",
			medium: "normal",
			low: "low",
		} as const
	)[severity]
}

/**
 * Extract file paths from a stack trace.
 */
function extractFilesFromStackTrace(stackTrace: string): string[] {
	const filePattern = /(?:at\s+.*?\s+)?\(?(?:file:\/\/\/|)?([^\s():]+\.(?:ts|js|tsx|jsx))\)?/g
	const files: string[] = []
	let match

	while ((match = filePattern.exec(stackTrace)) !== null) {
		if (match[1] && !match[1].includes("node_modules")) {
			files.push(match[1])
		}
	}

	return [...new Set(files)]
}

/**
 * Generate a human-readable summary of the repair plan.
 */
export function summarizeRepairPlan(plan: RepairPlan): string {
	const lines = [
		`Repair Plan for Incident ${plan.incidentId}`,
		`Category: ${plan.rootCauseCategory}`,
		`Severity: ${plan.severity}`,
		`Approval Required: ${plan.approvalRequired ? "YES" : "No"}`,
		"",
		"Affected Files:",
		...plan.affectedFiles.map((f) => `  - ${f}`),
		"",
		"Diagnostic Steps:",
		...plan.diagnosticSteps.map((s) => `  1. ${s}`),
		"",
		"Tests to Run:",
		...plan.testsToRun.map((t) => `  - ${t}`),
	]

	if (plan.approvalReason) {
		lines.push("", `Approval Reason: ${plan.approvalReason}`)
	}

	return lines.join("\n")
}
