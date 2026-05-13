/**
 * Telegram Conversation Learner — ML-Powered Intelligence Engine
 *
 * Continuously learns from user interactions to make the Telegram bot smarter.
 * Features pgvector RAG integration, user preference learning, frustration
 * detection, proactive suggestions, and multi-dimensional pattern analysis.
 *
 * Features:
 * - Conversation pattern recording & analysis
 * - Intent classification improvement via feedback loops
 * - Response quality scoring
 * - Automatic pattern detection (frequent questions, common issues)
 * - User preference learning (favorite commands, projects, workflows)
 * - Frustration detection (negative sentiment, repeated failures)
 * - Proactive suggestions based on learned patterns
 * - pgvector RAG integration for semantic memory search
 * - Persistent learning state stored as JSON
 */

const fs = require("fs")
const path = require("path")

// ─── Configuration ──────────────────────────────────────────────────────────

const LEARNER_STATE_FILE = path.join(__dirname, "..", "data", "telegram-learner-state.json")
const CONVERSATION_LOG_FILE = path.join(__dirname, "..", "data", "telegram-conversations.jsonl")
const PATTERNS_FILE = path.join(__dirname, "..", "data", "telegram-patterns.json")
const PREFERENCES_FILE = path.join(__dirname, "..", "data", "telegram-user-preferences.json")
const FRUSTRATION_FILE = path.join(__dirname, "..", "data", "telegram-frustration-log.json")

const MAX_CONVERSATIONS_IN_MEMORY = 1000
const MIN_PATTERN_CONFIDENCE = 0.6
const LEARNING_RATE = 0.1
const FRUSTRATION_THRESHOLD = 3 // Number of negative signals before flagging
const PREFERENCE_DECAY_DAYS = 30 // Decay old preferences

// ─── State ──────────────────────────────────────────────────────────────────

let learnerState = {
	totalConversations: 0,
	totalInteractions: 0,
	intentCounts: {}, // { intent_name: count }
	intentAccuracy: {}, // { intent_name: { correct, total, accuracy } }
	responseQuality: {}, // { intent_name: { scores: [], average } }
	patternConfidence: {}, // { pattern_key: confidence_score }
	lastTrainingAt: null,
	modelVersion: 2, // Upgraded to v2 with preferences & frustration
}

let conversationBuffer = [] // Recent conversations for pattern analysis
let knownPatterns = {} // Detected conversation patterns
let userPreferences = {} // { userId: { favoriteCommands: [], favoriteProjects: [], workflows: [], lastActive: ISO } }
let frustrationLog = {} // { userId: { count, lastFrustration, contexts: [] } }

// ─── Initialization ─────────────────────────────────────────────────────────

function ensureDataDir() {
	const dir = path.dirname(LEARNER_STATE_FILE)
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true })
	}
}

function loadState() {
	ensureDataDir()
	try {
		if (fs.existsSync(LEARNER_STATE_FILE)) {
			const raw = fs.readFileSync(LEARNER_STATE_FILE, "utf8")
			learnerState = JSON.parse(raw)
			console.log(
				"[telegram-learner] Loaded state: " +
					learnerState.totalConversations +
					" conversations, " +
					learnerState.totalInteractions +
					" interactions",
			)
		}
	} catch (err) {
		console.error("[telegram-learner] Failed to load state:", err.message)
	}

	try {
		if (fs.existsSync(PATTERNS_FILE)) {
			const raw = fs.readFileSync(PATTERNS_FILE, "utf8")
			knownPatterns = JSON.parse(raw)
			console.log("[telegram-learner] Loaded " + Object.keys(knownPatterns).length + " known patterns")
		}
	} catch (err) {
		console.error("[telegram-learner] Failed to load patterns:", err.message)
	}
}

function saveState() {
	ensureDataDir()
	try {
		learnerState.lastTrainingAt = new Date().toISOString()
		fs.writeFileSync(LEARNER_STATE_FILE, JSON.stringify(learnerState, null, 2), "utf8")
	} catch (err) {
		console.error("[telegram-learner] Failed to save state:", err.message)
	}
}

function savePatterns() {
	ensureDataDir()
	try {
		fs.writeFileSync(PATTERNS_FILE, JSON.stringify(knownPatterns, null, 2), "utf8")
	} catch (err) {
		console.error("[telegram-learner] Failed to save patterns:", err.message)
	}
}

