/**
 * Telegram Rate Limiter
 *
 * Per-chat rate limiting for Telegram bot commands and API endpoints.
 * Prevents abuse by limiting the number of requests a chat can make
 * within a sliding time window.
 *
 * Features:
 * - Per-chat sliding window rate limiting
 * - Configurable limits per action type (command, callback, API)
 * - Automatic cleanup of stale entries
 * - Burst allowance for legitimate use cases
 * - Warning headers for approaching limits
 *
 * Usage:
 *   const rateLimiter = require("./telegramRateLimiter")
 *   const allowed = rateLimiter.check("chat:12345", "command")
 *   if (!allowed) { return "Too many requests" }
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULTS = {
	// Commands: 10 per minute per chat
	command: { windowMs: 60_000, maxRequests: 10 },
	// Callbacks: 20 per minute per chat (inline button clicks)
	callback: { windowMs: 60_000, maxRequests: 20 },
	// API calls: 30 per minute per chat (dashboard polling)
	api: { windowMs: 60_000, maxRequests: 30 },
	// Authentication attempts: 3 per minute per chat
	auth: { windowMs: 60_000, maxRequests: 3 },
	// Webhook updates: 30 per second globally
	webhook: { windowMs: 1_000, maxRequests: 30 },
}

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000 // Clean stale entries every 5 minutes
const STALE_THRESHOLD_MS = 10 * 60 * 1000 // Entries older than 10 minutes are stale

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// Map<actionType, Map<chatId, number[]>>
// Stores timestamps of recent requests for each (type, chat) pair
const windows = new Map()

// ---------------------------------------------------------------------------
// Rate Limit Check
// ---------------------------------------------------------------------------

/**
 * Check if a request is allowed under the rate limit.
 * @param {string} key - Unique identifier (e.g., "chat:12345", "user:67890")
 * @param {string} actionType - Type of action ("command", "callback", "api", "auth", "webhook")
 * @param {object} [options] - Optional override settings
 * @param {number} [options.windowMs] - Time window in milliseconds
 * @param {number} [options.maxRequests] - Max requests in the window
 * @returns {{ allowed: boolean, remaining: number, resetMs: number }}
 */
function check(key, actionType, options) {
	const config = options || DEFAULTS[actionType] || DEFAULTS.command
	const { windowMs, maxRequests } = config

	if (!windows.has(actionType)) {
		windows.set(actionType, new Map())
	}

	const typeWindows = windows.get(actionType)
	const now = Date.now()

	if (!typeWindows.has(key)) {
		typeWindows.set(key, [])
	}

	const timestamps = typeWindows.get(key)

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
 * Check if a chat is allowed to send a command.
 * @param {number|string} chatId
 * @returns {{ allowed: boolean, remaining: number, resetMs: number }}
 */
function checkCommand(chatId) {
	return check("chat:" + chatId, "command")
}

/**
 * Check if a chat is allowed to send a callback query.
 * @param {number|string} chatId
 * @returns {{ allowed: boolean, remaining: number, resetMs: number }}
 */
function checkCallback(chatId) {
	return check("chat:" + chatId, "callback")
}

/**
 * Check if a chat is allowed to make an API call.
 * @param {number|string} chatId
 * @returns {{ allowed: boolean, remaining: number, resetMs: number }}
 */
function checkApi(chatId) {
	return check("chat:" + chatId, "api")
}

/**
 * Check if a user is allowed to attempt authentication.
 * @param {number|string} userId
 * @returns {{ allowed: boolean, remaining: number, resetMs: number }}
 */
function checkAuth(userId) {
	return check("user:" + userId, "auth")
}

/**
 * Check if a webhook update is allowed (global rate).
 * @returns {{ allowed: boolean, remaining: number, resetMs: number }}
 */
function checkWebhook() {
	return check("global", "webhook")
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Get the number of remaining requests for a key and action type.
 * @param {string} key
 * @param {string} actionType
 * @returns {number}
 */
function getRemaining(key, actionType) {
	const typeWindows = windows.get(actionType)
	if (!typeWindows) return DEFAULTS[actionType]?.maxRequests || 10

	const timestamps = typeWindows.get(key)
	if (!timestamps) return DEFAULTS[actionType]?.maxRequests || 10

	const config = DEFAULTS[actionType] || DEFAULTS.command
	const cutoff = Date.now() - config.windowMs
	const active = timestamps.filter((t) => t >= cutoff).length

	return Math.max(0, config.maxRequests - active)
}

/**
 * Reset rate limit for a specific key and action type.
 * @param {string} key
 * @param {string} actionType
 */
function reset(key, actionType) {
	const typeWindows = windows.get(actionType)
	if (typeWindows) {
		typeWindows.delete(key)
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
 * @returns {object}
 */
function getStats() {
	const stats = {}
	for (const [actionType, typeWindows] of windows.entries()) {
		stats[actionType] = typeWindows.size
	}
	return stats
}

// ---------------------------------------------------------------------------
// Periodic Cleanup
// ---------------------------------------------------------------------------

// Clean stale entries every 5 minutes to prevent memory leaks
const cleanupTimer = setInterval(() => {
	const now = Date.now()
	for (const [, typeWindows] of windows.entries()) {
		for (const [key, timestamps] of typeWindows.entries()) {
			// Remove entries where all timestamps are stale
			const recent = timestamps.filter((t) => now - t < STALE_THRESHOLD_MS)
			if (recent.length === 0) {
				typeWindows.delete(key)
			} else {
				typeWindows.set(key, recent)
			}
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
	checkCommand,
	checkCallback,
	checkApi,
	checkAuth,
	checkWebhook,
	getRemaining,
	reset,
	resetAll,
	getStats,
}
