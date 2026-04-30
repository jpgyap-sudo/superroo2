/**
 * Super Roo — Bug Registry.
 *
 * The bug-tracking surface deferred from Phase 1. Owns the `bugs` and `fixes`
 * SQLite tables (declared in MemoryStore's first migration). Persists every
 * mutation as an event so the Phase 3 dashboard sees bug history in real time.
 *
 * Phase 2.5 scope: CRUD on bugs, recording fix attempts, listing/filtering.
 * The Debugger Agent is the primary writer; PM and Tester read for context.
 */

import { v4 as uuidv4 } from "uuid"

import type { EventLog } from "../logging/EventLog"
import type { MemoryStore } from "../memory/MemoryStore"
import type { BugRecord, BugSeverity, BugStatus } from "../types"

interface BugRow {
	id: string
	title: string
	severity: string
	status: string
	feature_id: string | null
	symptoms: string
	suspected_root_cause: string | null
	files_likely_involved: string
	reproduction_steps: string
	recommended_fix: string | null
	deployment_risk: string
	fix_attempts: number
	created_at: number
	updated_at: number
}

function rowToBug(r: BugRow): BugRecord {
	return {
		id: r.id,
		title: r.title,
		severity: r.severity as BugSeverity,
		status: r.status as BugStatus,
		featureId: r.feature_id ?? undefined,
		symptoms: JSON.parse(r.symptoms) as string[],
		suspectedRootCause: r.suspected_root_cause ?? undefined,
		filesLikelyInvolved: JSON.parse(r.files_likely_involved) as string[],
		reproductionSteps: JSON.parse(r.reproduction_steps) as string[],
		recommendedFix: r.recommended_fix ?? undefined,
		deploymentRisk: r.deployment_risk as BugSeverity,
		fixAttempts: r.fix_attempts,
		createdAt: r.created_at,
		updatedAt: r.updated_at,
	}
}

export interface BugInputRaw {
	title: string
	severity?: BugSeverity
	status?: BugStatus
	featureId?: string
	symptoms?: string[]
	suspectedRootCause?: string
	filesLikelyInvolved?: string[]
	reproductionSteps?: string[]
	recommendedFix?: string
	deploymentRisk?: BugSeverity
}

export interface FixInputRaw {
	bugId: string
	summary: string
	filesChanged?: string[]
	testResults?: string
	succeeded: boolean
	commitSha?: string
}

export interface FixRecord {
	id: string
	bugId: string
	summary: string
	filesChanged: string[]
	testResults?: string
	succeeded: boolean
	commitSha?: string
	createdAt: number
}

interface FixRow {
	id: string
	bug_id: string
	summary: string
	files_changed: string
	test_results: string | null
	succeeded: number
	commit_sha: string | null
	created_at: number
}

function rowToFix(r: FixRow): FixRecord {
	return {
		id: r.id,
		bugId: r.bug_id,
		summary: r.summary,
		filesChanged: JSON.parse(r.files_changed) as string[],
		testResults: r.test_results ?? undefined,
		succeeded: r.succeeded === 1,
		commitSha: r.commit_sha ?? undefined,
		createdAt: r.created_at,
	}
}

export class BugRegistry {
	constructor(
		private readonly memory: MemoryStore,
		private readonly events: EventLog,
	) {}

	// ──────────────────────────────────────────────────────────────────────
	// Bugs
	// ──────────────────────────────────────────────────────────────────────

