/**
 * Telegram Learner Database — SQLite Persistence Layer
 *
 * Replaces JSON file-based persistence with better-sqlite3 for:
 * - Learner state (intent counts, accuracy, response quality)
 * - Conversation history (pattern analysis buffer)
 * - Known patterns (detected conversation patterns)
 * - User preferences (favorite commands, projects, workflows)
 * - Frustration log (user frustration tracking)
 *
 * Provides atomic writes, proper locking, and query capabilities.
 */

const Database = require("better-sqlite3")
const path = require("path")
const fs = require("fs")

const DB_DIR = path.join(__dirname, "..", "..", "data")
const DB_PATH = path.join(DB_DIR, "telegram-learner.db")

let db = null

// ─── Schema ─────────────────────────────────────────────────────────────────

const SCHEMA = `
CREATE TABLE IF NOT EXISTS learner_state (
	key   TEXT PRIMARY KEY,
	value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
	id          INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id     TEXT,
	chat_id     TEXT,
	message     TEXT,
	intent      TEXT,
	response    TEXT,
	response_time_ms INTEGER,
	user_satisfied  INTEGER,
	created_at  TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_conversations_intent ON conversations(intent);
CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations(created_at);

CREATE TABLE IF NOT EXISTS patterns (
	pattern_key TEXT PRIMARY KEY,
	intent      TEXT NOT NULL,
	keyword     TEXT NOT NULL,
	confidence  REAL NOT NULL DEFAULT 0.0,
	first_seen  TEXT NOT NULL,
	occurrences INTEGER NOT NULL DEFAULT 0,
	updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_patterns_intent ON patterns(intent);
CREATE INDEX IF NOT EXISTS idx_patterns_confidence ON patterns(confidence);

CREATE TABLE IF NOT EXISTS user_preferences (
	user_id     TEXT PRIMARY KEY,
	favorite_commands TEXT DEFAULT '[]',
	favorite_projects TEXT DEFAULT '[]',
	workflows   TEXT DEFAULT '[]',
	last_active TEXT,
	decayed     INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS frustration_log (
	user_id          TEXT PRIMARY KEY,
	count            INTEGER DEFAULT 0,
	last_frustration TEXT,
	contexts         TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS response_quality (
	intent      TEXT PRIMARY KEY,
	scores      TEXT DEFAULT '[]',
	average     REAL DEFAULT 0.0,
	sample_size INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS intent_accuracy (
	intent   TEXT PRIMARY KEY,
	correct  INTEGER DEFAULT 0,
	total    INTEGER DEFAULT 0,
	accuracy REAL DEFAULT 0.0
);

CREATE TABLE IF NOT EXISTS intent_counts (
	intent TEXT PRIMARY KEY,
	count  INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS schema_version (
	version INTEGER PRIMARY KEY
);
`

// ─── Initialization ─────────────────────────────────────────────────────────

function ensureDbDir() {
	if (!fs.existsSync(DB_DIR)) {
		fs.mkdirSync(DB_DIR, { recursive: true })
	}
}

function getDb() {
	if (!db) {
		ensureDbDir()
		db = new Database(DB_PATH)
		db.pragma("journal_mode = WAL")
		db.pragma("foreign_keys = ON")
		db.exec(SCHEMA)
	}
	return db
}

function close() {
	if (db) {
		db.close()
		db = null
	}
}

// ─── Learner State ──────────────────────────────────────────────────────────

function setState(key, value) {
	const d = getDb()
	const stmt = d.prepare("INSERT OR REPLACE INTO learner_state (key, value) VALUES (?, ?)")
	stmt.run(key, JSON.stringify(value))
}

function getState(key) {
	const d = getDb()
	const row = d.prepare("SELECT value FROM learner_state WHERE key = ?").get(key)
	return row ? JSON.parse(row.value) : null
}

function getAllState() {
	const d = getDb()
	const rows = d.prepare("SELECT key, value FROM learner_state").all()
	const result = {}
	for (const row of rows) {
		result[row.key] = JSON.parse(row.value)
	}
	return result
}

// ─── Conversations ──────────────────────────────────────────────────────────

function insertConversation({ userId, chatId, message, intent, response, responseTimeMs, userSatisfied }) {
	const d = getDb()
	const stmt = d.prepare(`
		INSERT INTO conversations (user_id, chat_id, message, intent, response, response_time_ms, user_satisfied)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`)
	return stmt.run(
		userId || null,
		chatId || null,
		message || null,
		intent || null,
		response || null,
		responseTimeMs || null,
		userSatisfied === null ? null : userSatisfied ? 1 : 0,
	)
}

