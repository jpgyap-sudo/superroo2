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
const CROSS_USER_PATTERNS_FILE = path.join(__dirname, "..", "data", "telegram-cross-user-patterns.json")

const MAX_CONVERSATIONS_IN_MEMORY = 1000
const MIN_PATTERN_CONFIDENCE = 0.4
const LEARNING_RATE = 0.1
const CROSS_USER_MERGE_INTERVAL_MS = 10 * 60 * 1000
const MIN_USERS_FOR_CROSS_PATTERN = 3

// ─── State ──────────────────────────────────────────────────────────────────

let learnerState = {
	totalConversations: 0,
	totalInteractions: 0,
	intentCounts: {}, // { intent_name: count }
	intentAccuracy: {}, // { intent_name: { correct, total, accuracy } }
	responseQuality: {}, // { intent_name: { scores: [], average } }
	patternConfidence: {}, // { pattern_key: confidence_score }
	lastTrainingAt: null,
	modelVersion: 1,
}

let conversationBuffer = [] // Recent conversations for pattern analysis
let knownPatterns = {} // Detected conversation patterns
let crossUserPatterns = {} // Anonymized patterns aggregated across all users
let userIntentProfiles = {} // { chatId: { intents: { intent: count }, lastActive: timestamp } }

// ─── Initialization ─────────────────────────────────────────────────────────

function ensureDataDir() {
	const dir = path.dirname(LEARNER_STATE_FILE)
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true })
	}
}

