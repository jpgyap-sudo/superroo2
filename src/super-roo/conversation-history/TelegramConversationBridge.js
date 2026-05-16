/**
 * SuperRoo — Telegram Conversation Bridge
 *
 * Wires the conversation history system into the Telegram bot.
 * Automatically records all Telegram conversations, detects friction
 * in real-time, and provides monitoring commands for the bot.
 *
 * This is the JavaScript-compatible bridge that integrates with the
 * existing telegramBot.js running on the cloud server.
 */

// ─── Types (matching the TypeScript types for JS consumption) ──────────────

/**
 * @typedef {Object} TelegramMessageRecord
 * @property {string} id - Unique message ID
 * @property {'user'|'assistant'|'system'} role - Message role
 * @property {string} content - Message content
 * @property {string} timestamp - ISO 8601 timestamp
 * @property {number|string} [platformMessageId] - Telegram message_id
 * @property {string} [userId] - Telegram user ID
 * @property {string} [username] - Telegram username
 * @property {boolean} [hadError] - Whether message had an error
 * @property {string} [errorDetails] - Error details
 * @property {number} [latencyMs] - Response latency
 */

// ─── State ─────────────────────────────────────────────────────────────────

const path = require("path")
const fs = require("fs")

const DATA_DIR = process.env.CONVERSATION_HISTORY_DATA_DIR || path.join(__dirname, "..", "..", "..", "cloud", "data")
const HISTORY_FILE = path.join(DATA_DIR, "conversation-history.json")
const MAX_CONVERSATIONS = 10000

/** In-memory cache of the conversation history state */
let state = null
let loaded = false
let monitorTimer = null

// ─── Default State ─────────────────────────────────────────────────────────

function getDefaultState() {
	return {
		schemaVersion: 1,
		conversations: {},
		issues: {},
		errors: {},
		weaknesses: {},
		improvements: {},
		monitor: {
			lastAnalysisAt: null,
			totalRuns: 0,
			totalIssuesDetected: 0,
			totalIssuesResolved: 0,
			totalErrorsDetected: 0,
			totalImprovementsSuggested: 0,
			totalImprovementsImplemented: 0,
			agentVersion: "1.0.0",
		},
		lastUpdatedAt: new Date().toISOString(),
	}
}

// ─── Initialization ────────────────────────────────────────────────────────

function ensureDataDir() {
	if (!fs.existsSync(DATA_DIR)) {
		fs.mkdirSync(DATA_DIR, { recursive: true })
	}
}

function loadState() {
	if (loaded && state) return state
	ensureDataDir()

	try {
		const content = fs.readFileSync(HISTORY_FILE, "utf-8")
		const parsed = JSON.parse(content)
		state = {
			...getDefaultState(),
			...parsed,
			conversations: parsed.conversations || {},
			issues: parsed.issues || {},
			errors: parsed.errors || {},
			weaknesses: parsed.weaknesses || {},
			improvements: parsed.improvements || {},
			monitor: { ...getDefaultState().monitor, ...(parsed.monitor || {}) },
		}
		loaded = true
		console.log("[tg-conversation-bridge] Loaded " + Object.keys(state.conversations).length + " conversations")
	} catch (err) {
		state = getDefaultState()
		loaded = true
		console.log("[tg-conversation-bridge] Initialized fresh state")
	}
	return state
}

function persistState() {
	if (!state) return
	state.lastUpdatedAt = new Date().toISOString()
	ensureDataDir()
	try {
		fs.writeFileSync(HISTORY_FILE, JSON.stringify(state, null, 2), "utf-8")
	} catch (err) {
		console.error("[tg-conversation-bridge] Failed to persist state:", err.message)
	}
}

// ─── UUID Generator ────────────────────────────────────────────────────────

function generateId() {
	return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
		var r = (Math.random() * 16) | 0
		var v = c === "x" ? r : (r & 0x3) | 0x8
		return v.toString(16)
	})
}

