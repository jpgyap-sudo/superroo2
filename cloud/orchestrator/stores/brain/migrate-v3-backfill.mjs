#!/usr/bin/env node

/**
 * Migration script: Backfill brain_memory_versions for existing agent_memory records.
 *
 * This script creates version 1 entries in brain_memory_versions for all existing
 * agent_memory records that don't already have a version entry. This ensures
 * backward compatibility after deploying the Memory Evolution v3 schema.
 *
 * Usage:
 *   node cloud/orchestrator/stores/brain/migrate-v3-backfill.mjs [--dry-run]
 *
 * Options:
 *   --dry-run  Preview changes without applying them
 */

const { Pool } = require("pg")

const DRY_RUN = process.argv.includes("--dry-run")

async function main() {
	const pool = new Pool({
		connectionString: process.env.DATABASE_URL || process.env.BRAIN_DATABASE_URL,
	})

	console.log(`[migrate-v3-backfill] Connected to database${DRY_RUN ? " (DRY RUN)" : ""}`)

	try {
		// Step 1: Find memories missing version 1
		const missingResult = await pool.query(`
			SELECT am.id, am.content, am.title, am.created_at, am.created_by
			FROM agent_memory am
			LEFT JOIN brain_memory_versions bmv
				ON bmv.memory_id = am.id AND bmv.version_no = 1
			WHERE bmv.id IS NULL
		`)

		const missing = missingResult.rows
		console.log(`[migrate-v3-backfill] Found ${missing.length} memories without version 1`)

		if (missing.length === 0) {
			console.log("[migrate-v3-backfill] All memories already have version 1 — nothing to do")
			return
		}

		if (DRY_RUN) {
			console.log("[migrate-v3-backfill] Would insert version 1 for:")
			for (const row of missing.slice(0, 10)) {
				console.log(`  - ${row.id}: "${(row.title || row.content || "").substring(0, 60)}..."`)
			}
			if (missing.length > 10) {
				console.log(`  ... and ${missing.length - 10} more`)
			}
			return
		}

		// Step 2: Insert version 1 for each missing memory
		let inserted = 0
		for (const row of missing) {
			await pool.query(
				`INSERT INTO brain_memory_versions (memory_id, version_no, content, change_reason, created_by_agent, created_at)
				 VALUES ($1, 1, $2, 'initial backfill', $3, $4)
				 ON CONFLICT (memory_id, version_no) DO NOTHING`,
				[row.id, row.content || "", row.created_by || "system", row.created_at],
			)
			inserted++
		}

		console.log(`[migrate-v3-backfill] Successfully backfilled ${inserted} version 1 entries`)

		// Step 3: Verify
		const verifyResult = await pool.query(`
			SELECT COUNT(*) AS total FROM agent_memory
		`)
		const verifiedResult = await pool.query(`
			SELECT COUNT(DISTINCT memory_id) AS with_versions FROM brain_memory_versions
		`)
		const total = Number(verifyResult.rows[0]?.total || 0)
		const withVersions = Number(verifiedResult.rows[0]?.with_versions || 0)
		console.log(`[migrate-v3-backfill] Verification: ${withVersions}/${total} memories have versions`)

	} finally {
		await pool.end()
	}
}

main().catch((err) => {
	console.error("[migrate-v3-backfill] Failed:", err.message)
	process.exit(1)
})