function getRecentConversations(limit = 1000) {
	const d = getDb()
	return d.prepare("SELECT * FROM conversations ORDER BY created_at DESC LIMIT ?").all(limit)
}

function searchConversations(query, limit = 5) {
	const d = getDb()
	const like = `%${query}%`
	return d
		.prepare(
			`
		SELECT * FROM conversations
		WHERE message LIKE ? OR response LIKE ?
		ORDER BY created_at DESC
		LIMIT ?
	`,
		)
		.all(like, like, limit)
}

function getConversationCount() {
	const d = getDb()
	const row = d.prepare("SELECT COUNT(*) as count FROM conversations").get()
	return row ? row.count : 0
}

function getConversationsByIntent(intent, limit = 1000) {
	const d = getDb()
	return d.prepare("SELECT * FROM conversations WHERE intent = ? ORDER BY created_at DESC LIMIT ?").all(intent, limit)
}

// ─── Patterns ───────────────────────────────────────────────────────────────

function upsertPattern(patternKey, { intent, keyword, confidence, occurrences }) {
	const d = getDb()
	const existing = d.prepare("SELECT * FROM patterns WHERE pattern_key = ?").get(patternKey)
	if (existing) {
		d.prepare(
			`
			UPDATE patterns SET confidence = ?, occurrences = occurrences + ?, updated_at = datetime('now')
			WHERE pattern_key = ?
		`,
		).run(confidence, occurrences || 1, patternKey)
	} else {
		d.prepare(
			`
			INSERT INTO patterns (pattern_key, intent, keyword, confidence, first_seen, occurrences)
			VALUES (?, ?, ?, ?, datetime('now'), ?)
		`,
		).run(patternKey, intent, keyword, confidence, occurrences || 1)
	}
}

function getAllPatterns() {
	const d = getDb()
	return d.prepare("SELECT * FROM patterns ORDER BY confidence DESC").all()
}

function getPatternsByIntent(intent) {
	const d = getDb()
	return d.prepare("SELECT * FROM patterns WHERE intent = ? ORDER BY confidence DESC").all(intent)
}

function getPatternCount() {
	const d = getDb()
	const row = d.prepare("SELECT COUNT(*) as count FROM patterns").get()
	return row ? row.count : 0
}

// ─── User Preferences ───────────────────────────────────────────────────────

function upsertUserPreference(userId, { favoriteCommands, favoriteProjects, workflows, lastActive }) {
	const d = getDb()
	d.prepare(
		`
		INSERT INTO user_preferences (user_id, favorite_commands, favorite_projects, workflows, last_active)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(user_id) DO UPDATE SET
			favorite_commands = excluded.favorite_commands,
			favorite_projects = excluded.favorite_projects,
			workflows = excluded.workflows,
			last_active = excluded.last_active
	`,
	).run(
		userId,
		JSON.stringify(favoriteCommands || []),
		JSON.stringify(favoriteProjects || []),
		JSON.stringify(workflows || []),
		lastActive || new Date().toISOString(),
	)
}

function getUserPreference(userId) {
	const d = getDb()
	const row = d.prepare("SELECT * FROM user_preferences WHERE user_id = ?").get(userId)
	if (!row) return null
	return {
		userId: row.user_id,
		favoriteCommands: JSON.parse(row.favorite_commands),
		favoriteProjects: JSON.parse(row.favorite_projects),
		workflows: JSON.parse(row.workflows),
		lastActive: row.last_active,
	}
}

function getAllUserPreferences() {
	const d = getDb()
	const rows = d.prepare("SELECT * FROM user_preferences").all()
	const result = {}
	for (const row of rows) {
		result[row.user_id] = {
			favoriteCommands: JSON.parse(row.favorite_commands),
			favoriteProjects: JSON.parse(row.favorite_projects),
			workflows: JSON.parse(row.workflows),
			lastActive: row.last_active,
		}
	}
	return result
}

// ─── Frustration Log ────────────────────────────────────────────────────────

function upsertFrustrationLog(userId, { count, lastFrustration, contexts }) {
	const d = getDb()
	d.prepare(
		`
		INSERT INTO frustration_log (user_id, count, last_frustration, contexts)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(user_id) DO UPDATE SET
			count = excluded.count,
			last_frustration = excluded.last_frustration,
			contexts = excluded.contexts
	`,
	).run(userId, count || 0, lastFrustration || null, JSON.stringify(contexts || []))
}

function getFrustrationLog(userId) {
	const d = getDb()
	const row = d.prepare("SELECT * FROM frustration_log WHERE user_id = ?").get(userId)
	if (!row) return null
	return {
		userId: row.user_id,
		count: row.count,
		lastFrustration: row.last_frustration,
		contexts: JSON.parse(row.contexts),
	}
}

