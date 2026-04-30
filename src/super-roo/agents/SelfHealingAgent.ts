/**
 * Super Roo — Self-Healing Agent.
 *
 * An agent that can be invoked to perform manual healing operations,
 * report incidents, or trigger the self-healing cycle.
 *
 * This agent serves as the bridge between the orchestrator and the
 * self-healing infrastructure, allowing:
 *   - Manual incident reporting
 *   - Triggering healing cycles
 *   - Querying healing status
 *   - Approving/rejecting fix proposals
 */

import type { Agent, AgentRunContext, AgentRunResult, TaskInputRaw } from "../types"
import type { HealingBus, IncidentFilter } from "../healing"
import type { SelfHealingLoop } from "../healing"
import { classifyFromText } from "../healing"
import { buildRepairPlan } from "../healing"

export interface SelfHealingAgentOptions {
	/** Default auto-fix policy for this agent instance */
	allowAutoFix?: boolean
}

/**
 * The SelfHealingAgent provides manual control over the healing system.
 * It can report incidents, trigger healing cycles, and manage approvals.
 */
export class SelfHealingAgent implements Agent {
	readonly name = "self-healing"
	readonly description = "Manages self-healing operations: incident reporting, cycle triggering, and approvals"
	readonly requiredCapabilities: string[] = ["read.file"]

	private healingBus: HealingBus | null = null
	private healingLoop: SelfHealingLoop | null = null

	constructor(private readonly options: SelfHealingAgentOptions = {}) {}

	/**
	 * Set the healing bus for this agent instance.
	 * Called by the orchestrator during initialization.
	 */
	setHealingBus(bus: HealingBus): void {
		this.healingBus = bus
	}

	/**
	 * Set the healing loop for this agent instance.
	 * Called by the orchestrator during initialization.
	 */
	setHealingLoop(loop: SelfHealingLoop): void {
		this.healingLoop = loop
	}

	async run(ctx: AgentRunContext): Promise<AgentRunResult> {
		const payload = ctx.task.payload ?? {}
		const operation = String(payload.operation ?? "status")

		switch (operation) {
			case "report_incident":
				return await this.handleReportIncident(ctx, payload)
			case "run_cycle":
				return await this.handleRunCycle(ctx)
			case "approve_fix":
				return await this.handleApproveFix(ctx, payload)
			case "reject_fix":
				return await this.handleRejectFix(ctx, payload)
			case "list_incidents":
				return await this.handleListIncidents(ctx, payload)
			case "get_status":
				return await this.handleGetStatus(ctx)
			case "classify":
				return await this.handleClassify(ctx, payload)
			case "build_repair_plan":
				return await this.handleBuildRepairPlan(ctx, payload)
			default:
				return {
					ok: false,
					summary: `Unknown operation: ${operation}`,
					error: "unknown_operation",
				}
		}
	}

	// ────────────────────────────────────────────────────────────────────────────
	// Operation handlers
	// ────────────────────────────────────────────────────────────────────────────

	private async handleReportIncident(
		ctx: AgentRunContext,
		payload: Record<string, unknown>,
	): Promise<AgentRunResult> {
		if (!this.healingBus) {
			return { ok: false, summary: "HealingBus not initialized", error: "not_initialized" }
		}

		const title = String(payload.title ?? "")
		const symptom = String(payload.symptom ?? "")

		if (!title || !symptom) {
			return {
				ok: false,
				summary: "Missing required fields: title and symptom",
				error: "missing_fields",
			}
		}

		// Auto-classify if not provided
		let rootCauseCategory = payload.rootCauseCategory as string | undefined
		if (!rootCauseCategory) {
			const classification = classifyFromText(`${title} ${symptom}`)
			rootCauseCategory = classification.category
		}

		const incident = await this.healingBus.reportIncident({
			title,
			symptom,
			featureKey: payload.featureKey as string | undefined,
			sourceAgent: String(payload.sourceAgent ?? ctx.task.agent),
			severity: (payload.severity as any) ?? "medium",
			rootCauseCategory: rootCauseCategory as any,
			affectedFiles: payload.affectedFiles as string[] | undefined,
			evidence: (payload.evidence as Record<string, unknown>) ?? {},
			autoFixAllowed: payload.autoFixAllowed as boolean | undefined,
		})

		// Build repair plan immediately
		const repairPlan = buildRepairPlan(incident)
		await this.healingBus.storeRepairPlan(incident.id, repairPlan, "self_healing_agent")

		return {
			ok: true,
			summary: `Incident ${incident.id} reported and classified as ${rootCauseCategory}`,
			data: {
				incident,
				repairPlan,
				autoFixAllowed: this.healingBus.isAutoFixAllowed(incident),
			},
		}
	}

	private async handleRunCycle(ctx: AgentRunContext): Promise<AgentRunResult> {
		if (!this.healingLoop) {
			return { ok: false, summary: "SelfHealingLoop not initialized", error: "not_initialized" }
		}

		const result = await this.healingLoop.runHealingCycle()

		return {
			ok: true,
			summary: `Healing cycle completed: ${result.processed} incidents processed`,
			data: result,
		}
	}

	private async handleApproveFix(
		ctx: AgentRunContext,
		payload: Record<string, unknown>,
	): Promise<AgentRunResult> {
		if (!this.healingBus) {
			return { ok: false, summary: "HealingBus not initialized", error: "not_initialized" }
		}

		const incidentId = String(payload.incidentId ?? "")
		if (!incidentId) {
			return {
				ok: false,
				summary: "Missing required field: incidentId",
				error: "missing_fields",
			}
		}

		const incident = await this.healingBus.transitionState(
			incidentId,
			"queued_for_fix",
			"self_healing_agent",
			{ approvedBy: ctx.task.agent, reason: payload.reason },
		)

		return {
			ok: true,
			summary: `Incident ${incidentId} approved for fix`,
			data: { incident },
		}
	}

