/**
 * Super Roo — Root Cause Classifier.
 *
 * Analyzes incident symptoms and evidence to classify the root cause category.
 * This helps route incidents to the appropriate repair strategy.
 */

import type { RootCauseCategory, IncidentRecord } from "../types"

export interface ClassificationResult {
	category: RootCauseCategory
	confidence: number // 0-1
	reasoning: string
}

export interface ClassificationPattern {
	category: RootCauseCategory
	keywords: string[]
	confidence: number
}

// Pattern database for root cause classification
const CLASSIFICATION_PATTERNS: ClassificationPattern[] = [
	{
		category: "ENV_MISSING",
		keywords: [
			"env",
			"environment",
			"supabase_url",
			"api key",
			"api_key",
			"missing env",
			"process.env",
			"undefined variable",
			"config not found",
		],
		confidence: 0.85,
	},
	{
		category: "DB_SCHEMA_MISMATCH",
		keywords: [
			"schema",
			"column",
			"relation",
			"rls",
			"row level security",
			"table does not exist",
			"constraint",
			"foreign key",
			"migration",
			"sql error",
		],
		confidence: 0.9,
	},
	{
		category: "API_AUTH_FAILURE",
		keywords: [
			"401",
			"unauthorized",
			"auth",
			"authentication",
			"token expired",
			"invalid token",
			"not authenticated",
			"permission denied",
		],
		confidence: 0.9,
	},
	{
		category: "API_RATE_LIMIT",
		keywords: ["429", "rate limit", "too many requests", "throttle", "quota exceeded", "limit exceeded"],
		confidence: 0.95,
	},
	{
		category: "BROKEN_ROUTE",
		keywords: [
			"404",
			"route",
			"not found",
			"endpoint",
			"cannot get",
			"cannot post",
			"handler",
			"no route",
		],
		confidence: 0.85,
	},
	{
		category: "FRONTEND_CORS",
		keywords: ["cors", "cross-origin", "access-control", "blocked by policy", "origin"],
		confidence: 0.95,
	},
	{
		category: "WORKER_CRASH",
		keywords: [
			"pm2",
			"crash",
			"restart",
			"process exited",
			"fatal",
			"uncaught exception",
			"unhandled rejection",
		],
		confidence: 0.85,
	},
	{
		category: "STALE_DATA",
		keywords: [
			"stale",
			"freshness",
			"cache",
			"outdated",
			"last updated",
			"not updating",
			"sync",
		],
		confidence: 0.8,
	},
	{
		category: "TRADING_GATE_BLOCKED",
		keywords: [
			"trading gate",
			"gate blocked",
			"paper trade",
			"live trading",
			"risk limit",
			"position limit",
		],
		confidence: 0.85,
	},
	{
		category: "DEPLOY_DRIFT",
		keywords: [
			"deploy",
			"commit",
			"version mismatch",
			"out of sync",
			"vps",
			"github",
			"head mismatch",
			"not deployed",
		],
		confidence: 0.8,
	},
	{
		category: "TEST_FAILURE",
		keywords: [
			"test",
			"assert",
			"expect",
			"failed test",
			"test suite",
			"coverage",
			"jasmine",
			"jest",
			"vitest",
		],
		confidence: 0.9,
	},
	{
		category: "SECURITY_RISK",
		keywords: [
			"secret",
			"private key",
			"exposed",
			"leak",
			"credential",
			"password",
			"token exposed",
			"live trading",
			"production risk",
		],
		confidence: 0.9,
	},
]

/**
 * Classify an incident based on its title, symptom, and evidence.
 */
export function classifyRootCause(incident: IncidentRecord): ClassificationResult {
	const text = buildClassificationText(incident)
	const textLower = text.toLowerCase()

	let bestMatch: ClassificationResult | null = null

	for (const pattern of CLASSIFICATION_PATTERNS) {
		const matches = pattern.keywords.filter((kw) => textLower.includes(kw.toLowerCase()))

		if (matches.length > 0) {
			const matchRatio = matches.length / pattern.keywords.length
			const confidence = pattern.confidence * (0.5 + 0.5 * matchRatio)

			if (!bestMatch || confidence > bestMatch.confidence) {
				bestMatch = {
					category: pattern.category,
					confidence,
					reasoning: `Matched keywords: ${matches.join(", ")}`,
				}
			}
		}
	}

	if (bestMatch) {
		return bestMatch
	}

	// Default fallback
	return {
		category: "UNKNOWN",
		confidence: 0.5,
		reasoning: "No clear pattern match found",
	}
}

