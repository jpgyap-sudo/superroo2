/**
 * Super Roo — Healing Bus.
 *
 * The central nervous system for the self-healing architecture.
 * All agents report events through this bus, creating a unified
 * incident-to-resolution pipeline.
 *
 * Workflow:
 *   monitor_event → incident → bug → task → patch → verification → release status
 *
 * The HealingBus coordinates between:
 *   - Feature Monitor Agent (health checks)
 *   - Tester Agent (smoke tests)
 *   - Bug Hunter Agent (classification)
 *   - Debugger Agent (diagnosis)
 *   - Fixer Agent (patches)
 *   - Deploy Checker Agent (deployment health)
 *   - Verifier Agent (confirmation)
 */

import { createHash } from "node:crypto"

import type {
	BugSeverity,
	IncidentInputRaw,
	IncidentRecord,
	IncidentStatus,
	HealingActionRecord,
	RootCauseCategory,
	RepairPlan,
} from "../types"
import { BugSeverity as BugSeverityEnum, IncidentStatus as IncidentStatusEnum } from "../types"
import type { MemoryStore } from "../memory/MemoryStore"
import type { EventLog } from "../logging/EventLog"
import type { LogAggregator } from "../infrastructure/LogAggregator"
import { v4 as uuidv4 } from "uuid"

/** Maximum length for incident title to prevent DB issues */
const MAX_TITLE_LENGTH = 500
/** Maximum length for incident symptom to prevent DB issues */
const MAX_SYMPTOM_LENGTH = 2000
/** Maximum number of affected files allowed */
const MAX_AFFECTED_FILES = 100
/** Maximum age in days for healing actions before cleanup */
const DEFAULT_ACTION_CLEANUP_DAYS = 30

export interface HealingBusConfig {
	/** Auto-fix policies by severity */
	autoFixPolicies?: {
		low?: boolean
		medium?: boolean
		high?: boolean
		critical?: boolean
	}
	/** Whether to allow auto-fix at all */
	autoFixEnabled?: boolean
}

export interface IncidentFilter {
	status?: IncidentStatus | IncidentStatus[]
	severity?: BugSeverity
	featureKey?: string
	sourceAgent?: string
	limit?: number
}

/**
 * Generate a deterministic fingerprint for deduplication.
 * Same issue should produce same fingerprint.
 */
export function makeIncidentFingerprint(input: {
	featureKey?: string | null
	sourceAgent?: string
	title?: string
	symptom?: string
}): string {
	const key = [input.featureKey ?? "global", input.sourceAgent ?? "unknown", input.title ?? "", input.symptom ?? ""]
		.join("|")
		.toLowerCase()

	return createHash("sha256").update(key).digest("hex").slice(0, 32)
}

/**
 * Map severity to numeric rank for prioritization.
 */
export function severityRank(severity: BugSeverity): number {
	return { critical: 4, high: 3, medium: 2, low: 1 }[severity] ?? 2
}

/**
 * The HealingBus is the central coordination point for all self-healing activities.
 * It maintains incident state and logs all healing actions.
 */
export class HealingBus {
	private config: HealingBusConfig

	constructor(
		private readonly memory: MemoryStore,
		private readonly events: EventLog,
		config: HealingBusConfig = {},
		private readonly logAggregator?: LogAggregator,
	) {
		this.config = {
			autoFixPolicies: {
				low: true,
				medium: false,
				high: false,
				critical: false,
			},
			autoFixEnabled: true,
			...config,
		}
	}