	create(input: BugInputRaw): BugRecord {
		if (!input.title || input.title.trim().length === 0) {
			throw new Error("BugRegistry.create: title is required")
		}
		const now = Date.now()
		const id = `bug_${uuidv4()}`
		const bug: BugRecord = {
			id,
			title: input.title,
			severity: input.severity ?? "medium",
			status: input.status ?? "open",
			featureId: input.featureId,
			symptoms: input.symptoms ?? [],
			suspectedRootCause: input.suspectedRootCause,
			filesLikelyInvolved: input.filesLikelyInvolved ?? [],
			reproductionSteps: input.reproductionSteps ?? [],
			recommendedFix: input.recommendedFix,
			deploymentRisk: input.deploymentRisk ?? "low",
			fixAttempts: 0,
			createdAt: now,
			updatedAt: now,
		}

		this.memory
			.getDb()
			.prepare(
				`INSERT INTO bugs
					(id, title, severity, status, feature_id, symptoms,
					 suspected_root_cause, files_likely_involved, reproduction_steps,
					 recommended_fix, deployment_risk, fix_attempts, created_at, updated_at)
				 VALUES
					(@id, @title, @severity, @status, @featureId, @symptoms,
					 @suspectedRootCause, @filesLikelyInvolved, @reproductionSteps,
					 @recommendedFix, @deploymentRisk, 0, @now, @now)`,
			)
			.run({
				id,
				title: bug.title,
				severity: bug.severity,
				status: bug.status,
				featureId: bug.featureId ?? null,
				symptoms: JSON.stringify(bug.symptoms),
				suspectedRootCause: bug.suspectedRootCause ?? null,
				filesLikelyInvolved: JSON.stringify(bug.filesLikelyInvolved),
				reproductionSteps: JSON.stringify(bug.reproductionSteps),
				recommendedFix: bug.recommendedFix ?? null,
				deploymentRisk: bug.deploymentRisk,
				now,
			})

		this.events.warn("bug.recorded", `Bug recorded: ${bug.title}`, {
			bugId: id,
			featureId: bug.featureId,
			data: { severity: bug.severity, deploymentRisk: bug.deploymentRisk },
		})
		return bug
	}

	get(id: string): BugRecord | null {
		const row = this.memory.getDb().prepare("SELECT * FROM bugs WHERE id = ?").get(id) as BugRow | undefined
		return row ? rowToBug(row) : null
	}

	list(filter: { status?: BugStatus; severity?: BugSeverity; featureId?: string; limit?: number } = {}): BugRecord[] {
		const where: string[] = []
		const params: Record<string, unknown> = {}
		if (filter.status) {
			where.push("status = @status")
			params.status = filter.status
		}
		if (filter.severity) {
			where.push("severity = @severity")
			params.severity = filter.severity
		}
		if (filter.featureId) {
			where.push("feature_id = @featureId")
			params.featureId = filter.featureId
		}
		const limit = filter.limit ?? 200
		const rows = this.memory
			.getDb()
			.prepare(
				`SELECT * FROM bugs ${where.length ? "WHERE " + where.join(" AND ") : ""}
				 ORDER BY updated_at DESC LIMIT @limit`,
			)
			.all({ ...params, limit }) as BugRow[]
		return rows.map(rowToBug)
	}

