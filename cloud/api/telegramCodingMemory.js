/**
 * Coding Memory — Persistent Cross-Session Coding Memory
 *
 * Stores user-specific coding preferences, project conventions,
 * common error patterns, and successful fix strategies across sessions.
 * Inspired by VoltAgent's memory system with REST API and managed memory.
 *
 * Memory types:
 *   - user_prefs: User's preferred coding patterns (test-first, doc-first, etc.)
 *   - project_conventions: Project-specific conventions (lint rules, test framework)
 *   - error_patterns: Common error patterns per project with fix strategies
 *   - fix_strategies: Previously successful fix approaches
 *   - coding_patterns: Reusable coding patterns detected across sessions
 *
 * Storage: In-memory Map with periodic persistence to JSON file.
 * Redis integration available via RedisBackedMap pattern.
 *
 * @module telegramCodingMemory
 */

const fs = require("fs").promises
const path = require("path")

// ─── Configuration ──────────────────────────────────────────────────────────

/** Path to persist memory data */
const MEMORY_FILE = path.join(__dirname, "..", "..", "server", "src", "memory", "telegram-coding-memory.json")

/** Auto-save interval in ms (5 minutes) */
const AUTO_SAVE_INTERVAL_MS = 5 * 60 * 1000

/** Max entries per memory category */
const MAX_ENTRIES_PER_CATEGORY = {
	user_prefs: 100,
	project_conventions: 200,
	error_patterns: 500,
	fix_strategies: 300,
	coding_patterns: 200,
}

/** Score decay: each time a pattern is reinforced, score += 1. Decay 5% per week. */
const SCORE_DECAY_RATE = 0.05

// ─── In-Memory Store ────────────────────────────────────────────────────────

/** @type {Object<string, Array<Object>>} */
var _memory = {
	user_prefs: [],
	project_conventions: [],
	error_patterns: [],
	fix_strategies: [],
	coding_patterns: [],
}

/** @type {boolean} */
var _loaded = false

/** @type {number|null} */
var _saveTimer = null

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Get current timestamp in ms.
 * @returns {number}
 */
function _now() {
	return Date.now()
}

/**
 * Apply score decay to an entry based on age.
 * @param {Object} entry
 */
function _applyDecay(entry) {
	if (!entry.lastAccessed) return
	var ageWeeks = (_now() - entry.lastAccessed) / (7 * 24 * 60 * 60 * 1000)
	if (ageWeeks > 1) {
		var decay = Math.floor(ageWeeks * SCORE_DECAY_RATE * entry.score)
		entry.score = Math.max(0, entry.score - decay)
	}
	entry.lastAccessed = _now()
}

/**
 * Find an entry by key in a category.
 * @param {string} category
 * @param {string} key
 * @returns {Object|undefined}
 */
function _findByKey(category, key) {
	var entries = _memory[category]
	if (!entries) return undefined
	for (var i = 0; i < entries.length; i++) {
		if (entries[i].key === key) return entries[i]
	}
	return undefined
}

/**
 * Ensure a category exists.
 * @param {string} category
 */
function _ensureCategory(category) {
	if (!_memory[category]) {
		_memory[category] = []
	}
}

// ─── Core API ───────────────────────────────────────────────────────────────

/**
 * Load memory from disk. Called once at startup.
 * @returns {Promise<boolean>} Whether memory was loaded successfully
 */
async function loadMemory() {
	if (_loaded) return true
	try {
		var data = await fs.readFile(MEMORY_FILE, "utf8")
		var parsed = JSON.parse(data)
		// Merge with defaults to handle new categories
		for (var cat in _memory) {
			if (parsed[cat] && Array.isArray(parsed[cat])) {
				_memory[cat] = parsed[cat]
			}
		}
		_loaded = true
		console.log("[CodingMemory] Loaded " + _getTotalEntries() + " entries from " + MEMORY_FILE)
		return true
	} catch (err) {
		if (err.code === "ENOENT") {
			console.log("[CodingMemory] No existing memory file — starting fresh")
			_loaded = true
			return true
		}
		console.error("[CodingMemory] Failed to load memory:", err.message)
		_loaded = true // Don't block usage on load failure
		return false
	}
}