	/**
	 * Validate incident input data.
	 * @throws Error if validation fails
	 */
	private validateIncidentInput(input: IncidentInputRaw): void {
		// Validate title
		if (typeof input.title !== "string") {
			throw new Error("IncidentInputRaw.title is required and must be a string")
		}
		if (input.title.trim().length === 0) {
			throw new Error("IncidentInputRaw.title cannot be empty")
		}
		if (input.title.length > MAX_TITLE_LENGTH) {
			throw new Error(`IncidentInputRaw.title exceeds maximum length of ${MAX_TITLE_LENGTH} characters`)
		}

		// Validate symptom
		if (typeof input.symptom !== "string") {
			throw new Error("IncidentInputRaw.symptom is required and must be a string")
		}
		if (input.symptom.trim().length === 0) {
			throw new Error("IncidentInputRaw.symptom cannot be empty")
		}
		if (input.symptom.length > MAX_SYMPTOM_LENGTH) {
			throw new Error(`IncidentInputRaw.symptom exceeds maximum length of ${MAX_SYMPTOM_LENGTH} characters`)
		}

		// Validate severity if provided
		if (input.severity !== undefined) {
			const validSeverities = Object.values(BugSeverityEnum)
			if (!validSeverities.includes(input.severity)) {
				throw new Error(`Invalid severity: ${input.severity}. Must be one of: ${validSeverities.join(", ")}`)
			}
		}

		// Validate status if provided
		if (input.status !== undefined) {
			const validStatuses = Object.values(IncidentStatusEnum)
			if (!validStatuses.includes(input.status)) {
				throw new Error(`Invalid status: ${input.status}. Must be one of: ${validStatuses.join(", ")}`)
			}
		}

		// Validate affectedFiles if provided
		if (input.affectedFiles !== undefined) {
			if (!Array.isArray(input.affectedFiles)) {
				throw new Error("IncidentInputRaw.affectedFiles must be an array")
			}
			if (input.affectedFiles.length > MAX_AFFECTED_FILES) {
				throw new Error(`IncidentInputRaw.affectedFiles exceeds maximum of ${MAX_AFFECTED_FILES} files`)
			}
			for (const file of input.affectedFiles) {
				if (typeof file !== "string") {
					throw new Error("IncidentInputRaw.affectedFiles must contain only strings")
				}
			}
		}

		// Validate evidence is serializable
		if (input.evidence !== undefined) {
			try {
				JSON.stringify(input.evidence)
			} catch {
				throw new Error("IncidentInputRaw.evidence must be JSON-serializable")
			}
		}
	}

	/**
	 * Report a new incident or update existing by fingerprint.
	 * Uses upsert pattern to prevent duplicate incidents.
	 */
	async reportIncident(input: IncidentInputRaw): Promise<IncidentRecord> {
		// Validate input before processing
		this.validateIncidentInput(input)

		const fingerprint = input.fingerprint ?? makeIncidentFingerprint(input)
		const now = Date.now()

		// Atomic upsert: try INSERT first, fallback to UPDATE on UNIQUE conflict
		const id = `inc_${uuidv4()}`
		const row = {
			id,
			fingerprint,
			featureKey: input.featureKey ?? null,
			sourceAgent: input.sourceAgent ?? "unknown_agent",
			title: input.title.trim(),
			symptom: input.symptom.trim(),
			severity: input.severity ?? "medium",
			status: input.status ?? "new",
			rootCauseCategory: input.rootCauseCategory ?? null,
			affectedFiles: JSON.stringify(input.affectedFiles ?? []),
			recommendedAction: input.recommendedAction ?? null,
			evidence: JSON.stringify(input.evidence ?? {}),
			autoFixAllowed: input.autoFixAllowed === undefined ? 0 : input.autoFixAllowed ? 1 : -1,
			createdAt: now,
			updatedAt: now,
		}

		const insert = this.memory
			.getDb()
			.prepare(
				`INSERT INTO healing_incidents
					(id, fingerprint, feature_key, source_agent, title, symptom, severity,
					 status, root_cause_category, affected_files, recommended_action,
					 evidence, auto_fix_allowed, created_at, updated_at)
				 VALUES
					(@id, @fingerprint, @featureKey, @sourceAgent, @title, @symptom, @severity,
					 @status, @rootCauseCategory, @affectedFiles, @recommendedAction,
					 @evidence, @autoFixAllowed, @createdAt, @updatedAt)
				 ON CONFLICT(fingerprint) DO UPDATE SET
					updated_at = excluded.updated_at,
					title = excluded.title,
					symptom = excluded.symptom,
					severity = excluded.severity,
					status = excluded.status,
					root_cause_category = excluded.root_cause_category,
					affected_files = excluded.affected_files,
					recommended_action = excluded.recommended_action,
					evidence = excluded.evidence,
					auto_fix_allowed = excluded.auto_fix_allowed,
					fix_attempts = fix_attempts + CASE WHEN excluded.status = 'new' AND status = 'reopened' THEN 1 ELSE 0 END`,
			)
			.run(row)

		// If a row was updated (not inserted), changes will be 1 but lastInsertRowid points to existing row.
		// Resolve the incident by fingerprint to return the correct record.
		const incident = this.getByFingerprint(fingerprint)
		if (!incident) {
			throw new Error(`Failed to retrieve incident ${id} after upsert`)
		}

		// If we performed an UPDATE, the id from uuidv4() is stale; use the actual incident id.
		const resolvedId = insert.changes === 1 && this.get(id) ? id : incident.id

		this.events.warn("healing.incident_reported", `Incident reported: ${input.title}`, {
			incidentId: resolvedId,
			data: { severity: incident.severity, sourceAgent: incident.sourceAgent, fingerprint },
		})

		// Forward to LogAggregator if available
		this.logAggregator?.log(
			"healing",
			incident.severity === "critical" || incident.severity === "high" ? "error" : "warn",
			`Incident reported: ${input.title}`,
			{
				incidentId: resolvedId,
				severity: incident.severity,
				sourceAgent: incident.sourceAgent,
				fingerprint,
				featureKey: input.featureKey,
			},
		)

		await this.logHealingAction(
			resolvedId,
			"incident_reported",
			incident.sourceAgent,
			"Incident reported",
			{ input },
			{ incident },
		)

		return incident
	}