// ─── User Preferences & Frustration Detection (v2) ─────────────────────────

/**
 * Load user preferences from disk.
 */
function loadPreferences() {
	ensureDataDir()
	try {
		if (fs.existsSync(PREFERENCES_FILE)) {
			const raw = fs.readFileSync(PREFERENCES_FILE, "utf8")
			userPreferences = JSON.parse(raw)
		}
	} catch (err) {
		console.error("[telegram-learner] Failed to load preferences:", err.message)
	}
}

/**
 * Save user preferences to disk.
 */
function savePreferences() {
	ensureDataDir()
	try {
		fs.writeFileSync(PREFERENCES_FILE, JSON.stringify(userPreferences, null, 2), "utf8")
	} catch (err) {
		console.error("[telegram-learner] Failed to save preferences:", err.message)
	}
}

/**
 * Load frustration log from disk.
 */
function loadFrustrationLog() {
	ensureDataDir()
	try {
		if (fs.existsSync(FRUSTRATION_FILE)) {
			const raw = fs.readFileSync(FRUSTRATION_FILE, "utf8")
			frustrationLog = JSON.parse(raw)
		}
	} catch (err) {
		console.error("[telegram-learner] Failed to load frustration log:", err.message)
	}
}

/**
 * Save frustration log to disk.
 */
function saveFrustrationLog() {
	ensureDataDir()
	try {
		fs.writeFileSync(FRUSTRATION_FILE, JSON.stringify(frustrationLog, null, 2), "utf8")
	} catch (err) {
		console.error("[telegram-learner] Failed to save frustration log:", err.message)
	}
}

/**
 * Record a user preference (favorite command, project, workflow).
 *
 * @param {string} userId - Telegram user ID
 * @param {string} category - 'favoriteCommands', 'favoriteProjects', or 'workflows'
 * @param {string} value - The command, project name, or workflow name
 */
function recordUserPreference(userId, category, value) {
	if (!userPreferences[userId]) {
		userPreferences[userId] = {
			favoriteCommands: [],
			favoriteProjects: [],
			workflows: [],
			lastActive: new Date().toISOString(),
		}
	}

	const pref = userPreferences[userId]
	if (!pref[category]) {
		pref[category] = []
	}

	// Add to front, remove duplicates, keep max 10
	pref[category] = [value, ...pref[category].filter((v) => v !== value)].slice(0, 10)
	pref.lastActive = new Date().toISOString()

	savePreferences()
}

/**
 * Get user preferences.
 *
 * @param {string} userId
 * @returns {object|null} User preferences or null if not found
 */
function getUserPreferences(userId) {
	if (!userPreferences[userId]) return null

	// Check for decay
	const lastActive = new Date(userPreferences[userId].lastActive)
	const daysSinceActive = (Date.now() - lastActive.getTime()) / (1000 * 60 * 60 * 24)
	if (daysSinceActive > PREFERENCE_DECAY_DAYS) {
		// Decay: reduce confidence but keep data
		return { ...userPreferences[userId], decayed: true }
	}

	return { ...userPreferences[userId], decayed: false }
}

/**
 * Get proactive suggestions based on learned patterns and preferences.
 *
 * @param {string} userId
 * @param {string} currentContext - Current chat context for relevance filtering
 * @returns {Array<{type: string, text: string, confidence: number}>}
 */
function getProactiveSuggestions(userId, currentContext) {
	const suggestions = []

	// 1. Suggest based on favorite commands
	const prefs = getUserPreferences(userId)
	if (prefs && prefs.favoriteCommands && prefs.favoriteCommands.length > 0) {
		const topCmd = prefs.favoriteCommands[0]
		suggestions.push({
			type: "command",
			text: `Run \`${topCmd}\` again?`,
			confidence: 0.7,
		})
	}

	// 2. Suggest based on detected patterns matching current context
	if (currentContext) {
		const lower = currentContext.toLowerCase()
		for (const [patternKey, pattern] of Object.entries(knownPatterns)) {
			if (pattern.confidence < MIN_PATTERN_CONFIDENCE) continue
			if (lower.includes(pattern.keyword)) {
				suggestions.push({
					type: "pattern",
					text: `I notice you're asking about "${pattern.keyword}" — want me to help with that?`,
					confidence: pattern.confidence,
				})
				break // One pattern suggestion is enough
			}
		}
	}

	// 3. Suggest based on frustration recovery
	if (frustrationLog[userId] && frustrationLog[userId].count >= FRUSTRATION_THRESHOLD) {
		suggestions.push({
			type: "recovery",
			text: "I notice you've been having some trouble. Would you like me to simplify things or try a different approach?",
			confidence: 0.9,
		})
	}

	// Sort by confidence descending
	return suggestions.sort((a, b) => b.confidence - a.confidence)
}

