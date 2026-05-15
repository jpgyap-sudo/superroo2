/**
 * Generic API Rate Limiter
 *
 * Per-IP and per-endpoint rate limiting for all HTTP API endpoints.
 * Prevents abuse by limiting the number of requests within a sliding time window.
 *
 * Features:
 * - Per-IP sliding window rate limiting
 * - Per-endpoint granular limits (read vs write operations)
 * - Automatic cleanup of stale entries
 * - Burst allowance for legitimate use cases
 * - Warning headers in response
 * - IP-based tracking with X-Forwarded-For support
 *
 * Usage:
 *   const rateLimiter = require("./rateLimiter")
 *   const result = rateLimiter.check("192.168.1.1", "/api/jobs")
 *   if (!result.allowed) { res.writeHead(429); ... }
 *
 * @module rateLimiter
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** @type {{ read: { windowMs: number, maxRequests: number }, write: { windowMs: number, maxRequests: number }, auth: { windowMs: number, maxRequests: number }, heavy: { windowMs: number, maxRequests: number }, ws: { windowMs: number, maxRequests: number }, [key: string]: { windowMs: number, maxRequests: number } }} */
const DEFAULTS = {
	// Read endpoints: 60 per minute per IP (GET /health, /system, /logs, etc.)
	read: { windowMs: 60_000, maxRequests: 60 },
	// Write endpoints: 20 per minute per IP (POST /api/*, PUT, DELETE)
	write: { windowMs: 60_000, maxRequests: 20 },
	// Auth endpoints: 5 per minute per IP (login, token refresh)
	auth: { windowMs: 60_000, maxRequests: 5 },
	// Heavy operations: 10 per minute per IP (vision analyze, orchestrate)
	heavy: { windowMs: 60_000, maxRequests: 10 },
	// WebSocket connections: 5 per minute per IP
	ws: { windowMs: 60_000, maxRequests: 5 },
}

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000 // Clean stale entries every 5 minutes
const STALE_THRESHOLD_MS = 10 * 60 * 1000 // Entries older than 10 minutes are stale

// ---------------------------------------------------------------------------
// Route → Tier Mapping
// ---------------------------------------------------------------------------

const ROUTE_TIERS = new Map([
	// Read endpoints
	["/health", "read"],
	["/system", "read"],
	["/docker/status", "read"],
	["/logs", "read"],
	["/queue/stats", "read"],
	["/jobs/summary", "read"],
	["/jobs", "read"],
	["/providers", "read"],
	["/models", "read"],
	["/settings", "read"],
	["/secrets", "read"],
	["/guardrails", "read"],
	["/approval/history", "read"],
	["/orchestrator/status", "read"],
	["/memory/stats", "read"],
	["/deployments", "read"],
	["/deploy/status", "read"],
	["/telegram/stats", "read"],
	["/telegram/status", "read"],
	["/telegram/logs", "read"],
	["/telegram/learn", "read"],
	["/telegram/patterns", "read"],
	["/telegram/conversations", "read"],
	["/telegram/preferences", "read"],
	["/telegram/frustration", "read"],
	["/telegram/response-quality", "read"],
	["/telegram/intent-accuracy", "read"],
	["/telegram/intent-counts", "read"],
	["/telegram/user-tasks", "read"],
	["/telegram/chat-sessions", "read"],
	["/workspace/files", "read"],
	["/workspace/status", "read"],
	["/workspace/recent", "read"],
	["/git/status", "read"],
	["/git/branches", "read"],
	["/git/log", "read"],
	["/git/diff", "read"],
	["/agent-runtime/agents", "read"],
	["/monitoring/metrics", "read"],
	["/monitoring/alerts", "read"],
	["/healing/incidents", "read"],
	["/healing/metrics", "read"],
	["/lsp/status", "read"],
	["/autonomous/status", "read"],
	["/commissioning/status", "read"],

	// Write endpoints
	["/settings", "write"],
	["/secrets", "write"],
	["/providers", "write"],
	["/guardrails", "write"],
	["/approval", "write"],
	["/approval/respond", "write"],
	["/jobs/create", "write"],
	["/jobs/cancel", "write"],
	["/jobs/retry", "write"],
	["/workspace/open", "write"],
	["/workspace/file", "write"],
	["/workspace/file/save", "write"],
	["/workspace/file/create", "write"],
	["/workspace/import/github", "write"],
	["/terminal/command", "write"],
	["/git/commit", "write"],
	["/git/push", "write"],
	["/git/pull", "write"],
	["/git/branch", "write"],
	["/git/pr", "write"],
	["/deploy", "write"],
	["/deploy/rollback", "write"],
	["/deploy/trigger", "write"],
	["/telegram/send", "write"],
	["/telegram/broadcast", "write"],
	["/telegram/learn/reset", "write"],
	["/telegram/preferences", "write"],
	["/orchestrator/submit", "write"],
	["/orchestrator/cancel", "write"],
	["/autonomous/start", "write"],
	["/autonomous/stop", "write"],
	["/commissioning/start", "write"],
	["/commissioning/stop", "write"],
	["/agent-runtime/execute", "write"],
	["/monitoring/alert", "write"],
	["/healing/trigger", "write"],
	["/lsp/restart", "write"],

	// Auth endpoints
	["/auth/login", "auth"],
	["/auth/register", "auth"],
	["/auth/refresh", "auth"],
	["/auth/verify", "auth"],
	["/auth/logout", "auth"],

	// Heavy operations
	["/vision/analyze", "heavy"],
	["/orchestrate", "heavy"],
	["/search", "heavy"],
	["/search/workspace", "heavy"],
	["/brain/analyze", "heavy"],
	["/brain/suggest", "heavy"],
	["/ml/train", "heavy"],
	["/ml/predict", "heavy"],
])

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// Map<ip, Map<tier, number[]>>
// Stores timestamps of recent requests for each (ip, tier) pair
const windows = new Map()