/**
 * Save memory to disk.
 * @returns {Promise<boolean>}
 */
async function saveMemory() {
	try {
		await fs.writeFile(MEMORY_FILE, JSON.stringify(_memory, null, 2), "utf8")
		return true
	} catch (err) {
		console.error("[CodingMemory] Failed to save memory:", err.message)
		return false
	}
}

/**
 * Start auto-save timer.
 */
function startAutoSave() {
	if (_saveTimer) return
	_saveTimer = setInterval(function () {
		saveMemory().catch(function (err) {
			console.error("[CodingMemory] Auto-save failed:", err.message)
		})
	}, AUTO_SAVE_INTERVAL_MS)
	_saveTimer.unref()
	console.log("[CodingMemory] Auto-save every " + AUTO_SAVE_INTERVAL_MS / 1000 + "s")
}

/**
 * Stop auto-save timer.
 */
function stopAutoSave() {
	if (_saveTimer) {
		clearInterval(_saveTimer)
		_saveTimer = null
	}
}

/**
 * Get total number of entries across all categories.
 * @returns {number}
 */
function _getTotalEntries() {
	var total = 0
	for (var cat in _memory) {
		total += _memory[cat].length
	}
	return total
}

// ─── Memory Operations ──────────────────────────────────────────────────────

/**
 * Store a memory entry.
 * @param {string} category - Memory category
 * @param {string} key - Unique key for deduplication
 * @param {*} value - The value to store
 * @param {Object} [opts]
 * @param {number} [opts.score=1] - Initial relevance score
 * @param {string} [opts.userId] - Associated user ID
 * @param {string} [opts.projectName] - Associated project name
 * @param {string[]} [opts.tags] - Searchable tags
 * @param {string} [opts.summary] - Human-readable summary
 * @returns {Object} The stored entry
 */
function store(category, key, value, opts) {
	opts = opts || {}
	_ensureCategory(category)

	var maxEntries = MAX_ENTRIES_PER_CATEGORY[category] || 100
	var existing = _findByKey(category, key)

	if (existing) {
		// Update existing entry — reinforce score
		existing.value = value
		existing.score = (existing.score || 0) + (opts.score || 1)
		existing.lastUpdated = _now()
		existing.lastAccessed = _now()
		if (opts.userId) existing.userId = opts.userId
		if (opts.projectName) existing.projectName = opts.projectName
		if (opts.tags) {
			existing.tags = Array.from(new Set((existing.tags || []).concat(opts.tags)))
		}
		if (opts.summary) existing.summary = opts.summary
		return existing
	}

	// Enforce max entries — evict lowest score
	var entries = _memory[category]
	if (entries.length >= maxEntries) {
		entries.sort(function (a, b) {
			return (a.score || 0) - (b.score || 0)
		})
		entries.shift()
	}

	var entry = {
		key: key,
		value: value,
		score: opts.score || 1,
		userId: opts.userId || null,
		projectName: opts.projectName || null,
		tags: opts.tags || [],
		summary: opts.summary || null,
		createdAt: _now(),
		lastUpdated: _now(),
		lastAccessed: _now(),
	}

	entries.push(entry)
	return entry
}

/**
 * Retrieve memory entries by category with optional filters.
 * @param {string} category - Memory category
 * @param {Object} [filters]
 * @param {string} [filters.userId] - Filter by user ID
 * @param {string} [filters.projectName] - Filter by project name
 * @param {string[]} [filters.tags] - Filter by tags (any match)
 * @param {number} [filters.minScore=0] - Minimum score threshold
 * @param {number} [filters.limit=20] - Max results
 * @returns {Array<Object>} Sorted by score descending
 */
