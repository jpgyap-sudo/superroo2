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
import type { MemoryStore } from "../memory/MemoryStore"
import type { EventLog } from "../logging/EventLog"
import { v4 as uuidv4 } from "uuid"

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
	const key = [
		input.featureKey ?? "global",
		input.sourceAgent ?? "unknown",
		input.title ?? "",
		input.symptom ?? "",
	].join("|").toLowerCase()

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
	 * Report a new incident or update existing by fingerprint.
	 * Uses upsert pattern to prevent duplicate incidents.
	 */
	async reportIncident(input: IncidentInputRaw): Promise<IncidentRecord> {
		const fingerprint = input.fingerprint ?? makeIncidentFingerprint(input)
		const now = Date.now()

		// Check if incident already exists
		const existing = this.getByFingerprint(fingerprint)

		if (existing) {
			// Update existing incident - increment fix attempts if reopened
			const updateData: Partial<IncidentInputRaw> & { updatedAt: number; fixAttempts?: number } = {
				...input,
				updatedAt: now,
			}
			if (input.status === "new" && existing.status === "reopened") {
				updateData.fixAttempts = (existing.fixAttempts ?? 0) + 1
			}
			return this.updateIncident(existing.id, updateData)
		}

		// Create new incident
		const id = `inc_${uuidv4()}`
		const row = {
			id,
			fingerprint,
			featureKey: input.featureKey ?? null,
			sourceAgent: input.sourceAgent ?? "unknown_agent",
			title: input.title,
			symptom: input.symptom,
			severity: input.severity ?? "medium",
			status: input.status ?? "new",
			rootCauseCategory: input.rootCauseCategory ?? null,
			affectedFiles: JSON.stringify(input.affectedFiles ?? []),
			recommendedAction: input.recommendedAction ?? null,
			evidence: JSON.stringify(input.evidence ?? {}),
			autoFixAllowed: input.autoFixAllowed ?? false ? 1 : 0,
			createdAt: now,
			updatedAt: now,
		}

		this.memory
			.getDb()
			.prepare(
				`INSERT INTO healing_incidents
					(id, fingerprint, feature_key, source_agent, title, symptom, severity,
					 status, root_cause_category, affected_files, recommended_action,
					 evidence, auto_fix_allowed, created_at, updated_at)
				 VALUES
					(@id, @fingerprint, @featureKey, @sourceAgent, @title, @symptom, @severity,
					 @status, @rootCauseCategory, @affectedFiles, @recommendedAction,
					 @evidence, @autoFixAllowed, @createdAt, @updatedAt)`,
			)
			.run(row)

		const incident = this.get(id)!

		this.events.warn("healing.incident_reported", `Incident reported: ${input.title}`, {
			incidentId: id,
			data: { severity: incident.severity, sourceAgent: incident.sourceAgent, fingerprint },
		})

		await this.logHealingAction(id, "incident_reported", incident.sourceAgent, "Incident reported", { input }, { incident })

		return incident
	}

	/**
	 * Get a single incident by ID.
	 */
	get(id: string): IncidentRecord | null {
		const row = this.memory
			.getDb()
			.prepare("SELECT * FROM healing_incidents WHERE id = ?")
			.get(id) as HealingIncidentRow | undefined

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
		const limitClause = filter.limit ? `LIMIT ${filter.limit}` : ""

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
			params.autoFixAllowed = patch.autoFixAllowed ? 1 : 0
		}
		if (patch.fixAttempts !== undefined) {
			updates.push("fix_attempts = @fixAttempts")
			params.fixAttempts = patch.fixAttempts
		}

		updates.push("updated_at = @updatedAt")

		const query = `UPDATE healing_incidents SET ${updates.join(", ")} WHERE id = @id`
		this.memory.getDb().prepare(query).run(params)

		const updated = this.get(id)!

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
		if (incident.autoFixAllowed === true) return true

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
			.prepare("SELECT * FROM healing_actions WHERE incident_id = ? ORDER BY created_at DESC")
			.all(incidentId) as HealingActionRow[]

		return rows.map(rowToHealingAction)
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
		affectedFiles: JSON.parse(row.affected_files) as string[],
		recommendedAction: row.recommended_action,
		evidence: JSON.parse(row.evidence) as Record<string, unknown>,
		autoFixAllowed: row.auto_fix_allowed === 1,
		fixAttempts: row.fix_attempts ?? 0,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	}
}

function rowToHealingAction(row: HealingActionRow): HealingActionRecord {
	return {
		id: row.id,
		incidentId: row.incident_id,
		actionType: row.action_type,
		actorAgent: row.actor_agent,
		summary: row.summary,
		input: JSON.parse(row.input) as Record<string, unknown>,
		output: JSON.parse(row.output) as Record<string, unknown>,
		createdAt: row.created_at,
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
