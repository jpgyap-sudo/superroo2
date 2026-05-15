/**
 * Migration Runner — Unified database migration system for SuperRoo Cloud.
 *
 * Supports both SQLite (better-sqlite3) and PostgreSQL (pg) backends.
 * Tracks applied migrations in a `_migrations` table with checksums.
 * Migrations are idempotent and support up/down operations.
 *
 * Usage:
 *   const { migrate, rollback, status } = require("./lib/migrationRunner")
 *   await migrate("sqlite", { db: sqliteDbInstance })
 *   await migrate("postgres", { connectionString: "postgresql://..." })
 *   await status("sqlite", { db })
 */

const fs = require("fs")
const path = require("path")
const crypto = require("crypto")

const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations")

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readMigrationFiles(engineFilter) {
	if (!fs.existsSync(MIGRATIONS_DIR)) {
		fs.mkdirSync(MIGRATIONS_DIR, { recursive: true })
		return []
	}

	const files = fs.readdirSync(MIGRATIONS_DIR)
	const migrationFiles = files.filter((f) => f.endsWith(".sql") && /^\d{4}[-_]/.test(f)).sort()

	return migrationFiles
		.map((file) => {
			const content = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8")
			const checksum = crypto.createHash("sha256").update(content).digest("hex")
			const [upPart, downPart] = content.split(/^--\s*DOWN\s*$/m)

			// Parse engine hint from comment: "-- Engine: sqlite" or "-- Engine: postgres"
			const engineMatch = content.match(/^--\s*Engine:\s*(\w+)/m)
			const engine = engineMatch ? engineMatch[1].toLowerCase() : null

			return {
				filename: file,
				checksum,
				up: (upPart || content).trim(),
				down: downPart ? downPart.trim() : null,
				engine,
			}
		})
		.filter((m) => {
			// If engine filter is specified, skip migrations for other engines
			if (engineFilter && m.engine && m.engine !== engineFilter) {
				return false
			}
			return true
		})
}

function parseMigrationName(filename) {
	// e.g. "0001_create_telegram_learner.sql" → { version: "0001", name: "create_telegram_learner" }
	const match = filename.match(/^(\d{4})[-_]?(.+)\.sql$/)
	if (!match) return { version: filename, name: filename.replace(".sql", "") }
	return { version: match[1], name: match[2] }
}

// ─── SQLite Adapter ──────────────────────────────────────────────────────────

const SQLITE_ADAPTER = {
	ensureMigrationsTable(db) {
		db.exec(`
			CREATE TABLE IF NOT EXISTS _migrations (
				filename  TEXT PRIMARY KEY,
				version   TEXT NOT NULL,
				name      TEXT NOT NULL,
				checksum  TEXT NOT NULL,
				applied_at TEXT DEFAULT (datetime('now')),
				duration_ms INTEGER DEFAULT 0
			)
		`)
	},

	getApplied(db) {
		const rows = db
			.prepare(
				"SELECT filename, version, name, checksum, applied_at, duration_ms FROM _migrations ORDER BY filename",
			)
			.all()
		return rows
	},

	isApplied(db, filename) {
		const row = db.prepare("SELECT filename FROM _migrations WHERE filename = ?").get(filename)
		return !!row
	},

	applyUp(db, migration) {
		const start = Date.now()
		db.exec(migration.up)
		const duration = Date.now() - start
		const { version, name } = parseMigrationName(migration.filename)
		db.prepare(
			"INSERT INTO _migrations (filename, version, name, checksum, duration_ms) VALUES (?, ?, ?, ?, ?)",
		).run(migration.filename, version, name, migration.checksum, duration)
		return duration
	},

	applyDown(db, migration) {
		if (!migration.down) {
			throw new Error(`Migration ${migration.filename} has no DOWN section`)
		}
		db.exec(migration.down)
		db.prepare("DELETE FROM _migrations WHERE filename = ?").run(migration.filename)
	},

	execRaw(db, sql) {
		db.exec(sql)
	},
}

// ─── PostgreSQL Adapter ──────────────────────────────────────────────────────