function retrieve(category, filters) {
	filters = filters || {}
	_ensureCategory(category)

	var entries = _memory[category].filter(function (e) {
		if (filters.userId && e.userId !== filters.userId) return false
		if (filters.projectName && e.projectName !== filters.projectName) return false
		if (filters.tags && filters.tags.length > 0) {
			var hasTag = filters.tags.some(function (t) {
				return e.tags && e.tags.indexOf(t) !== -1
			})
			if (!hasTag) return false
		}
		if (filters.minScore && (e.score || 0) < filters.minScore) return false
		return true
	})

	// Apply decay and sort
	entries.forEach(_applyDecay)
	entries.sort(function (a, b) {
		return (b.score || 0) - (a.score || 0)
	})

	var limit = filters.limit || 20
	return entries.slice(0, limit)
}

/**
 * Search memory across all categories by text.
 * @param {string} query - Search text
 * @param {Object} [filters]
 * @param {number} [filters.limit=10]
 * @returns {Array<Object>} Results with category info
 */
function search(query, filters) {
	filters = filters || {}
	var lower = query.toLowerCase()
	var results = []

	for (var cat in _memory) {
		var entries = _memory[cat]
		for (var i = 0; i < entries.length; i++) {
			var e = entries[i]
			var match = false

			// Search in key
			if (e.key && e.key.toLowerCase().indexOf(lower) !== -1) match = true
			// Search in summary
			if (!match && e.summary && e.summary.toLowerCase().indexOf(lower) !== -1) match = true
			// Search in tags
			if (!match && e.tags) {
				for (var ti = 0; ti < e.tags.length; ti++) {
					if (e.tags[ti].toLowerCase().indexOf(lower) !== -1) {
						match = true
						break
					}
				}
			}
			// Search in value (stringify)
			if (!match && e.value) {
				try {
					var str = typeof e.value === "string" ? e.value : JSON.stringify(e.value)
					if (str.toLowerCase().indexOf(lower) !== -1) match = true
				} catch (_) {}
			}

			if (match) {
				_applyDecay(e)
				results.push({
					category: cat,
					key: e.key,
					score: e.score,
					summary: e.summary,
					userId: e.userId,
					projectName: e.projectName,
					tags: e.tags,
					lastAccessed: e.lastAccessed,
				})
			}
		}
	}

	results.sort(function (a, b) {
		return (b.score || 0) - (a.score || 0)
	})

	var limit = filters.limit || 10
	return results.slice(0, limit)
}

/**
 * Delete a memory entry.
 * @param {string} category
 * @param {string} key
 * @returns {boolean} Whether an entry was deleted
 */
function remove(category, key) {
	_ensureCategory(category)
	var entries = _memory[category]
	var idx = -1
	for (var i = 0; i < entries.length; i++) {
		if (entries[i].key === key) {
			idx = i
			break
		}
	}
	if (idx !== -1) {
		entries.splice(idx, 1)
		return true
	}
	return false
}

/**
 * Clear all entries in a category, or all categories.
 * @param {string} [category] - If omitted, clears everything
 */
function clear(category) {
	if (category) {
		_ensureCategory(category)
		_memory[category] = []
	} else {
		for (var cat in _memory) {
			_memory[cat] = []
		}
	}
}

// ─── Convenience Methods ────────────────────────────────────────────────────

/**
 * Store a user coding preference.
 * @param {string} userId
 * @param {string} prefKey - Preference key (e.g., "test_framework", "lint_enabled")
 * @param {*} value
 */
function storeUserPref(userId, prefKey, value) {
	store("user_prefs", userId + ":" + prefKey, value, {
		userId: userId,
		tags: ["user_pref", prefKey],
		summary: prefKey + " = " + (typeof value === "string" ? value : JSON.stringify(value)),
	})
}

/**
 * Get user coding preferences.
 * @param {string} userId
 * @returns {Object} Key-value map of preferences
 */
function getUserPrefs(userId) {
	var entries = retrieve("user_prefs", { userId: userId, limit: 50 })
	var prefs = {}
	for (var i = 0; i < entries.length; i++) {
		var e = entries[i]
		var key = e.key.split(":").slice(1).join(":")
		prefs[key] = e.value
	}
	return prefs
}

