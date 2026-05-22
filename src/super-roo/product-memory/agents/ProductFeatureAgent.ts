/**
 * Super Roo — Product Feature Agent.
 *
 * Manages product feature registration, improvement recommendations,
 * and feature lifecycle within the product memory system.
 * Implements the existing Agent interface for orchestrator integration.
 */

import type { Agent, AgentRunContext, AgentRunResult } from "../../types"
import type { ProductMemoryService } from "../ProductMemoryService"
import type { ProductFeature } from "../types"

export interface ProductFeatureAgentOptions {
	service: ProductMemoryService
}

export class ProductFeatureAgent implements Agent {
	readonly name = "product-feature"
	readonly description = "Manages product feature registration, improvement recommendations, and feature lifecycle"
	readonly requiredCapabilities: string[] = ["product_memory"]
	readonly tags: string[] = ["product-memory", "feature-management", "lifecycle"]

	private readonly service: ProductMemoryService

	constructor(opts: ProductFeatureAgentOptions) {
		this.service = opts.service
	}

	async run(ctx: AgentRunContext): Promise<AgentRunResult> {
		const payload = ctx.task.payload ?? {}
		const operation = String(payload.operation ?? "listFeatures")

		switch (operation) {
			case "ensureFeature":
				return this.handleEnsureFeature(ctx, payload)
			case "recommendImprovements":
				return this.handleRecommendImprovements(ctx)
			case "listFeatures":
				return this.handleListFeatures(ctx)
			case "listFeaturesNeedingTests":
				return this.handleListFeaturesNeedingTests(ctx)
			default:
				return {
					ok: false,
					summary: `Unknown operation: ${operation}. Supported: ensureFeature, recommendImprovements, listFeatures, listFeaturesNeedingTests`,
					error: `Unknown operation: ${operation}`,
				}
		}
	}

	private async handleEnsureFeature(ctx: AgentRunContext, payload: Record<string, unknown>): Promise<AgentRunResult> {
		const name = payload.name as string | undefined
		if (!name) {
			return { ok: false, summary: "Missing required parameter: name", error: "Missing required parameter: name" }
		}

		const existing = (await this.service.getFeatures()).features.find((f) => f.name === name)
		if (existing) {
			ctx.emit("info", "product_feature.exists", `Feature already exists: ${name}`, {
				data: { featureId: existing.id },
			})
			return { ok: true, summary: `Feature already exists: ${name}`, data: { feature: existing } }
		}

		const feature = await this.service.addFeature({
			name,
			category: (payload.category as string) || "Uncategorized",
			description: (payload.description as string) || "",
			status: (payload.status as ProductFeature["status"]) || "planned",
			confidence: (payload.confidence as number) ?? 0,
			ownerAgent: (payload.ownerAgent as string) || "product-feature",
			relatedFiles: (payload.relatedFiles as string[]) || [],
			testChecklist: (payload.testChecklist as string[]) || [],
		})

		ctx.emit("info", "product_feature.created", `Created feature: ${feature.name}`, {
			data: { featureId: feature.id },
		})

		return { ok: true, summary: `Created feature: ${feature.name}`, data: { feature } }
	}

	private async handleRecommendImprovements(ctx: AgentRunContext): Promise<AgentRunResult> {
		const recommendations = await this.service.recommendImprovements()
		ctx.emit(
			"info",
			"product_feature.recommendations",
			`Found ${recommendations.length} improvement recommendations`,
			{
				data: { count: recommendations.length },
			},
		)
		return {
			ok: true,
			summary: `Found ${recommendations.length} improvement recommendations`,
			data: { recommendations },
		}
	}

	private async handleListFeatures(ctx: AgentRunContext): Promise<AgentRunResult> {
		const features = (await this.service.getFeatures()).features
		return {
			ok: true,
			summary: `Found ${features.length} features`,
			data: { features, count: features.length },
		}
	}

	private async handleListFeaturesNeedingTests(ctx: AgentRunContext): Promise<AgentRunResult> {
		const features = await this.service.listFeaturesNeedingTests()
		return {
			ok: true,
			summary: `Found ${features.length} features needing tests`,
			data: { features, count: features.length },
		}
	}
}