/**
 * Quick classify from raw text (for inline use).
 */
export function classifyFromText(
	text: string,
	defaultCategory: RootCauseCategory = "UNKNOWN",
): ClassificationResult {
	const mockIncident: IncidentRecord = {
		id: "temp",
		fingerprint: "temp",
		featureKey: null,
		sourceAgent: "unknown",
		title: text,
		symptom: text,
		severity: "medium",
		status: "new",
		rootCauseCategory: null,
		affectedFiles: [],
		recommendedAction: null,
		evidence: {},
		autoFixAllowed: false,
		fixAttempts: 0,
		createdAt: Date.now(),
		updatedAt: Date.now(),
	}

	const result = classifyRootCause(mockIncident)
	if (result.category === "UNKNOWN") {
		result.category = defaultCategory
	}
	return result
}

/**
 * Check if a category represents a security risk.
 */
export function isSecurityRisk(category: RootCauseCategory): boolean {
	return category === "SECURITY_RISK"
}

/**
 * Check if auto-fix should be blocked for this category.
 */
export function requiresHumanApproval(category: RootCauseCategory): boolean {
	const requiresApproval: RootCauseCategory[] = [
		"SECURITY_RISK",
		"TRADING_GATE_BLOCKED",
		"DEPLOY_DRIFT", // May need deploy coordination
	]
	return requiresApproval.includes(category)
}

/**
 * Get recommended diagnostic steps based on category.
 */
export function getDiagnosticSteps(category: RootCauseCategory): string[] {
	const stepsByCategory: Record<RootCauseCategory, string[]> = {
		ENV_MISSING: [
			"Check .env file and environment variables",
			"Verify all required env vars are defined",
			"Check dotenv loading in entry points",
			"Validate env var names match code references",
		],
		DB_SCHEMA_MISMATCH: [
			"Check Supabase migration status",
			"Verify table/column existence",
			"Check RLS policy configuration",
			"Compare local schema with production",
		],
		API_AUTH_FAILURE: [
			"Check API token validity",
			"Verify authentication headers",
			"Check token expiration",
			"Validate API key permissions",
		],
		API_RATE_LIMIT: [
			"Check rate limit headers in response",
			"Review request frequency",
			"Implement exponential backoff",
			"Consider request batching",
		],
		BROKEN_ROUTE: [
			"Check server route registration",
			"Verify handler exports",
			"Check frontend endpoint paths",
			"Review middleware stack",
		],
		FRONTEND_CORS: [
			"Check CORS configuration on server",
			"Verify allowed origins",
			"Check preflight handling",
			"Review credentials mode",
		],
		WORKER_CRASH: [
			"Check PM2 logs for stack trace",
			"Review memory usage patterns",
			"Check for unhandled exceptions",
			"Verify worker environment setup",
		],
		STALE_DATA: [
			"Check cache TTL settings",
			"Verify data sync mechanisms",
			"Review update triggers",
			"Check database replication lag",
		],
		TRADING_GATE_BLOCKED: [
			"Check trading gate configuration",
			"Verify risk limits",
			"Review paper/live mode settings",
			"Check position sizing rules",
		],
		DEPLOY_DRIFT: [
			"Compare GitHub HEAD with VPS commit",
			"Check PM2 process status",
			"Verify deployment pipeline health",
			"Review CI/CD logs",
		],
		TEST_FAILURE: [
			"Run failing test in isolation",
			"Check test assertions",
			"Review recent code changes",
			"Verify test environment setup",
		],
		SECURITY_RISK: [
			"STOP - Do not auto-fix",
			"Escalate to security team",
			"Document exposure scope",
			"Prepare incident report",
		],
		UNKNOWN: [
			"Review application logs",
			"Check system health metrics",
			"Gather more diagnostic data",
			"Consider manual investigation",
		],
	}

	return stepsByCategory[category] ?? stepsByCategory.UNKNOWN
}

function buildClassificationText(incident: IncidentRecord): string {
	const parts = [incident.title, incident.symptom]

	if (incident.evidence) {
		parts.push(JSON.stringify(incident.evidence))
	}

	return parts.join(" ")
}
