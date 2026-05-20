/**
 * SuperRoo Cloud — Telegram Bot Handler
 *
 * Processes incoming Telegram webhook updates and routes them to
 * the SuperRoo job queue. Supports /code, /diff, /test, /approve,
 * /deploy, /logs, /session, /status, /ask commands.
 *
 * Also supports @superroo_bot mentions in groups for AI-powered
 * support queries with Working Tree knowledge.
 *
 * Includes Google Authenticator TOTP verification for secure access
 * to sensitive operations like /deploy.
 *
 * Uses the Telegram Bot API (no third-party libraries required).
 *
 * Integrated with the unified auth module (auth.js) for session-based
 * authentication across Telegram, Web Dashboard, and VS Code extension.
 *
 * === Smart Terminal Features ===
 * - NL-First Chat Mode: Auto-detects coding intent without requiring /brain prefix
 * - Inline Code Execution: Execute shell commands directly in Telegram chat
 * - Smart Error Handling: Auto-analyzes errors after command execution
 * - Conversational Context: Rich context tracking across messages
 * - Quick Action Buttons: Context-aware inline keyboards after every response
 * - Command Correction: "Did you mean?" suggestions for mistyped commands
 * - Workflow Templates: Pre-built command sequences for common tasks
 * - AI-Powered Command Prediction: Suggests next commands based on context
 */

const crypto = require("crypto")
const fs = require("fs").promises
const path = require("path")
const auth = require("./auth")
const telegramLearner = require("./telegramLearner")
const telegramNotifier = require("./telegramNotifier")
const telegramClassifier = require("./telegramClassifier")
const telegramPolicy = require("./telegramPolicy")
const telegramEngineer = require("./telegramEngineer")
const tgEndpoints = require("./tgEndpoints")

// Terminal Brain integration — loaded lazily to avoid crash if packages aren't built
let _terminalBrainAvailable = false
try {
	// Verify the Terminal Brain packages are accessible
	const { TerminalBrain } = require("../../../packages/terminal-core/src/brain")
	if (typeof TerminalBrain === "function") {
		_terminalBrainAvailable = true
		console.log("[telegram] Terminal Brain packages loaded successfully")
	}
} catch (err) {
	console.log("[telegram] Terminal Brain packages not available (non-fatal):", err.message)
}

// ─── Configuration ─────────────────────────────────────────────────────────

const TELEGRAM_API_BASE = "https://api.telegram.org/bot"

/** The bot username (without @) for mention detection */
const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || "superroo_bot"

/** Boss-only mode: only @jpgy888 can use the bot */
const BOSS_USERNAME = process.env.BOSS_TELEGRAM_USERNAME || "jpgy888"

/** Commands that don't require an active Telegram session */
const PUBLIC_COMMANDS = [
	"/start",
	"/login",
	"/help",
	"/about",
	"/debug",
	"/logs",
	"/tests",
	"/restart",
	"/aceteam",
	"/cancel",
]

/** Mini App URL for login */
const DASHBOARD_URL = process.env.TELEGRAM_MINI_APP_URL || "https://dev.abcx124.xyz"
const MINI_APP_URL = DASHBOARD_URL + "/telegram-miniapp"

/** Telegram message length limit (Telegram API hard limit) */
const TELEGRAM_MAX_MESSAGE_LENGTH = 4096

// ─── Per-Chat Rate Limiting ────────────────────────────────────────────────

/** Max commands per minute per chat (free tier) */
const RATE_LIMIT_MAX = 10
/** Max commands per minute per chat (premium tier — authenticated users) */
const PREMIUM_RATE_LIMIT_MAX = 30
/** Window size in milliseconds */
const RATE_LIMIT_WINDOW_MS = 60 * 1000

var rateLimitMap = new Map()

// ─── Webhook Update Deduplication ──────────────────────────────────────────
// Telegram delivers updates with at-least-once semantics. Track processed
// update_ids to prevent duplicate command execution (e.g., double deploy).
// Bounded to the last 1000 IDs to prevent memory leaks.

/** Set<number> — processed update_ids */
const processedUpdateIds = new Set()
/** Max number of update_ids to track */
const PROCESSED_UPDATE_IDS_MAX = 1000

// ─── Webhook Health Check ──────────────────────────────────────────────────

/** Health check state — tracks webhook health over time */
const webhookHealth = {
	lastCheck: null,
	lastOk: null,
	lastError: null,
	consecutiveFailures: 0,
	totalChecks: 0,
	totalFailures: 0,
	uptimePercent: 100,
	/** Array<{timestamp, ok, error, latencyMs}> */
	checkHistory: [],
}
const WEBHOOK_HEALTH_HISTORY_MAX = 100
let _webhookHealthInterval = null

/**
 * Starts a periodic webhook health check that calls getWebhookInfo every N ms.
 * Results are stored in webhookHealth for dashboard display.
 * @param {string} botToken
 * @param {number} intervalMs - Check interval in ms (default: 5 min)
 */
function startWebhookHealthCheck(botToken, intervalMs) {
	if (intervalMs === undefined || intervalMs === null) intervalMs = 5 * 60 * 1000
	if (_webhookHealthInterval) {
		clearInterval(_webhookHealthInterval)
	}
	console.log("[telegram] Starting webhook health check every " + intervalMs / 1000 + "s")
	// Run immediately
	runWebhookHealthCheck(botToken)
	_webhookHealthInterval = setInterval(function () {
		runWebhookHealthCheck(botToken)
	}, intervalMs)
}

/**
 * Runs a single webhook health check.
 * @param {string} botToken
 */
async function runWebhookHealthCheck(botToken) {
	var start = Date.now()
	try {
		var info = await getWebhookInfo(botToken)
		var latency = Date.now() - start
		var ok = info.ok === true && info.result && info.result.url
		webhookHealth.lastCheck = Date.now()
		webhookHealth.totalChecks++
		if (ok) {
			webhookHealth.lastOk = Date.now()
			webhookHealth.consecutiveFailures = 0
		} else {
			webhookHealth.lastError = (info.result && info.result.last_error_date) || info.description || "unknown"
			webhookHealth.consecutiveFailures++
			webhookHealth.totalFailures++
		}
		webhookHealth.uptimePercent = Math.round(
			((webhookHealth.totalChecks - webhookHealth.totalFailures) / webhookHealth.totalChecks) * 100,
		)
		webhookHealth.checkHistory.push({
			timestamp: Date.now(),
			ok: ok,
			error: ok ? null : webhookHealth.lastError,
			latencyMs: latency,
		})
		if (webhookHealth.checkHistory.length > WEBHOOK_HEALTH_HISTORY_MAX) {
			webhookHealth.checkHistory.shift()
		}
		// Log warning if 3+ consecutive failures
		if (webhookHealth.consecutiveFailures >= 3 && webhookHealth.consecutiveFailures % 3 === 0) {
			console.warn(
				"[telegram] Webhook health: " +
					webhookHealth.consecutiveFailures +
					" consecutive failures (last: " +
					webhookHealth.lastError +
					")",
			)
		}
	} catch (err) {
		webhookHealth.lastCheck = Date.now()
		webhookHealth.lastError = err.message
		webhookHealth.consecutiveFailures++
		webhookHealth.totalFailures++
		webhookHealth.totalChecks++
		webhookHealth.uptimePercent = Math.round(
			((webhookHealth.totalChecks - webhookHealth.totalFailures) / webhookHealth.totalChecks) * 100,
		)
		webhookHealth.checkHistory.push({
			timestamp: Date.now(),
			ok: false,
			error: err.message,
			latencyMs: Date.now() - start,
		})
		if (webhookHealth.checkHistory.length > WEBHOOK_HEALTH_HISTORY_MAX) {
			webhookHealth.checkHistory.shift()
		}
		console.error("[telegram] Webhook health check error:", err.message)
	}
}

/**
 * Stops the periodic webhook health check.
 */
function stopWebhookHealthCheck() {
	if (_webhookHealthInterval) {
		clearInterval(_webhookHealthInterval)
		_webhookHealthInterval = null
		console.log("[telegram] Webhook health check stopped")
	}
}

/**
 * Returns the current webhook health state.
 * @returns {Object}
 */
function getWebhookHealth() {
	return {
		lastCheck: webhookHealth.lastCheck,
		lastOk: webhookHealth.lastOk,
		lastError: webhookHealth.lastError,
		consecutiveFailures: webhookHealth.consecutiveFailures,
		totalChecks: webhookHealth.totalChecks,
		totalFailures: webhookHealth.totalFailures,
		uptimePercent: webhookHealth.uptimePercent,
		recentHistory: webhookHealth.checkHistory.slice(-20),
	}
}

/**
 * Token-based command lookup for Telegram callback_data (max 64 bytes).
 * Stores full command strings keyed by short random tokens so that
 * brain_exec:<token> fits within Telegram's callback_data limit.
 * Tokens are 6 hex chars = 6 bytes, prefix "brain_exec:" = 11 bytes → 17 bytes total.
 * Tokens expire after 5 minutes via a cleanup interval.
 */
var callbackCommandTokens = new Map()
var CALLBACK_TOKEN_TTL_MS = 5 * 60 * 1000
setInterval(function () {
	var now = Date.now()
	for (var entry of callbackCommandTokens) {
		if (now - entry[1].ts > CALLBACK_TOKEN_TTL_MS) {
			callbackCommandTokens.delete(entry[0])
		}
	}
}, 60 * 1000).unref()

/**
 * Generate a short random token and store a command string for callback lookup.
 * Returns the token string (6 hex chars).
 */
function storeCallbackCommand(command) {
	var token = Math.random().toString(16).slice(2, 8)
	callbackCommandTokens.set(token, { command: command, ts: Date.now() })
	return token
}

/**
 * Look up a command string by token. Returns null if token is unknown or expired.
 */
function resolveCallbackCommand(token) {
	var entry = callbackCommandTokens.get(token)
	if (!entry) return null
	return entry.command
}

function checkRateLimit(chatId, isPremium) {
	var now = Date.now()
	var maxCommands = isPremium ? PREMIUM_RATE_LIMIT_MAX : RATE_LIMIT_MAX
	var entry = rateLimitMap.get(chatId)
	if (!entry) {
		rateLimitMap.set(chatId, { count: 1, windowStart: now, tier: isPremium ? "premium" : "free" })
		return { allowed: true }
	}
	if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
		rateLimitMap.set(chatId, { count: 1, windowStart: now, tier: isPremium ? "premium" : "free" })
		return { allowed: true }
	}
	if (entry.count >= maxCommands) {
		return { allowed: false, retryAfter: Math.ceil((entry.windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000) }
	}
	entry.count++
	return { allowed: true }
}

// ─── Structured Error Logging for Ace Team ─────────────────────────────────

/**
 * Log a structured error event that the Ace Team monitoring system can parse.
 * Each error is logged as a JSON line prefixed with [ace-error] for easy grep.
 *
 * Fields:
 *   - command: The slash command or intent that failed
 *   - chatId: The Telegram chat ID
 *   - userId: The Telegram user ID
 *   - error: The error message
 *   - stack: Truncated stack trace (first 3 lines)
 *   - timestamp: ISO timestamp
 *   - context: Additional context (e.g., args, project name)
 */
function logTelegramError(command, chatId, userId, err, context) {
	var errorEntry = {
		type: "telegram_error",
		command: command,
		chatId: chatId,
		userId: userId || null,
		error: (err && err.message) || String(err),
		stack: err && err.stack ? err.stack.split("\n").slice(0, 3).join(" | ") : null,
		timestamp: new Date().toISOString(),
		context: context || null,
	}
	console.error("[ace-error] " + JSON.stringify(errorEntry))
}

/**
 * Log a structured warning event for non-fatal issues that may need attention.
 */
function logTelegramWarning(command, chatId, userId, message, context) {
	var warnEntry = {
		type: "telegram_warning",
		command: command,
		chatId: chatId,
		userId: userId || null,
		message: message,
		timestamp: new Date().toISOString(),
		context: context || null,
	}
	console.warn("[ace-warn] " + JSON.stringify(warnEntry))
}

/**
 * Log a structured success/usage event for monitoring feature adoption.
 */
function logTelegramUsage(command, chatId, userId, details) {
	var usageEntry = {
		type: "telegram_usage",
		command: command,
		chatId: chatId,
		userId: userId || null,
		details: details || null,
		timestamp: new Date().toISOString(),
	}
	console.log("[ace-usage] " + JSON.stringify(usageEntry))
}

/**
 * Command latency tracking for monitoring slow commands.
 * Records min, max, avg, count, and p95 latency per command.
 */
const commandLatency = {}
const COMMAND_LATENCY_HISTORY_MAX = 1000

/**
 * Record the execution latency of a command for monitoring.
 * @param {string} command - The command name (e.g., "/code", "callback:brain_exec")
 * @param {number} durationMs - Execution duration in milliseconds
 */
function logCommandLatency(command, durationMs) {
	if (!commandLatency[command]) {
		commandLatency[command] = {
			min: durationMs,
			max: durationMs,
			total: durationMs,
			count: 1,
			p95: durationMs,
			recent: [durationMs],
		}
	} else {
		var stats = commandLatency[command]
		if (durationMs < stats.min) stats.min = durationMs
		if (durationMs > stats.max) stats.max = durationMs
		stats.total += durationMs
		stats.count++
		stats.recent.push(durationMs)
		if (stats.recent.length > 100) {
			stats.recent = stats.recent.slice(-100)
		}
		// Compute p95 from recent samples
		var sorted = stats.recent.slice().sort(function (a, b) {
			return a - b
		})
		var p95Index = Math.ceil(sorted.length * 0.95) - 1
		stats.p95 = sorted[Math.max(0, p95Index)]
	}
}

/**
 * Get a snapshot of command latency statistics.
 * @param {string} [command] - Optional command filter
 * @returns {object} Latency stats
 */
function getCommandLatency(command) {
	if (command) {
		var s = commandLatency[command]
		if (!s) return null
		return {
			command: command,
			min: s.min,
			max: s.max,
			avg: Math.round(s.total / s.count),
			count: s.count,
			p95: s.p95,
		}
	}
	var result = {}
	for (var cmd in commandLatency) {
		var s = commandLatency[cmd]
		result[cmd] = {
			min: s.min,
			max: s.max,
			avg: Math.round(s.total / s.count),
			count: s.count,
			p95: s.p95,
		}
	}
	return result
}

/**
 * Provider fallback metrics for monitoring AI provider reliability.
 * Tracks attempts, successes, failures, and fallback chain behavior.
 */
const providerMetrics = {
	attempts: {},
	successes: {},
	failures: {},
	fallbackChain: {
		ollamaFirst: 0,
		ollamaFirstOk: 0,
		cloudAttempted: 0,
		cloudOk: 0,
		ollamaRagFallback: 0,
		ollamaRagOk: 0,
		allFailed: 0,
	},
}

/**
 * Record a provider attempt for monitoring.
 * @param {string} providerId - Provider identifier (e.g., "deepseek", "ollama")
 * @param {boolean} success - Whether the call succeeded
 * @param {number} [durationMs] - Optional response time in milliseconds
 */
function logProviderAttempt(providerId, success, durationMs) {
	if (!providerMetrics.attempts[providerId]) {
		providerMetrics.attempts[providerId] = 0
		providerMetrics.successes[providerId] = 0
		providerMetrics.failures[providerId] = 0
	}
	providerMetrics.attempts[providerId]++
	if (success) {
		providerMetrics.successes[providerId]++
	} else {
		providerMetrics.failures[providerId]++
	}
}

/**
 * Get provider metrics snapshot.
 * @returns {object} Provider metrics with success rates
 */
function getProviderMetrics() {
	var result = {
		providers: {},
		fallbackChain: { ...providerMetrics.fallbackChain },
	}
	for (var pid in providerMetrics.attempts) {
		var att = providerMetrics.attempts[pid]
		var ok = providerMetrics.successes[pid]
		result.providers[pid] = {
			attempts: att,
			successes: ok,
			failures: providerMetrics.failures[pid],
			successRate: att > 0 ? Math.round((ok / att) * 100) + "%" : "0%",
		}
	}
	return result
}

// ─── Response Cache (GAP 3.4) ──────────────────────────────────────────────
// Caches AI responses keyed by message hash + chat context hash.
// Serves cached responses when all providers are down.
// Entries expire after RESPONSE_CACHE_TTL_MS.

/** Map<string, { response, timestamp, provider, messagePreview }> */
const _responseCache = new Map()
const RESPONSE_CACHE_MAX = 500
const RESPONSE_CACHE_TTL_MS = 30 * 60 * 1000 // 30 minutes

/**
 * Generate a simple hash for a string (djb2 algorithm).
 * @param {string} str
 * @returns {string} hex hash
 */
function _hashString(str) {
	var hash = 5381
	for (var i = 0; i < str.length; i++) {
		hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0
	}
	return Math.abs(hash).toString(16)
}

/**
 * Build a cache key from the user message and chat context.
 * @param {string} message - The user's message
 * @param {number|string} [chatId] - Optional chat ID for context
 * @returns {string} cache key
 */
function _buildCacheKey(message, chatId) {
	var msgHash = _hashString(message.toLowerCase().trim())
	if (chatId === undefined || chatId === null) {
		return msgHash
	}
	// Include a lightweight context fingerprint (last intent + message count)
	var ctx = getSmartContext(chatId)
	var ctxFingerprint = ""
	if (ctx) {
		ctxFingerprint = ctx.lastIntent || "" + "|" + (ctx.messageCount || 0)
	}
	var ctxHash = _hashString(ctxFingerprint)
	return msgHash + "_" + ctxHash
}

/**
 * Store a response in the cache.
 * @param {string} message - The user's original message
 * @param {string} response - The AI response to cache
 * @param {number|string} [chatId] - Optional chat ID
 * @param {string} [provider] - The provider that generated the response
 */
function _cacheResponse(message, response, chatId, provider) {
	var key = _buildCacheKey(message, chatId)
	// Evict oldest entry if at capacity
	if (_responseCache.size >= RESPONSE_CACHE_MAX) {
		var oldestKey = null
		var oldestTime = Infinity
		_responseCache.forEach(function (entry, k) {
			if (entry.timestamp < oldestTime) {
				oldestTime = entry.timestamp
				oldestKey = k
			}
		})
		if (oldestKey) _responseCache.delete(oldestKey)
	}
	_responseCache.set(key, {
		response: response,
		timestamp: Date.now(),
		provider: provider || "unknown",
		messagePreview: message.slice(0, 80),
	})
}

/**
 * Look up a cached response.
 * @param {string} message - The user's message
 * @param {number|string} [chatId] - Optional chat ID
 * @returns {{ response: string, provider: string, age: number }|null} Cached entry or null
 */
function _getCachedResponse(message, chatId) {
	var key = _buildCacheKey(message, chatId)
	var entry = _responseCache.get(key)
	if (!entry) return null
	// Check TTL
	var age = Date.now() - entry.timestamp
	if (age > RESPONSE_CACHE_TTL_MS) {
		_responseCache.delete(key)
		return null
	}
	return {
		response: entry.response,
		provider: entry.provider,
		age: age,
	}
}

/**
 * Get cache stats for monitoring.
 * @returns {{ size: number, maxSize: number, ttlMinutes: number }}
 */
function getResponseCacheStats() {
	return {
		size: _responseCache.size,
		maxSize: RESPONSE_CACHE_MAX,
		ttlMinutes: RESPONSE_CACHE_TTL_MS / 60000,
	}
}

// ─── In-memory state ───────────────────────────────────────────────────────

/** Map<chatId, { sessionId, authenticatedAt, otpVerified, otpSecret? }> */
const activeSessions = new Map()

/** Map<chatId, { pendingApprovalId, taskId, branchName, diff }> */
const pendingApprovals = new Map()

/** Map<chatId, CodingTask[]> */
const userTasks = new Map()

/** Map<chatId, { secret, verified }> — TOTP secrets awaiting verification */
const pendingOtpSecrets = new Map()

/** Map<chatId, { email, otp, createdAt, messageIds }> — Email OTP login states */
const pendingEmailOtps = new Map()

/** Map<taskId, intervalId> — Active typing intervals for auto-mode jobs */
const activeTypingIntervals = new Map()

// ─── Command History (GAP 4.2) ─────────────────────────────────────────────
// Per-chat ring buffer of recent commands for up/down arrow recall.
// Each entry: { command, args, text, timestamp, result }

/** Map<chatId, Array<{command, args, text, timestamp}>> */
const _commandHistory = new Map()
const COMMAND_HISTORY_MAX = 20

/**
 * Record a command in the per-chat history ring buffer.
 * @param {number|string} chatId
 * @param {string} command - The slash command or "natural_language"
 * @param {string} text - The full user message text
 * @param {Array} [cmdArgs] - Parsed arguments
 */
function recordCommand(chatId, command, text, cmdArgs) {
	if (!chatId) return
	if (!_commandHistory.has(chatId)) {
		_commandHistory.set(chatId, [])
	}
	var history = _commandHistory.get(chatId)
	// Don't record duplicate consecutive commands (e.g., rapid /again taps)
	var last = history.length > 0 ? history[history.length - 1] : null
	if (last && last.command === command && last.text === text) {
		return
	}
	history.push({
		command: command,
		text: text.slice(0, 200),
		args: cmdArgs ? cmdArgs.slice(0, 10) : [],
		timestamp: Date.now(),
	})
	// Bounded ring buffer — remove oldest when over limit
	if (history.length > COMMAND_HISTORY_MAX) {
		history.shift()
	}
}

/**
 * Get command history for a chat.
 * @param {number|string} chatId
 * @param {number} [limit=10] - Max entries to return
 * @returns {Array<{command, text, timestamp}>}
 */
function getCommandHistory(chatId, limit) {
	if (limit === undefined || limit === null) limit = 10
	var history = _commandHistory.get(chatId)
	if (!history || history.length === 0) return []
	return history.slice(-limit).reverse()
}

/**
 * Starts a persistent typing indicator for an auto-mode job.
 * Sends sendChatAction("typing") every 5 seconds until stopped or timeout.
 * Auto-stops after 10 minutes to prevent infinite intervals.
 * @param {string} botToken
 * @param {number|string} chatId
 * @param {string} taskId
 */
function startAutoTypingInterval(botToken, chatId, taskId) {
	stopAutoTypingInterval(taskId)
	var count = 0
	var maxCount = 120 // 120 * 5s = 600s = 10 minutes
	var interval = setInterval(function () {
		count++
		if (count >= maxCount) {
			stopAutoTypingInterval(taskId)
			return
		}
		sendChatAction(botToken, chatId, "typing").catch(function () {})
	}, 5000)
	activeTypingIntervals.set(taskId, interval)
}

/**
 * Stops the persistent typing indicator for a task.
 * @param {string} taskId
 */
function stopAutoTypingInterval(taskId) {
	var existing = activeTypingIntervals.get(taskId)
	if (existing) {
		clearInterval(existing)
		activeTypingIntervals.delete(taskId)
	}
}

/**
 * Stops all active typing indicators.
 */
function stopAllAutoTypingIntervals() {
	for (var entry of activeTypingIntervals) {
		clearInterval(entry[1])
	}
	activeTypingIntervals.clear()
}

/** OTP expiry: 10 minutes */
const EMAIL_OTP_TTL_MS = 10 * 60 * 1000

/**
 * Map<chatId, workspaceName> — Group-to-workspace binding.
 * When a group chat is bound to a workspace via /specify, all natural language
 * messages in that group automatically use the bound workspace for agent routing.
 * Persisted to JSON for durability across restarts.
 */
const groupWorkspaces = new Map()

/** Path to persist group workspace bindings */
const GROUP_WORKSPACES_FILE = path.join(__dirname, "..", "data", "group-workspaces.json")

/**
 * Map<chatId, Array<{role, content, timestamp}>> — Conversation history.
 * Persisted to disk so it survives PM2 restarts and deploys.
 * Each entry: { role: "user"|"assistant", content: string, timestamp: number }
 */
const conversationHistory = new Map()

/** Path to persist conversation history */
const CONVERSATION_HISTORY_FILE = path.join(__dirname, "..", "data", "conversation-history.json")

/** Path to persist bot state (sessions, OTPs, tasks) */
const TELEGRAM_BOT_STATE_FILE = path.join(__dirname, "..", "data", "telegram-bot-state.json")

/** Max messages to keep per chat in memory */
const MAX_CONVERSATION_MESSAGES = 50

/** Max messages to include in AI context window */
const MAX_CONTEXT_MESSAGES = 20

/** Session timeout: 30 minutes */
const SESSION_TTL_MS = 30 * 60 * 1000

// ─── TOTP (Google Authenticator) ───────────────────────────────────────────

/**
 * Generates a TOTP-compatible base32 secret key (16 bytes -> 26 chars base32).
 * Compatible with Google Authenticator, Authy, etc.
 */
function generateTOTPSecret() {
	const bytes = crypto.randomBytes(16)
	const base32Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
	let base32 = ""
	let bits = 0
	let bitCount = 0
	for (let i = 0; i < bytes.length; i++) {
		bits = (bits << 8) | bytes[i]
		bitCount += 8
		while (bitCount >= 5) {
			bitCount -= 5
			base32 += base32Chars[(bits >> bitCount) & 0x1f]
		}
	}
	if (bitCount > 0) {
		base32 += base32Chars[(bits << (5 - bitCount)) & 0x1f]
	}
	while (base32.length % 8 !== 0) base32 += "="
	return base32
}

/**
 * Decodes a base32 string (RFC 4648) to a Buffer.
 */
function base32Decode(encoded) {
	const base32Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
	const clean = encoded.replace(/=+$/, "").toUpperCase()
	const bytes = []
	let bits = 0
	let bitCount = 0
	for (let i = 0; i < clean.length; i++) {
		const idx = base32Chars.indexOf(clean[i])
		if (idx === -1) continue
		bits = (bits << 5) | idx
		bitCount += 5
		if (bitCount >= 8) {
			bitCount -= 8
			bytes.push((bits >> bitCount) & 0xff)
		}
	}
	return Buffer.from(bytes)
}

/**
 * Computes a TOTP code for a given secret and time step.
 * Uses SHA-1 (standard for Google Authenticator compatibility).
 * @param {string} base32Secret - Base32-encoded secret
 * @param {number} timeStep - Time step in seconds
 * @param {number} offset - Time step offset (-1, 0, +1 for clock drift)
 * @returns {string} 6-digit TOTP code
 */
function computeTOTP(base32Secret, timeStep, offset) {
	const key = base32Decode(base32Secret)
	const counter = Math.floor(Date.now() / 1000 / timeStep) + (offset || 0)
	const counterBuf = Buffer.alloc(8)
	counterBuf.writeBigUInt64BE(BigInt(counter), 0)

	const hmac = crypto.createHmac("sha1", key)
	hmac.update(counterBuf)
	const digest = hmac.digest()

	const offset2 = digest[digest.length - 1] & 0xf
	const binary =
		((digest[offset2] & 0x7f) << 24) |
		((digest[offset2 + 1] & 0xff) << 16) |
		((digest[offset2 + 2] & 0xff) << 8) |
		(digest[offset2 + 3] & 0xff)

	const code = binary % 1000000
	return String(code).padStart(6, "0")
}

/**
 * Verifies a TOTP code against a secret.
 * Checks current and adjacent time steps (+-1) to account for clock drift.
 * @param {string} base32Secret
 * @param {string} code - 6-digit code from Google Authenticator
 * @returns {boolean}
 */
function verifyTOTP(base32Secret, code) {
	const timeStep = 30
	for (let offset = -1; offset <= 1; offset++) {
		const expected = computeTOTP(base32Secret, timeStep, offset)
		if (expected === code) return true
	}
	return false
}

/**
 * Generates an otpauth:// URI for easy QR code scanning.
 * @param {string} base32Secret
 * @param {string} [accountName="superroo@telegram"]
 * @returns {string}
 */
function generateOTPAuthURI(base32Secret, accountName) {
	const name = accountName || "jpgyap@gmail.com"
	const encodedName = encodeURIComponent(name)
	const encodedIssuer = encodeURIComponent("SuperRoo Cloud")
	return (
		"otpauth://totp/" +
		encodedIssuer +
		":" +
		encodedName +
		"?secret=" +
		base32Secret +
		"&issuer=" +
		encodedIssuer +
		"&algorithm=SHA1&digits=6&period=30"
	)
}

// ─── Helper: Call Telegram API ─────────────────────────────────────────────

/**
 * Sends a message to a Telegram chat.
 * @param {string} botToken
 * @param {number|string} chatId
 * @param {string} text
 * @param {object} [opts]
 */
/**
 * Splits a long message into chunks at natural boundaries (paragraphs, lines)
 * so each chunk fits within Telegram's 4096-character limit.
 * @param {string} text - The message to split
 * @param {number} [maxLen] - Max length per chunk (default TELEGRAM_MAX_MESSAGE_LENGTH)
 * @returns {string[]} Array of message chunks
 */
function splitLongMessage(text, maxLen) {
	if (maxLen === undefined) maxLen = TELEGRAM_MAX_MESSAGE_LENGTH
	if (!text || text.length <= maxLen) return [text]

	var chunks = []
	var remaining = text

	while (remaining.length > 0) {
		if (remaining.length <= maxLen) {
			chunks.push(remaining)
			break
		}

		// Try to split at a natural boundary within the limit
		var splitAt = -1

		// 1. Try double newline (paragraph break) — best boundary
		splitAt = remaining.lastIndexOf("\n\n", maxLen)
		if (splitAt > maxLen * 0.5) {
			chunks.push(remaining.slice(0, splitAt))
			remaining = remaining.slice(splitAt + 2)
			continue
		}

		// 2. Try single newline
		splitAt = remaining.lastIndexOf("\n", maxLen)
		if (splitAt > maxLen * 0.5) {
			chunks.push(remaining.slice(0, splitAt))
			remaining = remaining.slice(splitAt + 1)
			continue
		}

		// 3. Try space
		splitAt = remaining.lastIndexOf(" ", maxLen)
		if (splitAt > maxLen * 0.3) {
			chunks.push(remaining.slice(0, splitAt))
			remaining = remaining.slice(splitAt + 1)
			continue
		}

		// 4. Hard split at maxLen (last resort)
		chunks.push(remaining.slice(0, maxLen))
		remaining = remaining.slice(maxLen)
	}

	return chunks
}

/**
 * Shared Ollama chat client — calls Ollama's /api/chat endpoint via http.request.
 * Uses canonical env vars OLLAMA_BASE_URL and OLLAMA_MODEL with legacy fallbacks.
 * Returns the response content string, or null if Ollama is unavailable/times out.
 * @param {Array} messages - Array of {role, content} message objects
 * @param {object} [options] - Optional overrides
 * @param {number} [options.num_predict=4096] - Max tokens to generate
 * @param {number} [options.temperature=0.7] - Temperature
 * @param {number} [options.timeout=120_000] - Request timeout in ms
 * @returns {Promise<string|null>}
 */
async function _callOllamaChat(messages, options) {
	options = options || {}
	var ollamaBaseUrl = process.env.OLLAMA_BASE_URL || process.env.OLLAMA_HOST || "http://127.0.0.1:11434"
	var ollamaModel = process.env.OLLAMA_MODEL || process.env.OLLAMA_CHAT_MODEL || "qwen2.5:0.5b"
	var numPredict = options.num_predict || 4096
	var temperature = options.temperature != null ? options.temperature : 0.7
	var timeout = options.timeout || 120_000
	try {
		var http = require("http")
		var postData = JSON.stringify({
			model: ollamaModel,
			messages: messages,
			stream: false,
			options: { temperature: temperature, num_predict: numPredict },
		})
		return await new Promise(function (resolve) {
			var req = http.request(
				ollamaBaseUrl + "/api/chat",
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"Content-Length": Buffer.byteLength(postData),
					},
					timeout: timeout,
				},
				function (res) {
					var body = ""
					res.on("data", function (chunk) {
						body += chunk
					})
					res.on("end", function () {
						try {
							var data = JSON.parse(body)
							resolve(data.message?.content || data.response || null)
						} catch (e) {
							resolve(null)
						}
					})
				},
			)
			req.on("error", function () {
				resolve(null)
			})
			req.on("timeout", function () {
				req.destroy()
				resolve(null)
			})
			req.write(postData)
			req.end()
		})
	} catch (e) {
		return null
	}
}

/**
 * Sends a message to a Telegram chat, automatically splitting long messages
 * into multiple API calls to respect Telegram's 4096-character limit.
 * Each chunk is sent as a separate message in sequence.
 */
/**
 * Strip common markdown formatting characters from text for plain text fallback.
 */
function stripMarkdown(text) {
	return text
		.replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1") // bold **text** or italic *text*
		.replace(/_{1,2}([^_]+)_{1,2}/g, "$1") // underline __text__ or _text_
		.replace(/`{1,3}([^`]+)`{1,3}/g, "$1") // inline code `text` or ```code```
		.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // links [text](url)
		.replace(/^#{1,6}\s+/gm, "") // headings # text
		.replace(/^[-*+]\s+/gm, "") // list items - * +
		.replace(/^\d+\.\s+/gm, "") // numbered list items
		.replace(/~~([^~]+)~~/g, "$1") // strikethrough
		.replace(/>\s+/g, "") // blockquotes
		.trim()
}

async function sendMessage(botToken, chatId, text, opts) {
	opts = opts || {}
	var chunks = splitLongMessage(text)
	const url = TELEGRAM_API_BASE + botToken + "/sendMessage"

	for (var ci = 0; ci < chunks.length; ci++) {
		var chunk = chunks[ci]
		// Try with markdown first, fall back to plain text if markdown parsing fails
		var parseMode = opts.parseMode || "Markdown"
		var attempts = 0
		var maxAttempts = 2

		while (attempts < maxAttempts) {
			attempts++
			const body = {
				chat_id: chatId,
				text: chunk,
				parse_mode: parseMode,
				disable_web_page_preview: true,
			}
			if (opts.reply_to_message_id) body.reply_to_message_id = opts.reply_to_message_id
			if (opts.disable_notification) body.disable_notification = opts.disable_notification
			if (opts.reply_markup) body.reply_markup = opts.reply_markup
			try {
				const res = await fetch(url, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(body),
				})
				if (!res.ok) {
					const err = await res.text().catch(function () {
						return ""
					})
					// If markdown parsing failed, fall back to plain text
					if (parseMode === "Markdown" && err.includes("can't parse entities")) {
						console.log("[telegram] Markdown parse failed, falling back to plain text for chunk " + ci)
						parseMode = ""
						// Strip markdown formatting for plain text fallback
						chunk = stripMarkdown(chunk)
						continue
					}
					// If plain text also fails (e.g. message too long), log and skip
					if (!parseMode) {
						console.error(
							"[telegram] Plain text send also failed for chunk " + ci + ": " + err.slice(0, 200),
						)
						break
					}
					console.error("[telegram] sendMessage error: " + res.status + " " + err.slice(0, 200))
				}
				break // Success
			} catch (err) {
				console.error("[telegram] sendMessage network error:", err.message)
				break
			}
		}
		// Small delay between chunks to avoid rate limiting
		if (ci < chunks.length - 1) {
			await new Promise(function (resolve) {
				setTimeout(resolve, 200)
			})
		}
	}
}

// ─── Paginated Message (GAP 4.3) ───────────────────────────────────────────
// When a response is too long, split it into pages with ◀️ ▶️ navigation.
// Each page is an editable message; the user can flip through pages via
// inline keyboard buttons without cluttering the chat with multiple messages.

/** Map<chatId, Array<{messageId, page, totalPages, text}>> — active paginated messages */
const _paginatedMessages = new Map()

/**
 * Sends a long message as a paginated, editable message with ◀️ ▶️ navigation.
 * Falls back to regular sendMessage if the text fits in one chunk.
 * @param {string} botToken
 * @param {number|string} chatId
 * @param {string} text - The full response text
 * @param {object} [opts] - Optional sendMessage options
 * @returns {Promise<number|null>} The message_id of the first page, or null
 */
async function sendPaginatedMessage(botToken, chatId, text, opts) {
	opts = opts || {}
	var chunks = splitLongMessage(text, TELEGRAM_MAX_MESSAGE_LENGTH - 200) // leave room for page indicator
	if (chunks.length <= 1) {
		// Single chunk — send normally
		await sendMessage(botToken, chatId, text, opts)
		return null
	}

	// Store all chunks for later editing
	var pageKey = chatId + "_" + Date.now()
	var totalPages = chunks.length

	// Send the first page with navigation buttons
	var pageText = chunks[0] + "\n\n_— Page 1/" + totalPages + " —_"
	var navButtons = []
	if (totalPages > 1) {
		var navRow = []
		if (totalPages > 1) {
			navRow.push({ text: "▶️", callback_data: "page:" + pageKey + ":2" })
		}
		navButtons.push(navRow)
	}

	// Store paginated state
	if (!_paginatedMessages.has(chatId)) {
		_paginatedMessages.set(chatId, new Map())
	}
	_paginatedMessages.get(chatId).set(pageKey, {
		chunks: chunks,
		totalPages: totalPages,
		createdAt: Date.now(),
	})

	var result = await sendMessage(botToken, chatId, pageText, {
		...opts,
		reply_markup: { inline_keyboard: navButtons },
	})

	// Clean up old paginated messages after 10 minutes
	setTimeout(
		function () {
			var chatPages = _paginatedMessages.get(chatId)
			if (chatPages) {
				chatPages.delete(pageKey)
				if (chatPages.size === 0) _paginatedMessages.delete(chatId)
			}
		},
		10 * 60 * 1000,
	).unref()

	return result
}

/**
 * Handle a pagination callback (page:key:pageNum).
 * Edits the message to show the requested page.
 */
async function handlePageNavigation(botToken, cq, cqChatId, cqMessageId, cqData) {
	var parts = cqData.split(":")
	if (parts.length < 3) return false
	var pageKey = parts[1]
	var targetPage = parseInt(parts[2], 10)
	if (isNaN(targetPage)) return false

	var chatPages = _paginatedMessages.get(cqChatId)
	if (!chatPages) return false
	var pageData = chatPages.get(pageKey)
	if (!pageData) return false

	var totalPages = pageData.totalPages
	if (targetPage < 1 || targetPage > totalPages) return false

	var chunk = pageData.chunks[targetPage - 1]
	var pageText = chunk + "\n\n_— Page " + targetPage + "/" + totalPages + " —_"

	// Build navigation buttons
	var navRow = []
	if (targetPage > 1) {
		navRow.push({ text: "◀️", callback_data: "page:" + pageKey + ":" + (targetPage - 1) })
	}
	if (targetPage < totalPages) {
		navRow.push({ text: "▶️", callback_data: "page:" + pageKey + ":" + (targetPage + 1) })
	}

	await editMessageText(botToken, cqChatId, cqMessageId, pageText, {
		reply_markup: { inline_keyboard: [navRow] },
	})
	return true
}

/**
 * Deletes a message from a chat.
 * Used for auto-deleting sensitive messages (OTP codes, login details).
 */
async function deleteMessage(botToken, chatId, messageId) {
	if (!messageId) return
	try {
		var url = TELEGRAM_API_BASE + botToken + "/deleteMessage"
		await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
		})
	} catch (err) {
		// Non-critical - just log it
		console.log("[telegram] deleteMessage error: " + (err.message || err))
	}
}

/**
 * Sends a chat action (typing indicator) to show the bot is processing.
 * @param {string} botToken
 * @param {number|string} chatId
 * @param {string} [action="typing"]
 */
async function sendChatAction(botToken, chatId, action) {
	action = action || "typing"
	const url = TELEGRAM_API_BASE + botToken + "/sendChatAction"
	try {
		await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ chat_id: chatId, action: action }),
		})
	} catch (err) {
		// silently ignore
	}
}

/**
 * Sends a message with an inline keyboard.
 * @param {string} botToken
 * @param {number|string} chatId
 * @param {string} text
 * @param {Array} buttons - Array of [{ text, callback_data }] rows
 * @param {object} [opts]
 */
async function sendInlineKeyboard(botToken, chatId, text, buttons, opts) {
	opts = opts || {}
	const reply_markup = {
		inline_keyboard: buttons.map(function (row) {
			return row.map(function (btn) {
				if (btn.web_app) {
					return { text: btn.text, web_app: { url: btn.web_app } }
				}
				if (btn.url) {
					return { text: btn.text, url: btn.url }
				}
				return { text: btn.text, callback_data: btn.callback_data }
			})
		}),
	}
	await sendMessage(botToken, chatId, text, Object.assign({}, opts, { reply_markup: JSON.stringify(reply_markup) }))
}

/**
 * Sends a persistent reply keyboard (bottom button row) for click-first GUI.
 * @param {string} botToken
 * @param {number|string} chatId
 * @param {string} text
 * @param {Array} buttons - Array of string rows, e.g. [["💻 Code", "🔍 Debug"], ["🧪 Test", "🚀 Deploy"]]
 * @param {object} [opts]
 */
async function sendReplyKeyboard(botToken, chatId, text, buttons, opts) {
	opts = opts || {}
	const reply_markup = {
		keyboard: buttons.map(function (row) {
			return row.map(function (label) {
				return { text: label }
			})
		}),
		resize_keyboard: opts.resize_keyboard !== false,
		one_time_keyboard: opts.one_time_keyboard === true,
	}
	await sendMessage(botToken, chatId, text, Object.assign({}, opts, { reply_markup: JSON.stringify(reply_markup) }))
}

/**
 * Removes the reply keyboard from a chat.
 * @param {string} botToken
 * @param {number|string} chatId
 * @param {string} [text="Done"]
 */
async function removeReplyKeyboard(botToken, chatId, text) {
	text = text || "Done"
	await sendMessage(botToken, chatId, text, {
		reply_markup: JSON.stringify({ remove_keyboard: true }),
	})
}

/**
 * Answers a callback query (removes the loading spinner on the button).
 * @param {string} botToken
 * @param {string} callbackQueryId
 * @param {string} [text]
 */
async function answerCallbackQuery(botToken, callbackQueryId, text) {
	const url = TELEGRAM_API_BASE + botToken + "/answerCallbackQuery"
	try {
		await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				callback_query_id: callbackQueryId,
				text: text || "",
			}),
		})
	} catch (err) {
		// silently ignore
	}
}

/**
 * Edits a message text (used to update inline keyboard messages).
 * @param {string} botToken
 * @param {number|string} chatId
 * @param {number} messageId
 * @param {string} text
 * @param {object} [opts]
 */
async function editMessageText(botToken, chatId, messageId, text, opts) {
	opts = opts || {}
	const url = TELEGRAM_API_BASE + botToken + "/editMessageText"
	const body = {
		chat_id: chatId,
		message_id: messageId,
		text: text,
		parse_mode: opts.parseMode || "Markdown",
		disable_web_page_preview: true,
	}
	if (opts.reply_markup) body.reply_markup = opts.reply_markup
	try {
		await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		})
	} catch (err) {
		console.error("[telegram] editMessageText error:", err.message)
	}
}

/**
 * Sets the webhook URL for the bot.
 * @param {string} botToken
 * @param {string} webhookUrl - Public HTTPS URL pointing to /telegram/webhook
 */
async function setWebhook(botToken, webhookUrl) {
	const url = TELEGRAM_API_BASE + botToken + "/setWebhook"
	try {
		// Generate a webhook secret token if TELEGRAM_WEBHOOK_SECRET is configured
		const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET || undefined
		const body = {
			url: webhookUrl,
			allowed_updates: ["message", "callback_query"],
		}
		if (secretToken) {
			body.secret_token = secretToken
			console.log("[telegram] Webhook secret_token configured")
		}
		const res = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		})
		const data = await res.json()
		if (data.ok) {
			console.log("[telegram] Webhook set to " + webhookUrl)
		} else {
			console.error("[telegram] Failed to set webhook:", data.description)
		}
		return data
	} catch (err) {
		console.error("[telegram] setWebhook error:", err.message)
		return { ok: false, error: err.message }
	}
}

/**
 * Gets the current webhook status.
 * @param {string} botToken
 */
async function getWebhookInfo(botToken) {
	const url = TELEGRAM_API_BASE + botToken + "/getWebhookInfo"
	try {
		const res = await fetch(url)
		const data = await res.json()
		return data
	} catch (err) {
		console.error("[telegram] getWebhookInfo error:", err.message)
		return { ok: false, error: err.message }
	}
}

/**
 * Deletes the current webhook.
 * @param {string} botToken
 */
async function deleteWebhook(botToken) {
	const url = TELEGRAM_API_BASE + botToken + "/deleteWebhook"
	try {
		const res = await fetch(url, { method: "POST" })
		const data = await res.json()
		return data
	} catch (err) {
		console.error("[telegram] deleteWebhook error:", err.message)
		return { ok: false, error: err.message }
	}
}

// ─── Session Management ────────────────────────────────────────────────────

/**
 * Map<chatId, { expiredNotified: boolean }> — tracks if we've already notified about session expiry
 */
const sessionExpiryNotified = new Map()

function getSession(chatId) {
	const session = activeSessions.get(chatId)
	if (!session) return null
	if (Date.now() - session.authenticatedAt > SESSION_TTL_MS) {
		activeSessions.delete(chatId)
		scheduleStatePersist()
		return null
	}
	return session
}

/**
 * Gets session and sends expiry notification if session has timed out.
 * Returns null if session is expired (and sends notification once).
 */
function getSessionWithNotification(botToken, chatId) {
	const session = activeSessions.get(chatId)
	if (!session) {
		// Session doesn't exist at all — not a timeout scenario
		return null
	}
	if (Date.now() - session.authenticatedAt > SESSION_TTL_MS) {
		activeSessions.delete(chatId)
		scheduleStatePersist()
		// Only notify once per expiry event
		if (!sessionExpiryNotified.get(chatId)) {
			sessionExpiryNotified.set(chatId, true)
			var expiryTime = new Date(session.authenticatedAt + SESSION_TTL_MS).toISOString()
			// Fire and forget — don't await to avoid blocking
			sendMessage(
				botToken,
				chatId,
				"*Session Expired* ⏰\n\nYour session has timed out due to inactivity.\n\n*Expired at:* `" +
					expiryTime +
					"`\n*Session duration:* 30 minutes\n\nPlease use `/login` to re-authenticate.\nYou'll need to verify your OTP code to reactivate.",
			).catch(function (e) {
				console.error("[telegram] Failed to send expiry notification:", e.message)
			})
		}
		return null
	}
	// Reset the notified flag when session is valid
	sessionExpiryNotified.delete(chatId)
	return session
}

function createOrRefreshSession(chatId) {
	const session = {
		chatId: chatId,
		authenticatedAt: Date.now(),
		otpVerified: false,
		otpVerifiedAt: null,
	}
	activeSessions.set(chatId, session)
	scheduleStatePersist()
	// Reset expiry notification flag
	sessionExpiryNotified.delete(chatId)
	return session
}

// ─── Auth Module Integration ───────────────────────────────────────────────

/**
 * Checks if a Telegram user has an active session in the auth module.
 * If they do, creates/refreshes the local session.
 * @param {number} telegramUserId
 * @param {number} chatId
 * @returns {Promise<object|null>} The auth session or null
 */
async function checkAuthSession(telegramUserId, chatId) {
	try {
		// First try with exact chatId match (DM session)
		const result = await auth.handleTelegramSessionCheck({
			telegramUserId: telegramUserId,
			telegramChatId: chatId,
		})
		if (result && result.authenticated) {
			const localSession = createOrRefreshSession(chatId)
			localSession.authSession = result
			return result
		}

		// If chatId didn't match (e.g. group chat vs DM), try without chatId
		// This allows DM sessions to work in group chats
		const fallbackResult = await auth.handleTelegramSessionCheck({
			telegramUserId: telegramUserId,
		})
		if (fallbackResult && fallbackResult.authenticated) {
			const localSession = createOrRefreshSession(chatId)
			localSession.authSession = fallbackResult
			return fallbackResult
		}
	} catch (err) {
		console.error("[telegram] checkAuthSession error:", err.message)
	}
	return null
}

/**
 * Gets the user's email from the auth module session.
 * @param {number} telegramUserId
 * @param {number} chatId
 * @returns {Promise<string|null>}
 */
async function getAuthEmail(telegramUserId, chatId) {
	try {
		const result = await auth.handleTelegramSessionCheck({
			telegramUserId: telegramUserId,
			telegramChatId: chatId,
		})
		if (result && result.authenticated && result.email) {
			return result.email
		}
	} catch (err) {
		console.error("[telegram] getAuthEmail error:", err.message)
	}
	return null
}

// ─── AI Chat Helper ────────────────────────────────────────────────────────

/**
 * Calls the AI provider to answer a support query.
 * Uses the same callChatCompletion pattern as the main API.
 *
 * @param {string} message - User's question
 * @param {Array} providers - List of provider configs with apiBaseUrl, apiKey, model
 * @returns {Promise<string>} AI response text
 */
// ─── Conversation Context ───────────────────────────────────────────────────
// Maintains per-chat conversation history for context-aware AI responses.
// Persisted to disk so it survives PM2 restarts and deploys.
// NOTE: conversationHistory, CONVERSATION_HISTORY_FILE, MAX_CONVERSATION_MESSAGES,
// and MAX_CONTEXT_MESSAGES are declared in the top-level state section (lines 79-88).

/**
 * Gets the conversation context for a given chat, returning the last N messages.
 * @param {number} chatId
 * @param {number} maxMessages - Max messages to include (default MAX_CONTEXT_MESSAGES)
 * @returns {Array} Array of {role, content} objects
 */
function getConversationContext(chatId, maxMessages) {
	if (maxMessages === undefined) maxMessages = MAX_CONTEXT_MESSAGES
	if (!conversationHistory.has(chatId)) {
		conversationHistory.set(chatId, [])
	}
	var history = conversationHistory.get(chatId)
	// Return last N messages
	return history.slice(-maxMessages)
}

/**
 * Adds a message to the conversation history for a given chat.
 * Persists to disk with debounce (5s) to avoid excessive writes.
 * @param {number} chatId
 * @param {string} role - "user" or "assistant"
 * @param {string} content
 */
function addToConversationContext(chatId, role, content) {
	if (!conversationHistory.has(chatId)) {
		conversationHistory.set(chatId, [])
	}
	var history = conversationHistory.get(chatId)
	history.push({
		role: role,
		content: content,
		timestamp: Date.now(),
	})
	// Keep only last MAX_CONVERSATION_MESSAGES to prevent memory bloat
	if (history.length > MAX_CONVERSATION_MESSAGES) {
		history.splice(0, history.length - MAX_CONVERSATION_MESSAGES)
	}
	// Debounce persist — save at most once per 5 seconds per chat
	scheduleConversationPersist(chatId)
}

/** Map<chatId, timeoutId> for debounced persist */
const _persistTimeouts = new Map()

/**
 * Schedules a debounced persist of conversation history for a chat.
 * @param {number|string} chatId
 */
function scheduleConversationPersist(chatId) {
	if (_persistTimeouts.has(chatId)) {
		clearTimeout(_persistTimeouts.get(chatId))
	}
	_persistTimeouts.set(
		chatId,
		setTimeout(function () {
			_persistTimeouts.delete(chatId)
			saveConversationHistory().catch(function (err) {
				console.error("[telegram] Failed to persist conversation history:", err.message)
			})
		}, 5000),
	)
}

/**
 * Loads conversation history from disk into memory.
 */
async function loadConversationHistory() {
	try {
		const data = await fs.readFile(CONVERSATION_HISTORY_FILE, "utf-8")
		const parsed = JSON.parse(data)
		var loadedCount = 0
		for (const [chatId, messages] of Object.entries(parsed)) {
			if (Array.isArray(messages) && messages.length > 0) {
				conversationHistory.set(String(chatId), messages)
				loadedCount += messages.length
			}
		}
		console.log(
			"[telegram] Loaded conversation history: " +
				loadedCount +
				" messages across " +
				conversationHistory.size +
				" chats",
		)
	} catch {
		console.log("[telegram] No conversation history file found, starting fresh")
	}
}

/**
 * Saves conversation history to disk.
 */
async function saveConversationHistory() {
	try {
		const dir = path.dirname(CONVERSATION_HISTORY_FILE)
		await fs.mkdir(dir, { recursive: true })
		var obj = {}
		for (const [chatId, messages] of conversationHistory.entries()) {
			obj[chatId] = messages
		}
		await fs.writeFile(CONVERSATION_HISTORY_FILE, JSON.stringify(obj), "utf-8")
	} catch (err) {
		console.error("[telegram] Failed to save conversation history:", err.message)
	}
}

/**
 * Register shutdown handlers to persist conversation history and state
 * before the process exits. This prevents data loss on PM2 restarts.
 */
function registerShutdownHandlers() {
	var persisted = false
	var persist = async function () {
		if (persisted) return
		persisted = true
		console.log("[telegram] Shutdown: persisting conversation history and state...")
		try {
			await saveConversationHistory()
		} catch (err) {
			console.error("[telegram] Shutdown: failed to persist conversation history:", err.message)
		}
		try {
			await persistState()
		} catch (err) {
			console.error("[telegram] Shutdown: failed to persist state:", err.message)
		}
		console.log("[telegram] Shutdown: persistence complete")
	}
	process.on("SIGINT", persist)
	process.on("SIGTERM", persist)
	process.on("exit", persist)
}

/** Debounce timeout for state persistence */
let _statePersistTimeout = null

/**
 * Persists activeSessions, pendingOtpSecrets, pendingEmailOtps, and userTasks to disk.
 * Called automatically after mutations (debounced).
 */
async function persistState() {
	try {
		const dir = path.dirname(TELEGRAM_BOT_STATE_FILE)
		await fs.mkdir(dir, { recursive: true })
		// Serialize smart context — convert Maps inside workflowHistory to plain objects
		var smartContextPlain = {}
		for (var [chatId, ctx] of _smartContext) {
			smartContextPlain[chatId] = {
				lastCommand: ctx.lastCommand,
				lastError: ctx.lastError,
				lastProject: ctx.lastProject,
				lastIntent: ctx.lastIntent,
				messageCount: ctx.messageCount,
				lastBrainResult: ctx.lastBrainResult,
				lastCommandOutput: ctx.lastCommandOutput,
				lastFixApplied: ctx.lastFixApplied,
				workflowHistory: ctx.workflowHistory || [],
			}
		}
		const state = {
			activeSessions: Object.fromEntries(activeSessions),
			pendingOtpSecrets: Object.fromEntries(pendingOtpSecrets),
			pendingEmailOtps: Object.fromEntries(pendingEmailOtps),
			userTasks: Object.fromEntries(userTasks),
			smartContext: smartContextPlain,
			userContext: Object.fromEntries(_userContext),
		}
		await fs.writeFile(TELEGRAM_BOT_STATE_FILE, JSON.stringify(state), "utf-8")
	} catch (err) {
		console.error("[telegram] Failed to persist state:", err.message)
	}
}

/**
 * Loads persisted state from disk into the in-memory Maps.
 * Called once at startup.
 */
/**
 * Register shutdown handlers to persist conversation history and state
 * before the process exits. This prevents data loss on PM2 restarts.
 */
function registerShutdownHandlers() {
	var persisted = false
	var persist = async function () {
		if (persisted) return
		persisted = true
		console.log("[telegram] Shutdown: persisting conversation history and state...")
		try {
			await saveConversationHistory()
		} catch (err) {
			console.error("[telegram] Shutdown: failed to persist conversation history:", err.message)
		}
		try {
			await persistState()
		} catch (err) {
			console.error("[telegram] Shutdown: failed to persist state:", err.message)
		}
		console.log("[telegram] Shutdown: persistence complete")
	}
	process.on("SIGINT", persist)
	process.on("SIGTERM", persist)
	process.on("exit", persist)
}

async function loadState() {
	try {
		const data = await fs.readFile(TELEGRAM_BOT_STATE_FILE, "utf-8")
		const parsed = JSON.parse(data)
		if (parsed.activeSessions) {
			for (const [k, v] of Object.entries(parsed.activeSessions)) {
				activeSessions.set(k, v)
			}
		}
		if (parsed.pendingOtpSecrets) {
			for (const [k, v] of Object.entries(parsed.pendingOtpSecrets)) {
				pendingOtpSecrets.set(k, v)
			}
		}
		if (parsed.pendingEmailOtps) {
			for (const [k, v] of Object.entries(parsed.pendingEmailOtps)) {
				pendingEmailOtps.set(k, v)
			}
		}
		if (parsed.userTasks) {
			for (const [k, v] of Object.entries(parsed.userTasks)) {
				if (Array.isArray(v)) userTasks.set(k, v)
			}
		}
		// Restore smart context with TTL check (expire entries older than 24h)
		if (parsed.smartContext) {
			var smartContextTtl = 24 * 60 * 60 * 1000
			var now = Date.now()
			var restoredCount = 0
			var expiredCount = 0
			for (var [chatId, ctx] of Object.entries(parsed.smartContext)) {
				// Check if context has a timestamp; if not, keep it (legacy entry)
				if (ctx._timestamp && now - ctx._timestamp > smartContextTtl) {
					expiredCount++
					continue
				}
				_smartContext.set(chatId, {
					lastCommand: ctx.lastCommand || null,
					lastError: ctx.lastError || null,
					lastProject: ctx.lastProject || null,
					lastIntent: ctx.lastIntent || null,
					messageCount: ctx.messageCount || 0,
					lastBrainResult: ctx.lastBrainResult || null,
					lastCommandOutput: ctx.lastCommandOutput || null,
					lastFixApplied: ctx.lastFixApplied || null,
					workflowHistory: Array.isArray(ctx.workflowHistory) ? ctx.workflowHistory : [],
				})
				restoredCount++
			}
			if (restoredCount > 0 || expiredCount > 0) {
				console.log(
					"[telegram] Restored " +
						restoredCount +
						" smart context entries" +
						(expiredCount > 0 ? ", expired " + expiredCount : ""),
				)
			}
		}
		// Restore user context (cross-session memory)
		if (parsed.userContext) {
			var userCtxTtl = 7 * 24 * 60 * 60 * 1000 // 7 days TTL for user context
			var now = Date.now()
			var restoredUserCtx = 0
			var expiredUserCtx = 0
			for (var [uid, uctx] of Object.entries(parsed.userContext)) {
				if (uctx._timestamp && now - uctx._timestamp > userCtxTtl) {
					expiredUserCtx++
					continue
				}
				_userContext.set(uid, uctx)
				restoredUserCtx++
			}
			if (restoredUserCtx > 0 || expiredUserCtx > 0) {
				console.log(
					"[telegram] Restored " +
						restoredUserCtx +
						" user context entries" +
						(expiredUserCtx > 0 ? ", expired " + expiredUserCtx : ""),
				)
			}
		}
		console.log(
			"[telegram] Loaded state: " +
				activeSessions.size +
				" sessions, " +
				pendingOtpSecrets.size +
				" OTP secrets, " +
				pendingEmailOtps.size +
				" email OTPs, " +
				userTasks.size +
				" user task lists, " +
				_userContext.size +
				" user context entries",
		)
	} catch {
		console.log("[telegram] No state file found, starting fresh")
	}
}

/**
 * Schedules a debounced persist of bot state.
 */
function scheduleStatePersist() {
	if (_statePersistTimeout) {
		clearTimeout(_statePersistTimeout)
	}
	_statePersistTimeout = setTimeout(function () {
		_statePersistTimeout = null
		persistState().catch(function (err) {
			console.error("[telegram] Failed to persist state:", err.message)
		})
	}, 2000)
}

/**
 * Builds a concise conversation summary string from recent history.
 * Used to pass context to BullMQ worker jobs that don't have access to the
 * in-memory conversationHistory Map.
 * @param {number|string} chatId
 * @param {number} maxMessages - Max recent messages to summarize
 * @returns {string} A plain-text summary of the conversation
 */
function buildConversationSummary(chatId, maxMessages) {
	if (maxMessages === undefined) maxMessages = 15
	var history = conversationHistory.get(chatId)
	if (!history || history.length === 0) return ""

	var recent = history.slice(-maxMessages)
	var lines = []

	// Add smart context (last command, intent, error, project)
	var smartCtx = getSmartContext(chatId)
	if (smartCtx) {
		if (smartCtx.lastCommand) lines.push("[Context] Last command: " + smartCtx.lastCommand)
		if (smartCtx.lastIntent) lines.push("[Context] Last intent: " + smartCtx.lastIntent)
		if (smartCtx.lastError) lines.push("[Context] Last error: " + smartCtx.lastError.substring(0, 200))
		if (smartCtx.lastProject) lines.push("[Context] Active project: " + smartCtx.lastProject)
		if (smartCtx.lastFixApplied)
			lines.push("[Context] Last fix applied: " + smartCtx.lastFixApplied.substring(0, 200))
		if (smartCtx.workflowHistory && smartCtx.workflowHistory.length > 0) {
			var recentWorkflows = smartCtx.workflowHistory.slice(-3)
			for (var w = 0; w < recentWorkflows.length; w++) {
				lines.push(
					"[Workflow] " + (recentWorkflows[w].type || "task") + ": " + (recentWorkflows[w].status || "?"),
				)
			}
		}
	}

	// Add learned patterns from telegramLearner for richer context
	try {
		var userPatterns = telegramLearner.getUserPatterns(String(chatId))
		if (userPatterns && userPatterns.length > 0) {
			var topPatterns = userPatterns.slice(0, 3)
			lines.push(
				"[Learned Patterns] User frequently does: " +
					topPatterns
						.map(function (p) {
							return p.intent + " (" + p.count + " times, keywords: " + p.topKeywords.join(", ") + ")"
						})
						.join("; "),
			)
		}
	} catch (e) {
		// Non-fatal
	}

	// Add conversation messages
	for (var i = 0; i < recent.length; i++) {
		var msg = recent[i]
		var prefix = msg.role === "user" ? "User" : "Assistant"
		var content = msg.content.slice(0, 300) // Increased from 200 to 300 chars
		lines.push(prefix + ": " + content)
	}
	return "=== Recent Conversation History ===\n" + lines.join("\n") + "\n=== End of History ==="
}

/**
 * Builds an LLM-compressed conversation summary when history exceeds threshold.
 * Uses Ollama (free, local) to generate a 3-5 sentence compressed summary of
 * key decisions, open questions, and resolved items. Falls back to the regular
 * buildConversationSummary() if Ollama is unavailable.
 */
async function buildCompressedConversationSummary(chatId, providers) {
	var history = conversationHistory.get(chatId)
	if (!history || history.length === 0) return ""

	// For short conversations, use the regular summary
	if (history.length <= 15) {
		return buildConversationSummary(chatId, 15)
	}

	// For long conversations, try LLM compression
	var recentMessages = history.slice(-20)
	var rawText = recentMessages
		.map(function (m) {
			return (m.role === "user" ? "User" : "Assistant") + ": " + m.content.slice(0, 500)
		})
		.join("\n")

	try {
		var compressed = await _callOllamaChat(
			[
				{
					role: "system",
					content:
						"Summarize this conversation in 3-5 sentences. Focus on: key decisions made, open questions, " +
						"what the user is trying to accomplish, and any errors or blockers. Be concise and factual.",
				},
				{ role: "user", content: rawText },
			],
			{ num_predict: 512, temperature: 0.3 },
		)
		if (compressed && compressed.trim()) {
			return (
				"=== Compressed Conversation Summary ===\n" +
				compressed.trim() +
				"\n\n(Summary generated from last " +
				recentMessages.length +
				" messages)" +
				"\n=== End of Summary ==="
			)
		}
	} catch (e) {
		// Fall through to regular summary
	}

	// Fallback: use regular summary
	return buildConversationSummary(chatId, 15)
}

/**
 * ─── Chat Logging ───────────────────────────────────────────────────────────
 * Writes every conversation exchange to a daily log file for agent monitoring.
 * The log is structured as JSONL (one JSON object per line) for easy parsing.
 * An external monitoring agent reads these logs daily to identify improvement
 * opportunities and trigger code/skill upgrades.
 */

/** Directory for daily chat logs */
const CHAT_LOG_DIR = path.join(__dirname, "..", "data", "chat-logs")

/**
 * Gets the log file path for today's date.
 * @returns {string} Path like ".../data/chat-logs/2026-05-10.jsonl"
 */
function getDailyChatLogPath() {
	var now = new Date()
	var y = now.getFullYear()
	var m = String(now.getMonth() + 1).padStart(2, "0")
	var d = String(now.getDate()).padStart(2, "0")
	return path.join(CHAT_LOG_DIR, y + "-" + m + "-" + d + ".jsonl")
}

/**
 * Logs a conversation exchange to the daily chat log file.
 * Each line is a JSON object with: timestamp, chatId, role, content, intent, metadata.
 * @param {number|string} chatId
 * @param {string} role - "user" | "assistant" | "system"
 * @param {string} content
 * @param {object} [metadata] - Optional extra data (intent, command, error, etc.)
 */
async function logChatExchange(chatId, role, content, metadata) {
	try {
		var dir = CHAT_LOG_DIR
		await fs.mkdir(dir, { recursive: true })
		var logPath = getDailyChatLogPath()
		var entry = JSON.stringify({
			t: Date.now(),
			c: String(chatId),
			r: role,
			msg: content.slice(0, 2000), // Truncate very long messages
			m: metadata || {},
		})
		await fs.appendFile(logPath, entry + "\n", "utf-8")
	} catch (err) {
		// Silently fail — logging should never break the bot
		console.error("[telegram] Chat log write error:", err.message)
	}
}

/**
 * Builds the system prompt for the AI assistant with full system knowledge.
 * Includes the Telegram Agent role definition for read-only support/consultation.
 * @returns {string} The system prompt
 */
/**
 * Builds the base system prompt for the Telegram AI assistant.
 * This is the static knowledge base — dynamic context (workspace state,
 * orchestrator status, HermesClaw memory) is appended at call time.
 */
function buildSystemPrompt() {
	return (
		"You are OpenClaw — the SuperRoo Telegram AI Agent. You are the smartest, most capable AI in the SuperRoo system. " +
		"Your role is to provide expert-level support, consultation, analysis, and recommendations to the user. " +
		"You have deep knowledge of the entire SuperRoo system architecture, all 19 modules, cloud infrastructure, and capabilities. " +
		"You are a READ-ONLY agent — you cannot make code changes, deploy, or modify files. " +
		"For coding, debugging, deployment, or testing tasks, you route those to the appropriate specialist agents.\n\n" +
		"## Your Capabilities\n" +
		"- Answer ANY question about the SuperRoo system with expert-level detail\n" +
		"- Provide recommendations on architecture, technology choices, best practices\n" +
		"- Analyze code, bugs, and system behavior\n" +
		"- Research topics and provide structured, professional analysis\n" +
		"- Maintain conversation context — remember what was discussed earlier in this conversation\n" +
		"- Route coding/debugging/deploy/testing tasks to specialist agents\n" +
		"- Learn from conversations to improve future responses\n" +
		"- **Proactive suggestions**: After answering, suggest 2-3 follow-up actions the user might want to take\n" +
		"- **Context-aware**: You know what the user was just working on and can reference it naturally\n\n" +
		"## Conversation Flow Guidelines\n" +
		"- You have access to the FULL conversation history. Read it carefully before responding.\n" +
		'- Reference previous messages naturally: "As you mentioned earlier...", "Following up on your previous question about...", "Building on what we discussed..."\n' +
		'- If the user says "this", "that", "it", or refers to something without context, look at the conversation history to understand what they mean.\n' +
		"- Maintain continuity: if you gave advice in a previous message, refer back to it when the user follows up.\n" +
		"- Ask clarifying questions if the user's intent is ambiguous, but first check if the answer is in the conversation history.\n" +
		"- When the user asks about a task that was just created (coding, debugging, deploy), acknowledge it and provide status.\n" +
		"- Be conversational and natural — don't restart the conversation from scratch each time.\n" +
		"- **Summarize context**: If the conversation is long, briefly summarize what was discussed before answering.\n" +
		"- **Proactive follow-ups**: At the end of your response, suggest 2-3 relevant next steps or questions the user might want to explore.\n\n" +
		"## Response Format\n" +
		"- Use Telegram markdown: *bold*, `code`, ```code blocks```, _italic_\n" +
		"- Structure long responses with headings and bullet points for readability\n" +
		"- When showing code, always use ```language blocks with syntax highlighting\n" +
		"- Use emojis sparingly but meaningfully: 🛠️ for fixes, 🚀 for deploys, 🔍 for debugging, 📊 for stats\n" +
		"- Keep responses concise — Telegram is a chat platform, not a document\n" +
		"- If the answer is long, provide a summary first then offer to expand\n" +
		"- **CRITICAL: When the user asks you to DO something (upgrade, improve, fix, deploy, code, debug), do NOT write a long analysis. Instead, immediately route to the appropriate specialist agent and respond with a brief confirmation (2-3 sentences max). Long analysis when action is needed frustrates the user.**\n" +
		"- **CRITICAL: When the user says 'upgrade yourself', 'improve yourself', 'make yourself smarter', or 'coder to upgrade you', do NOT analyze the request. Immediately acknowledge and route to the Coder agent. Your response should be: '🔄 Upgrading... [brief description]' followed by routing.**\n\n" +
		"## SuperRoo System Architecture\n\n" +
		"The SuperRoo system is organized into 19 core modules:\n\n" +
		"### 1. Orchestrator\n" +
		"- Task routing, agent lifecycle management, workflow orchestration\n" +
		"- Source: src/super-roo/orchestrator/\n\n" +
		"### 2. Agent System\n" +
		"- Coder Agent: Code generation & implementation\n" +
		"- Debugger Agent: Bug investigation & root cause analysis\n" +
		"- PM Agent: Product management & feature tracking\n" +
		"- Tester Agent: Test execution & quality gates\n" +
		"- Supabase Agent: Database operations\n" +
		"- Self-Healing Agent: Autonomous incident response\n" +
		"- Source: src/super-roo/agents/\n\n" +
		"### 3. Safety System\n" +
		"- Autonomy level enforcement (OFF -> SAFE -> AUTO -> FULL_AUTONOMOUS)\n" +
		"- Capability gating, blocklist filtering\n" +
		"- Source: src/super-roo/safety/\n\n" +
		"### 4. Memory System\n" +
		"- SQLite persistence, CRUD for all entities, event sourcing\n" +
		"- Source: src/super-roo/memory/\n\n" +
		"### 5. Task Queue\n" +
		"- Priority queuing, job retry & backoff, concurrency control\n" +
		"- BullMQ integration\n" +
		"- Source: src/super-roo/queue/\n\n" +
		"### 6. Event Log\n" +
		"- Event streaming, observability, audit trail\n" +
		"- Source: src/super-roo/logging/\n\n" +
		"### 7. Feature Registry\n" +
		"- Feature lifecycle tracking (planned -> building -> testing -> working -> deprecated)\n" +
		"- Health monitoring (unknown -> healthy -> degraded -> failing)\n" +
		"- Bug-to-feature mapping\n" +
		"- Source: src/super-roo/features/\n\n" +
		"### 8. Bug Registry\n" +
		"- Bug recording & tracking, severity classification, fix attempt history\n" +
		"- Source: src/super-roo/bugs/\n\n" +
		"### 9. Self-Healing System\n" +
		"- Healing Bus: Incident coordination hub\n" +
		"- Root Cause Classifier: Pattern-based classification\n" +
		"- Repair Plan Builder: Structured fix generation\n" +
		"- Self-Healing Loop: detect -> classify -> plan -> fix -> verify\n" +
		"- Source: src/super-roo/healing/\n\n" +
		"### 10. Machine Learning Engine\n" +
		"- Neural network training, code/debug/test pattern learning\n" +
		"- Infinite improvement loop\n" +
		"- Source: src/super-roo/ml/\n\n" +
		"### 11. Product Memory\n" +
		"- Product Feature Agent, Product Updates Agent\n" +
		"- Feature Tester Agent, Bug-Feature Mapper\n" +
		"- Commit & Deploy Log: Centralized audit trail\n" +
		"- Source: src/super-roo/product-memory/\n\n" +
		"### 12. Commit & Deploy Log\n" +
		"- Centralized commit recording, deploy lifecycle tracking\n" +
		"- Health check verification, rollback tracking\n" +
		"- Agent-aware audit trail, feature-linked commits\n" +
		"- Source: src/super-roo/product-memory/CommitDeployLog.ts\n\n" +
		"### 13. Parallel Execution Engine\n" +
		"- Parallel task execution, inter-agent messaging\n" +
		"- Parallel healing pipeline, parallel ML training\n" +
		"- Source: src/super-roo/parallel/\n\n" +
		"### 14. CPU Guard\n" +
		"- CPU usage monitoring, autonomous task throttling\n" +
		"- Resource-aware scheduling\n" +
		"- Source: src/super-roo/cpu-guard/\n\n" +
		"### 15. Deploy System\n" +
		"- GitHub Actions dispatch, VPS SSH deployment\n" +
		"- Rollback management, health check verification\n" +
		"- Source: src/super-roo/deploy/\n\n" +
		"### 16. Crawler Agent\n" +
		"- Web crawling, entity extraction, signal detection\n" +
		"- Source: src/super-roo/crawler/\n\n" +
		"### 17. File Importer\n" +
		"- File import, content extraction, type validation\n" +
		"- Source: src/super-roo/import/\n\n" +
		"### 18. Remote Shell\n" +
		"- SSH command execution, remote file operations\n" +
		"- Source: src/super-roo/remote/\n\n" +
		"### 19. Settings & API Keys System\n" +
		"- Provider API key management, encrypted secret storage (AES-256-GCM)\n" +
		"- Real provider connection testing, agent routing sync\n" +
		"- VPS control center (auto-approve, MCP, guardrails)\n" +
		"- Source: cloud/api/api.js, cloud/dashboard/src/components/views/\n\n" +
		"## Cloud Infrastructure\n" +
		"- API Server: Port 8787, BullMQ queue, Redis backend\n" +
		"- Worker: Processes jobs from queue, runs in Docker sandbox\n" +
		"- Dashboard: Next.js app on port 3001\n" +
		"- VPS: 104.248.225.250, nginx reverse proxy at dev.abcx124.xyz\n" +
		"- PM2 process management with ecosystem.config.js\n\n" +
		"## Telegram Bot Commands\n" +
		"- /code <instruction> - Create a coding task\n" +
		"- /ask <question> - Ask the AI support assistant\n" +
		"- /diff <taskId> - Show changed files\n" +
		"- /test <taskId> - Run test suite\n" +
		"- /approve <taskId> - Approve pending changes\n" +
		"- /deploy <taskId> - Deploy approved build (OTP required)\n" +
		"- /status [taskId] - Check system or task status\n" +
		"- /session - Check active session\n" +
		"- /otp - Set up Google Authenticator\n" +
		"- /logs [n] - View recent logs\n" +
		"- /projects - List and select projects\n" +
		"- /workspace - Show active workspace\n" +
		"- /help - Show all commands\n\n" +
		"## Dashboard Pages\n" +
		"- Overview: System health, queue stats, recent activity\n" +
		"- Jobs: Job queue management\n" +
		"- Queue: Queue monitoring\n" +
		"- Agents: Agent management\n" +
		"- Model Router: AI provider routing configuration\n" +
		"- API Keys: Provider key management\n" +
		"- Settings: VPS control center\n" +
		"- Approvals: Approval workflow\n" +
		"- Telegram: Telegram bot monitoring\n" +
		"- GitHub: Repository management\n" +
		"- Docker: Container management\n" +
		"- Logs: System logs\n" +
		"- Bugs: Bug tracking\n" +
		"- Working Tree: Architecture visualization\n" +
		"- Projects: Project management\n" +
		"- AI Assistant: AI chat interface\n" +
		"- Skill Generator: Skill generation\n" +
		"- IDE Terminal: Remote terminal"
	)
}

/**
 * Enhanced AI assistant with conversation context, ML learning, and recommendation capabilities.
 * Maintains per-chat conversation history for context-aware responses.
 * Records interactions to the Telegram Learner for continuous improvement.
 * Can provide expert recommendations, analysis, and consultation.
 *
 * @param {string} message - The user's message
 * @param {Array} providers - Array of AI provider configs
 * @param {number} [chatId] - Optional chat ID for conversation context
 * @returns {string} AI response
 */
/**
 * Enhanced AI assistant with HermesClaw memory recall, conversation context,
 * ML learning, and proactive suggestion capabilities.
 *
 * Key improvements over the basic version:
 * 1. HermesClaw context recall — injects relevant past experiences into the prompt
 * 2. Smart context injection — workspace state, recent errors, active tasks
 * 3. Proactive suggestions — appends 2-3 follow-up suggestions to every response
 * 4. Conversation summarization — keeps context manageable by summarizing long histories
 *
 * @param {string} message - The user's message
 * @param {Array} providers - Array of AI provider configs
 * @param {number} [chatId] - Optional chat ID for conversation context
 * @param {object} [options] - Optional settings
 * @param {boolean} [options.includeSuggestions=true] - Whether to append proactive suggestions
 * @returns {string} AI response
 */
async function askAI(message, providers, chatId, options) {
	if (!options) options = {}
	var includeSuggestions = options.includeSuggestions !== false

	// Build messages array with conversation context if chatId is provided
	var messages = []

	// ── Step 1: Build dynamic system prompt with smart context ──────────
	var systemPrompt = buildSystemPrompt()

	// Detect conversation topic before building context
	if (chatId !== undefined && chatId !== null) {
		detectConversationTopic(chatId)
	}

	// Append smart context (workspace state, recent errors, active tasks)
	if (chatId !== undefined && chatId !== null) {
		var smartCtx = buildSmartContextPrompt(chatId)
		if (smartCtx) {
			systemPrompt += "\n\n## Current Session Context\n" + smartCtx
		}

		// Add conversation summary if history is long
		var context = getConversationContext(chatId)
		if (context.length > 10) {
			var summary = buildConversationSummary(chatId, 10)
			if (summary) {
				systemPrompt += "\n\n## Recent Conversation Summary\n" + summary
			}
		}
	}

	// ── Step 2: HermesClaw memory recall ───────────────────────────────
	// Inject relevant past experiences from HermesClaw's memory store
	var hermesContext = ""
	try {
		// Access orchestrator via global reference (set during init in api.js)
		var orchestrator = global.__orchestrator
		if (orchestrator && orchestrator.hermesClaw) {
			var recallResult = await orchestrator.hermesClaw.recallContext(message, 3)
			if (recallResult && recallResult.output) {
				hermesContext = recallResult.output.substring(0, 1000)
				systemPrompt += "\n\n## Relevant Past Experience (from HermesClaw memory)\n" + hermesContext
			}
		}
	} catch (hermesErr) {
		// Non-blocking — HermesClaw is advisory
		console.log("[telegram] HermesClaw context recall failed (non-fatal):", hermesErr.message)
	}

	messages.push({
		role: "system",
		content: systemPrompt,
	})

	// ── Step 3: Add conversation history ────────────────────────────────
	if (chatId !== undefined && chatId !== null) {
		var context = getConversationContext(chatId)
		for (var ci = 0; ci < context.length; ci++) {
			messages.push({
				role: context[ci].role,
				content: context[ci].content,
			})
		}
	}

	// ── Step 4: Add current user message ────────────────────────────────
	messages.push({ role: "user", content: message })

	// ── Step 4b: Check response cache (GAP 3.4) ─────────────────────────
	// Cache the message hash for potential cache lookup if all providers fail.
	// The actual lookup happens at the end if all providers are down.
	var _cachedResponse = _getCachedResponse(message, chatId)

	// ── Step 5: Try Ollama (local, FREE) first ─────────────────────────
	// Uses shared _callOllamaChat helper which uses http.request instead of fetch
	// because Node.js 20's built-in fetch (undici) has a default headersTimeout of ~20s,
	// but Ollama can take ~30s on cold start.
	var ollamaStart = Date.now()
	var ollamaReply = await _callOllamaChat(messages, { num_predict: 4096 })
	if (ollamaReply) {
		console.log("[telegram] askAI handled by Ollama (FREE)")
		providerMetrics.fallbackChain.ollamaFirst++
		providerMetrics.fallbackChain.ollamaFirstOk++
		logProviderAttempt("ollama", true, Date.now() - ollamaStart)
		// Cache the response for provider outage fallback (GAP 3.4)
		_cacheResponse(message, ollamaReply, chatId, "ollama")
		return ollamaReply
	}
	console.log("[telegram] Ollama unavailable, falling back to cloud API")
	providerMetrics.fallbackChain.ollamaFirst++
	logProviderAttempt("ollama", false, Date.now() - ollamaStart)

	// ── Step 6: Try each cloud provider in order ────────────────────────
	for (var i = 0; i < providers.length; i++) {
		var provider = providers[i]
		if (!provider.apiKey) continue
		var cloudStart = Date.now()
		try {
			var url = provider.apiBaseUrl.replace(/\/+$/, "") + "/chat/completions"
			var res = await fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer " + provider.apiKey,
				},
				body: JSON.stringify({
					model: provider.model,
					messages: messages,
					max_tokens: 4096,
					temperature: 0.7,
				}),
				signal: AbortSignal.timeout(120_000),
			})
			if (!res.ok) {
				var errBody = ""
				try {
					errBody = await res.text()
				} catch (e) {}
				console.error(
					"[telegram] askAI error from " +
						provider.providerId +
						": " +
						res.status +
						" " +
						errBody.slice(0, 100),
				)
				providerMetrics.fallbackChain.cloudAttempted++
				logProviderAttempt(provider.providerId || "cloud_" + i, false, Date.now() - cloudStart)
				continue
			}
			var data = await res.json()
			var reply = data.choices[0].message.content || "(no response)"

			providerMetrics.fallbackChain.cloudAttempted++
			providerMetrics.fallbackChain.cloudOk++
			logProviderAttempt(provider.providerId || "cloud_" + i, true, Date.now() - cloudStart)

			// ── Step 6b: Append proactive suggestions ─────────────────────
			// Ask the AI to generate follow-up suggestions as part of the response
			if (includeSuggestions && chatId !== undefined && chatId !== null) {
				var suggestionPrompt = [
					{
						role: "system",
						content:
							"Based on the conversation above, suggest 2-3 short follow-up actions the user might want to take. " +
							"Format as a bullet list with each item being a complete command or question the user could send. " +
							"Keep each suggestion under 60 characters. Prefix with '💡 '.",
					},
					{ role: "user", content: "Suggest follow-ups for: " + message },
				]
				try {
					var suggestionRes = await fetch(url, {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							Authorization: "Bearer " + provider.apiKey,
						},
						body: JSON.stringify({
							model: provider.model,
							messages: suggestionPrompt,
							max_tokens: 200,
							temperature: 0.5,
						}),
						signal: AbortSignal.timeout(10_000),
					})
					if (suggestionRes.ok) {
						var suggestionData = await suggestionRes.json()
						var suggestions = suggestionData.choices[0].message.content || ""
						if (suggestions) {
							reply += "\n\n" + suggestions
						}
					}
				} catch (suggestionErr) {
					// Non-fatal — don't break the response
					console.log("[telegram] Failed to generate suggestions:", suggestionErr.message)
				}
			}

			// ── Step 7: Record to conversation context ────────────────────
			if (chatId !== undefined && chatId !== null) {
				addToConversationContext(chatId, "user", message)
				addToConversationContext(chatId, "assistant", reply)
			}

			// Log the exchange to daily chat log for agent monitoring
			logChatExchange(chatId, "user", message, { intent: "ask" }).catch(function () {})
			logChatExchange(chatId, "assistant", reply, { provider: provider.providerId }).catch(function () {})

			// Record interaction to Telegram Learner for ML improvement
			try {
				if (telegramLearner && typeof telegramLearner.recordInteraction === "function") {
					telegramLearner.recordInteraction({
						chatId: chatId || 0,
						message: message,
						response: reply,
						provider: provider.providerId || "unknown",
						model: provider.model || "unknown",
						timestamp: Date.now(),
						intent: "ask",
					})
				}
			} catch (learnErr) {
				// Non-fatal — don't break the response
				console.error("[telegram] Failed to record learner interaction:", learnErr.message)
			}

			// ── Step 8: Fire-and-forget HermesClaw lesson extraction ──────
			try {
				var orch = global.__orchestrator
				if (orch && orch.hermesClaw) {
					orch.hermesClaw
						.extractLessons({
							phases: [
								{
									name: "telegram-conversation",
									description: "Telegram chat with user",
									output: reply.substring(0, 500),
								},
							],
							success: true,
							context: {
								source: "telegram",
								chatId: chatId,
								message: message.substring(0, 200),
							},
						})
						.catch(function (extractErr) {
							console.log("[telegram] HermesClaw lesson extraction failed:", extractErr.message)
						})
				}
			} catch (extractErr) {
				// Non-fatal
				console.log("[telegram] HermesClaw lesson extraction error:", extractErr.message)
			}

			// Cache the response for provider outage fallback (GAP 3.4)
			_cacheResponse(message, reply, chatId, provider.providerId || "cloud")

			return reply
		} catch (err) {
			var errorDetail =
				err.name === "TimeoutError" || err.name === "AbortError" ? "timeout after 120s" : err.message
			console.error("[telegram] askAI network error with " + provider.providerId + ":", errorDetail)
			providerMetrics.fallbackChain.cloudAttempted++
			logProviderAttempt(provider.providerId || "cloud_" + i, false, Date.now() - cloudStart)
			continue
		}
	}

	// ── Step 5b: Offline fallback — try local Ollama when all cloud providers fail ──
	// This enables the RAG learning loop: Ollama retrieves similar past fixes from
	// pgvector and uses them as context to generate a response.
	console.log("[telegram] All cloud providers failed — trying local Ollama fallback")

	// Inject RAG context from BugKnowledgeStore before calling Ollama
	try {
		var { BugKnowledgeStore } = require("../orchestrator/stores/BugKnowledgeStore")
		var ragStore = new BugKnowledgeStore()
		await ragStore.init()
		var ragContext = await ragStore.buildRagContext(message, { maxResults: 3, threshold: 0.4 })
		if (ragContext) {
			messages.unshift({
				role: "system",
				content: "Here are similar past fixes from the knowledge base that may be relevant:\n\n" + ragContext,
			})
			console.log("[telegram] Injected RAG context (" + ragContext.length + " chars) into Ollama fallback")
		}
		await ragStore.close()
	} catch (err) {
		console.log("[telegram] RAG context unavailable for Ollama fallback (non-fatal): " + err.message)
	}

	var ollamaRagStart = Date.now()
	var ollamaReply = await _callOllamaChat(messages, { num_predict: 2048 })

	if (ollamaReply) {
		// Log the exchange
		if (chatId !== undefined && chatId !== null) {
			addToConversationContext(chatId, "user", message)
			addToConversationContext(chatId, "assistant", ollamaReply)
		}
		logChatExchange(chatId, "user", message, { intent: "ask" }).catch(function () {})
		logChatExchange(chatId, "assistant", ollamaReply, { provider: "ollama" }).catch(function () {})

		console.log("[telegram] Ollama offline fallback succeeded for chat " + chatId)
		providerMetrics.fallbackChain.ollamaRagFallback++
		providerMetrics.fallbackChain.ollamaRagOk++
		logProviderAttempt("ollama_rag", true, Date.now() - ollamaRagStart)
		// Cache the response for provider outage fallback (GAP 3.4)
		_cacheResponse(message, ollamaReply, chatId, "ollama_rag")
		return ollamaReply + "\n\n_(responded via local Ollama — cloud AI providers were unavailable)_"
	} else {
		console.error("[telegram] Ollama fallback returned no response")
		providerMetrics.fallbackChain.ollamaRagFallback++
		logProviderAttempt("ollama_rag", false, Date.now() - ollamaRagStart)
	}

	providerMetrics.fallbackChain.allFailed++

	// ── Step 9: Try response cache as last resort (GAP 3.4) ─────────────
	// If all providers failed AND we have a cached response, serve it
	// with a disclaimer about the provider outage.
	if (_cachedResponse) {
		var ageMinutes = Math.round(_cachedResponse.age / 60000)
		console.log(
			"[telegram] All providers failed — serving cached response from " +
				_cachedResponse.provider +
				" (" +
				ageMinutes +
				"m old)",
		)
		return (
			"⚠️ *AI providers are currently unavailable.*\n\n" +
			"Here's a cached response from " +
			ageMinutes +
			" minutes ago (via " +
			_cachedResponse.provider +
			"):\n\n" +
			_cachedResponse.response
		)
	}

	var triedProviders = providers
		.filter(function (p) {
			return p.apiKey
		})
		.map(function (p) {
			return p.providerId || p.name
		})
		.join(", ")
	return (
		"Sorry, I couldn't reach any AI provider (" +
		(triedProviders || "none configured") +
		"). Please check that API keys are configured and working in the dashboard (API Keys tab). DeepSeek is the primary provider — if it's experiencing high traffic, try again later."
	)
}

// ─── Command Handlers ──────────────────────────────────────────────────────

/**
 * Handles /ask <question> - AI-powered support assistant.
 */
async function handleAsk(botToken, chatId, args, providers) {
	var question = args.join(" ")
	if (!question) {
		await sendMessage(
			botToken,
			chatId,
			"*SuperRoo AI Assistant*\n\nAsk me anything about SuperRoo! I have knowledge of the entire system architecture, modules, features, and capabilities.\n\nExample: `/ask where is the self-healing code located?`\nExample: `/ask what modules does the agent system connect to?`\nExample: `/ask how do I deploy to the VPS?`",
		)
		return
	}

	await sendChatAction(botToken, chatId, "typing")
	console.log("[telegram] AI query from " + chatId + ": " + question.slice(0, 100))

	// Inject workspace context even in fallback mode so unauthenticated chat still
	// answers about the right project.
	var askBoundWs = groupWorkspaces.get(String(chatId))
	if (askBoundWs) {
		var askCtx = getSmartContext(chatId)
		question =
			"[Context: This Telegram group is linked to the project '" +
			askBoundWs +
			"'" +
			(askCtx.activeFile ? ", active file: " + askCtx.activeFile : "") +
			". Answer specifically about that project, not SuperRoo itself.]\n\n" +
			question
	}

	var reply = await askAI(question, providers, chatId)
	await sendMessage(botToken, chatId, reply)
}

/**
 * Consultant Agent — does research, creates skills.md and resources.md, and returns a professional answer.
 * Used when the user asks about feature viability, architecture decisions, best practices, etc.
 * Other agents (debugger, deployer, coder) can also invoke the consultant when they need expertise.
 *
 * @param {string} botToken
 * @param {number} chatId
 * @param {string} question - The user's research/consultation question
 * @param {Array} providers - AI provider configs
 * @param {object} [options] - Optional parameters
 * @param {string} [options.requestingAgent] - Which agent requested the consultation (e.g., "debugger", "coder")
 * @param {string} [options.projectId] - Project ID if available
 * @param {number} [options.telegramUserId] - Telegram user ID for auth
 */
async function handleConsultant(botToken, chatId, question, providers, options) {
	if (!question) {
		await sendMessage(
			botToken,
			chatId,
			"*Consultant Agent* 🧠\n\nI can research and analyze any topic to give you professional, well-informed advice. Just ask me anything!\n\n" +
				"*Examples:*\n" +
				'• "Should I use PostgreSQL or MongoDB for my project?"\n' +
				'• "Analyze the pros and cons of microservices architecture"\n' +
				'• "What\'s the best tech stack for a real-time chat app?"\n' +
				'• "Research best practices for API rate limiting"\n' +
				'• "Compare React vs Vue for enterprise applications"',
		)
		return
	}

	await sendChatAction(botToken, chatId, "typing")

	console.log("[telegram] Consultant query from " + chatId + ": " + question.slice(0, 100))

	// ─── Phase 1: Research ──────────────────────────────────────────────
	// Use AI with a research-oriented system prompt to gather comprehensive knowledge
	var researchPrompt =
		"You are a Senior Consultant and Subject Matter Expert. Your role is to provide deep, " +
		"well-researched, professional analysis on any topic. Follow this methodology:\n\n" +
		"1. **Research Phase**: Analyze the question thoroughly. Consider multiple perspectives, " +
		"industry best practices, common pitfalls, and emerging trends.\n" +
		"2. **Evidence-Based Analysis**: Support your analysis with concrete reasoning, " +
		"real-world examples, and technical accuracy.\n" +
		"3. **Structured Response**: Organize your answer with clear sections:\n" +
		"   - Executive Summary (2-3 sentence overview)\n" +
		"   - Detailed Analysis (deep dive with technical specifics)\n" +
		"   - Pros & Cons (if applicable)\n" +
		"   - Recommendations (actionable advice)\n" +
		"   - References & Further Reading\n\n" +
		"Be thorough, objective, and practical. If there are trade-offs, explain them clearly. " +
		"Your goal is to educate and empower the user to make informed decisions.\n\n" +
		"User question: " +
		question

	var research = await askAI(researchPrompt, providers, chatId)

	// ─── Phase 2: Create Skills & Resources Knowledge ───────────────────
	// Generate structured skills.md and resources.md content
	var skillPrompt =
		"Based on your research above, create TWO structured knowledge documents about this topic. " +
		"Format them clearly with markdown headers.\n\n" +
		"---\n\n" +
		"## SKILLS.md\n\n" +
		"Create a comprehensive skills document that covers:\n" +
		"- Core concepts and terminology\n" +
		"- Key methodologies and approaches\n" +
		"- Best practices and design patterns\n" +
		"- Common pitfalls to avoid\n" +
		"- Step-by-step workflows\n" +
		"- Decision frameworks\n\n" +
		"## RESOURCES.md\n\n" +
		"Create a resources document that includes:\n" +
		"- Official documentation links\n" +
		"- Recommended tools and libraries\n" +
		"- Learning resources (tutorials, courses, books)\n" +
		"- Community resources (forums, Discord, Stack Overflow)\n" +
		"- Example projects and reference implementations\n" +
		"- Related standards and specifications\n\n" +
		"Topic: " +
		question

	var knowledgeDocs = await askAI(skillPrompt, providers, chatId)

	// Parse out skills and resources sections
	var skillsContent = ""
	var resourcesContent = ""
	var skillsMatch = knowledgeDocs.match(/## SKILLS\.MD([\s\S]*?)(?=## RESOURCES\.MD|$)/i)
	var resourcesMatch = knowledgeDocs.match(/## RESOURCES\.MD([\s\S]*?)$/i)
	if (skillsMatch) skillsContent = skillsMatch[1].trim()
	if (resourcesMatch) resourcesContent = resourcesMatch[1].trim()

	// If parsing failed, use the whole response
	if (!skillsContent && !resourcesContent) {
		skillsContent = knowledgeDocs
	}

	// ─── Phase 3: Save Knowledge to Consultant Knowledge Base ───────────
	// Save skills.md and resources.md to a consultant knowledge directory
	var topicSlug = question
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 50)
	var timestamp = Date.now()
	var knowledgeDir = "/opt/superroo2/cloud/consultant-knowledge/" + topicSlug + "-" + timestamp

	try {
		var fs = require("fs")
		var path = require("path")

		// Create directory
		fs.mkdirSync(knowledgeDir, { recursive: true })

		// Write skills.md
		var fullSkillsMd =
			"# Consultant Skills: " +
			question +
			"\n\n" +
			"*Generated: " +
			new Date().toISOString() +
			"*\n\n" +
			"## Topic\n" +
			question +
			"\n\n" +
			"## Skills & Expertise\n" +
			skillsContent +
			"\n"

		fs.writeFileSync(path.join(knowledgeDir, "skills.md"), fullSkillsMd, "utf8")

		// Write resources.md
		var fullResourcesMd =
			"# Consultant Resources: " +
			question +
			"\n\n" +
			"*Generated: " +
			new Date().toISOString() +
			"*\n\n" +
			"## Topic\n" +
			question +
			"\n\n" +
			"## Resources\n" +
			resourcesContent +
			"\n"

		fs.writeFileSync(path.join(knowledgeDir, "resources.md"), fullResourcesMd, "utf8")

		console.log("[telegram] Consultant knowledge saved to " + knowledgeDir)
	} catch (err) {
		console.error("[telegram] Failed to save consultant knowledge:", err.message)
		// Non-fatal — continue to send the answer
	}

	// ─── Phase 4: Send Professional Answer ──────────────────────────────
	var maxLen = 4000
	var reply = research
	if (reply.length > maxLen) {
		reply = reply.slice(0, maxLen) + "\n\n*(truncated - response too long)*"
	}

	// Add knowledge base reference if saved
	var savedRef = ""
	try {
		if (require("fs").existsSync(knowledgeDir)) {
			savedRef = "\n\n📚 *Knowledge saved* — Skills & Resources documented for future reference."
		}
	} catch (e) {}

	await sendMessage(botToken, chatId, "*Consultant Analysis* 🧠\n\n" + reply + savedRef)

	// ─── Phase 5: Notify Requesting Agent (if applicable) ───────────────
	if (options && options.requestingAgent) {
		var agentLabel = options.requestingAgent.charAt(0).toUpperCase() + options.requestingAgent.slice(1)
		await sendMessage(
			botToken,
			chatId,
			"*Consultant Update for " +
				agentLabel +
				" Agent* 🤝\n\n" +
				"The consultant has completed research and saved updated skills & resources for:\n" +
				"*" +
				question +
				"*\n\n" +
				"Knowledge saved at: `" +
				knowledgeDir +
				"`\n" +
				"The " +
				agentLabel +
				" agent can now use this knowledge for better results.",
		)
	}
}

// ─── GUI Upgrade: /menu — Clickable action grid ──────────────────────────
/**
 * Shows a rich menu grid with clickable buttons for all major actions.
 * Reduces reliance on slash commands — users can tap buttons instead.
 */
async function handleMenu(botToken, chatId) {
	var menuText =
		"*SuperRoo Menu* 🤖\n\n" +
		"Tap a button below to get started. No slash commands needed!\n\n" +
		"_Tip: You can also just type naturally — I'll understand what you need._"

	var buttons = [
		[
			{ text: "💻 Code", callback_data: "menu:code" },
			{ text: "🪲 Debug", callback_data: "menu:debug" },
		],
		[
			{ text: "🚀 Deploy", callback_data: "menu:deploy" },
			{ text: "📊 Status", callback_data: "menu:status" },
		],
		[
			{ text: "🔄 Upgrade Bot", callback_data: "menu:upgrade" },
			{ text: "📁 Projects", callback_data: "menu:projects" },
		],
		[
			{ text: "🧠 Brain", callback_data: "menu:brain" },
			{ text: "🔍 Consultant", callback_data: "menu:consultant" },
		],
		[
			{ text: "🧠 Hermes", callback_data: "menu:hermes" },
			{ text: "📚 Skills", callback_data: "menu:skills" },
		],
		[
			{ text: "📂 Resources", callback_data: "menu:resources" },
			{ text: "📋 Logs", callback_data: "menu:logs" },
		],
		[
			{ text: "🧪 Tests", callback_data: "menu:tests" },
			{ text: "❓ Help", callback_data: "menu:help" },
		],
		[{ text: "ℹ️ About", callback_data: "menu:about" }],
	]

	await sendInlineKeyboard(botToken, chatId, menuText, buttons)
}

// ─── GUI Upgrade: /recent — Show recent tasks ────────────────────────────
/**
 * Shows the user's most recent coding tasks with quick-action buttons.
 */
async function handleRecent(botToken, chatId) {
	var tasks = userTasks.get(chatId) || []
	if (tasks.length === 0) {
		await sendMessage(botToken, chatId, "No recent tasks found. Use `/code <instruction>` to start coding!")
		return
	}

	// Show last 5 tasks
	var recentTasks = tasks.slice(-5).reverse()
	var text = "*Recent Tasks* 📋\n\n"
	for (var i = 0; i < recentTasks.length; i++) {
		var t = recentTasks[i]
		var statusEmoji =
			t.status === "done" || t.status === "deployed"
				? "✅"
				: t.status === "failed"
					? "❌"
					: t.status === "queued" || t.status === "processing"
						? "⏳"
						: "📝"
		text += statusEmoji + " `" + t.id + "` — " + t.instruction.slice(0, 60) + "\n"
	}

	var buttons = []
	if (recentTasks.length > 0) {
		var lastTask = recentTasks[0]
		buttons.push([
			{ text: "🔄 Run Again", callback_data: "coder:retry:" + lastTask.id },
			{ text: "📊 Status", callback_data: "notify:status:" + lastTask.id },
		])
	}
	buttons.push([{ text: "🔙 Back to Menu", callback_data: "menu:back" }])

	await sendInlineKeyboard(botToken, chatId, text, buttons)
}

// ─── GUI Upgrade: /again — Repeat last task ──────────────────────────────
/**
 * Re-runs the user's most recent coding task with the same instruction.
 */
async function handleAgain(botToken, chatId, queue, orchestratorBridge) {
	var tasks = userTasks.get(chatId) || []
	if (tasks.length === 0) {
		await sendMessage(botToken, chatId, "No previous task to repeat. Use `/code <instruction>` to start coding!")
		return
	}

	var lastTask = tasks[tasks.length - 1]
	await sendMessage(botToken, chatId, "🔄 Repeating last task: `" + lastTask.instruction.slice(0, 100) + "`")
	await handleCode(botToken, chatId, lastTask.instruction.split(/\s+/), queue, orchestratorBridge)
}

/**
 * Handles /code <instruction> - creates a coding task.
 */
async function handleCode(botToken, chatId, args, queue, orchestratorBridge, options) {
	// Improvement 3: Accept optional workspaceDir/repoName from NL routing or caller
	options = options || {}

	// Parse --auto flag for fully automated coding (no approval clicks needed)
	var autoIndex = args.indexOf("--auto")
	var isAuto = autoIndex !== -1
	if (isAuto) {
		args.splice(autoIndex, 1) // Remove --auto from args
	}

	var instruction = args.join(" ")
	if (!instruction) {
		await sendMessage(
			botToken,
			chatId,
			"Please provide an instruction.\n\nExample: `/code fix the login timeout bug`\n\nUse `--auto` for fully automated mode (plan → apply → commit → deploy).",
		)
		return
	}

	// Improvement 8: Validate minimum instruction length
	if (instruction.length < 10) {
		await sendMessage(
			botToken,
			chatId,
			"*Instruction too short* 📝\n\nPlease provide a more detailed instruction (at least 10 characters).\n\nExample: `/code fix the login timeout bug`",
		)
		return
	}

	// Improvement 9: Auth check for NL-routed requests that bypass the classifier's auth check
	if (options.requireAuth) {
		var authSession = await checkAuthSession(options.telegramUserId || chatId, chatId)
		if (!authSession) {
			await sendMessage(
				botToken,
				chatId,
				"🔒 *Login required for coding*\n\nPlease use `/login` to authenticate, then try again.",
			)
			return
		}
	}

	var taskId =
		"TG-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).slice(2, 6).toUpperCase()
	var branchName = "tg/" + taskId.toLowerCase()

	// Improvement 3: Resolve workspaceDir/repoName from options, with fallback to defaults
	var workspaceDir = options.workspaceDir || "/opt/superroo2"
	var repoName = options.repoName || "superroo2"

	// Build conversation summary for the worker so it has context
	var conversationSummary = buildConversationSummary(chatId)

	// Improvement 2: Add retry logic to all queue.add() calls
	var job = await queue.add(
		"coder-plan-" + taskId,
		{
			task: instruction,
			agentId: "superroo-coder-agent",
			phase: "plan",
			taskId: taskId,
			workspaceDir: workspaceDir,
			repoName: repoName,
			branch: branchName,
			telegram: {
				botToken: botToken,
				chatId: chatId,
				taskId: taskId,
				branchName: branchName,
				conversationSummary: conversationSummary,
				auto: isAuto,
			},
		},
		{
			attempts: 3,
			backoff: { type: "exponential", delay: 5000 },
		},
	)

	if (!userTasks.has(chatId)) userTasks.set(chatId, [])
	userTasks.get(chatId).push({
		id: taskId,
		instruction: instruction,
		status: "queued",
		branchName: branchName,
		changedFiles: 0,
		linesAdded: 0,
		createdAt: new Date().toISOString(),
		jobId: job.id,
	})
	scheduleStatePersist()

	// Also record in Cloud Orchestrator if bridge is available
	if (orchestratorBridge) {
		try {
			orchestratorBridge.createTask({
				tgTaskId: taskId,
				chatId: chatId,
				instruction: instruction,
				agentId: "superroo-coder-agent",
				branchName: branchName,
				source: "/code",
			})
		} catch (err) {
			console.error("[telegram] Failed to record /code task in orchestrator:", err.message)
		}
	}

	// Send rich notification with action buttons
	await telegramNotifier.sendTaskStarted(botToken, chatId, taskId, instruction, "superroo-coder-agent")

	// Start persistent typing indicator for auto mode multi-phase jobs
	if (isAuto) {
		startAutoTypingInterval(botToken, chatId, taskId)
	}
}

/**
 * Handles /shell <command> - executes a shell command on the VPS.
 * Uses the Telegram Policy Engine to check if the command is safe to run
 * without approval. Dangerous commands are blocked with a safety message.
 */
async function handleShell(botToken, chatId, args) {
	var command = args.join(" ")
	if (!command) {
		await sendMessage(
			botToken,
			chatId,
			"*Shell Command* 🖥️\n\n" +
				"Execute shell commands on the VPS.\n\n" +
				"*Usage:* `/shell <command>`\n" +
				"*Example:* `/shell pm2 list`\n" +
				"*Example:* `/shell docker ps`\n" +
				"*Example:* `/shell df -h`\n\n" +
				"*Safe commands* (no approval needed):\n" +
				"• `version`, `whoami`, `pwd`, `date`\n" +
				"• `ps`, `df`, `free`, `uptime`, `uname`\n" +
				"• `docker ps`, `docker stats --no-stream`\n" +
				"• `pm2 list`, `pm2 status`, `pm2 jlist`\n" +
				"• `ls`, `cat` (read-only files)\n\n" +
				"*Dangerous commands* (blocked):\n" +
				"• `rm -rf`, `dd`, `mkfs`, `reboot`, `shutdown`\n" +
				"• `sudo`, `chmod 777`, `> /dev/sda`\n" +
				"• Any command with `| sh` or backtick injection\n\n" +
				"*Note:* All commands are logged and audited.",
		)
		return
	}

	// Check policy — is this command safe to run without approval?
	var policyCheck = telegramPolicy.canRunWithoutApproval("shell", command)
	if (!policyCheck.allowed) {
		var blockedReason = telegramPolicy.getBlockedReason("shell", command)
		await sendMessage(botToken, chatId, blockedReason)
		return
	}

	await sendChatAction(botToken, chatId, "typing")

	try {
		var result = await tgEndpoints.executeShell(command)
		var reply = "*Shell Output* 🖥️\n\n"
		if (result.stdout) {
			// Truncate long output for Telegram
			var output = result.stdout
			if (output.length > 3500) {
				output = output.slice(0, 3497) + "..."
			}
			reply += "```\n" + output + "\n```"
		}
		if (result.stderr) {
			var errOutput = result.stderr
			if (errOutput.length > 1000) {
				errOutput = errOutput.slice(0, 997) + "..."
			}
			reply += "\n*stderr:*\n```\n" + errOutput + "\n```"
		}
		if (!result.stdout && !result.stderr) {
			reply += "Command completed with no output."
		}
		if (result.exitCode !== undefined && result.exitCode !== 0) {
			reply += "\n\n*Exit code:* `" + result.exitCode + "`"
		}
		await sendMessage(botToken, chatId, reply)
	} catch (err) {
		logTelegramError("/shell", chatId, null, err, { command: command })
		await sendMessage(
			botToken,
			chatId,
			"*Shell Error* ❌\n\n" +
				err.message +
				"\n\nTry using the Cloud Dashboard terminal instead:\nDASHBOARD_URL/ide-terminal",
		)
	}
}

/**
 * Handles /status [taskId] - shows system or task status.
 */
async function handleStatus(botToken, chatId, args, queue) {
	if (args.length > 0) {
		var taskId = args[0].toUpperCase()
		var tasks = userTasks.get(chatId) || []
		var task = tasks.find(function (t) {
			return t.id === taskId
		})
		if (!task) {
			await sendMessage(botToken, chatId, "Task `" + taskId + "` not found.")
			return
		}

		var liveStatus = task.status
		try {
			var job = await queue.getJob(task.jobId)
			if (job) {
				liveStatus = await job.getState()
			}
		} catch (e) {}

		var emojiMap = { waiting: "", queued: "", active: "", running: "", completed: "", failed: "" }
		var emoji = emojiMap[liveStatus] || ""

		await sendMessage(
			botToken,
			chatId,
			emoji +
				" *Task " +
				taskId +
				"*\n\n*Instruction:* " +
				task.instruction +
				"\n*Branch:* `" +
				task.branchName +
				"`\n*Status:* `" +
				liveStatus +
				"`\n*Files changed:* " +
				task.changedFiles +
				"\n*Lines added:* " +
				task.linesAdded,
		)
	} else {
		var counts = { waiting: 0, active: 0, completed: 0, failed: 0 }
		try {
			counts = {
				waiting: await queue.getWaitingCount(),
				active: await queue.getActiveCount(),
				completed: await queue.getCompletedCount(),
				failed: await queue.getFailedCount(),
			}
		} catch (e) {}

		var userTaskList = userTasks.get(chatId) || []
		var activeTasks = userTaskList.filter(function (t) {
			return t.status !== "completed" && t.status !== "failed"
		})

		await sendMessage(
			botToken,
			chatId,
			"*SuperRoo System Status*\n\n" +
				"*Queue:* " +
				counts.waiting +
				" waiting . " +
				counts.active +
				" active . " +
				counts.completed +
				" completed . " +
				counts.failed +
				" failed\n" +
				"*Your tasks:* " +
				activeTasks.length +
				" active\n" +
				"*Session:* " +
				(getSession(chatId) ? "Active" : "Expired") +
				"\n\n" +
				"Use `/code <instruction>` to create a new coding task.",
		)
	}
}

/**
 * Handles /session - checks or refreshes session.
 */
async function handleSession(botToken, chatId) {
	var session = getSession(chatId)
	if (session) {
		var remaining = Math.round((SESSION_TTL_MS - (Date.now() - session.authenticatedAt)) / 60000)
		await sendMessage(
			botToken,
			chatId,
			"*Session Active*\n\nExpires in: " +
				remaining +
				" minutes\nChat: `" +
				chatId +
				"`\nOTP: " +
				(session.otpVerified ? "Verified" : "Not verified") +
				"\n\nUse `/otp` to set up Google Authenticator if not verified.",
		)
	} else {
		createOrRefreshSession(chatId)
		await sendMessage(
			botToken,
			chatId,
			"*New Session Started*\n\nYou are now authenticated.\nSession expires in 30 minutes of inactivity.\n\nUse `/otp` to set up Google Authenticator for secure operations.\nUse `/code <instruction>` to start coding!",
		)
	}
}

/**
 * Handles /otp - sets up Google Authenticator TOTP.
 */
async function handleOTP(botToken, chatId, args) {
	var session = getSession(chatId)
	if (!session) {
		createOrRefreshSession(chatId)
	}

	if (args.length > 0) {
		var code = args[0].replace(/\s/g, "")
		var pending = pendingOtpSecrets.get(chatId)

		if (!pending || !pending.secret) {
			await sendMessage(botToken, chatId, "No pending OTP setup. Use `/otp` first to generate a secret key.")
			return
		}

		if (verifyTOTP(pending.secret, code)) {
			var sess = getSession(chatId) || createOrRefreshSession(chatId)
			sess.otpVerified = true
			sess.otpVerifiedAt = Date.now()
			sess.otpSecret = pending.secret
			pendingOtpSecrets.delete(chatId)
			scheduleStatePersist()

			await sendMessage(
				botToken,
				chatId,
				"*Google Authenticator Verified!* ✅\n\nYour OTP is now active. Session is fully authenticated.\n\nOTP verification lasts for 30 minutes. After that, you'll need to re-verify.",
			)
		} else {
			await sendMessage(
				botToken,
				chatId,
				"*Invalid code.* Please try again.\n\nMake sure you've added the secret to Google Authenticator and entered the current 6-digit code.\n\nUse `/otp` to see the secret again.",
			)
		}
		return
	}

	var secret = generateTOTPSecret()
	pendingOtpSecrets.set(chatId, { secret: secret, verified: false })
	scheduleStatePersist()

	var otpUri = generateOTPAuthURI(secret, "superroo_" + chatId)

	await sendMessage(
		botToken,
		chatId,
		"*Google Authenticator Setup*\n\n" +
			"1. Open Google Authenticator on your phone\n" +
			"2. Tap *+* -> *Enter a setup key*\n" +
			"3. Enter the following key:\n\n" +
			"`" +
			secret +
			"`\n\n" +
			"Or scan this URI in a QR generator:\n" +
			"(copy the link below into any QR code generator)\n" +
			"`" +
			otpUri +
			"`\n\n" +
			"4. Then send the 6-digit code:\n" +
			"`/otp <code>`\n\n" +
			"Example: `/otp 123456`",
	)
}

/**
 * Handles /diff [taskId] - shows diff for a task.
 */
async function handleDiff(botToken, chatId, args, orchestratorBridge) {
	var taskId = args[0]
	if (!taskId) {
		await sendMessage(botToken, chatId, "Please specify a task ID.\n\nExample: `/diff TG-221`")
		return
	}

	var tasks = userTasks.get(chatId) || []
	var task = tasks.find(function (t) {
		return t.id === taskId.toUpperCase()
	})
	if (!task) {
		await sendMessage(botToken, chatId, "Task `" + taskId + "` not found.")
		return
	}

	if (task.changedFiles === 0) {
		await sendMessage(
			botToken,
			chatId,
			"*Diff for " +
				task.id +
				"*\n\nNo changes yet - task is still being processed.\n\nUse `/status " +
				task.id +
				"` to check progress.",
		)
		return
	}

	await sendChatAction(botToken, chatId, "typing")
	try {
		var execAsync = promisify(require("child_process").exec)
		var projectPath = task.projectPath || process.cwd()
		var baseBranch = task.baseBranch || "main"
		var diffResult = await execAsync("git diff --stat " + baseBranch + ".." + task.branchName, { cwd: projectPath })
		var fullDiffResult = await execAsync("git diff " + baseBranch + ".." + task.branchName, { cwd: projectPath })
		var diffText = "*Diff for " + task.id + "*\n\n"
		if (diffResult.stdout) {
			diffText += "*Summary:*\n```\n" + diffResult.stdout + "\n```\n\n"
		}
		if (fullDiffResult.stdout) {
			var diffOutput = fullDiffResult.stdout
			if (diffOutput.length > 3000) {
				diffOutput = diffOutput.slice(0, 2997) + "..."
			}
			diffText += "*Changes:*\n```diff\n" + diffOutput + "\n```"
		} else {
			diffText += "No diff output."
		}
		await sendMessage(botToken, chatId, diffText)
	} catch (err) {
		console.error("[telegram] handleDiff error:", err.message)
		await sendMessage(
			botToken,
			chatId,
			"*Diff for " +
				task.id +
				"*\n\n*" +
				task.changedFiles +
				" files changed*\n*" +
				task.linesAdded +
				" lines added*\n*Branch:* `" +
				task.branchName +
				"`\n\nUse `/approve " +
				task.id +
				"` to approve or check the dashboard for full diff.",
		)
	}
}

/**
 * Handles /approve [taskId] - approves a pending task.
 */
async function handleApprove(botToken, chatId, args, orchestratorBridge) {
	var taskId = args[0]
	if (!taskId) {
		await sendMessage(botToken, chatId, "Please specify a task ID.\n\nExample: `/approve TG-221`")
		return
	}

	var tasks = userTasks.get(chatId) || []
	var task = tasks.find(function (t) {
		return t.id === taskId.toUpperCase()
	})
	if (!task) {
		await sendMessage(botToken, chatId, "Task `" + taskId + "` not found.")
		return
	}

	task.status = "approved"
	scheduleStatePersist()

	if (orchestratorBridge) {
		try {
			orchestratorBridge.updateTaskStatus(task.id, "approved")
		} catch (err) {
			console.error("[telegram] Failed to update orchestrator task status:", err.message)
		}
	}

	await sendMessage(
		botToken,
		chatId,
		"*Task " +
			task.id +
			" Approved!*\n\nChanges will be applied to branch `" +
			task.branchName +
			"`.\nUse `/deploy " +
			task.id +
			"` to deploy when ready.",
	)
}

/**
 * Handles /test [taskId] - runs tests for a task.
 */
async function handleTest(botToken, chatId, args, queue) {
	var taskId = args[0] || "all"

	var job = await queue.add("test-" + taskId + "-" + Date.now(), {
		task: "Run tests: " + taskId,
		agentId: "superroo-tester-agent",
		commands: [],
		network: "none",
	})

	await sendMessage(
		botToken,
		chatId,
		"*Tests triggered!*\n\nScope: `" + taskId + "`\nJob: `" + job.id + "`\n\nUse `/status` to check results.",
	)
}

/**
 * Handles /deploy [taskId] - deploys an approved task.
 * Requires OTP verification.
 */
async function handleDeploy(botToken, chatId, args, queue, orchestratorBridge) {
	var taskId = args[0]
	if (!taskId) {
		await sendMessage(
			botToken,
			chatId,
			"Please specify a task ID.\n\nExample: `/deploy TG-221`\n\n*Note:* Deploy requires OTP authentication via Google Authenticator.",
		)
		return
	}

	var session = getSession(chatId)
	if (!session || !session.otpVerified) {
		await sendMessage(
			botToken,
			chatId,
			"*OTP Required*\n\nDeploy requires Google Authenticator verification.\n\nUse `/otp` to set up and verify your OTP first.",
		)
		return
	}

	var tasks = userTasks.get(chatId) || []
	var task = tasks.find(function (t) {
		return t.id === taskId.toUpperCase()
	})
	if (!task) {
		await sendMessage(botToken, chatId, "Task `" + taskId + "` not found.")
		return
	}

	if (task.status !== "approved") {
		await sendMessage(
			botToken,
			chatId,
			"Task `" + task.id + "` must be approved before deploying.\nUse `/approve " + task.id + "` first.",
		)
		return
	}

	var job = await queue.add("deploy-" + taskId + "-" + Date.now(), {
		task: "Deploy: " + task.instruction,
		agentId: "superroo-deployer-agent",
		commands: [],
		network: "none",
	})

	task.status = "deploying"
	scheduleStatePersist()

	// Also record in Cloud Orchestrator if bridge is available
	if (orchestratorBridge) {
		try {
			orchestratorBridge.createTask({
				tgTaskId: taskId,
				chatId: chatId,
				instruction: "Deploy: " + (task.instruction || ""),
				agentId: "superroo-deployer-agent",
				branchName: task.branchName || "main",
				source: "/deploy",
			})
		} catch (err) {
			console.error("[telegram] Failed to record /deploy task in orchestrator:", err.message)
		}
	}

	await sendMessage(
		botToken,
		chatId,
		"*Deploy triggered!*\n\nTask: " +
			task.id +
			"\nBranch: `" +
			task.branchName +
			"`\nJob: `" +
			job.id +
			"`\n\nUse `/status` to monitor deployment.",
	)
}

/**
 * Handles /logs [limit] - shows recent logs.
 */
async function handleLogs(botToken, chatId, args) {
	var limit = parseInt(args[0]) || 10
	await sendMessage(botToken, chatId, "📋 *Fetching logs...*")
	try {
		var result = await tgEndpoints.readLogs("all", limit)
		var logs = result.logs.slice(-limit)
		var text = "📋 *Recent Logs*\n\n"
		await sendMessage(botToken, chatId, text)
	} catch (e) {
		await sendMessage(botToken, chatId, "❌ Failed to fetch logs: " + e.message)
	}
}

async function handleLogin(botToken, chatId, telegramUserId, isGroup) {
	// Check if already authenticated via auth module
	var authSession = await checkAuthSession(telegramUserId, chatId)
	if (authSession) {
		var email = authSession.email || "your account"
		await sendMessage(
			botToken,
			chatId,
			"*Already Logged In* ✅\n\nYou are signed in as: `" +
				email +
				"`\n\nUse `/projects` to view your projects.\nUse `/code <instruction>` to start a coding task.\nUse `/session` to check session details.",
		)
		return
	}

	// In groups, redirect to DM
	if (isGroup) {
		await sendInlineKeyboard(
			botToken,
			chatId,
			"*Login Required* 🔐\n\nTap below to open a private chat with \\@" +
				BOT_USERNAME +
				" and log in there.\n\nOnce logged in via DM, all your commands in this group will be authenticated.",
			[[{ text: "🔐 Login via Private Chat", url: "https://t.me/" + BOT_USERNAME + "?start=login" }]],
		)
		return
	}

	// DM: start Email OTP login flow
	// Set state to "awaiting_email" so the next non-command message is treated as email input
	var existingState = pendingEmailOtps.get(chatId)
	if (existingState) {
		pendingEmailOtps.delete(chatId)
		scheduleStatePersist()
	}

	// Mark that we're awaiting email input
	pendingEmailOtps.set(chatId, { step: "awaiting_email", messageIds: [] })
	scheduleStatePersist()

	var sentMsg = await sendMessage(
		botToken,
		chatId,
		"*Login via Email OTP* 📧\n\nPlease enter the email address associated with your SuperRoo Cloud account.\n\nI'll send a one-time password (OTP) to that email for verification.\n\n*Tip:* Messages with sensitive info will be auto-deleted after login.\n\n_(Type your email address below, or use `/cancel` to abort)_",
	)
	if (sentMsg && sentMsg.result && sentMsg.result.message_id) {
		if (!existingState) existingState = { step: "awaiting_email", messageIds: [] }
		existingState.messageIds.push(sentMsg.result.message_id)
		pendingEmailOtps.set(chatId, existingState)
		scheduleStatePersist()
	}
}

/**
 * Handles email input during Email OTP login flow.
 * Called when the user sends a non-command message while in "awaiting_email" state.
 * Validates the email, generates an OTP, and stores it for verification.
 */
async function handleEmailOtpLogin(botToken, chatId, email, telegramUserId) {
	// Basic email validation
	var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
	if (!emailRegex.test(email)) {
		await sendMessage(
			botToken,
			chatId,
			"*Invalid Email* ❌\n\nPlease enter a valid email address (e.g., `user@example.com`).\n\nUse `/login` to try again.",
		)
		pendingEmailOtps.delete(chatId)
		scheduleStatePersist()
		return
	}

	// Generate a 6-digit OTP using cryptographically secure random
	var otp = crypto.randomInt(100000, 999999).toString()

	// Store the pending OTP
	var state = pendingEmailOtps.get(chatId) || { step: "awaiting_email", messageIds: [] }
	state.step = "awaiting_otp"
	state.email = email
	state.otp = otp
	state.createdAt = Date.now()
	state.telegramUserId = telegramUserId
	pendingEmailOtps.set(chatId, state)
	scheduleStatePersist()

	console.log("[telegram] Email OTP generated for " + email + " (chat " + chatId + "): " + otp)

	// Send OTP via email using nodemailer/SMTP
	try {
		var nodemailer = require("nodemailer")
		var transporter = nodemailer.createTransport({
			host: process.env.SMTP_HOST || "smtp.gmail.com",
			port: parseInt(process.env.SMTP_PORT || "587"),
			secure: false,
			auth: {
				user: process.env.SMTP_USER || "",
				pass: process.env.SMTP_PASS || "",
			},
		})
		var mailResult = await transporter.sendMail({
			from: process.env.SMTP_FROM || "",
			to: email,
			subject: "Your SuperRoo Cloud Login OTP",
			text:
				"Your SuperRoo Cloud one-time password is: " +
				otp +
				"\n\nThis code expires in 10 minutes.\n\nIf you did not request this, please ignore this email.",
			html:
				"<p>Your SuperRoo Cloud one-time password is: <strong>" +
				otp +
				"</strong></p><p>This code expires in 10 minutes.</p><p>If you did not request this, please ignore this email.</p>",
		})
		console.log("[telegram] OTP email sent to " + email + " (messageId: " + mailResult.messageId + ")")
	} catch (err) {
		console.error("[telegram] Failed to send OTP email to " + email + ": " + (err.message || err))
	}

	var sentMsg = await sendMessage(
		botToken,
		chatId,
		"*OTP Sent* 📧\n\nA one-time password has been sent to `" +
			email +
			"`.\n\nPlease check your email and enter the 6-digit code to complete login.\n\n_(This code expires in 10 minutes. Messages will be auto-deleted after login.)_\n\nUse `/cancel` to abort.",
	)
	if (sentMsg && sentMsg.result && sentMsg.result.message_id) {
		state.messageIds.push(sentMsg.result.message_id)
		pendingEmailOtps.set(chatId, state)
		scheduleStatePersist()
	}
}

/**
 * Handles OTP code verification during Email OTP login flow.
 * Called when the user sends a 6-digit code while in "awaiting_otp" state.
 * Verifies the OTP and creates an auth session via the auth module.
 * Auto-deletes sensitive messages after successful login.
 */
async function handleVerifyEmailOtp(botToken, chatId, code, telegramUserId) {
	var state = pendingEmailOtps.get(chatId)
	if (!state || state.step !== "awaiting_otp") {
		await sendMessage(botToken, chatId, "*No pending login.*\n\nUse `/login` to start the login process.")
		return
	}

	// Check OTP expiry
	if (Date.now() - state.createdAt > EMAIL_OTP_TTL_MS) {
		pendingEmailOtps.delete(chatId)
		scheduleStatePersist()
		await sendMessage(
			botToken,
			chatId,
			"*OTP Expired* ⏰\n\nThe one-time password has expired. Please use `/login` to start again.",
		)
		return
	}

	// Verify OTP
	if (code !== state.otp) {
		await sendMessage(
			botToken,
			chatId,
			"*Invalid Code* ❌\n\nThe code you entered is incorrect. Please try again.\n\nUse `/login` to restart the process.",
		)
		pendingEmailOtps.delete(chatId)
		scheduleStatePersist()
		return
	}

	// OTP verified! Create auth session via the auth module
	try {
		var result = await auth.handleTelegramLogin({
			email: state.email,
			password: "__email_otp_verified__", // Special marker for OTP-based login
			telegramInitData: "email-otp:" + state.otp, // Pass OTP as init data
			telegramUserId: telegramUserId,
			telegramChatId: chatId,
		})

		if (result && result.ok) {
			// Auto-delete sensitive messages
			var messageIds = state.messageIds || []
			for (var i = 0; i < messageIds.length; i++) {
				await deleteMessage(botToken, chatId, messageIds[i])
			}

			pendingEmailOtps.delete(chatId)
			scheduleStatePersist()

			// Create local session
			createOrRefreshSession(chatId)

			await sendMessage(
				botToken,
				chatId,
				"*Login Successful* ✅\n\nYou are now signed in as: `" +
					state.email +
					"`\n\nSensitive messages have been auto-deleted.\n\nUse `/projects` to view your projects.\nUse `/code <instruction>` to start a coding task.",
			)
		} else {
			var errorMsg = (result && result.error) || "Unknown error"
			pendingEmailOtps.delete(chatId)
			scheduleStatePersist()
			await sendMessage(
				botToken,
				chatId,
				"*Login Failed* ❌\n\n" +
					errorMsg +
					"\n\nPlease check that your email is registered in the SuperRoo Cloud dashboard.\nUse `/login` to try again.",
			)
		}
	} catch (err) {
		console.error("[telegram] Email OTP login error:", err.message)
		pendingEmailOtps.delete(chatId)
		scheduleStatePersist()
		await sendMessage(
			botToken,
			chatId,
			"*Login Error* ❌\n\nAn error occurred: " + err.message + "\n\nPlease use `/login` to try again.",
		)
	}
}

/**
 * Handles /projects - lists available projects from the auth module.
 * Shows project cards with inline keyboard for selection.
 */
async function handleProjects(botToken, chatId, telegramUserId) {
	// Check auth session first
	var authSession = await checkAuthSession(telegramUserId, chatId)
	if (!authSession) {
		await sendMessage(
			botToken,
			chatId,
			"*Authentication Required*\n\nPlease login first using `/login` to view your projects.",
		)
		return
	}

	await sendChatAction(botToken, chatId, "typing")

	try {
		var result = await auth.handleTelegramProjects({
			telegramUserId: telegramUserId,
			telegramChatId: chatId,
		})

		if (!result || !result.projects || result.projects.length === 0) {
			await sendMessage(
				botToken,
				chatId,
				"*No Projects Found*\n\nYou don't have any projects yet. Create one in the dashboard at DASHBOARD_URL\n\nUse `/code <instruction>` to start a coding task in the default workspace.",
			)
			return
		}

		var projectList = result.projects
			.map(function (p, i) {
				return (
					"*" +
					(i + 1) +
					". " +
					p.name +
					"*" +
					(p.description ? "\n   " + p.description : "") +
					"\n   Status: " +
					(p.status || "active") +
					"\n   ID: `" +
					p.id +
					"`"
				)
			})
			.join("\n\n")

		// Build inline keyboard for project selection
		var projectButtons = result.projects.map(function (p) {
			return [{ text: p.name, callback_data: "project:" + p.id }]
		})

		await sendInlineKeyboard(
			botToken,
			chatId,
			"*Your Projects*\n\n" + projectList + "\n\nSelect a project to set as your active workspace:",
			projectButtons,
		)
	} catch (err) {
		console.error("[telegram] handleProjects error:", err.message)
		await sendMessage(
			botToken,
			chatId,
			"*Error loading projects*\n\n" + err.message + "\n\nPlease try again later.",
		)
	}
}

/**
 * Handles /workspace - shows the currently active workspace/project.
 */
async function handleWorkspace(botToken, chatId, telegramUserId) {
	var authSession = await checkAuthSession(telegramUserId, chatId)
	if (!authSession) {
		await sendMessage(botToken, chatId, "*Authentication Required*\n\nPlease login first using `/login`.")
		return
	}

	try {
		var result = await auth.handleTelegramProjects({
			telegramUserId: telegramUserId,
			telegramChatId: chatId,
		})

		var activeProject = null
		if (result && result.projects) {
			activeProject = result.projects.find(function (p) {
				return p.is_active
			})
		}

		if (activeProject) {
			await sendMessage(
				botToken,
				chatId,
				"*Active Workspace*\n\n" +
					"*Project:* " +
					activeProject.name +
					"\n" +
					(activeProject.description ? "*Description:* " + activeProject.description + "\n" : "") +
					"*Status:* " +
					(activeProject.status || "active") +
					"\n" +
					"*ID:* `" +
					activeProject.id +
					"`\n\n" +
					"Use `/projects` to switch projects.\n" +
					"Use `/code <instruction>` to start coding.",
			)
		} else {
			await sendMessage(
				botToken,
				chatId,
				"*No Active Workspace*\n\nUse `/projects` to select a project as your active workspace.",
			)
		}
	} catch (err) {
		console.error("[telegram] handleWorkspace error:", err.message)
		await sendMessage(botToken, chatId, "*Error*\n\nCould not load workspace information.")
	}
}

/**
 * Handles /agents - shows available agents and their status.
 */
async function handleAgents(botToken, chatId) {
	await sendMessage(
		botToken,
		chatId,
		"*Available Agents*\n\n" +
			"1. *Coder* — Code generation & implementation\n" +
			"2. *Debugger* — Bug investigation & root cause analysis\n" +
			"3. *Tester* — Test execution & quality gates\n" +
			"4. *Deploy Checker* — Deployment verification\n" +
			"5. *PM Agent* — Product management & feature tracking\n\n" +
			"Use `/code <instruction>` to assign a task to the Coder agent.\n" +
			"Use `/status` to check agent activity.",
	)
}

/**
 * Handles /settings - shows settings options.
 */
async function handleSettings(botToken, chatId) {
	await sendMessage(
		botToken,
		chatId,
		"*Settings*\n\n" +
			"Manage your account and preferences at the dashboard:\n" +
			`${DASHBOARD_URL}/settings\n\n` +
			"*Available options:*\n" +
			"• Create/update your account (email + password)\n" +
			"• Link Telegram to your account\n" +
			"• Manage API keys\n" +
			"• Configure agent routing\n" +
			"• Set guardrails and approval rules",
	)
}

/**
 * Handles /about - shows bot information.
 */
/**
 * Handles /miniide command — sends inline keyboard with Mini IDE WebApp button.
 * @param {string} botToken
 * @param {number} chatId
 * @param {number} telegramUserId
 */
/**
 * Validate a URL string. Returns true if the URL is valid and has http/https protocol.
 */
function isValidUrl(str) {
	try {
		var url = new URL(str)
		return url.protocol === "http:" || url.protocol === "https:"
	} catch (_) {
		return false
	}
}

async function handleMiniIde(botToken, chatId, telegramUserId) {
	var authSession = await checkAuthSession(telegramUserId, chatId)
	if (!authSession) {
		await sendMessage(botToken, chatId, "*Authentication Required*\n\nPlease login first using `/login`.")
		return
	}

	try {
		var result = await auth.handleTelegramProjects({
			telegramUserId: telegramUserId,
			telegramChatId: chatId,
		})
		var projects = (result && result.projects) || []

		if (projects.length === 0) {
			await sendMessage(
				botToken,
				chatId,
				"*No Projects Found*\n\nYou don't have any projects yet. Create one in the SuperRoo Cloud Dashboard.\n\n" +
					DASHBOARD_URL,
			)
			return
		}

		if (projects.length === 1) {
			// Single project — open Mini IDE directly
			var project = projects[0]
			var miniIdeUrl =
				`${DASHBOARD_URL}/tg?workspace=` +
				encodeURIComponent(project.id || project.project_id) +
				"&chat_id=" +
				chatId

			// Validate the Mini IDE URL before sending — Telegram rejects invalid web_app URLs
			// with BUTTON_TYPE_INVALID error. Fall back to a regular URL button if invalid.
			var buttonRow
			if (isValidUrl(miniIdeUrl)) {
				buttonRow = [{ text: "🚀 Open Mini IDE", web_app: miniIdeUrl }]
			} else {
				console.warn("[telegram] Invalid DASHBOARD_URL for Mini IDE web_app button, using URL fallback")
				buttonRow = [
					{
						text: "🚀 Open Mini IDE (Web)",
						url: DASHBOARD_URL + "/telegram-miniapp?chat_id=" + chatId,
					},
				]
			}

			await sendInlineKeyboard(
				botToken,
				chatId,
				"*Mini IDE* 🚀\n\nActive workspace: *" +
					(project.name || project.project_name) +
					"*\n\nOpen the Mini IDE to code with a full editor, file browser, AI assistant, and file uploads.",
				[
					buttonRow,
					[
						{ text: "📁 Projects", callback_data: "projects" },
						{ text: "❓ Help", callback_data: "help" },
					],
				],
			)
		} else {
			// Multiple projects — show project list first
			var buttons = projects.map(function (p) {
				return [
					{ text: "📁 " + (p.name || p.project_name), callback_data: "project:" + (p.id || p.project_id) },
				]
			})
			await sendInlineKeyboard(
				botToken,
				chatId,
				"*Select a Workspace*\n\nChoose a project to open in the Mini IDE:",
				buttons,
			)
		}
	} catch (err) {
		console.error("[telegram] handleMiniIde error:", err.message)
		await sendMessage(botToken, chatId, "*Error*\n\nCould not load projects. " + err.message)
	}
}

/**
 * Handles /brain — Terminal Brain commands for intelligent command execution.
 * Subcommands:
 *   /brain plan <query>       — Plan commands from natural language
 *   /brain exec <command>     — Execute a command with safety checks
 *   /brain analyze <output>   — Analyze output for errors
 *   /brain fix <output>       — Suggest fixes for errors
 *   /brain memory             — Show terminal memory stats
 *   /brain context            — Show project context
 *   /brain pipeline <query>   — Full plan→execute→analyze→fix pipeline
 *   /brain help               — Show brain command help
 */
async function handleBrain(botToken, chatId, args, providers) {
	// If no subcommand or "central" subcommand, show Central Brain info
	var subcommand = (args[0] || "").toLowerCase()
	if (!subcommand || subcommand === "central" || subcommand === "info") {
		var query = args.slice(1).join(" ")
		try {
			var res = await fetch("http://127.0.0.1:8787/brain")
			var data = await res.json()
			if (data.success && data.brain) {
				var b = data.brain
				var msg =
					"*🧠 SuperRoo Central Brain*\n\n" +
					"*Name:* " +
					b.name +
					"\n" +
					"*Version:* " +
					b.version +
					"\n" +
					"*Status:* " +
					b.status +
					"\n\n" +
					"*Agents:*\n" +
					"• *Hermes Claw* — Memory & Context (" +
					b.agents.hermesClaw.capabilities.join(", ") +
					")\n" +
					"• *Ollama* — Cheap Local AI (" +
					(b.agents.ollama.models || []).join(", ") +
					")\n" +
					"• *Cloud Coder* — Complex Coding\n\n" +
					"*Capabilities:*\n" +
					"• Memory & Context (pgvector RAG)\n" +
					"• Commit/Deploy Tracking\n" +
					"• Telegram Bot Interface\n" +
					"• Infinite Learning Loop\n\n" +
					"*API Base:* `DASHBOARD_URL/api`\n" +
					"*Dashboard:* `DASHBOARD_URL`\n" +
					"*Telegram:* @SuperRooBot\n\n" +
					"*For AI Bots:* `GET /api/brain` to discover all endpoints\n\n" +
					"*Subcommands:*\n" +
					"• `/brain` — Show this Central Brain info\n" +
					"• `/brain plan <query>` — Terminal Brain planning\n" +
					"• `/brain exec <cmd>` — Execute command safely\n" +
					"• `/brain analyze <output>` — Analyze errors\n" +
					"• `/brain fix <output>` — Suggest fixes\n" +
					"• `/brain memory` — Terminal memory stats\n" +
					"• `/brain context` — Project context\n" +
					"• `/brain pipeline <query>` — Full pipeline"
				await sendMessage(botToken, chatId, msg)
				return
			}
		} catch (err) {
			// Fall through to Terminal Brain handler
		}
	}

	if (!_terminalBrainAvailable) {
		await sendMessage(
			botToken,
			chatId,
			"*🧠 Terminal Brain — Not Available*\n\n" +
				"The Terminal Brain packages are not loaded on this server. " +
				"This feature requires the Terminal Brain Layer to be installed.\n\n" +
				"Available commands: `/debug`, `/logs`, `/tests`, `/restart`, `/ask`\n\n" +
				"*Tip:* Use `/brain` (no subcommand) to see Central Brain info.",
		)
		return
	}

	var subcommand = (args[0] || "").toLowerCase()
	var query = args.slice(1).join(" ")

	if (!subcommand || subcommand === "help") {
		await sendMessage(
			botToken,
			chatId,
			"*🧠 Terminal Brain — Commands*\n\n" +
				"The Terminal Brain is an intelligent command execution layer with " +
				"project context, error analysis, and memory.\n\n" +
				"*Subcommands:*\n" +
				"• `/brain plan <query>` — Plan commands from natural language\n" +
				"  Example: `/brain plan fix the build`\n\n" +
				"• `/brain exec <command>` — Execute a command safely\n" +
				"  Example: `/brain exec pnpm run build`\n\n" +
				"• `/brain analyze <output>` — Analyze output for errors\n" +
				"  Example: `/brain analyze TS2345: Type 'X' is not assignable...`\n\n" +
				"• `/brain fix <output>` — Suggest fixes for errors\n" +
				"  Example: `/brain fix Module not found: Can't resolve './foo'`\n\n" +
				"• `/brain memory` — Show terminal memory stats\n" +
				"• `/brain context` — Show project context\n" +
				"• `/brain pipeline <query>` — Full plan→execute→analyze→fix\n" +
				"  Example: `/brain pipeline run tests and fix failures`\n\n" +
				"*Tip:* The `/ask` and `/debug` commands also use the Terminal Brain " +
				"when available for enhanced error analysis.",
		)
		return
	}

	await sendChatAction(botToken, chatId, "typing")

	try {
		if (subcommand === "plan") {
			if (!query) {
				await sendMessage(
					botToken,
					chatId,
					"*Usage:* `/brain plan <natural language query>`\n\nExample: `/brain plan fix the build`",
				)
				return
			}
			var planResult = await tgEndpoints.brainPlan(query, chatId)
			if (!planResult.ok) {
				await sendMessage(botToken, chatId, "*Brain Plan Error* ❌\n\n" + (planResult.error || "Unknown error"))
				return
			}
			var planReply = telegramEngineer.formatBrainPlan(planResult)
			await sendMessage(botToken, chatId, planReply)
		} else if (subcommand === "exec" || subcommand === "execute") {
			if (!query) {
				await sendMessage(
					botToken,
					chatId,
					"*Usage:* `/brain exec <shell command>`\n\nExample: `/brain exec pnpm run build`",
				)
				return
			}
			var execResult = await tgEndpoints.brainExecute(query, chatId)
			if (!execResult.ok) {
				await sendMessage(
					botToken,
					chatId,
					"*Brain Execute Error* ❌\n\n" + (execResult.error || "Unknown error"),
				)
				return
			}
			var execReply = telegramEngineer.formatBrainFeedback(execResult.feedback)
			await sendMessage(botToken, chatId, execReply)
		} else if (subcommand === "analyze") {
			if (!query) {
				await sendMessage(
					botToken,
					chatId,
					"*Usage:* `/brain analyze <command output>`\n\nExample: `/brain analyze TS2345: Type 'X' is not assignable to type 'Y'`",
				)
				return
			}
			var analyzeResult = await tgEndpoints.brainAnalyze(query, chatId)
			if (!analyzeResult.ok) {
				await sendMessage(
					botToken,
					chatId,
					"*Brain Analyze Error* ❌\n\n" + (analyzeResult.error || "Unknown error"),
				)
				return
			}
			var analyzeReply = telegramEngineer.formatBrainErrors(analyzeResult.errors)
			await sendMessage(botToken, chatId, analyzeReply)
		} else if (subcommand === "fix") {
			if (!query) {
				await sendMessage(
					botToken,
					chatId,
					"*Usage:* `/brain fix <error output>`\n\nExample: `/brain fix Module not found: Can't resolve './foo'`",
				)
				return
			}
			var fixResult = await tgEndpoints.brainFix(query, chatId)
			if (!fixResult.ok) {
				await sendMessage(botToken, chatId, "*Brain Fix Error* ❌\n\n" + (fixResult.error || "Unknown error"))
				return
			}
			if (!fixResult.fixes || fixResult.fixes.length === 0) {
				await sendMessage(
					botToken,
					chatId,
					"*🧠 Terminal Brain — No fixes suggested*\n\nNo automatic fixes could be determined for the given output.",
				)
				return
			}
			var fixLines = ["*🧠 Terminal Brain — Suggested Fixes*"]
			for (var fi = 0; fi < fixResult.fixes.length; fi++) {
				fixLines.push("• " + (fi + 1) + ". " + fixResult.fixes[fi])
			}
			await sendMessage(botToken, chatId, fixLines.join("\n"))
		} else if (subcommand === "memory") {
			var memResult = await tgEndpoints.brainMemory(chatId)
			if (!memResult.ok) {
				await sendMessage(
					botToken,
					chatId,
					"*Brain Memory Error* ❌\n\n" + (memResult.error || "Unknown error"),
				)
				return
			}
			var memReply = telegramEngineer.formatBrainMemory(memResult.stats)
			await sendMessage(botToken, chatId, memReply)
		} else if (subcommand === "context") {
			var ctxResult = await tgEndpoints.brainContext(chatId)
			if (!ctxResult.ok) {
				await sendMessage(
					botToken,
					chatId,
					"*Brain Context Error* ❌\n\n" + (ctxResult.error || "Unknown error"),
				)
				return
			}
			var ctxReply = telegramEngineer.formatBrainContext(ctxResult.context)
			await sendMessage(botToken, chatId, ctxReply)
		} else if (subcommand === "pipeline") {
			if (!query) {
				await sendMessage(
					botToken,
					chatId,
					"*Usage:* `/brain pipeline <natural language query>`\n\nExample: `/brain pipeline run tests and fix failures`\n\nThis runs the full Plan → Execute → Analyze → Fix pipeline.",
				)
				return
			}
			var pipeResult = await tgEndpoints.brainPipeline(query, chatId)
			if (!pipeResult.ok) {
				await sendMessage(
					botToken,
					chatId,
					"*Brain Pipeline Error* ❌\n\n" + (pipeResult.error || "Unknown error"),
				)
				return
			}

			// Build a comprehensive pipeline result message
			var pipeLines = ["*🧠 Terminal Brain — Pipeline Result*"]

			// Plan
			if (pipeResult.plan) {
				pipeLines.push("\n*📋 Plan:*")
				var planCmds = pipeResult.plan.commands || []
				for (var pi = 0; pi < planCmds.length; pi++) {
					var pc = typeof planCmds[pi] === "string" ? planCmds[pi] : planCmds[pi].command || ""
					pipeLines.push("  `" + (pi + 1) + ".` `" + pc + "`")
				}
			}

			// Feedback
			if (pipeResult.feedback) {
				var fbArray = Array.isArray(pipeResult.feedback) ? pipeResult.feedback : [pipeResult.feedback]
				for (var fbi = 0; fbi < fbArray.length; fbi++) {
					var fb = fbArray[fbi]
					var fbIcon = fb.exitCode === 0 ? "✅" : "❌"
					pipeLines.push("\n*" + fbIcon + " Step " + (fbi + 1) + ":* Exit `" + fb.exitCode + "`")
				}
			}

			// Errors
			if (pipeResult.errors && pipeResult.errors.length > 0) {
				pipeLines.push("\n*🔍 Errors Found:* " + pipeResult.errors.length)
				for (var ei = 0; ei < Math.min(pipeResult.errors.length, 3); ei++) {
					var pe = pipeResult.errors[ei]
					pipeLines.push("  • `" + pe.type + "`" + (pe.message ? ": " + pe.message.slice(0, 100) : ""))
				}
				if (pipeResult.errors.length > 3) {
					pipeLines.push("  *+ " + (pipeResult.errors.length - 3) + " more*")
				}
			}

			// Fixes
			if (pipeResult.fixes && pipeResult.fixes.length > 0) {
				pipeLines.push("\n*🔧 Fixes Suggested:* " + pipeResult.fixes.length)
				for (var fxi = 0; fxi < Math.min(pipeResult.fixes.length, 3); fxi++) {
					pipeLines.push("  • " + pipeResult.fixes[fxi].slice(0, 150))
				}
				if (pipeResult.fixes.length > 3) {
					pipeLines.push("  *+ " + (pipeResult.fixes.length - 3) + " more*")
				}
			}

			if (!pipeResult.errors || pipeResult.errors.length === 0) {
				pipeLines.push("\n✅ *All steps completed successfully!*")
			}

			await sendMessage(botToken, chatId, pipeLines.join("\n"))
		} else {
			await sendMessage(
				botToken,
				chatId,
				"*Unknown brain subcommand:* `" +
					subcommand +
					"`\n\n" +
					"Use `/brain help` to see available subcommands.",
			)
		}
	} catch (err) {
		logTelegramError("/brain:" + subcommand, chatId, null, err, { query: query })
		await sendMessage(botToken, chatId, "*Brain Error* ❌\n\n" + err.message)
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Hermes Claw — Memory, Learning, Skills & Resources
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Hermes Claw subcommands for correction suggestions.
 */
const HERMES_SUBCOMMANDS = [
	"recall",
	"learn",
	"skill",
	"pattern",
	"patterns",
	"query",
	"stats",
	"lesson",
	"lessons",
	"help",
]

/**
 * Handles the /hermes command — Hermes Claw memory, learning, and skill management.
 * Integrates with the pgvector RAG knowledge base and Ollama embeddings.
 *
 * Subcommands:
 *   /hermes recall <query>       — Recall context from memory (RAG-powered)
 *   /hermes learn <topic> | <content> — Store a new lesson
 *   /hermes skill <name> | <desc> — Create a new skill
 *   /hermes pattern [scope]      — Analyze patterns (bugs, workflow, code)
 *   /hermes query <question>     — Query the knowledge base
 *   /hermes stats                — Show Hermes Claw statistics
 *   /hermes lesson <phases>      — Extract lessons from an interaction
 *   /hermes help                 — Show this help
 *
 * @param {string} botToken - Telegram bot token
 * @param {number|string} chatId - Chat ID
 * @param {Array<string>} args - Command arguments
 * @param {Array} providers - AI provider configs
 */
async function handleHermes(botToken, chatId, args, providers) {
	var subcommand = (args[0] || "").toLowerCase()
	var query = args.slice(1).join(" ")

	if (!subcommand || subcommand === "help") {
		await sendMessage(
			botToken,
			chatId,
			"*🧠 Hermes Claw — Commands*\n\n" +
				"Hermes Claw is your memory & learning agent. It stores lessons from every interaction, " +
				"builds a knowledge base with vector search (pgvector + Ollama), and gets smarter over time.\n\n" +
				"*Subcommands:*\n" +
				"• `/hermes recall <query>` — Recall context from memory (RAG-powered)\n" +
				"  Example: `/hermes recall how to fix build errors`\n\n" +
				"• `/hermes learn <topic> | <content>` — Store a new lesson\n" +
				"  Example: `/hermes learn deploy | Always run tests before deploy`\n\n" +
				"• `/hermes skill <name> | <description>` — Create a reusable skill\n" +
				"  Example: `/hermes skill deploy-flow | Standard deploy: test, build, deploy`\n\n" +
				"• `/hermes pattern [scope]` — Analyze patterns (bugs, workflow, code)\n" +
				"  Example: `/hermes pattern bugs`\n\n" +
				"• `/hermes query <question>` — Query the knowledge base\n" +
				"  Example: `/hermes query what causes port conflicts`\n\n" +
				"• `/hermes stats` — Show Hermes Claw statistics\n" +
				"• `/hermes lesson <phases>` — Extract lessons from an interaction\n\n" +
				"*Quick commands:*\n" +
				"• `/skills` — List all available skills\n" +
				"• `/resources` — List all available resources\n\n" +
				"_The more you use it, the smarter it gets._ 🧠",
		)
		return
	}

	await sendChatAction(botToken, chatId, "typing")

	try {
		if (subcommand === "recall") {
			if (!query) {
				await sendMessage(
					botToken,
					chatId,
					"*Usage:* `/hermes recall <query>`\n\nExample: `/hermes recall how to fix build errors`\n\nThis searches the knowledge base using vector similarity (pgvector + Ollama embeddings).",
				)
				return
			}
			var recallResult = await tgEndpoints.hermesRecall(query)
			if (!recallResult.ok) {
				await sendMessage(
					botToken,
					chatId,
					"*Hermes Recall Error* ❌\n\n" + (recallResult.error || "Unknown error"),
				)
				return
			}
			var recallReply = telegramEngineer.formatHermesRecall(recallResult)
			await sendMessage(botToken, chatId, recallReply)
		} else if (subcommand === "learn") {
			if (!query || !query.includes("|")) {
				await sendMessage(
					botToken,
					chatId,
					"*Usage:* `/hermes learn <topic> | <content>`\n\nExample: `/hermes learn deploy | Always run tests before deploying to production`\n\nThis stores a lesson in the knowledge base for future recall.",
				)
				return
			}
			var parts = query.split("|").map(function (s) {
				return s.trim()
			})
			var topic = parts[0]
			var content = parts.slice(1).join(" | ")
			var learnResult = await tgEndpoints.hermesLearn({ topic: topic, content: content, source: "telegram" })
			if (!learnResult.ok) {
				await sendMessage(
					botToken,
					chatId,
					"*Hermes Learn Error* ❌\n\n" + (learnResult.error || "Unknown error"),
				)
				return
			}
			var learnReply = telegramEngineer.formatHermesLearn(learnResult)
			await sendMessage(botToken, chatId, learnReply)
		} else if (subcommand === "skill") {
			if (!query || !query.includes("|")) {
				await sendMessage(
					botToken,
					chatId,
					"*Usage:* `/hermes skill <name> | <description>`\n\nExample: `/hermes skill deploy-flow | Standard deploy: test, build, deploy to staging, verify, deploy to production`\n\nThis creates a reusable skill that the bot can apply automatically.",
				)
				return
			}
			var skillParts = query.split("|").map(function (s) {
				return s.trim()
			})
			var skillName = skillParts[0]
			var skillDesc = skillParts.slice(1).join(" | ")
			var skillResult = await tgEndpoints.hermesCreateSkill({ name: skillName, description: skillDesc })
			if (!skillResult.ok) {
				await sendMessage(
					botToken,
					chatId,
					"*Hermes Skill Error* ❌\n\n" + (skillResult.error || "Unknown error"),
				)
				return
			}
			var skillReply = telegramEngineer.formatHermesSkill(skillResult)
			await sendMessage(botToken, chatId, skillReply)
		} else if (subcommand === "pattern" || subcommand === "patterns") {
			var scope = query || "all"
			var patternResult = await tgEndpoints.hermesAnalyzePatterns(scope)
			if (!patternResult.ok) {
				await sendMessage(
					botToken,
					chatId,
					"*Hermes Pattern Error* ❌\n\n" + (patternResult.error || "Unknown error"),
				)
				return
			}
			var patternReply = telegramEngineer.formatHermesPatterns(patternResult)
			await sendMessage(botToken, chatId, patternReply)
		} else if (subcommand === "query") {
			if (!query) {
				await sendMessage(
					botToken,
					chatId,
					"*Usage:* `/hermes query <question>`\n\nExample: `/hermes query what causes port conflicts`\n\nThis queries the structured knowledge base for specific information.",
				)
				return
			}
			var queryResult = await tgEndpoints.hermesQuery(query)
			if (!queryResult.ok) {
				await sendMessage(
					botToken,
					chatId,
					"*Hermes Query Error* ❌\n\n" + (queryResult.error || "Unknown error"),
				)
				return
			}
			var queryReply = telegramEngineer.formatHermesQuery(queryResult)
			await sendMessage(botToken, chatId, queryReply)
		} else if (subcommand === "stats") {
			var statsResult = await tgEndpoints.hermesStats()
			if (!statsResult.ok) {
				await sendMessage(
					botToken,
					chatId,
					"*Hermes Stats Error* ❌\n\n" + (statsResult.error || "Unknown error"),
				)
				return
			}
			var statsReply = telegramEngineer.formatHermesStats(statsResult)
			await sendMessage(botToken, chatId, statsReply)
		} else if (subcommand === "lesson" || subcommand === "lessons") {
			if (!query) {
				await sendMessage(
					botToken,
					chatId,
					"*Usage:* `/hermes lesson <interaction description>`\n\nExample: `/hermes lesson Fixed a port conflict by changing from 3000 to 3001`\n\nThis extracts lessons from an interaction and stores them for future learning.",
				)
				return
			}
			var lessonResult = await tgEndpoints.hermesExtractLessons({
				phases: [{ name: "interaction", description: query }],
				context: "Telegram user interaction",
				outcome: "completed",
			})
			if (!lessonResult.ok) {
				await sendMessage(
					botToken,
					chatId,
					"*Hermes Lesson Error* ❌\n\n" + (lessonResult.error || "Unknown error"),
				)
				return
			}
			var lessonReply = telegramEngineer.formatHermesLessons(lessonResult)
			await sendMessage(botToken, chatId, lessonReply)
		} else {
			await sendMessage(
				botToken,
				chatId,
				"*Unknown hermes subcommand:* `" +
					subcommand +
					"`\n\n" +
					"Use `/hermes help` to see available subcommands.",
			)
		}
	} catch (err) {
		logTelegramError("/hermes:" + subcommand, chatId, null, err, { query: query })
		await sendMessage(botToken, chatId, "*Hermes Error* ❌\n\n" + err.message)
	}
}

/**
 * Handles the /skills command — lists all available skills.
 *
 * @param {string} botToken - Telegram bot token
 * @param {number|string} chatId - Chat ID
 */
/**
 * Handles /upgrade — triggers a self-improvement coding task.
 * Creates a coding task that targets the bot's own source files,
 * allowing the bot to upgrade itself based on the user's description.
 *
 * @param {string} botToken - Telegram bot token
 * @param {number} chatId - Chat ID
 * @param {Array} args - Command arguments (upgrade description)
 * @param {Object} queue - BullMQ queue
 * @param {Object} orchestratorBridge - Optional orchestrator bridge
 */
async function handleUpgrade(botToken, chatId, args, queue, orchestratorBridge) {
	var upgradeGoal = args.join(" ") || "Improve the bot's capabilities and fix any known issues"
	var taskId =
		"UPG-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).slice(2, 6).toUpperCase()

	await sendChatAction(botToken, chatId, "typing")

	try {
		// Create a coding task targeting the bot's own source files
		var job = await queue.add("coder-plan-" + taskId, {
			task: upgradeGoal,
			agentId: "superroo-coder-agent",
			phase: "plan",
			taskId: taskId,
			workspaceDir: "/opt/superroo2",
			repoName: "superroo2",
			branch: "upgrade/" + taskId.toLowerCase(),
			telegram: {
				botToken: botToken,
				chatId: chatId,
			},
		})

		if (!userTasks.has(chatId)) userTasks.set(chatId, [])
		userTasks.get(chatId).push({
			id: taskId,
			instruction: upgradeGoal,
			status: "queued",
			branchName: "upgrade/" + taskId.toLowerCase(),
			changedFiles: 0,
			linesAdded: 0,
			createdAt: new Date().toISOString(),
			jobId: job.id,
		})
		scheduleStatePersist()

		// Also record in Cloud Orchestrator if bridge is available
		if (orchestratorBridge) {
			try {
				orchestratorBridge.createTask({
					tgTaskId: taskId,
					chatId: chatId,
					instruction: upgradeGoal,
					agentId: "superroo-coder-agent",
					branchName: "upgrade/" + taskId.toLowerCase(),
					source: "upgrade",
				})
			} catch (err) {
				console.error("[telegram] Failed to record upgrade task in orchestrator:", err.message)
			}
		}

		// Also learn from this upgrade request via Hermes Claw
		try {
			var tgEndpoints = require("./tgEndpoints")
			tgEndpoints
				.hermesLearn({
					topic: "User requested self-upgrade",
					content: upgradeGoal,
					taskId: taskId,
				})
				.catch(function (err) {
					console.log("[telegram] Upgrade lesson recording non-fatal:", err.message)
				})
		} catch (learnErr) {
			console.log("[telegram] Upgrade lesson recording skipped (non-fatal):", learnErr.message)
		}

		await sendMessage(
			botToken,
			chatId,
			"*🔄 Self-Upgrade Initiated*\n\n" +
				"Task ID: `" +
				taskId +
				"`\n" +
				"Goal: _" +
				upgradeGoal +
				"_\n\n" +
				"The Coder agent is analyzing how to improve the bot. You'll receive updates here.\n\n" +
				"*What happens next:*\n" +
				"1. 📋 Coder plans the changes\n" +
				"2. 🔧 Changes are applied to the bot's source files\n" +
				"3. 🧪 Tests are run to verify nothing is broken\n" +
				"4. 🚀 You can approve and deploy when ready\n\n" +
				"Use `/status` to check progress.",
		)
	} catch (err) {
		logTelegramError("/upgrade", chatId, null, err, { goal: upgradeGoal })
		await sendMessage(botToken, chatId, "*Upgrade Error* ❌\n\n" + err.message)
	}
}

async function handleSkills(botToken, chatId) {
	await sendChatAction(botToken, chatId, "typing")
	try {
		var skillsResult = await tgEndpoints.hermesListSkills()
		if (!skillsResult.ok) {
			await sendMessage(botToken, chatId, "*Skills Error* ❌\n\n" + (skillsResult.error || "Unknown error"))
			return
		}
		var skillsReply = telegramEngineer.formatSkillsList(skillsResult)
		await sendMessage(botToken, chatId, skillsReply)
	} catch (err) {
		logTelegramError("/skills", chatId, null, err)
		await sendMessage(botToken, chatId, "*Skills Error* ❌\n\n" + err.message)
	}
}

/**
 * Handles the /resources command — lists all available resources.
 *
 * @param {string} botToken - Telegram bot token
 * @param {number|string} chatId - Chat ID
 */
async function handleResources(botToken, chatId) {
	await sendChatAction(botToken, chatId, "typing")
	try {
		var resourcesResult = await tgEndpoints.hermesListResources()
		if (!resourcesResult.ok) {
			await sendMessage(botToken, chatId, "*Resources Error* ❌\n\n" + (resourcesResult.error || "Unknown error"))
			return
		}
		var resourcesReply = telegramEngineer.formatResourcesList(resourcesResult)
		await sendMessage(botToken, chatId, resourcesReply)
	} catch (err) {
		logTelegramError("/resources", chatId, null, err)
		await sendMessage(botToken, chatId, "*Resources Error* ❌\n\n" + err.message)
	}
}

/**
 * Handles the /mcp command — Telegram ↔ MCP Bridge.
 * Allows executing MCP actions directly from Telegram.
 *
 * Usage:
 *   /mcp                    — Show available MCP actions
 *   /mcp <action>           — Execute an MCP action with default params
 *   /mcp <action> <json>    — Execute with custom params (JSON string)
 *
 * Supported actions:
 *   health, query_memory, list_projects, get_active_task, get_recent_bugs,
 *   hermes_recall, hermes_learn, hermes_list_skills, hermes_list_resources,
 *   hermes_stats, commit_deploy_status, qdrant_search, qdrant_collections,
 *   run_task, run_debug, run_deploy, get_pipeline, list_resources, read_resource
 *
 * @param {string} botToken - Telegram bot token
 * @param {number|string} chatId - Chat ID
 * @param {string[]} args - Command arguments
 * @param {Array} providers - AI providers
 */
async function handleMcp(botToken, chatId, args, providers) {
	await sendChatAction(botToken, chatId, "typing")

	if (!args || args.length === 0) {
		// Show available MCP actions
		var mcpHelp = [
			"*🧠 MCP Bridge — Available Actions*\n",
			"*System:*",
			"• `health` — Check system health",
			"• `list_projects` — List all projects",
			"• `get_active_task` — Get current active task",
			"• `get_recent_bugs` — Get recent bugs",
			"• `commit_deploy_status` — Get commit/deploy history",
			"",
			"*Ollama (Local AI):*",
			"• `ollama_health` — Check Ollama service status & models",
			"• `ollama_summarize <logs>` — Summarize logs via Ollama",
			"",
			"*Hermes Claw:*",
			"• `hermes_recall <query>` — Semantic memory search",
			"• `hermes_learn <json>` — Store a lesson",
			"• `hermes_list_skills` — List all skills",
			"• `hermes_list_resources` — List all resources",
			"• `hermes_stats` — Hermes Claw statistics",
			"",
			"*Qdrant:*",
			"• `qdrant_search <collection> <query>` — Vector search",
			"• `qdrant_collections` — List Qdrant collections",
			"",
			"*Agent Orchestration:*",
			"• `run_task <description>` — Submit a coding task",
			"• `run_debug <description>` — Submit a debug task",
			"• `run_deploy` — Submit a deploy task",
			"• `get_pipeline` — Get pipeline status",
			"",
			"*Resources:*",
			"• `list_resources` — List brain:// URIs",
			"• `read_resource <uri>` — Read a brain:// resource",
			"",
			"*Examples:*",
			"`/mcp health`",
			"`/mcp ollama_health`",
			"`/mcp ollama_summarize npm build failed with error TS2304`",
			"`/mcp hermes_recall how to fix build errors`",
			'`/mcp hermes_learn {"lesson":"Always run tests before deploy","type":"best_practice"}`',
			"`/mcp qdrant_search bug_knowledge login error`",
			"`/mcp run_task Add a login page`",
		].join("\n")
		await sendMessage(botToken, chatId, mcpHelp)
		return
	}

	var action = args[0].toLowerCase()
	var restArgs = args.slice(1)
	var params = {}

	// Parse params — if second arg looks like JSON, parse it; otherwise treat as query string
	if (restArgs.length > 0) {
		try {
			params = JSON.parse(restArgs.join(" "))
		} catch {
			// Not JSON — treat as query/description string
			params.query = restArgs.join(" ")
			params.description = restArgs.join(" ")
		}
	}

	try {
		// Call the MCP bridge endpoint
		var mcpRes = await fetch("http://127.0.0.1:8787/brain/mcp/telegram", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action, params, chatId }),
		})
		var mcpData = await mcpRes.json()

		if (!mcpData.success) {
			await sendMessage(botToken, chatId, "*MCP Error* ❌\n\n" + (mcpData.error || "Unknown error"))
			return
		}

		// Format the result based on action type
		var reply = "*🧠 MCP Result — " + action + "*\n\n"
		var result = mcpData.result || {}

		if (action === "health") {
			reply += "• Status: " + (result.health ? result.health.status : "unknown") + "\n"
			reply += "• Redis: " + (result.health ? (result.health.redis ? "✅" : "❌") : "unknown") + "\n"
			reply += "• Worker: " + (result.health ? (result.health.worker ? "✅" : "❌") : "unknown") + "\n"
			reply += "• Hermes Claw: " + (result.health ? (result.health.hermesClaw ? "✅" : "❌") : "unknown")
		} else if (action === "list_projects") {
			var projects = result.projects || []
			if (projects.length === 0) {
				reply += "No projects found."
			} else {
				reply += projects
					.map(function (p) {
						return "• `" + p + "`"
					})
					.join("\n")
			}
		} else if (action === "hermes_stats") {
			var stats = result.stats || {}
			reply += "• Operations: " + (stats.operationCount || 0) + "\n"
			reply += "• Total Duration: " + (stats.totalDurationMs || 0) + "ms\n"
			reply += "• Knowledge Store: " + (stats.knowledgeStore ? JSON.stringify(stats.knowledgeStore) : "N/A")
		} else if (action === "commit_deploy_status") {
			var commits = result.commits || []
			var deploys = result.deploys || []
			reply += "*Commits:* " + commits.length + "\n"
			reply += "*Deploys:* " + deploys.length + "\n"
			if (commits.length > 0) {
				reply += "\n*Recent Commits:*\n"
				reply += commits
					.slice(0, 3)
					.map(function (c) {
						return "• `" + (c.sha ? c.sha.slice(0, 8) : "?") + "` " + (c.title || "")
					})
					.join("\n")
			}
			if (deploys.length > 0) {
				reply += "\n*Recent Deploys:*\n"
				reply += deploys
					.slice(0, 3)
					.map(function (d) {
						return "• v" + (d.version || "?") + " — " + (d.status || "")
					})
					.join("\n")
			}
		} else if (action === "list_resources") {
			var resources = result.resources || []
			if (resources.length === 0) {
				reply += "No resources available."
			} else {
				reply += resources
					.map(function (r) {
						return "• `" + r.uri + "` — " + (r.description || "")
					})
					.join("\n")
			}
		} else if (action === "read_resource") {
			reply += "```json\n" + JSON.stringify(result, null, 2).slice(0, 1500) + "\n```"
		} else if (action === "get_pipeline") {
			var pipeline = result.pipeline || {}
			reply += "• Status: " + (pipeline.status || "idle") + "\n"
			reply += "• Current Stage: " + (pipeline.currentStage || "none") + "\n"
			reply += "• Progress: " + (pipeline.progress || 0) + "%"
		} else if (action === "qdrant_collections") {
			var collections = result.collections || []
			if (collections.length === 0) {
				reply += "No Qdrant collections found."
			} else {
				reply += collections
					.map(function (c) {
						return "• `" + c + "`"
					})
					.join("\n")
			}
		} else if (action === "hermes_recall" || action === "qdrant_search") {
			var memory = result.memory || result.results || []
			if (Array.isArray(memory) && memory.length > 0) {
				reply += memory
					.slice(0, 3)
					.map(function (m) {
						return "• " + (m.summary || m.content || JSON.stringify(m).slice(0, 200))
					})
					.join("\n")
			} else if (result.output) {
				reply += result.output.slice(0, 1000)
			} else {
				reply += "No results found."
			}
		} else if (action === "ollama_health") {
			var ollama = result.ollama || {}
			reply += "• Status: " + (ollama.ok ? "✅ Online" : "❌ Offline") + "\n"
			reply += "• Base URL: `" + (ollama.baseUrl || "unknown") + "`\n"
			if (ollama.models && ollama.models.length > 0) {
				reply +=
					"• Models:\n" +
					ollama.models
						.map(function (m) {
							return "  - `" + m + "`"
						})
						.join("\n")
			} else if (ollama.error) {
				reply += "• Error: " + ollama.error
			}
		} else if (action === "ollama_summarize") {
			reply += "• Source: " + (result.source || "ollama") + "\n"
			if (result.summary) {
				var s = result.summary
				reply += "\n*Severity:* " + (s.severity || "unknown") + "\n"
				reply += "*One-line:* " + (s.oneLine || "N/A") + "\n"
				reply += "*Root Cause:* " + (s.rootCause || "unknown") + "\n"
				if (s.evidence && s.evidence.length > 0) {
					reply +=
						"\n*Evidence:*\n" +
						s.evidence
							.slice(0, 3)
							.map(function (e) {
								return "• " + e
							})
							.join("\n") +
						"\n"
				}
				if (s.affectedFiles && s.affectedFiles.length > 0) {
					reply +=
						"\n*Affected Files:*\n" +
						s.affectedFiles
							.slice(0, 5)
							.map(function (f) {
								return "• `" + f + "`"
							})
							.join("\n") +
						"\n"
				}
				if (s.suggestedFix) {
					reply += "\n*Suggested Fix:* " + s.suggestedFix.slice(0, 500) + "\n"
				}
				reply += "\n*Retry Safe:* " + (s.retrySafe ? "✅" : "❌") + "\n"
				reply += "*Needs Review:* " + (s.needsSeniorReview ? "⚠️ Yes" : "✅ No")
			}
			if (result.error) {
				reply += "\n*Error:* " + result.error
			}
		} else {
			// Generic JSON output for other actions
			reply += "```json\n" + JSON.stringify(result, null, 2).slice(0, 1500) + "\n```"
		}

		await sendMessage(botToken, chatId, reply)
	} catch (err) {
		logTelegramError("/mcp", chatId, null, err, { action: action })
		await sendMessage(botToken, chatId, "*MCP Error* ❌\n\n" + err.message)
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Smart Terminal Features — NL-First Chat Mode, Inline Execution, Error Handling
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * ─── Conversational Context Enrichment ──────────────────────────────────────
 * Tracks richer context across messages: last command, last error, last project,
 * last intent, and message count for smarter responses.
 */

/** Map<chatId, { lastCommand, lastError, lastProject, lastIntent, messageCount, lastBrainResult }> */
const _smartContext = new Map()

// ═══════════════════════════════════════════════════════════════════════════════
// Cross-Session User Memory — persists across sessions (survives session expiry)
// ═══════════════════════════════════════════════════════════════════════════════

/** Map<telegramUserId, { preferredProject, preferredAgent, recentIntents[], lastInteraction, ... }> */
const _userContext = new Map()

/**
 * Gets or initializes user-level context (persists across sessions).
 * Keyed by telegramUserId (not chatId) so it survives session expiry.
 * @param {number|string} telegramUserId
 * @returns {Object} User context object
 */
function getUserContext(telegramUserId) {
	if (!telegramUserId) return null
	var uid = String(telegramUserId)
	if (!_userContext.has(uid)) {
		_userContext.set(uid, {
			preferredProject: null,
			preferredAgent: null,
			recentIntents: [],
			recentProjects: [],
			lastInteraction: null,
			totalInteractions: 0,
			firstSeen: Date.now(),
			lastSeen: Date.now(),
			commonErrors: [],
			preferredModel: null,
			_timestamp: Date.now(),
		})
	}
	return _userContext.get(uid)
}

/**
 * Updates user-level context with new information.
 * @param {number|string} telegramUserId
 * @param {Object} updates - Partial updates to merge
 */
function updateUserContext(telegramUserId, updates) {
	var ctx = getUserContext(telegramUserId)
	if (!ctx) return
	ctx.lastSeen = Date.now()
	ctx.totalInteractions++
	for (var key in updates) {
		if (Object.prototype.hasOwnProperty.call(updates, key)) {
			ctx[key] = updates[key]
		}
	}
}

/**
 * Records an intent in the user's recent intents list (bounded to 20).
 * @param {number|string} telegramUserId
 * @param {string} intent
 */
function recordUserIntent(telegramUserId, intent) {
	var ctx = getUserContext(telegramUserId)
	if (!ctx) return
	ctx.recentIntents.push({ intent: intent, timestamp: Date.now() })
	if (ctx.recentIntents.length > 20) {
		ctx.recentIntents = ctx.recentIntents.slice(-20)
	}
}

/**
 * Records a project in the user's recent projects list (bounded to 10).
 * @param {number|string} telegramUserId
 * @param {string} projectName
 */
function recordUserProject(telegramUserId, projectName) {
	var ctx = getUserContext(telegramUserId)
	if (!ctx) return
	// Move to front if already exists
	var idx = ctx.recentProjects.indexOf(projectName)
	if (idx !== -1) {
		ctx.recentProjects.splice(idx, 1)
	}
	ctx.recentProjects.unshift(projectName)
	if (ctx.recentProjects.length > 10) {
		ctx.recentProjects = ctx.recentProjects.slice(0, 10)
	}
}

/**
 * Records a common error pattern for a user (bounded to 10).
 * @param {number|string} telegramUserId
 * @param {string} errorMessage
 */
function recordUserError(telegramUserId, errorMessage) {
	if (!errorMessage) return
	var ctx = getUserContext(telegramUserId)
	if (!ctx) return
	var existing = ctx.commonErrors.find(function (e) {
		return e.message === errorMessage
	})
	if (existing) {
		existing.count++
		existing.lastSeen = Date.now()
	} else {
		ctx.commonErrors.push({ message: errorMessage, count: 1, firstSeen: Date.now(), lastSeen: Date.now() })
		if (ctx.commonErrors.length > 10) {
			ctx.commonErrors = ctx.commonErrors.slice(-10)
		}
	}
}

/**
 * Gets or initializes smart context for a chat.
 * @param {number|string} chatId
 * @returns {Object} Smart context object
 */
function getSmartContext(chatId) {
	if (!_smartContext.has(chatId)) {
		_smartContext.set(chatId, {
			lastCommand: null,
			lastError: null,
			lastProject: null,
			lastIntent: null,
			messageCount: 0,
			lastBrainResult: null,
			lastCommandOutput: null,
			lastFixApplied: null,
			workflowHistory: [],
			conversationTopic: null,
			_timestamp: Date.now(),
		})
	}
	return _smartContext.get(chatId)
}

/**
 * Updates smart context with new information.
 * @param {number|string} chatId
 * @param {Object} updates - Partial updates to merge into smart context
 */
function updateSmartContext(chatId, updates) {
	var ctx = getSmartContext(chatId)
	ctx.messageCount++
	for (var key in updates) {
		if (Object.prototype.hasOwnProperty.call(updates, key)) {
			ctx[key] = updates[key]
		}
	}
}

/**
 * Detects the conversation topic from recent messages using keyword clustering.
 * Updates smart context with the detected topic every 3 messages.
 * @param {number|string} chatId
 */
function detectConversationTopic(chatId) {
	var ctx = getSmartContext(chatId)
	var history = conversationHistory.get(chatId)
	if (!history || history.length < 3) return

	// Only re-detect every 3 messages to avoid churn
	if (ctx.messageCount % 3 !== 0 && ctx.conversationTopic) return

	var recentText = history
		.slice(-6)
		.map(function (m) {
			return m.content
		})
		.join(" ")
		.toLowerCase()

	var topicKeywords = {
		deployment: ["deploy", "deployment", "release", "rollback", "staging", "production", "ship", "publish"],
		development: ["code", "feature", "implement", "refactor", "write", "add", "create", "build", "fix"],
		debugging: ["bug", "error", "crash", "fail", "broken", "wrong", "issue", "problem", "log", "trace"],
		testing: ["test", "spec", "assert", "coverage", "qa", "quality", "ci", "pipeline"],
		infrastructure: ["docker", "server", "vps", "database", "redis", "queue", "worker", "config", "setup"],
		monitoring: ["monitor", "alert", "health", "status", "metric", "dashboard", "uptime"],
		learning: ["how", "what", "why", "explain", "tutorial", "guide", "learn", "understand", "documentation"],
	}

	var scores = {}
	for (var topic in topicKeywords) {
		var keywords = topicKeywords[topic]
		scores[topic] = 0
		for (var k = 0; k < keywords.length; k++) {
			var regex = new RegExp("\\b" + keywords[k] + "\\w*", "gi")
			var matches = recentText.match(regex)
			if (matches) scores[topic] += matches.length
		}
	}

	var bestTopic = null
	var bestScore = 0
	for (var t in scores) {
		if (scores[t] > bestScore) {
			bestScore = scores[t]
			bestTopic = t
		}
	}

	if (bestTopic && bestScore >= 2) {
		ctx.conversationTopic = bestTopic
	}
}

/**
 * Builds a context-aware system prompt for the AI that includes smart context
 * and cross-session user memory.
 * @param {number|string} chatId
 * @param {number|string} [telegramUserId] - Optional user ID for cross-session context
 * @returns {string} Context snippet to append to system prompt
 */
function buildSmartContextPrompt(chatId, telegramUserId) {
	var ctx = getSmartContext(chatId)
	var parts = []
	if (ctx.activeFile) parts.push("Active file (user is editing): " + ctx.activeFile)
	if (ctx.lastCommand) parts.push("Last command executed: `" + ctx.lastCommand + "`")
	if (ctx.lastError) parts.push("Last error encountered: " + ctx.lastError.slice(0, 200))
	if (ctx.lastProject) parts.push("Active project: " + ctx.lastProject)
	if (ctx.lastIntent) parts.push("Last intent: " + ctx.lastIntent)
	if (ctx.lastFixApplied) parts.push("Last fix applied: " + ctx.lastFixApplied.slice(0, 200))
	if (ctx.messageCount > 1) parts.push("Message count in this session: " + ctx.messageCount)

	// Inject cross-session user memory (persists across sessions)
	if (telegramUserId) {
		try {
			var uctx = getUserContext(telegramUserId)
			if (uctx) {
				var userParts = []
				if (uctx.preferredProject) userParts.push("preferred project: " + uctx.preferredProject)
				if (uctx.preferredAgent) userParts.push("preferred agent: " + uctx.preferredAgent)
				if (uctx.recentProjects && uctx.recentProjects.length > 0) {
					userParts.push("recent projects: " + uctx.recentProjects.slice(0, 3).join(", "))
				}
				if (uctx.recentIntents && uctx.recentIntents.length > 0) {
					// Count intent frequency
					var intentCounts = {}
					for (var ri = 0; ri < uctx.recentIntents.length; ri++) {
						var intentName = uctx.recentIntents[ri].intent
						intentCounts[intentName] = (intentCounts[intentName] || 0) + 1
					}
					var topIntents = Object.entries(intentCounts)
						.sort(function (a, b) {
							return b[1] - a[1]
						})
						.slice(0, 3)
						.map(function (e) {
							return e[0] + " (" + e[1] + "x)"
						})
					userParts.push("frequent intents: " + topIntents.join(", "))
				}
				if (uctx.totalInteractions > 0) {
					userParts.push("total interactions: " + uctx.totalInteractions)
				}
				if (userParts.length > 0) {
					parts.push("User profile (cross-session): " + userParts.join(" | "))
				}
			}
		} catch (e) {
			// Non-fatal
		}
	}

	// Inject detected conversation topic (GAP 2.5)
	if (ctx.conversationTopic) {
		parts.push("Conversation topic: " + ctx.conversationTopic)
	}

	// Inject learned patterns from telegramLearner
	try {
		var userPatterns = telegramLearner.getUserPatterns(String(chatId))
		if (userPatterns && userPatterns.length > 0) {
			var topPatterns = userPatterns.slice(0, 3)
			parts.push(
				"User's common intents: " +
					topPatterns
						.map(function (p) {
							return p.intent + " (" + p.count + "x)"
						})
						.join(", "),
			)
		}
	} catch (e) {
		// Non-fatal
	}

	if (parts.length > 0) {
		return "\n\n*Smart Context:*\n" + parts.join("\n")
	}
	return ""
}

/**
 * ─── NL-First Chat Mode ─────────────────────────────────────────────────────
 * Auto-detects coding intent from natural language and routes directly to
 * Terminal Brain without requiring /brain prefix.
 *
 * Detects patterns like:
 *   "run npm test" → brain execute
 *   "fix the build error" → brain plan + execute + analyze
 *   "check my logs" → read logs
 *   "deploy the app" → deploy pipeline
 */

/**
 * Detects if a message has strong coding/execution intent that should bypass
 * the normal NLP routing and go directly to Terminal Brain.
 * @param {string} text - The user's message
 * @returns {Object|null} { action: "plan"|"execute"|"pipeline"|"analyze"|"fix", query: string } or null
 */
function detectCodingIntent(text) {
	var lower = text.toLowerCase().trim()

	// Direct execution patterns — "run X", "execute X", "do X"
	var runMatch = lower.match(/^(?:run|execute|do)\s+(.+)/)
	if (runMatch) {
		return { action: "execute", query: runMatch[1] }
	}

	// Fix patterns — "fix X", "debug X", "repair X"
	var fixMatch = lower.match(/^(?:fix|debug|repair|resolve)\s+(.+)/)
	if (fixMatch) {
		return { action: "pipeline", query: fixMatch[1] }
	}

	// Build/test patterns
	if (
		lower.includes("build") ||
		lower.includes("compile") ||
		lower.includes("npm ") ||
		lower.includes("pnpm ") ||
		lower.includes("yarn ") ||
		lower.includes("npx ")
	) {
		return { action: "plan", query: text }
	}

	// Check patterns — "check X", "show X", "get X"
	var checkMatch = lower.match(/^(?:check|show|get|list|view)\s+(.+)/)
	if (checkMatch) {
		var checkQuery = checkMatch[1]
		if (
			checkQuery.includes("log") ||
			checkQuery.includes("status") ||
			checkQuery.includes("test") ||
			checkQuery.includes("error") ||
			checkQuery.includes("deploy")
		) {
			return { action: "plan", query: text }
		}
	}

	return null
}

/**
 * Handles a coding intent directly via Terminal Brain without going through
 * the BullMQ queue. This provides instant feedback in the Telegram chat.
 *
 * @param {string} botToken
 * @param {number} chatId
 * @param {Object} codingIntent - { action, query } from detectCodingIntent()
 * @param {Array} providers - AI provider configs
 * @returns {Promise<boolean>} Whether the message was handled
 */
async function handleCodingIntentDirect(botToken, chatId, codingIntent, providers) {
	if (!_terminalBrainAvailable) return false

	try {
		await sendChatAction(botToken, chatId, "typing")

		var action = codingIntent.action
		var query = codingIntent.query

		// Log the smart context
		updateSmartContext(chatId, { lastIntent: "coding:" + action })

		if (action === "execute") {
			// Direct execution — run the command via Terminal Brain
			var execResult = await tgEndpoints.brainExecute(query, chatId)
			if (!execResult.ok) {
				await sendMessage(botToken, chatId, "*Execution Error* ❌\n\n" + (execResult.error || "Unknown error"))
				return true
			}

			// Update smart context
			updateSmartContext(chatId, {
				lastCommand: query,
				lastBrainResult: execResult,
				lastCommandOutput: execResult.feedback ? execResult.feedback.output : null,
			})

			// Format and send result
			var execReply = telegramEngineer.formatBrainFeedback(execResult.feedback)
			await sendMessage(botToken, chatId, execReply)

			// ─── Smart Error Handling: Auto-analyze errors ────────────────
			if (execResult.feedback && execResult.feedback.exitCode !== 0) {
				await sendChatAction(botToken, chatId, "typing")
				// Small delay so user sees the result first
				await new Promise(function (r) {
					return setTimeout(r, 500)
				})

				try {
					var analyzeResult = await tgEndpoints.brainAnalyze(execResult.feedback.output || query, chatId)
					if (analyzeResult.ok && analyzeResult.errors && analyzeResult.errors.length > 0) {
						updateSmartContext(chatId, {
							lastError: analyzeResult.errors[0].message || analyzeResult.errors[0].type,
						})
						var analyzeReply = telegramEngineer.formatBrainErrors(analyzeResult.errors)
						await sendMessage(botToken, chatId, analyzeReply)

						// Auto-suggest fixes
						var fixResult = await tgEndpoints.brainFix(execResult.feedback.output || query, chatId)
						if (fixResult.ok && fixResult.fixes && fixResult.fixes.length > 0) {
							updateSmartContext(chatId, { lastFixApplied: fixResult.fixes[0] })
							var fixLines = ["*🔧 Auto-Suggested Fixes*"]
							for (var fi = 0; fi < Math.min(fixResult.fixes.length, 3); fi++) {
								fixLines.push("• " + fixResult.fixes[fi])
							}
							await sendMessage(botToken, chatId, fixLines.join("\n"))
						}
					}
				} catch (brainErr) {
					console.log("[telegram] Auto error analysis failed:", brainErr.message)
				}
			}

			// Add quick action buttons after execution
			await sendQuickActionButtons(botToken, chatId, query, execResult)

			return true
		}

		if (action === "plan") {
			var planResult = await tgEndpoints.brainPlan(query, chatId)
			if (!planResult.ok) {
				await sendMessage(botToken, chatId, "*Plan Error* ❌\n\n" + (planResult.error || "Unknown error"))
				return true
			}
			var planReply = telegramEngineer.formatBrainPlan(planResult)
			await sendMessage(botToken, chatId, planReply)

			// If there are commands in the plan, offer to execute them
			if (planResult.commands && planResult.commands.length > 0) {
				var firstCmd =
					typeof planResult.commands[0] === "string"
						? planResult.commands[0]
						: planResult.commands[0].command || ""
				if (firstCmd) {
					// Use token-based callback_data to stay within Telegram's 64-byte limit
					var planExecToken = storeCallbackCommand(firstCmd)
					var planPipeToken = storeCallbackCommand(query)
					await sendInlineKeyboard(
						botToken,
						chatId,
						"*Execute this plan?* 🚀\n\nTap below to run the first command or the full pipeline.",
						[
							[
								{
									text: "▶️ Run: " + firstCmd.slice(0, 30),
									callback_data: "brain_exec:" + planExecToken,
								},
							],
							[
								{ text: "🔄 Full Pipeline", callback_data: "brain_pipeline:" + planPipeToken },
								{ text: "❌ Cancel", callback_data: "brain_cancel" },
							],
						],
					)
				}
			}

			return true
		}

		if (action === "pipeline") {
			var pipeResult = await tgEndpoints.brainPipeline(query, chatId)
			if (!pipeResult.ok) {
				await sendMessage(botToken, chatId, "*Pipeline Error* ❌\n\n" + (pipeResult.error || "Unknown error"))
				return true
			}

			updateSmartContext(chatId, {
				lastCommand: query,
				lastBrainResult: pipeResult,
			})

			// Build comprehensive pipeline result
			var pipeLines = ["*🧠 Terminal Brain — Pipeline Result*"]

			if (pipeResult.plan) {
				pipeLines.push("\n*📋 Plan:*")
				var planCmds = pipeResult.plan.commands || []
				for (var pi = 0; pi < planCmds.length; pi++) {
					var pc = typeof planCmds[pi] === "string" ? planCmds[pi] : planCmds[pi].command || ""
					pipeLines.push("  `" + (pi + 1) + ".` `" + pc + "`")
				}
			}

			if (pipeResult.feedback) {
				var fbArray = Array.isArray(pipeResult.feedback) ? pipeResult.feedback : [pipeResult.feedback]
				for (var fbi = 0; fbi < fbArray.length; fbi++) {
					var fb = fbArray[fbi]
					var fbIcon = fb.exitCode === 0 ? "✅" : "❌"
					pipeLines.push("\n*" + fbIcon + " Step " + (fbi + 1) + ":* Exit `" + fb.exitCode + "`")
				}
			}

			if (pipeResult.errors && pipeResult.errors.length > 0) {
				updateSmartContext(chatId, { lastError: pipeResult.errors[0].message || pipeResult.errors[0].type })
				pipeLines.push("\n*🔍 Errors Found:* " + pipeResult.errors.length)
				for (var ei = 0; ei < Math.min(pipeResult.errors.length, 3); ei++) {
					var pe = pipeResult.errors[ei]
					pipeLines.push("  • `" + pe.type + "`" + (pe.message ? ": " + pe.message.slice(0, 100) : ""))
				}
				if (pipeResult.errors.length > 3) {
					pipeLines.push("  *+ " + (pipeResult.errors.length - 3) + " more*")
				}
			}

			if (pipeResult.fixes && pipeResult.fixes.length > 0) {
				updateSmartContext(chatId, { lastFixApplied: pipeResult.fixes[0] })
				pipeLines.push("\n*🔧 Fixes Applied:* " + pipeResult.fixes.length)
				for (var fxi = 0; fxi < Math.min(pipeResult.fixes.length, 3); fxi++) {
					pipeLines.push("  • " + pipeResult.fixes[fxi].slice(0, 150))
				}
				if (pipeResult.fixes.length > 3) {
					pipeLines.push("  *+ " + (pipeResult.fixes.length - 3) + " more*")
				}
			}

			if (!pipeResult.errors || pipeResult.errors.length === 0) {
				pipeLines.push("\n✅ *All steps completed successfully!*")
			}

			await sendMessage(botToken, chatId, pipeLines.join("\n"))

			// Add quick action buttons after pipeline
			await sendQuickActionButtons(botToken, chatId, query, pipeResult)

			return true
		}

		return false
	} catch (err) {
		logTelegramError("nl:coding_direct", chatId, null, err, {
			action: codingIntent.action,
			query: codingIntent.query,
		})
		await sendMessage(botToken, chatId, "*Smart Terminal Error* ❌\n\n" + err.message)
		return true
	}
}

/**
 * ─── Quick Action Buttons ──────────────────────────────────────────────────
 * Sends context-aware inline keyboard buttons after every response so the user
 * can take immediate next actions without typing.
 */

/**
 * Sends quick action buttons based on the last command/result context.
 * @param {string} botToken
 * @param {number} chatId
 * @param {string} lastCommand - The command that was executed
 * @param {Object} lastResult - The result object from execution
 */
async function sendQuickActionButtons(botToken, chatId, lastCommand, lastResult) {
	try {
		var buttons = []

		// Always offer: Run Again, Explain, Fix
		if (lastCommand) {
			// Use token-based callback_data to stay within Telegram's 64-byte limit
			var execToken = storeCallbackCommand(lastCommand)
			var explainToken = storeCallbackCommand(lastCommand)
			buttons.push([
				{ text: "🔄 Run Again", callback_data: "brain_exec:" + execToken },
				{ text: "❓ Explain", callback_data: "brain_explain:" + explainToken },
			])
		}

		// If there were errors, offer fix
		var hadErrors =
			lastResult &&
			((lastResult.feedback && lastResult.feedback.exitCode !== 0) ||
				(lastResult.errors && lastResult.errors.length > 0))
		if (hadErrors && lastCommand) {
			var fixToken = storeCallbackCommand(lastCommand)
			var errToken = storeCallbackCommand(lastCommand)
			buttons.push([
				{ text: "🔧 Auto-Fix", callback_data: "brain_fix:" + fixToken },
				{ text: "📋 Show Errors", callback_data: "brain_errors:" + errToken },
			])
		}

		// If successful, offer deploy
		var wasSuccess = lastResult && lastResult.feedback && lastResult.feedback.exitCode === 0
		if (wasSuccess && lastCommand) {
			var deployToken = storeCallbackCommand(lastCommand)
			buttons.push([{ text: "🚀 Deploy", callback_data: "brain_deploy:" + deployToken }])
		}

		// Common actions
		buttons.push([
			{ text: "📊 Status", callback_data: "brain_status" },
			{ text: "🧠 Memory", callback_data: "brain_memory" },
		])

		// ─── GAP 5.2: Pattern-Based Next Action Suggestions ─────────────────
		// Append suggested next actions from the learner (based on user patterns).
		var ctx = getSmartContext(chatId)
		if (ctx && ctx.suggestedNextActions && ctx.suggestedNextActions.length > 0) {
			var suggestionButtons = []
			var actionLabels = {
				run_tests: "🧪 Test",
				deploy: "🚀 Deploy",
				read_logs: "📋 Logs",
				code_task: "💻 Code",
				debug_plan: "🔍 Debug",
				commit_status: "📊 Status",
				create_pr: "🔀 PR",
			}
			for (var si = 0; si < ctx.suggestedNextActions.length; si++) {
				var action = ctx.suggestedNextActions[si]
				var label = actionLabels[action] || "➡️ " + action
				var actionToken = storeCallbackCommand("/" + action)
				suggestionButtons.push({ text: label, callback_data: "brain_exec:" + actionToken })
			}
			if (suggestionButtons.length > 0) {
				buttons.push(suggestionButtons)
			}
		}

		if (buttons.length > 0) {
			await sendInlineKeyboard(botToken, chatId, "*Quick Actions* ⚡", buttons)
		}
	} catch (err) {
		// Non-fatal — quick actions are a bonus
		console.log("[telegram] Quick action buttons failed:", err.message)
	}
}

/**
 * ─── Command Correction ────────────────────────────────────────────────────
 * Suggests corrections for mistyped commands using Levenshtein distance
 * against known commands.
 */

/** Known commands for correction suggestions */
const KNOWN_COMMANDS = [
	"/start",
	"/login",
	"/help",
	"/about",
	"/otp",
	"/specify",
	"/projects",
	"/miniide",
	"/workspace",
	"/session",
	"/settings",
	"/agents",
	"/brain",
	"/hermes",
	"/skills",
	"/resources",
	"/upgrade",
	"/mcp",
	"/menu",
	"/recent",
	"/again",
	"/code",
	"/diff",
	"/approve",
	"/deploy",
	"/status",
	"/cancel",
	"/debug",
	"/logs",
	"/tests",
	"/restart",
	"/aceteam",
	"/ask",
	"/shell",
]

/** Brain subcommands for correction */
const BRAIN_SUBCOMMANDS = ["plan", "exec", "execute", "analyze", "fix", "memory", "context", "pipeline", "help"]

/** Hermes Claw subcommands for correction (defined above at line 2949) */
// const HERMES_SUBCOMMANDS = ["recall", "learn", "skill", "pattern", "patterns", "query", "stats", "lesson", "lessons", "help"]

/**
 * Calculates Levenshtein distance between two strings.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function levenshteinDistance(a, b) {
	var alen = a.length
	var blen = b.length
	var matrix = []
	for (var i = 0; i <= blen; i++) {
		matrix[i] = [i]
	}
	for (var j = 0; j <= alen; j++) {
		matrix[0][j] = j
	}
	for (var i = 1; i <= blen; i++) {
		for (var j = 1; j <= alen; j++) {
			if (b.charAt(i - 1) === a.charAt(j - 1)) {
				matrix[i][j] = matrix[i - 1][j - 1]
			} else {
				matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1))
			}
		}
	}
	return matrix[blen][alen]
}

/**
 * Finds the closest matching command for a mistyped input.
 * @param {string} input - The mistyped command
 * @param {Array} candidates - Array of known commands
 * @param {number} maxDistance - Maximum Levenshtein distance (default: 3)
 * @returns {string|null} The closest match or null
 */
function findClosestCommand(input, candidates, maxDistance) {
	if (maxDistance === undefined) maxDistance = 3
	var best = null
	var bestDist = Infinity
	for (var i = 0; i < candidates.length; i++) {
		var dist = levenshteinDistance(input.toLowerCase(), candidates[i].toLowerCase())
		if (dist < bestDist && dist <= maxDistance) {
			bestDist = dist
			best = candidates[i]
		}
	}
	return best
}

/**
 * Checks if a command is likely mistyped and returns a suggestion.
 * @param {string} command - The command the user typed
 * @returns {string|null} Suggestion message or null
 */
function suggestCommandCorrection(command) {
	if (!command || !command.startsWith("/")) return null

	var closest = findClosestCommand(command, KNOWN_COMMANDS)
	if (closest) {
		return "Did you mean `" + closest + "`? 🤔\n\n(Tap the corrected command above)"
	}

	// Check for /brain subcommand typos
	if (command === "/brain" || command.startsWith("/brain ")) {
		var parts = command.split(/\s+/)
		if (parts.length > 1) {
			var subCmd = parts[1].toLowerCase()
			var closestSub = findClosestCommand(subCmd, BRAIN_SUBCOMMANDS, 2)
			if (closestSub) {
				var corrected = "/brain " + closestSub + " " + parts.slice(2).join(" ")
				return "Did you mean `" + corrected + "`? 🤔"
			}
		}
	}

	return null
}

/**
 * ─── Workflow Templates ────────────────────────────────────────────────────
 * Pre-built command sequences for common tasks that can be triggered with
 * a single command or natural language phrase.
 */

const WORKFLOW_TEMPLATES = {
	deploy: {
		name: "🚀 Deploy",
		description: "Run tests, build, and deploy to production",
		steps: [
			{ command: "cd /opt/superroo2 && git pull", description: "Pull latest code" },
			{ command: "cd /opt/superroo2 && npm install", description: "Install dependencies" },
			{ command: "cd /opt/superroo2 && npm run build", description: "Build project" },
			{ command: "pm2 restart superroo-api", description: "Restart API server" },
		],
	},
	test: {
		name: "🧪 Run Tests",
		description: "Run the full test suite",
		steps: [{ command: "cd /opt/superroo2 && npx vitest run", description: "Run all tests" }],
	},
	build: {
		name: "🔨 Build",
		description: "Build the project",
		steps: [{ command: "cd /opt/superroo2 && npm run build", description: "Build project" }],
	},
	logs: {
		name: "📋 Check Logs",
		description: "Check recent logs for errors",
		steps: [{ command: "pm2 logs --lines 20 --nostream", description: "Get recent logs" }],
	},
	status: {
		name: "📊 System Status",
		description: "Check all system services",
		steps: [
			{ command: "pm2 status", description: "PM2 process status" },
			{ command: "df -h", description: "Disk usage" },
			{ command: "free -m", description: "Memory usage" },
		],
	},
	update: {
		name: "🔄 Update & Restart",
		description: "Pull latest, install, build, and restart all services",
		steps: [
			{ command: "cd /opt/superroo2 && git pull", description: "Pull latest code" },
			{ command: "cd /opt/superroo2 && npm install", description: "Install dependencies" },
			{ command: "cd /opt/superroo2 && npm run build", description: "Build project" },
			{ command: "pm2 restart all", description: "Restart all services" },
		],
	},
}

/**
 * Detects if a message matches a workflow template.
 * @param {string} text - The user's message
 * @returns {Object|null} { template: string, workflow: Object } or null
 */
function detectWorkflowIntent(text) {
	var lower = text.toLowerCase().trim()

	for (var key in WORKFLOW_TEMPLATES) {
		if (Object.prototype.hasOwnProperty.call(WORKFLOW_TEMPLATES, key)) {
			var tmpl = WORKFLOW_TEMPLATES[key]
			// Check if the message matches the workflow name or description
			if (
				lower === key ||
				lower === "run " + key ||
				lower === "do " + key ||
				lower === "start " + key ||
				lower.includes(tmpl.name.toLowerCase()) ||
				lower.includes(tmpl.description.toLowerCase())
			) {
				return { template: key, workflow: tmpl }
			}
		}
	}
	return null
}

/**
 * Executes a workflow template and reports results.
 * @param {string} botToken
 * @param {number} chatId
 * @param {Object} workflowIntent - { template, workflow } from detectWorkflowIntent()
 * @returns {Promise<boolean>} Whether the workflow was handled
 */
async function handleWorkflowTemplate(botToken, chatId, workflowIntent) {
	if (!_terminalBrainAvailable) {
		await sendMessage(botToken, chatId, "*Workflow Error* ❌\n\nTerminal Brain is required for workflow execution.")
		return true
	}

	try {
		var tmpl = workflowIntent.workflow
		await sendMessage(
			botToken,
			chatId,
			"*" +
				tmpl.name +
				"*\n\n" +
				tmpl.description +
				"\n\nStarting workflow with " +
				tmpl.steps.length +
				" steps...",
		)

		var results = []
		for (var si = 0; si < tmpl.steps.length; si++) {
			var step = tmpl.steps[si]
			await sendChatAction(botToken, chatId, "typing")

			var stepResult = await tgEndpoints.brainExecute(step.command, chatId)
			var icon = stepResult.ok && stepResult.feedback && stepResult.feedback.exitCode === 0 ? "✅" : "❌"
			results.push({ step: step, result: stepResult })

			await sendMessage(
				botToken,
				chatId,
				icon +
					" *Step " +
					(si + 1) +
					"/" +
					tmpl.steps.length +
					":* " +
					step.description +
					"\n`" +
					step.command +
					"`" +
					(stepResult.feedback && stepResult.feedback.exitCode !== 0
						? "\nExit: `" + stepResult.feedback.exitCode + "`"
						: ""),
			)
		}

		// Summary
		var successCount = results.filter(function (r) {
			return r.result.ok && r.result.feedback && r.result.feedback.exitCode === 0
		}).length
		var summaryIcon = successCount === tmpl.steps.length ? "✅" : "⚠️"
		await sendMessage(
			botToken,
			chatId,
			summaryIcon + " *Workflow Complete:* " + successCount + "/" + tmpl.steps.length + " steps succeeded",
		)

		updateSmartContext(chatId, {
			lastCommand: "workflow:" + workflowIntent.template,
			lastIntent: "workflow",
		})

		return true
	} catch (err) {
		logTelegramError("workflow:" + workflowIntent.template, chatId, null, err)
		await sendMessage(botToken, chatId, "*Workflow Error* ❌\n\n" + err.message)
		return true
	}
}

/**
 * ─── AI-Powered Command Prediction ─────────────────────────────────────────
 * Suggests next commands based on conversation context and recent activity.
 */

/**
 * Builds a prediction prompt for the AI to suggest next commands.
 * @param {number|string} chatId
 * @returns {string} The prompt for the AI
 */
function buildPredictionPrompt(chatId) {
	var ctx = getSmartContext(chatId)
	var parts = [
		"Based on the following context, suggest 2-3 likely next commands or actions the user might want to take. Be concise and specific.",
	]

	if (ctx.lastCommand) parts.push("Last command: " + ctx.lastCommand)
	if (ctx.lastError) parts.push("Last error: " + ctx.lastError.slice(0, 100))
	if (ctx.lastIntent) parts.push("Last intent: " + ctx.lastIntent)
	if (ctx.lastFixApplied) parts.push("Last fix applied: " + ctx.lastFixApplied.slice(0, 100))

	parts.push("\nSuggestions should be in format:")
	parts.push("- `/command` — description")
	parts.push("Keep it to 3 suggestions max.")

	return parts.join("\n")
}

/**
 * Gets AI-powered command predictions for the current context.
 * @param {number|string} chatId
 * @param {Array} providers - AI provider configs
 * @returns {Promise<string>} Prediction text or empty string
 */
async function getCommandPredictions(chatId, providers) {
	if (!providers || providers.length === 0) return ""

	var prompt = buildPredictionPrompt(chatId)

	for (var i = 0; i < providers.length; i++) {
		var provider = providers[i]
		if (!provider.apiKey) continue
		try {
			var url = (provider.apiBaseUrl || "").replace(/\/+$/, "") + "/chat/completions"
			var res = await fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer " + provider.apiKey,
				},
				body: JSON.stringify({
					model: provider.model,
					messages: [
						{
							role: "system",
							content: "You are a senior DevOps engineer suggesting next commands. Be concise.",
						},
						{ role: "user", content: prompt },
					],
					max_tokens: 256,
					temperature: 0.3,
				}),
				signal: AbortSignal.timeout(10_000),
			})
			if (!res.ok) continue
			var data = await res.json()
			var reply = data.choices[0]?.message?.content || ""
			if (reply.trim()) return reply
		} catch (err) {
			console.log("[telegram] Command prediction error:", err.message)
			continue
		}
	}
	return ""
}

/**
 * ─── Enhanced NLP Router ───────────────────────────────────────────────────
 * Integrates NL-First Chat Mode into the existing NLP routing pipeline.
 * This is called from handleNaturalLanguageInstruction before the legacy routing.
 */

/**
 * Enhanced version of handleNaturalLanguageInstruction that first checks for
 * direct coding intents, workflow templates, and then falls back to the
 * existing NLP routing.
 *
 * @param {string} botToken
 * @param {number} chatId
 * @param {string} text - The user's message
 * @param {number} telegramUserId
 * @param {object} queue - BullMQ queue
 * @param {Array} providers - AI provider configs
 * @returns {Promise<boolean>} Whether the message was handled
 */
async function handleSmartNLP(botToken, chatId, text, telegramUserId, queue, providers) {
	// Step 1: Check for workflow templates (fast, no LLM needed)
	var workflowIntent = detectWorkflowIntent(text)
	if (workflowIntent) {
		logTelegramUsage("nl:workflow", chatId, telegramUserId, { template: workflowIntent.template })
		return await handleWorkflowTemplate(botToken, chatId, workflowIntent)
	}

	// Step 2: Check for direct coding intent (NL-First Chat Mode)
	var codingIntent = detectCodingIntent(text)
	if (codingIntent && _terminalBrainAvailable) {
		logTelegramUsage("nl:coding_direct", chatId, telegramUserId, {
			action: codingIntent.action,
			query: codingIntent.query.slice(0, 60),
		})
		var handled = await handleCodingIntentDirect(botToken, chatId, codingIntent, providers)
		if (handled) return true
	}

	// Step 3: Fall back to existing NLP routing
	return false
}

async function handleAbout(botToken, chatId) {
	await sendMessage(
		botToken,
		chatId,
		"*SuperRoo Bot* 🤖\n\n" +
			"Version: 2.0.0\n" +
			"Framework: Telegram Bot API (native)\n" +
			"Backend: SuperRoo Cloud API\n\n" +
			"*Features:*\n" +
			"• Unified auth across Telegram, Web, and VS Code\n" +
			"• Project management with workspace switching\n" +
			"• AI-powered coding assistant\n" +
			"• Task queue with status tracking\n" +
			"• Secure deploy with Google Authenticator OTP\n\n" +
			"*Dashboard:* DASHBOARD_URL\n" +
			"*Support:* Use `/ask <question>` or tag @superroo_bot in group chat",
	)
}

// ─── Group Workspace Binding ───────────────────────────────────────────────

/**
 * Loads group workspace bindings from the JSON file into the in-memory Map.
 * Called once at startup.
 */
async function loadGroupWorkspaces() {
	try {
		const data = await fs.readFile(GROUP_WORKSPACES_FILE, "utf-8")
		const parsed = JSON.parse(data)
		for (const [chatId, workspaceName] of Object.entries(parsed)) {
			groupWorkspaces.set(String(chatId), workspaceName)
		}
		console.log("[telegram] Loaded " + groupWorkspaces.size + " group workspace bindings")
	} catch {
		console.log("[telegram] No group workspace bindings file found, starting fresh")
	}
}

/**
 * Persists the current group workspace bindings to the JSON file.
 */
async function saveGroupWorkspaces() {
	try {
		const dir = path.dirname(GROUP_WORKSPACES_FILE)
		await fs.mkdir(dir, { recursive: true })
		const obj = Object.fromEntries(groupWorkspaces)
		await fs.writeFile(GROUP_WORKSPACES_FILE, JSON.stringify(obj, null, 2), "utf-8")
	} catch (err) {
		console.error("[telegram] Failed to save group workspace bindings:", err.message)
	}
}

/**
 * Handles /specify <workspaceName> — binds a group chat to a specific workspace/project.
 * Once bound, all natural language messages in that group automatically use the
 * specified workspace for agent routing (coding, debugging, deploying, etc.).
 *
 * Usage: /specify "productgenerator"
 *        /specify superroo2
 *
 * @param {string} botToken
 * @param {number} chatId - The group chat ID
 * @param {string[]} args - ["productgenerator"] or ['"product generator"']
 * @param {number} telegramUserId
 */
async function handleSpecify(botToken, chatId, args, telegramUserId) {
	// Only works in group chats
	if (chatId >= 0) {
		await sendMessage(
			botToken,
			chatId,
			"*Group-Only Command* 👥\n\n" +
				"The `/specify` command is only available in group chats. " +
				"Add me to a group and use `/specify <workspace>` there to bind it to a project.",
		)
		return
	}

	// Check auth
	var authSession = await checkAuthSession(telegramUserId, chatId)
	if (!authSession) {
		await sendMessage(
			botToken,
			chatId,
			"*Authentication Required*\n\nPlease login first using `/login` to specify a workspace.",
		)
		return
	}

	// Parse workspace name from args (supports quoted strings)
	var workspaceName = args.join(" ").trim().replace(/^"|"$/g, "").replace(/^'|'$/g, "")
	if (!workspaceName) {
		await sendMessage(
			botToken,
			chatId,
			"*Usage:* `/specify <workspace>`\n\n" +
				"Example: `/specify productgenerator`\n" +
				'Example: `/specify "superroo2"`\n\n' +
				"This binds this group chat to the specified workspace/project. " +
				"All natural language messages will automatically use that workspace.",
		)
		return
	}

	// Look up the workspace by name in the user's projects
	try {
		var result = await auth.handleTelegramProjects({
			telegramUserId: telegramUserId,
			telegramChatId: chatId,
		})

		if (!result || !result.projects || result.projects.length === 0) {
			await sendMessage(
				botToken,
				chatId,
				"*No Projects Found*\n\n" +
					"You don't have any projects yet. Create one in the dashboard at DASHBOARD_URL",
			)
			return
		}

		// Find project matching the workspace name (case-insensitive, partial match)
		var matchedProject = null
		var lowerName = workspaceName.toLowerCase()
		for (var i = 0; i < result.projects.length; i++) {
			var p = result.projects[i]
			var pName = (p.name || p.repoName || "").toLowerCase()
			if (pName === lowerName || pName.includes(lowerName) || lowerName.includes(pName)) {
				matchedProject = p
				break
			}
		}

		if (!matchedProject) {
			var projectNames = result.projects
				.map(function (p) {
					return "• `" + (p.name || p.repoName) + "`"
				})
				.join("\n")
			await sendMessage(
				botToken,
				chatId,
				"*Workspace Not Found* 🔍\n\n" +
					'No project matching "' +
					workspaceName +
					'" was found.\n\n' +
					"*Your projects:*\n" +
					projectNames +
					"\n\n" +
					"Use `/projects` to see all projects.\n" +
					"Use `/specify <name>` to bind this group to a project.",
			)
			return
		}

		// Select the project as active
		await auth.handleTelegramProjectSelect(matchedProject.id, {
			telegramUserId: telegramUserId,
			telegramChatId: chatId,
		})

		// Store the binding
		groupWorkspaces.set(String(chatId), workspaceName)
		await saveGroupWorkspaces()

		// Register group chat routing so notifications for this user go to the group
		if (telegramUserId) {
			telegramNotifier.setGroupRouting(telegramUserId, chatId)
		}

		await sendMessage(
			botToken,
			chatId,
			"*Workspace Bound!* ✅\n\n" +
				"This group is now linked to:\n" +
				"*Project:* " +
				matchedProject.name +
				"\n" +
				"*ID:* `" +
				matchedProject.id +
				"`\n\n" +
				"All natural language messages in this group will automatically use this workspace.\n" +
				"All task notifications will be sent to this group instead of your DM.\n" +
				"Use `/specify <workspace>` to change it anytime.",
		)
	} catch (err) {
		console.error("[telegram] handleSpecify error:", err.message)
		await sendMessage(botToken, chatId, "*Error*\n\nCould not bind workspace. " + err.message)
	}
}

/**
 * Handles project selection from inline keyboard callback.
 * @param {string} botToken
 * @param {number} chatId
 * @param {number} messageId
 * @param {string} projectId
 * @param {number} telegramUserId
 */
async function handleProjectSelect(botToken, chatId, messageId, projectId, telegramUserId) {
	var authSession = await checkAuthSession(telegramUserId, chatId)
	if (!authSession) {
		await sendMessage(botToken, chatId, "*Authentication Required*\n\nPlease login first using `/login`.")
		return
	}

	try {
		var result = await auth.handleTelegramProjectSelect(projectId, {
			telegramUserId: telegramUserId,
			telegramChatId: chatId,
		})

		if (result && result.project) {
			// Record project in cross-session user memory
			if (telegramUserId) {
				recordUserProject(telegramUserId, result.project.name)
				updateUserContext(telegramUserId, { preferredProject: result.project.name })
			}
			// Update the original message to show selection
			await editMessageText(
				botToken,
				chatId,
				messageId,
				"*Project Selected* ✅\n\n*" +
					result.project.name +
					"* is now your active workspace.\n\n" +
					"Use `/code <instruction>` to start coding in this project.\n" +
					"Use `/workspace` to view the active workspace.",
			)

			// Send a follow-up message with Mini IDE WebApp button
			const miniIdeUrl = `${DASHBOARD_URL}/tg?workspace=` + encodeURIComponent(projectId) + "&chat_id=" + chatId
			await sendInlineKeyboard(
				botToken,
				chatId,
				"*Ready to Code* 🚀\n\nActive workspace: *" +
					result.project.name +
					"*\n\n" +
					"📱 *Open Mini IDE* — Full code editor with file browser, AI assistant, and file uploads.\n" +
					"Or send commands directly in chat:\n" +
					"`/code <instruction>` — Start coding\n" +
					"`/workspace` — View workspace\n" +
					"`/status` — Check status",
				[
					[{ text: "🚀 Open Mini IDE", web_app: miniIdeUrl }],
					[
						{ text: "📁 My Projects", callback_data: "projects" },
						{ text: "❓ Help", callback_data: "help" },
					],
				],
			)
		} else {
			await editMessageText(botToken, chatId, messageId, "*Error*\n\nCould not select project. Please try again.")
		}
	} catch (err) {
		console.error("[telegram] handleProjectSelect error:", err.message)
		await editMessageText(botToken, chatId, messageId, "*Error selecting project*\n\n" + err.message)
	}
}

/**
 * Detects the intent of a natural language message and determines the appropriate agent type.
 * Simple keyword-based detection that works without an AI call.
 * @param {string} text - The user's message
 * @returns {string} Agent type: "coder", "debugger", "deployer", "tester", or "ask"
 */
/**
 * Intent confidence scoring — returns an array of { intent, score, matchedKeywords }
 * instead of a single string. This enables disambiguation when multiple intents
 * have similar confidence levels.
 *
 * @param {string} text - The user's message text
 * @returns {{ intent: string, score: number, matchedKeywords: string[] }}
 */
function detectIntent(text) {
	var lower = text.toLowerCase()

	// ─── Intent keyword groups with weights ──────────────────────────────────
	// Each intent has a list of keyword groups. Each group has a weight.
	// Higher-weight keywords indicate stronger intent signal.
	var intentGroups = {
		consultant: [
			{ keywords: ["research", "analyze", "analysis", "evaluate", "evaluation"], weight: 3 },
			{ keywords: ["compare", "comparison", "pros and cons", "advantages", "disadvantages"], weight: 3 },
			{ keywords: ["best practice", "recommend", "recommendation", "guidance", "advise", "advice"], weight: 3 },
			{ keywords: ["viability", "feasibility", "strategy", "strategic", "architecture"], weight: 3 },
			{
				keywords: ["what is the best", "which one", "how does", "explain", "what is", "tell me about"],
				weight: 2,
			},
			{ keywords: ["design pattern", "technology stack", "tech stack", "overview", "deep dive"], weight: 2 },
			{
				keywords: ["learn about", "summary of", "consultant", "consult", "upgrade skill", "upgrade my skill"],
				weight: 2,
			},
		],
		debugger: [
			{ keywords: ["debug", "fix bug", "bug"], weight: 3 },
			{ keywords: ["error", "not working", "broken", "crash", "issue"], weight: 2 },
		],
		deployer: [{ keywords: ["deploy", "release", "publish", "ship", "go live"], weight: 3 }],
		tester: [
			{
				keywords: ["run test", "run the test", "run tests", "run e2e", "check test", "unit test", "vitest"],
				weight: 3,
			},
		],
		coder: [
			{ keywords: ["implement", "add feature", "refactor", "develop"], weight: 3 },
			{ keywords: ["code", "create", "write", "build", "make"], weight: 2 },
			{ keywords: ["update", "change", "modify", "improve", "fix"], weight: 2 },
			{ keywords: ["add ", "remove "], weight: 1 },
		],
		ask: [
			{
				keywords: ["what", "how", "why", "when", "where", "who", "which", "can you", "could you", "would you"],
				weight: 1,
			},
		],
	}

	var scores = {}
	var matchedKeywords = {}

	for (var intent in intentGroups) {
		var groups = intentGroups[intent]
		var totalScore = 0
		var matched = []
		for (var gi = 0; gi < groups.length; gi++) {
			var group = groups[gi]
			for (var ki = 0; ki < group.keywords.length; ki++) {
				var kw = group.keywords[ki]
				if (lower.includes(kw)) {
					totalScore += group.weight
					matched.push(kw)
				}
			}
		}
		if (totalScore > 0) {
			scores[intent] = totalScore
			matchedKeywords[intent] = matched
		}
	}

	// ─── No intent matched — default to "ask" with low confidence ────────────
	if (Object.keys(scores).length === 0) {
		return { intent: "ask", score: 0.1, matchedKeywords: [] }
	}

	// ─── Find the top intent(s) ─────────────────────────────────────────────
	var sortedIntents = Object.entries(scores).sort(function (a, b) {
		return b[1] - a[1]
	})

	var topIntent = sortedIntents[0][0]
	var topScore = sortedIntents[0][1]

	// ─── Disambiguation: check if second-place intent is close ───────────────
	// If the top two intents are within 1 point of each other, the intent is
	// ambiguous. We pick the higher one but flag it with a lower confidence.
	var secondScore = sortedIntents.length > 1 ? sortedIntents[1][1] : 0
	var isAmbiguous = secondScore > 0 && topScore - secondScore <= 1

	// Normalize score to 0-1 range (max possible score per intent varies)
	// Max possible: consultant=~30, debugger=~10, deployer=~15, tester=~21, coder=~16, ask=~10
	var maxPossible = { consultant: 30, debugger: 10, deployer: 15, tester: 21, coder: 16, ask: 10 }
	var maxScore = maxPossible[topIntent] || 10
	var normalizedScore = Math.min(topScore / maxScore, 1.0)

	// If ambiguous, reduce confidence by 30%
	if (isAmbiguous) {
		normalizedScore = normalizedScore * 0.7
	}

	return {
		intent: topIntent,
		score: Math.round(normalizedScore * 100) / 100,
		matchedKeywords: matchedKeywords[topIntent] || [],
	}
}

// ─── Zero-Friction Coding Helpers ────────────────────────────────────────────

/**
 * Detects whether a message looks like a pasted error / stack trace.
 * Returns true for: "Error: ...", "TypeError:", "at Object.", traceback lines, etc.
 * @param {string} text
 * @returns {boolean}
 */
function detectErrorPaste(text) {
	if (!text || text.length < 20) return false
	var lines = text.split("\n")
	var errorLineCount = 0
	for (var i = 0; i < lines.length; i++) {
		var l = lines[i].trim()
		if (
			/^(Error|TypeError|SyntaxError|ReferenceError|RangeError|URIError|EvalError|AssertionError|UnhandledPromiseRejection):/i.test(
				l,
			)
		)
			errorLineCount += 3
		if (/^\s+at\s+\S+\s+\(/.test(l)) errorLineCount++
		if (/^\s+at\s+\S+:\d+:\d+/.test(l)) errorLineCount++
		if (/Traceback \(most recent call last\)/i.test(l)) errorLineCount += 3
		if (/File ".*", line \d+/i.test(l)) errorLineCount++
		if (/ENOENT|ECONNREFUSED|EADDRINUSE|ETIMEDOUT|EPERM|EACCES/.test(l)) errorLineCount += 2
		if (/\[error\]|\[Error\]|ERROR:|FATAL:|PANIC:/.test(l)) errorLineCount++
	}
	return errorLineCount >= 3
}

/**
 * Sends a quick-action inline keyboard after a code/debug response.
 * Buttons: Run Tests, Show Diff, Open Dashboard.
 * @param {string} botToken
 * @param {number|string} chatId
 * @param {string} [taskId] - Optional task ID to link Diff/Approve to
 */
async function sendActionButtons(botToken, chatId, taskId) {
	var rows = [
		[
			{ text: "🧪 Run Tests", callback_data: "action:tests" },
			{ text: "📊 Show Diff", callback_data: taskId ? "action:diff:" + taskId : "action:diff" },
		],
		[
			{ text: "✅ Approve & Deploy", callback_data: taskId ? "action:approve:" + taskId : "action:approve" },
			{ text: "📋 Status", callback_data: "action:status" },
		],
	]
	try {
		await sendInlineKeyboard(botToken, chatId, "What's next?", rows)
	} catch (e) {
		// non-critical
	}
}

/**
 * Handles /file <path> — reads a file from the VPS and displays it in a code block.
 * @param {string} botToken
 * @param {number|string} chatId
 * @param {Array} args - command args (file path parts)
 */
async function handleFile(botToken, chatId, args) {
	var filePath = args.join(" ").trim()
	if (!filePath) {
		await sendMessage(botToken, chatId, "*Usage:* `/file <path>`\n\nExample: `/file src/index.ts`")
		return
	}
	await sendChatAction(botToken, chatId, "typing")
	var { execFile } = require("child_process")
	var { promisify } = require("util")
	var execFileAsync = promisify(execFile)
	try {
		// Resolve relative paths against bound workspace on VPS
		var resolvedPath = filePath
		if (!filePath.startsWith("/")) {
			var ctx = getSmartContext(chatId)
			var ws = groupWorkspaces.get(String(chatId)) || ctx.lastProject
			if (ws) {
				var candidates = ["/root/" + ws, "/opt/" + ws, "/home/" + ws, "/opt/superroo2"]
				for (var cp of candidates) {
					try {
						var fsSync = require("fs")
						if (fsSync.existsSync(cp + "/" + filePath)) {
							resolvedPath = cp + "/" + filePath
							break
						}
					} catch (_) {}
				}
			}
		}
		var { stdout } = await execFileAsync("cat", [resolvedPath], { timeout: 10000 })
		var ext = resolvedPath.split(".").pop() || ""
		var langMap = {
			js: "js",
			ts: "ts",
			tsx: "tsx",
			jsx: "jsx",
			py: "python",
			sh: "bash",
			json: "json",
			md: "markdown",
			css: "css",
			html: "html",
			go: "go",
			rs: "rust",
		}
		var lang = langMap[ext] || ""
		var preview = stdout.length > 3000 ? stdout.slice(0, 3000) + "\n... (truncated)" : stdout
		var lineCount = stdout.split("\n").length
		updateSmartContext(chatId, { activeFile: resolvedPath })
		await sendMessage(
			botToken,
			chatId,
			"📄 `" + resolvedPath + "` (" + lineCount + " lines)\n\n```" + lang + "\n" + preview + "\n```",
		)
	} catch (err) {
		await sendMessage(botToken, chatId, "❌ Could not read `" + filePath + "`\n\n" + err.message)
	}
}

/**
 * Handles /fix — auto-debugs the last error stored in smartContext.
 * If no last error, prompts the user to paste one.
 * @param {string} botToken
 * @param {number|string} chatId
 * @param {Array} args - optional extra context
 * @param {Array} providers
 */
async function handleFix(botToken, chatId, args, providers) {
	await sendChatAction(botToken, chatId, "typing")
	var ctx = getSmartContext(chatId)
	var errorText = args.join(" ").trim() || ctx.lastError || ""
	var activeFile = ctx.activeFile || ""
	var ws = groupWorkspaces.get(String(chatId)) || ctx.lastProject || ""

	if (!errorText) {
		await sendMessage(
			botToken,
			chatId,
			"*No error on record* 🤔\n\nPaste an error message or stack trace and I'll automatically detect and fix it.\n\nOr: `/fix <error text>` to describe the issue.",
		)
		return
	}

	var fixPrompt =
		"You are a senior engineer. Diagnose and fix the following error" +
		(ws ? " in the project '" + ws + "'" : "") +
		(activeFile ? " (file: " + activeFile + ")" : "") +
		".\n\nError:\n" +
		errorText +
		"\n\nProvide: (1) root cause in one sentence, (2) exact fix with code, (3) how to verify the fix."

	try {
		var fixReply = await askAI(fixPrompt, providers || [], chatId)
		updateSmartContext(chatId, { lastFixApplied: fixReply.slice(0, 300) })
		await sendMessage(botToken, chatId, "*Auto-Fix Analysis* 🔧\n\n" + fixReply)
		await sendActionButtons(botToken, chatId, null)
	} catch (err) {
		await sendMessage(botToken, chatId, "❌ Fix analysis failed: " + err.message)
	}
}

/**
 * Handles /focus <file> — sets the active file for context-aware coding.
 * @param {string} botToken
 * @param {number|string} chatId
 * @param {Array} args
 */
async function handleFocus(botToken, chatId, args) {
	var filePath = args.join(" ").trim()
	if (!filePath) {
		var ctx = getSmartContext(chatId)
		var current = ctx.activeFile || "none"
		await sendMessage(
			botToken,
			chatId,
			"*Active file:* `" +
				current +
				"`\n\nUse `/focus <path>` to set a file.\nAll subsequent questions will reference that file.",
		)
		return
	}
	updateSmartContext(chatId, { activeFile: filePath })
	await sendMessage(
		botToken,
		chatId,
		"📌 *Focused on* `" +
			filePath +
			"`\n\nAll questions now reference this file. Use `/file " +
			filePath +
			"` to read it.",
	)
}

/**
 * Maps a natural language VPS query to the shell command that answers it.
 * Returns null if the query can't be mapped confidently.
 *
 * @param {string} text - Raw user message
 * @returns {string|null} Shell command to run, or null
 */
function inferShellCommand(text) {
	var lower = text.toLowerCase()

	// Version queries
	if (lower.includes("ollama") && lower.includes("version")) return "ollama --version"
	if (lower.includes("docker") && lower.includes("version")) return "docker --version"
	if (lower.includes("node") && lower.includes("version")) return "node --version"
	if (lower.includes("npm") && lower.includes("version")) return "npm --version"
	if (lower.includes("python") && lower.includes("version")) return "python3 --version"
	if (lower.includes("pm2") && lower.includes("version")) return "pm2 --version"
	if (lower.includes("git") && lower.includes("version")) return "git --version"
	if (lower.includes("pnpm") && lower.includes("version")) return "pnpm --version"

	// Process / service status
	if (
		lower.includes("pm2") &&
		(lower.includes("list") || lower.includes("status") || lower.includes("running") || lower.includes("process"))
	)
		return "pm2 list"
	if (lower.includes("docker") && (lower.includes("running") || lower.includes("container"))) return "docker ps"
	if (lower.includes("ollama") && (lower.includes("model") || lower.includes("list") || lower.includes("installed")))
		return "ollama list"

	// System info
	if (lower.includes("disk") || lower.includes("storage") || lower.includes("space")) return "df -h"
	if (lower.includes("memory") || lower.includes("ram")) return "free -h"
	if (lower.includes("uptime")) return "uptime"
	if (lower.includes("cpu") || lower.includes("load")) return "uptime && nproc"
	if ((lower.includes("who") || lower.includes("logged")) && lower.includes("in")) return "who"

	return null
}

/**
 * Routes a natural language text message to the appropriate agent.
 * Detects intent (coding, debugging, deploying, testing, or asking) and routes accordingly.
 * @param {string} botToken
 * @param {number} chatId
 * @param {string} text - The user's message
 * @param {number} telegramUserId
 * @param {object} queue - BullMQ queue
 */
async function handleNaturalLanguageInstruction(
	botToken,
	chatId,
	text,
	telegramUserId,
	queue,
	providers,
	orchestratorBridge,
) {
	try {
		var authSession = await checkAuthSession(telegramUserId, chatId)

		// Read-only intents (chat, feature_query, commit_status, read_logs) don't require auth.
		// Destructive / queue-submitting intents require a valid session.
		// We defer the auth check until we know the intent kind below.

		// ─── Smart NLP: Check for direct coding intents first ──────────────
		// NL-First Chat Mode: Auto-detect coding intent without requiring /brain prefix.
		// This runs BEFORE the LLM classifier for instant response on coding tasks.
		var smartHandled = await handleSmartNLP(botToken, chatId, text, telegramUserId, queue, providers)
		if (smartHandled) {
			return true
		}

		// ─── VPS Query Pre-check ────────────────────────────────────────────
		// If inferShellCommand can map the message, force shell intent before the
		// LLM classifier runs — avoids flaky misclassification (e.g. "coder").
		var classified
		if (inferShellCommand(text)) {
			classified = { kind: "shell", confidence: 1.0, message: text }
		} else {
			// ─── OpenClaw: LLM-Powered Intent Classification ──────────────────
			// Use the classifier to detect intent with LLM, fallback to keyword matching.
			// Pass conversation context so the classifier can disambiguate follow-ups.
			var conversationSummary = buildConversationSummary(chatId, 8)
			classified = await telegramClassifier.classifyIntent(text, providers || [], conversationSummary)
		}
		var intentKind = classified.kind
		var confidence = classified.confidence

		// ─── GAP 5.1: Active Learning — Ask Clarifying Questions ────────────
		// When confidence is low (< 0.5), the classifier is uncertain about the
		// user's intent. Instead of guessing wrong, ask the user to clarify.
		// This prevents misrouting and improves the user experience.
		if (confidence < 0.5 && intentKind !== "chat") {
			console.log(
				"[telegram] Low confidence (" +
					confidence.toFixed(2) +
					") for '" +
					text.slice(0, 60) +
					"' — asking clarifying question",
			)
			var clarificationButtons = [
				[
					{ text: "💬 Ask / Chat", callback_data: "brain_exec:" + storeCallbackCommand("/ask " + text) },
					{ text: "💻 Code", callback_data: "brain_exec:" + storeCallbackCommand("/code " + text) },
				],
				[
					{ text: "🔍 Debug", callback_data: "brain_exec:" + storeCallbackCommand("/debug " + text) },
					{ text: "🚀 Deploy", callback_data: "brain_exec:" + storeCallbackCommand("/deploy " + text) },
				],
			]
			await sendInlineKeyboard(
				botToken,
				chatId,
				"🤔 *I'm not quite sure what you'd like to do.*\n\n" +
					"I detected your message as: _" +
					intentKind +
					"_ (confidence: " +
					Math.round(confidence * 100) +
					"%)\n\n" +
					"Please choose one of the options below to help me route your request correctly:",
				clarificationButtons,
			)
			// Store the pending clarification in smart context so follow-up can be tracked
			updateSmartContext(chatId, { pendingClarification: intentKind, pendingText: text })
			return true
		}

		// If classified as run_tests but message contains strong bug/error signals,
		// the user is likely reporting a bug and mentioning tests as context — prefer debug_plan.
		if (intentKind === "run_tests") {
			var lowerCheck = text.toLowerCase()
			var hasBugSignal =
				lowerCheck.includes("bug") ||
				lowerCheck.includes("error") ||
				lowerCheck.includes("not working") ||
				lowerCheck.includes("broken") ||
				lowerCheck.includes("issue") ||
				lowerCheck.includes("report")
			if (hasBugSignal) {
				intentKind = "debug_plan"
				classified.kind = "debug_plan"
				console.log("[telegram] Overrode run_tests → debug_plan due to bug/error signals in message")
			}
		}

		logTelegramUsage("nlp:intent", chatId, telegramUserId, {
			intent: intentKind,
			confidence: confidence.toFixed(2),
			text: text.slice(0, 60),
		})

		// Record intent in cross-session user memory
		if (telegramUserId) {
			recordUserIntent(telegramUserId, intentKind)
			updateUserContext(telegramUserId, { lastInteraction: Date.now() })
		}

		// ─── GAP 5.4: Intent Accuracy Tracking ──────────────────────────────
		// Detect when the user is correcting a previous misclassification.
		// If the user's message contains correction signals (e.g. "no, I meant deploy",
		// "not code, debug"), mark the previous intent as incorrect and the new one as correct.
		var prevIntent = getSmartContext(chatId).lastClassifiedIntent
		if (prevIntent && prevIntent !== intentKind) {
			var lowerText = text.toLowerCase()
			var correctionSignals =
				lowerText.includes("not " + prevIntent) ||
				lowerText.includes("no " + prevIntent) ||
				lowerText.includes("wrong") ||
				lowerText.includes("that's not") ||
				lowerText.includes("that is not") ||
				lowerText.includes("i meant") ||
				lowerText.includes("i mean") ||
				lowerText.includes("actually") ||
				lowerText.match(/not\s+\w+\s*,\s*(chat|code|debug|deploy|test|shell)/) ||
				lowerText.match(/no\s*,\s*(chat|code|debug|deploy|test|shell)/)
			if (correctionSignals) {
				try {
					telegramLearner.updateIntentAccuracy(prevIntent, false)
					telegramLearner.updateIntentAccuracy(intentKind, true)
					console.log(
						"[telegram] Intent accuracy: " +
							prevIntent +
							"=false, " +
							intentKind +
							"=true (user corrected)",
					)
				} catch (e) {
					console.log("[telegram] Intent accuracy tracking error (non-fatal):", e.message)
				}
			}
		}
		// Store current intent for next-message correction detection
		updateSmartContext(chatId, { lastClassifiedIntent: intentKind })

		// ─── GAP 5.2: Pattern-Based Next Action Suggestions ─────────────────
		// After classifying the intent, compute suggested next actions based on
		// the user's historical patterns and common workflow sequences.
		// Store them in smart context so the response handler can append suggestions.
		try {
			var nextActions = telegramLearner.getSuggestedNextActions(chatId, intentKind)
			if (nextActions && nextActions.length > 0) {
				updateSmartContext(chatId, { suggestedNextActions: nextActions })
			} else {
				updateSmartContext(chatId, { suggestedNextActions: null })
			}
		} catch (e) {
			console.log("[telegram] Pattern-based suggestion error (non-fatal):", e.message)
		}

		// ─── Chat Intent ────────────────────────────────────────────────────
		// Handle questions directly with the enhanced AI.
		// Inject bound workspace context (name + project README) so the AI
		// gives project-specific answers, not generic SuperRoo answers.
		if (intentKind === "chat") {
			await sendChatAction(botToken, chatId, "typing")
			console.log("[telegram] AI query from " + chatId + ": " + text.slice(0, 100))
			var chatBoundWs = groupWorkspaces.get(String(chatId))

			// If the message looks like a coding instruction misclassified as chat,
			// and the user is authenticated, redirect to the coder queue.
			var chatLower = text.toLowerCase()
			var isCodingInstruction =
				authSession &&
				(chatLower.match(
					/^(add|implement|create|build|write|make|develop|refactor|update|change|modify|rename|extract|integrate)\s+/,
				) ||
					chatLower.includes("add a button") ||
					chatLower.includes("add a page") ||
					chatLower.includes("add a feature") ||
					chatLower.includes("add a route") ||
					chatLower.includes("add a function") ||
					chatLower.includes("add a component") ||
					chatLower.includes("implement the") ||
					chatLower.includes("implement a") ||
					chatLower.includes("create a page") ||
					chatLower.includes("create a component") ||
					chatLower.includes("create a function") ||
					chatLower.includes("refactor the") ||
					chatLower.includes("wire up") ||
					chatLower.includes("hook up") ||
					(chatLower.includes("make the") && chatBoundWs))
			if (isCodingInstruction) {
				console.log("[telegram] chat re-routed to code_task for: " + text.slice(0, 60))
				await handleCode(botToken, chatId, [text], queue, orchestratorBridge)
				return true
			}

			var chatPrompt = text
			if (chatBoundWs) {
				// For improvement/feature/analysis queries, read project files for real context
				var needsProjectContext =
					chatLower.includes("improve") ||
					chatLower.includes("improvement") ||
					chatLower.includes("feature") ||
					chatLower.includes("what can") ||
					chatLower.includes("what does") ||
					chatLower.includes("how does") ||
					chatLower.includes("what is this") ||
					chatLower.includes("tell me about") ||
					chatLower.includes("analyze") ||
					chatLower.includes("bottleneck") ||
					chatLower.includes("suggest") ||
					chatLower.includes("recommend") ||
					chatLower.includes("prioritize") ||
					chatLower.includes("next step") ||
					chatLower.includes("roadmap")

				var chatProjectCtx = ""
				if (needsProjectContext) {
					var chatCandidates = ["/root/" + chatBoundWs, "/opt/" + chatBoundWs, "/home/" + chatBoundWs]
					var fsSync2 = require("fs")
					for (var ccp of chatCandidates) {
						try {
							if (fsSync2.existsSync(ccp)) {
								var readmePaths2 = ["README.md", "readme.md", "README.txt"]
								for (var rp2 of readmePaths2) {
									try {
										var rc = fsSync2.readFileSync(path.join(ccp, rp2), "utf8")
										chatProjectCtx = "\n\nProject README:\n" + rc.slice(0, 3000)
										break
									} catch (_) {}
								}
								if (!chatProjectCtx) {
									try {
										var pkg2 = JSON.parse(
											fsSync2.readFileSync(path.join(ccp, "package.json"), "utf8"),
										)
										chatProjectCtx =
											"\n\nProject: " +
											(pkg2.name || chatBoundWs) +
											(pkg2.description ? " — " + pkg2.description : "")
									} catch (_) {}
								}
								break
							}
						} catch (_) {}
					}
				}

				chatPrompt =
					"[Context: This Telegram group is linked to the project '" +
					chatBoundWs +
					"'." +
					chatProjectCtx +
					"]\n\nAnswer the following question specifically about the '" +
					chatBoundWs +
					"' project, not about SuperRoo itself.\n\n" +
					text
			}
			var reply = await askAI(chatPrompt, providers || [], chatId)
			await sendMessage(botToken, chatId, reply)
			return true
		}

		// ─── Per-intent auth check ──────────────────────────────────────────
		// Read-only intents don't need auth. Queue-submitting intents do.
		var authRequiredIntents = new Set([
			"debug_plan",
			"run_tests",
			"create_branch",
			"create_pr",
			"restart_worker",
			"code_task",
			"upgrade_self",
			"deploy",
			"delete_data",
			"shell",
		])
		if (!authSession && authRequiredIntents.has(intentKind)) {
			await sendMessage(
				botToken,
				chatId,
				"🔒 *Login required for this action*\n\nUse `/login` to authenticate, then try again.\n\nYou can still ask questions without logging in.",
			)
			return true
		}

		// ─── OpenClaw: Policy Check ─────────────────────────────────────────
		// Check if the action can run without approval.
		// Blocked actions (deploy, delete_data, shell) require dashboard approval.
		if (!telegramPolicy.canRunWithoutApproval(intentKind, text)) {
			var blockedMsg = telegramPolicy.getBlockedReason(intentKind, text)
			logTelegramWarning("nlp:blocked", chatId, telegramUserId, "Policy blocked " + intentKind, {
				text: text.slice(0, 100),
			})
			await sendMessage(botToken, chatId, blockedMsg)
			return true
		}

		// ─── OpenClaw: Direct Endpoint Actions ──────────────────────────────
		// For debug_plan, read_logs, run_tests, restart_worker — execute directly
		// without going through the BullMQ queue. These are fast, read-only operations.

		if (intentKind === "debug_plan") {
			await sendChatAction(botToken, chatId, "typing")
			try {
				// If the message looks like "fix X" (actionable coding), route to coder queue
				// rather than the debugger queue which has no active agent implementation.
				var dbLower = text.toLowerCase()
				var isFixableIntent =
					dbLower.match(/^fix\s+/) ||
					dbLower.match(/^resolve\s+/) ||
					dbLower.match(/^repair\s+/) ||
					dbLower.includes("fix the bug") ||
					dbLower.includes("fix this bug") ||
					dbLower.includes("fix the error") ||
					dbLower.includes("fix this error") ||
					dbLower.includes("fix the issue")
				if (isFixableIntent) {
					console.log("[telegram] debug_plan re-routed to code_task (fix intent): " + text.slice(0, 60))
					await handleCode(botToken, chatId, [text], queue, orchestratorBridge)
					return true
				}

				var debugTaskId = "DBG-" + Date.now().toString(36).toUpperCase()
				var debugRepo = "superroo2"
				try {
					var projResult = await auth.handleTelegramProjects({ telegramUserId, telegramChatId: chatId })
					var activeProj =
						projResult &&
						projResult.projects &&
						projResult.projects.find(function (p) {
							return p.is_active
						})
					if (!activeProj && projResult && projResult.projects && projResult.projects.length > 0) {
						activeProj = projResult.projects[0]
					}
					if (activeProj) debugRepo = activeProj.repoName || activeProj.name || debugRepo
				} catch (e) {
					console.log("[telegram] debug_plan: could not resolve active project, using default")
				}
				await queue.add("debug-" + debugTaskId, {
					task: text,
					agentId: "superroo-coder-agent",
					goal: text,
					repo: debugRepo,
					commands: [],
					telegram: {
						chatId: chatId,
						userId: telegramUserId,
					},
				})
				await sendMessage(
					botToken,
					chatId,
					"🔍 *Super Debug Team Activated*\n\n" +
						"Task ID: `" +
						debugTaskId +
						"`\n" +
						"Repo: `" +
						debugRepo +
						"`\n\n" +
						"The debug team is analyzing the issue and will send progress updates here.",
				)

				// If Terminal Brain is available, also run error analysis on the debug text
				if (_terminalBrainAvailable) {
					try {
						var brainAnalyzeResult = await tgEndpoints.brainAnalyze(text, chatId)
						if (
							brainAnalyzeResult.ok &&
							brainAnalyzeResult.errors &&
							brainAnalyzeResult.errors.length > 0
						) {
							var brainDebugReply = telegramEngineer.formatBrainErrors(brainAnalyzeResult.errors)
							await sendMessage(botToken, chatId, brainDebugReply)
						}
					} catch (brainErr) {
						console.log("[telegram] Brain analysis bonus for debug_plan failed:", brainErr.message)
					}
				}
			} catch (err) {
				logTelegramError("nlp:debug_plan", chatId, telegramUserId, err, { text: text.slice(0, 100) })
				await sendMessage(botToken, chatId, "*Debug Error* ❌\n\n" + err.message)
			}
			return true
		}

		if (intentKind === "read_logs") {
			await sendChatAction(botToken, chatId, "typing")
			try {
				var target = classified.target || "all"
				var logsResult = await tgEndpoints.readLogs(target)
				var logsReply = telegramEngineer.formatLogsResult(logsResult)
				await sendMessage(botToken, chatId, logsReply)
			} catch (err) {
				logTelegramError("nlp:read_logs", chatId, telegramUserId, err, { target: classified.target })
				await sendMessage(botToken, chatId, "*Logs Error* ❌\n\n" + err.message)
			}
			return true
		}

		if (intentKind === "run_tests") {
			await sendChatAction(botToken, chatId, "typing")
			try {
				var testProject = classified.project || ""
				var testResult = await tgEndpoints.runTests(testProject)
				var testReply = telegramEngineer.formatTestResult(testResult)
				await sendMessage(botToken, chatId, testReply)
			} catch (err) {
				logTelegramError("nlp:run_tests", chatId, telegramUserId, err, { project: classified.project })
				await sendMessage(botToken, chatId, "*Test Error* ❌\n\n" + err.message)
			}
			return true
		}

		if (intentKind === "restart_worker") {
			await sendChatAction(botToken, chatId, "typing")
			try {
				var workerName = classified.target || "superroo-api"
				var restartResult = await tgEndpoints.restartWorker(workerName)
				var restartReply = telegramEngineer.formatRestartResult(restartResult)
				await sendMessage(botToken, chatId, restartReply)
			} catch (err) {
				logTelegramError("nlp:restart_worker", chatId, telegramUserId, err, { target: classified.target })
				await sendMessage(botToken, chatId, "*Restart Error* ❌\n\n" + err.message)
			}
			return true
		}

		// ─── Upgrade Self Intent ────────────────────────────────────────────
		// Route "upgrade yourself" / "improve yourself" to the Coder agent
		// which will modify the bot's own source files.
		if (intentKind === "upgrade_self") {
			await sendChatAction(botToken, chatId, "typing")
			try {
				await handleUpgrade(botToken, chatId, [text], queue, orchestratorBridge)
			} catch (err) {
				logTelegramError("nlp:upgrade_self", chatId, telegramUserId, err, { text: text.slice(0, 100) })
				await sendMessage(botToken, chatId, "*Upgrade Error* ❌\n\n" + err.message)
			}
			return true
		}

		// ─── Commit Status Intent ───────────────────────────────────────────
		// Route "commit status", "deploy status", "latest commit" to the
		// CommitDeployLog query endpoint.
		if (intentKind === "commit_status") {
			await sendChatAction(botToken, chatId, "typing")
			try {
				var commitStatusResult = await tgEndpoints.getCommitDeployStatus()
				var commitStatusReply = telegramEngineer.formatCommitDeployStatus(commitStatusResult)
				await sendMessage(botToken, chatId, commitStatusReply)
			} catch (err) {
				logTelegramError("nlp:commit_status", chatId, telegramUserId, err, { text: text.slice(0, 100) })
				await sendMessage(botToken, chatId, "*Commit/Deploy Status Error* ❌\n\n" + err.message)
			}
			return true
		}

		// ─── Feature Query Intent ───────────────────────────────────────────
		// If asked in a group with a bound workspace, answer about THAT project.
		// Only fall back to SuperRoo feature docs when explicitly asked about SuperRoo
		// or when no workspace is bound.
		if (intentKind === "feature_query") {
			await sendChatAction(botToken, chatId, "typing")
			try {
				var boundWs = groupWorkspaces.get(String(chatId))
				var lowerQ = text.toLowerCase()
				var asksAboutSuperRoo =
					lowerQ.includes("superroo") ||
					lowerQ.includes("safety mode") ||
					lowerQ.includes("central brain") ||
					lowerQ.includes("agent workflow") ||
					lowerQ.includes("ollama") ||
					lowerQ.includes("hermes")

				if (boundWs && !asksAboutSuperRoo) {
					// Find the project directory on disk
					var fqPath = null
					var candidatePaths = [
						"/root/" + boundWs,
						"/opt/" + boundWs,
						"/home/" + boundWs,
						"/opt/superroo2/" + boundWs,
					]
					var fsSync = require("fs")
					for (var cp of candidatePaths) {
						try {
							if (fsSync.existsSync(cp)) {
								fqPath = cp
								break
							}
						} catch (_) {}
					}

					// Build project context from README and package.json
					var projectContext = ""
					if (fqPath) {
						var readmePaths = ["README.md", "readme.md", "README.txt", "docs/README.md"]
						for (var rp of readmePaths) {
							try {
								var readmeContent = fsSync.readFileSync(path.join(fqPath, rp), "utf8")
								projectContext += "README:\n" + readmeContent.slice(0, 3000) + "\n\n"
								break
							} catch (_) {}
						}
						try {
							var pkgContent = fsSync.readFileSync(path.join(fqPath, "package.json"), "utf8")
							var pkg = JSON.parse(pkgContent)
							projectContext +=
								"package.json: name=" +
								(pkg.name || "") +
								", description=" +
								(pkg.description || "") +
								", scripts=" +
								JSON.stringify(Object.keys(pkg.scripts || {})) +
								"\n\n"
						} catch (_) {}
					}

					var projectPrompt =
						"You are answering a question about the project '" +
						boundWs +
						"'.\n" +
						(projectContext
							? "Here is the project context:\n\n" + projectContext + "\n"
							: "No local project files found for '" + boundWs + "'.\n") +
						"Answer the user's question based on this project. Be concise and specific.\n\n" +
						"User question: " +
						text

					var projectReply = await askAI(projectPrompt, providers || [], chatId)
					await sendMessage(botToken, chatId, projectReply)
				} else {
					// No workspace bound or explicitly asking about SuperRoo — use feature docs
					var featureAnswerer = require("../orchestrator/modules/FeatureAnswerer").getFeatureAnswerer()
					var featureReply = await featureAnswerer.answer(text)
					await sendMessage(botToken, chatId, featureReply)
				}
			} catch (err) {
				logTelegramError("nlp:feature_query", chatId, telegramUserId, err, { text: text.slice(0, 100) })
				await sendMessage(botToken, chatId, "*Feature Query Error* ❌\n\n" + err.message)
			}
			return true
		}

		// ─── Code Task Intent ───────────────────────────────────────────────
		// The primary NL coding path. Routes directly to the coder queue.
		// "add a login page", "implement the auth flow", "refactor the API" etc.
		// Improvement 3: Resolve project context from classifier for multi-project support
		// Improvement 9: Pass auth context for NL-routed requests
		if (intentKind === "code_task") {
			try {
				var codeTaskOptions = {
					requireAuth: true,
					telegramUserId: telegramUserId,
				}
				// Resolve project from classifier output or active project
				var classifierProject = classified.project
				if (classifierProject) {
					var resolvedWs = null
					var candidateDirs = [
						"/opt/" + classifierProject,
						"/root/" + classifierProject,
						"/home/" + classifierProject,
					]
					var fsSync3 = require("fs")
					for (var cd of candidateDirs) {
						try {
							if (fsSync3.existsSync(cd)) {
								resolvedWs = cd
								break
							}
						} catch (_) {}
					}
					if (resolvedWs) {
						codeTaskOptions.workspaceDir = resolvedWs
						codeTaskOptions.repoName = classifierProject
					}
				}
				await handleCode(botToken, chatId, [text], queue, orchestratorBridge, codeTaskOptions)
			} catch (err) {
				logTelegramError("nlp:code_task", chatId, telegramUserId, err, { text: text.slice(0, 100) })
				await sendMessage(botToken, chatId, "*Coding task error* ❌\n\n" + err.message)
			}
			return true
		}

		// ─── Safe Shell: VPS Query ──────────────────────────────────────────
		// Shell intent that passed the policy check (read-only) — infer the
		// actual command and run it on the VPS. No active project required.
		if (intentKind === "shell") {
			await sendChatAction(botToken, chatId, "typing")
			try {
				var inferredCmd = inferShellCommand(text)
				var shellReply
				if (inferredCmd) {
					var shellResult = await tgEndpoints.executeShell(inferredCmd)
					shellReply = "*VPS* 🖥️  `" + inferredCmd + "`\n\n"
					var shellOutput = (shellResult.stdout || shellResult.stderr || "_(no output)_").trim()
					if (shellOutput.length > 3000) shellOutput = shellOutput.slice(0, 3000) + "\n…"
					shellReply += "```\n" + shellOutput + "\n```"
				} else {
					shellReply = await askAI(
						text +
							"\n\n(Context: user is asking about their VPS. Answer concisely. If you need a real command to verify, suggest they use /shell <command>.)",
						providers || [],
						chatId,
					)
				}
				await sendMessage(botToken, chatId, shellReply)
			} catch (err) {
				logTelegramError("nlp:shell_query", chatId, telegramUserId, err, { text: text.slice(0, 100) })
				await sendMessage(botToken, chatId, "*Shell Query Error* ❌\n\n" + err.message)
			}
			return true
		}

		// ─── Legacy: Agent Routing via BullMQ ───────────────────────────────
		// For create_branch, create_pr, and other complex actions that need
		// the full agent pipeline, fall through to the existing BullMQ routing.

		// Map OpenClaw kinds to agent IDs
		var openclawToLegacy = {
			coder: "superroo-coder-agent",
			create_branch: "superroo-coder-agent",
			create_pr: "superroo-coder-agent",
			deploy: "superroo-deployer-agent",
			delete_data: "superroo-deployer-agent",
			shell: "superroo-debugger-agent",
		}
		var legacyIntent = openclawToLegacy[intentKind] || "superroo-debugger-agent"

		// Check if user has an active project selected
		try {
			var result = await auth.handleTelegramProjects({
				telegramUserId: telegramUserId,
				telegramChatId: chatId,
			})

			var activeProject = null
			if (result && result.projects) {
				activeProject = result.projects.find(function (p) {
					return p.is_active
				})
			}

			// ─── Group Workspace Binding ────────────────────────────────────
			if (!activeProject && chatId < 0) {
				var boundWorkspace = groupWorkspaces.get(String(chatId))
				if (boundWorkspace && result && result.projects) {
					var lowerBound = boundWorkspace.toLowerCase()
					for (var pi = 0; pi < result.projects.length; pi++) {
						var pj = result.projects[pi]
						var pjName = (pj.name || pj.repoName || "").toLowerCase()
						if (pjName === lowerBound || pjName.includes(lowerBound) || lowerBound.includes(pjName)) {
							try {
								await auth.handleTelegramProjectSelect(pj.id, {
									telegramUserId: telegramUserId,
									telegramChatId: chatId,
								})
								activeProject = pj
								console.log(
									"[telegram] Auto-selected bound workspace '" +
										boundWorkspace +
										"' for group " +
										chatId,
								)
							} catch (selErr) {
								logTelegramError("nlp:auto_select_workspace", chatId, telegramUserId, selErr, {
									boundWorkspace: boundWorkspace,
								})
							}
							break
						}
					}
				}
			}

			if (!activeProject) {
				await sendMessage(
					botToken,
					chatId,
					"*No Active Project* 📁\n\nPlease select a project first so I know which workspace to work on.\n\nUse `/projects` to view and select your projects.\n\n*Already selected?* Use `/session` to check your current session.",
				)
				return true
			}

			await sendChatAction(botToken, chatId, "typing")

			// Log the instruction via auth module
			try {
				await auth.handleOrchestratorInstruction({
					userId: authSession.userId,
					projectId: activeProject.id,
					instruction: text,
					mode: legacyIntent,
					source: "telegram",
				})
			} catch (logErr) {
				logTelegramError("nlp:log_instruction", chatId, telegramUserId, logErr, { projectId: activeProject.id })
			}

			// Create a task with the appropriate agent
			var taskId =
				"TG-" +
				Date.now().toString(36).toUpperCase() +
				"-" +
				Math.random().toString(36).slice(2, 6).toUpperCase()
			var branchName = "tg/" + taskId.toLowerCase()

			var conversationSummary = buildConversationSummary(chatId)

			var job = await queue.add("telegram-" + taskId, {
				task: text,
				agentId: legacyIntent,
				commands: [],
				network: "none",
				telegram: {
					chatId: chatId,
					taskId: taskId,
					branchName: branchName,
					conversationSummary: conversationSummary,
				},
			})

			if (!userTasks.has(chatId)) userTasks.set(chatId, [])
			userTasks.get(chatId).push({
				id: taskId,
				instruction: text,
				status: "queued",
				branchName: branchName,
				changedFiles: 0,
				linesAdded: 0,
				createdAt: new Date().toISOString(),
				jobId: job.id,
			})
			scheduleStatePersist()

			// Also record in Cloud Orchestrator if bridge is available
			if (orchestratorBridge) {
				try {
					orchestratorBridge.createTask({
						tgTaskId: taskId,
						chatId: chatId,
						instruction: text,
						agentId: legacyIntent,
						branchName: branchName,
						source: "nlp",
					})
				} catch (err) {
					console.error("[telegram] Failed to record NLP task in orchestrator:", err.message)
				}
			}

			var intentLabels = {
				coder: "Coding",
				debugger: "Debugging",
				deployer: "Deployment",
				tester: "Testing",
				consultant: "Consultant",
			}
			var label = intentLabels[legacyIntent] || "Task"

			logChatExchange(chatId, "user", text, { intent: intentKind, taskId: taskId }).catch(function () {})
			logChatExchange(chatId, "system", "Task routed to " + legacyIntent + " agent", {
				taskId: taskId,
				agentId: legacyIntent,
			}).catch(function () {})

			await telegramNotifier.sendTaskStarted(botToken, chatId, taskId, text, legacyIntent)
			return true
		} catch (err) {
			logTelegramError("nlp:routing", chatId, telegramUserId, err, {
				intent: intentKind,
				text: text.slice(0, 100),
			})
		}

		return false
	} catch (err) {
		logTelegramError("nlp:fatal", chatId, telegramUserId, err, { text: text.slice(0, 100) })
		return false
	}
}

/**
 * Handles /projects - lists available projects on the VPS (legacy static version).
 * Kept for backward compatibility.
 */
async function handleProjectsLegacy(botToken, chatId) {
	await sendMessage(
		botToken,
		chatId,
		"*Available Projects*\n\n" +
			"1. *SuperRoo Cloud* — AI-powered coding assistant platform\n" +
			"   Location: `/opt/superroo2`\n" +
			"   Dashboard: DASHBOARD_URL\n" +
			"   Commands: `/code`, `/ask`, `/deploy`, `/status`\n\n" +
			"2. *Product Image Studio* — AI product photography using GPT Image & Gemini\n" +
			"   Location: `/root/productgenerator`\n" +
			"   Port: 3003\n" +
			"   Status: `product-image-studio` (PM2)\n\n" +
			"3. *Web SuperRoo* — Public-facing web app\n" +
			"   Location: `/opt/superroo2/apps/web-superroo`\n\n" +
			"4. *Web Evals* — Evaluation system dashboard\n" +
			"   Location: `/opt/superroo2/apps/web-evals`\n\n" +
			"*To code in a project:*\n" +
			"Use `/code <instruction>` to create a coding task.\n" +
			"Use `/ask <question>` to ask about any project.\n\n" +
			"*Dashboard:* DASHBOARD_URL",
	)
}

/**
 * Handles /help - shows all available commands.
 */
async function handleHelp(botToken, chatId) {
	await sendMessage(
		botToken,
		chatId,
		"*SuperRoo Bot Commands*\n\n" +
			"*Account*\n" +
			"`/login` - Login to SuperRoo Cloud (opens Mini App)\n" +
			"`/session` - Check active session\n" +
			"`/otp [code]` - Set up Google Authenticator\n\n" +
			"*Projects & Workspace*\n" +
			"`/projects` - List and select projects\n" +
			"`/workspace` - Show active workspace\n" +
			"`/specify <name>` - Bind this group to a workspace/project\n" +
			"   *Example:* `/specify superroo2` — auto-selects that project in this chat\n" +
			"`/miniide` - Open Mini IDE (full code editor in Telegram)\n" +
			"`/agents` - Show available agents\n\n" +
			"*Coding*\n" +
			"`/code <instruction>` - Create a coding task\n" +
			"`/fix [error]` - Auto-diagnose & fix last error (or paste one)\n" +
			"`/file <path>` - Read a file from your project into context\n" +
			"`/focus <path>` - Pin a file so all messages reference it\n" +
			"`/diff <taskId>` - Show changed files\n" +
			"`/approve <taskId>` - Approve pending changes\n" +
			"`/deploy <taskId>` - Deploy approved build (OTP required)\n" +
			"`/shell <command>` - Execute safe shell commands on VPS\n\n" +
			"*AI Assistant*\n" +
			"`/debug <description>` - Structured debug plan\n" +
			"`/logs [target] [lines]` - Read PM2/Docker logs\n" +
			"`/tests [project]` - Run tests for a project\n" +
			"`/restart <worker>` - Restart a whitelisted PM2 worker\n\n" +
			"*Zero-Friction Tips*\n" +
			"• Paste an error/stack trace → I detect it and offer instant fix buttons\n" +
			"• Reply to any code block I send → I treat it as a code edit request\n" +
			"• `/focus src/api.ts` → every message now knows you're in that file\n" +
			"• `/specify <project>` in a group → all queries use that project's context\n" +
			'• Say *"fix this bug"* or *"code this feature"* to trigger cloud agents\n' +
			"• In groups, I respond automatically — no need to tag me!\n\n" +
			"*System*\n" +
			"`/status [taskId]` - Check system or task status\n" +
			"`/settings` - Account and system settings\n" +
			"`/about` - Bot information\n" +
			"`/help` - Show this message\n\n" +
			"*Dashboard:* DASHBOARD_URL\n" +
			"*Tip:* Just type naturally — no need for `/ask` prefix!",
	)
}

// ─── Mini App Workflow Callback Handlers ──────────────────────────────────

/**
 * Handles preview_plan callback — shows the plan preview for a task.
 * Edits the original message to show the plan details with action buttons.
 */
async function handlePreviewPlan(botToken, chatId, messageId, taskId) {
	var tasks = userTasks.get(chatId) || []
	var task = tasks.find(function (t) {
		return t.id === taskId.toUpperCase()
	})
	if (!task) {
		await editMessageText(botToken, chatId, messageId, "Task `" + taskId + "` not found.")
		return
	}

	var planText =
		"*Plan Preview: " +
		task.id +
		"*\n\n" +
		"*Instruction:* " +
		(task.instruction || "N/A") +
		"\n" +
		"*Agent:* " +
		(task.agentType || "auto") +
		"\n" +
		"*Branch:* `" +
		(task.branchName || "main") +
		"`\n" +
		"*Status:* " +
		(task.status || "draft") +
		"\n\n" +
		"*Estimated Changes:*\n" +
		"• Files: " +
		(task.changedFiles || "TBD") +
		"\n" +
		"• Lines added: " +
		(task.linesAdded || "TBD") +
		"\n" +
		"• Lines removed: " +
		(task.linesRemoved || "TBD") +
		"\n\n" +
		"*What happens next:*\n" +
		"1. ✅ Approve plan → creates git savepoint\n" +
		"2. 🤖 Agent codes the changes\n" +
		"3. 👀 Review & approve changes\n" +
		"4. 🚀 Deploy to staging → production"

	await editMessageText(botToken, chatId, messageId, planText, {
		reply_markup: {
			inline_keyboard: [
				[
					{ text: "✅ Approve Plan", callback_data: "approve_plan:" + task.id },
					{ text: "❌ Reject", callback_data: "notify:reject:" + task.id },
				],
				[{ text: "🔙 Back", callback_data: "notify:status:" + task.id }],
			],
		},
	})
}

/**
 * Handles approve_plan callback — approves a plan and creates a git savepoint.
 * Moves task from draft/planned to plan_approved state.
 */
async function handleApprovePlan(botToken, chatId, messageId, taskId) {
	var tasks = userTasks.get(chatId) || []
	var task = tasks.find(function (t) {
		return t.id === taskId.toUpperCase()
	})
	if (!task) {
		await editMessageText(botToken, chatId, messageId, "Task `" + taskId + "` not found.")
		return
	}

	task.status = "plan_approved"
	scheduleStatePersist()

	// Try to create a git savepoint before coding begins
	var savepointCreated = false
	var savepointHash = ""
	try {
		var execAsync = promisify(require("child_process").exec)
		var projectPath = task.projectPath || process.cwd()
		var result = await execAsync("git stash create", { cwd: projectPath })
		savepointHash = (result.stdout || "").trim()
		if (savepointHash) {
			savepointCreated = true
			// Tag the savepoint so we can find it later
			await execAsync('git tag -f "savepoint-' + task.id.toLowerCase() + '" ' + savepointHash, {
				cwd: projectPath,
			}).catch(function () {})
		}
	} catch (e) {
		console.log("[telegram] Savepoint creation skipped for " + task.id + ": " + e.message)
	}

	var msg =
		"*Plan Approved!* ✅\n\n" +
		"Task: " +
		task.id +
		"\n" +
		"Instruction: " +
		(task.instruction || "N/A") +
		"\n" +
		"Branch: `" +
		(task.branchName || "main") +
		"`\n" +
		"Agent: " +
		(task.agentType || "auto") +
		"\n"

	if (savepointCreated) {
		msg +=
			"\n*🔖 Savepoint created:* `" +
			savepointHash.slice(0, 12) +
			"`\n" +
			"You can rollback to this point if needed."
	} else {
		msg += "\n_Note: Savepoint could not be created automatically._"
	}

	msg += "\n\n_Starting autonomous coding..._"

	await editMessageText(botToken, chatId, messageId, msg, {
		reply_markup: {
			inline_keyboard: [
				[
					{ text: "📋 View Status", callback_data: "notify:status:" + task.id },
					{ text: "🔙 Back to Tasks", callback_data: "notify:list" },
				],
			],
		},
	})
}

/**
 * Handles view_diff callback — shows the diff summary for a task.
 */
async function handleViewDiff(botToken, chatId, messageId, taskId) {
	var tasks = userTasks.get(chatId) || []
	var task = tasks.find(function (t) {
		return t.id === taskId.toUpperCase()
	})
	if (!task) {
		await editMessageText(botToken, chatId, messageId, "Task `" + taskId + "` not found.")
		return
	}

	if (!task.changedFiles || task.changedFiles === 0) {
		await editMessageText(
			botToken,
			chatId,
			messageId,
			"*Diff for " +
				task.id +
				"*\n\nNo changes yet — task is still being processed.\n\nUse /status " +
				task.id +
				" to check progress.",
			{
				reply_markup: {
					inline_keyboard: [[{ text: "🔄 Refresh", callback_data: "view_diff:" + task.id }]],
				},
			},
		)
		return
	}

	var diffText =
		"*Diff: " +
		task.id +
		"*\n\n" +
		"• " +
		(task.changedFiles || 0) +
		" files changed\n" +
		"• +" +
		(task.linesAdded || 0) +
		" lines added\n" +
		"• -" +
		(task.linesRemoved || 0) +
		" lines removed\n" +
		"• Branch: `" +
		(task.branchName || "main") +
		"`\n\n" +
		"*Changed files:*\n" +
		(task.changedFileList || ["-"])
			.map(function (f) {
				return "• `" + f + "`"
			})
			.join("\n") +
		"\n\n" +
		"Use the Mini App dashboard for full diff viewer."

	await editMessageText(botToken, chatId, messageId, diffText, {
		reply_markup: {
			inline_keyboard: [
				[
					{ text: "✅ Approve", callback_data: "notify:approve:" + task.id },
					{ text: "❌ Request Changes", callback_data: "notify:reject:" + task.id },
				],
				[{ text: "🚀 Deploy to Staging", callback_data: "deploy_staging:" + task.id }],
			],
		},
	})
}

/**
 * Handles deploy_staging callback — deploys a task to the staging environment.
 */
async function handleDeployStaging(botToken, chatId, messageId, taskId) {
	var tasks = userTasks.get(chatId) || []
	var task = tasks.find(function (t) {
		return t.id === taskId.toUpperCase()
	})
	if (!task) {
		await editMessageText(botToken, chatId, messageId, "Task `" + taskId + "` not found.")
		return
	}

	if (task.status !== "approved" && task.status !== "review_approved") {
		await editMessageText(
			botToken,
			chatId,
			messageId,
			"*Cannot Deploy*\n\nTask `" + task.id + "` must be approved first (current: " + task.status + ").",
		)
		return
	}

	task.status = "staging_deploying"
	scheduleStatePersist()

	await editMessageText(
		botToken,
		chatId,
		messageId,
		"*Deploying to Staging* 🚀\n\n" +
			"Task: " +
			task.id +
			"\n" +
			"Branch: `" +
			(task.branchName || "main") +
			"`\n" +
			"Environment: `staging`\n\n" +
			"_Deployment in progress..._\n\n" +
			"Once staging is healthy, you can deploy to production.",
		{
			reply_markup: {
				inline_keyboard: [
					[
						{ text: "🔄 Check Status", callback_data: "notify:status:" + task.id },
						{ text: "🚀 Deploy to Production", callback_data: "deploy_production:" + task.id },
					],
				],
			},
		},
	)
}

/**
 * Handles deploy_production callback — deploys a task to production.
 * Requires OTP verification.
 */
async function handleDeployProduction(botToken, chatId, messageId, taskId) {
	var session = getSession(chatId)
	if (!session || !session.otpVerified) {
		await editMessageText(
			botToken,
			chatId,
			messageId,
			"*OTP Required* 🔐\n\n" +
				"Production deployment requires Google Authenticator verification.\n\n" +
				"Use `/otp` to set up and verify your OTP first, then try again.",
			{
				reply_markup: {
					inline_keyboard: [[{ text: "🔙 Back", callback_data: "notify:status:" + taskId }]],
				},
			},
		)
		return
	}

	var tasks = userTasks.get(chatId) || []
	var task = tasks.find(function (t) {
		return t.id === taskId.toUpperCase()
	})
	if (!task) {
		await editMessageText(botToken, chatId, messageId, "Task `" + taskId + "` not found.")
		return
	}

	task.status = "production_deploying"
	scheduleStatePersist()

	await editMessageText(
		botToken,
		chatId,
		messageId,
		"*Deploying to Production* 🚀\n\n" +
			"Task: " +
			task.id +
			"\n" +
			"Branch: `" +
			(task.branchName || "main") +
			"`\n" +
			"Environment: `production`\n\n" +
			"_Deployment in progress..._\n\n" +
			"⚠️ Production deploy requires health check verification after completion.",
		{
			reply_markup: {
				inline_keyboard: [[{ text: "🔄 Check Status", callback_data: "notify:status:" + task.id }]],
			},
		},
	)
}

/**
 * Handles rollback callback — rolls back to a savepoint.
 */
async function handleRollbackCallback(botToken, chatId, messageId, savepointId) {
	await editMessageText(
		botToken,
		chatId,
		messageId,
		"*Rollback Initiated* ↩️\n\n" +
			"Savepoint: `" +
			savepointId +
			"`\n\n" +
			"_Restoring savepoint..._\n\n" +
			"This will revert all changes made since the savepoint was created.",
		{
			reply_markup: {
				inline_keyboard: [
					[
						{ text: "✅ Confirm Rollback", callback_data: "notify:rollback_confirm:" + savepointId },
						{ text: "❌ Cancel", callback_data: "notify:cancel" },
					],
				],
			},
		},
	)
}

// ─── Callback Query Registry ──────────────────────────────────────────────
// Centralized registry for callback query handlers. Each entry defines:
//   prefix: string to match (startsWith or exact)
//   exact: boolean (true = exact match, false = startsWith)
//   handler: async function(botToken, cq, cqChatId, cqMessageId, cqData, cqUserId, queue, providers, orchestratorBridge)
//   description: human-readable label for logging
const callbackRegistry = []

/**
 * Register a callback query handler.
 * @param {string} prefix - The callback data prefix to match
 * @param {Function} handler - Async handler function
 * @param {object} [opts] - Options
 * @param {boolean} [opts.exact=false] - If true, match exact string instead of startsWith
 * @param {string} [opts.description=""] - Human-readable label for logging
 */
function registerCallback(prefix, handler, opts) {
	opts = opts || {}
	callbackRegistry.push({
		prefix: prefix,
		handler: handler,
		exact: opts.exact || false,
		description: opts.description || prefix,
	})
}

/**
 * Dispatch a callback query to the registered handler.
 * Returns true if a handler was found and executed, false otherwise.
 */
async function dispatchCallback(
	botToken,
	cq,
	cqChatId,
	cqMessageId,
	cqData,
	cqUserId,
	queue,
	providers,
	orchestratorBridge,
) {
	for (var i = 0; i < callbackRegistry.length; i++) {
		var entry = callbackRegistry[i]
		var matches = entry.exact ? cqData === entry.prefix : cqData.startsWith(entry.prefix)
		if (matches) {
			logTelegramUsage("callback:" + entry.description, cqChatId, cqUserId, { data: cqData.slice(0, 60) })
			try {
				await entry.handler(
					botToken,
					cq,
					cqChatId,
					cqMessageId,
					cqData,
					cqUserId,
					queue,
					providers,
					orchestratorBridge,
				)
			} catch (err) {
				logTelegramError("callback:" + entry.description, cqChatId, cqUserId, err, { data: cqData })
				console.error("[telegram] Callback handler error for '" + entry.description + "':", err.message)
			}
			return true
		}
	}
	return false
}

/**
 * Main update handler — routes incoming Telegram updates to the appropriate handler.
 * Supports both direct commands and @superroo_bot mentions in groups.
 * Includes session guard: blocks non-public commands until authenticated via auth module.
 *
 * @param {object} update - Telegram webhook update object
 * @param {string} botToken
 * @param {object} queue - BullMQ queue instance
 * @param {Array} [providers] - AI provider configs for /ask and @mention support
 */
async function handleUpdate(update, botToken, queue, providers, orchestratorBridge) {
	// ─── Webhook update deduplication ──────────────────────────────────────
	// Telegram delivers updates with at-least-once semantics. Skip updates
	// that have already been processed to prevent duplicate command execution.
	if (update && update.update_id !== undefined) {
		if (processedUpdateIds.has(update.update_id)) {
			console.log("[telegram] Duplicate update_id " + update.update_id + " — skipping")
			return
		}
		processedUpdateIds.add(update.update_id)
		// Bounded set: remove oldest entries when we exceed the limit
		if (processedUpdateIds.size > PROCESSED_UPDATE_IDS_MAX) {
			var toDelete = processedUpdateIds.size - PROCESSED_UPDATE_IDS_MAX
			var iter = processedUpdateIds.values()
			for (var di = 0; di < toDelete; di++) {
				processedUpdateIds.delete(iter.next().value)
			}
		}
	}

	// ─── Handle my_chat_member updates (bot added to/removed from groups) ──
	// Only @jpgy888 can add the bot to groups. If someone else adds it, leave immediately.
	if (update && update.my_chat_member) {
		var mcm = update.my_chat_member
		var mcmChat = mcm.chat
		var mcmFrom = mcm.from
		var newStatus = mcm.new_chat_member && mcm.new_chat_member.status
		var oldStatus = mcm.old_chat_member && mcm.old_chat_member.status

		// Only act when bot is added to a group (status changed to "member")
		if (newStatus === "member" && oldStatus !== "member") {
			var adderUsername = (mcmFrom && mcmFrom.username) || ""
			console.log("[telegram] Bot added to group " + mcmChat.id + " by @" + adderUsername)

			// Check if the adder is @jpgy888
			if (adderUsername.toLowerCase() !== BOSS_USERNAME.toLowerCase()) {
				console.log("[telegram] Unauthorized add by @" + adderUsername + " — leaving group " + mcmChat.id)
				try {
					// Send a message explaining why we're leaving
					await sendMessage(
						botToken,
						mcmChat.id,
						"*Access Restricted* 🔒\n\n" +
							"This bot can only be added to groups by @" +
							BOSS_USERNAME +
							". " +
							"If you believe this is an error, please contact @" +
							BOSS_USERNAME +
							".",
					)
					// Leave the group
					var leaveUrl = TELEGRAM_API_BASE + botToken + "/leaveChat"
					await fetch(leaveUrl, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ chat_id: mcmChat.id }),
					})
				} catch (err) {
					console.error("[telegram] Failed to leave group " + mcmChat.id + ":", err.message)
				}
			} else {
				console.log("[telegram] Bot added to group " + mcmChat.id + " by boss @" + adderUsername + " — allowed")
				await sendMessage(
					botToken,
					mcmChat.id,
					"*SuperRoo Bot Ready* 🤖\n\n" +
						"Thanks for adding me! I'm now active in this group.\n\n" +
						"*To get started:*\n" +
						"1. Use `/specify <workspace>` to bind this group to a project\n" +
						"   Example: `/specify productgenerator`\n" +
						"2. Just type naturally — I'll respond to every message conversationally!\n" +
						"3. Use `@superroo_bot` for explicit commands if needed\n" +
						"4. I'll automatically use the bound workspace for all coding tasks\n\n" +
						"Use `/help` to see all commands.",
				)
			}
		}
		return
	}

	// ─── Rate limit check ───
	var chatId = update.message
		? update.message.chat.id
		: update.callback_query
			? update.callback_query.message.chat.id
			: null
	if (chatId) {
		var session = activeSessions.get(chatId)
		var isPremium = !!(session && session.authSession)
		var rateCheck = checkRateLimit(chatId, isPremium)
		if (!rateCheck.allowed) {
			console.log(
				"[telegram] Rate limited chat " +
					chatId +
					" (" +
					(isPremium ? "premium" : "free") +
					"), retry after " +
					rateCheck.retryAfter +
					"s",
			)
			return
		}
	}

	// Handle callback queries (inline keyboard button presses)
	if (update && update.callback_query) {
		var cq = update.callback_query
		var cqChatId = cq.message.chat.id
		var cqMessageId = cq.message.message_id
		var cqData = cq.data || ""
		var cqUserId = cq.from.id

		// Answer the callback query to remove loading state
		await answerCallbackQuery(botToken, cq.id)

		try {
			// ─── Register all callback handlers ──────────────────────────────────
			// Mini App Workflow
			registerCallback(
				"project:",
				async (botToken, cq, cqChatId, cqMessageId, cqData, cqUserId, queue, providers, orchestratorBridge) => {
					var projectId = cqData.slice(8)
					await handleProjectSelect(botToken, cqChatId, cqMessageId, projectId, cqUserId)
				},
				{ description: "project" },
			)
			registerCallback(
				"notify:",
				async (botToken, cq, cqChatId, cqMessageId, cqData, cqUserId, queue, providers, orchestratorBridge) => {
					await telegramNotifier.handleNotificationCallback(botToken, cq)
				},
				{ description: "notify" },
			)
			// Paginated message navigation (GAP 4.3)
			registerCallback(
				"page:",
				async (botToken, cq, cqChatId, cqMessageId, cqData, cqUserId, queue, providers, orchestratorBridge) => {
					await handlePageNavigation(botToken, cq, cqChatId, cqMessageId, cqData)
				},
				{ description: "page" },
			)
			registerCallback(
				"preview_plan:",
				async (botToken, cq, cqChatId, cqMessageId, cqData, cqUserId, queue, providers, orchestratorBridge) => {
					var pptaskId = cqData.slice(13)
					await handlePreviewPlan(botToken, cqChatId, cqMessageId, pptaskId)
				},
				{ description: "preview_plan" },
			)
			registerCallback(
				"approve_plan:",
				async (botToken, cq, cqChatId, cqMessageId, cqData, cqUserId, queue, providers, orchestratorBridge) => {
					var aptaskId = cqData.slice(13)
					await handleApprovePlan(botToken, cqChatId, cqMessageId, aptaskId)
				},
				{ description: "approve_plan" },
			)
			registerCallback(
				"view_diff:",
				async (botToken, cq, cqChatId, cqMessageId, cqData, cqUserId, queue, providers, orchestratorBridge) => {
					var vdtaskId = cqData.slice(10)
					await handleViewDiff(botToken, cqChatId, cqMessageId, vdtaskId)
				},
				{ description: "view_diff" },
			)
			registerCallback(
				"deploy_staging:",
				async (botToken, cq, cqChatId, cqMessageId, cqData, cqUserId, queue, providers, orchestratorBridge) => {
					var dstaskId = cqData.slice(15)
					await handleDeployStaging(botToken, cqChatId, cqMessageId, dstaskId)
				},
				{ description: "deploy_staging" },
			)
			registerCallback(
				"deploy_production:",
				async (botToken, cq, cqChatId, cqMessageId, cqData, cqUserId, queue, providers, orchestratorBridge) => {
					var dptaskId = cqData.slice(18)
					await handleDeployProduction(botToken, cqChatId, cqMessageId, dptaskId)
				},
				{ description: "deploy_production" },
			)
			registerCallback(
				"rollback:",
				async (botToken, cq, cqChatId, cqMessageId, cqData, cqUserId, queue, providers, orchestratorBridge) => {
					var rbsavepointId = cqData.slice(9)
					await handleRollbackCallback(botToken, cqChatId, cqMessageId, rbsavepointId)
				},
				{ description: "rollback" },
			)
			// Mini IDE
			registerCallback(
				"projects",
				async (botToken, cq, cqChatId, cqMessageId, cqData, cqUserId, queue, providers, orchestratorBridge) => {
					await handleProjects(botToken, cqChatId, cqUserId)
				},
				{ exact: true, description: "miniide_projects" },
			)
			registerCallback(
				"help",
				async (botToken, cq, cqChatId, cqMessageId, cqData, cqUserId, queue, providers, orchestratorBridge) => {
					await handleHelp(botToken, cqChatId)
				},
				{ exact: true, description: "miniide_help" },
			)

			// ─── Smart Terminal Callbacks ──────────────────────────────────────
			registerCallback(
				"brain_exec:",
				async (botToken, cq, cqChatId, cqMessageId, cqData, cqUserId, queue, providers, orchestratorBridge) => {
					var execToken = cqData.slice(11)
					var execCmd = resolveCallbackCommand(execToken)
					if (!execCmd) {
						await sendMessage(
							botToken,
							cqChatId,
							"*Command Expired* ⏰\n\nThis quick action button has expired. Please run the command again directly.",
						)
						await answerCallbackQuery(botToken, cq.id)
						return
					}
					await sendChatAction(botToken, cqChatId, "typing")
					try {
						var execResult = await tgEndpoints.brainExecute(execCmd, cqChatId)
						if (execResult.ok) {
							updateSmartContext(cqChatId, { lastCommand: execCmd, lastBrainResult: execResult })
							await sendMessage(
								botToken,
								cqChatId,
								telegramEngineer.formatBrainFeedback(execResult.feedback),
							)
							if (execResult.feedback && execResult.feedback.exitCode !== 0) {
								await new Promise(function (r) {
									return setTimeout(r, 300)
								})
								var analyzeResult = await tgEndpoints.brainAnalyze(
									execResult.feedback.output || execCmd,
									cqChatId,
								)
								if (analyzeResult.ok && analyzeResult.errors && analyzeResult.errors.length > 0) {
									updateSmartContext(cqChatId, { lastError: analyzeResult.errors[0].message })
									await sendMessage(
										botToken,
										cqChatId,
										telegramEngineer.formatBrainErrors(analyzeResult.errors),
									)
								}
							}
							await sendQuickActionButtons(botToken, cqChatId, execCmd, execResult)
						} else {
							await sendMessage(
								botToken,
								cqChatId,
								"*Execution Error* ❌\n\n" + (execResult.error || "Unknown error"),
							)
						}
					} catch (err) {
						logTelegramError("callback:brain_exec", cqChatId, cqUserId, err, { command: execCmd })
						await sendMessage(botToken, cqChatId, "*Error* ❌\n\n" + err.message)
					}
					await answerCallbackQuery(botToken, cq.id)
				},
				{ description: "brain_exec" },
			)
			registerCallback(
				"brain_pipeline:",
				async (botToken, cq, cqChatId, cqMessageId, cqData, cqUserId, queue, providers, orchestratorBridge) => {
					var pipeToken = cqData.slice(15)
					var pipeQuery = resolveCallbackCommand(pipeToken)
					if (!pipeQuery) {
						await sendMessage(
							botToken,
							cqChatId,
							"*Command Expired* ⏰\n\nThis quick action button has expired. Please run the command again directly.",
						)
						await answerCallbackQuery(botToken, cq.id)
						return
					}
					await sendChatAction(botToken, cqChatId, "typing")
					try {
						var pipeResult = await tgEndpoints.brainPipeline(pipeQuery, cqChatId)
						if (pipeResult.ok) {
							updateSmartContext(cqChatId, { lastCommand: pipeQuery, lastBrainResult: pipeResult })
							var pipeLines = ["*🧠 Terminal Brain — Pipeline Result*"]
							if (pipeResult.plan && pipeResult.plan.commands) {
								pipeLines.push("\n*📋 Plan:*")
								for (var ppi = 0; ppi < pipeResult.plan.commands.length; ppi++) {
									var ppc =
										typeof pipeResult.plan.commands[ppi] === "string"
											? pipeResult.plan.commands[ppi]
											: pipeResult.plan.commands[ppi].command || ""
									pipeLines.push("  `" + (ppi + 1) + ".` `" + ppc + "`")
								}
							}
							if (pipeResult.errors && pipeResult.errors.length > 0) {
								updateSmartContext(cqChatId, { lastError: pipeResult.errors[0].message })
								pipeLines.push("\n*🔍 Errors:* " + pipeResult.errors.length)
							}
							if (pipeResult.fixes && pipeResult.fixes.length > 0) {
								pipeLines.push("\n*🔧 Fixes:* " + pipeResult.fixes.length)
							}
							if (!pipeResult.errors || pipeResult.errors.length === 0) {
								pipeLines.push("\n✅ *All steps completed!*")
							}
							await sendMessage(botToken, cqChatId, pipeLines.join("\n"))
							await sendQuickActionButtons(botToken, cqChatId, pipeQuery, pipeResult)
						} else {
							await sendMessage(
								botToken,
								cqChatId,
								"*Pipeline Error* ❌\n\n" + (pipeResult.error || "Unknown error"),
							)
						}
					} catch (err) {
						logTelegramError("callback:brain_pipeline", cqChatId, cqUserId, err, { query: pipeQuery })
						await sendMessage(botToken, cqChatId, "*Error* ❌\n\n" + err.message)
					}
					await answerCallbackQuery(botToken, cq.id)
				},
				{ description: "brain_pipeline" },
			)
			registerCallback(
				"brain_explain:",
				async (botToken, cq, cqChatId, cqMessageId, cqData, cqUserId, queue, providers, orchestratorBridge) => {
					var explainToken = cqData.slice(14)
					var explainCmd = resolveCallbackCommand(explainToken)
					if (!explainCmd) {
						await sendMessage(
							botToken,
							cqChatId,
							"*Command Expired* ⏰\n\nThis quick action button has expired. Please run the command again directly.",
						)
						await answerCallbackQuery(botToken, cq.id)
						return
					}
					await sendChatAction(botToken, cqChatId, "typing")
					try {
						var explainResult = await tgEndpoints.brainPlan("explain: " + explainCmd, cqChatId)
						if (explainResult.ok) {
							var explainText = "*❓ Command Explanation*\n\n`" + explainCmd + "`\n\n"
							explainText +=
								explainResult.plan && typeof explainResult.plan === "string"
									? explainResult.plan
									: "This command will be executed through the Terminal Brain with safety checks and error analysis."
							await sendMessage(botToken, cqChatId, explainText)
						} else {
							await sendMessage(
								botToken,
								cqChatId,
								"*Explain Error* ❌\n\n" + (explainResult.error || "Unknown error"),
							)
						}
					} catch (err) {
						logTelegramError("callback:brain_explain", cqChatId, cqUserId, err, { command: explainCmd })
						await sendMessage(botToken, cqChatId, "*Error* ❌\n\n" + err.message)
					}
					await answerCallbackQuery(botToken, cq.id)
				},
				{ description: "brain_explain" },
			)
			registerCallback(
				"brain_fix:",
				async (botToken, cq, cqChatId, cqMessageId, cqData, cqUserId, queue, providers, orchestratorBridge) => {
					var fixToken = cqData.slice(9)
					var fixCmd = resolveCallbackCommand(fixToken)
					if (!fixCmd) {
						await sendMessage(
							botToken,
							cqChatId,
							"*Command Expired* ⏰\n\nThis quick action button has expired. Please run the command again directly.",
						)
						await answerCallbackQuery(botToken, cq.id)
						return
					}
					await sendChatAction(botToken, cqChatId, "typing")
					try {
						var fixExecResult = await tgEndpoints.brainExecute(fixCmd, cqChatId)
						if (fixExecResult.ok && fixExecResult.feedback) {
							var fixOutput = fixExecResult.feedback.output || ""
							var fixResult = await tgEndpoints.brainFix(fixOutput, cqChatId)
							if (fixResult.ok && fixResult.fixes && fixResult.fixes.length > 0) {
								updateSmartContext(cqChatId, { lastFixApplied: fixResult.fixes[0] })
								var fixLines = ["*🔧 Auto-Fix Results*"]
								for (var fxi = 0; fxi < fixResult.fixes.length; fxi++) {
									fixLines.push("• " + fixResult.fixes[fxi])
								}
								await sendMessage(botToken, cqChatId, fixLines.join("\n"))
							} else {
								await sendMessage(
									botToken,
									cqChatId,
									"*No fixes found* — the command may have run successfully or the error is not yet recognized.",
								)
							}
						} else {
							await sendMessage(
								botToken,
								cqChatId,
								"*Fix Error* ❌\n\n" + (fixExecResult.error || "Could not re-run command"),
							)
						}
					} catch (err) {
						logTelegramError("callback:brain_fix", cqChatId, cqUserId, err, { command: fixCmd })
						await sendMessage(botToken, cqChatId, "*Error* ❌\n\n" + err.message)
					}
					await answerCallbackQuery(botToken, cq.id)
				},
				{ description: "brain_fix" },
			)
			registerCallback(
				"brain_errors:",
				async (botToken, cq, cqChatId, cqMessageId, cqData, cqUserId, queue, providers, orchestratorBridge) => {
					var errToken = cqData.slice(13)
					var errCmd = resolveCallbackCommand(errToken)
					if (!errCmd) {
						await sendMessage(
							botToken,
							cqChatId,
							"*Command Expired* ⏰\n\nThis quick action button has expired. Please run the command again directly.",
						)
						await answerCallbackQuery(botToken, cq.id)
						return
					}
					await sendChatAction(botToken, cqChatId, "typing")
					try {
						var errResult = await tgEndpoints.brainAnalyze(errCmd, cqChatId)
						if (errResult.ok) {
							await sendMessage(botToken, cqChatId, telegramEngineer.formatBrainErrors(errResult.errors))
						} else {
							await sendMessage(
								botToken,
								cqChatId,
								"*Error Analysis Failed* ❌\n\n" + (errResult.error || "Unknown error"),
							)
						}
					} catch (err) {
						logTelegramError("callback:brain_errors", cqChatId, cqUserId, err, { command: errCmd })
						await sendMessage(botToken, cqChatId, "*Error* ❌\n\n" + err.message)
					}
					await answerCallbackQuery(botToken, cq.id)
				},
				{ description: "brain_errors" },
			)
			registerCallback(
				"brain_deploy:",
				async (botToken, cq, cqChatId, cqMessageId, cqData, cqUserId, queue, providers, orchestratorBridge) => {
					var deployToken = cqData.slice(13)
					var deployCmd = resolveCallbackCommand(deployToken)
					if (!deployCmd) {
						await sendMessage(
							botToken,
							cqChatId,
							"*Command Expired* ⏰\n\nThis quick action button has expired. Please run the command again directly.",
						)
						await answerCallbackQuery(botToken, cq.id)
						return
					}
					await sendMessage(
						botToken,
						cqChatId,
						"*Deploy Requested* 🚀\n\nUse `/deploy` to start the deployment process.\n\nYou'll need to verify with your OTP code for production deployments.",
					)
					await answerCallbackQuery(botToken, cq.id)
				},
				{ description: "brain_deploy" },
			)
			registerCallback(
				"brain_status",
				async (botToken, cq, cqChatId, cqMessageId, cqData, cqUserId, queue, providers, orchestratorBridge) => {
					await sendChatAction(botToken, cqChatId, "typing")
					try {
						var statusResult = await tgEndpoints.readLogs("all", 5)
						var ctx = getSmartContext(cqChatId)
						var statusLines = ["*📊 System Status*"]
						statusLines.push("• Messages in session: " + ctx.messageCount)
						if (ctx.lastCommand) statusLines.push("• Last command: `" + ctx.lastCommand.slice(0, 50) + "`")
						if (ctx.lastError) statusLines.push("• Last error: " + ctx.lastError.slice(0, 100))
						if (ctx.lastFixApplied) statusLines.push("• Last fix: " + ctx.lastFixApplied.slice(0, 100))
						statusLines.push(
							"\n*Terminal Brain:* " + (_terminalBrainAvailable ? "✅ Available" : "❌ Not available"),
						)
						await sendMessage(botToken, cqChatId, statusLines.join("\n"))
					} catch (err) {
						await sendMessage(botToken, cqChatId, "*Status Error* ❌\n\n" + err.message)
					}
					await answerCallbackQuery(botToken, cq.id)
				},
				{ exact: true, description: "brain_status" },
			)
			registerCallback(
				"brain_memory",
				async (botToken, cq, cqChatId, cqMessageId, cqData, cqUserId, queue, providers, orchestratorBridge) => {
					await sendChatAction(botToken, cqChatId, "typing")
					try {
						var memResult = await tgEndpoints.brainMemory(cqChatId)
						if (memResult.ok) {
							await sendMessage(botToken, cqChatId, telegramEngineer.formatBrainMemory(memResult.stats))
						} else {
							await sendMessage(
								botToken,
								cqChatId,
								"*Memory Error* ❌\n\n" + (memResult.error || "Unknown error"),
							)
						}
					} catch (err) {
						await sendMessage(botToken, cqChatId, "*Error* ❌\n\n" + err.message)
					}
					await answerCallbackQuery(botToken, cq.id)
				},
				{ exact: true, description: "brain_memory" },
			)
			registerCallback(
				"brain_cancel",
				async (botToken, cq, cqChatId, cqMessageId, cqData, cqUserId, queue, providers, orchestratorBridge) => {
					await sendMessage(botToken, cqChatId, "*Cancelled* ❌\n\nAction has been cancelled.")
					await answerCallbackQuery(botToken, cq.id)
				},
				{ exact: true, description: "brain_cancel" },
			)

			// ─── Coder Workflow Callbacks ────────────────────────────────────────
			// coder:<action>:<taskId> — Handle multi-phase coder workflow (approve/reject/commit/deploy/etc.)
			registerCallback(
				"coder:",
				async (botToken, cq, cqChatId, cqMessageId, cqData, cqUserId, queue, providers, orchestratorBridge) => {
					logTelegramUsage("callback:coder", cqChatId, cqUserId, { data: cqData })
					try {
						var coderResult = await telegramNotifier.handleCoderCallback(botToken, cq)
						if (coderResult && coderResult.action && coderResult.taskId) {
							var coderTaskId = coderResult.taskId
							var pendingJob = telegramNotifier.getPendingCoderJob(coderTaskId)

							// Improvement 1 & 7: Build fresh conversation context for each phase
							var freshConversationSummary = buildConversationSummary(cqChatId)

							// Improvement 2: Shared retry options for all queue.add() calls
							var jobOpts = { attempts: 3, backoff: { type: "exponential", delay: 5000 } }

							if (coderResult.action === "approved") {
								// User approved the plan — enqueue an "apply" job
								await sendChatAction(botToken, cqChatId, "typing")
								var applyJob = await queue.add(
									"coder-apply-" + coderTaskId,
									{
										task: pendingJob ? pendingJob.instruction : "Apply approved changes",
										agentId: "superroo-coder-agent",
										phase: "apply",
										taskId: coderTaskId,
										workspaceDir: pendingJob ? pendingJob.workspaceDir : undefined,
										repoName: pendingJob ? pendingJob.repoName : undefined,
										branch: pendingJob ? pendingJob.branch : undefined,
										plan: pendingJob ? pendingJob.plan : undefined,
										telegram: {
											botToken: botToken,
											chatId: cqChatId,
											taskId: coderTaskId,
											branchName: pendingJob ? pendingJob.branch : undefined,
											conversationSummary: freshConversationSummary,
											auto: pendingJob ? pendingJob.auto : false,
										},
									},
									jobOpts,
								)
								logTelegramUsage("callback:coder:apply_enqueued", cqChatId, cqUserId, {
									taskId: coderTaskId,
									jobId: applyJob.id,
								})
							} else if (coderResult.action === "commit") {
								// User wants to commit — enqueue a "commit" job
								await sendChatAction(botToken, cqChatId, "typing")
								var commitJob = await queue.add(
									"coder-commit-" + coderTaskId,
									{
										task: pendingJob ? pendingJob.instruction : "Commit changes",
										agentId: "superroo-coder-agent",
										phase: "commit",
										taskId: coderTaskId,
										workspaceDir: pendingJob ? pendingJob.workspaceDir : undefined,
										repoName: pendingJob ? pendingJob.repoName : undefined,
										branch: pendingJob ? pendingJob.branch : undefined,
										telegram: {
											botToken: botToken,
											chatId: cqChatId,
											taskId: coderTaskId,
											branchName: pendingJob ? pendingJob.branch : undefined,
											conversationSummary: freshConversationSummary,
											auto: pendingJob ? pendingJob.auto : false,
										},
									},
									jobOpts,
								)
								logTelegramUsage("callback:coder:commit_enqueued", cqChatId, cqUserId, {
									taskId: coderTaskId,
									jobId: commitJob.id,
								})
							} else if (coderResult.action === "deploy") {
								// User wants to deploy — enqueue a "deploy" job
								await sendChatAction(botToken, cqChatId, "typing")
								var deployJob = await queue.add(
									"coder-deploy-" + coderTaskId,
									{
										task: pendingJob ? pendingJob.instruction : "Deploy changes",
										agentId: "superroo-coder-agent",
										phase: "deploy",
										taskId: coderTaskId,
										workspaceDir: pendingJob ? pendingJob.workspaceDir : undefined,
										repoName: pendingJob ? pendingJob.repoName : undefined,
										branch: pendingJob ? pendingJob.branch : undefined,
										telegram: {
											botToken: botToken,
											chatId: cqChatId,
											taskId: coderTaskId,
											branchName: pendingJob ? pendingJob.branch : undefined,
											conversationSummary: freshConversationSummary,
											auto: pendingJob ? pendingJob.auto : false,
										},
									},
									jobOpts,
								)
								logTelegramUsage("callback:coder:deploy_enqueued", cqChatId, cqUserId, {
									taskId: coderTaskId,
									jobId: deployJob.id,
								})
							} else if (coderResult.action === "rejected" || coderResult.action === "cancelled") {
								// User rejected or cancelled — clean up
								telegramNotifier.removePendingCoderJob(coderTaskId)
								stopAutoTypingInterval(coderTaskId)
								logTelegramUsage("callback:coder:" + coderResult.action, cqChatId, cqUserId, {
									taskId: coderTaskId,
								})
							} else if (coderResult.action === "retry") {
								// User wants to retry with more details — enqueue a new "plan" job
								await sendChatAction(botToken, cqChatId, "typing")
								var retryJob = await queue.add(
									"coder-plan-" + coderTaskId,
									{
										task: pendingJob ? pendingJob.instruction : "Retry coding task",
										agentId: "superroo-coder-agent",
										phase: "plan",
										taskId: coderTaskId,
										workspaceDir: pendingJob ? pendingJob.workspaceDir : undefined,
										repoName: pendingJob ? pendingJob.repoName : undefined,
										branch: pendingJob ? pendingJob.branch : undefined,
										telegram: {
											botToken: botToken,
											chatId: cqChatId,
											taskId: coderTaskId,
											branchName: pendingJob ? pendingJob.branch : undefined,
											conversationSummary: freshConversationSummary,
											auto: pendingJob ? pendingJob.auto : false,
										},
									},
									jobOpts,
								)
								logTelegramUsage("callback:coder:retry_enqueued", cqChatId, cqUserId, {
									taskId: coderTaskId,
									jobId: retryJob.id,
								})
							} else if (coderResult.action === "done") {
								// User confirmed done — clean up
								telegramNotifier.removePendingCoderJob(coderTaskId)
								stopAutoTypingInterval(coderTaskId)
								logTelegramUsage("callback:coder:done", cqChatId, cqUserId, { taskId: coderTaskId })
							} else if (coderResult.action === "diff") {
								// View diff — already handled by handleCoderCallback (edits message)
								logTelegramUsage("callback:coder:diff", cqChatId, cqUserId, { taskId: coderTaskId })
							} else if (coderResult.action === "back") {
								// Go back — already handled by handleCoderCallback (edits message)
								logTelegramUsage("callback:coder:back", cqChatId, cqUserId, { taskId: coderTaskId })
							} else if (coderResult.action === "similar") {
								// Suggest a similar task based on the completed task's instruction
								logTelegramUsage("callback:coder:similar", cqChatId, cqUserId, { taskId: coderTaskId })
								var pendingJob = telegramNotifier.getPendingCoderJob(coderTaskId)
								var baseInstruction = pendingJob ? pendingJob.instruction : ""
								var similarSuggestions = [
									"Add tests for the changes",
									"Add error handling",
									"Add logging",
									"Improve performance",
									"Add documentation",
									"Refactor for readability",
								]
								var suggestionText = similarSuggestions
									.map(function (s, i) {
										return i + 1 + ". " + s + " related to: " + baseInstruction.slice(0, 80)
									})
									.join("\n")
								await sendMessage(
									botToken,
									cqChatId,
									"*📋 Similar Tasks*\n\nBased on your last task, here are related improvements you might want:\n\n" +
										suggestionText +
										"\n\n_Reply with the number or describe what you'd like to do next._",
								)
							} else if (coderResult.action === "audit") {
								// Audit the changes from the completed task
								logTelegramUsage("callback:coder:audit", cqChatId, cqUserId, { taskId: coderTaskId })
								var pendingJob = telegramNotifier.getPendingCoderJob(coderTaskId)
								var auditText = "*🔍 Audit Report*\n\n"
								if (pendingJob) {
									auditText += "*Task:* `" + coderTaskId + "`\n"
									auditText += "*Instruction:* " + pendingJob.instruction.slice(0, 200) + "\n\n"
									if (pendingJob.plan && pendingJob.plan.changes) {
										auditText += "*Files Changed:*\n"
										for (var ci = 0; ci < pendingJob.plan.changes.length; ci++) {
											var ch = pendingJob.plan.changes[ci]
											auditText += "• `" + ch.file + "` — " + (ch.action || "modify") + "\n"
										}
									}
									if (pendingJob.branch) {
										auditText += "\n*Branch:* `" + pendingJob.branch + "`\n"
									}
									if (pendingJob.workspaceDir) {
										auditText += "*Workspace:* `" + pendingJob.workspaceDir + "`\n"
									}
								} else {
									auditText += "_Task details no longer available in memory._"
								}
								auditText +=
									"\n\n_Tip: Use `/diff " +
									coderTaskId +
									"` to view the full diff, or `/logs` to check deployment logs._"
								await sendMessage(botToken, cqChatId, auditText)
							}
						}
					} catch (err) {
						logTelegramError("callback:coder", cqChatId, cqUserId, err, { data: cqData })
						await sendMessage(botToken, cqChatId, "*Coder Workflow Error* ❌\n\n" + err.message)
					}
				},
			)

			// ─── Quick Action Callbacks (from sendActionButtons) ────────────────
			// action:<type>[:<taskId>] — Run Tests, Show Diff, Approve, Status, Fix, Debug
			registerCallback(
				"action:",
				async (botToken, cq, cqChatId, cqMessageId, cqData, cqUserId, queue, providers, orchestratorBridge) => {
					var actionParts = cqData.slice(7).split(":")
					var actionType = actionParts[0]
					var actionTaskId = actionParts[1] || null
					logTelegramUsage("callback:action:" + actionType, cqChatId, cqUserId, { taskId: actionTaskId })
					await sendChatAction(botToken, cqChatId, "typing")
					try {
						if (actionType === "tests") {
							var aqTestResult = await tgEndpoints.runTests("")
							await sendMessage(botToken, cqChatId, telegramEngineer.formatTestResult(aqTestResult))
						} else if (actionType === "diff") {
							if (actionTaskId) {
								await handleDiff(botToken, cqChatId, [actionTaskId], orchestratorBridge)
							} else {
								await handleDiff(botToken, cqChatId, [], orchestratorBridge)
							}
						} else if (actionType === "approve") {
							if (actionTaskId) {
								await handleApprove(botToken, cqChatId, [actionTaskId], orchestratorBridge)
							} else {
								await sendMessage(
									botToken,
									cqChatId,
									"No task to approve. Run `/status` to see active tasks.",
								)
							}
						} else if (actionType === "status") {
							await handleStatus(botToken, cqChatId, [], queue)
						} else if (actionType === "fix") {
							var aqCtx = getSmartContext(cqChatId)
							await handleFix(
								botToken,
								cqChatId,
								aqCtx.lastError ? [aqCtx.lastError] : [],
								providers || [],
							)
						} else if (actionType === "debug") {
							var aqCtx2 = getSmartContext(cqChatId)
							var aqDebugText = aqCtx2.lastError || "the last error"
							var aqDebugResult = await tgEndpoints.debugPlan(aqDebugText)
							await sendMessage(botToken, cqChatId, telegramEngineer.formatDebugPlan(aqDebugResult))
							await sendActionButtons(botToken, cqChatId, null)
						}
					} catch (aqErr) {
						await sendMessage(botToken, cqChatId, "❌ Action failed: " + aqErr.message)
					}
				},
			)

			// ─── Menu Callbacks ────────────────────────────────────────────────
			// menu:<action> — Handle menu button clicks (GUI upgrade, no slash commands needed)
			registerCallback(
				"menu:",
				async (botToken, cq, cqChatId, cqMessageId, cqData, cqUserId, queue, providers, orchestratorBridge) => {
					var menuAction = cqData.slice(5)
					logTelegramUsage("callback:menu", cqChatId, cqUserId, { action: menuAction })
					try {
						switch (menuAction) {
							case "code":
								// Prompt user to type their coding instruction
								await editMessageText(
									botToken,
									cqChatId,
									cqMessageId,
									'💻 *Coding*\n\nPlease type your coding instruction below.\n\n_Example: "Add a login page with email and password fields"_\n\nOr use `/code <instruction>` for power users.',
								)
								break
							case "debug":
								await editMessageText(
									botToken,
									cqChatId,
									cqMessageId,
									"🪲 *Debugging*\n\nPlease describe the bug you're experiencing below.\n\n_Example: \"The login button doesn't work on mobile\"_\n\nOr use `/debug <description>` for power users.",
								)
								break
							case "deploy":
								await handleDeploy(botToken, cqChatId, [], queue, orchestratorBridge)
								break
							case "status":
								await handleStatus(botToken, cqChatId, [], queue)
								break
							case "upgrade":
								await editMessageText(
									botToken,
									cqChatId,
									cqMessageId,
									'🔄 *Upgrade Bot*\n\nPlease describe what you\'d like to improve or upgrade about the bot.\n\n_Examples:_\n• "Add commit/deploy query capability"\n• "Make the bot learn from past conversations"\n• "Improve error handling in the Telegram bot"\n\nOr use `/upgrade <description>` for power users.',
								)
								break
							case "recent":
								await handleRecent(botToken, cqChatId)
								break
							case "projects":
								await handleProjects(botToken, cqChatId, cqUserId)
								break
							case "brain":
								try {
									var brainRes = await fetch("http://127.0.0.1:8787/brain")
									var brainData = await brainRes.json()
									if (brainData.success && brainData.brain) {
										var b = brainData.brain
										await editMessageText(
											botToken,
											cqChatId,
											cqMessageId,
											"*🧠 SuperRoo Central Brain*\n\n" +
												"*Status:* " +
												b.status +
												"\n" +
												"*Agents:* Hermes Claw, Ollama, Cloud Coder\n" +
												"*Capabilities:* Memory (RAG), Commit/Deploy Tracking, Learning Loop\n\n" +
												"*API Base:* `DASHBOARD_URL/api`\n" +
												"*Dashboard:* `DASHBOARD_URL`\n" +
												"*Telegram:* @SuperRooBot\n\n" +
												"*For AI Bots:* `GET /api/brain` to discover all endpoints\n\n" +
												"*Commands:*\n" +
												"• `/brain` — Show this info\n" +
												"• `/brain plan <query>` — Terminal Brain planning\n" +
												"• `/brain exec <cmd>` — Execute command safely\n" +
												"• `/brain memory` — Terminal memory stats\n" +
												"• `/brain context` — Project context",
										)
									} else {
										throw new Error("Invalid response")
									}
								} catch (err) {
									await editMessageText(
										botToken,
										cqChatId,
										cqMessageId,
										'🧠 *Central Brain*\n\nType your command or question.\n\n_Example: "Check system status" or "Run npm test"_\n\nOr use `/brain <command>` for power users.',
									)
								}
								break
							case "consultant":
								await editMessageText(
									botToken,
									cqChatId,
									cqMessageId,
									'🔍 *Consultant*\n\nWhat would you like me to research or analyze?\n\n_Example: "Compare PostgreSQL vs MongoDB for a chat app"_',
								)
								break
							case "hermes":
								await editMessageText(
									botToken,
									cqChatId,
									cqMessageId,
									'🧠 *Hermes Claw*\n\nType your Hermes Claw command below.\n\n_Examples:_\n• "Recall how to fix build errors"\n• "Learn that I should always run tests before deploy"\n• "Show stats"\n\nOr use `/hermes <subcommand>` for power users.',
								)
								break
							case "skills":
								await handleSkills(botToken, cqChatId)
								break
							case "resources":
								await handleResources(botToken, cqChatId)
								break
							case "logs":
								await handleLogs(botToken, cqChatId, [])
								break
							case "tests":
								await handleTest(botToken, cqChatId, [], queue)
								break
							case "help":
								await handleHelp(botToken, cqChatId)
								break
							case "about":
								await handleAbout(botToken, cqChatId)
								break
							case "back":
								// Show the menu again
								await handleMenu(botToken, cqChatId)
								break
							default:
								await handleMenu(botToken, cqChatId)
						}
					} catch (err) {
						logTelegramError("callback:menu", cqChatId, cqUserId, err, { action: menuAction })
						await sendMessage(botToken, cqChatId, "*Menu Error* ❌\n\n" + err.message)
					}
				},
			)

			// Unhandled callback data — dispatch via registry; if no handler matched, log warning
			var handled = await dispatchCallback(
				botToken,
				cq,
				cqChatId,
				cqMessageId,
				cqData,
				cqUserId,
				queue,
				providers,
				orchestratorBridge,
			)
			if (!handled) {
				logTelegramWarning("callback:unknown", cqChatId, cqUserId, "Unhandled callback data", { data: cqData })
			}
		} catch (err) {
			logTelegramError("callback:" + (cqData.split(":")[0] || "unknown"), cqChatId, cqUserId, err, {
				data: cqData,
			})
			console.error("[telegram] Callback query error:", err.message)
		}
		return
	}

	if (!update || !update.message) return

	var msg = update.message
	var chatId = msg.chat.id
	var text = (msg.text || "").trim()
	var entities = msg.entities || []
	var telegramUserId = msg.from ? msg.from.id : chatId

	if (!text) return

	// If the user quoted/replied to a message, prepend that context so the AI
	// understands what "this", "that", "the task above", etc. refers to.
	var quotedText = msg.reply_to_message && (msg.reply_to_message.text || msg.reply_to_message.caption)
	if (quotedText) {
		// Detect if the quoted message contains a code block → treat as "edit this code"
		var hasCodeBlock = quotedText.includes("```")
		if (hasCodeBlock) {
			text = "[Code to edit:\n" + quotedText.slice(0, 1000) + "]\n\nUser instruction: " + text
		} else {
			text = "[Quoted message: " + quotedText.slice(0, 500) + "]\n\nUser reply: " + text
		}
	}

	// Check if this is a group chat
	var isGroup = chatId < 0
	var botMentioned = false

	if (isGroup) {
		// Check for @superroo_bot mention OR /command@superroo_bot format
		for (var i = 0; i < entities.length; i++) {
			var entity = entities[i]
			if (entity.type === "mention") {
				var mention = text.slice(entity.offset, entity.offset + entity.length)
				if (mention.toLowerCase() === "@" + BOT_USERNAME.toLowerCase()) {
					botMentioned = true
					break
				}
			}
			// Handle /command@superroo_bot (bot_command entity containing the bot username)
			if (entity.type === "bot_command") {
				var cmdText = text.slice(entity.offset, entity.offset + entity.length)
				if (cmdText.toLowerCase().includes("@" + BOT_USERNAME.toLowerCase())) {
					botMentioned = true
					break
				}
			}
		}

		// Strip @botname suffix from commands and mentions if present
		if (botMentioned) {
			text = text.replace(new RegExp("@" + BOT_USERNAME, "gi"), "").trim()
		}
	}

	// ─── Reply Keyboard Button Mapping ───────────────────────────────────────
	// Convert persistent reply keyboard button taps to slash commands
	var replyKeyboardMap = {
		"💻 Code": "/code",
		"🔍 Debug": "/debug",
		"🧪 Test": "/tests",
		"🚀 Deploy": "/deploy",
		"📋 Recent": "/recent",
		"📊 Status": "/status",
		"🧠 Brain": "/brain",
		"📋 Menu": "/menu",
	}
	if (replyKeyboardMap[text]) {
		text = replyKeyboardMap[text]
		console.log("[telegram] Reply keyboard mapped '" + text + "' to command")
	}

	// Parse command and arguments
	var args = text.split(/\s+/)
	var command = args[0] ? args[0].toLowerCase() : ""
	var cmdArgs = args.slice(1)
	console.log("[telegram] Message from " + telegramUserId + " in chat " + chatId + ": " + text.slice(0, 80))

	// ─── Record Command History (GAP 4.2) ───────────────────────────────
	// Store every user message in a per-chat ring buffer so the user can
	// recall recent commands via /history.
	recordCommand(chatId, command, text, cmdArgs)

	// ─── Session Guard ──────────────────────────────────────────────────
	// Block non-public slash commands until the user has an active auth session.
	// Natural language messages (no slash prefix) are allowed through — they'll
	// be handled by the natural language processor which checks auth internally.
	// PUBLIC_COMMANDS: /start, /login, /help, /about
	// NOTE: Session guard runs BEFORE group chat /ask conversion so natural language
	// messages (which don't start with "/") bypass the guard entirely.
	if (command.startsWith("/") && PUBLIC_COMMANDS.indexOf(command) === -1) {
		var authSession = await checkAuthSession(telegramUserId, chatId)
		if (!authSession) {
			// Also check if there's a local session (for backward compatibility)
			// Use getSessionWithNotification to send expiry notification if session timed out
			var localSession = getSessionWithNotification(botToken, chatId)
			if (!localSession) {
				// In group chats, natural language messages bypass auth — only slash commands are blocked
				var groupHint = isGroup
					? "\n\n*Tip:* You can still chat with me naturally in this group without logging in. Only specific commands like `/projects`, `/code`, `/session` require authentication."
					: ""
				await sendMessage(
					botToken,
					chatId,
					"*Authentication Required* 🔒\n\nPlease login first to use this command.\n\nUse `/login` to authenticate with your SuperRoo Cloud account.\n\n*Public commands:* `/start`, `/help`, `/about`, `/login`" +
						groupHint,
				)
				return
			}
		}
	}

	// In groups, if no command and no slash, treat as /ask (conversational mode)
	// This runs AFTER the session guard so natural language messages bypass auth check.
	if (isGroup && !command.startsWith("/")) {
		command = "/ask"
		cmdArgs = text.split(/\s+/)
	}

	// ─── Boss-Only Guard ────────────────────────────────────────────────
	// Only @jpgy888 (boss) can use the bot. Others get a polite rejection.
	// PUBLIC_COMMANDS (/start, /login, /help, /about, /debug, /logs, /tests, /restart)
	// are allowed through so users can authenticate or get help.
	var senderUsername = (msg.from && msg.from.username) || ""
	if (senderUsername.toLowerCase() !== BOSS_USERNAME.toLowerCase() && PUBLIC_COMMANDS.indexOf(command) === -1) {
		await sendMessage(
			botToken,
			chatId,
			"*Access Restricted* 🔒\n\nThis bot is configured for private use only. If you believe this is an error, please contact the administrator.",
		)
		return
	}

	// Ensure local session exists
	var session = getSessionWithNotification(botToken, chatId)
	if (!session) {
		createOrRefreshSession(chatId)
	} else {
		// ─── OTP Re-verification Check ──────────────────────────────────
		// If session exists but OTP was previously verified, check if it's still valid
		// or if the user needs to re-verify after a timeout.
		if (session.otpVerified && command !== "/otp") {
			// Check if OTP verification has expired (OTP also has 30-min TTL tied to session)
			if (Date.now() - session.otpVerifiedAt > SESSION_TTL_MS) {
				session.otpVerified = false
				session.otpVerifiedAt = null
				await sendMessage(
					botToken,
					chatId,
					"*Session Expired* ⏰\n\nYour session has expired. Please login again to continue.\n\nUse `/login` to authenticate with your SuperRoo Cloud account.",
				)
				return
			}
		}
	}

	// ─── Rate Limit Check ────────────────────────────────────────────────
	var session = activeSessions.get(chatId)
	var isPremium = !!(session && session.authSession)
	var rateLimit = checkRateLimit(chatId, isPremium)
	if (!rateLimit.allowed) {
		await sendMessage(
			botToken,
			chatId,
			"*Rate Limited* ⏳\n\nYou've sent too many commands. Please wait " + rateLimit.retryAfter + " seconds.",
		)
		return
	}

	// ─── Command Routing ────────────────────────────────────────────────
	// Support both slash commands AND natural language.
	// Slash commands are kept for power users; natural language is the primary interface.

	var _cmdStartTime = Date.now()

	// Handle slash commands explicitly
	try {
		if (command === "/start") {
			logTelegramUsage("/start", chatId, telegramUserId)
			await sendMessage(
				botToken,
				chatId,
				"*OpenClaw* 🤖\n\nWelcome to SuperRoo Cloud! I'm OpenClaw, your AI assistant.\n\n" +
					"*Get Started:*\n" +
					"1. Use `/login` to authenticate with your SuperRoo Cloud account\n" +
					"2. Use `/projects` to view and select a project\n" +
					"3. Just type naturally — I'll understand what you need!\n\n" +
					"*Examples:*\n" +
					"• *\"What's the status of my project?\"* — I'll check your workspace\n" +
					'• *"Fix the login bug"* — I\'ll create a coding task\n' +
					'• *"Deploy the latest changes"* — I\'ll handle deployment\n' +
					'• *"Should I use PostgreSQL or MongoDB?"* — Consultant research & analysis\n' +
					'• *"Show me my projects"* — I\'ll list your projects\n\n' +
					"Just talk to me like a smart assistant! 🚀",
			)
			// Send persistent reply keyboard for click-first GUI
			await sendReplyKeyboard(botToken, chatId, "Use the buttons below for quick actions 👇", [
				["💻 Code", "🔍 Debug"],
				["🧪 Test", "🚀 Deploy"],
				["📋 Recent", "📊 Status"],
				["🧠 Brain", "📋 Menu"],
			])
		} else if (command === "/login") {
			logTelegramUsage("/login", chatId, telegramUserId)
			await handleLogin(botToken, chatId, telegramUserId, isGroup)
		} else if (command === "/help") {
			logTelegramUsage("/help", chatId, telegramUserId)
			await handleHelp(botToken, chatId)
		} else if (command === "/history") {
			logTelegramUsage("/history", chatId, telegramUserId)
			var historyEntries = getCommandHistory(chatId, 15)
			if (historyEntries.length === 0) {
				await sendMessage(botToken, chatId, "*Command History* 📋\n\nNo commands recorded yet.")
			} else {
				var historyLines = ["*Command History* 📋\n"]
				for (var hi = 0; hi < historyEntries.length; hi++) {
					var he = historyEntries[hi]
					var timeAgo = Math.round((Date.now() - he.timestamp) / 1000)
					var timeStr =
						timeAgo < 60
							? timeAgo + "s ago"
							: timeAgo < 3600
								? Math.round(timeAgo / 60) + "m ago"
								: Math.round(timeAgo / 3600) + "h ago"
					historyLines.push("`" + he.command + "` — " + he.text.slice(0, 60) + "  _(" + timeStr + ")_")
				}
				await sendMessage(botToken, chatId, historyLines.join("\n"))
			}
		} else if (command === "/about") {
			logTelegramUsage("/about", chatId, telegramUserId)
			await handleAbout(botToken, chatId)
		} else if (command === "/otp") {
			logTelegramUsage("/otp", chatId, telegramUserId)
			await handleOTP(botToken, chatId, cmdArgs)
		} else if (command === "/specify") {
			logTelegramUsage("/specify", chatId, telegramUserId, { args: cmdArgs.join(" ") })
			await handleSpecify(botToken, chatId, cmdArgs, telegramUserId)
		} else if (command === "/projects") {
			logTelegramUsage("/projects", chatId, telegramUserId)
			await handleProjects(botToken, chatId, telegramUserId)
		} else if (command === "/miniide") {
			logTelegramUsage("/miniide", chatId, telegramUserId)
			await handleMiniIde(botToken, chatId, telegramUserId)
		} else if (command === "/workspace") {
			logTelegramUsage("/workspace", chatId, telegramUserId)
			await handleWorkspace(botToken, chatId, telegramUserId)
		} else if (command === "/session") {
			logTelegramUsage("/session", chatId, telegramUserId)
			await handleSession(botToken, chatId)
		} else if (command === "/settings") {
			logTelegramUsage("/settings", chatId, telegramUserId)
			await handleSettings(botToken, chatId)
		} else if (command === "/agents") {
			logTelegramUsage("/agents", chatId, telegramUserId)
			await handleAgents(botToken, chatId)
		} else if (command === "/brain") {
			logTelegramUsage("/brain", chatId, telegramUserId, { args: cmdArgs.join(" ") })
			await handleBrain(botToken, chatId, cmdArgs, providers || [])
		} else if (command === "/hermes") {
			logTelegramUsage("/hermes", chatId, telegramUserId, { args: cmdArgs.join(" ") })
			await handleHermes(botToken, chatId, cmdArgs, providers || [])
		} else if (command === "/skills") {
			logTelegramUsage("/skills", chatId, telegramUserId)
			await handleSkills(botToken, chatId)
		} else if (command === "/resources") {
			logTelegramUsage("/resources", chatId, telegramUserId)
			await handleResources(botToken, chatId)
		} else if (command === "/upgrade") {
			logTelegramUsage("/upgrade", chatId, telegramUserId, { args: cmdArgs.join(" ") })
			await handleUpgrade(botToken, chatId, cmdArgs, queue, orchestratorBridge)
		} else if (command === "/mcp") {
			logTelegramUsage("/mcp", chatId, telegramUserId, { args: cmdArgs.join(" ") })
			await handleMcp(botToken, chatId, cmdArgs, providers || [])
		} else if (command === "/menu") {
			logTelegramUsage("/menu", chatId, telegramUserId)
			await handleMenu(botToken, chatId)
		} else if (command === "/recent") {
			logTelegramUsage("/recent", chatId, telegramUserId)
			await handleRecent(botToken, chatId)
		} else if (command === "/again") {
			logTelegramUsage("/again", chatId, telegramUserId)
			await handleAgain(botToken, chatId, queue, orchestratorBridge)
		} else if (command === "/code") {
			logTelegramUsage("/code", chatId, telegramUserId, { args: cmdArgs.join(" ") })
			await handleCode(botToken, chatId, cmdArgs, queue, orchestratorBridge)
		} else if (command === "/diff") {
			logTelegramUsage("/diff", chatId, telegramUserId, { args: cmdArgs.join(" ") })
			await handleDiff(botToken, chatId, cmdArgs, orchestratorBridge)
		} else if (command === "/approve") {
			logTelegramUsage("/approve", chatId, telegramUserId, { args: cmdArgs.join(" ") })
			await handleApprove(botToken, chatId, cmdArgs, orchestratorBridge)
		} else if (command === "/deploy") {
			logTelegramUsage("/deploy", chatId, telegramUserId, { args: cmdArgs.join(" ") })
			await handleDeploy(botToken, chatId, cmdArgs, queue, orchestratorBridge)
		} else if (command === "/status") {
			logTelegramUsage("/status", chatId, telegramUserId, { args: cmdArgs.join(" ") })
			await handleStatus(botToken, chatId, cmdArgs, queue)
		} else if (command === "/cancel") {
			logTelegramUsage("/cancel", chatId, telegramUserId)
			// Cancel any pending login flow
			if (pendingEmailOtps.has(chatId)) {
				pendingEmailOtps.delete(chatId)
				scheduleStatePersist()
				await sendMessage(botToken, chatId, "*Login cancelled.*")
			} else {
				await sendMessage(botToken, chatId, "Nothing to cancel.")
			}
		} else if (command === "/debug") {
			logTelegramUsage("/debug", chatId, telegramUserId, { args: cmdArgs.join(" ") })
			await sendChatAction(botToken, chatId, "typing")
			var debugText = cmdArgs.join(" ") || text
			try {
				var debugResult = await tgEndpoints.debugPlan(debugText)
				var debugReply = telegramEngineer.formatDebugPlan(debugResult)

				// If Terminal Brain is available, also run error analysis on the debug text
				if (_terminalBrainAvailable) {
					try {
						var brainAnalyzeResult = await tgEndpoints.brainAnalyze(debugText, chatId)
						if (
							brainAnalyzeResult.ok &&
							brainAnalyzeResult.errors &&
							brainAnalyzeResult.errors.length > 0
						) {
							debugReply += "\n\n" + telegramEngineer.formatBrainErrors(brainAnalyzeResult.errors)
						}
					} catch (brainErr) {
						// Non-fatal — brain analysis is a bonus
						console.log("[telegram] Brain analysis bonus failed:", brainErr.message)
					}
				}

				await sendMessage(botToken, chatId, debugReply)
				await sendActionButtons(botToken, chatId, null)
			} catch (err) {
				logTelegramError("/debug", chatId, telegramUserId, err, { debugText: debugText })
				await sendMessage(botToken, chatId, "*Debug Plan Error* ❌\n\n" + err.message)
			}
		} else if (command === "/fix") {
			logTelegramUsage("/fix", chatId, telegramUserId, { args: cmdArgs.join(" ") })
			await handleFix(botToken, chatId, cmdArgs, providers || [])
		} else if (command === "/file") {
			logTelegramUsage("/file", chatId, telegramUserId, { path: cmdArgs.join(" ") })
			await handleFile(botToken, chatId, cmdArgs)
		} else if (command === "/focus") {
			logTelegramUsage("/focus", chatId, telegramUserId, { path: cmdArgs.join(" ") })
			await handleFocus(botToken, chatId, cmdArgs)
		} else if (command === "/logs") {
			logTelegramUsage("/logs", chatId, telegramUserId, { target: cmdArgs[0] || "all", lines: cmdArgs[1] || 30 })
			await sendChatAction(botToken, chatId, "typing")
			var logTarget = cmdArgs[0] || "all"
			var logLines = parseInt(cmdArgs[1], 10) || 30
			try {
				var logsResult = await tgEndpoints.readLogs(logTarget, logLines)
				var logsReply = telegramEngineer.formatLogsResult(logsResult)
				await sendMessage(botToken, chatId, logsReply)
			} catch (err) {
				logTelegramError("/logs", chatId, telegramUserId, err, { target: logTarget, lines: logLines })
				await sendMessage(botToken, chatId, "*Logs Error* ❌\n\n" + err.message)
			}
		} else if (command === "/tests") {
			logTelegramUsage("/tests", chatId, telegramUserId, { project: cmdArgs[0] || "" })
			await sendChatAction(botToken, chatId, "typing")
			var testProject = cmdArgs[0] || ""
			try {
				var testResult = await tgEndpoints.runTests(testProject)
				var testReply = telegramEngineer.formatTestResult(testResult)
				await sendMessage(botToken, chatId, testReply)
			} catch (err) {
				logTelegramError("/tests", chatId, telegramUserId, err, { project: testProject })
				await sendMessage(botToken, chatId, "*Test Error* ❌\n\n" + err.message)
			}
		} else if (command === "/restart") {
			logTelegramUsage("/restart", chatId, telegramUserId, { target: cmdArgs[0] || "" })
			await sendChatAction(botToken, chatId, "typing")
			var restartTarget = cmdArgs[0]
			if (!restartTarget) {
				await sendMessage(
					botToken,
					chatId,
					"*Restart Worker* 🔄\n\nPlease specify a worker name.\n\nUsage: `/restart <worker-name>`\n\nAllowed workers:\n" +
						[
							"superroo-api",
							"superroo-worker",
							"superroo-worker-2",
							"superroo-worker-3",
							"superroo-worker-4",
							"superroo-worker-5",
						]
							.map(function (w) {
								return "• `" + w + "`"
							})
							.join("\n"),
				)
			} else {
				try {
					var restartResult = await tgEndpoints.restartWorker(restartTarget)
					var restartReply = telegramEngineer.formatRestartResult(restartResult)
					await sendMessage(botToken, chatId, restartReply)
				} catch (err) {
					logTelegramError("/restart", chatId, telegramUserId, err, { target: restartTarget })
					await sendMessage(botToken, chatId, "*Restart Error* ❌\n\n" + err.message)
				}
			}
		} else if (command === "/aceteam") {
			logTelegramUsage("/aceteam", chatId, telegramUserId)
			await sendChatAction(botToken, chatId, "typing")
			try {
				var aceTeamResult = await tgEndpoints.startAceTeam(chatId.toString())
				var aceTeamReply =
					"*Ace Team Activated* 🚀🤖\n\n" +
					"The Super Debug Team is now running in *fully autonomous mode*.\n" +
					"Comprehensive logs, ML insights, and accomplishment reports will be sent here.\n\n" +
					"*What's happening:*\n" +
					"• 🔍 Analyzing repository structure\n" +
					"• 🧪 Running phase-by-phase debugging\n" +
					"• 🤖 ML-driven pattern detection\n" +
					"• 📊 Generating accomplishment reports\n\n" +
					"Use `/aceteam status` to check current status.\n" +
					"Use `/aceteam stop` to stop Ace Team mode and get a final report."
				if (aceTeamResult && aceTeamResult.message) {
					aceTeamReply = aceTeamResult.message
				}
				await sendMessage(botToken, chatId, aceTeamReply)
			} catch (err) {
				logTelegramError("/aceteam", chatId, telegramUserId, err)
				await sendMessage(botToken, chatId, "*Ace Team Error* ❌\n\n" + err.message)
			}
		} else if (command === "/shell") {
			logTelegramUsage("/shell", chatId, telegramUserId, { args: cmdArgs.join(" ") })
			await handleShell(botToken, chatId, cmdArgs)
		} else {
			// ─── Check for Email OTP Login Flow ────────────────────────────
			// If the user is in the middle of an email OTP login, intercept
			// non-command messages and route them to the OTP handlers.
			var emailOtpState = pendingEmailOtps.get(chatId)
			if (emailOtpState) {
				if (emailOtpState.step === "awaiting_email") {
					// Treat non-command text as email input
					await handleEmailOtpLogin(botToken, chatId, text, telegramUserId)
					return
				} else if (emailOtpState.step === "awaiting_otp") {
					// Treat non-command text as OTP code input
					await handleVerifyEmailOtp(botToken, chatId, text, telegramUserId)
					return
				}
			}

			// ─── Natural Language Processing (Primary Interface) ────────────
			// Every message is processed through the AI assistant which:
			// 1. Understands natural language intent (questions, coding, deploy, etc.)
			// 2. Routes to appropriate agents when coding/deploying is needed
			// 3. Answers questions about the system
			// 4. Manages projects, tasks, and workspace

			await sendChatAction(botToken, chatId, "typing")

			// ─── Error Paste Auto-Detection ─────────────────────────────────
			// If the message looks like a stack trace / error output, store it
			// and offer an instant "Debug & Fix" button — no /fix needed.
			if (detectErrorPaste(text)) {
				updateSmartContext(chatId, { lastError: text.slice(0, 1000) })
				await sendInlineKeyboard(
					botToken,
					chatId,
					"🚨 *Looks like an error paste!*\n\nI've saved this error. Tap to auto-fix, or just describe what you want me to do.",
					[
						[
							{ text: "🔧 Auto-Fix This Error", callback_data: "action:fix" },
							{ text: "🔍 Debug Plan", callback_data: "action:debug" },
						],
					],
				)
				return
			}

			// Try natural language instruction routing first (coding tasks, agent commands)
			var handled = await handleNaturalLanguageInstruction(
				botToken,
				chatId,
				text,
				telegramUserId,
				queue,
				providers || [],
				orchestratorBridge,
			)
			if (!handled) {
				// If not routed as a coding instruction, treat as AI assistant conversation
				await handleAsk(botToken, chatId, text.split(/\s+/), providers || [])
			}
		}
		// Record command latency
		var cmdLabel = command || "natural_language"
		logCommandLatency(cmdLabel, Date.now() - _cmdStartTime)
	} catch (err) {
		logTelegramError(command || "unknown", chatId, telegramUserId, err, { text: text.slice(0, 100) })
		console.error("[telegram] Unhandled error in command routing:", err.message)
		// Record error in cross-session user memory
		if (telegramUserId) {
			recordUserError(telegramUserId, err.message)
		}
		// Record error latency
		logCommandLatency((command || "unknown") + "_error", Date.now() - _cmdStartTime)
		try {
			await sendMessage(
				botToken,
				chatId,
				"*Error* ❌\n\nAn unexpected error occurred. The Ace Team has been notified.\n\nError: " + err.message,
			)
		} catch (sendErr) {
			console.error("[telegram] Failed to send error message:", sendErr.message)
		}
	}
}

// ─── Auto-initialize on module load ────────────────────────────────────────
// Load persisted state from disk
loadGroupWorkspaces()
loadConversationHistory()
loadState()
// Register shutdown handlers to persist data before PM2 restarts
registerShutdownHandlers()

module.exports = {
	sendMessage,
	deleteMessage,
	sendChatAction,
	sendInlineKeyboard,
	answerCallbackQuery,
	editMessageText,
	setWebhook,
	getWebhookInfo,
	deleteWebhook,
	handleUpdate,
	handleConsultant,
	detectIntent,
	generateTOTPSecret,
	verifyTOTP,
	generateOTPAuthURI,
	telegramNotifier,
	// Conversation history exports
	loadConversationHistory,
	saveConversationHistory,
	buildConversationSummary,
	getConversationContext,
	addToConversationContext,
	// Mini App workflow handlers
	handlePreviewPlan,
	handleApprovePlan,
	handleViewDiff,
	handleDeployStaging,
	handleDeployProduction,
	handleRollbackCallback,
	// OpenClaw modules
	telegramClassifier,
	telegramPolicy,
	telegramEngineer,
	tgEndpoints,
	// Terminal Brain
	handleBrain,
	// Hermes Claw
	handleHermes,
	handleSkills,
	handleResources,
	// Self-Upgrade
	handleUpgrade,
	// MCP Bridge
	handleMcp,
	// Shutdown handlers
	registerShutdownHandlers,
	// Webhook health check
	startWebhookHealthCheck,
	stopWebhookHealthCheck,
	getWebhookHealth,
	webhookHealth,
	// Command latency tracking
	logCommandLatency,
	getCommandLatency,
	commandLatency,
	// Provider fallback metrics
	logProviderAttempt,
	getProviderMetrics,
	providerMetrics,
	// Cross-session user memory
	getUserContext,
	updateUserContext,
	recordUserIntent,
	recordUserProject,
	recordUserError,
	_userContext,
	// Command history (GAP 4.2)
	recordCommand,
	getCommandHistory,
	_commandHistory,
	// Response cache (GAP 3.4)
	getResponseCacheStats,
}
