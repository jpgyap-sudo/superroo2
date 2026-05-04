/**
 * Super Roo — Parallel Healing Pipeline.
 *
 * Processes multiple healing incidents concurrently using a worker pool.
 * Instead of processing incidents one-at-a-time in the SelfHealingLoop,
 * this pipeline batches incidents and processes them in parallel across
 * multiple "healing workers".
 *
 * Each worker handles a complete incident lifecycle:
 *   classify → build repair plan → queue fix task
 *
 * This dramatically reduces healing latency when multiple incidents
 * are reported simultaneously.
 */

import type { IncidentRecord, RootCauseCategory, TaskInputRaw } from "../types"
import type { EventLog } from "../logging/EventLog"
import type { HealingBus } from "../healing/HealingBus"
import { classifyRootCause, requiresHumanApproval } from "../healing/RootCauseClassifier"
import { buildRepairPlan, severityToPriority } from "../healing/RepairPlanBuilder"

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export interface ParallelHealingConfig {
	/** Max incidents to process concurrently. Default: 3 */
	maxConcurrency: number
	/** Max incidents per batch. Default: 10 */
	maxBatchSize: number
	/** Whether to enable auto-fix. Default: true */
	autoFixEnabled: boolean
	/** Auto-fix policies by severity */
	autoFixPolicies: {
		low: boolean
		medium: boolean
		high: boolean
		critical: boolean
	}
}

export interface HealingWorkerSlot {
	incidentId: string
	status: "classifying" | "planning" | "queuing" | "done" | "error"
	startedAt: number
	category: RootCauseCategory | null
	error?: string
}

export interface HealingBatchResult {
	totalProcessed: number
	succeeded: number
	failed: number
	autoFixed: number
	needsApproval: number
	blocked: number
	results: Array<{
		incidentId: string
		status: string
		category: RootCauseCategory | null
		error?: string
	}>
}

// ──────────────────────────────────────────────────────────────────────────────
// ParallelHealingPipeline
// ──────────────────────────────────────────────────────────────────────────────

export class ParallelHealingPipeline {
	private activeWorkers: Map<string, HealingWorkerSlot> = new Map()
	private config: Required<ParallelHealingConfig>

	constructor(
		private readonly healingBus: HealingBus,
		private readonly events: EventLog,
		config: Partial<ParallelHealingConfig> = {},
	) {
		this.config = {
			maxConcurrency: config.maxConcurrency ?? 3,
			maxBatchSize: config.maxBatchSize ?? 10,
			autoFixEnabled: config.autoFixEnabled ?? true,
			autoFixPolicies: {
				low: config.autoFixPolicies?.low ?? true,
				medium: config.autoFixPolicies?.medium ?? false,
				high: config.autoFixPolicies?.high ?? false,
				critical: config.autoFixPolicies?.critical ?? false,
			},
		}
	}

	// ── Public API ────────────────────────────────────────────────────────

	/**
	 * Process a batch of incidents in parallel.
	 * Returns immediately with the batch result.
	 */
	async processBatch(incidents: IncidentRecord[]): Promise<HealingBatchResult> {
		const batch = incidents.slice(0, this.config.maxBatchSize)
		const result: HealingBatchResult = {
			totalProcessed: 0,
			succeeded: 0,
			failed: 0,
			autoFixed: 0,
			needsApproval: 0,
			blocked: 0,
			results: [],
		}

		if (batch.length === 0) return result

		this.events.info(
			"healing.parallel.batch_start",
			`Processing batch of ${batch.length} incidents (concurrency=${this.config.maxConcurrency})`,
		)

		// Process in chunks based on concurrency
		for (let i = 0; i < batch.length; i += this.config.maxConcurrency) {
			const chunk = batch.slice(i, i + this.config.maxConcurrency)
			const chunkResults = await Promise.allSettled(chunk.map((incident) => this.processSingleIncident(incident)))

			for (const chunkResult of chunkResults) {
				if (chunkResult.status === "fulfilled") {
					result.totalProcessed++
					result.results.push(chunkResult.value)
					if (chunkResult.value.error) {
						result.failed++
					} else {
						result.succeeded++
						if (chunkResult.value.status === "queued_for_fix") {
							result.autoFixed++
						} else if (chunkResult.value.status === "needs_human_approval") {
							result.needsApproval++
						} else if (chunkResult.value.status === "blocked") {
							result.blocked++
						}
					}
				} else {
					result.totalProcessed++
					result.failed++
					result.results.push({
						incidentId: "unknown",
						status: "error",
						category: null,
						error:
							chunkResult.reason instanceof Error
								? chunkResult.reason.message
								: String(chunkResult.reason),
					})
				}
			}
		}

		this.events.info(
			"healing.parallel.batch_done",
			`Batch complete: ${result.succeeded} succeeded, ${result.failed} failed, ${result.autoFixed} auto-fixed`,
			{
				data: result as unknown as Record<string, unknown>,
			},
		)

		return result
	}

