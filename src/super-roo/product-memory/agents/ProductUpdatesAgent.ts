/**
 * Super Roo — Product Updates Agent.
 *
 * Records product updates (feature additions, bug fixes, UI changes, etc.)
 * into the product memory system. Implements the existing Agent interface
 * for orchestrator integration.
 */

import type { Agent, AgentRunContext, AgentRunResult } from "../../types"
import type { ProductMemoryService } from "../ProductMemoryService"
import type { ProductUpdateType } from "../types"

export interface ProductUpdatesAgentOptions {
	service: ProductMemoryService
}

export class ProductUpdatesAgent implements Agent {
	readonly name = "product-updates"
	readonly description =
		"Records product updates (feature additions, bug fixes, UI changes, etc.) into product memory"
	readonly requiredCapabilities: string[] = ["product_memory"]
	readonly tags: string[] = ["product-memory", "updates", "changelog"]

	private readonly service: ProductMemoryService

	constructor(opts: ProductUpdatesAgentOptions) {
		this.service = opts.service
	}

	async run(ctx: AgentRunContext): Promise<AgentRunResult> {
		const payload = ctx.task.payload ?? {}
		const operation = String(payload.operation ?? "listUpdates")

		switch (operation) {
			case "recordFeatureAdded":
				return this.handleRecordFeatureAdded(ctx, payload)
			case "recordBugFix":
				return this.handleRecordBugFix(ctx, payload)
			case "recordUpdate":
				return this.handleRecordUpdate(ctx, payload)
			case "listUpdates":
				return this.handleListUpdates(ctx)
			default:
				return {
					ok: false,
					summary: `Unknown operation: ${operation}. Supported: recordFeatureAdded, recordBugFix, recordUpdate, listUpdates`,
					error: `Unknown operation: ${operation}`,
				}
		}
	}

	private async handleRecordFeatureAdded(
		ctx: AgentRunContext,
		payload: Record<string, unknown>,
	): Promise<AgentRunResult> {
		const title = payload.title as string | undefined
		if (!title) {
			return {
				ok: false,
				summary: "Missing required parameter: title",
				error: "Missing required parameter: title",
			}
		}

		const update = await this.service.addUpdate({
			title,
			type: "feature_added" as ProductUpdateType,
			summary: (payload.summary as string) || "",
			filesChanged: (payload.filesChanged as string[]) || [],
			linkedFeatures: (payload.linkedFeatures as string[]) || [],
		})

		ctx.emit("info", "product_updates.feature_added", `Recorded feature addition: ${title}`, {
			data: { updateId: update.id },
		})

		return { ok: true, summary: `Recorded feature addition: ${title}`, data: { update } }
	}

	private async handleRecordBugFix(ctx: AgentRunContext, payload: Record<string, unknown>): Promise<AgentRunResult> {
		const title = payload.title as string | undefined
		if (!title) {
			return {
				ok: false,
				summary: "Missing required parameter: title",
				error: "Missing required parameter: title",
			}
		}

		const update = await this.service.addUpdate({
			title,
			type: "bug_fixed" as ProductUpdateType,
			summary: (payload.summary as string) || "",
			filesChanged: (payload.filesChanged as string[]) || [],
			linkedFeatures: (payload.linkedFeatures as string[]) || [],
		})

		ctx.emit("info", "product_updates.bug_fixed", `Recorded bug fix: ${title}`, {
			data: { updateId: update.id },
		})

		return { ok: true, summary: `Recorded bug fix: ${title}`, data: { update } }
	}

	private async handleRecordUpdate(ctx: AgentRunContext, payload: Record<string, unknown>): Promise<AgentRunResult> {
		const title = payload.title as string | undefined
		const type = payload.type as string | undefined
		if (!title || !type) {
			return {
				ok: false,
				summary: "Missing required parameters: title, type",
				error: "Missing required parameters: title, type",
			}
		}

		const validTypes = [
			"feature_added",
			"bug_fixed",
			"ui_changed",
			"agent_updated",
			"api_changed",
			"deployment",
			"rollback",
			"test_result",
			"security_change",
		]
		if (!validTypes.includes(type)) {
			return {
				ok: false,
				summary: `Invalid update type: ${type}. Valid: ${validTypes.join(", ")}`,
				error: `Invalid update type: ${type}`,
			}
		}

		const update = await this.service.addUpdate({
			title,
			type: type as ProductUpdateType,
			summary: (payload.summary as string) || "",
			filesChanged: (payload.filesChanged as string[]) || [],
			linkedFeatures: (payload.linkedFeatures as string[]) || [],
		})

		ctx.emit("info", "product_updates.recorded", `Recorded update: ${title}`, {
			data: { updateId: update.id, type },
		})

		return { ok: true, summary: `Recorded update: ${title}`, data: { update } }
	}

	private async handleListUpdates(ctx: AgentRunContext): Promise<AgentRunResult> {
		const updates = (await this.service.getUpdates()).updates
		return {
			ok: true,
			summary: `Found ${updates.length} updates`,
			data: { updates, count: updates.length },
		}
	}
}
