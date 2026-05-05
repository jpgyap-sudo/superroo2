/**
 * Super Roo — Working Tree Agent.
 *
 * Monitors product updates, bug fixes, and feature changes to keep the
 * Working Tree (docs/resources/working-tree.md) in sync with the actual
 * codebase state. Emits events when the tree needs updating so the
 * dashboard can refresh its visualization.
 *
 * The Working Tree is the single source of truth for the SuperRoo product
 * architecture. This agent ensures it stays accurate as the system evolves.
 *
 * Integration points:
 *   - ProductMemoryService: reads features, updates, bug mappings
 *   - FeatureRegistry: reads feature status/health changes
 *   - BugRegistry: reads bug fix events
 *   - HealingBus: reads incident resolution events
 *   - EventLog: subscribes to relevant events for reactive updates
 */

import type { Agent, AgentRunContext, AgentRunResult } from "../../types"
import type { ProductMemoryService } from "../ProductMemoryService"
import type { EventLog } from "../../logging/EventLog"
import type { FeatureRegistry } from "../../features/FeatureRegistry"
import type { BugRegistry } from "../../bugs/BugRegistry"
import type { HealingBus } from "../../healing/HealingBus"

export interface WorkingTreeAgentOptions {
	service: ProductMemoryService
	events: EventLog
	features?: FeatureRegistry
	bugs?: BugRegistry
	healingBus?: HealingBus
}

/**
 * Snapshot of the current working tree state for change detection.
 * Used to determine if the tree needs updating.
 */
export interface WorkingTreeSnapshot {
	timestamp: string
	featureCount: number
	updateCount: number
	bugCount: number
	incidentCount: number
	modules: Array<{
		id: string
		label: string
		status: "stable" | "active" | "experimental" | "deprecated"
		featureCount: number
		bugCount: number
	}>
}

export class WorkingTreeAgent implements Agent {
	readonly name = "working-tree"
	readonly description =
		"Monitors product updates, bug fixes, and feature changes to keep the Working Tree in sync with the codebase"
	readonly requiredCapabilities: string[] = ["product_memory", "read"]

	private readonly service: ProductMemoryService
	private readonly events: EventLog
	private readonly features?: FeatureRegistry
	private readonly bugs?: BugRegistry
	private readonly healingBus?: HealingBus

	/** Last known snapshot for change detection */
	private lastSnapshot: WorkingTreeSnapshot | null = null

	constructor(opts: WorkingTreeAgentOptions) {
		this.service = opts.service
		this.events = opts.events
		this.features = opts.features
		this.bugs = opts.bugs
		this.healingBus = opts.healingBus
	}

	async run(ctx: AgentRunContext): Promise<AgentRunResult> {
		const payload = ctx.task.payload ?? {}
		const operation = String(payload.operation ?? "checkTree")

		switch (operation) {
			case "checkTree":
				return this.handleCheckTree(ctx)
			case "refreshTree":
				return this.handleRefreshTree(ctx)
			case "getTreeStatus":
				return this.handleGetTreeStatus(ctx)
			case "onProductUpdate":
				return this.handleOnProductUpdate(ctx, payload)
			case "onBugFix":
				return this.handleOnBugFix(ctx, payload)
			case "onFeatureChange":
				return this.handleOnFeatureChange(ctx, payload)
			default:
				return {
					ok: false,
					summary: `Unknown operation: ${operation}. Supported: checkTree, refreshTree, getTreeStatus, onProductUpdate, onBugFix, onFeatureChange`,
					error: `Unknown operation: ${operation}`,
				}
		}
	}