	/**
	 * Get a single incident by ID.
	 */
	get(id: string): IncidentRecord | null {
		const row = this.memory.getDb().prepare("SELECT * FROM healing_incidents WHERE id = ?").get(id) as
			| HealingIncidentRow
			| undefined

		return row ? rowToIncident(row) : null
	}

	/**
	 * Get an incident by fingerprint (for deduplication).
	 */
	getByFingerprint(fingerprint: string): IncidentRecord | null {
		const row = this.memory
			.getDb()
			.prepare("SELECT * FROM healing_incidents WHERE fingerprint = ?")
			.get(fingerprint) as HealingIncidentRow | undefined

		return row ? rowToIncident(row) : null
	}

	/**
	 * List incidents with optional filtering.
	 */
	list(filter: IncidentFilter = {}): IncidentRecord[] {
		const conditions: string[] = []
		const params: Record<string, unknown> = {}

		if (filter.status) {
			if (Array.isArray(filter.status)) {
				conditions.push(`status IN (${filter.status.map((s, i) => `@status${i}`).join(", ")})`)
				filter.status.forEach((s, i) => {
					params[`status${i}`] = s
				})
			} else {
				conditions.push("status = @status")
				params.status = filter.status
			}
		}

		if (filter.severity) {
			conditions.push("severity = @severity")
			params.severity = filter.severity
		}

		if (filter.featureKey) {
			conditions.push("feature_key = @featureKey")
			params.featureKey = filter.featureKey
		}

		if (filter.sourceAgent) {
			conditions.push("source_agent = @sourceAgent")
			params.sourceAgent = filter.sourceAgent
		}

		const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
		const orderBy = "ORDER BY created_at DESC"
		const limitClause =
			filter.limit && Number.isInteger(filter.limit) && filter.limit > 0 ? `LIMIT ${filter.limit}` : ""

		const query = `SELECT * FROM healing_incidents ${whereClause} ${orderBy} ${limitClause}`
		const rows = this.memory.getDb().prepare(query).all(params) as HealingIncidentRow[]

		return rows.map(rowToIncident)
	}

	/**
	 * List only open (non-resolved) incidents.
	 */
	listOpen(limit = 50): IncidentRecord[] {
		const openStatuses: IncidentStatus[] = [
			"new",
			"investigating",
			"queued_for_fix",
			"fixing",
			"fix_ready",
			"deployed",
			"reopened",
		]

		return this.list({ status: openStatuses, limit })
	}

