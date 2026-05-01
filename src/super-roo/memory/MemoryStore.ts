/**
 * Super Roo — Memory store (SQLite).
 *
 * Holds all durable state for Phase 1: tasks, features, bugs, fixes, decisions,
 * and the structured event log. Uses better-sqlite3 (synchronous, fast, single
 * native dep) which Roo doesn't yet pull in but which is the standard for
 * Node SQLite in extension hosts.
 *
 * Migration design
 * ----------------
 * Migrations are an ordered list of `{ version, up }` records. The store
 * tracks the current version in a `_meta` table and applies any unapplied
 * migrations on open. Adding a new migration is append-only — never edit a
 * past one once it has shipped, or upgrades will diverge between users.
 *
 * Path = ":memory:" creates an ephemeral DB (tests rely on this).
 */

import Database from "better-sqlite3"

import type { LogEvent } from "../types"

function safeJsonParse<T>(json: string, fallback: T): T {
	try {
		return JSON.parse(json) as T
	} catch {
		return fallback
	}
}

interface Migration {
	version: number
	description: string
	up: (db: Database.Database) => void
}

const MIGRATIONS: Migration[] = [
	{
		version: 1,
		description: "initial schema: tasks, features, bugs, fixes, decisions, events",
		up: (db) => {
			db.exec(`
				CREATE TABLE tasks (
					id TEXT PRIMARY KEY,
					agent TEXT NOT NULL,
					goal TEXT NOT NULL,
					priority TEXT NOT NULL,
					status TEXT NOT NULL,
					parent_task_id TEXT,
					feature_id TEXT,
					bug_id TEXT,
					required_capabilities TEXT NOT NULL DEFAULT '[]',
					payload TEXT NOT NULL DEFAULT '{}',
					max_iterations INTEGER NOT NULL DEFAULT 5,
					attempts INTEGER NOT NULL DEFAULT 0,
					error TEXT,
					result_summary TEXT,
					created_at INTEGER NOT NULL,
					updated_at INTEGER NOT NULL,
					started_at INTEGER,
					finished_at INTEGER
				);
				CREATE INDEX idx_tasks_status ON tasks(status);
				CREATE INDEX idx_tasks_priority ON tasks(priority);
				CREATE INDEX idx_tasks_agent ON tasks(agent);

				CREATE TABLE features (
					id TEXT PRIMARY KEY,
					name TEXT NOT NULL UNIQUE,
					description TEXT NOT NULL DEFAULT '',
					owner_agent TEXT NOT NULL,
					status TEXT NOT NULL,
					health TEXT NOT NULL,
					priority TEXT NOT NULL,
					related_files TEXT NOT NULL DEFAULT '[]',
					bug_ids TEXT NOT NULL DEFAULT '[]',
					test_ids TEXT NOT NULL DEFAULT '[]',
					fix_attempts INTEGER NOT NULL DEFAULT 0,
					last_checked_at INTEGER,
					created_at INTEGER NOT NULL,
					updated_at INTEGER NOT NULL
				);
				CREATE INDEX idx_features_status ON features(status);
				CREATE INDEX idx_features_health ON features(health);

				CREATE TABLE bugs (
					id TEXT PRIMARY KEY,
					title TEXT NOT NULL,
					severity TEXT NOT NULL,
					status TEXT NOT NULL,
					feature_id TEXT,
					symptoms TEXT NOT NULL DEFAULT '[]',
					suspected_root_cause TEXT,
					files_likely_involved TEXT NOT NULL DEFAULT '[]',
					reproduction_steps TEXT NOT NULL DEFAULT '[]',
					recommended_fix TEXT,
					deployment_risk TEXT NOT NULL DEFAULT 'low',
					fix_attempts INTEGER NOT NULL DEFAULT 0,
					created_at INTEGER NOT NULL,
					updated_at INTEGER NOT NULL,
					FOREIGN KEY (feature_id) REFERENCES features(id) ON DELETE SET NULL
				);
				CREATE INDEX idx_bugs_status ON bugs(status);
				CREATE INDEX idx_bugs_feature ON bugs(feature_id);

				CREATE TABLE fixes (
					id TEXT PRIMARY KEY,
					bug_id TEXT NOT NULL,
					summary TEXT NOT NULL,
					files_changed TEXT NOT NULL DEFAULT '[]',
					test_results TEXT,
					succeeded INTEGER NOT NULL DEFAULT 0,
					commit_sha TEXT,
					created_at INTEGER NOT NULL,
					FOREIGN KEY (bug_id) REFERENCES bugs(id) ON DELETE CASCADE
				);
				CREATE INDEX idx_fixes_bug ON fixes(bug_id);

				CREATE TABLE decisions (
					id TEXT PRIMARY KEY,
					title TEXT NOT NULL,
					context TEXT NOT NULL,
					decision TEXT NOT NULL,
					alternatives TEXT NOT NULL DEFAULT '[]',
					tags TEXT NOT NULL DEFAULT '[]',
					created_at INTEGER NOT NULL
				);

				CREATE TABLE events (
					id TEXT PRIMARY KEY,
					at INTEGER NOT NULL,
					level TEXT NOT NULL,
					type TEXT NOT NULL,
					message TEXT NOT NULL,
					task_id TEXT,
					agent TEXT,
					feature_id TEXT,
					bug_id TEXT,
					data TEXT
				);
				CREATE INDEX idx_events_at ON events(at);
				CREATE INDEX idx_events_type ON events(type);
				CREATE INDEX idx_events_task ON events(task_id);
			`)
		},
	},
	{
		version: 2,
		description: "add coded_by to tasks and events for coder signature tracking",
		up: (db) => {
			db.exec(`
				ALTER TABLE tasks ADD COLUMN coded_by TEXT;
				ALTER TABLE events ADD COLUMN coded_by TEXT;
				CREATE INDEX idx_events_coded_by ON events(coded_by);
			`)
		},
	},
	{
		version: 3,
		description: "add healing_incidents and healing_actions tables for self-healing",
		up: (db) => {
			db.exec(`
				CREATE TABLE healing_incidents (
					id TEXT PRIMARY KEY,
					fingerprint TEXT NOT NULL UNIQUE,
					feature_key TEXT,
					source_agent TEXT NOT NULL DEFAULT 'unknown_agent',
					title TEXT NOT NULL,
					symptom TEXT NOT NULL,
					severity TEXT NOT NULL DEFAULT 'medium',
					status TEXT NOT NULL DEFAULT 'new',
					root_cause_category TEXT,
					affected_files TEXT NOT NULL DEFAULT '[]',
					recommended_action TEXT,
					evidence TEXT NOT NULL DEFAULT '{}',
					auto_fix_allowed INTEGER NOT NULL DEFAULT 0,
					fix_attempts INTEGER NOT NULL DEFAULT 0,
					created_at INTEGER NOT NULL,
					updated_at INTEGER NOT NULL
				);
				CREATE INDEX idx_healing_incidents_status ON healing_incidents(status);
				CREATE INDEX idx_healing_incidents_fingerprint ON healing_incidents(fingerprint);
				CREATE INDEX idx_healing_incidents_feature ON healing_incidents(feature_key);
				CREATE INDEX idx_healing_incidents_created ON healing_incidents(created_at);

				CREATE TABLE healing_actions (
					id TEXT PRIMARY KEY,
					incident_id TEXT NOT NULL,
					action_type TEXT NOT NULL,
					actor_agent TEXT NOT NULL,
					summary TEXT NOT NULL,
					input TEXT NOT NULL DEFAULT '{}',
					output TEXT NOT NULL DEFAULT '{}',
					created_at INTEGER NOT NULL,
					FOREIGN KEY (incident_id) REFERENCES healing_incidents(id) ON DELETE CASCADE
				);
				CREATE INDEX idx_healing_actions_incident ON healing_actions(incident_id);
				CREATE INDEX idx_healing_actions_created ON healing_actions(created_at);
			`)
		},
	},
]

