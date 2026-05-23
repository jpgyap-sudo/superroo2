/**
 * MemoryStore — SQLite persistence layer for the Cloud Orchestrator.
 * Ported from src/super-roo/memory/MemoryStore.ts
 *
 * Provides atomic CRUD operations, schema initialization, and transaction support.
 * Uses better-sqlite3 for synchronous, high-performance SQLite access.
 */

const Database = require("better-sqlite3")
const path = require("path")
const fs = require("fs")
const crypto = require("crypto")

const SCHEMA_PATH = path.join(__dirname, "schema.sql")

class MemoryStore {
	/**
	 * @param {string} dbPath - Path to the SQLite database file
	 * @param {object} [options]
	 * @param {boolean} [options.wal=true] - Enable WAL mode for better concurrency
	 */
	constructor(dbPath, options = {}) {
		this.dbPath = dbPath
		this.wal = options.wal !== false
		/** @type {import('better-sqlite3').Database|null} */
		this.db = null
	}

	/**
	 * Initialize the database: create directory, open connection, apply schema.
	 */
	initialize() {
		const dir = path.dirname(this.dbPath)
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true })
		}

		this.db = new Database(this.dbPath)

		if (this.wal) {
			this.db.pragma("journal_mode = WAL")
		}
		this.db.pragma("foreign_keys = ON")

		this._applySchema()
		return this
	}

	/**
	 * Apply the SQL schema from schema.sql.
	 */
	_applySchema() {
		const sql = fs.readFileSync(SCHEMA_PATH, "utf-8")
		this.db.exec(sql)
		this._applyMigrations()
	}

	/**
	 * Apply pending numbered SQL migrations from stores/migrations/.
	 * Tracks applied migrations in a _migrations table.
	 * Never edits a shipped migration — create a new numbered file.
	 */
	_applyMigrations() {
		// Ensure migration tracking table exists
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS _migrations (
				id INTEGER PRIMARY KEY,
				name TEXT NOT NULL UNIQUE,
				applied_at INTEGER NOT NULL
			)
		`)

		if (!fs.existsSync(MIGRATIONS_DIR)) return

		const files = fs
			.readdirSync(MIGRATIONS_DIR)
			.filter((f) => f.endsWith(".sql"))
			.sort()

		const applied = new Set(
			this.db
				.prepare("SELECT name FROM _migrations")
				.all()
				.map((r) => r.name),
		)

		const insert = this.db.prepare("INSERT INTO _migrations (id, name, applied_at) VALUES (?, ?, ?)")

		for (const file of files) {
			if (applied.has(file)) continue
			const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8")
			this.db.exec(sql)
			const id = parseInt(file.match(/^(\d+)/)?.[1] || "0", 10)
			insert.run(id, file, Date.now())
		}
	}

	/**
	 * Close the database connection.
	 */
	close() {
		if (this.db) {
			this.db.close()
			this.db = null
		}
	}

	/**
	 * Get the underlying better-sqlite3 Database instance.
	 * @returns {import('better-sqlite3').Database}
	 */
	getDb() {
		if (!this.db) {
			throw new Error("MemoryStore not initialized. Call initialize() first.")
		}
		return this.db
	}

	// ─── Generic Key-Value Store ────────────────────────────────────────

	/**
	 * Store a key-value pair.
	 * @param {string} key
	 * @param {string} value
	 * @param {string} [category='general']
	 */
	set(key, value, category = "general") {
		const now = Date.now()
		const stmt = this.db.prepare(
			`INSERT INTO memory_store (key, value, category, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, category = excluded.category, updated_at = excluded.updated_at`,
		)
		stmt.run(key, value, category, now, now)
	}

	/**
	 * Retrieve a value by key.
	 * @param {string} key
	 * @returns {string|null}
	 */
	get(key) {
		const row = this.db.prepare("SELECT value FROM memory_store WHERE key = ?").get(key)
		return row ? row.value : null
	}

	/**
	 * Delete a key.
	 * @param {string} key
	 * @returns {boolean}
	 */
	delete(key) {
		const result = this.db.prepare("DELETE FROM memory_store WHERE key = ?").run(key)
		return result.changes > 0
	}

	/**
	 * List all keys in a category.
	 * @param {string} category
	 * @returns {Array<{key: string, value: string, updated_at: number}>}
	 */
	listByCategory(category) {
		return this.db
			.prepare("SELECT key, value, updated_at FROM memory_store WHERE category = ? ORDER BY updated_at DESC")
			.all(category)
	}

	// ─── ID Generation ──────────────────────────────────────────────────

	/**
	 * Generate a unique ID.
	 * @returns {string}
	 */
	static generateId() {
		return crypto.randomUUID()
	}

	/**
	 * Generate a timestamp-based ID (sortable).
	 * @returns {string}
	 */
	static generateTimeId() {
		const ts = Date.now().toString(36)
		const rand = crypto.randomBytes(4).toString("hex")
		return `${ts}-${rand}`
	}
}

module.exports = MemoryStore