// ─── Conversation Management ───────────────────────────────────────────────

/**
 * Start or find a conversation for a Telegram chat.
 * @param {number|string} chatId - Telegram chat ID
 * @param {Object} [options]
 * @param {string} [options.userId] - Telegram user ID
 * @param {string} [options.username] - Telegram username
 * @param {string} [options.title] - Conversation title
 * @param {string} [options.projectId] - Active project ID
 * @param {string} [options.projectName] - Active project name
 * @returns {Object} The conversation record
 */
function startConversation(chatId, options) {
	loadState()

	// Check for existing active conversation for this chat
	var existing = Object.values(state.conversations).find(function (c) {
		return String(c.chatId) === String(chatId) && c.status === "active"
	})

	if (existing) return existing

	// Create new conversation
	var now = new Date().toISOString()
	var id = generateId()
	var conversation = {
		id: id,
		source: "telegram",
		chatId: chatId,
		title: options && options.title ? options.title : "Telegram Conversation " + id.slice(0, 8),
		status: "active",
		startedAt: now,
		updatedAt: now,
		messages: [],
		messageCount: 0,
		userId: options && options.userId ? options.userId : null,
		username: options && options.username ? options.username : null,
		projectId: options && options.projectId ? options.projectId : null,
		projectName: options && options.projectName ? options.projectName : null,
		tags: ["telegram"],
		metadata: {},
	}

	state.conversations[id] = conversation
	persistState()
	return conversation
}

/**
 * Add a message to a conversation.
 * @param {string} conversationId
 * @param {Object} msg - Message data
 * @param {'user'|'assistant'|'system'} msg.role
 * @param {string} msg.content
 * @param {number|string} [msg.platformMessageId]
 * @param {string} [msg.userId]
 * @param {string} [msg.username]
 * @param {boolean} [msg.hadError]
 * @param {string} [msg.errorDetails]
 * @param {number} [msg.latencyMs]
 * @param {number} [msg.tokenCount]
 * @param {string} [msg.model]
 * @returns {Object|null} The message record or null if conversation not found
 */
function addMessage(conversationId, msg) {
	loadState()
	var conversation = state.conversations[conversationId]
	if (!conversation) {
		console.error("[tg-conversation-bridge] Conversation not found: " + conversationId)
		return null
	}

	var record = {
		id: msg.id || generateId(),
		role: msg.role,
		content: msg.content,
		timestamp: msg.timestamp || new Date().toISOString(),
		platformMessageId: msg.platformMessageId,
		userId: msg.userId,
		username: msg.username,
		hadError: msg.hadError || false,
		errorDetails: msg.errorDetails || null,
		latencyMs: msg.latencyMs,
		tokenCount: msg.tokenCount,
		model: msg.model,
	}

	conversation.messages.push(record)
	conversation.messageCount = conversation.messages.length
	conversation.updatedAt = new Date().toISOString()

	if (msg.tokenCount) {
		conversation.totalTokens = (conversation.totalTokens || 0) + msg.tokenCount
	}
	if (msg.latencyMs) {
		conversation.totalLatencyMs = (conversation.totalLatencyMs || 0) + msg.latencyMs
	}

	persistState()
	return record
}

/**
 * End a conversation (mark as completed).
 * @param {string} conversationId
 * @param {'completed'|'abandoned'|'failed'|'resolved'} [status='completed']
 */
function endConversation(conversationId, status) {
	loadState()
	var conversation = state.conversations[conversationId]
	if (!conversation) return

	conversation.status = status || "completed"
	conversation.updatedAt = new Date().toISOString()
	conversation.endedAt = conversation.updatedAt
	persistState()
}

/**
 * Get the active conversation for a chat, or null if none.
 * @param {number|string} chatId
 * @returns {Object|null}
 */