/**
 * Store a project convention.
 * @param {string} projectName
 * @param {string} conventionKey - e.g., "test_framework", "lint_rule"
 * @param {*} value
 */
function storeProjectConvention(projectName, conventionKey, value) {
	store("project_conventions", projectName + ":" + conventionKey, value, {
		projectName: projectName,
		tags: ["convention", conventionKey],
		summary:
			projectName + " " + conventionKey + " = " + (typeof value === "string" ? value : JSON.stringify(value)),
	})
}

/**
 * Get project conventions.
 * @param {string} projectName
 * @returns {Object} Key-value map of conventions
 */
function getProjectConventions(projectName) {
	var entries = retrieve("project_conventions", { projectName: projectName, limit: 50 })
	var conventions = {}
	for (var i = 0; i < entries.length; i++) {
		var e = entries[i]
		var key = e.key.split(":").slice(1).join(":")
		conventions[key] = e.value
	}
	return conventions
}

/**
 * Store an error pattern with fix strategy.
 * @param {string} projectName
 * @param {string} errorSignature - Unique error signature (e.g., error message hash)
 * @param {Object} pattern
 * @param {string} pattern.errorMessage - The error message
 * @param {string} pattern.fixStrategy - How to fix it
 * @param {string[]} [pattern.relatedFiles] - Files typically involved
 */
function storeErrorPattern(projectName, errorSignature, pattern) {
	store("error_patterns", projectName + ":" + errorSignature, pattern, {
		projectName: projectName,
		tags: ["error", projectName].concat(pattern.relatedFiles || []),
		summary: pattern.errorMessage ? pattern.errorMessage.slice(0, 100) : errorSignature,
	})
}

/**
 * Find fix strategies for an error.
 * @param {string} projectName
 * @param {string} errorMessage - The error message to match
 * @param {number} [limit=3]
 * @returns {Array<Object>} Matching error patterns with fix strategies
 */
function findFixForError(projectName, errorMessage, limit) {
	limit = limit || 3
	var lower = errorMessage.toLowerCase()
	var entries = retrieve("error_patterns", { projectName: projectName, limit: 20 })
	var matches = []

	for (var i = 0; i < entries.length; i++) {
		var e = entries[i]
		var msg = (e.value && e.value.errorMessage) || ""
		if (msg.toLowerCase().indexOf(lower) !== -1 || lower.indexOf(msg.toLowerCase()) !== -1) {
			matches.push(e)
		}
	}

	return matches.slice(0, limit)
}

/**
 * Store a successful fix strategy.
 * @param {string} projectName
 * @param {string} issueDescription - What was fixed
 * @param {Object} strategy
 * @param {string} strategy.approach - How it was fixed
 * @param {string[]} strategy.filesChanged - Files modified
 * @param {string} strategy.testResult - Test result after fix
 */
function storeFixStrategy(projectName, issueDescription, strategy) {
	store("fix_strategies", projectName + ":" + _now(), strategy, {
		projectName: projectName,
		tags: ["fix", projectName].concat(strategy.filesChanged || []),
		summary: issueDescription.slice(0, 100),
		score: 5, // Higher initial score for fix strategies
	})
}

/**
 * Get stats about stored memory.
 * @returns {Object}
 */
function getMemoryStats() {
	var stats = {}
	for (var cat in _memory) {
		stats[cat] = _memory[cat].length
	}
	stats.total = _getTotalEntries()
	stats.loaded = _loaded
	return stats
}

// ─── Initialize ─────────────────────────────────────────────────────────────

// Auto-load on require
loadMemory().then(function () {
	startAutoSave()
})

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
	// Core API
	loadMemory,
	saveMemory,
	startAutoSave,
	stopAutoSave,

	// Memory operations
	store,
	retrieve,
	search,
	remove,
	clear,

	// Convenience methods
	storeUserPref,
	getUserPrefs,
	storeProjectConvention,
	getProjectConventions,
	storeErrorPattern,
	findFixForError,
	storeFixStrategy,

	// Stats
	getMemoryStats,
}