const PG_ADAPTER = {
	async ensureMigrationsTable(client) {
		await client.query(`
			CREATE TABLE IF NOT EXISTS _migrations (
				filename  TEXT PRIMARY KEY,
				version   TEXT NOT NULL,
				name      TEXT NOT NULL,
				checksum  TEXT NOT NULL,
				applied_at TIMESTAMPTZ DEFAULT now(),
				duration_ms INTEGER DEFAULT 0
			)
		`)
	},

	async getApplied(client) {
		const { rows } = await client.query(
			"SELECT filename, version, name, checksum, applied_at, duration_ms FROM _migrations ORDER BY filename",
		)
		return rows
	},

	async isApplied(client, filename) {
		const { rows } = await client.query("SELECT filename FROM _migrations WHERE filename = $1", [filename])
		return rows.length > 0
	},

	async applyUp(client, migration) {
		const start = Date.now()
		await client.query(migration.up)
		const duration = Date.now() - start
		const { version, name } = parseMigrationName(migration.filename)
		await client.query(
			"INSERT INTO _migrations (filename, version, name, checksum, duration_ms) VALUES ($1, $2, $3, $4, $5)",
			[migration.filename, version, name, migration.checksum, duration],
		)
		return duration
	},

	async applyDown(client, migration) {
		if (!migration.down) {
			throw new Error(`Migration ${migration.filename} has no DOWN section`)
		}
		await client.query(migration.down)
		await client.query("DELETE FROM _migrations WHERE filename = $1", [migration.filename])
	},

	async execRaw(client, sql) {
		await client.query(sql)
	},
}

// ─── Main API ────────────────────────────────────────────────────────────────

/**
 * Run all pending migrations.
 *
 * @param {"sqlite"|"postgres"} engine
 * @param {object} opts
 * @param {object} [opts.db] - better-sqlite3 Database instance (required for sqlite)
 * @param {string} [opts.connectionString] - PostgreSQL connection string (required for postgres)
 * @param {import("pg").Client} [opts.client] - Existing pg Client instance
 * @param {string} [opts.target] - Optional target migration filename to stop at
 * @param {boolean} [opts.dryRun] - If true, only report what would be applied
 * @returns {Promise<{applied: string[], skipped: string[], errors: string[]}>}
 */
async function migrate(engine, opts = {}) {
	const migrations = readMigrationFiles(engine)
	const applied = []
	const skipped = []
	const errors = []

	if (engine === "sqlite") {
		const db = opts.db
		if (!db) throw new Error("SQLite adapter requires opts.db (better-sqlite3 instance)")
		SQLITE_ADAPTER.ensureMigrationsTable(db)

		for (const m of migrations) {
			if (opts.target && m.filename > opts.target) break
			if (SQLITE_ADAPTER.isApplied(db, m.filename)) {
				skipped.push(m.filename)
				continue
			}
			if (opts.dryRun) {
				applied.push(`[DRY RUN] ${m.filename}`)
				continue
			}
			try {
				const run = SQLITE_ADAPTER.applyUp(db, m)
				applied.push(m.filename)
				console.log(`[migration] ✅ ${m.filename} (${run}ms)`)
			} catch (err) {
				errors.push(m.filename)
				console.error(`[migration] ❌ ${m.filename}: ${err.message}`)
			}
		}
	} else if (engine === "postgres") {
		const { Client } = require("pg")
		const client = opts.client || new Client({ connectionString: opts.connectionString })
		const shouldClose = !opts.client
		if (!client._connected) {
			await client.connect()
			client._connected = true
		}

		try {
			await PG_ADAPTER.ensureMigrationsTable(client)

			for (const m of migrations) {
				if (opts.target && m.filename > opts.target) break
				if (await PG_ADAPTER.isApplied(client, m.filename)) {
					skipped.push(m.filename)
					continue
				}
				if (opts.dryRun) {
					applied.push(`[DRY RUN] ${m.filename}`)
					continue
				}
				try {
					const run = await PG_ADAPTER.applyUp(client, m)
					applied.push(m.filename)
					console.log(`[migration] ✅ ${m.filename} (${run}ms)`)
				} catch (err) {
					errors.push(m.filename)
					console.error(`[migration] ❌ ${m.filename}: ${err.message}`)
				}
			}
		} finally {
			if (shouldClose) await client.end()
		}
	} else {
		throw new Error(`Unknown engine: ${engine}. Use "sqlite" or "postgres".`)
	}

	return { applied, skipped, errors }
}

/**
 * Roll back the last N migrations.
 *
 * @param {"sqlite"|"postgres"} engine
 * @param {object} opts
 * @param {object} [opts.db] - better-sqlite3 instance
 * @param {string} [opts.connectionString] - PostgreSQL connection string
 * @param {import("pg").Client} [opts.client] - Existing pg Client
 * @param {number} [opts.steps=1] - Number of migrations to roll back
 * @returns {Promise<{rolledBack: string[], errors: string[]}>}
 */
