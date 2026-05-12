import { describe, it, expect } from "vitest"
import { BrainRouter } from "../BrainRouter.js"
import type { BrainRequest } from "../types.js"

function makeReq(userMessage: string, overrides: Partial<BrainRequest> = {}): BrainRequest {
	return {
		packet: {
			source: "vscode",
			projectId: "superroo2",
			userMessage,
			timestamp: new Date().toISOString(),
			...overrides.packet,
		},
		rag: {
			projectId: "superroo2",
			task: userMessage,
			memories: [],
			code: [],
			contextText: "",
			...overrides.rag,
		},
		...overrides,
	} as BrainRequest
}

describe("BrainRouter", () => {
	it("routes high-risk tasks to cloud with approval", () => {
		const router = new BrainRouter()
		const req = makeReq("delete production database", { riskLevel: "high" })
		const decision = router.choose(req)
		expect(decision.route).toBe("cloud")
		expect(decision.requiresApproval).toBe(true)
	})

	it("routes cheap ollama tasks", () => {
		const router = new BrainRouter()
		const req = makeReq("summarize this log", { taskType: "summarize" })
		const decision = router.choose(req)
		expect(decision.route).toBe("ollama")
	})

	it("routes planning to hermes when enabled", () => {
		const router = new BrainRouter({ enableHermes: true })
		const req = makeReq("plan the architecture for new feature")
		const decision = router.choose(req)
		expect(decision.route).toBe("hermes")
	})

	it("routes execution to openclaw when enabled", () => {
		const router = new BrainRouter({ enableOpenClaw: true })
		const req = makeReq("edit the file and run tests")
		const decision = router.choose(req)
		expect(decision.route).toBe("openclaw")
	})

	it("defaults to cloud for general tasks", () => {
		const router = new BrainRouter()
		const req = makeReq("fix the bug in auth handler")
		const decision = router.choose(req)
		expect(decision.route).toBe("cloud")
	})

	it("detects high-risk keywords and requires approval", () => {
		const router = new BrainRouter()
		const req = makeReq("deploy production with new changes")
		const decision = router.choose(req)
		expect(decision.route).toBe("cloud")
		expect(decision.requiresApproval).toBe(true)
	})

	it("records and retrieves metrics", () => {
		const router = new BrainRouter()
		router.recordMetrics({
			taskType: "coding",
			modelProvider: "openai",
			modelName: "gpt-4",
			costUsd: 0.05,
			latencyMs: 2000,
			success: true,
			testsPassed: 5,
			retryCount: 0,
			userAccepted: true,
		})
		expect(router.getMetrics()).toHaveLength(1)
	})

	it("caps metrics at 1000 entries", () => {
		const router = new BrainRouter()
		for (let i = 0; i < 1005; i++) {
			router.recordMetrics({
				taskType: "coding",
				modelProvider: "openai",
				modelName: "gpt-4",
				costUsd: 0.01,
				latencyMs: 1000,
				success: true,
				testsPassed: 1,
				retryCount: 0,
				userAccepted: true,
			})
		}
		expect(router.getMetrics()).toHaveLength(1000)
	})
})