export class MemoryStore {
	private db: Database.Database

	constructor(dbPath: string) {
		this.db = new Database(dbPath)
		// WAL gives us concurrent reads while a single writer is appending events.
		// Skip for in-memory DBs (no journal needed, throws on some platforms).
		if (dbPath !== ":memory:") {
			try {
				this.db.pragma("journal_mode = WAL")
			} catch {
				// Some sandboxes refuse WAL — fall through; default rollback journal still works.
			}
		}
		this.db.pragma("foreign_keys = ON")
		this.runMigrations()
	}

	private runMigrations(): void {
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS _meta (
				key TEXT PRIMARY KEY,
				value TEXT NOT NULL
			);
		`)
		const row = this.db.prepare("SELECT value FROM _meta WHERE key = 'schema_version'").get() as
			| { value: string }
			| undefined
		const current = row ? parseInt(row.value, 10) : 0

		const pending = MIGRATIONS.filter((m) => m.version > current).sort((a, b) => a.version - b.version)
		if (pending.length === 0) return

		const tx = this.db.transaction(() => {
			for (const m of pending) {
				m.up(this.db)
				this.db
					.prepare("INSERT OR REPLACE INTO _meta (key, value) VALUES ('schema_version', ?)")
					.run(String(m.version))
			}
		})
		tx()
	}

	getSchemaVersion(): number {
		const row = this.db.prepare("SELECT value FROM _meta WHERE key = 'schema_version'").get() as
			| { value: string }
			| undefined
		return row ? parseInt(row.value, 10) : 0
	}

	/** Raw access for sibling modules (queue, features, logging) within super-roo only. */
	getDb(): Database.Database {
		return this.db
	}

	close(): void {
		this.db.close()
	}

	// ──────────────────────────────────────────────────────────────────────
	// Decisions (simple memory table; bugs/fixes are managed through dedicated
	// methods on companion modules — Phase 2 will expand this surface.)
	// ──────────────────────────────────────────────────────────────────────

	recordDecision(input: {
		id: string
		title: string
		context: string
		decision: string
		alternatives?: string[]
		tags?: string[]
		createdAt?: number
	}): void {
		this.db
			.prepare(
				`INSERT INTO decisions (id, title, context, decision, alternatives, tags, created_at)
				 VALUES (@id, @title, @context, @decision, @alternatives, @tags, @createdAt)`,
			)
			.run({
				id: input.id,
				title: input.title,
				context: input.context,
				decision: input.decision,
				alternatives: JSON.stringify(input.alternatives ?? []),
				tags: JSON.stringify(input.tags ?? []),
				createdAt: input.createdAt ?? Date.now(),
			})
	}

	listDecisions(): Array<{
		id: string
		title: string
		context: string
		decision: string
		alternatives: string[]
		tags: string[]
		createdAt: number
	}> {
		const rows = this.db
			.prepare(
				"SELECT id, title, context, decision, alternatives, tags, created_at as createdAt FROM decisions ORDER BY created_at DESC",
			)
			.all() as Array<{
			id: string
			title: string
			context: string
			decision: string
			alternatives: string
			tags: string
			createdAt: number
		}>
		return rows.map((r) => ({
			...r,
			alternatives: safeJsonParse<string[]>(r.alternatives, []),
			tags: safeJsonParse<string[]>(r.tags, []),
		}))
	}

	// ──────────────────────────────────────────────────────────────────────
	// Events (used by the EventLog module; kept here so we own the table)
	// ──────────────────────────────────────────────────────────────────────

	insertEvent(ev: LogEvent): void {
		this.db
			.prepare(
				`INSERT INTO events (id, at, level, type, message, task_id, agent, feature_id, bug_id, coded_by, data)
				 VALUES (@id, @at, @level, @type, @message, @taskId, @agent, @featureId, @bugId, @codedBy, @data)`,
			)
			.run({
				id: ev.id,
				at: ev.at,
				level: ev.level,
				type: ev.type,
				message: ev.message,
				taskId: ev.taskId ?? null,
				agent: ev.agent ?? null,
				featureId: ev.featureId ?? null,
				bugId: ev.bugId ?? null,
				codedBy: ev.codedBy ?? null,
				data: ev.data ? JSON.stringify(ev.data) : null,
			})
	}

	listEvents(opts: { limit?: number; sinceMs?: number; type?: string; taskId?: string } = {}): LogEvent[] {
		const where: string[] = []
		const params: Record<string, unknown> = {}
		if (opts.sinceMs !== undefined) {
			where.push("at >= @sinceMs")
			params.sinceMs = opts.sinceMs
		}
		if (opts.type) {
			where.push("type = @type")
			params.type = opts.type
		}
		if (opts.taskId) {
			where.push("task_id = @taskId")
			params.taskId = opts.taskId
		}
		const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : ""
		const limit = opts.limit ?? 500
		const rows = this.db
			.prepare(
				`SELECT id, at, level, type, message, task_id as taskId, agent, feature_id as featureId,
				        bug_id as bugId, coded_by as codedBy, data
				 FROM events ${whereSql} ORDER BY at DESC LIMIT @limit`,
			)
			.all({ ...params, limit }) as Array<{
			id: string
			at: number
			level: string
			type: string
			message: string
			taskId: string | null
			agent: string | null
			featureId: string | null
			bugId: string | null
			codedBy: string | null
			data: string | null
		}>
		return rows.map((r) => ({
			id: r.id,
			at: r.at,
			level: r.level as LogEvent["level"],
			type: r.type,
			message: r.message,
			taskId: r.taskId ?? undefined,
			agent: r.agent ?? undefined,
			featureId: r.featureId ?? undefined,
			bugId: r.bugId ?? undefined,
			codedBy: r.codedBy ?? undefined,
			data: r.data ? safeJsonParse<Record<string, unknown>>(r.data, {}) : undefined,
		}))
	}
}