async function rollback(engine, opts = {}) {
	const steps = opts.steps || 1
	const rolledBack = []
	const errors = []

	if (engine === "sqlite") {
		const db = opts.db
		if (!db) throw new Error("SQLite adapter requires opts.db")
		SQLITE_ADAPTER.ensureMigrationsTable(db)

		const applied = SQLITE_ADAPTER.getApplied(db)
		const toRollback = applied.slice(-steps)

		for (const row of toRollback.reverse()) {
			const migrations = readMigrationFiles(engine)
			const m = migrations.find((x) => x.filename === row.filename)
			if (!m) {
				errors.push(`${row.filename}: migration file not found`)
				continue
			}
			if (!m.down) {
				errors.push(`${row.filename}: no DOWN section`)
				continue
			}
			try {
				SQLITE_ADAPTER.applyDown(db, m)
				rolledBack.push(row.filename)
				console.log(`[migration] ↩️  ${row.filename}`)
			} catch (err) {
				errors.push(`${row.filename}: ${err.message}`)
			}
		}
	} else if (engine === "postgres") {
		const { Client } = require("pg")
		const client = opts.client || new Client({ connectionString: opts.connectionString })
		const shouldClose = !opts.client
		if (!client._connected) {
			await client.connect()
			client._connected = true
		}

		try {
			await PG_ADAPTER.ensureMigrationsTable(client)
			const applied = await PG_ADAPTER.getApplied(client)
			const toRollback = applied.slice(-steps)

			for (const row of toRollback.reverse()) {
				const migrations = readMigrationFiles(engine)
				const m = migrations.find((x) => x.filename === row.filename)
				if (!m) {
					errors.push(`${row.filename}: migration file not found`)
					continue
				}
				if (!m.down) {
					errors.push(`${row.filename}: no DOWN section`)
					continue
				}
				try {
					await PG_ADAPTER.applyDown(client, m)
					rolledBack.push(row.filename)
					console.log(`[migration] ↩️  ${row.filename}`)
				} catch (err) {
					errors.push(`${row.filename}: ${err.message}`)
				}
			}
		} finally {
			if (shouldClose) await client.end()
		}
	} else {
		throw new Error(`Unknown engine: ${engine}`)
	}

	return { rolledBack, errors }
}

/**
 * Show migration status.
 *
 * @param {"sqlite"|"postgres"} engine
 * @param {object} opts
 * @returns {Promise<{pending: object[], applied: object[]}>}
 */
async function status(engine, opts = {}) {
	const migrations = readMigrationFiles(engine)
	let appliedRows = []

	if (engine === "sqlite") {
		const db = opts.db
		if (!db) throw new Error("SQLite adapter requires opts.db")
		SQLITE_ADAPTER.ensureMigrationsTable(db)
		appliedRows = SQLITE_ADAPTER.getApplied(db)
	} else if (engine === "postgres") {
		const { Client } = require("pg")
		const client = opts.client || new Client({ connectionString: opts.connectionString })
		const shouldClose = !opts.client
		if (!client._connected) {
			await client.connect()
			client._connected = true
		}
		try {
			await PG_ADAPTER.ensureMigrationsTable(client)
			appliedRows = await PG_ADAPTER.getApplied(client)
		} finally {
			if (shouldClose) await client.end()
		}
	}

	const appliedFilenames = new Set(appliedRows.map((r) => r.filename))
	const pending = migrations.filter((m) => !appliedFilenames.has(m.filename))
	const applied = migrations.filter((m) => appliedFilenames.has(m.filename))

	return {
		pending: pending.map((m) => ({
			filename: m.filename,
			...parseMigrationName(m.filename),
			checksum: m.checksum,
		})),
		applied: appliedRows.map((r) => ({
			filename: r.filename,
			version: r.version,
			name: r.name,
			checksum: r.checksum,
			appliedAt: r.applied_at,
			durationMs: r.duration_ms,
		})),
	}
}

/**
 * Create a new migration file from a template.
 *
 * @param {string} name - Short description (e.g. "create_users_table")
 * @returns {string} The filename of the created migration
 */
function create(name) {
	const timestamp = new Date()
		.toISOString()
		.replace(/[-:T.Z]/g, "")
		.slice(0, 14)
	const seq = timestamp.slice(0, 14) // Use timestamp as version for uniqueness
	const filename = `${seq}_${name}.sql`
	const filepath = path.join(MIGRATIONS_DIR, filename)

	if (!fs.existsSync(MIGRATIONS_DIR)) {
		fs.mkdirSync(MIGRATIONS_DIR, { recursive: true })
	}

	const template = `-- Migration: ${name}
-- Created: ${new Date().toISOString()}

-- UP
-- Write your migration SQL here.
-- Example:
--   CREATE TABLE IF NOT EXISTS example (
--     id INTEGER PRIMARY KEY AUTOINCREMENT,
--     name TEXT NOT NULL,
--     created_at TEXT DEFAULT (datetime('now'))
--   );

-- DOWN
-- Write the rollback SQL here.
-- Example:
--   DROP TABLE IF EXISTS example;
`

	fs.writeFileSync(filepath, template, "utf-8")
	console.log(`[migration] 📄 Created ${filename}`)
	return filename
}

module.exports = {
	migrate,
	rollback,
	status,
	create,
	readMigrationFiles,
	MIGRATIONS_DIR,
}