	/**
	 * Get current worker status.
	 */
	getWorkerStatus(): HealingWorkerSlot[] {
		return Array.from(this.activeWorkers.values())
	}

	/**
	 * Check if pipeline is busy.
	 */
	isBusy(): boolean {
		return this.activeWorkers.size > 0
	}

	/**
	 * Wait for all active workers to complete.
	 */
	async drain(): Promise<void> {
		while (this.activeWorkers.size > 0) {
			await new Promise((resolve) => setTimeout(resolve, 100))
		}
	}

	// ── Internal ──────────────────────────────────────────────────────────

	private async processSingleIncident(incident: IncidentRecord): Promise<{
		incidentId: string
		status: string
		category: RootCauseCategory | null
		error?: string
	}> {
		const slot: HealingWorkerSlot = {
			incidentId: incident.id,
			status: "classifying",
			startedAt: Date.now(),
			category: null,
		}
		this.activeWorkers.set(incident.id, slot)

		try {
			// Phase 1: Classify
			slot.status = "classifying"
			const classification = classifyRootCause(incident)
			slot.category = classification.category

			await this.healingBus.updateIncident(incident.id, {
				rootCauseCategory: classification.category,
			})

			this.events.info(
				"healing.parallel.classified",
				`Incident ${incident.id} classified as ${classification.category}`,
				{
					incidentId: incident.id,
					data: { category: classification.category, confidence: classification.confidence },
				},
			)

			// Phase 2: Build repair plan
			slot.status = "planning"
			const repairPlan = buildRepairPlan(incident, {
				rootCauseCategory: classification.category,
			})
			await this.healingBus.storeRepairPlan(incident.id, repairPlan, "parallel_healing")

			// Phase 3: Queue fix or request approval
			slot.status = "queuing"
			const autoFixAllowed = this.isAutoFixAllowed(incident, classification.category)

			if (autoFixAllowed) {
				await this.healingBus.transitionState(incident.id, "queued_for_fix", "parallel_healing", {
					autoFixAllowed: true,
				})
				slot.status = "done"

				this.events.info("healing.parallel.queued", `Incident ${incident.id} queued for auto-fix`, {
					incidentId: incident.id,
				})

				return {
					incidentId: incident.id,
					status: "queued_for_fix",
					category: classification.category,
				}
			} else {
				const needsApproval = requiresHumanApproval(classification.category)
				const targetStatus = needsApproval ? "needs_human_approval" : "blocked"

				await this.healingBus.transitionState(incident.id, targetStatus, "parallel_healing", {
					reason: needsApproval ? "category_requires_approval" : "auto_fix_disabled",
				})
				slot.status = "done"

				return {
					incidentId: incident.id,
					status: targetStatus,
					category: classification.category,
				}
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			slot.status = "error"
			slot.error = msg

			this.events.error("healing.parallel.worker_error", `Worker for incident ${incident.id} failed: ${msg}`, {
				incidentId: incident.id,
			})

			return {
				incidentId: incident.id,
				status: "error",
				category: slot.category,
				error: msg,
			}
		} finally {
			this.activeWorkers.delete(incident.id)
		}
	}

	private isAutoFixAllowed(incident: IncidentRecord, category: RootCauseCategory): boolean {
		if (!this.config.autoFixEnabled) return false
		if (incident.autoFixAllowed === false) return false
		if (requiresHumanApproval(category)) return false

		const policy = this.config.autoFixPolicies[incident.severity]
		return policy === true
	}
}