	/**
	 * Update an incident's properties.
	 */
	updateIncident(id: string, patch: Partial<IncidentInputRaw> & { updatedAt?: number }): IncidentRecord {
		const existing = this.get(id)
		if (!existing) {
			throw new Error(`Incident ${id} not found`)
		}

		const now = patch.updatedAt ?? Date.now()
		const updates: string[] = []
		const params: Record<string, unknown> = { id, updatedAt: now }

		if (patch.title !== undefined) {
			updates.push("title = @title")
			params.title = patch.title
		}
		if (patch.symptom !== undefined) {
			updates.push("symptom = @symptom")
			params.symptom = patch.symptom
		}
		if (patch.severity !== undefined) {
			updates.push("severity = @severity")
			params.severity = patch.severity
		}
		if (patch.status !== undefined) {
			updates.push("status = @status")
			params.status = patch.status
		}
		if (patch.rootCauseCategory !== undefined) {
			updates.push("root_cause_category = @rootCauseCategory")
			params.rootCauseCategory = patch.rootCauseCategory
		}
		if (patch.affectedFiles !== undefined) {
			updates.push("affected_files = @affectedFiles")
			params.affectedFiles = JSON.stringify(patch.affectedFiles)
		}
		if (patch.recommendedAction !== undefined) {
			updates.push("recommended_action = @recommendedAction")
			params.recommendedAction = patch.recommendedAction
		}
		if (patch.evidence !== undefined) {
			updates.push("evidence = @evidence")
			params.evidence = JSON.stringify(patch.evidence)
		}
		if (patch.autoFixAllowed !== undefined) {
			updates.push("auto_fix_allowed = @autoFixAllowed")
			params.autoFixAllowed = patch.autoFixAllowed ? 1 : -1
		}
		if (patch.fixAttempts !== undefined) {
			updates.push("fix_attempts = @fixAttempts")
			params.fixAttempts = patch.fixAttempts
		}

		updates.push("updated_at = @updatedAt")

		const query = `UPDATE healing_incidents SET ${updates.join(", ")} WHERE id = @id`
		this.memory.getDb().prepare(query).run(params)

		const updated = this.get(id)
		if (!updated) {
			throw new Error(`Failed to retrieve incident ${id} after update`)
		}

		this.events.info("healing.incident_updated", `Incident ${id} updated: ${patch.status ?? "properties"}`, {
			incidentId: id,
			data: { status: updated.status, severity: updated.severity },
		})

		return updated
	}

	/**
	 * Check if auto-fix is allowed for a given incident.
	 */
	isAutoFixAllowed(incident: IncidentRecord): boolean {
		if (!this.config.autoFixEnabled) return false
		const autoFixOverride = (incident as IncidentRecord & { autoFixOverride?: boolean | null }).autoFixOverride
		if (autoFixOverride !== undefined && autoFixOverride !== null) {
			return autoFixOverride
		}

		const policy = this.config.autoFixPolicies?.[incident.severity]
		return policy === true
	}

	/**
	 * Log a healing action for audit trail.
	 */
	async logHealingAction(
		incidentId: string,
		actionType: string,
		actorAgent: string,
		summary: string,
		input: Record<string, unknown> = {},
		output: Record<string, unknown> = {},
	): Promise<HealingActionRecord> {
		const id = `ha_${uuidv4()}`
		const now = Date.now()

		this.memory
			.getDb()
			.prepare(
				`INSERT INTO healing_actions
					(id, incident_id, action_type, actor_agent, summary, input, output, created_at)
				 VALUES
					(@id, @incidentId, @actionType, @actorAgent, @summary, @input, @output, @createdAt)`,
			)
			.run({
				id,
				incidentId,
				actionType,
				actorAgent,
				summary,
				input: JSON.stringify(input),
				output: JSON.stringify(output),
				createdAt: now,
			})

		return {
			id,
			incidentId,
			actionType,
			actorAgent,
			summary,
			input,
			output,
			createdAt: now,
		}
	}

	/**
	 * Get healing action history for an incident.
	 */
	getHealingActions(incidentId: string): HealingActionRecord[] {
		const rows = this.memory
			.getDb()
			.prepare("SELECT * FROM healing_actions WHERE incident_id = ? ORDER BY created_at DESC, rowid DESC")
			.all(incidentId) as HealingActionRow[]

		return rows.map(rowToHealingAction)
	}

