const { validateAgentConfig } = require("../../../../cloud/agent-runtime/schemaValidator")

describe("schemaValidator", () => {
	const validAgent = {
		id: "test-agent",
		name: "Test Agent",
		category: "test",
		description: "A test agent",
		version: "1.0.0",
		enabled: true,
		skills: [],
		workflows: [],
		resources: [],
		outputs: "outputs/",
		safety: {
			requiresApproval: false,
			canEditFiles: false,
			canPublish: false,
			canDeploy: false,
			blockedCommands: [],
			approvalTriggers: [],
		},
		runtime: {
			sandbox: true,
			timeoutSeconds: 300,
			maxRetries: 1,
		},
	}

	test("valid config passes", () => {
		const result = validateAgentConfig(validAgent)
		expect(result.valid).toBe(true)
		expect(result.errors).toHaveLength(0)
	})

	test("missing required fields fail", () => {
		const result = validateAgentConfig({ id: "x" })
		expect(result.valid).toBe(false)
		expect(result.errors.some((e) => e.includes("Missing required"))).toBe(true)
	})

	test("invalid types fail", () => {
		const result = validateAgentConfig({
			...validAgent,
			enabled: "yes",
			skills: "not-array",
		})
		expect(result.valid).toBe(false)
		expect(result.errors.some((e) => e.includes("enabled"))).toBe(true)
		expect(result.errors.some((e) => e.includes("skills"))).toBe(true)
	})

	test("invalid safety fields fail", () => {
		const result = validateAgentConfig({
			...validAgent,
			safety: {
				requiresApproval: "yes",
				canEditFiles: false,
				canPublish: false,
				canDeploy: false,
			},
		})
		expect(result.valid).toBe(false)
		expect(result.errors.some((e) => e.includes("requiresApproval"))).toBe(true)
	})

	test("invalid runtime fields fail", () => {
		const result = validateAgentConfig({
			...validAgent,
			runtime: {
				sandbox: "yes",
				timeoutSeconds: "300",
				maxRetries: "1",
			},
		})
		expect(result.valid).toBe(false)
		expect(result.errors.length).toBeGreaterThanOrEqual(3)
	})
})
