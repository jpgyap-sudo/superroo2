/**
 * Telegram Rate Limiter
 *
 * Sliding-window rate limiter for Telegram bot commands.
 * Prevents abuse by limiting how many commands a chat can issue
 * within a configurable time window.
 *
 * Usage:
 *   const rateLimiter = require("./telegramRateLimiter")
 *   if (rateLimiter.isRateLimited(chatId)) {
 *     // send rate limit warning
 *   }
 */

// ─── Configuration ───────────────────────────────────────────────────────────
var DEFAULT_MAX_COMMANDS = 10 // max commands per window
var DEFAULT_WINDOW_MS = 30_000 // 30-second sliding window
var CLEANUP_INTERVAL_MS = 60_000 // purge stale entries every 60s

// ─── In-Memory Store ─────────────────────────────────────────────────────────
// Map<chatId, number[]> — array of timestamps for each command
var commandLog = new Map()

// ─── Periodic Cleanup ────────────────────────────────────────────────────────
// Prevents unbounded memory growth by removing entries older than the window
setInterval(function () {
	var cutoff = Date.now() - DEFAULT_WINDOW_MS
	for (var [chatId, timestamps] of commandLog.entries()) {
		var fresh = timestamps.filter(function (ts) {
			return ts > cutoff
		})
		if (fresh.length === 0) {
			commandLog.delete(chatId)
		} else {
			commandLog.set(chatId, fresh)
		}
	}
}, CLEANUP_INTERVAL_MS)

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Check if a chat is currently rate-limited.
 * Records the command attempt and returns true if the limit is exceeded.
 *
 * @param {number|string} chatId - Telegram chat ID
 * @param {object} [opts] - Optional overrides
 * @param {number} [opts.maxCommands] - Max commands per window
 * @param {number} [opts.windowMs] - Window duration in ms
 * @returns {{ limited: boolean, retryAfterMs: number, remaining: number }}
 */
function checkRateLimit(chatId, opts) {
	var maxCommands = (opts && opts.maxCommands) || DEFAULT_MAX_COMMANDS
	var windowMs = (opts && opts.windowMs) || DEFAULT_WINDOW_MS
	var now = Date.now()
	var cutoff = now - windowMs

	if (!commandLog.has(chatId)) {
		commandLog.set(chatId, [])
	}

	var timestamps = commandLog.get(chatId)

	// Prune entries outside the window
	var fresh = timestamps.filter(function (ts) {
		return ts > cutoff
	})

	// Count remaining capacity
	var remaining = Math.max(0, maxCommands - fresh.length)

	if (fresh.length >= maxCommands) {
		// Rate limited — the oldest entry determines when they can retry
		var oldest = fresh[0]
		var retryAfterMs = Math.max(0, oldest + windowMs - now)
		commandLog.set(chatId, fresh)
		return { limited: true, retryAfterMs: retryAfterMs, remaining: 0 }
	}

	// Record this command
	fresh.push(now)
	commandLog.set(chatId, fresh)
	return { limited: false, retryAfterMs: 0, remaining: remaining - 1 }
}

/**
 * Get the current rate limit state for a chat (without recording a command).
 *
 * @param {number|string} chatId
 * @param {object} [opts]
 * @returns {{ limited: boolean, retryAfterMs: number, remaining: number }}
 */
function getRateLimitState(chatId, opts) {
	var maxCommands = (opts && opts.maxCommands) || DEFAULT_MAX_COMMANDS
	var windowMs = (opts && opts.windowMs) || DEFAULT_WINDOW_MS
	var now = Date.now()
	var cutoff = now - windowMs

	var timestamps = commandLog.get(chatId) || []
	var fresh = timestamps.filter(function (ts) {
		return ts > cutoff
	})

	var remaining = Math.max(0, maxCommands - fresh.length)

	if (fresh.length >= maxCommands) {
		var oldest = fresh[0]
		var retryAfterMs = Math.max(0, oldest + windowMs - now)
		return { limited: true, retryAfterMs: retryAfterMs, remaining: 0 }
	}

	return { limited: false, retryAfterMs: 0, remaining: remaining }
}

/**
 * Build a user-facing rate limit warning message.
 *
 * @param {number} retryAfterMs - Milliseconds until the user can retry
 * @returns {string} Formatted Telegram message
 */
function formatRateLimitWarning(retryAfterMs) {
	var seconds = Math.ceil(retryAfterMs / 1000)
	return (
		"*⚠️ Rate Limit Reached*\n\n" +
		"You're sending commands too quickly. Please wait " +
		seconds +
		" second" +
		(seconds !== 1 ? "s" : "") +
		" before sending another command.\n\n" +
		"*Tip:* Each chat is limited to " +
		DEFAULT_MAX_COMMANDS +
		" commands per " +
		DEFAULT_WINDOW_MS / 1000 +
		" seconds."
	)
}

/**
 * Reset rate limit for a specific chat (e.g., after a long-running operation completes).
 *
 * @param {number|string} chatId
 */
function resetRateLimit(chatId) {
	commandLog.delete(chatId)
}

/**
 * Clear all rate limit data (for testing or manual reset).
 */
function clearAll() {
	commandLog.clear()
}

// ─── Webhook-level rate limiting ─────────────────────────────────────────────
// Limits total incoming webhook updates to prevent overload.

var webhookLog = []
var WEBHOOK_MAX = 50
var WEBHOOK_WINDOW_MS = 1000

/**
 * Check global webhook rate limit (no chat ID needed).
 *
 * @param {object} [opts]
 * @returns {{ allowed: boolean, remaining: number, resetMs: number }}
 */
function checkWebhook(opts) {
	var max = (opts && opts.maxWebhooks) || WEBHOOK_MAX
	var windowMs = (opts && opts.windowMs) || WEBHOOK_WINDOW_MS
	var now = Date.now()
	var cutoff = now - windowMs
	webhookLog = webhookLog.filter(function (ts) { return ts > cutoff })
	if (webhookLog.length >= max) {
		var oldest = webhookLog[0]
		var resetMs = Math.max(0, oldest + windowMs - now)
		return { allowed: false, remaining: 0, resetMs: resetMs }
	}
	webhookLog.push(now)
	return { allowed: true, remaining: max - webhookLog.length - 1, resetMs: 0 }
}

/**
 * Check per-chat command rate limit.
 * Wraps checkRateLimit with the { allowed, resetMs } interface expected by api.js.
 *
 * @param {number|string} chatId
 * @param {object} [opts]
 * @returns {{ allowed: boolean, remaining: number, resetMs: number }}
 */
function checkCommand(chatId, opts) {
	var result = checkRateLimit(chatId, opts)
	return {
		allowed: !result.limited,
		remaining: result.remaining,
		resetMs: result.retryAfterMs,
	}
}

module.exports = {
	checkRateLimit: checkRateLimit,
	getRateLimitState: getRateLimitState,
	formatRateLimitWarning: formatRateLimitWarning,
	resetRateLimit: resetRateLimit,
	clearAll: clearAll,
	checkWebhook: checkWebhook,
	checkCommand: checkCommand,
}