	/**
	 * Check if the working tree needs updating by comparing current state
	 * against the last known snapshot. Emits an event if changes are detected.
	 */
	private async handleCheckTree(ctx: AgentRunContext): Promise<AgentRunResult> {
		const snapshot = await this.takeSnapshot()

		if (this.lastSnapshot) {
			const changes: string[] = []

			if (snapshot.featureCount !== this.lastSnapshot.featureCount) {
				changes.push(`Features: ${this.lastSnapshot.featureCount} → ${snapshot.featureCount}`)
			}
			if (snapshot.updateCount !== this.lastSnapshot.updateCount) {
				changes.push(`Updates: ${this.lastSnapshot.updateCount} → ${snapshot.updateCount}`)
			}
			if (snapshot.bugCount !== this.lastSnapshot.bugCount) {
				changes.push(`Bugs: ${this.lastSnapshot.bugCount} → ${snapshot.bugCount}`)
			}
			if (snapshot.incidentCount !== this.lastSnapshot.incidentCount) {
				changes.push(`Incidents: ${this.lastSnapshot.incidentCount} → ${snapshot.incidentCount}`)
			}

			// Check module status changes
			for (const mod of snapshot.modules) {
				const prev = this.lastSnapshot.modules.find((m) => m.id === mod.id)
				if (prev && prev.status !== mod.status) {
					changes.push(`Module "${mod.label}": ${prev.status} → ${mod.status}`)
				}
			}

			if (changes.length > 0) {
				this.events.info(
					"working_tree.changes_detected",
					`Working Tree changes detected: ${changes.join("; ")}`,
					{
						data: {
							changes,
							snapshot,
						} as unknown as Record<string, unknown>,
					},
				)

				this.lastSnapshot = snapshot
				return {
					ok: true,
					summary: `Working Tree changes detected: ${changes.length} change(s)`,
					data: { changes, needsRefresh: true, snapshot },
				}
			}

			return {
				ok: true,
				summary: "Working Tree is up to date — no changes detected",
				data: { needsRefresh: false, snapshot },
			}
		}

		// First check — just store the snapshot
		this.lastSnapshot = snapshot
		return {
			ok: true,
			summary: "Working Tree baseline snapshot taken",
			data: { needsRefresh: false, snapshot, firstRun: true },
		}
	}

	/**
	 * Refresh the working tree by taking a fresh snapshot and emitting
	 * a tree_refreshed event that the dashboard can react to.
	 */
	private async handleRefreshTree(ctx: AgentRunContext): Promise<AgentRunResult> {
		const snapshot = await this.takeSnapshot()
		this.lastSnapshot = snapshot

		this.events.info("working_tree.refreshed", "Working Tree refreshed — new snapshot captured", {
			data: {
				snapshot,
			} as unknown as Record<string, unknown>,
		})

		return {
			ok: true,
			summary: "Working Tree refreshed successfully",
			data: { snapshot },
		}
	}

	/**
	 * Get the current working tree status without triggering any updates.
	 */
	private async handleGetTreeStatus(ctx: AgentRunContext): Promise<AgentRunResult> {
		const snapshot = await this.takeSnapshot()
		const needsRefresh = this.lastSnapshot ? this.hasChanges(snapshot, this.lastSnapshot) : false

		return {
			ok: true,
			summary: needsRefresh ? "Working Tree has pending changes" : "Working Tree is up to date",
			data: {
				snapshot,
				needsRefresh,
				lastChecked: new Date().toISOString(),
			},
		}
	}

	/**
	 * Called when a product update is recorded. Checks if the tree needs
	 * updating based on the update type.
	 */
	private async handleOnProductUpdate(
		ctx: AgentRunContext,
		payload: Record<string, unknown>,
	): Promise<AgentRunResult> {
		const updateType = payload.type as string | undefined
		const title = payload.title as string | undefined

		// These update types always trigger a tree refresh
		const treeAffectingTypes = [
			"feature_added",
			"agent_updated",
			"api_changed",
			"deployment",
			"rollback",
			"security_change",
		]

		if (updateType && treeAffectingTypes.includes(updateType)) {
			const result = await this.handleRefreshTree(ctx)
			this.events.info(
				"working_tree.updated_from_product_update",
				`Working Tree updated after product update: ${title} (${updateType})`,
				{
					data: {
						updateType,
						title,
					} as unknown as Record<string, unknown>,
				},
			)
			return result
		}

		// For non-structural updates, just check for changes
		return this.handleCheckTree(ctx)
	}

	/**
	 * Called when a bug is fixed. Checks if the tree needs updating.
	 */
	private async handleOnBugFix(ctx: AgentRunContext, payload: Record<string, unknown>): Promise<AgentRunResult> {
		const bugId = payload.bugId as string | undefined
		const featureId = payload.featureId as string | undefined

		// Bug fixes that affect features trigger a tree check
		if (featureId) {
			const result = await this.handleCheckTree(ctx)
			this.events.info(
				"working_tree.checked_after_bug_fix",
				`Working Tree checked after bug fix: ${bugId} (feature: ${featureId})`,
				{
					data: {
						bugId,
						featureId,
					} as unknown as Record<string, unknown>,
				},
			)
			return result
		}

		return {
			ok: true,
			summary: "Bug fix does not affect working tree structure",
			data: { treeAffected: false },
		}
	}