function backfillConversations(limit = MAX_CONVERSATIONS_IN_MEMORY) {
	if (!fs.existsSync(CONVERSATION_LOG_FILE)) return
	try {
		const lines = fs.readFileSync(CONVERSATION_LOG_FILE, "utf8").split("\n").filter(Boolean).slice(-limit)
		for (const line of lines) {
			try {
				const entry = JSON.parse(line)
				conversationBuffer.push({
					chatId: entry.chatId,
					message: entry.message,
					intent: entry.intent || "unknown",
					response: "",
					timestamp: entry.ts,
				})
			} catch (_) {
				// Skip malformed lines
			}
		}
		console.log("[telegram-learner] Backfilled " + conversationBuffer.length + " conversations from log")
	} catch (err) {
		console.error("[telegram-learner] Failed to backfill conversations:", err.message)
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

	// Backfill conversation buffer from JSONL log so patterns survive PM2 restarts
	backfillConversations()

	// Load cross-user patterns (GAP 5.5)
	loadCrossUserPatterns()

	// Run an immediate pattern detection if we have enough backfilled data
	if (conversationBuffer.length >= 5) {
		detectPatterns()
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

function saveCrossUserPatterns() {
	ensureDataDir()
	try {
		fs.writeFileSync(CROSS_USER_PATTERNS_FILE, JSON.stringify(crossUserPatterns, null, 2), "utf8")
	} catch (err) {
		console.error("[telegram-learner] Failed to save cross-user patterns:", err.message)
	}
}

function loadCrossUserPatterns() {
	ensureDataDir()
	try {
		if (fs.existsSync(CROSS_USER_PATTERNS_FILE)) {
			const raw = fs.readFileSync(CROSS_USER_PATTERNS_FILE, "utf8")
			crossUserPatterns = JSON.parse(raw)
			console.log("[telegram-learner] Loaded " + Object.keys(crossUserPatterns).length + " cross-user patterns")
		}
	} catch (err) {
		console.error("[telegram-learner] Failed to load cross-user patterns:", err.message)
	}
}

/**
 * Merge per-user patterns into an anonymized cross-user pattern store.
 * This aggregates patterns across all users so the bot can learn from
 * the collective behavior without exposing individual user data.
 *
 * Each cross-user pattern stores:
 *  - intent: the detected intent
 *  - keyword: the common keyword
 *  - confidence: aggregated confidence score
 *  - userCount: how many distinct users exhibited this pattern
 *  - totalOccurrences: total occurrences across all users
 *  - lastSeen: timestamp of the most recent occurrence
 */
function mergeCrossUserPatterns() {
	var userKeys = Object.keys(userIntentProfiles)
	if (userKeys.length < MIN_USERS_FOR_CROSS_PATTERN) return

	// Build an aggregated view: for each (intent, keyword) pair, track which users have it
	var aggregated = {}
	for (var patternKey in knownPatterns) {
		if (!Object.prototype.hasOwnProperty.call(knownPatterns, patternKey)) continue
		var pattern = knownPatterns[patternKey]
		if (pattern.confidence < MIN_PATTERN_CONFIDENCE) continue

		if (!aggregated[patternKey]) {
			aggregated[patternKey] = {
				intent: pattern.intent,
				keyword: pattern.keyword,
				confidence: 0,
				userCount: 0,
				totalOccurrences: 0,
				firstSeen: pattern.firstSeen,
				lastSeen: pattern.firstSeen,
				users: {},
			}
		}
		aggregated[patternKey].totalOccurrences += pattern.occurrences || 1
		if (pattern.lastSeen && pattern.lastSeen > aggregated[patternKey].lastSeen) {
			aggregated[patternKey].lastSeen = pattern.lastSeen
		}
	}

	// Now count how many distinct users have each pattern by scanning conversation buffer
	var userPatterns = {}
	for (var i = 0; i < conversationBuffer.length; i++) {
		var conv = conversationBuffer[i]
		if (!conv.chatId) continue
		var cid = String(conv.chatId)
		if (!userPatterns[cid]) userPatterns[cid] = {}
		var words = (conv.message || "").toLowerCase().split(/\s+/)
		for (var w = 0; w < words.length; w++) {
			var word = words[w]
			if (word.length < 3) continue
			var pk = conv.intent + ":" + word
			if (!userPatterns[cid][pk]) userPatterns[cid][pk] = 0
			userPatterns[cid][pk]++
		}
	}

	// For each aggregated pattern, count how many users have it
	for (var pk in aggregated) {
		if (!Object.prototype.hasOwnProperty.call(aggregated, pk)) continue
		var userSet = new Set()
		for (var cid in userPatterns) {
			if (userPatterns[cid][pk]) {
				userSet.add(cid)
			}
		}
		aggregated[pk].userCount = userSet.size
		// Only keep patterns seen by at least MIN_USERS_FOR_CROSS_PATTERN users
		if (aggregated[pk].userCount < MIN_USERS_FOR_CROSS_PATTERN) {
			delete aggregated[pk]
			continue
		}
		// Boost confidence based on user count
		var userRatio = Math.min(1, aggregated[pk].userCount / userKeys.length)
		aggregated[pk].confidence = Math.min(1, (aggregated[pk].totalOccurrences / userKeys.length) * userRatio)
		// Remove the users map (anonymize)
		delete aggregated[pk].users
	}

	crossUserPatterns = aggregated
	saveCrossUserPatterns()
	console.log(
		"[telegram-learner] Merged cross-user patterns: " +
			Object.keys(crossUserPatterns).length +
			" patterns from " +
			userKeys.length +
			" users",
	)
}

/**
 * Get cross-user patterns for a given intent.
 *
 * @param {string} intent - Optional intent filter
 * @param {number} minConfidence - Minimum confidence threshold (default: 0.5)
 * @returns {Array<{intent: string, keyword: string, confidence: number, userCount: number, totalOccurrences: number}>}
 */
function getCrossUserPatterns(intent, minConfidence) {
	minConfidence = minConfidence !== undefined ? minConfidence : 0.5
	var result = []
	for (var patternKey in crossUserPatterns) {
		if (!Object.prototype.hasOwnProperty.call(crossUserPatterns, patternKey)) continue
		var p = crossUserPatterns[patternKey]
		if (p.confidence < minConfidence) continue
		if (intent && p.intent !== intent) continue
		result.push({
			intent: p.intent,
			keyword: p.keyword,
			confidence: p.confidence,
			userCount: p.userCount,
			totalOccurrences: p.totalOccurrences,
		})
	}
	return result.sort(function (a, b) {
		return b.confidence - a.confidence
	})
}

/**
 * Get aggregated cross-user insights for the dashboard.
 *
 * @returns {object} Cross-user learning statistics
 */
function getCrossUserInsights() {
	var totalUsers = Object.keys(userIntentProfiles).length
	var totalPatterns = Object.keys(crossUserPatterns).length
	var topIntents = {}
	for (var pk in crossUserPatterns) {
		if (!Object.prototype.hasOwnProperty.call(crossUserPatterns, pk)) continue
		var p = crossUserPatterns[pk]
		if (!topIntents[p.intent]) topIntents[p.intent] = { patternCount: 0, avgConfidence: 0, totalUsers: 0 }
		topIntents[p.intent].patternCount++
		topIntents[p.intent].avgConfidence =
			(topIntents[p.intent].avgConfidence * (topIntents[p.intent].patternCount - 1) + p.confidence) /
			topIntents[p.intent].patternCount
		topIntents[p.intent].totalUsers = Math.max(topIntents[p.intent].totalUsers, p.userCount)
	}

	return {
		totalUsersTracked: totalUsers,
		totalCrossUserPatterns: totalPatterns,
		topIntents: Object.entries(topIntents)
			.sort(function (a, b) {
				return b[1].patternCount - a[1].patternCount
			})
			.slice(0, 10)
			.map(function (entry) {
				return {
					intent: entry[0],
					patternCount: entry[1].patternCount,
					avgConfidence: entry[1].avgConfidence,
					totalUsers: entry[1].totalUsers,
				}
			}),
		lastMergeAt: new Date().toISOString(),
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
		chatId: interaction.chatId,
		message: interaction.message,
		intent: intent,
		response: interaction.response,
		timestamp: new Date().toISOString(),
	})

	if (conversationBuffer.length > MAX_CONVERSATIONS_IN_MEMORY) {
		conversationBuffer.shift()
	}

	// Update per-user intent profile for cross-user pattern learning (GAP 5.5)
	var cid = String(interaction.chatId || "")
	if (cid) {
		if (!userIntentProfiles[cid]) {
			userIntentProfiles[cid] = { intents: {}, lastActive: new Date().toISOString() }
		}
		if (!userIntentProfiles[cid].intents[intent]) {
			userIntentProfiles[cid].intents[intent] = 0
		}
		userIntentProfiles[cid].intents[intent]++
		userIntentProfiles[cid].lastActive = new Date().toISOString()
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
 * LLM-based satisfaction assessment for more accurate scoring.
 * Uses Ollama (free, local) to rate satisfaction on a 1-5 scale.
 * Falls back to keyword-based assessment if Ollama is unavailable.
 * @param {string} followUpMessage - The user's follow-up message
 * @param {string} [previousResponse] - The bot's previous response for context
 * @returns {Promise<{score: number|null, label: string}>} { score: 1-5, label: "satisfied"|"neutral"|"unsatisfied" }
 */
async function assessSatisfactionLLM(followUpMessage, previousResponse) {
	if (!followUpMessage) return { score: null, label: "neutral" }

	try {
		var prompt = "Rate the user's satisfaction with the previous response on a scale of 1-5.\n"
		prompt += "1 = very unsatisfied, 2 = unsatisfied, 3 = neutral, 4 = satisfied, 5 = very satisfied.\n"
		if (previousResponse) {
			prompt += "Previous response: " + previousResponse.slice(0, 300) + "\n"
		}
		prompt += "User's follow-up message: " + followUpMessage.slice(0, 300) + "\n"
		prompt += "Respond with ONLY a number (1-5) and nothing else."

		var http = require("http")
		var ollamaBaseUrl = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434"
		var ollamaModel = process.env.OLLAMA_MODEL || "llama3.2"

		var result = await new Promise(function (resolve, reject) {
			var postData = JSON.stringify({
				model: ollamaModel,
				messages: [{ role: "user", content: prompt }],
				stream: false,
				options: { num_predict: 10, temperature: 0.1 },
			})
			var parsedUrl = new URL(ollamaBaseUrl + "/api/chat")
			var req = http.request(
				{
					hostname: parsedUrl.hostname,
					port: parsedUrl.port || 11434,
					path: "/api/chat",
					method: "POST",
					headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(postData) },
				},
				function (res) {
					var body = ""
					res.on("data", function (chunk) {
						body += chunk
					})
					res.on("end", function () {
						try {
							var parsed = JSON.parse(body)
							var content = (parsed.message && parsed.message.content) || ""
							var match = content.trim().match(/^[1-5]$/)
							if (match) {
								resolve(parseInt(match[0], 10))
							} else {
								resolve(null)
							}
						} catch (e) {
							resolve(null)
						}
					})
				},
			)
			req.on("error", function () {
				resolve(null)
			})
			req.write(postData)
			req.end()
		})

		if (result !== null) {
			var label = result >= 4 ? "satisfied" : result <= 2 ? "unsatisfied" : "neutral"
			return { score: result, label: label }
		}
	} catch (e) {
		// Fall through to keyword-based
	}

	// Fallback: use keyword-based assessment
	var keywordResult = assessUserSatisfaction(followUpMessage)
	if (keywordResult === true) return { score: 4, label: "satisfied" }
	if (keywordResult === false) return { score: 2, label: "unsatisfied" }
	return { score: 3, label: "neutral" }
}

/**
 * Detect conversation patterns from the buffer.
 * This runs periodically to find common patterns in user interactions.
 */
function detectPatterns() {
	if (conversationBuffer.length < 5) return

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
 * Get user's frequent intent patterns from conversation history.
 *
 * @param {string} chatId - Telegram chat ID
 * @returns {Array<{intent: string, count: number, topKeywords: string[]}>}
 */
function getUserPatterns(chatId) {
	if (conversationBuffer.length === 0) return []

	// Filter to this user's conversations (fallback to all if chatId not stored in older entries)
	var userConvs = conversationBuffer.filter(function (c) {
		return c.chatId === chatId || c.chatId === undefined
	})
	if (userConvs.length === 0) return []

	// Count by intent
	var intentCounts = {}
	var intentKeywords = {}
	for (var i = 0; i < userConvs.length; i++) {
		var conv = userConvs[i]
		var intent = conv.intent || "unknown"
		if (!intentCounts[intent]) {
			intentCounts[intent] = 0
			intentKeywords[intent] = {}
		}
		intentCounts[intent]++

		// Extract keywords
		var words = (conv.message || "").toLowerCase().split(/\s+/)
		for (var w = 0; w < words.length; w++) {
			var word = words[w].replace(/[^a-z0-9]/g, "")
			if (word.length < 4) continue
			if (!intentKeywords[intent][word]) intentKeywords[intent][word] = 0
			intentKeywords[intent][word]++
		}
	}

	// Build result sorted by count
	var result = []
	for (var intent in intentCounts) {
		if (!Object.prototype.hasOwnProperty.call(intentCounts, intent)) continue
		// Get top 3 keywords for this intent
		var keywords = Object.entries(intentKeywords[intent] || {})
			.sort(function (a, b) {
				return b[1] - a[1]
			})
			.slice(0, 3)
			.map(function (entry) {
				return entry[0]
			})
		result.push({
			intent: intent,
			count: intentCounts[intent],
			topKeywords: keywords,
		})
	}
	return result.sort(function (a, b) {
		return b.count - a.count
	})
}

/**
 * Suggest next actions based on the user's current intent and past workflow.
 *
 * @param {string} chatId - Telegram chat ID
 * @param {string} currentIntent - The current intent being handled
 * @returns {Array<string>} Suggested next actions
 */
function getSuggestedNextActions(chatId, currentIntent) {
	var patterns = getUserPatterns(chatId)
	if (patterns.length === 0) return []

	// Common workflow sequences
	var workflowSequences = {
		code_task: ["run_tests", "deploy", "read_logs"],
		debug_plan: ["code_task", "run_tests", "read_logs"],
		read_logs: ["debug_plan", "code_task"],
		run_tests: ["code_task", "deploy", "debug_plan"],
		deploy: ["read_logs", "run_tests", "commit_status"],
		create_branch: ["code_task", "create_pr"],
		create_pr: ["deploy", "run_tests"],
	}

	var suggestions = workflowSequences[currentIntent] || []
	// Filter to intents the user has actually used before (or common ones)
	var userIntentSet = new Set(
		patterns.map(function (p) {
			return p.intent
		}),
	)
	return suggestions
		.filter(function (s) {
			return userIntentSet.has(s) || ["run_tests", "deploy", "read_logs"].indexOf(s) >= 0
		})
		.slice(0, 3)
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
		// Merge cross-user patterns periodically (GAP 5.5)
		mergeCrossUserPatterns()
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

// ─── Central Brain Sync ─────────────────────────────────────────────────────
/**
 * Sync a lesson to the Central Brain learning layer.
 * Non-blocking — fire-and-forget with timeout.
 * Falls back to local JSONL append if Central Brain is unreachable.
 * @param {object} lesson — { title, content, tags, source, project }
 */
async function syncToCentralBrain(lesson) {
	try {
		var apiUrl = process.env.SUPERROO_API_URL || "http://127.0.0.1:8787"
		var controller = new AbortController()
		var timeoutId = setTimeout(function () {
			controller.abort()
		}, 5000)
		var response = await fetch(apiUrl + "/api/orchestrator/hermes/codex_task_upsert", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				title: "[Telegram] " + (lesson.title || "Untitled"),
				summary: lesson.content || "",
				status: "completed",
				filesChanged: lesson.files || [],
				featuresAffected: lesson.tags || ["telegram"],
				notes: "Source: " + (lesson.source || "telegram") + " | Project: " + (lesson.project || "superroo2"),
			}),
			signal: controller.signal,
		})
		clearTimeout(timeoutId)
		if (!response.ok) {
			throw new Error("HTTP " + response.status)
		}
		console.log("[telegram-learner] Synced lesson to Central Brain: " + lesson.title)
	} catch (err) {
		console.log("[telegram-learner] Central Brain sync failed (will retry later): " + err.message)
		// Fallback: append to local learning-events JSONL
		try {
			var fallbackPath = path.join(__dirname, "..", "..", "memory", "learning-events.jsonl")
			var entry =
				JSON.stringify({
					type: "telegram-lesson",
					date: new Date().toISOString(),
					...lesson,
				}) + "\n"
			fs.appendFileSync(fallbackPath, entry)
		} catch (_) {}
	}
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
	recordInteraction,
	recordConversation,
	assessUserSatisfaction,
	assessSatisfactionLLM,
	suggestIntent,
	updateIntentAccuracy,
	getStats,
	getUserPatterns,
	getSuggestedNextActions,
	detectPatterns,
	loadState,
	saveState,
	startPeriodicTraining,
	// GAP 5.5 — Cross-user pattern learning
	mergeCrossUserPatterns,
	getCrossUserPatterns,
	getCrossUserInsights,
	loadCrossUserPatterns,
	// Central Brain sync
	syncToCentralBrain,
}