function getActiveConversation(chatId) {
	loadState()
	var results = Object.values(state.conversations).filter(function (c) {
		return String(c.chatId) === String(chatId) && c.status === "active"
	})
	return results.length > 0 ? results[0] : null
}

/**
 * Get recent conversations for a chat.
 * @param {number|string} chatId
 * @param {number} [limit=10]
 * @returns {Array}
 */
function getChatConversations(chatId, limit) {
	loadState()
	var results = Object.values(state.conversations).filter(function (c) {
		return String(c.chatId) === String(chatId)
	})
	results.sort(function (a, b) {
		return b.updatedAt.localeCompare(a.updatedAt)
	})
	return results.slice(0, limit || 10)
}

/**
 * Get the latest assistant message for a chat across recent conversations.
 * Useful for follow-up phrases such as "proceed" after process restarts.
 */
function getLatestAssistantMessage(chatId) {
	var conversations = getChatConversations(chatId, 10)
	for (var i = 0; i < conversations.length; i++) {
		var messages = conversations[i].messages || []
		for (var j = messages.length - 1; j >= 0; j--) {
			if (messages[j].role === "assistant" && messages[j].content) {
				return messages[j]
			}
		}
	}
	return null
}

// ─── Issue Recording ───────────────────────────────────────────────────────

/**
 * Record a detected weakness or issue.
 * @param {Object} issue
 * @param {string} issue.conversationId
 * @param {'info'|'warning'|'error'|'critical'} issue.severity
 * @param {string} issue.category - WeaknessCategory or ImprovementCategory
 * @param {string} issue.title
 * @param {string} issue.description
 * @param {string[]} issue.messageIds
 * @param {string} [issue.suggestion]
 */
function recordIssue(issue) {
	loadState()
	var id = generateId()
	var now = new Date().toISOString()

	var record = {
		id: id,
		conversationId: issue.conversationId,
		severity: issue.severity || "warning",
		category: issue.category || "other",
		title: issue.title,
		description: issue.description,
		messageIds: issue.messageIds || [],
		suggestion: issue.suggestion || null,
		detectedAt: now,
		resolved: false,
	}

	state.issues[id] = record
	state.monitor.totalIssuesDetected++

	// Also add to weaknesses or improvements sub-collection
	var weaknessCategories = [
		"misunderstanding",
		"incomplete_response",
		"incorrect_answer",
		"slow_response",
		"error_prone",
		"lack_of_context",
		"poor_formatting",
		"redundant_question",
		"telegram_friction",
		"coding_error",
		"other",
	]

	if (weaknessCategories.indexOf(issue.category) !== -1) {
		state.weaknesses[id] = { ...record, category: issue.category }
	} else {
		// It's an improvement category
		state.improvements[id] = {
			...record,
			category: issue.category,
			priority: issue.priority || 50,
			estimatedEffort: issue.estimatedEffort || "medium",
		}
		state.monitor.totalImprovementsSuggested++
	}

	persistState()
	return record
}

/**
 * Record an error that occurred during conversation processing.
 * @param {Object} error
 * @param {string} error.conversationId
 * @param {string} error.messageId
 * @param {string} error.errorType
 * @param {string} error.errorMessage
 * @param {string} [error.stackTrace]
 */
function recordError(error) {
	loadState()
	var id = generateId()
	var now = new Date().toISOString()

	var record = {
		id: id,
		conversationId: error.conversationId,
		messageId: error.messageId,
		errorType: error.errorType || "unknown",
		errorMessage: error.errorMessage,
		stackTrace: error.stackTrace || null,
		timestamp: now,
		resolved: false,
	}

	state.errors[id] = record
	state.monitor.totalErrorsDetected++
	persistState()
	return record
}

// ─── Friction Detection (Real-time) ────────────────────────────────────────

