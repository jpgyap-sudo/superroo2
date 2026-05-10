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

// ─── Configuration ─────────────────────────────────────────────────────────

const TELEGRAM_API_BASE = "https://api.telegram.org/bot"

/** The bot username (without @) for mention detection */
const BOT_USERNAME = "superroo_bot"

/** Boss-only mode: only @jpgy888 can use the bot */
const BOSS_USERNAME = "jpgy888"

/** Commands that don't require an active Telegram session */
const PUBLIC_COMMANDS = ["/start", "/login", "/help", "/about", "/debug", "/logs", "/tests", "/restart"]

/** Mini App URL for login */
const MINI_APP_URL = "https://dev.abcx124.xyz/telegram-miniapp"

/** Telegram message length limit (Telegram API hard limit) */
const TELEGRAM_MAX_MESSAGE_LENGTH = 4096

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
 * Sends a message to a Telegram chat, automatically splitting long messages
 * into multiple API calls to respect Telegram's 4096-character limit.
 * Each chunk is sent as a separate message in sequence.
 */
async function sendMessage(botToken, chatId, text, opts) {
	opts = opts || {}
	var chunks = splitLongMessage(text)
	const url = TELEGRAM_API_BASE + botToken + "/sendMessage"

	for (var ci = 0; ci < chunks.length; ci++) {
		var chunk = chunks[ci]
		const body = {
			chat_id: chatId,
			text: chunk,
			parse_mode: opts.parseMode || "Markdown",
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
				console.error("[telegram] sendMessage error: " + res.status + " " + err.slice(0, 200))
			}
		} catch (err) {
			console.error("[telegram] sendMessage network error:", err.message)
		}
		// Small delay between chunks to avoid rate limiting
		if (ci < chunks.length - 1) {
			await new Promise(function (resolve) {
				setTimeout(resolve, 200)
			})
		}
	}
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
		const res = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				url: webhookUrl,
				allowed_updates: ["message", "callback_query"],
			}),
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
 * Builds a concise conversation summary string from recent history.
 * Used to pass context to BullMQ worker jobs that don't have access to the
 * in-memory conversationHistory Map.
 * @param {number|string} chatId
 * @param {number} maxMessages - Max recent messages to summarize
 * @returns {string} A plain-text summary of the conversation
 */
function buildConversationSummary(chatId, maxMessages) {
	if (maxMessages === undefined) maxMessages = 10
	var history = conversationHistory.get(chatId)
	if (!history || history.length === 0) return ""

	var recent = history.slice(-maxMessages)
	var lines = []
	for (var i = 0; i < recent.length; i++) {
		var msg = recent[i]
		var prefix = msg.role === "user" ? "User" : "Assistant"
		var content = msg.content.slice(0, 200) // Truncate long messages
		lines.push(prefix + ": " + content)
	}
	return "=== Recent Conversation History ===\n" + lines.join("\n") + "\n=== End of History ==="
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
		"- Learn from conversations to improve future responses\n\n" +
		"## Conversation Flow Guidelines\n" +
		"- You have access to the FULL conversation history. Read it carefully before responding.\n" +
		'- Reference previous messages naturally: "As you mentioned earlier...", "Following up on your previous question about...", "Building on what we discussed..."\n' +
		'- If the user says "this", "that", "it", or refers to something without context, look at the conversation history to understand what they mean.\n' +
		"- Maintain continuity: if you gave advice in a previous message, refer back to it when the user follows up.\n" +
		"- Ask clarifying questions if the user's intent is ambiguous, but first check if the answer is in the conversation history.\n" +
		"- When the user asks about a task that was just created (coding, debugging, deploy), acknowledge it and provide status.\n" +
		"- Be conversational and natural — don't restart the conversation from scratch each time.\n\n" +
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
async function askAI(message, providers, chatId) {
	// Build messages array with conversation context if chatId is provided
	var messages = []

	// System prompt with full knowledge
	messages.push({
		role: "system",
		content: buildSystemPrompt(),
	})

	// Add conversation history if chatId is provided
	if (chatId !== undefined && chatId !== null) {
		var context = getConversationContext(chatId)
		for (var ci = 0; ci < context.length; ci++) {
			messages.push({
				role: context[ci].role,
				content: context[ci].content,
			})
		}
	}

	// Add current user message
	messages.push({ role: "user", content: message })

	// Try each provider in order
	for (var i = 0; i < providers.length; i++) {
		var provider = providers[i]
		if (!provider.apiKey) continue
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
				signal: AbortSignal.timeout(60_000),
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
				continue
			}
			var data = await res.json()
			var reply = data.choices[0].message.content || "(no response)"

			// Record to conversation context
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

			return reply
		} catch (err) {
			console.error("[telegram] askAI network error with " + provider.providerId + ":", err.message)
			continue
		}
	}
	return "Sorry, I couldn't reach any AI provider right now. Please check that an API key is configured and working in the dashboard (API Keys page)."
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

	var reply = await askAI(question, providers, chatId)

	// sendMessage auto-splits long messages to respect Telegram's 4096-char limit
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