	/**
	 * Called when a feature status or health changes.
	 */
	private async handleOnFeatureChange(
		ctx: AgentRunContext,
		payload: Record<string, unknown>,
	): Promise<AgentRunResult> {
		const featureId = payload.featureId as string | undefined
		const newStatus = payload.status as string | undefined

		// Status changes to/from key states trigger a tree check
		const significantStatuses = ["deprecated", "broken", "working"]
		if (newStatus && significantStatuses.includes(newStatus)) {
			const result = await this.handleCheckTree(ctx)
			this.events.info(
				"working_tree.checked_after_feature_change",
				`Working Tree checked after feature change: ${featureId} → ${newStatus}`,
				{
					data: {
						featureId,
						newStatus,
					} as unknown as Record<string, unknown>,
				},
			)
			return result
		}

		return {
			ok: true,
			summary: "Feature change does not significantly affect working tree",
			data: { treeAffected: false },
		}
	}

	// ── Private Helpers ──────────────────────────────────────────────────

	private async takeSnapshot(): Promise<WorkingTreeSnapshot> {
		const features = (await this.service.getFeatures()).features
		const updates = (await this.service.getUpdates()).updates

		// Count bugs from feature knownBugs lists
		const bugIds = new Set<string>()
		for (const f of features) {
			for (const bugId of f.knownBugs) {
				bugIds.add(bugId)
			}
		}

		// Build module-level stats from product features
		const moduleMap = new Map<
			string,
			{
				label: string
				status: "stable" | "active" | "experimental" | "deprecated"
				featureCount: number
				bugCount: number
			}
		>()

		// Map product feature categories to working tree modules
		const categoryToModule: Record<string, { id: string; label: string }> = {
			Orchestrator: { id: "orchestrator", label: "Orchestrator" },
			Agent: { id: "agents", label: "Agent System" },
			Safety: { id: "safety", label: "Safety System" },
			Memory: { id: "memory", label: "Memory System" },
			Queue: { id: "queue", label: "Task Queue" },
			Logging: { id: "logging", label: "Event Log" },
			Feature: { id: "features", label: "Feature Registry" },
			Bug: { id: "bugs", label: "Bug Registry" },
			Healing: { id: "healing", label: "Self-Healing System" },
			ML: { id: "ml", label: "Machine Learning Engine" },
			"Product Memory": { id: "product-memory", label: "Product Memory" },
			Parallel: { id: "parallel", label: "Parallel Execution Engine" },
			"CPU Guard": { id: "cpu-guard", label: "CPU Guard" },
			Deploy: { id: "deploy", label: "Deploy System" },
			Crawler: { id: "crawler", label: "Crawler Agent" },
			Import: { id: "import", label: "File Importer" },
			Remote: { id: "remote", label: "Remote Shell" },
		}

		// Initialize all modules with default status
		for (const [, mod] of Object.entries(categoryToModule)) {
			moduleMap.set(mod.id, {
				label: mod.label,
				status: "stable",
				featureCount: 0,
				bugCount: 0,
			})
		}

		// Count features and bugs per module category
		for (const f of features) {
			const mod = categoryToModule[f.category]
			if (mod) {
				const entry = moduleMap.get(mod.id)!
				entry.featureCount++
				entry.bugCount += f.knownBugs.length

				// Derive module status from feature statuses
				if (f.status === "deprecated") {
					entry.status = "deprecated"
				} else if (f.status === "broken" && entry.status !== "deprecated") {
					entry.status = "active"
				} else if (f.confidence < 50 && entry.status === "stable") {
					entry.status = "experimental"
				}
			}
		}

		return {
			timestamp: new Date().toISOString(),
			featureCount: features.length,
			updateCount: updates.length,
			bugCount: bugIds.size,
			incidentCount: 0, // Would come from HealingBus in production
			modules: Array.from(moduleMap.entries()).map(([id, data]) => ({
				id,
				...data,
			})),
		}
	}

	private hasChanges(current: WorkingTreeSnapshot, previous: WorkingTreeSnapshot): boolean {
		if (current.featureCount !== previous.featureCount) return true
		if (current.updateCount !== previous.updateCount) return true
		if (current.bugCount !== previous.bugCount) return true
		if (current.incidentCount !== previous.incidentCount) return true

		for (const mod of current.modules) {
			const prev = previous.modules.find((m) => m.id === mod.id)
			if (!prev || prev.status !== mod.status) return true
		}

		return false
	}
}
