/**
 * SuperRoo Cloud — Feature Knowledge Indexer
 *
 * Scans SuperRoo product feature docs from the docs/ directory and indexes
 * them into a local SQLite FTS5 database. Used by FeatureAnswerer to retrieve
 * relevant context before querying Ollama.
 *
 * Storage: cloud/data/feature-knowledge.db (SQLite, better-sqlite3)
 * Search:  FTS5 full-text search with keyword LIKE fallback
 *
 * Indexed directories (relative to SUPERROO_ROOT):
 *   docs/super-roo/          — architecture, guides, feature prompts
 *   docs/agent-workflow/     — agent routing and workflow docs
 *   docs/resources/          — research and reference material
 *   docs/intelligence-layer/ — intelligence layer docs
 */

const Database = require("better-sqlite3")
const fs = require("fs")
const path = require("path")

// ── Config ──────────────────────────────────────────────────────────────────

const PROJECT_ROOT = process.env.SUPERROO_ROOT || "/opt/superroo2"
const DB_PATH = path.join(PROJECT_ROOT, "cloud/data/feature-knowledge.db")

// Directories to scan (relative to PROJECT_ROOT). Order matters: higher-priority docs first.
const DOC_DIRS = ["docs/super-roo", "docs/agent-workflow", "docs/resources", "docs/intelligence-layer"]

// Max lines per chunk before starting a new one (prevents huge chunks)
const MAX_CHUNK_LINES = 60

// ═══════════════════════════════════════════════════════════════════════════════
// FeatureKnowledgeIndexer
// ═══════════════════════════════════════════════════════════════════════════════

class FeatureKnowledgeIndexer {
	/**
	 * @param {object} [opts]
	 * @param {string} [opts.dbPath]        - Override default SQLite path
	 * @param {string} [opts.projectRoot]   - Override project root for doc scanning
	 */
	constructor(opts = {}) {
		this.dbPath = opts.dbPath || DB_PATH
		this.projectRoot = opts.projectRoot || PROJECT_ROOT
		/** @type {import("better-sqlite3").Database|null} */
		this.db = null
		this._ready = false
	}

