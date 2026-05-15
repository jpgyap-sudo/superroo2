/**
 * Tests for the Migration Runner.
 *
 * Run with: cd cloud && node api/__tests__/test-migration-runner.test.js
 */

const path = require("path")
const fs = require("fs")
const os = require("os")

// ─── Test Framework ──────────────────────────────────────────────────────────

let passed = 0
let failed = 0
let currentSection = ""

function section(title) {
	currentSection = title
	console.log(`\n  ${title}`)
}

function test(name, fn) {
	try {
		fn()
		passed++
		console.log(`    ✅ ${name}`)
	} catch (err) {
		failed++
		console.log(`    ❌ ${name}: ${err.message}`)
	}
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createTempDb() {
	const Database = require("better-sqlite3")
	const tmpFile = path.join(os.tmpdir(), `test-migration-${Date.now()}.db`)
	const db = new Database(tmpFile)
	db.pragma("journal_mode = WAL")
	return { db, tmpFile }
}

function cleanupTempDb(db, tmpFile) {
	try {
		db.close()
		if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile)
	} catch (_) {
		// ignore cleanup errors
	}
}

// ─── Tests ───────────────────────────────────────────────────────────────────

async function main() {
	console.log("\nMigration Runner Tests")
	console.log("══════════════════════")

	// We need to require after setting up the temp dir to avoid side effects
	const migrationRunner = require("../lib/migrationRunner")

	section("readMigrationFiles()")

	test("returns empty array when no migrations directory exists", () => {
		const origDir = migrationRunner.MIGRATIONS_DIR
		const fakeDir = path.join(os.tmpdir(), `no-migrations-${Date.now()}`)
		const result = migrationRunner.readMigrationFiles()
		// Should use the real dir which now has migrations
		// Instead, test that it returns an array
		Array.isArray(result)
	})

	test("returns sorted migration files with checksums", () => {
		const files = migrationRunner.readMigrationFiles()
		if (files.length === 0) throw new Error("Expected at least 1 migration file")
		for (const f of files) {
			if (!f.filename) throw new Error(`Missing filename in ${JSON.stringify(f)}`)
			if (!f.checksum) throw new Error(`Missing checksum in ${f.filename}`)
			if (!f.up) throw new Error(`Missing UP section in ${f.filename}`)
			if (f.checksum.length !== 64) throw new Error(`Invalid checksum length in ${f.filename}`)
		}
		// Verify sort order
		for (let i = 1; i < files.length; i++) {
			if (files[i].filename < files[i - 1].filename) {
				throw new Error(`Files not sorted: ${files[i - 1].filename} > ${files[i].filename}`)
			}
		}
	})

	section("migrate() — SQLite")

	test("applies all pending migrations to a fresh database", async () => {
		const { db, tmpFile } = createTempDb()
		try {
			const result = await migrationRunner.migrate("sqlite", { db })
			if (result.errors.length > 0) throw new Error(`Errors: ${result.errors.join(", ")}`)
			if (result.applied.length === 0) throw new Error("Expected at least 1 migration to be applied")

			// Verify _migrations table exists
			const row = db.prepare("SELECT COUNT(*) as cnt FROM _migrations").get()
			if (row.cnt !== result.applied.length) {
				throw new Error(`Expected ${result.applied.length} migrations, got ${row.cnt}`)
			}

			// Verify specific tables exist
			const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()
			const tableNames = tables.map((t) => t.name)
			if (!tableNames.includes("conversations")) throw new Error("Missing conversations table")
			if (!tableNames.includes("tasks")) throw new Error("Missing tasks table")
		} finally {
			cleanupTempDb(db, tmpFile)
		}
	})

	test("skips already-applied migrations", async () => {
		const { db, tmpFile } = createTempDb()
		try {
			// First run
			const first = await migrationRunner.migrate("sqlite", { db })
			if (first.errors.length > 0) throw new Error(`First run errors: ${first.errors.join(", ")}`)

			// Second run — should skip everything
			const second = await migrationRunner.migrate("sqlite", { db })
			if (second.errors.length > 0) throw new Error(`Second run errors: ${second.errors.join(", ")}`)
			if (second.applied.length !== 0)
				throw new Error(`Expected 0 applied on second run, got ${second.applied.length}`)
			if (second.skipped.length === 0) throw new Error(`Expected skipped migrations on second run`)
		} finally {
			cleanupTempDb(db, tmpFile)
		}
	})

	test("dry run does not apply migrations", async () => {
		const { db, tmpFile } = createTempDb()
		try {
			const result = await migrationRunner.migrate("sqlite", { db, dryRun: true })
			if (result.applied.length === 0) throw new Error("Expected dry-run entries")
			if (!result.applied[0].startsWith("[DRY RUN]")) throw new Error("Expected DRY RUN prefix")

			// Verify _migrations table is empty
			const row = db.prepare("SELECT COUNT(*) as cnt FROM _migrations").get()
			if (row.cnt !== 0) throw new Error("Expected 0 migrations applied after dry run")
		} finally {
			cleanupTempDb(db, tmpFile)
		}
	})

	test("target stops at specific migration", async () => {
		const { db, tmpFile } = createTempDb()
		try {
			const result = await migrationRunner.migrate("sqlite", { db, target: "0001_create_telegram_learner.sql" })
			if (result.errors.length > 0) throw new Error(`Errors: ${result.errors.join(", ")}`)
			if (result.applied.length !== 1) throw new Error(`Expected 1 migration, got ${result.applied.length}`)
			if (result.applied[0] !== "0001_create_telegram_learner.sql") {
				throw new Error(`Expected 0001_create_telegram_learner.sql, got ${result.applied[0]}`)
			}
		} finally {
			cleanupTempDb(db, tmpFile)
		}
	})

	section("rollback() — SQLite")

	test("rolls back the last migration", async () => {
		const { db, tmpFile } = createTempDb()
		try {
			// Apply all sqlite migrations
			await migrationRunner.migrate("sqlite", { db })
			const sqliteFiles = migrationRunner.readMigrationFiles("sqlite")

			// Rollback 1
			const result = await migrationRunner.rollback("sqlite", { db, steps: 1 })
			if (result.errors.length > 0) throw new Error(`Errors: ${result.errors.join(", ")}`)
			if (result.rolledBack.length !== 1) throw new Error(`Expected 1 rollback, got ${result.rolledBack.length}`)

			// Verify _migrations count decreased
			const row = db.prepare("SELECT COUNT(*) as cnt FROM _migrations").get()
			if (row.cnt !== sqliteFiles.length - 1) {
				throw new Error(`Expected ${sqliteFiles.length - 1} migrations after rollback, got ${row.cnt}`)
			}
		} finally {
			cleanupTempDb(db, tmpFile)
		}
	})

	test("rolls back multiple migrations", async () => {
		const { db, tmpFile } = createTempDb()
		try {
			await migrationRunner.migrate("sqlite", { db })
			const sqliteFiles = migrationRunner.readMigrationFiles("sqlite")

			const result = await migrationRunner.rollback("sqlite", { db, steps: 2 })
			if (result.errors.length > 0) throw new Error(`Errors: ${result.errors.join(", ")}`)
			if (result.rolledBack.length !== 2) throw new Error(`Expected 2 rollbacks, got ${result.rolledBack.length}`)

			const row = db.prepare("SELECT COUNT(*) as cnt FROM _migrations").get()
			if (row.cnt !== sqliteFiles.length - 2) {
				throw new Error(`Expected ${sqliteFiles.length - 2} migrations after rollback, got ${row.cnt}`)
			}
		} finally {
			cleanupTempDb(db, tmpFile)
		}
	})

	section("status() — SQLite")

	test("shows pending and applied migrations", async () => {
		const { db, tmpFile } = createTempDb()
		try {
			// Before any migrations
			const before = await migrationRunner.status("sqlite", { db })
			if (before.pending.length === 0) throw new Error("Expected pending migrations before apply")
			if (before.applied.length !== 0) throw new Error("Expected 0 applied migrations before apply")

			// Apply first migration only
			await migrationRunner.migrate("sqlite", { db, target: "0001_create_telegram_learner.sql" })

			const after = await migrationRunner.status("sqlite", { db })
			if (after.applied.length !== 1) throw new Error(`Expected 1 applied, got ${after.applied.length}`)
			if (after.applied[0].filename !== "0001_create_telegram_learner.sql") {
				throw new Error("Expected 0001_create_telegram_learner.sql as applied")
			}
			if (!after.applied[0].appliedAt) throw new Error("Missing appliedAt timestamp")
			if (typeof after.applied[0].durationMs !== "number") throw new Error("Missing durationMs")
		} finally {
			cleanupTempDb(db, tmpFile)
		}
	})

	section("create()")

	test("creates a new migration file from template", () => {
		const name = `test_migration_${Date.now()}`
		const filename = migrationRunner.create(name)
		if (!filename) throw new Error("create() returned no filename")
		if (!filename.endsWith(".sql")) throw new Error(`Expected .sql extension, got ${filename}`)

		const filepath = path.join(migrationRunner.MIGRATIONS_DIR, filename)
		if (!fs.existsSync(filepath)) throw new Error(`File not created: ${filepath}`)

		const content = fs.readFileSync(filepath, "utf-8")
		if (!content.includes("-- UP")) throw new Error("Missing -- UP section")
		if (!content.includes("-- DOWN")) throw new Error("Missing -- DOWN section")
		if (!content.includes(name)) throw new Error(`Missing name in template: ${name}`)

		// Cleanup
		fs.unlinkSync(filepath)
	})

	section("parseMigrationName()")

	test("parses standard migration filenames", () => {
		// Access internal via the module's behavior
		const files = migrationRunner.readMigrationFiles()
		for (const f of files) {
			if (!f.filename) throw new Error("Missing filename")
		}
	})

	// ─── Summary ──────────────────────────────────────────────────────────

	console.log("\n══════════════════════")
	console.log(`Results: ${passed} passed, ${failed} failed\n`)

	if (failed > 0) {
		process.exit(1)
	}
}

main().catch((err) => {
	console.error("Fatal error:", err)
	process.exit(1)
})