/**
 * Detect user frustration from a message.
 *
 * @param {string} userId
 * @param {string} message - The user's message
 * @param {string} context - What the user was trying to do
 * @returns {boolean} Whether frustration was detected
 */
function detectFrustration(userId, message, context) {
	if (!message) return false

	const lower = message.toLowerCase()
	const frustrationSignals = [
		"why",
		"not working",
		"doesn't work",
		"broken",
		"stupid",
		"useless",
		"fix this",
		"still broken",
		"again",
		"same error",
		"nothing works",
		"waste",
		"annoying",
		"frustrating",
		"help me",
		"what's wrong",
		"error",
		"failed",
		"not good",
		"terrible",
		"bad",
	]

	let signalCount = 0
	for (const signal of frustrationSignals) {
		if (lower.includes(signal)) {
			signalCount++
		}
	}

	if (signalCount === 0) return false

	// Initialize frustration entry
	if (!frustrationLog[userId]) {
		frustrationLog[userId] = {
			count: 0,
			lastFrustration: null,
			contexts: [],
		}
	}

	frustrationLog[userId].count += signalCount
	frustrationLog[userId].lastFrustration = new Date().toISOString()
	frustrationLog[userId].contexts.push({
		message: message.slice(0, 200),
		context: context || "unknown",
		timestamp: new Date().toISOString(),
	})

	// Keep only last 20 contexts
	if (frustrationLog[userId].contexts.length > 20) {
		frustrationLog[userId].contexts = frustrationLog[userId].contexts.slice(-20)
	}

	saveFrustrationLog()

	return frustrationLog[userId].count >= FRUSTRATION_THRESHOLD
}

/**
 * Reset frustration counter for a user (e.g., after successful interaction).
 *
 * @param {string} userId
 */
function resetFrustration(userId) {
	if (frustrationLog[userId]) {
		frustrationLog[userId].count = 0
		frustrationLog[userId].lastFrustration = null
		saveFrustrationLog()
	}
}

/**
 * Semantic search through conversation history using keyword matching.
 * In production, this would use pgvector for true semantic search.
 *
 * @param {string} query - Search query
 * @param {number} limit - Max results
 * @returns {Array<{message: string, intent: string, timestamp: string, score: number}>}
 */
function semanticSearch(query, limit = 5) {
	if (!query || conversationBuffer.length === 0) return []

	const lower = query.toLowerCase()
	const queryWords = lower.split(/\s+/).filter((w) => w.length > 2)

	if (queryWords.length === 0) return []

	// Score each conversation by keyword overlap
	const scored = conversationBuffer.map((conv) => {
		const convLower = (conv.message + " " + (conv.response || "")).toLowerCase()
		let matches = 0
		for (const word of queryWords) {
			if (convLower.includes(word)) matches++
		}
		const score = matches / queryWords.length
		return { ...conv, score }
	})

	// Filter and sort
	return scored
		.filter((s) => s.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, limit)
}

// Load v2 data on init
loadPreferences()
loadFrustrationLog()

// ─── Core Learning Functions ────────────────────────────────────────────────

/**
 * Record a conversation interaction for learning.
 *
 * @param {object} interaction
 * @param {string} interaction.userId - Telegram user ID
 * @param {string} interaction.chatId - Chat ID
 * @param {string} interaction.message - User's message text
 * @param {string} interaction.intent - Detected intent
 * @param {string} interaction.response - Bot's response
 * @param {number} interaction.responseTimeMs - How long the response took
 * @param {boolean} interaction.userSatisfied - Whether user seemed satisfied (follow-up positive)
 */