	/**
	 * Initialize the SQLite database and create tables/triggers if they don't exist.
	 * Idempotent — safe to call multiple times.
	 */
	init() {
		if (this._ready) return this

		const dir = path.dirname(this.dbPath)
		if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

		this.db = new Database(this.dbPath)
		this.db.pragma("journal_mode = WAL")
		this.db.pragma("synchronous = NORMAL")

		// Content table
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS feature_chunks (
				id         INTEGER PRIMARY KEY AUTOINCREMENT,
				source_file TEXT    NOT NULL,
				section     TEXT    NOT NULL,
				chunk_text  TEXT    NOT NULL,
				indexed_at  INTEGER NOT NULL
			);
		`)

		// FTS5 virtual table — content= links it to feature_chunks
		this.db.exec(`
			CREATE VIRTUAL TABLE IF NOT EXISTS feature_chunks_fts
			USING fts5(
				source_file,
				section,
				chunk_text,
				content=feature_chunks,
				content_rowid=id,
				tokenize='porter unicode61'
			);
		`)

		// Triggers to keep FTS in sync with content table
		this.db.exec(`
			CREATE TRIGGER IF NOT EXISTS fci_ai AFTER INSERT ON feature_chunks BEGIN
				INSERT INTO feature_chunks_fts(rowid, source_file, section, chunk_text)
				VALUES (new.id, new.source_file, new.section, new.chunk_text);
			END;

			CREATE TRIGGER IF NOT EXISTS fci_ad AFTER DELETE ON feature_chunks BEGIN
				INSERT INTO feature_chunks_fts(feature_chunks_fts, rowid, source_file, section, chunk_text)
				VALUES ('delete', old.id, old.source_file, old.section, old.chunk_text);
			END;

			CREATE TRIGGER IF NOT EXISTS fci_au AFTER UPDATE ON feature_chunks BEGIN
				INSERT INTO feature_chunks_fts(feature_chunks_fts, rowid, source_file, section, chunk_text)
				VALUES ('delete', old.id, old.source_file, old.section, old.chunk_text);
				INSERT INTO feature_chunks_fts(rowid, source_file, section, chunk_text)
				VALUES (new.id, new.source_file, new.section, new.chunk_text);
			END;
		`)

		this._ready = true
		return this
	}

	/**
	 * Index all docs. Clears the existing index and rebuilds it from scratch.
	 * Safe to call on startup and after doc updates.
	 *
	 * @returns {number} Number of chunks indexed
	 */
	indexAll() {
		if (!this._ready) this.init()

		// Clear existing data
		this.db.exec("DELETE FROM feature_chunks")
		this.db.exec("INSERT INTO feature_chunks_fts(feature_chunks_fts) VALUES('rebuild')")

		const insertChunk = this.db.prepare(
			"INSERT INTO feature_chunks (source_file, section, chunk_text, indexed_at) VALUES (?, ?, ?, ?)",
		)

		let totalChunks = 0
		let totalFiles = 0

		for (const docDir of DOC_DIRS) {
			const fullDir = path.join(this.projectRoot, docDir)
			if (!fs.existsSync(fullDir)) {
				console.log(`[FeatureKnowledgeIndexer] Skipping missing dir: ${docDir}`)
				continue
			}

			const mdFiles = this._walkMd(fullDir)
			for (const filePath of mdFiles) {
				const relPath = path.relative(this.projectRoot, filePath).replace(/\\/g, "/")
				const chunks = this._chunkFile(filePath)

				const insertMany = this.db.transaction((items) => {
					for (const { section, text } of items) {
						insertChunk.run(relPath, section, text, Date.now())
					}
				})
				insertMany(chunks)

				totalChunks += chunks.length
				totalFiles++
			}
		}

		// Rebuild FTS index after bulk insert
		this.db.exec("INSERT INTO feature_chunks_fts(feature_chunks_fts) VALUES('rebuild')")

		console.log(
			`[FeatureKnowledgeIndexer] Indexed ${totalChunks} chunks from ${totalFiles} files across ${DOC_DIRS.length} directories`,
		)
		return totalChunks
	}

	/**
	 * Search for chunks relevant to a question.
	 * Tries FTS5 first, falls back to LIKE search if FTS fails or returns nothing.
	 *
	 * @param {string} query
	 * @param {number} [limit=6]
	 * @returns {{ source_file: string, section: string, chunk_text: string }[]}
	 */
	search(query, limit = 6) {
		if (!this._ready) this.init()
		if (!query || !query.trim()) return []

		// ── FTS5 search ────────────────────────────────────────────────────
		try {
			// Sanitize query for FTS5: remove special chars that break FTS syntax
			const ftsQuery = query
				.replace(/['"]/g, "")
				.replace(/[^a-zA-Z0-9\s]/g, " ")
				.trim()

			if (ftsQuery.length > 0) {
				const rows = this.db
					.prepare(
						`SELECT f.source_file, f.section, f.chunk_text
						 FROM feature_chunks_fts fts
						 JOIN feature_chunks f ON f.id = fts.rowid
						 WHERE feature_chunks_fts MATCH ?
						 ORDER BY rank
						 LIMIT ?`,
					)
					.all(ftsQuery, limit)

				if (rows.length > 0) return rows
			}
		} catch (err) {
			console.warn(`[FeatureKnowledgeIndexer] FTS5 search failed: ${err.message}, using LIKE fallback`)
		}

		// ── LIKE fallback ──────────────────────────────────────────────────
		const words = query
			.toLowerCase()
			.split(/\s+/)
			.filter((w) => w.length > 2)

		if (words.length === 0) return []

		const conditions = words.map(() => "(LOWER(chunk_text) LIKE ? OR LOWER(section) LIKE ?)").join(" OR ")
		const params = words.flatMap((w) => [`%${w}%`, `%${w}%`])
		params.push(limit)

		return this.db
			.prepare(
				`SELECT source_file, section, chunk_text
				 FROM feature_chunks
				 WHERE ${conditions}
				 LIMIT ?`,
			)
			.all(...params)
	}

	/**
	 * Get stats about the current index.
	 * @returns {{ chunks: number, files: number, indexed: boolean }}
	 */
	getStats() {
		if (!this._ready) this.init()
		const { count: chunks } = this.db.prepare("SELECT COUNT(*) as count FROM feature_chunks").get()
		const { count: files } = this.db
			.prepare("SELECT COUNT(DISTINCT source_file) as count FROM feature_chunks")
			.get()
		return { chunks, files, indexed: chunks > 0 }
	}

	// ── Private ──────────────────────────────────────────────────────────────

	/**
	 * Recursively walk a directory and return all .md file paths.
	 * @param {string} dir
	 * @returns {string[]}
	 */
	_walkMd(dir) {
		const results = []
		let entries
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true })
		} catch {
			return results
		}
		for (const entry of entries) {
			const full = path.join(dir, entry.name)
			if (entry.isDirectory()) {
				results.push(...this._walkMd(full))
			} else if (entry.isFile() && entry.name.endsWith(".md")) {
				results.push(full)
			}
		}
		return results
	}

	/**
	 * Split a markdown file into chunks by heading boundaries.
	 * Each H1/H2/H3 starts a new chunk. Chunks longer than MAX_CHUNK_LINES
	 * are split further.
	 *
	 * @param {string} filePath
	 * @returns {{ section: string, text: string }[]}
	 */
	_chunkFile(filePath) {
		let content
		try {
			content = fs.readFileSync(filePath, "utf-8")
		} catch {
			return []
		}

		const lines = content.split("\n")
		const baseName = path.basename(filePath, ".md")
		const chunks = []

		let currentSection = baseName
		let currentLines = []

		const flush = () => {
			const text = currentLines.join("\n").trim()
			if (text.length > 20) {
				chunks.push({ section: currentSection, text })
			}
			currentLines = []
		}

		for (const line of lines) {
			if (/^#{1,3}\s/.test(line)) {
				flush()
				currentSection = line.replace(/^#{1,3}\s+/, "").trim() || baseName
				currentLines = [line]
			} else {
				currentLines.push(line)
				// Split large chunks mid-section
				if (currentLines.length >= MAX_CHUNK_LINES) {
					flush()
				}
			}
		}
		flush()

		return chunks
	}
}

module.exports = { FeatureKnowledgeIndexer }