	update(
		id: string,
		patch: Partial<
			Pick<
				BugRecord,
				| "title"
				| "severity"
				| "status"
				| "featureId"
				| "symptoms"
				| "suspectedRootCause"
				| "filesLikelyInvolved"
				| "reproductionSteps"
				| "recommendedFix"
				| "deploymentRisk"
				| "fixAttempts"
			>
		>,
	): BugRecord {
		const existing = this.get(id)
		if (!existing) throw new Error(`Bug not found: ${id}`)

		const merged: BugRecord = {
			...existing,
			...patch,
			updatedAt: Date.now(),
		}

		this.memory
			.getDb()
			.prepare(
				`UPDATE bugs SET
					title = @title, severity = @severity, status = @status,
					feature_id = @featureId, symptoms = @symptoms,
					suspected_root_cause = @suspectedRootCause,
					files_likely_involved = @filesLikelyInvolved,
					reproduction_steps = @reproductionSteps,
					recommended_fix = @recommendedFix,
					deployment_risk = @deploymentRisk,
					fix_attempts = @fixAttempts,
					updated_at = @updatedAt
				 WHERE id = @id`,
			)
			.run({
				id,
				title: merged.title,
				severity: merged.severity,
				status: merged.status,
				featureId: merged.featureId ?? null,
				symptoms: JSON.stringify(merged.symptoms),
				suspectedRootCause: merged.suspectedRootCause ?? null,
				filesLikelyInvolved: JSON.stringify(merged.filesLikelyInvolved),
				reproductionSteps: JSON.stringify(merged.reproductionSteps),
				recommendedFix: merged.recommendedFix ?? null,
				deploymentRisk: merged.deploymentRisk,
				fixAttempts: merged.fixAttempts,
				updatedAt: merged.updatedAt,
			})

		const statusChanged = patch.status !== undefined && patch.status !== existing.status
		if (statusChanged && merged.status === "fixed") {
			this.events.info("bug.fixed", `Bug fixed: ${merged.title}`, { bugId: id })
		} else {
			this.events.info("bug.recorded", `Bug updated: ${merged.title}`, {
				bugId: id,
				data: { changedKeys: Object.keys(patch) },
			})
		}
		return merged
	}

	// ──────────────────────────────────────────────────────────────────────
	// Fixes (linked to bugs; many fixes per bug, one bug at a time succeeds)
	// ──────────────────────────────────────────────────────────────────────

	recordFix(input: FixInputRaw): FixRecord {
		const bug = this.get(input.bugId)
		if (!bug) throw new Error(`recordFix: unknown bugId ${input.bugId}`)
		const now = Date.now()
		const id = `fix_${uuidv4()}`
		const fix: FixRecord = {
			id,
			bugId: input.bugId,
			summary: input.summary,
			filesChanged: input.filesChanged ?? [],
			testResults: input.testResults,
			succeeded: input.succeeded,
			commitSha: input.commitSha,
			createdAt: now,
		}

		const tx = this.memory.getDb().transaction(() => {
			this.memory
				.getDb()
				.prepare(
					`INSERT INTO fixes (id, bug_id, summary, files_changed, test_results, succeeded, commit_sha, created_at)
					 VALUES (@id, @bugId, @summary, @filesChanged, @testResults, @succeeded, @commitSha, @createdAt)`,
				)
				.run({
					id,
					bugId: fix.bugId,
					summary: fix.summary,
					filesChanged: JSON.stringify(fix.filesChanged),
					testResults: fix.testResults ?? null,
					succeeded: fix.succeeded ? 1 : 0,
					commitSha: fix.commitSha ?? null,
					createdAt: now,
				})
			this.memory
				.getDb()
				.prepare(
					`UPDATE bugs SET fix_attempts = fix_attempts + 1, updated_at = @now, status = CASE WHEN @setFixed = 1 THEN 'fixed' ELSE status END
					 WHERE id = @bugId`,
				)
				.run({ now, bugId: input.bugId, setFixed: input.succeeded ? 1 : 0 })
		})
		tx()

		const eventType = input.succeeded ? "bug.fixed" : "bug.recorded"
		const level = input.succeeded ? "info" : "warn"
		this.events.emit(level, eventType, input.succeeded ? `Bug fix succeeded: ${bug.title}` : `Fix attempt failed: ${bug.title}`, {
			bugId: input.bugId,
			data: { fixId: id, summary: input.summary },
		})
		return fix
	}

	listFixes(bugId: string): FixRecord[] {
		const rows = this.memory
			.getDb()
			.prepare("SELECT * FROM fixes WHERE bug_id = ? ORDER BY created_at DESC")
			.all(bugId) as FixRow[]
		return rows.map(rowToFix)
	}

	delete(id: string): boolean {
		// fixes table has ON DELETE CASCADE on bug_id, so this cleans both.
		const res = this.memory.getDb().prepare("DELETE FROM bugs WHERE id = ?").run(id)
		return res.changes > 0
	}
}
