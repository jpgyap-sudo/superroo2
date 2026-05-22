/**
 * Super Roo — Bug-Feature Mapper Agent.
 *
 * Maps bug reports to product features in the product memory system.
 * Implements the existing Agent interface for orchestrator integration.
 */

import type { Agent, AgentRunContext, AgentRunResult } from "../../types"
import type { ProductMemoryService } from "../ProductMemoryService"

export interface BugFeatureMapperAgentOptions {
	service: ProductMemoryService
}

export class BugFeatureMapperAgent implements Agent {
	readonly name = "bug-feature-mapper"
	readonly description = "Maps bug reports to product features in product memory"
	readonly requiredCapabilities: string[] = ["product_memory"]
	readonly tags: string[] = ["product-memory", "bug-mapping", "feature-tracking"]

	private readonly service: ProductMemoryService

	constructor(opts: BugFeatureMapperAgentOptions) {
		this.service = opts.service
	}

	async run(ctx: AgentRunContext): Promise<AgentRunResult> {
		const payload = ctx.task.payload ?? {}
		const operation = String(payload.operation ?? "listMappings")

		switch (operation) {
			case "mapBugToFeature":
				return this.handleMapBugToFeature(ctx, payload)
			case "listMappings":
				return this.handleListMappings(ctx)
			default:
				return {
					ok: false,
					summary: `Unknown operation: ${operation}. Supported: mapBugToFeature, listMappings`,
					error: `Unknown operation: ${operation}`,
				}
		}
	}

	private async handleMapBugToFeature(
		ctx: AgentRunContext,
		payload: Record<string, unknown>,
	): Promise<AgentRunResult> {
		const featureId = payload.featureId as string | undefined
		const title = payload.title as string | undefined
		const description = payload.description as string | undefined

		if (!featureId || !title || !description) {
			return {
				ok: false,
				summary: "Missing required parameters: featureId, title, description",
				error: "Missing required parameters: featureId, title, description",
			}
		}

		// Verify the feature exists
		const features = (await this.service.getFeatures()).features
		const feature = features.find((f) => f.id === featureId)
		if (!feature) {
			return { ok: false, summary: `Feature not found: ${featureId}`, error: `Feature not found: ${featureId}` }
		}

		const severity = (payload.severity as "low" | "medium" | "high" | "critical") || "medium"
		const logs = (payload.logs as string[]) || []

		const mapping = await this.service.mapBugToFeature({
			featureId,
			severity,
			title,
			description,
			logs,
		})

		ctx.emit("info", "bug_feature_mapper.mapped", `Mapped bug "${title}" to feature "${feature.name}"`, {
			data: { mappingId: mapping.id, featureId, severity },
		})

		return {
			ok: true,
			summary: `Mapped bug "${title}" to feature "${feature.name}"`,
			data: { mapping, feature },
		}
	}

	private async handleListMappings(ctx: AgentRunContext): Promise<AgentRunResult> {
		const mappings = (await this.service.readMemoryFile<{ mappings: unknown[] }>("bug-feature-map.json")).mappings
		return {
			ok: true,
			summary: `Found ${mappings.length} bug-feature mappings`,
			data: { mappings, count: mappings.length },
		}
	}
}
