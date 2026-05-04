const path = require("path")
const fs = require("fs")
const os = require("os")

const TEST_AGENTS_ROOT = path.join(__dirname, "..", "..", "..", "..", "cloud", "agents")
const TEST_SUPERROO_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "superroo-agent-registry-"))
fs.mkdirSync(path.join(TEST_SUPERROO_ROOT, "cloud"), { recursive: true })

process.env.SUPERROO_AGENTS_ROOT = TEST_AGENTS_ROOT
process.env.SUPERROO_ROOT = TEST_SUPERROO_ROOT

const {
	listAgents,
	getAgent,
	setAgentEnabled,
	loadAgentTextBundle,
} = require("../../../../cloud/agent-runtime/agentRegistry")

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

	test("setAgentEnabled persists an explicit enabled state", async () => {
		const agents = await listAgents()
		const first = agents[0]

		await setAgentEnabled(first.id, true)
		await expect(getAgent(first.id)).resolves.toMatchObject({ id: first.id, enabled: true })

		await setAgentEnabled(first.id, false)
		await expect(getAgent(first.id)).resolves.toMatchObject({ id: first.id, enabled: false })
	})

	test("loadAgentTextBundle concatenates files", async () => {
		const agents = await listAgents()
		const first = agents[0]
		const bundle = await loadAgentTextBundle(first)
		expect(typeof bundle).toBe("string")
	})
})