// ---------------------------------------------------------------------------
// Rate Limit Check
// ---------------------------------------------------------------------------

/**
 * Determine the rate limit tier for a given URL and HTTP method.
 * @param {string} url - Normalized URL path
 * @param {string} method - HTTP method (GET, POST, PUT, DELETE, etc.)
 * @returns {string} - Tier name ("read", "write", "auth", "heavy")
 */
function resolveTier(url, method) {
	// Check explicit route mapping first
	if (ROUTE_TIERS.has(url)) {
		return /** @type {string} */ (ROUTE_TIERS.get(url))
	}

	// Fallback: infer from HTTP method
	if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
		return "read"
	}
	if (url.startsWith("/auth/")) {
		return "auth"
	}
	return "write"
}

/**
 * Extract client IP from request, respecting X-Forwarded-For.
 * @param {any} req - HTTP request object (duck-typed, may be mock in tests)
 * @returns {string}
 */
function getClientIp(req) {
	const forwarded = /** @type {string|undefined} */ (req.headers?.["x-forwarded-for"])
	if (forwarded) {
		const ips = forwarded.split(",").map((s) => s.trim())
		return ips[0]
	}
	return req.socket?.remoteAddress || "127.0.0.1"
}

/**
 * Check if a request is allowed under the rate limit.
 * @param {string} ip - Client IP address
 * @param {string} tier - Rate limit tier ("read", "write", "auth", "heavy")
 * @param {{ windowMs?: number, maxRequests?: number }} [options] - Optional override settings
 * @returns {{ allowed: boolean, remaining: number, resetMs: number }}
 */
function check(ip, tier, options) {
	const config = options || DEFAULTS[tier] || DEFAULTS.read
	const windowMs = config.windowMs ?? 60_000
	const maxRequests = config.maxRequests ?? 60

	if (!windows.has(ip)) {
		windows.set(ip, new Map())
	}

	const ipWindows = windows.get(ip)
	const now = Date.now()

	if (!ipWindows.has(tier)) {
		ipWindows.set(tier, [])
	}

	const timestamps = ipWindows.get(tier)

	// Remove timestamps outside the window
	const cutoff = now - windowMs
	while (timestamps.length > 0 && timestamps[0] < cutoff) {
		timestamps.shift()
	}

	const allowed = timestamps.length < maxRequests
	const remaining = Math.max(0, maxRequests - timestamps.length)
	const resetMs = timestamps.length > 0 ? windowMs - (now - timestamps[0]) : 0

	if (allowed) {
		timestamps.push(now)
	}

	return { allowed, remaining, resetMs }
}

/**
 * Middleware-style check for HTTP requests.
 * @param {any} req - HTTP request object (duck-typed, may have _normalizedUrl)
 * @param {import("http").ServerResponse} res - HTTP response object
 * @param {{ windowMs?: number, maxRequests?: number }} [options] - Optional override settings
 * @returns {boolean} - true if allowed, false if rate limited (response sent)
 */