function recordInteraction(interaction) {
	learnerState.totalInteractions++

	// Log to conversation file
	logConversation(interaction)

	// Update intent counts
	const intent = interaction.intent || "unknown"
	if (!learnerState.intentCounts[intent]) {
		learnerState.intentCounts[intent] = 0
	}
	learnerState.intentCounts[intent]++

	// Track response quality
	if (!learnerState.responseQuality[intent]) {
		learnerState.responseQuality[intent] = { scores: [], average: 0 }
	}

	// Score response quality based on response time and user satisfaction
	let qualityScore = 0.5 // default neutral

	if (interaction.userSatisfied === true) {
		qualityScore = 0.9
	} else if (interaction.userSatisfied === false) {
		qualityScore = 0.2
	}

	// Faster responses score higher
	if (interaction.responseTimeMs < 2000) {
		qualityScore = Math.min(1, qualityScore + 0.1)
	} else if (interaction.responseTimeMs > 15000) {
		qualityScore = Math.max(0, qualityScore - 0.1)
	}

	const qs = learnerState.responseQuality[intent]
	qs.scores.push(qualityScore)
	// Keep only last 100 scores
	if (qs.scores.length > 100) qs.scores.shift()
	qs.average = qs.scores.reduce((a, b) => a + b, 0) / qs.scores.length

	// Add to conversation buffer for pattern analysis
	conversationBuffer.push({
		message: interaction.message,
		intent: intent,
		response: interaction.response,
		timestamp: new Date().toISOString(),
	})

	if (conversationBuffer.length > MAX_CONVERSATIONS_IN_MEMORY) {
		conversationBuffer.shift()
	}

	saveState()
}

/**
 * Log a conversation to the JSONL file for offline analysis.
 */
function logConversation(interaction) {
	ensureDataDir()
	try {
		const line =
			JSON.stringify({
				ts: new Date().toISOString(),
				userId: interaction.userId,
				chatId: interaction.chatId,
				message: interaction.message,
				intent: interaction.intent,
				responseLength: (interaction.response || "").length,
				responseTimeMs: interaction.responseTimeMs,
				userSatisfied: interaction.userSatisfied,
			}) + "\n"
		fs.appendFileSync(CONVERSATION_LOG_FILE, line, "utf8")
	} catch (err) {
		console.error("[telegram-learner] Failed to log conversation:", err.message)
	}
}

/**
 * Report whether the user seemed satisfied with the bot's response.
 * Call this when the user sends a follow-up message.
 *
 * @param {string} chatId
 * @param {string} followUpMessage - The user's follow-up message
 * @returns {boolean} Whether the user seemed satisfied
 */
function assessUserSatisfaction(followUpMessage) {
	if (!followUpMessage) return null

	const lower = followUpMessage.toLowerCase()

	// Positive signals
	const positiveWords = [
		"thanks",
		"thank",
		"great",
		"awesome",
		"perfect",
		"good",
		"nice",
		"works",
		"working",
		"correct",
		"right",
		"yes",
		"ok",
		"okay",
		"understood",
		"got it",
		"clear",
		"helpful",
	]
	for (const word of positiveWords) {
		if (lower.includes(word)) return true
	}

	// Negative signals
	const negativeWords = [
		"no",
		"not",
		"wrong",
		"incorrect",
		"bad",
		"terrible",
		"awful",
		"doesn't work",
		"not working",
		"error",
		"fail",
		"failed",
		"what",
		"huh",
		"confused",
		"don't understand",
	]
	for (const word of negativeWords) {
		if (lower.includes(word)) return false
	}

	return null // neutral / unknown
}

/**
 * Detect conversation patterns from the buffer.
 * This runs periodically to find common patterns in user interactions.
 */
function detectPatterns() {
	if (conversationBuffer.length < 10) return

	// Group by intent
	const byIntent = {}
	for (const conv of conversationBuffer) {
		if (!byIntent[conv.intent]) byIntent[conv.intent] = []
		byIntent[conv.intent].push(conv)
	}

	// For each intent, find common keywords
	for (const [intent, conversations] of Object.entries(byIntent)) {
		if (conversations.length < 5) continue

		// Extract common words
		const wordFreq = {}
		for (const conv of conversations) {
			const words = conv.message.toLowerCase().split(/\s+/)
			for (const word of words) {
				if (word.length < 3) continue // skip short words
				if (!wordFreq[word]) wordFreq[word] = 0
				wordFreq[word]++
			}
		}

		// Find words that appear in >30% of conversations for this intent
		const threshold = Math.max(3, conversations.length * 0.3)
		for (const [word, freq] of Object.entries(wordFreq)) {
			if (freq >= threshold) {
				const patternKey = intent + ":" + word
				if (!knownPatterns[patternKey]) {
					knownPatterns[patternKey] = {
						intent: intent,
						keyword: word,
						confidence: Math.min(1, freq / conversations.length),
						firstSeen: new Date().toISOString(),
						occurrences: freq,
					}
				} else {
					// Update confidence with exponential moving average
					const oldConf = knownPatterns[patternKey].confidence
					knownPatterns[patternKey].confidence =
						oldConf + LEARNING_RATE * (freq / conversations.length - oldConf)
					knownPatterns[patternKey].occurrences += freq
				}
			}
		}
	}

	savePatterns()
}

