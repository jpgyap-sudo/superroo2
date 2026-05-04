const path = require("path")

const TEST_AGENTS_ROOT = path.join(__dirname, "..", "..", "..", "..", "cloud", "agents")
process.env.SUPERROO_AGENTS_ROOT = TEST_AGENTS_ROOT

const { listAgents, getAgent, loadAgentTextBundle } = require("../../../../cloud/agent-runtime/agentRegistry")

describe("agentRegistry", () => {
	test("listAgents returns valid agents", async () => {
		const agents = await listAgents()
		expect(agents.length).toBeGreaterThanOrEqual(1)
		expect(agents[0]).toHaveProperty("id")
		expect(agents[0]).toHaveProperty("name")
	})

	test("getAgent returns agent by id", async () => {
		const agents = await listAgents()
		const first = agents[0]
		const agent = await getAgent(first.id)
		expect(agent.id).toBe(first.id)
	})

	test("getAgent throws for missing agent", async () => {
		await expect(getAgent("nonexistent-agent")).rejects.toThrow("Agent not found")
	})

	test("loadAgentTextBundle concatenates files", async () => {
		const agents = await listAgents()
		const first = agents[0]
		const bundle = await loadAgentTextBundle(first)
		expect(typeof bundle).toBe("string")
	})
})
