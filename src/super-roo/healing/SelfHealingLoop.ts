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
 *
 * Phase 1 enhancements:
 *   - Escalation rules for repeated failures
 *   - Failure count tracking per incident signature
 */

import type { IncidentRecord, IncidentStatus, RootCauseCategory, TaskInputRaw, TaskPriority } from "../types"
import type { SuperRooOrchestrator } from "../orchestrator/SuperRooOrchestrator"
import { CancellableSleep } from "../utils/CancellableSleep"
import { HealingBus } from "./HealingBus"
import { classifyRootCause, requiresHumanApproval } from "./RootCauseClassifier"
import { buildRepairPlan, severityToPriority } from "./RepairPlanBuilder"

// ──────────────────────────────────────────────────────────────────────────────
// Escalation types
// ──────────────────────────────────────────────────────────────────────────────

export type EscalationAction = "warn" | "notify" | "block" | "circuit_breaker"

export interface EscalationPolicy {
	/** Maximum retries before escalation. Default: 3 */
	maxRetries: number
	/** Action to take when escalation threshold is reached */
	escalationAction: EscalationAction
	/** Whether to skip auto-repair after escalation */
	skipAutoRepair: boolean
}

export interface IncidentSignature {
	category: RootCauseCategory
	affectedFile: string
}

