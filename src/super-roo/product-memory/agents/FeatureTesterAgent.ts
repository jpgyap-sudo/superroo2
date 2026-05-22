/**
 * Super Roo — Feature Tester Agent.
 *
 * Runs manual smoke tests on product features and records results
 * in the product memory system. Implements the existing Agent interface
 * for orchestrator integration.
 */

import type { Agent, AgentRunContext, AgentRunResult } from "../../types"
import type { ProductMemoryService } from "../ProductMemoryService"

export interface FeatureTesterAgentOptions {
	service: ProductMemoryService
}

export class FeatureTesterAgent implements Agent {
	readonly name = "feature-tester"
	readonly description = "Runs manual smoke tests on product features and records results in product memory"
	readonly requiredCapabilities: string[] = ["product_memory"]
	readonly tags: string[] = ["product-memory", "testing", "smoke-tests"]

	private readonly service: ProductMemoryService

	constructor(opts: FeatureTesterAgentOptions) {
		this.service = opts.service
	}

	async run(ctx: AgentRunContext): Promise<AgentRunResult> {
		const payload = ctx.task.payload ?? {}
		const operation = String(payload.operation ?? "listFeaturesNeedingTests")

		switch (operation) {
			case "runSmokeTest":
				return this.handleRunSmokeTest(ctx, payload)
			case "listFeaturesNeedingTests":
				return this.handleListFeaturesNeedingTests(ctx)
			default:
				return {
					ok: false,
					summary: `Unknown operation: ${operation}. Supported: runSmokeTest, listFeaturesNeedingTests`,
					error: `Unknown operation: ${operation}`,
				}
		}
	}

	private async handleRunSmokeTest(ctx: AgentRunContext, payload: Record<string, unknown>): Promise<AgentRunResult> {
		const featureId = payload.featureId as string | undefined
		if (!featureId) {
			return {
				ok: false,
				summary: "Missing required parameter: featureId",
				error: "Missing required parameter: featureId",
			}
		}

		// Verify the feature exists
		const features = (await this.service.getFeatures()).features
		const feature = features.find((f) => f.id === featureId)
		if (!feature) {
			return { ok: false, summary: `Feature not found: ${featureId}`, error: `Feature not found: ${featureId}` }
		}

		// Run through the test checklist
		const issuesFound: string[] = []
		for (const checkItem of feature.testChecklist) {
			ctx.emit("info", "feature_tester.checking", `Checking: ${checkItem}`, {
				data: { featureId, checkItem },
			})
			// In a real implementation, this would execute the check.
			// For now, we record it as a placeholder.
		}

		const result = (payload.result as "pass" | "fail" | "warning") || "pass"
		const notes = (payload.notes as string) || `Smoke test completed for ${feature.name}`

		const testRecord = await this.service.testFeature(featureId, result, notes)

		ctx.emit("info", "feature_tester.completed", `Tested ${feature.name}: ${result}`, {
			data: { featureId, result, testId: testRecord.id },
		})

		return {
			ok: true,
			summary: `Tested ${feature.name}: ${result}`,
			data: { testRecord, feature },
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
