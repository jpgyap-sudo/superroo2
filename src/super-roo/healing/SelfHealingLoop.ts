/**
 * Super Roo — Self-Healing Loop.
 *
 * The core autonomous healing engine that runs continuously to:
 * 1. Monitor for new incidents
 * 2. Classify root causes
 * 3. Generate repair plans
 * 4. Queue fix tasks (or request human approval)
 * 5. Track verification status
 *
 * This works alongside the existing InfiniteImprovementLoop but focuses on
 * reactive healing (fixing problems) vs proactive improvement.
 *
 * State Machine:
 *   new → investigating → queued_for_fix → fixing → fix_ready → deployed → verifying → verified
 *
 * Failure branches:
 *   verifying → reopened
 *   fixing → blocked
 *   queued_for_fix → needs_human_approval
 */

import type {
	IncidentRecord,
	IncidentStatus,
	RootCauseCategory,
	TaskInputRaw,
	TaskPriority,
} from "../types"
import type { SuperRooOrchestrator } from "../orchestrator/SuperRooOrchestrator"
import { HealingBus } from "./HealingBus"
import { classifyRootCause, requiresHumanApproval } from "./RootCauseClassifier"
import { buildRepairPlan, severityToPriority } from "./RepairPlanBuilder"

export interface SelfHealingConfig {
	/** Milliseconds between healing cycles. Default: 30000 (30s) */
	cycleIntervalMs: number
	/** Max incidents to process per cycle. Default: 10 */
	maxPerCycle: number
	/** Auto-fix policies by severity */
	autoFixPolicies: {
		low: boolean
		medium: boolean
		high: boolean
		critical: boolean
	}
	/** Whether to run in suggestion-only mode (no auto-fixes) */
	suggestionOnly: boolean
	/** Max retry attempts for reopened incidents */
	maxRetries: number
}

export interface SelfHealingStats {
	cyclesCompleted: number
	incidentsProcessed: number
	incidentsQueuedForFix: number
	incidentsAutoFixed: number
	incidentsNeedHumanApproval: number
	incidentsBlocked: number
	incidentsVerified: number
	lastCycleAt: number | null
	isRunning: boolean
}

export class SelfHealingLoop {
	private running = false
	private handle: Promise<void> | null = null
	private stats: SelfHealingStats = {
		cyclesCompleted: 0,
		incidentsProcessed: 0,
		incidentsQueuedForFix: 0,
		incidentsAutoFixed: 0,
		incidentsNeedHumanApproval: 0,
		incidentsBlocked: 0,
		incidentsVerified: 0,
		lastCycleAt: null,
		isRunning: false,
	}

	private healingBus: HealingBus

	constructor(
		private readonly orchestrator: SuperRooOrchestrator,
		private readonly config: SelfHealingConfig = {
			cycleIntervalMs: 30000,
			maxPerCycle: 10,
			autoFixPolicies: {
				low: true,
				medium: false,
				high: false,
				critical: false,
			},
			suggestionOnly: false,
			maxRetries: 3,
		},
	) {
		this.healingBus = new HealingBus(orchestrator.memory, orchestrator.events, {
			autoFixEnabled: !config.suggestionOnly,
			autoFixPolicies: config.autoFixPolicies,
		})
	}

	// ────────────────────────────────────────────────────────────────────────────
	// Lifecycle
	// ────────────────────────────────────────────────────────────────────────────

	start(): void {
		if (this.running) return
		this.running = true
		this.stats.isRunning = true
		this.orchestrator.events.info("healing.loop.started", "Self-healing loop started", {
			data: {
				cycleIntervalMs: this.config.cycleIntervalMs,
				autoFixPolicies: this.config.autoFixPolicies,
				suggestionOnly: this.config.suggestionOnly,
			},
		})
		this.handle = this.loop()
	}

	async stop(): Promise<void> {
		if (!this.running) return
		this.running = false
		this.stats.isRunning = false
		if (this.handle) {
			try {
				await this.handle
			} catch {
				// loop will have logged
			}
		}
		this.orchestrator.events.info("healing.loop.stopped", "Self-healing loop stopped")
	}

	getStats(): SelfHealingStats {
		return { ...this.stats }
	}

	getHealingBus(): HealingBus {
		return this.healingBus
	}

	// ────────────────────────────────────────────────────────────────────────────
	// Main loop
	// ────────────────────────────────────────────────────────────────────────────