export interface FailureRecord {
	signature: IncidentSignature
	failureCount: number
	lastFailureAt: number
	escalated: boolean
}

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
	/** Max consecutive failures before circuit breaker opens. Default: 5 */
	circuitBreakerThreshold?: number
	/** Milliseconds to wait after circuit breaker opens. Default: 300000 (5m) */
	circuitBreakerTimeoutMs?: number
	/** Max backoff delay between cycles on error. Default: 300000 (5m) */
	maxBackoffMs?: number
	/** Cleanup old healing actions every N cycles. Default: 10 */
	cleanupIntervalCycles?: number
	/** Escalation policy for repeated failures. Default: 3 retries, warn, skip auto-repair */
	escalationPolicy?: EscalationPolicy
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
	/** Number of consecutive cycle failures */
	consecutiveFailures: number
	/** Whether circuit breaker is currently open */
	circuitBreakerOpen: boolean
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
		consecutiveFailures: 0,
		circuitBreakerOpen: false,
	}

	private healingBus: HealingBus
	private currentBackoffMs = 0
	private cycleCount = 0
	private readonly config: Required<SelfHealingConfig>
	private sleeper = new CancellableSleep()

	/** Tracks failure counts per incident signature for escalation */
	private failureRecords: Map<string, FailureRecord> = new Map()

	constructor(
		private readonly orchestrator: SuperRooOrchestrator,
		config: SelfHealingConfig = {
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
			circuitBreakerThreshold: 5,
			circuitBreakerTimeoutMs: 300000,
			maxBackoffMs: 300000,
			cleanupIntervalCycles: 10,
		},
	) {
		const defaultEscalationPolicy: EscalationPolicy = {
			maxRetries: 3,
			escalationAction: "warn",
			skipAutoRepair: true,
		}

		this.config = {
			circuitBreakerThreshold: 5,
			circuitBreakerTimeoutMs: 300000,
			maxBackoffMs: 300000,
			cleanupIntervalCycles: 10,
			escalationPolicy: defaultEscalationPolicy,
			...config,
		}
		this.healingBus = new HealingBus(orchestrator.memory, orchestrator.events, {
			autoFixEnabled: !this.config.suggestionOnly,
			autoFixPolicies: this.config.autoFixPolicies,
		})
	}

	// ────────────────────────────────────────────────────────────────────────────
	// Lifecycle
	// ────────────────────────────────────────────────────────────────────────────

	start(): void {
		if (this.running) return
		this.running = true
		this.stats.isRunning = true
		this.sleeper.start()
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
		this.sleeper.stop()
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
			// Circuit breaker check
			if (this.stats.circuitBreakerOpen) {
				this.orchestrator.events.warn("healing.loop.circuit_breaker", "Circuit breaker is open, skipping cycle")
				await this.sleeper.sleep(this.config.circuitBreakerTimeoutMs)
				this.stats.circuitBreakerOpen = false
				this.stats.consecutiveFailures = 0
				this.currentBackoffMs = 0
				this.orchestrator.events.info(
					"healing.loop.circuit_breaker",
					"Circuit breaker closed, resuming normal operation",
				)
				continue
			}

			let cycleSuccess = false
			try {
				await this.runHealingCycle()
				this.stats.cyclesCompleted++
				this.stats.lastCycleAt = Date.now()
				this.stats.consecutiveFailures = 0
				this.currentBackoffMs = 0
				cycleSuccess = true
			} catch (err) {
				this.stats.consecutiveFailures++
				const msg = err instanceof Error ? err.message : String(err)
				this.orchestrator.events.error(
					"healing.loop.cycle_error",
					`Healing cycle failed (${this.stats.consecutiveFailures} consecutive): ${msg}`,
				)

				// Check if circuit breaker should open
				if (this.stats.consecutiveFailures >= this.config.circuitBreakerThreshold) {
					this.stats.circuitBreakerOpen = true
					this.orchestrator.events.error(
						"healing.loop.circuit_breaker",
						`Circuit breaker opened after ${this.stats.consecutiveFailures} failures`,
					)
				}
			}

			// Cleanup old healing actions periodically
			this.cycleCount++
			if (cycleSuccess && this.cycleCount % this.config.cleanupIntervalCycles === 0) {
				try {
					const deleted = this.healingBus.cleanupOldHealingActions()
					this.orchestrator.events.debug("healing.loop.cleanup", `Cleaned up ${deleted} old healing actions`)
				} catch (cleanupErr) {
					const msg = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)
					this.orchestrator.events.warn("healing.loop.cleanup_error", `Failed to cleanup old actions: ${msg}`)
				}
			}

			// Calculate backoff delay for next cycle
			const delay = cycleSuccess ? this.config.cycleIntervalMs : this.getBackoffDelay()
			await this.sleeper.sleep(delay)
		}
	}

	/**
	 * Calculate exponential backoff delay with jitter.
	 */
	private getBackoffDelay(): number {
		const baseDelay = Math.min(
			this.config.cycleIntervalMs * Math.pow(2, this.stats.consecutiveFailures - 1),
			this.config.maxBackoffMs,
		)
		// Add jitter (±25%) to prevent thundering herd
		const jitter = baseDelay * 0.25 * (Math.random() * 2 - 1)
		return Math.floor(baseDelay + jitter)
	}

	/**
	 * Run a single healing cycle: process open incidents.
	 */
	async runHealingCycle(): Promise<{ processed: number; actions: string[] }> {
		const incidents = this.healingBus.listOpen(this.config.maxPerCycle)
		const actions: string[] = []

		for (const incident of incidents) {
			try {
				const action = await this.processIncident(incident)
				if (action) {
					actions.push(`${incident.id}: ${action}`)
				}
				this.stats.incidentsProcessed++
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err)
				this.orchestrator.events.error(
					"healing.loop.incident_error",
					`Failed to process incident ${incident.id}: ${msg}`,
					{
						incidentId: incident.id,
					},
				)
				// Continue processing other incidents - don't let one failure stop the cycle
			}
		}

		return { processed: incidents.length, actions }
	}

	/**
	 * Process a single incident through the state machine.
	 * Checks escalation rules before processing.
	 */
	private async processIncident(incident: IncidentRecord): Promise<string | null> {
		// Skip already processed terminal states
		if (["verified", "blocked", "needs_human_approval"].includes(incident.status)) {
			return null
		}

		// Check escalation before processing
		if (this.shouldEscalate(incident)) {
			const category = incident.rootCauseCategory ?? "UNKNOWN"
			const firstFile = incident.affectedFiles[0] ?? "unknown"
			const signature = this.makeSignature(category, firstFile)
			const record = this.failureRecords.get(signature)

			const action = this.config.escalationPolicy.escalationAction
			this.orchestrator.events.warn(
				"healing.loop.escalated",
				`Incident ${incident.id} escalated after ${record?.failureCount ?? 0} failures (action: ${action})`,
				{
					incidentId: incident.id,
					data: { category, affectedFile: firstFile, failureCount: record?.failureCount, action },
				},
			)

			// Block the incident if escalation policy says to skip auto-repair
			if (this.config.escalationPolicy.skipAutoRepair) {
				await this.healingBus.transitionState(incident.id, "blocked", "self_healing_loop", {
					reason: "escalated",
					failureCount: record?.failureCount,
					escalationAction: action,
				})
				this.stats.incidentsBlocked++
				return `escalated_blocked_${action}`
			}

			return "escalated_but_continuing"
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
		await this.healingBus.transitionState(incident.id, "investigating", "self_healing_loop", {
			reason: "Starting investigation",
		})

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
			await this.healingBus.transitionState(incident.id, "queued_for_fix", "self_healing_loop", {
				autoFixAllowed: true,
			})
			this.stats.incidentsQueuedForFix++
			return "queued_for_auto_fix"
		}

		// Requires human approval
		await this.healingBus.transitionState(incident.id, "needs_human_approval", "self_healing_loop", {
			reason: requiresHumanApproval(category) ? "category_requires_approval" : "auto_fix_disabled",
		})
		this.stats.incidentsNeedHumanApproval++

		// Create a task for human review
		this.queueHumanApprovalTask(incident, category)

		return "needs_human_approval"
	}

	private async processQueuedIncident(incident: IncidentRecord): Promise<string> {
		// Transition to fixing and queue a coder task
		await this.healingBus.transitionState(incident.id, "fixing", "self_healing_loop", {
			reason: "Starting automated fix",
		})

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
			await this.healingBus.transitionState(incident.id, "blocked", "self_healing_loop", {
				reason: "fix_timeout",
				elapsedMs: elapsed,
			})
			this.stats.incidentsBlocked++
			return "blocked_timeout"
		}

		return null // Still in progress
	}

	private async processFixReadyIncident(incident: IncidentRecord): Promise<string> {
		// Mark as deployed (in real impl, this would be done by deploy checker)
		await this.healingBus.transitionState(incident.id, "deployed", "self_healing_loop", {
			reason: "Fix ready for deployment",
		})

		return "marked_deployed"
	}

	private async processDeployedIncident(incident: IncidentRecord): Promise<string> {
		// Start verification
		await this.healingBus.transitionState(incident.id, "verifying", "self_healing_loop", {
			reason: "Starting verification",
		})

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
			await this.healingBus.transitionState(incident.id, "reopened", "self_healing_loop", {
				reason: "verification_timeout",
				elapsedMs: elapsed,
			})
			return "reopened_timeout"
		}

		return null // Still verifying
	}

	private async processReopenedIncident(incident: IncidentRecord): Promise<string> {
		// Check retry count
		const fixAttempts = incident.fixAttempts ?? 0

		if (fixAttempts >= this.config.maxRetries) {
			await this.healingBus.transitionState(incident.id, "blocked", "self_healing_loop", {
				reason: "max_retries_exceeded",
				attempts: fixAttempts,
			})
			this.stats.incidentsBlocked++
			return "blocked_max_retries"
		}

		// Re-classify and try again
		await this.healingBus.transitionState(incident.id, "investigating", "self_healing_loop", {
			reason: "reopened_retry",
			attempt: fixAttempts + 1,
		})

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
				systemPromptOverlay:
					`You are fixing an incident classified as ${category}. ` +
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
				systemPromptOverlay:
					`Verify that incident ${incident.id} is resolved. ` +
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
				systemPromptOverlay:
					`This incident requires human review before fixing. ` +
					`Category: ${category}. Severity: ${incident.severity}. ` +
					`Please review and approve or reject the proposed fix.`,
			},
		}

		this.orchestrator.submit(task)
	}

	// ────────────────────────────────────────────────────────────────────────────
	// Escalation
	// ────────────────────────────────────────────────────────────────────────────

	/**
	 * Build a deterministic signature for an incident based on category + affected file.
	 */
	private makeSignature(category: RootCauseCategory, affectedFile: string): string {
		return `${category}::${affectedFile}`
	}

	/**
	 * Check whether an incident should be escalated based on failure history.
	 * Returns true if the incident signature has failed >= maxRetries times.
	 */
	shouldEscalate(incident: IncidentRecord): boolean {
		const category = incident.rootCauseCategory ?? "UNKNOWN"
		if (category === "UNKNOWN") return false

		const firstFile = incident.affectedFiles[0] ?? "unknown"
		const signature = this.makeSignature(category, firstFile)
		const record = this.failureRecords.get(signature)

		if (!record) return false
		if (record.escalated) return true // Already escalated

		return record.failureCount >= this.config.escalationPolicy.maxRetries
	}

	/**
	 * Record a failure for an incident signature.
	 * Increments the failure count and marks as escalated if threshold is reached.
	 */
	recordFailure(incident: IncidentRecord): void {
		const category = incident.rootCauseCategory ?? "UNKNOWN"
		const firstFile = incident.affectedFiles[0] ?? "unknown"
		const signature = this.makeSignature(category, firstFile)

		const existing = this.failureRecords.get(signature)
		const newCount = (existing?.failureCount ?? 0) + 1
		const escalated = newCount >= this.config.escalationPolicy.maxRetries

		this.failureRecords.set(signature, {
			signature: { category, affectedFile: firstFile },
			failureCount: newCount,
			lastFailureAt: Date.now(),
			escalated,
		})

		if (escalated) {
			this.orchestrator.events.warn(
				"healing.loop.escalation_threshold",
				`Incident signature ${signature} reached ${newCount} failures, escalating`,
				{
					data: {
						signature,
						failureCount: newCount,
						escalationAction: this.config.escalationPolicy.escalationAction,
					},
				},
			)
		}
	}

	/**
	 * Get all failure records for diagnostics.
	 */
	getFailureRecords(): Map<string, FailureRecord> {
		return new Map(this.failureRecords)
	}

	/**
	 * Clear failure records for a specific signature (e.g., after successful fix).
	 */
	clearFailureRecord(incident: IncidentRecord): void {
		const category = incident.rootCauseCategory ?? "UNKNOWN"
		const firstFile = incident.affectedFiles[0] ?? "unknown"
		const signature = this.makeSignature(category, firstFile)
		this.failureRecords.delete(signature)
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
}