	/**
	 * Cleanup old healing actions to prevent unbounded database growth.
	 * @param maxAgeDays Maximum age in days (default: 30)
	 * @returns Number of actions deleted
	 */
	cleanupOldHealingActions(maxAgeDays = DEFAULT_ACTION_CLEANUP_DAYS): number {
		const cutoffTime = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
		const result = this.memory.getDb().prepare("DELETE FROM healing_actions WHERE created_at <= ?").run(cutoffTime)

		const deleted = result.changes
		if (deleted > 0) {
			this.events.info("healing.cleanup_actions", `Cleaned up ${deleted} old healing actions`, {
				data: { maxAgeDays, cutoffTime },
			})
		}
		return deleted
	}

	/**
	 * Get healing metrics for analysis and monitoring.
	 */
	getHealingMetrics(): {
		totalIncidents: number
		openIncidents: number
		verifiedIncidents: number
		blockedIncidents: number
		autoFixSuccessRate: number
		averageTimeToResolution: number | null
		incidentsBySeverity: Record<BugSeverity, number>
		incidentsByStatus: Record<IncidentStatus, number>
	} {
		const db = this.memory.getDb()

		// Get total counts by status
		const statusCounts = db
			.prepare("SELECT status, COUNT(*) as count FROM healing_incidents GROUP BY status")
			.all() as { status: string; count: number }[]

		const incidentsByStatus = {} as Record<IncidentStatus, number>
		for (const { status, count } of statusCounts) {
			incidentsByStatus[status as IncidentStatus] = count
		}

		// Get counts by severity
		const severityCounts = db
			.prepare("SELECT severity, COUNT(*) as count FROM healing_incidents GROUP BY severity")
			.all() as { severity: string; count: number }[]

		const incidentsBySeverity = {} as Record<BugSeverity, number>
		for (const { severity, count } of severityCounts) {
			incidentsBySeverity[severity as BugSeverity] = count
		}

		// Calculate auto-fix success rate
		const autoFixed = db
			.prepare(
				`SELECT COUNT(*) as count FROM healing_actions
				 WHERE action_type = 'state_transition'
				 AND summary LIKE '%→ verified%'`,
			)
			.get() as { count: number }

		const totalResolved = db
			.prepare("SELECT COUNT(*) as count FROM healing_incidents WHERE status = 'verified'")
			.get() as { count: number }

		const autoFixSuccessRate = totalResolved.count > 0 ? autoFixed.count / totalResolved.count : 0

		// Calculate average time to resolution
		const resolutionTimes = db
			.prepare(
				`SELECT AVG(updated_at - created_at) as avg_time
				 FROM healing_incidents
				 WHERE status = 'verified' AND updated_at > created_at`,
			)
			.get() as { avg_time: number | null }

		const totalResult = db.prepare("SELECT COUNT(*) as count FROM healing_incidents").get() as { count: number }

		return {
			totalIncidents: totalResult.count,
			openIncidents:
				(incidentsByStatus["new"] ?? 0) +
				(incidentsByStatus["investigating"] ?? 0) +
				(incidentsByStatus["queued_for_fix"] ?? 0) +
				(incidentsByStatus["fixing"] ?? 0) +
				(incidentsByStatus["fix_ready"] ?? 0) +
				(incidentsByStatus["deployed"] ?? 0) +
				(incidentsByStatus["verifying"] ?? 0) +
				(incidentsByStatus["reopened"] ?? 0),
			verifiedIncidents: incidentsByStatus["verified"] ?? 0,
			blockedIncidents: incidentsByStatus["blocked"] ?? 0,
			autoFixSuccessRate,
			averageTimeToResolution: resolutionTimes.avg_time,
			incidentsBySeverity,
			incidentsByStatus,
		}
	}

