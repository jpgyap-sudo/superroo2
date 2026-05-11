/**
 * Telegram Conversation Learner
 *
 * ML-powered learning system for the Telegram bot that gets smarter over time.
 * Records conversation patterns, intent classifications, and response outcomes
 * to continuously improve the bot's intelligence.
 *
 * Features:
 * - Conversation pattern recording & analysis
 * - Intent classification improvement via feedback loops
 * - Response quality scoring
 * - Automatic pattern detection (frequent questions, common issues)
 * - Persistent learning state stored as JSON
 */

const fs = require("fs")
const path = require("path")

// ─── Configuration ──────────────────────────────────────────────────────────

const LEARNER_STATE_FILE = path.join(__dirname, "..", "data", "telegram-learner-state.json")
const CONVERSATION_LOG_FILE = path.join(__dirname, "..", "data", "telegram-conversations.jsonl")
const PATTERNS_FILE = path.join(__dirname, "..", "data", "telegram-patterns.json")

const MAX_CONVERSATIONS_IN_MEMORY = 1000
const MIN_PATTERN_CONFIDENCE = 0.6
const LEARNING_RATE = 0.1

// ─── State ──────────────────────────────────────────────────────────────────

let learnerState = {
	totalConversations: 0,
	totalInteractions: 0,
	intentCounts: {},        // { intent_name: count }
	intentAccuracy: {},      // { intent_name: { correct, total, accuracy } }
	responseQuality: {},     // { intent_name: { scores: [], average } }
	patternConfidence: {},   // { pattern_key: confidence_score }
	lastTrainingAt: null,
	modelVersion: 1,
}

let conversationBuffer = []   // Recent conversations for pattern analysis
let knownPatterns = {}        // Detected conversation patterns

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
			console.log("[telegram-learner] Loaded state: " + learnerState.totalConversations + " conversations, " + learnerState.totalInteractions + " interactions")
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
		const line = JSON.stringify({
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
		"thanks", "thank", "great", "awesome", "perfect", "good", "nice",
		"works", "working", "correct", "right", "yes", "ok", "okay",
		"understood", "got it", "clear", "helpful",
	]
	for (const word of positiveWords) {
		if (lower.includes(word)) return true
	}

	// Negative signals
	const negativeWords = [
		"no", "not", "wrong", "incorrect", "bad", "terrible", "awful",
		"doesn't work", "not working", "error", "fail", "failed",
		"what", "huh", "confused", "don't understand",
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
					knownPatterns[patternKey].confidence = oldConf + LEARNING_RATE * (freq / conversations.length - oldConf)
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
			suggestions[pattern.intent] = Math.max(
				suggestions[pattern.intent],
				pattern.confidence,
			)
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
			Object.entries(learnerState.responseQuality).map(([k, v]) => [k, {
				average: v.average,
				sampleSize: v.scores.length,
			}]),
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
		console.log("[telegram-learner] Pattern detection completed. Known patterns: " + Object.keys(knownPatterns).length)
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
}