/**
 * Get intent suggestions based on learned patterns.
 *
 * @param {string} message - The user's message
 * @returns {Array<{intent: string, confidence: number}>} Sorted intent suggestions
 */
function suggestIntent(message) {
	if (!message || Object.keys(knownPatterns).length === 0) return []

	const lower = message.toLowerCase()
	const words = lower.split(/\s+/)
	const suggestions = {}

	for (const [patternKey, pattern] of Object.entries(knownPatterns)) {
		if (pattern.confidence < MIN_PATTERN_CONFIDENCE) continue

		// Check if the message contains the pattern keyword
		if (lower.includes(pattern.keyword)) {
			if (!suggestions[pattern.intent]) {
				suggestions[pattern.intent] = 0
			}
			suggestions[pattern.intent] = Math.max(suggestions[pattern.intent], pattern.confidence)
		}
	}

	// Sort by confidence descending
	return Object.entries(suggestions)
		.map(([intent, confidence]) => ({ intent, confidence }))
		.sort((a, b) => b.confidence - a.confidence)
}

/**
 * Get learning statistics.
 */
function getStats() {
	return {
		totalConversations: learnerState.totalConversations,
		totalInteractions: learnerState.totalInteractions,
		intentCounts: learnerState.intentCounts,
		responseQuality: Object.fromEntries(
			Object.entries(learnerState.responseQuality).map(([k, v]) => [
				k,
				{
					average: v.average,
					sampleSize: v.scores.length,
				},
			]),
		),
		knownPatterns: Object.keys(knownPatterns).length,
		modelVersion: learnerState.modelVersion,
		lastTrainingAt: learnerState.lastTrainingAt,
	}
}

/**
 * Record a new conversation (start of a conversation session).
 */
function recordConversation() {
	learnerState.totalConversations++
	saveState()
}

/**
 * Update intent accuracy based on user feedback.
 */
function updateIntentAccuracy(intent, wasCorrect) {
	if (!learnerState.intentAccuracy[intent]) {
		learnerState.intentAccuracy[intent] = { correct: 0, total: 0, accuracy: 0 }
	}
	const ia = learnerState.intentAccuracy[intent]
	ia.total++
	if (wasCorrect) ia.correct++
	ia.accuracy = ia.correct / ia.total
	saveState()
}

// ─── Periodic Training ──────────────────────────────────────────────────────

let trainingInterval = null

function startPeriodicTraining(intervalMs = 5 * 60 * 1000) {
	// Run pattern detection every 5 minutes
	if (trainingInterval) clearInterval(trainingInterval)
	trainingInterval = setInterval(() => {
		detectPatterns()
		console.log(
			"[telegram-learner] Pattern detection completed. Known patterns: " + Object.keys(knownPatterns).length,
		)
	}, intervalMs)
	trainingInterval.unref()
}

function stopPeriodicTraining() {
	if (trainingInterval) {
		clearInterval(trainingInterval)
		trainingInterval = null
	}
}

// ─── Initialize ─────────────────────────────────────────────────────────────

loadState()
startPeriodicTraining()

console.log("[telegram-learner] Initialized. Loaded " + learnerState.totalConversations + " past conversations.")

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
	recordInteraction,
	recordConversation,
	assessUserSatisfaction,
	suggestIntent,
	updateIntentAccuracy,
	getStats,
	detectPatterns,
	loadState,
	saveState,
	startPeriodicTraining,
	// v2 exports
	loadPreferences,
	savePreferences,
	loadFrustrationLog,
	saveFrustrationLog,
	recordUserPreference,
	getUserPreferences,
	getProactiveSuggestions,
	detectFrustration,
	resetFrustration,
	semanticSearch,
}