function getAllFrustrationLogs() {
	const d = getDb()
	const rows = d.prepare("SELECT * FROM frustration_log").all()
	const result = {}
	for (const row of rows) {
		result[row.user_id] = {
			count: row.count,
			lastFrustration: row.last_frustration,
			contexts: JSON.parse(row.contexts),
		}
	}
	return result
}

// ─── Response Quality ───────────────────────────────────────────────────────

function upsertResponseQuality(intent, { scores, average, sampleSize }) {
	const d = getDb()
	d.prepare(
		`
		INSERT INTO response_quality (intent, scores, average, sample_size)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(intent) DO UPDATE SET
			scores = excluded.scores,
			average = excluded.average,
			sample_size = excluded.sample_size
	`,
	).run(intent, JSON.stringify(scores || []), average || 0, sampleSize || 0)
}

function getResponseQuality(intent) {
	const d = getDb()
	const row = d.prepare("SELECT * FROM response_quality WHERE intent = ?").get(intent)
	if (!row) return null
	return {
		intent: row.intent,
		scores: JSON.parse(row.scores),
		average: row.average,
		sampleSize: row.sample_size,
	}
}

function getAllResponseQuality() {
	const d = getDb()
	const rows = d.prepare("SELECT * FROM response_quality").all()
	const result = {}
	for (const row of rows) {
		result[row.intent] = {
			scores: JSON.parse(row.scores),
			average: row.average,
			sampleSize: row.sample_size,
		}
	}
	return result
}

// ─── Intent Accuracy ────────────────────────────────────────────────────────

function upsertIntentAccuracy(intent, { correct, total, accuracy }) {
	const d = getDb()
	d.prepare(
		`
		INSERT INTO intent_accuracy (intent, correct, total, accuracy)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(intent) DO UPDATE SET
			correct = excluded.correct,
			total = excluded.total,
			accuracy = excluded.accuracy
	`,
	).run(intent, correct || 0, total || 0, accuracy || 0)
}

function getIntentAccuracy(intent) {
	const d = getDb()
	const row = d.prepare("SELECT * FROM intent_accuracy WHERE intent = ?").get(intent)
	if (!row) return null
	return {
		intent: row.intent,
		correct: row.correct,
		total: row.total,
		accuracy: row.accuracy,
	}
}

function getAllIntentAccuracy() {
	const d = getDb()
	const rows = d.prepare("SELECT * FROM intent_accuracy").all()
	const result = {}
	for (const row of rows) {
		result[row.intent] = {
			correct: row.correct,
			total: row.total,
			accuracy: row.accuracy,
		}
	}
	return result
}

// ─── Intent Counts ──────────────────────────────────────────────────────────

function incrementIntentCount(intent) {
	const d = getDb()
	d.prepare(
		`
		INSERT INTO intent_counts (intent, count) VALUES (?, 1)
		ON CONFLICT(intent) DO UPDATE SET count = count + 1
	`,
	).run(intent)
}

function getIntentCounts() {
	const d = getDb()
	const rows = d.prepare("SELECT * FROM intent_counts ORDER BY count DESC").all()
	const result = {}
	for (const row of rows) {
		result[row.intent] = row.count
	}
	return result
}

function getTotalInteractions() {
	const d = getDb()
	const row = d.prepare("SELECT SUM(count) as total FROM intent_counts").get()
	return row ? row.total || 0 : 0
}

// ─── Migration from JSON files ──────────────────────────────────────────────