	private async handleRejectFix(
		ctx: AgentRunContext,
		payload: Record<string, unknown>,
	): Promise<AgentRunResult> {
		if (!this.healingBus) {
			return { ok: false, summary: "HealingBus not initialized", error: "not_initialized" }
		}

		const incidentId = String(payload.incidentId ?? "")
		if (!incidentId) {
			return {
				ok: false,
				summary: "Missing required field: incidentId",
				error: "missing_fields",
			}
		}

		const incident = await this.healingBus.transitionState(
			incidentId,
			"blocked",
			"self_healing_agent",
			{ rejectedBy: ctx.task.agent, reason: payload.reason },
		)

		return {
			ok: true,
			summary: `Incident ${incidentId} rejected/blocked`,
			data: { incident },
		}
	}

	private async handleListIncidents(
		ctx: AgentRunContext,
		payload: Record<string, unknown>,
	): Promise<AgentRunResult> {
		if (!this.healingBus) {
			return { ok: false, summary: "HealingBus not initialized", error: "not_initialized" }
		}

		const filter: IncidentFilter = {}
		if (payload.status) {
			filter.status = payload.status as any
		}
		if (payload.severity) {
			filter.severity = payload.severity as any
		}
		if (payload.featureKey) {
			filter.featureKey = String(payload.featureKey)
		}
		if (payload.limit) {
			filter.limit = Number(payload.limit)
		}

		const incidents = this.healingBus.list(filter)

		return {
			ok: true,
			summary: `Listed ${incidents.length} incidents`,
			data: { incidents, filter },
		}
	}

	private async handleGetStatus(ctx: AgentRunContext): Promise<AgentRunResult> {
		if (!this.healingLoop || !this.healingBus) {
			return { ok: false, summary: "Healing system not initialized", error: "not_initialized" }
		}

		const stats = this.healingLoop.getStats()
		const openIncidents = this.healingBus.listOpen(100)

		return {
			ok: true,
			summary: `Self-healing ${stats.isRunning ? "running" : "stopped"}: ${openIncidents.length} open incidents`,
			data: {
				stats,
				openIncidents: openIncidents.length,
				incidentsByStatus: this.countByStatus(openIncidents),
			},
		}
	}

	private async handleClassify(
		ctx: AgentRunContext,
		payload: Record<string, unknown>,
	): Promise<AgentRunResult> {
		const text = String(payload.text ?? "")
		if (!text) {
			return {
				ok: false,
				summary: "Missing required field: text",
				error: "missing_fields",
			}
		}

		const classification = classifyFromText(text)

		return {
			ok: true,
			summary: `Classified as ${classification.category} with ${Math.round(classification.confidence * 100)}% confidence`,
			data: { ...classification },
		}
	}

	private async handleBuildRepairPlan(
		ctx: AgentRunContext,
		payload: Record<string, unknown>,
	): Promise<AgentRunResult> {
		if (!this.healingBus) {
			return { ok: false, summary: "HealingBus not initialized", error: "not_initialized" }
		}

		const incidentId = String(payload.incidentId ?? "")
		if (!incidentId) {
			return {
				ok: false,
				summary: "Missing required field: incidentId",
				error: "missing_fields",
			}
		}

		const incident = this.healingBus.get(incidentId)
		if (!incident) {
			return {
				ok: false,
				summary: `Incident ${incidentId} not found`,
				error: "not_found",
			}
		}

		const plan = buildRepairPlan(incident, {
			rootCauseCategory: payload.rootCauseCategory as any,
			forceApproval: payload.forceApproval as boolean | undefined,
		})

		await this.healingBus.storeRepairPlan(incidentId, plan, "self_healing_agent")

		return {
			ok: true,
			summary: `Repair plan built for incident ${incidentId}`,
			data: { plan, incident },
		}
	}

	// ────────────────────────────────────────────────────────────────────────────
	// Helpers
	// ────────────────────────────────────────────────────────────────────────────

	private countByStatus(incidents: Array<{ status: string }>): Record<string, number> {
		const counts: Record<string, number> = {}
		for (const inc of incidents) {
			counts[inc.status] = (counts[inc.status] ?? 0) + 1
		}
		return counts
	}
}

/**
 * Factory function to create a report incident task.
 */
export function createReportIncidentTask(
	title: string,
	symptom: string,
	options: {
		featureKey?: string
		severity?: "low" | "medium" | "high" | "critical"
		sourceAgent?: string
		affectedFiles?: string[]
		evidence?: Record<string, unknown>
	} = {},
): TaskInputRaw {
	return {
		agent: "self-healing",
		goal: `Report incident: ${title.slice(0, 50)}`,
		priority: options.severity === "critical" ? "critical" : options.severity === "high" ? "high" : "normal",
		requiredCapabilities: ["read.file"],
		payload: {
			operation: "report_incident",
			title,
			symptom,
			...options,
		},
	}
}

/**
 * Factory function to create a run healing cycle task.
 */
export function createRunHealingCycleTask(): TaskInputRaw {
	return {
		agent: "self-healing",
		goal: "Run self-healing cycle",
		priority: "high",
		requiredCapabilities: ["read.file"],
		payload: {
			operation: "run_cycle",
		},
	}
}