function checkRequest(req, res, options) {
	const ip = getClientIp(req)
	const url = req._normalizedUrl || req.url || "/"
	const tier = resolveTier(url, req.method || "GET")
	const result = check(ip, tier, options)

	// Set rate limit headers
	const limitConfig = options || DEFAULTS[tier] || DEFAULTS.read
	res.setHeader("X-RateLimit-Limit", limitConfig.maxRequests ?? 60)
	res.setHeader("X-RateLimit-Remaining", result.remaining)
	res.setHeader("X-RateLimit-Reset", Math.ceil(result.resetMs / 1000))

	if (!result.allowed) {
		res.setHeader("Retry-After", Math.ceil(result.resetMs / 1000))
		sendJsonResponse(res, 429, {
			success: false,
			error: "Too many requests. Please slow down.",
			retryAfter: Math.ceil(result.resetMs / 1000),
		})
		return false
	}

	return true
}

/**
 * Simple JSON response helper (avoids circular dependency with api.js).
 * @param {import("http").ServerResponse} res
 * @param {number} status
 * @param {any} payload
 */
function sendJsonResponse(res, status, payload) {
	try {
		res.writeHead(status, { "Content-Type": "application/json" })
		res.end(JSON.stringify(payload))
	} catch {
		// Ignore write errors (connection may have closed)
	}
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Get the number of remaining requests for an IP and tier.
 * @param {string} ip
 * @param {string} tier
 * @returns {number}
 */
function getRemaining(ip, tier) {
	const ipWindows = windows.get(ip)
	if (!ipWindows) return DEFAULTS[tier]?.maxRequests || 60

	const timestamps = /** @type {number[]|undefined} */ (ipWindows.get(tier))
	if (!timestamps) return DEFAULTS[tier]?.maxRequests || 60

	const config = DEFAULTS[tier] || DEFAULTS.read
	const cutoff = Date.now() - config.windowMs
	const active = timestamps.filter((/** @type {number} */ t) => t >= cutoff).length

	return Math.max(0, config.maxRequests - active)
}

/**
 * Reset rate limit for a specific IP and tier.
 * @param {string} ip
 * @param {string} [tier] - Optional. If omitted, resets all tiers for this IP.
 */
function reset(ip, tier) {
	const ipWindows = windows.get(ip)
	if (ipWindows) {
		if (tier) {
			ipWindows.delete(tier)
		} else {
			windows.delete(ip)
		}
	}
}

/**
 * Reset all rate limits.
 */
function resetAll() {
	windows.clear()
}

/**
 * Get stats about current rate limit state.
 * @returns {{ totalIps: number, tiers: Record<string, number> }}
 */
function getStats() {
	const ips = new Set()
	/** @type {Record<string, number>} */
	const tierCounts = {}

	for (const [ip, ipWindows] of windows.entries()) {
		ips.add(ip)
		for (const [tier, timestamps] of ipWindows.entries()) {
			const cutoff = Date.now() - (DEFAULTS[tier]?.windowMs || 60_000)
			const active = /** @type {number[]} */ (timestamps).filter((/** @type {number} */ t) => t >= cutoff).length
			if (active > 0) {
				tierCounts[/** @type {string} */ (tier)] = (tierCounts[/** @type {string} */ (tier)] || 0) + 1
			}
		}
	}

	return {
		totalIps: ips.size,
		tiers: tierCounts,
	}
}

// ---------------------------------------------------------------------------
// Periodic Cleanup
// ---------------------------------------------------------------------------

// Clean stale entries every 5 minutes to prevent memory leaks
const cleanupTimer = setInterval(() => {
	const now = Date.now()
	for (const [ip, ipWindows] of windows.entries()) {
		for (const [tier, timestamps] of ipWindows.entries()) {
			const recent = /** @type {number[]} */ (timestamps).filter(
				(/** @type {number} */ t) => now - t < STALE_THRESHOLD_MS,
			)
			if (recent.length === 0) {
				ipWindows.delete(tier)
			} else {
				ipWindows.set(tier, recent)
			}
		}
		if (ipWindows.size === 0) {
			windows.delete(ip)
		}
	}
}, CLEANUP_INTERVAL_MS)

// Allow cleanup timer to keep process alive
if (cleanupTimer.unref) {
	cleanupTimer.unref()
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
	check,
	checkRequest,
	resolveTier,
	getClientIp,
	getRemaining,
	reset,
	resetAll,
	getStats,
	DEFAULTS,
	ROUTE_TIERS,
}