/**
 * Handles /code <instruction> - creates a coding task.
 */
async function handleCode(botToken, chatId, args, queue) {
	var instruction = args.join(" ")
	if (!instruction) {
		await sendMessage(
			botToken,
			chatId,
			"Please provide an instruction.\n\nExample: `/code fix the login timeout bug`",
		)
		return
	}

	var taskId =
		"TG-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).slice(2, 6).toUpperCase()
	var branchName = "tg/" + taskId.toLowerCase()

	// Build conversation summary for the worker so it has context
	var conversationSummary = buildConversationSummary(chatId)

	var job = await queue.add("telegram-" + taskId, {
		task: instruction,
		agentId: "coder",
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
		instruction: instruction,
		status: "queued",
		branchName: branchName,
		changedFiles: 0,
		linesAdded: 0,
		createdAt: new Date().toISOString(),
		jobId: job.id,
	})

	// Send rich notification with action buttons
	await telegramNotifier.sendTaskStarted(botToken, chatId, taskId, instruction, "coder")
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
async function handleDiff(botToken, chatId, args) {
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

/**
 * Handles /approve [taskId] - approves a pending task.
 */
async function handleApprove(botToken, chatId, args) {
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
		agentId: "tester",
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
async function handleDeploy(botToken, chatId, args, queue) {
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
		agentId: "deployChecker",
		commands: [],
		network: "none",
	})

	task.status = "deploying"

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
	await sendMessage(
		botToken,
		chatId,
		"*Recent Logs (last " +
			limit +
			")*\n\nLogs are available in the dashboard at https://dev.abcx124.xyz/logs\n\nUse `/status` to check system health.",
	)
}

// ─── New Auth-Integrated Command Handlers ────────────────────────────────

/**
 * Handles /login - Email OTP login flow.
 * Asks the user for their email, sends an OTP, and verifies it.
 * Auto-deletes sensitive messages after successful login.
 */
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
	}

	// Mark that we're awaiting email input
	pendingEmailOtps.set(chatId, { step: "awaiting_email", messageIds: [] })

	var sentMsg = await sendMessage(
		botToken,
		chatId,
		"*Login via Email OTP* 📧\n\nPlease enter the email address associated with your SuperRoo Cloud account.\n\nI'll send a one-time password (OTP) to that email for verification.\n\n*Tip:* Messages with sensitive info will be auto-deleted after login.\n\n_(Type your email address below, or use `/cancel` to abort)_",
	)
	if (sentMsg && sentMsg.result && sentMsg.result.message_id) {
		if (!existingState) existingState = { step: "awaiting_email", messageIds: [] }
		existingState.messageIds.push(sentMsg.result.message_id)
		pendingEmailOtps.set(chatId, existingState)
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
		return
	}

	// Generate a 6-digit OTP
	var otp = Math.floor(100000 + Math.random() * 900000).toString()

	// Store the pending OTP
	var state = pendingEmailOtps.get(chatId) || { step: "awaiting_email", messageIds: [] }
	state.step = "awaiting_otp"
	state.email = email
	state.otp = otp
	state.createdAt = Date.now()
	state.telegramUserId = telegramUserId
	pendingEmailOtps.set(chatId, state)

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
				"*No Projects Found*\n\nYou don't have any projects yet. Create one in the dashboard at https://dev.abcx124.xyz\n\nUse `/code <instruction>` to start a coding task in the default workspace.",
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
			"https://dev.abcx124.xyz/settings\n\n" +
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
				"*No Projects Found*\n\nYou don't have any projects yet. Create one in the SuperRoo Cloud Dashboard.\n\nhttps://dev.abcx124.xyz",
			)
			return
		}

		if (projects.length === 1) {
			// Single project — open Mini IDE directly
			var project = projects[0]
			var miniIdeUrl =
				"https://dev.abcx124.xyz/tg?workspace=" +
				encodeURIComponent(project.id || project.project_id) +
				"&chat_id=" +
				chatId
			await sendInlineKeyboard(
				botToken,
				chatId,
				"*Mini IDE* 🚀\n\nActive workspace: *" +
					(project.name || project.project_name) +
					"*\n\nOpen the Mini IDE to code with a full editor, file browser, AI assistant, and file uploads.",
				[
					[{ text: "🚀 Open Mini IDE", web_app: miniIdeUrl }],
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
			"*Dashboard:* https://dev.abcx124.xyz\n" +
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
					"You don't have any projects yet. Create one in the dashboard at https://dev.abcx124.xyz",
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
			const miniIdeUrl =
				"https://dev.abcx124.xyz/tg?workspace=" + encodeURIComponent(projectId) + "&chat_id=" + chatId
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
function detectIntent(text) {
	var lower = text.toLowerCase()

	// Consultant / Research intent — questions about viability, analysis, research, best practices
	if (
		lower.includes("research") ||
		lower.includes("analyze") ||
		lower.includes("analysis") ||
		lower.includes("is it good") ||
		lower.includes("should i") ||
		lower.includes("compare") ||
		lower.includes("comparison") ||
		lower.includes("viability") ||
		lower.includes("feasibility") ||
		lower.includes("pros and cons") ||
		lower.includes("advantages") ||
		lower.includes("disadvantages") ||
		lower.includes("best practice") ||
		lower.includes("recommend") ||
		lower.includes("recommendation") ||
		lower.includes("evaluate") ||
		lower.includes("evaluation") ||
		lower.includes("what is the best") ||
		lower.includes("which one") ||
		lower.includes("how does") ||
		lower.includes("explain") ||
		lower.includes("what is") ||
		lower.includes("tell me about") ||
		lower.includes("upgrade skill") ||
		lower.includes("upgrade my skill") ||
		lower.includes("consultant") ||
		lower.includes("consult") ||
		lower.includes("advise") ||
		lower.includes("advice") ||
		lower.includes("guidance") ||
		lower.includes("strategy") ||
		lower.includes("strategic") ||
		lower.includes("architecture") ||
		lower.includes("design pattern") ||
		lower.includes("technology stack") ||
		lower.includes("tech stack") ||
		lower.includes("overview") ||
		lower.includes("summary of") ||
		lower.includes("deep dive") ||
		lower.includes("learn about")
	) {
		return "consultant"
	}

	// Debugging intent
	if (
		lower.includes("debug") ||
		lower.includes("fix bug") ||
		lower.includes("error") ||
		lower.includes("issue") ||
		lower.includes("not working") ||
		lower.includes("broken") ||
		lower.includes("crash") ||
		lower.includes("bug")
	) {
		return "debugger"
	}

	// Deployment intent
	if (
		lower.includes("deploy") ||
		lower.includes("release") ||
		lower.includes("publish") ||
		lower.includes("ship") ||
		lower.includes("go live")
	) {
		return "deployer"
	}

	// Testing intent
	if (
		lower.includes("test") ||
		lower.includes("run test") ||
		lower.includes("check test") ||
		lower.includes("unit test") ||
		lower.includes("e2e")
	) {
		return "tester"
	}

	// Coding intent — creating/modifying code
	if (
		lower.includes("code") ||
		lower.includes("implement") ||
		lower.includes("add feature") ||
		lower.includes("create") ||
		lower.includes("write") ||
		lower.includes("build") ||
		lower.includes("make") ||
		lower.includes("develop") ||
		lower.includes("refactor") ||
		lower.includes("update") ||
		lower.includes("change") ||
		lower.includes("modify") ||
		lower.includes("improve") ||
		lower.includes("fix") ||
		lower.includes("add ") ||
		lower.includes("remove ")
	) {
		return "coder"
	}

	// Default: just asking a question
	return "ask"
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
async function handleNaturalLanguageInstruction(botToken, chatId, text, telegramUserId, queue, providers) {
	var authSession = await checkAuthSession(telegramUserId, chatId)
	if (!authSession) {
		// If not authenticated, treat as /ask
		return false
	}

	// ─── OpenClaw: LLM-Powered Intent Classification ────────────────────
	// Use the classifier to detect intent with LLM, fallback to keyword matching.
	var classified = await telegramClassifier.classifyIntent(text, providers || [])
	var intentKind = classified.kind
	var confidence = classified.confidence

	console.log(
		"[telegram] OpenClaw classified '" +
			text.slice(0, 60) +
			"' as " +
			intentKind +
			" (confidence: " +
			confidence.toFixed(2) +
			")",
	)

	// ─── Chat Intent ────────────────────────────────────────────────────
	// Handle questions directly with the enhanced AI
	if (intentKind === "chat") {
		await sendChatAction(botToken, chatId, "typing")
		console.log("[telegram] AI query from " + chatId + ": " + text.slice(0, 100))
		var reply = await askAI(text, providers || [], chatId)
		await sendMessage(botToken, chatId, reply)
		return true
	}

	// ─── OpenClaw: Policy Check ─────────────────────────────────────────
	// Check if the action can run without approval.
	// Blocked actions (deploy, delete_data, shell) require dashboard approval.
	if (!telegramPolicy.canRunWithoutApproval(intentKind)) {
		var blockedMsg = telegramPolicy.getBlockedReason(intentKind)
		await sendMessage(botToken, chatId, blockedMsg)
		return true
	}

	// ─── OpenClaw: Direct Endpoint Actions ──────────────────────────────
	// For debug_plan, read_logs, run_tests, restart_worker — execute directly
	// without going through the BullMQ queue. These are fast, read-only operations.

	if (intentKind === "debug_plan") {
		await sendChatAction(botToken, chatId, "typing")
		try {
			var debugResult = await tgEndpoints.debugPlan(text)
			var debugReply = await telegramEngineer.seniorEngineerReply(
				"Summarize this debug plan for the user:\n" + JSON.stringify(debugResult, null, 2),
				providers || [],
			)
			await sendMessage(botToken, chatId, debugReply)
		} catch (err) {
			console.error("[telegram] debug_plan error:", err.message)
			await sendMessage(
				botToken,
				chatId,
				telegramEngineer.formatDebugPlan({
					incidentId: "ERR-" + Date.now().toString(36).toUpperCase(),
					phases: ["Error creating debug plan: " + err.message],
				}),
			)
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
			console.error("[telegram] read_logs error:", err.message)
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
			console.error("[telegram] run_tests error:", err.message)
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
			console.error("[telegram] restart_worker error:", err.message)
			await sendMessage(botToken, chatId, "*Restart Error* ❌\n\n" + err.message)
		}
		return true
	}

	// ─── Legacy: Agent Routing via BullMQ ───────────────────────────────
	// For create_branch, create_pr, and other complex actions that need
	// the full agent pipeline, fall through to the existing BullMQ routing.

	// Map OpenClaw kinds to legacy agent IDs
	var openclawToLegacy = {
		create_branch: "coder",
		create_pr: "coder",
		deploy: "deployer",
		delete_data: "deployer",
		shell: "coder",
	}
	var legacyIntent = openclawToLegacy[intentKind] || "coder"

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
								"[telegram] Auto-selected bound workspace '" + boundWorkspace + "' for group " + chatId,
							)
						} catch (selErr) {
							console.error("[telegram] Failed to auto-select bound workspace:", selErr.message)
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
			console.error("[telegram] Failed to log orchestrator instruction:", logErr.message)
		}

		// Create a task with the appropriate agent
		var taskId =
			"TG-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).slice(2, 6).toUpperCase()
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
		console.error("[telegram] handleNaturalLanguageInstruction error:", err.message)
	}

	return false
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
			"   Dashboard: https://dev.abcx124.xyz\n" +
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
			"*Dashboard:* https://dev.abcx124.xyz",
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
			"`/diff <taskId>` - Show changed files\n" +
			"`/test <taskId>` - Run test suite\n" +
			"`/approve <taskId>` - Approve pending changes\n" +
			"`/deploy <taskId>` - Deploy approved build (OTP required)\n\n" +
			"*OpenClaw AI Assistant*\n" +
			"`/debug <description>` - Create a structured debug plan\n" +
			"`/logs [target] [lines]` - Read PM2/Docker logs\n" +
			"`/tests [project]` - Run tests for a project\n" +
			"`/restart <worker>` - Restart a whitelisted PM2 worker\n\n" +
			"*AI Assistant (Natural Language)*\n" +
			"• Just type naturally to chat with the AI assistant\n" +
			'• Say *"debug this issue"* or *"check the logs"* for smart dispatch\n' +
			'• Say *"fix this bug"* or *"code this feature"* to trigger cloud agents\n' +
			'• Say *"deploy"* or *"test"* to run those actions\n' +
			'• Ask *"should I use X?"* or *"analyze Y"* for expert consultant analysis\n' +
			"• In groups, I respond to every message automatically — no need to tag me!\n\n" +
			"*System*\n" +
			"`/status [taskId]` - Check system or task status\n" +
			"`/settings` - Account and system settings\n" +
			"`/about` - Bot information\n" +
			"`/help` - Show this message\n\n" +
			"*Dashboard:* https://dev.abcx124.xyz\n" +
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
async function handleUpdate(update, botToken, queue, providers) {
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

	// Handle callback queries (inline keyboard button presses)
	if (update && update.callback_query) {
		var cq = update.callback_query
		var cqChatId = cq.message.chat.id
		var cqMessageId = cq.message.message_id
		var cqData = cq.data || ""
		var cqUserId = cq.from.id

		// Answer the callback query to remove loading state
		await answerCallbackQuery(botToken, cq.id)

		// Handle project selection
		if (cqData.startsWith("project:")) {
			var projectId = cqData.slice(8)
			await handleProjectSelect(botToken, cqChatId, cqMessageId, projectId, cqUserId)
			return
		}

		// Handle notification button presses (approve/reject/diff/status/logs/retry)
		if (cqData.startsWith("notify:")) {
			await telegramNotifier.handleNotificationCallback(botToken, cq)
			return
		}

		// ─── Mini App Workflow Callbacks ────────────────────────────────────

		// preview_plan:<taskId> — Show plan preview for a task
		if (cqData.startsWith("preview_plan:")) {
			var pptaskId = cqData.slice(13)
			await handlePreviewPlan(botToken, cqChatId, cqMessageId, pptaskId)
			return
		}

		// approve_plan:<taskId> — Approve a plan (moves task to plan_approved state)
		if (cqData.startsWith("approve_plan:")) {
			var aptaskId = cqData.slice(13)
			await handleApprovePlan(botToken, cqChatId, cqMessageId, aptaskId)
			return
		}

		// view_diff:<taskId> — Show diff for a task
		if (cqData.startsWith("view_diff:")) {
			var vdtaskId = cqData.slice(10)
			await handleViewDiff(botToken, cqChatId, cqMessageId, vdtaskId)
			return
		}

		// deploy_staging:<taskId> — Deploy to staging environment
		if (cqData.startsWith("deploy_staging:")) {
			var dstaskId = cqData.slice(15)
			await handleDeployStaging(botToken, cqChatId, cqMessageId, dstaskId)
			return
		}

		// deploy_production:<taskId> — Deploy to production (requires OTP)
		if (cqData.startsWith("deploy_production:")) {
			var dptaskId = cqData.slice(18)
			await handleDeployProduction(botToken, cqChatId, cqMessageId, dptaskId)
			return
		}

		// rollback:<savepointId> — Rollback to a savepoint
		if (cqData.startsWith("rollback:")) {
			var rbsavepointId = cqData.slice(9)
			await handleRollbackCallback(botToken, cqChatId, cqMessageId, rbsavepointId)
			return
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
		text = "[Quoted message: " + quotedText.slice(0, 500) + "]\n\nUser reply: " + text
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

	// Parse command and arguments
	var args = text.split(/\s+/)
	var command = args[0] ? args[0].toLowerCase() : ""
	var cmdArgs = args.slice(1)
	console.log("[telegram] Message from " + telegramUserId + " in chat " + chatId + ": " + text.slice(0, 80))

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

	// ─── Command Routing ────────────────────────────────────────────────
	// Support both slash commands AND natural language.
	// Slash commands are kept for power users; natural language is the primary interface.

	// Handle slash commands explicitly
	if (command === "/start") {
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
	} else if (command === "/login") {
		await handleLogin(botToken, chatId, telegramUserId, isGroup)
	} else if (command === "/help") {
		await handleHelp(botToken, chatId)
	} else if (command === "/about") {
		await handleAbout(botToken, chatId)
	} else if (command === "/otp") {
		await handleOTP(botToken, chatId, cmdArgs)
	} else if (command === "/specify") {
		await handleSpecify(botToken, chatId, cmdArgs, telegramUserId)
	} else if (command === "/cancel") {
		// Cancel any pending login flow
		if (pendingEmailOtps.has(chatId)) {
			pendingEmailOtps.delete(chatId)
			await sendMessage(botToken, chatId, "*Login cancelled.*")
		} else {
			await sendMessage(botToken, chatId, "Nothing to cancel.")
		}
	} else if (command === "/debug") {
		// ─── OpenClaw: Debug Plan ──────────────────────────────────────
		// Creates a structured debug plan for an issue description.
		await sendChatAction(botToken, chatId, "typing")
		var debugText = cmdArgs.join(" ") || text
		try {
			var debugResult = await tgEndpoints.debugPlan(debugText)
			var debugReply = telegramEngineer.formatDebugPlan(debugResult)
			await sendMessage(botToken, chatId, debugReply)
		} catch (err) {
			console.error("[telegram] /debug error:", err.message)
			await sendMessage(botToken, chatId, "*Debug Plan Error* ❌\n\n" + err.message)
		}
	} else if (command === "/logs") {
		// ─── OpenClaw: Read Logs ──────────────────────────────────────
		// Reads PM2/Docker logs. Optional: /logs <target> [lines]
		await sendChatAction(botToken, chatId, "typing")
		var logTarget = cmdArgs[0] || "all"
		var logLines = parseInt(cmdArgs[1], 10) || 30
		try {
			var logsResult = await tgEndpoints.readLogs(logTarget, logLines)
			var logsReply = telegramEngineer.formatLogsResult(logsResult)
			await sendMessage(botToken, chatId, logsReply)
		} catch (err) {
			console.error("[telegram] /logs error:", err.message)
			await sendMessage(botToken, chatId, "*Logs Error* ❌\n\n" + err.message)
		}
	} else if (command === "/tests") {
		// ─── OpenClaw: Run Tests ──────────────────────────────────────
		// Runs tests for a project. Optional: /tests <project>
		await sendChatAction(botToken, chatId, "typing")
		var testProject = cmdArgs[0] || ""
		try {
			var testResult = await tgEndpoints.runTests(testProject)
			var testReply = telegramEngineer.formatTestResult(testResult)
			await sendMessage(botToken, chatId, testReply)
		} catch (err) {
			console.error("[telegram] /tests error:", err.message)
			await sendMessage(botToken, chatId, "*Test Error* ❌\n\n" + err.message)
		}
	} else if (command === "/restart") {
		// ─── OpenClaw: Restart Worker ──────────────────────────────────
		// Restarts a whitelisted PM2 worker. Usage: /restart <worker-name>
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
				console.error("[telegram] /restart error:", err.message)
				await sendMessage(botToken, chatId, "*Restart Error* ❌\n\n" + err.message)
			}
		}
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

		// Try natural language instruction routing first (coding tasks, agent commands)
		var handled = await handleNaturalLanguageInstruction(
			botToken,
			chatId,
			text,
			telegramUserId,
			queue,
			providers || [],
		)
		if (!handled) {
			// If not routed as a coding instruction, treat as AI assistant conversation
			await handleAsk(botToken, chatId, text.split(/\s+/), providers || [])
		}
	}
}

// ─── Auto-initialize on module load ────────────────────────────────────────
// Load persisted state from disk
loadGroupWorkspaces()
loadConversationHistory()

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
}