	/**
	 * Transition an incident through the state machine.
	 */
	async transitionState(
		id: string,
		newStatus: IncidentStatus,
		actor: string,
		context?: Record<string, unknown>,
	): Promise<IncidentRecord> {
		const incident = this.get(id)
		if (!incident) {
			throw new Error(`Incident ${id} not found`)
		}

		// Validate state transition
		if (incident.status === newStatus) {
			throw new Error(`Invalid state transition: ${incident.status} → ${newStatus} (same status)`)
		}
		if (!isValidTransition(incident.status, newStatus)) {
			throw new Error(`Invalid state transition: ${incident.status} → ${newStatus}`)
		}

		const updated = this.updateIncident(id, { status: newStatus })

		await this.logHealingAction(
			id,
			"state_transition",
			actor,
			`State: ${incident.status} → ${newStatus}`,
			{ from: incident.status, to: newStatus, context },
			{ incident: updated },
		)

		return updated
	}

	/**
	 * Store a repair plan for an incident.
	 */
	async storeRepairPlan(incidentId: string, plan: RepairPlan, actor: string): Promise<void> {
		await this.logHealingAction(
			incidentId,
			"repair_plan_created",
			actor,
			`Repair plan created: ${plan.rootCauseCategory}`,
			{},
			{ plan },
		)
	}
}

// ──────────────────────────────────────────────────────────────────────────────
// Database row types
// ──────────────────────────────────────────────────────────────────────────────

interface HealingIncidentRow {
	id: string
	fingerprint: string
	feature_key: string | null
	source_agent: string
	title: string
	symptom: string
	severity: string
	status: string
	root_cause_category: string | null
	affected_files: string
	recommended_action: string | null
	evidence: string
	auto_fix_allowed: number
	fix_attempts: number
	created_at: number
	updated_at: number
}

interface HealingActionRow {
	id: string
	incident_id: string
	action_type: string
	actor_agent: string
	summary: string
	input: string
	output: string
	created_at: number
}

// ──────────────────────────────────────────────────────────────────────────────
// Helper functions
// ──────────────────────────────────────────────────────────────────────────────

function rowToIncident(row: HealingIncidentRow): IncidentRecord {
	return {
		id: row.id,
		fingerprint: row.fingerprint,
		featureKey: row.feature_key,
		sourceAgent: row.source_agent,
		title: row.title,
		symptom: row.symptom,
		severity: row.severity as BugSeverity,
		status: row.status as IncidentStatus,
		rootCauseCategory: row.root_cause_category as RootCauseCategory | null,
		affectedFiles: safeJsonParse<string[]>(row.affected_files, []),
		recommendedAction: row.recommended_action,
		evidence: safeJsonParse<Record<string, unknown>>(row.evidence, {}),
		autoFixAllowed: row.auto_fix_allowed === 1,
		autoFixOverride: row.auto_fix_allowed === 0 ? null : row.auto_fix_allowed === 1,
		fixAttempts: row.fix_attempts ?? 0,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	} as IncidentRecord & { autoFixOverride: boolean | null }
}

function rowToHealingAction(row: HealingActionRow): HealingActionRecord {
	return {
		id: row.id,
		incidentId: row.incident_id,
		actionType: row.action_type,
		actorAgent: row.actor_agent,
		summary: row.summary,
		input: safeJsonParse<Record<string, unknown>>(row.input, {}),
		output: safeJsonParse<Record<string, unknown>>(row.output, {}),
		createdAt: row.created_at,
	}
}

/**
 * Safely parse JSON with fallback for corrupted data.
 */
function safeJsonParse<T>(json: string, fallback: T): T {
	try {
		return JSON.parse(json) as T
	} catch {
		return fallback
	}
}

/**
 * Validate state machine transitions.
 */
function isValidTransition(from: IncidentStatus, to: IncidentStatus): boolean {
	const validTransitions: Record<IncidentStatus, IncidentStatus[]> = {
		new: ["investigating", "queued_for_fix", "blocked"],
		investigating: ["queued_for_fix", "blocked", "needs_human_approval"],
		queued_for_fix: ["fixing", "blocked", "needs_human_approval"],
		fixing: ["fix_ready", "blocked"],
		fix_ready: ["deployed", "blocked"],
		deployed: ["verifying", "blocked"],
		verifying: ["verified", "reopened"],
		verified: ["reopened"],
		reopened: ["investigating", "queued_for_fix", "blocked"],
		blocked: ["investigating"],
		needs_human_approval: ["queued_for_fix", "blocked"],
	}

	return validTransitions[from]?.includes(to) ?? false
}
