/**
 * Super Roo — Feature Registry.
 *
 * The "product memory" of the target app. Every feature has a status
 * (planned / building / ... / deprecated), health (unknown / healthy /
 * degraded / failing), and links to bugs and tests.
 *
 * Persists to the `features` SQLite table. Emits events on every mutation so
 * the dashboard (Phase 3) can react in real time.
 *
 * Phase 1 scope: pure CRUD + listing/filtering. No automatic health checks
 * yet — that's Phase 2's Product Manager Agent.
 */

import { v4 as uuidv4 } from "uuid"

import type { EventLog } from "../logging/EventLog"
import type { MemoryStore } from "../memory/MemoryStore"
import type { Feature, FeatureHealth, FeatureInput, FeatureInputRaw, FeatureStatus } from "../types"
import { FeatureInputSchema } from "../types"

interface FeatureRow {
	id: string
	name: string
	description: string
	owner_agent: string
	status: string
	health: string
	priority: string
	related_files: string
	bug_ids: string
	test_ids: string
	fix_attempts: number
	last_checked_at: number | null
	created_at: number
	updated_at: number
}

function rowToFeature(r: FeatureRow): Feature {
	return {
		id: r.id,
		name: r.name,
		description: r.description,
		ownerAgent: r.owner_agent,
		status: r.status as FeatureStatus,
		health: r.health as FeatureHealth,
		priority: r.priority as Feature["priority"],
		relatedFiles: JSON.parse(r.related_files) as string[],
		bugIds: JSON.parse(r.bug_ids) as string[],
		testIds: JSON.parse(r.test_ids) as string[],
		fixAttempts: r.fix_attempts,
		lastCheckedAt: r.last_checked_at,
		createdAt: r.created_at,
		updatedAt: r.updated_at,
	}
}

export class FeatureRegistry {
	constructor(
		private readonly memory: MemoryStore,
		private readonly events: EventLog,
	) {}

	create(input: FeatureInputRaw): Feature {
		// FeatureInputSchema.parse() returns the schema's *output* type with all
		// defaults filled and enum values narrowed. We assert FeatureInput here
		// because that is what the schema's runtime guarantees.
		const parsed = FeatureInputSchema.parse(input) as FeatureInput
		const now = Date.now()
		const id = `feat_${uuidv4()}`
		const feature: Feature = {
			id,
			...parsed,
			fixAttempts: 0,
			bugIds: [],
			testIds: [],
			lastCheckedAt: null,
			createdAt: now,
			updatedAt: now,
		}
		this.memory
			.getDb()
			.prepare(
				`INSERT INTO features
					(id, name, description, owner_agent, status, health, priority,
					 related_files, bug_ids, test_ids, fix_attempts, last_checked_at,
					 created_at, updated_at)
				 VALUES
					(@id, @name, @description, @ownerAgent, @status, @health, @priority,
					 @relatedFiles, @bugIds, @testIds, 0, NULL, @createdAt, @updatedAt)`,
			)
			.run({
				id,
				name: feature.name,
				description: feature.description,
				ownerAgent: feature.ownerAgent,
				status: feature.status,
				health: feature.health,
				priority: feature.priority,
				relatedFiles: JSON.stringify(feature.relatedFiles),
				bugIds: JSON.stringify(feature.bugIds),
				testIds: JSON.stringify(feature.testIds),
				createdAt: now,
				updatedAt: now,
			})

		this.events.info("feature.created", `Created feature: ${feature.name}`, { featureId: id })
		return feature
	}

	get(id: string): Feature | null {
		const row = this.memory.getDb().prepare("SELECT * FROM features WHERE id = ?").get(id) as
			| FeatureRow
			| undefined
		return row ? rowToFeature(row) : null
	}

	getByName(name: string): Feature | null {
		const row = this.memory.getDb().prepare("SELECT * FROM features WHERE name = ?").get(name) as
			| FeatureRow
			| undefined
		return row ? rowToFeature(row) : null
	}

	list(filter: { status?: FeatureStatus; health?: FeatureHealth } = {}): Feature[] {
		const where: string[] = []
		const params: Record<string, unknown> = {}
		if (filter.status) {
			where.push("status = @status")
			params.status = filter.status
		}
		if (filter.health) {
			where.push("health = @health")
			params.health = filter.health
		}
		const sql = `SELECT * FROM features ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY updated_at DESC`
		const rows = this.memory.getDb().prepare(sql).all(params) as FeatureRow[]
		return rows.map(rowToFeature)
	}

	update(
		id: string,
		patch: Partial<
			Pick<
				Feature,
				| "name"
				| "description"
				| "ownerAgent"
				| "status"
				| "health"
				| "priority"
				| "relatedFiles"
				| "bugIds"
				| "testIds"
				| "fixAttempts"
				| "lastCheckedAt"
			>
		>,
	): Feature {
		const existing = this.get(id)
		if (!existing) throw new Error(`Feature not found: ${id}`)

		const merged: Feature = {
			...existing,
			...patch,
			updatedAt: Date.now(),
		}

		this.memory
			.getDb()
			.prepare(
				`UPDATE features SET
					name = @name,
					description = @description,
					owner_agent = @ownerAgent,
					status = @status,
					health = @health,
					priority = @priority,
					related_files = @relatedFiles,
					bug_ids = @bugIds,
					test_ids = @testIds,
					fix_attempts = @fixAttempts,
					last_checked_at = @lastCheckedAt,
					updated_at = @updatedAt
				 WHERE id = @id`,
			)
			.run({
				id,
				name: merged.name,
				description: merged.description,
				ownerAgent: merged.ownerAgent,
				status: merged.status,
				health: merged.health,
				priority: merged.priority,
				relatedFiles: JSON.stringify(merged.relatedFiles),
				bugIds: JSON.stringify(merged.bugIds),
				testIds: JSON.stringify(merged.testIds),
				fixAttempts: merged.fixAttempts,
				lastCheckedAt: merged.lastCheckedAt,
				updatedAt: merged.updatedAt,
			})

		const statusChanged = patch.status !== undefined && patch.status !== existing.status
		this.events.info(
			statusChanged ? "feature.status_changed" : "feature.updated",
			statusChanged
				? `Feature ${merged.name}: ${existing.status} → ${merged.status}`
				: `Updated feature: ${merged.name}`,
			{
				featureId: id,
				data: statusChanged
					? { from: existing.status, to: merged.status }
					: { changedKeys: Object.keys(patch) },
			},
		)

		return merged
	}

	/** Mark health and bump lastCheckedAt — convenience for Phase 2. */
	recordHealthCheck(id: string, health: FeatureHealth): Feature {
		return this.update(id, { health, lastCheckedAt: Date.now() })
	}

	delete(id: string): boolean {
		const res = this.memory.getDb().prepare("DELETE FROM features WHERE id = ?").run(id)
		return res.changes > 0
	}
}
