/**
 * Super Roo — Root Cause Classifier.
 *
 * Analyzes incident symptoms and evidence to classify the root cause category.
 * This helps route incidents to the appropriate repair strategy.
 *
 * Features:
 * - Keyword-based pattern matching across 20+ categories
 * - Confidence scoring with ratio-based adjustment
 * - Minimum confidence threshold to avoid false positives
 * - Evidence-aware classification (title, symptom, evidence fields)
 * - Security risk detection and human approval routing
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

/**
 * Minimum confidence threshold for a classification to be accepted.
 * Classifications below this threshold fall back to UNKNOWN.
 * This prevents false positives from weak keyword matches.
 */
export const MIN_CONFIDENCE = 0.3

// Pattern database for root cause classification
export const CLASSIFICATION_PATTERNS: ClassificationPattern[] = [
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
		keywords: ["404", "route", "not found", "endpoint", "cannot get", "cannot post", "handler", "no route"],
		confidence: 0.85,
	},
	{
		category: "FRONTEND_CORS",
		keywords: ["cors", "cross-origin", "access-control", "blocked by policy", "origin"],
		confidence: 0.95,
	},
	{
		category: "WORKER_CRASH",
		keywords: ["pm2", "crash", "restart", "process exited", "fatal", "uncaught exception", "unhandled rejection"],
		confidence: 0.85,
	},
	{
		category: "STALE_DATA",
		keywords: ["stale", "freshness", "cache", "outdated", "last updated", "not updating", "sync"],
		confidence: 0.8,
	},
	{
		category: "TRADING_GATE_BLOCKED",
		keywords: ["trading gate", "gate blocked", "paper trade", "live trading", "risk limit", "position limit"],
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
		keywords: ["test", "assert", "expect", "failed test", "test suite", "coverage", "jasmine", "jest", "vitest"],
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
	// ── New categories (Phase 1) ──────────────────────────────────────────────
	{
		category: "MEMORY_LEAK",
		keywords: [
			"memory leak",
			"heap exhausted",
			"out of memory",
			"heap overflow",
			"allocation failure",
			"gc overhead",
			"memory pressure",
			"heap limit",
		],
		confidence: 0.85,
	},
	{
		category: "RACE_CONDITION",
		keywords: [
			"race condition",
			"concurrent access",
			"deadlock",
			"data race",
			"mutex",
			"lock contention",
			"thread safety",
			"atomicity",
		],
		confidence: 0.8,
	},
	{
		category: "CONFIGURATION_ERROR",
		keywords: [
			"config error",
			"invalid config",
			"misconfiguration",
			"bad config",
			"configuration invalid",
			"malformed config",
			"config validation",
		],
		confidence: 0.85,
	},
	{
		category: "DEPENDENCY_CONFLICT",
		keywords: [
			"dependency conflict",
			"peer dependency",
			"version mismatch",
			"incompatible dependency",
			"module not found",
			"cannot find module",
			"package resolution",
			"npm error",
		],
		confidence: 0.85,
	},
	{
		category: "AUTHENTICATION_FAILURE",
		keywords: [
			"auth failed",
			"unauthorized",
			"forbidden",
			"403",
			"login failed",
			"session expired",
			"invalid credentials",
			"access denied",
		],
		confidence: 0.9,
	},
	{
		category: "NETWORK_TIMEOUT",
		keywords: [
			"timeout",
			"ETIMEDOUT",
			"connection timed out",
			"network error",
			"ECONNRESET",
			"ECONNREFUSED",
			"ENOTFOUND",
			"request timed out",
			"socket hang up",
		],
		confidence: 0.9,
	},
	{
		category: "FILE_SYSTEM_ERROR",
		keywords: [
			"ENOENT",
			"EACCES",
			"permission denied",
			"disk full",
			"no space left",
			"file not found",
			"cannot read file",
			"cannot write file",
			"EEXIST",
		],
		confidence: 0.9,
	},
	{
		category: "DNS_RESOLUTION",
		keywords: [
			"dns",
			"dns resolution",
			"ENOTFOUND",
			"getaddrinfo",
			"dns lookup",
			"hostname resolution",
			"name not resolved",
		],
		confidence: 0.85,
	},
	{
		category: "SSL_TLS_ERROR",
		keywords: [
			"ssl",
			"tls",
			"certificate",
			"self-signed",
			"unable to verify",
			"certificate expired",
			"ssl error",
			"handshake failed",
			"UNABLE_TO_VERIFY_LEAF_SIGNATURE",
		],
		confidence: 0.85,
	},
	{
		category: "CIRCUIT_BREAKER",
		keywords: [
			"circuit breaker",
			"circuit_breaker",
			"too many failures",
			"consecutive failures",
			"backoff",
			"rate limiting self",
			"cooldown period",
			"temporarily disabled",
		],
		confidence: 0.9,
	},
	{
		category: "DEPLOYMENT_FAILURE",
		keywords: [
			"deploy failed",
			"deployment error",
			"build failed",
			"docker build",
			"container exit",
			"image pull",
			"registry auth",
			"deploy timeout",
			"rollback",
			"health check failed",
			"container restart",
		],
		confidence: 0.85,
	},
	{
		category: "DATABASE_CONNECTION",
		keywords: [
			"database connection",
			"db connection",
			"connection pool",
			"max connections",
			"too many connections",
			"connection refused",
			"postgres",
			"supabase",
			"pg pool",
			"database timeout",
			"db timeout",
			"cannot connect to database",
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

	if (bestMatch && bestMatch.confidence >= MIN_CONFIDENCE) {
		return bestMatch
	}

	// Default fallback — either no match or below confidence threshold
	const reason = bestMatch
		? `Best match "${bestMatch.category}" had confidence ${bestMatch.confidence.toFixed(3)} below threshold ${MIN_CONFIDENCE}`
		: "No clear pattern match found"
	return {
		category: "UNKNOWN",
		confidence: bestMatch?.confidence ?? 0.5,
		reasoning: reason,
	}
}

/**
 * Quick classify from raw text (for inline use).
 */
export function classifyFromText(text: string, defaultCategory: RootCauseCategory = "UNKNOWN"): ClassificationResult {
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
		"SSL_TLS_ERROR", // Certificate changes need human review
		"DEPLOYMENT_FAILURE", // Deployment failures need human review
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
		MEMORY_LEAK: [
			"Check heap usage over time",
			"Review object allocation patterns",
			"Look for missing cleanup/dispose calls",
			"Use heap snapshot comparison tools",
		],
		RACE_CONDITION: [
			"Review concurrent access patterns",
			"Check for missing mutex/locks",
			"Verify atomic operations",
			"Add logging around shared state mutations",
		],
		CONFIGURATION_ERROR: [
			"Validate config file format and schema",
			"Check for missing required fields",
			"Verify config against documentation",
			"Review recent config changes",
		],
		DEPENDENCY_CONFLICT: [
			"Check package.json dependency versions",
			"Run npm ls to inspect dependency tree",
			"Look for peer dependency warnings",
			"Verify lockfile consistency",
		],
		AUTHENTICATION_FAILURE: [
			"Check login/session flow",
			"Verify credential storage",
			"Review auth middleware configuration",
			"Check token refresh mechanism",
		],
		NETWORK_TIMEOUT: [
			"Check network connectivity",
			"Verify DNS resolution",
			"Review firewall/security group rules",
			"Check service endpoint availability",
		],
		FILE_SYSTEM_ERROR: [
			"Check file/directory permissions",
			"Verify disk space availability",
			"Review file path construction",
			"Check for race conditions in file operations",
		],
		DNS_RESOLUTION: [
			"Check DNS server configuration",
			"Verify hostname spelling",
			"Test with nslookup or dig",
			"Check /etc/hosts for overrides",
		],
		SSL_TLS_ERROR: [
			"STOP - Do not auto-fix certificate issues",
			"Verify certificate expiry dates",
			"Check certificate chain completeness",
			"Review SSL/TLS library configuration",
		],
		CIRCUIT_BREAKER: [
			"Check consecutive failure count",
			"Review recent error patterns",
			"Verify backoff configuration",
			"Consider manual reset if safe",
		],
		DEPLOYMENT_FAILURE: [
			"STOP - Do not auto-fix deployment failures",
			"Check Docker build logs",
			"Verify container registry access",
			"Review deployment configuration",
			"Check health check endpoint",
		],
		DATABASE_CONNECTION: [
			"Check database service status",
			"Verify connection string and credentials",
			"Review connection pool settings",
			"Check for database maintenance windows",
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