	private async loop(): Promise<void> {
		while (this.running) {
			try {
				await this.runHealingCycle()
				this.stats.cyclesCompleted++
				this.stats.lastCycleAt = Date.now()
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err)
				this.orchestrator.events.error("healing.loop.cycle_error", `Healing cycle failed: ${msg}`)
			}

			await this.sleep(this.config.cycleIntervalMs)
		}
	}

	/**
	 * Run a single healing cycle: process open incidents.
	 */
	async runHealingCycle(): Promise<{ processed: number; actions: string[] }> {
		const incidents = this.healingBus.listOpen(this.config.maxPerCycle)
		const actions: string[] = []

		for (const incident of incidents) {
			const action = await this.processIncident(incident)
			if (action) {
				actions.push(`${incident.id}: ${action}`)
			}
			this.stats.incidentsProcessed++
		}

		return { processed: incidents.length, actions }
	}

	/**
	 * Process a single incident through the state machine.
	 */
	private async processIncident(incident: IncidentRecord): Promise<string | null> {
		// Skip already processed terminal states
		if (["verified", "blocked", "needs_human_approval"].includes(incident.status)) {
			return null
		}

		switch (incident.status) {
			case "new":
				return await this.processNewIncident(incident)
			case "investigating":
				return await this.processInvestigatingIncident(incident)
			case "queued_for_fix":
				return await this.processQueuedIncident(incident)
			case "fixing":
				return await this.processFixingIncident(incident)
			case "fix_ready":
				return await this.processFixReadyIncident(incident)
			case "deployed":
				return await this.processDeployedIncident(incident)
			case "verifying":
				return await this.processVerifyingIncident(incident)
			case "reopened":
				return await this.processReopenedIncident(incident)
			default:
				return null
			}
	}

	// ────────────────────────────────────────────────────────────────────────────
	// State handlers
	// ────────────────────────────────────────────────────────────────────────────

	private async processNewIncident(incident: IncidentRecord): Promise<string> {
		// Transition to investigating
		await this.healingBus.transitionState(
			incident.id,
			"investigating",
			"self_healing_loop",
			{ reason: "Starting investigation" },
		)

		// Classify root cause
		const classification = classifyRootCause(incident)
		await this.healingBus.updateIncident(incident.id, {
			rootCauseCategory: classification.category,
		})

		// Build repair plan
		const repairPlan = buildRepairPlan(incident, {
			rootCauseCategory: classification.category,
		})

		await this.healingBus.storeRepairPlan(incident.id, repairPlan, "self_healing_loop")

		this.orchestrator.events.info(
			"healing.incident_classified",
			`Incident ${incident.id} classified as ${classification.category}`,
			{
				incidentId: incident.id,
				data: { category: classification.category, confidence: classification.confidence },
			},
		)

		return `classified as ${classification.category}`
	}

	private async processInvestigatingIncident(incident: IncidentRecord): Promise<string> {
		const category = incident.rootCauseCategory ?? "UNKNOWN"

		// Determine if auto-fix is allowed
		const autoFixAllowed = this.isAutoFixAllowed(incident, category)

		if (autoFixAllowed) {
			// Queue for automatic fix
			await this.healingBus.transitionState(
				incident.id,
				"queued_for_fix",
				"self_healing_loop",
				{ autoFixAllowed: true },
			)
			this.stats.incidentsQueuedForFix++
			return "queued_for_auto_fix"
		}

		// Requires human approval
		await this.healingBus.transitionState(
			incident.id,
			"needs_human_approval",
			"self_healing_loop",
			{ reason: requiresHumanApproval(category) ? "category_requires_approval" : "auto_fix_disabled" },
		)
		this.stats.incidentsNeedHumanApproval++

		// Create a task for human review
		this.queueHumanApprovalTask(incident, category)

		return "needs_human_approval"
	}

	private async processQueuedIncident(incident: IncidentRecord): Promise<string> {
		// Transition to fixing and queue a coder task
		await this.healingBus.transitionState(
			incident.id,
			"fixing",
			"self_healing_loop",
			{ reason: "Starting automated fix" },
		)

		// Queue a fix task
		this.queueFixTask(incident)

		return "started_fixing"
	}

	private async processFixingIncident(incident: IncidentRecord): Promise<string | null> {
		// This state is held while a fixer agent works
		// The agent will transition to fix_ready when done
		// We just check for timeout/stuck incidents
		const updatedAt = incident.updatedAt
		const elapsed = Date.now() - updatedAt
		const timeoutMs = 10 * 60 * 1000 // 10 minutes

		if (elapsed > timeoutMs) {
			await this.healingBus.transitionState(
				incident.id,
				"blocked",
				"self_healing_loop",
				{ reason: "fix_timeout", elapsedMs: elapsed },
			)
			this.stats.incidentsBlocked++
			return "blocked_timeout"
		}

		return null // Still in progress
	}

	private async processFixReadyIncident(incident: IncidentRecord): Promise<string> {
		// Mark as deployed (in real impl, this would be done by deploy checker)
		await this.healingBus.transitionState(
			incident.id,
			"deployed",
			"self_healing_loop",
			{ reason: "Fix ready for deployment" },
		)

		return "marked_deployed"
	}

	private async processDeployedIncident(incident: IncidentRecord): Promise<string> {
		// Start verification
		await this.healingBus.transitionState(
			incident.id,
			"verifying",
			"self_healing_loop",
			{ reason: "Starting verification" },
		)

		// Queue a verification task
		this.queueVerificationTask(incident)

		return "started_verification"
	}

	private async processVerifyingIncident(incident: IncidentRecord): Promise<string | null> {
		// This state is held while verifier runs
		// Similar to fixing, check for timeout
		const updatedAt = incident.updatedAt
		const elapsed = Date.now() - updatedAt
		const timeoutMs = 5 * 60 * 1000 // 5 minutes

		if (elapsed > timeoutMs) {
			// Verification timed out - reopen
			await this.healingBus.transitionState(
				incident.id,
				"reopened",
				"self_healing_loop",
				{ reason: "verification_timeout", elapsedMs: elapsed },
			)
			return "reopened_timeout"
		}

		return null // Still verifying
	}

	private async processReopenedIncident(incident: IncidentRecord): Promise<string> {
		// Check retry count
		const fixAttempts = incident.fixAttempts ?? 0

		if (fixAttempts >= this.config.maxRetries) {
			await this.healingBus.transitionState(
				incident.id,
				"blocked",
				"self_healing_loop",
				{ reason: "max_retries_exceeded", attempts: fixAttempts },
			)
			this.stats.incidentsBlocked++
			return "blocked_max_retries"
		}

		// Re-classify and try again
		await this.healingBus.transitionState(
			incident.id,
			"investigating",
			"self_healing_loop",
			{ reason: "reopened_retry", attempt: fixAttempts + 1 },
		)

		return "retrying"
	}

	// ────────────────────────────────────────────────────────────────────────────
	// Task queueing
	// ────────────────────────────────────────────────────────────────────────────

	private queueFixTask(incident: IncidentRecord): void {
		const category = incident.rootCauseCategory ?? "UNKNOWN"
		const priority = severityToPriority(incident.severity)

		const task: TaskInputRaw = {
			agent: "coder",
			goal: `Fix incident ${incident.id}: ${incident.title}`,
			priority,
			requiredCapabilities: ["read.file", "write.file", "execute.command"],
			payload: {
				incidentId: incident.id,
				rootCauseCategory: category,
				symptom: incident.symptom,
				affectedFiles: incident.affectedFiles,
				systemPromptOverlay: `You are fixing an incident classified as ${category}. ` +
					`Apply the smallest safe patch. Run targeted tests. ` +
					`Do not change unrelated code.`,
			},
		}

		this.orchestrator.submit(task)
		this.stats.incidentsAutoFixed++
	}

	private queueVerificationTask(incident: IncidentRecord): void {
		const priority = severityToPriority(incident.severity)

		const task: TaskInputRaw = {
			agent: "tester",
			goal: `Verify fix for incident ${incident.id}`,
			priority,
			requiredCapabilities: ["read.file", "execute.command"],
			payload: {
				incidentId: incident.id,
				verificationType: "incident_fix",
				testsToRun: ["npx vitest run --reporter=verbose"],
				systemPromptOverlay: `Verify that incident ${incident.id} is resolved. ` +
					`Run the specific failing test first, then full suite. ` +
					`Report results back to healing system.`,
			},
		}

		this.orchestrator.submit(task)
	}

	private queueHumanApprovalTask(incident: IncidentRecord, category: RootCauseCategory): void {
		const task: TaskInputRaw = {
			agent: "product-manager",
			goal: `Review incident ${incident.id} requiring human approval`,
			priority: "high",
			requiredCapabilities: ["read.file"],
			payload: {
				incidentId: incident.id,
				rootCauseCategory: category,
				severity: incident.severity,
				title: incident.title,
				symptom: incident.symptom,
				affectedFiles: incident.affectedFiles,
				reason: requiresHumanApproval(category)
					? `Category ${category} requires human approval`
					: "Auto-fix disabled by policy",
				systemPromptOverlay: `This incident requires human review before fixing. ` +
					`Category: ${category}. Severity: ${incident.severity}. ` +
					`Please review and approve or reject the proposed fix.`,
			},
		}

		this.orchestrator.submit(task)
	}

	// ────────────────────────────────────────────────────────────────────────────
	// Helpers
	// ────────────────────────────────────────────────────────────────────────────

	private isAutoFixAllowed(incident: IncidentRecord, category: RootCauseCategory): boolean {
		if (this.config.suggestionOnly) return false
		if (incident.autoFixAllowed === false) return false
		if (requiresHumanApproval(category)) return false

		const policy = this.config.autoFixPolicies[incident.severity]
		return policy === true
	}

	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms))
	}
}