function migrateFromJson(jsonDir) {
	const d = getDb()
	const migrate = d.transaction(() => {
		let migrated = 0

		// 1. Learner state
		const statePath = path.join(jsonDir, "telegram-learner-state.json")
		if (fs.existsSync(statePath)) {
			const state = JSON.parse(fs.readFileSync(statePath, "utf8"))
			setState("totalConversations", state.totalConversations || 0)
			setState("totalInteractions", state.totalInteractions || 0)
			setState("modelVersion", state.modelVersion || 2)
			setState("lastTrainingAt", state.lastTrainingAt || null)

			// Intent counts
			if (state.intentCounts) {
				for (const [intent, count] of Object.entries(state.intentCounts)) {
					d.prepare("INSERT OR REPLACE INTO intent_counts (intent, count) VALUES (?, ?)").run(intent, count)
				}
			}

			// Intent accuracy
			if (state.intentAccuracy) {
				for (const [intent, data] of Object.entries(state.intentAccuracy)) {
					upsertIntentAccuracy(intent, data)
				}
			}

			// Response quality
			if (state.responseQuality) {
				for (const [intent, data] of Object.entries(state.responseQuality)) {
					upsertResponseQuality(intent, {
						scores: data.scores || [],
						average: data.average || 0,
						sampleSize: (data.scores || []).length,
					})
				}
			}

			migrated++
			console.log("[telegram-learner-db] Migrated learner state")
		}

		// 2. Patterns
		const patternsPath = path.join(jsonDir, "telegram-patterns.json")
		if (fs.existsSync(patternsPath)) {
			const patterns = JSON.parse(fs.readFileSync(patternsPath, "utf8"))
			for (const [key, pattern] of Object.entries(patterns)) {
				upsertPattern(key, pattern)
			}
			migrated++
			console.log("[telegram-learner-db] Migrated " + Object.keys(patterns).length + " patterns")
		}

		// 3. User preferences
		const prefsPath = path.join(jsonDir, "telegram-user-preferences.json")
		if (fs.existsSync(prefsPath)) {
			const prefs = JSON.parse(fs.readFileSync(prefsPath, "utf8"))
			for (const [userId, data] of Object.entries(prefs)) {
				upsertUserPreference(userId, data)
			}
			migrated++
			console.log("[telegram-learner-db] Migrated " + Object.keys(prefs).length + " user preferences")
		}

		// 4. Frustration log
		const frustPath = path.join(jsonDir, "telegram-frustration-log.json")
		if (fs.existsSync(frustPath)) {
			const frust = JSON.parse(fs.readFileSync(frustPath, "utf8"))
			for (const [userId, data] of Object.entries(frust)) {
				upsertFrustrationLog(userId, data)
			}
			migrated++
			console.log("[telegram-learner-db] Migrated " + Object.keys(frust).length + " frustration logs")
		}

		// 5. Conversation log (JSONL)
		const convPath = path.join(jsonDir, "telegram-conversations.jsonl")
		if (fs.existsSync(convPath)) {
			const lines = fs.readFileSync(convPath, "utf8").split("\n").filter(Boolean)
			const insert = d.prepare(`
				INSERT INTO conversations (user_id, chat_id, message, intent, response, response_time_ms, user_satisfied, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			`)
			let count = 0
			for (const line of lines) {
				try {
					const entry = JSON.parse(line)
					insert.run(
						entry.userId || null,
						entry.chatId || null,
						entry.message || null,
						entry.intent || null,
						null, // response not in JSONL
						entry.responseTimeMs || null,
						entry.userSatisfied === null ? null : entry.userSatisfied ? 1 : 0,
						entry.ts || null,
					)
					count++
				} catch (_) {
					// skip malformed lines
				}
			}
			migrated++
			console.log("[telegram-learner-db] Migrated " + count + " conversation entries")
		}

		d.prepare("INSERT OR REPLACE INTO schema_version (version) VALUES (1)").run()
		return migrated
	})

	return migrate()
}

// ─── Stats ──────────────────────────────────────────────────────────────────

function getStats() {
	const d = getDb()
	const totalConversations = getState("totalConversations") || 0
	const totalInteractions = getTotalInteractions()
	const intentCounts = getIntentCounts()
	const responseQuality = getAllResponseQuality()
	const patternCount = getPatternCount()
	const modelVersion = getState("modelVersion") || 2
	const lastTrainingAt = getState("lastTrainingAt")

	const formattedQuality = {}
	for (const [k, v] of Object.entries(responseQuality)) {
		formattedQuality[k] = {
			average: v.average,
			sampleSize: v.sampleSize,
		}
	}

	return {
		totalConversations,
		totalInteractions,
		intentCounts,
		responseQuality: formattedQuality,
		knownPatterns: patternCount,
		modelVersion,
		lastTrainingAt,
	}
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
	getDb,
	close,
	setState,
	getState,
	getAllState,
	insertConversation,
	getRecentConversations,
	searchConversations,
	getConversationCount,
	getConversationsByIntent,
	upsertPattern,
	getAllPatterns,
	getPatternsByIntent,
	getPatternCount,
	upsertUserPreference,
	getUserPreference,
	getAllUserPreferences,
	upsertFrustrationLog,
	getFrustrationLog,
	getAllFrustrationLogs,
	upsertResponseQuality,
	getResponseQuality,
	getAllResponseQuality,
	upsertIntentAccuracy,
	getIntentAccuracy,
	getAllIntentAccuracy,
	incrementIntentCount,
	getIntentCounts,
	getTotalInteractions,
	migrateFromJson,
	getStats,
}
