const { validateAgentJob } = require("../../../../cloud/agent-runtime/safety")

describe("safety", () => {
	const baseAgent = {
		id: "test-agent",
		enabled: true,
		safety: {
			requiresApproval: true,
			canEditFiles: true,
			canPublish: false,
			canDeploy: false,
			blockedCommands: ["delete production"],
			approvalTriggers: ["publish", "deploy", "delete"],
		},
	}

	test("disabled agent throws", () => {
		expect(() => validateAgentJob({ ...baseAgent, enabled: false }, { task: "test" })).toThrow("Agent disabled")
	})

	test("blocked command throws", () => {
		expect(() => validateAgentJob(baseAgent, { task: "test", commands: ["rm -rf /"] })).toThrow(
			"Blocked dangerous command",
		)
	})

	test("custom blocked command throws", () => {
		expect(() =>
			validateAgentJob(baseAgent, {
				task: "test",
				commands: ["delete production"],
			}),
		).toThrow("Blocked dangerous command")
	})

	test("deploy production requires approval", () => {
		const result = validateAgentJob(baseAgent, { task: "deploy production" })
		expect(result.approvalRequired).toBe(true)
	})

	test("approval trigger matched", () => {
		const result = validateAgentJob(baseAgent, { task: "publish article" })
		expect(result.approvalRequired).toBe(true)
		expect(result.reason).toContain("publish")
	})

	test("safe job passes", () => {
		const result = validateAgentJob(baseAgent, { task: "run tests" })
		expect(result.approvalRequired).toBe(false)
	})
})