/** Patterns that indicate Telegram friction */
var TELEGRAM_FRICTION_PATTERNS = [
	{ pattern: /login|authenticate|session expired|otp/i, severity: "warning" },
	{ pattern: /markdown|parse|formatting|entities/i, severity: "warning" },
	{ pattern: /unknown command|invalid command|not recognized/i, severity: "warning" },
	{ pattern: /timeout|timed? out|taking too long/i, severity: "warning" },
	{ pattern: /group|not in a group|chat not found/i, severity: "error" },
	{ pattern: /webhook|polling|connection/i, severity: "critical" },
]

/** Patterns that indicate coding workflow friction */
var CODING_FRICTION_PATTERNS = [
	{ pattern: /didn't work|not working|failed|error|bug/i, severity: "error" },
	{ pattern: /wrong|incorrect|that's not|not what/i, severity: "warning" },
	{ pattern: /more context|need more|not enough/i, severity: "warning" },
	{ pattern: /repeat|again|still|same issue/i, severity: "warning" },
	{ pattern: /incomplete|partial|missing|not finished/i, severity: "warning" },
]

/**
 * Analyze a message in real-time for friction patterns.
 * Called automatically when a message is recorded.
 * @param {string} conversationId
 * @param {Object} message - The message record
 * @param {Object} [conversation] - The conversation record (optional, for context)
 */
function analyzeMessageForFriction(conversationId, message, conversation) {
	if (message.role !== "user" && message.role !== "system") return

	var content = message.content

	// Check Telegram friction patterns
	for (var i = 0; i < TELEGRAM_FRICTION_PATTERNS.length; i++) {
		var fp = TELEGRAM_FRICTION_PATTERNS[i]
		if (fp.pattern.test(content)) {
			recordIssue({
				conversationId: conversationId,
				severity: fp.severity,
				category: "telegram_friction",
				title: "Telegram friction detected",
				description: "Friction pattern matched: " + content.slice(0, 200),
				messageIds: [message.id],
				suggestion: "Review Telegram integration for this friction point",
			})
			return // One issue per message
		}
	}

	// Check coding friction patterns
	for (var j = 0; j < CODING_FRICTION_PATTERNS.length; j++) {
		var cfp = CODING_FRICTION_PATTERNS[j]
		if (cfp.pattern.test(content)) {
			recordIssue({
				conversationId: conversationId,
				severity: cfp.severity,
				category: "coding_error",
				title: "Coding friction detected",
				description: "Coding friction pattern matched: " + content.slice(0, 200),
				messageIds: [message.id],
				suggestion: "Review coding workflow for this friction point",
			})
			return
		}
	}
}

// ─── High-Level API for telegramBot.js ─────────────────────────────────────

/**
 * Record a user message in the conversation history.
 * @param {number|string} chatId
 * @param {Object} msg
 * @param {string} msg.text - Message text
 * @param {number|string} [msg.messageId] - Telegram message_id
 * @param {string} [msg.userId] - Telegram user ID
 * @param {string} [msg.username] - Telegram username
 * @param {Object} [context] - Additional context
 * @param {string} [context.projectId]
 * @param {string} [context.projectName]
 * @returns {Object} The updated conversation
 */
function recordUserMessage(chatId, msg, context) {
	var conversation = getActiveConversation(chatId)
	if (!conversation) {
		conversation = startConversation(chatId, {
			userId: msg.userId,
			username: msg.username,
			title: msg.text ? msg.text.slice(0, 80) : "Telegram Message",
			projectId: context && context.projectId,
			projectName: context && context.projectName,
		})
	}

	var message = addMessage(conversation.id, {
		role: "user",
		content: msg.text || "",
		platformMessageId: msg.messageId,
		userId: msg.userId,
		username: msg.username,
	})

	// Real-time friction analysis
	if (message) {
		analyzeMessageForFriction(conversation.id, message, conversation)
	}

	return conversation
}

/**
 * Record a bot (assistant) response in the conversation history.
 * @param {number|string} chatId
 * @param {Object} msg
 * @param {string} msg.text - Response text
 * @param {number|string} [msg.messageId] - Telegram message_id
 * @param {number} [msg.latencyMs] - Response generation time
 * @param {number} [msg.tokenCount] - Token count
 * @param {string} [msg.model] - AI model used
 * @param {boolean} [msg.hadError] - Whether there was an error
 * @param {string} [msg.errorDetails] - Error details
 * @returns {Object|null} The message record
 */
function recordBotResponse(chatId, msg) {
	var conversation = getActiveConversation(chatId)
	if (!conversation) {
		console.warn(
			"[tg-conversation-bridge] No active conversation for chat " + chatId + " when recording bot response",
		)
		return null
	}

	return addMessage(conversation.id, {
		role: "assistant",
		content: msg.text || "",
		platformMessageId: msg.messageId,
		latencyMs: msg.latencyMs,
		tokenCount: msg.tokenCount,
		model: msg.model,
		hadError: msg.hadError || false,
		errorDetails: msg.errorDetails || null,
	})
}

/**
 * Record a system event (error, notification) in the conversation history.
 * @param {number|string} chatId
 * @param {string} eventType
 * @param {string} details
 * @param {Object} [extra]
 */
function recordSystemEvent(chatId, eventType, details, extra) {
	var conversation = getActiveConversation(chatId)
	if (!conversation) {
		conversation = startConversation(chatId, {
			title: "System: " + eventType,
		})
	}

	var message = addMessage(conversation.id, {
		role: "system",
		content: "[" + eventType + "] " + details,
		hadError: eventType === "error",
		errorDetails: eventType === "error" ? details : null,
	})

	// Record as error if it's an error event
	if (eventType === "error" && message) {
		recordError({
			conversationId: conversation.id,
			messageId: message.id,
			errorType: extra && extra.errorType ? extra.errorType : "system_error",
			errorMessage: details,
			stackTrace: extra && extra.stackTrace ? extra.stackTrace : null,
		})
	}

	return conversation
}

// ─── Monitoring Commands for Telegram Bot ──────────────────────────────────

/**
 * Generate a friction report for a Telegram chat.
 * @returns {string} Formatted report
 */
function generateFrictionReport() {
	loadState()

	var unresolvedIssues = Object.values(state.issues).filter(function (i) {
		return !i.resolved
	})
	var telegramIssues = unresolvedIssues.filter(function (i) {
		return i.category === "telegram_friction"
	})
	var codingIssues = unresolvedIssues.filter(function (i) {
		return i.category === "coding_error"
	})
	var criticalErrors = Object.values(state.errors).filter(function (e) {
		return !e.resolved
	})
	var totalConversations = Object.keys(state.conversations).length
	var totalErrors = Object.keys(state.errors).length
	var totalWeaknesses = Object.keys(state.weaknesses).length
	var totalImprovements = Object.keys(state.improvements).length

	var lines = [
		"📊 *Conversation History Report*",
		"",
		"*System Overview:*",
		"• Total conversations: " + totalConversations,
		"• Total errors: " + totalErrors,
		"• Total weaknesses: " + totalWeaknesses,
		"• Improvements suggested: " + totalImprovements,
		"",
		"*Unresolved Issues:*",
		"• Telegram friction: " + telegramIssues.length,
		"• Coding friction: " + codingIssues.length,
		"• Critical errors: " + criticalErrors.length,
		"• Other issues: " + (unresolvedIssues.length - telegramIssues.length - codingIssues.length),
		"",
	]

	if (telegramIssues.length > 0) {
		lines.push("*Recent Telegram Friction Issues:*")
		var recentTelegram = telegramIssues.slice(0, 5)
		for (var i = 0; i < recentTelegram.length; i++) {
			lines.push(i + 1 + ". [" + recentTelegram[i].severity + "] " + recentTelegram[i].title)
		}
		lines.push("")
	}

	if (codingIssues.length > 0) {
		lines.push("*Recent Coding Friction Issues:*")
		var recentCoding = codingIssues.slice(0, 5)
		for (var j = 0; j < recentCoding.length; j++) {
			lines.push(j + 1 + ". [" + recentCoding[j].severity + "] " + recentCoding[j].title)
		}
		lines.push("")
	}

	if (criticalErrors.length > 0) {
		lines.push("*⚠️ Critical Errors:*")
		for (var k = 0; k < Math.min(criticalErrors.length, 3); k++) {
			lines.push("• " + criticalErrors[k].errorType + ": " + criticalErrors[k].errorMessage.slice(0, 100))
		}
		lines.push("")
	}

	lines.push("*Recommendations:*")
	if (telegramIssues.length > 5) {
		lines.push("• High Telegram friction — review auth flow, message formatting, and command routing")
	}
	if (codingIssues.length > 5) {
		lines.push("• High coding friction — improve context gathering and error handling")
	}
	if (criticalErrors.length > 0) {
		lines.push("• Critical errors need immediate attention — check system logs")
	}
	if (telegramIssues.length <= 5 && codingIssues.length <= 5) {
		lines.push("• System is running smoothly — continue monitoring")
	}

	return lines.join("\n")
}

/**
 * Get quick stats for dashboard display.
 * @returns {Object}
 */
function getQuickStats() {
	loadState()
	var unresolvedIssues = Object.values(state.issues).filter(function (i) {
		return !i.resolved
	})

	return {
		totalConversations: Object.keys(state.conversations).length,
		totalErrors: Object.keys(state.errors).length,
		totalWeaknesses: Object.keys(state.weaknesses).length,
		totalImprovements: Object.keys(state.improvements).length,
		unresolvedIssues: unresolvedIssues.length,
		telegramFrictionIssues: unresolvedIssues.filter(function (i) {
			return i.category === "telegram_friction"
		}).length,
		codingFrictionIssues: unresolvedIssues.filter(function (i) {
			return i.category === "coding_error"
		}).length,
		lastAnalysisAt: state.monitor.lastAnalysisAt,
	}
}

/**
 * Run a lightweight runtime analysis pass for the plain-JS cloud process.
 * Deeper offline analysis remains available through ConversationMonitorAgent.ts.
 */
function runRuntimeAnalysis() {
	loadState()
	state.monitor.lastAnalysisAt = new Date().toISOString()
	state.monitor.totalRuns++
	persistState()
	return getQuickStats()
}

/**
 * Start periodic runtime monitoring in the cloud API process.
 */
function startRuntimeMonitor(intervalMs) {
	if (monitorTimer) return monitorTimer
	var ms = intervalMs || 60 * 60 * 1000
	runRuntimeAnalysis()
	monitorTimer = setInterval(function () {
		try {
			runRuntimeAnalysis()
		} catch (err) {
			console.error("[tg-conversation-bridge] Runtime analysis failed:", err.message)
		}
	}, ms)
	if (typeof monitorTimer.unref === "function") monitorTimer.unref()
	return monitorTimer
}

function stopRuntimeMonitor() {
	if (monitorTimer) {
		clearInterval(monitorTimer)
		monitorTimer = null
	}
}

// ─── Exports ───────────────────────────────────────────────────────────────

module.exports = {
	// Core management
	startConversation,
	addMessage,
	endConversation,
	getActiveConversation,
	getChatConversations,
	getLatestAssistantMessage,

	// Recording
	recordUserMessage,
	recordBotResponse,
	recordSystemEvent,
	recordIssue,
	recordError,

	// Monitoring
	generateFrictionReport,
	getQuickStats,
	analyzeMessageForFriction,
	runRuntimeAnalysis,
	startRuntimeMonitor,
	stopRuntimeMonitor,

	// State
	loadState,
	getDefaultState,
}
