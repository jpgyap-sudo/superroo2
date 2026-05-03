const fs = require("fs/promises")
const path = require("path")

const AGENTS_ROOT =
	process.env.SUPERROO_AGENTS_ROOT || path.join(process.env.SUPERROO_ROOT || "/opt/superroo2", "cloud", "agents")

async function listAgents() {
	let dirs = []
	try {
		dirs = await fs.readdir(AGENTS_ROOT, { withFileTypes: true })
	} catch {
		return []
	}
	const agents = []
	for (const dir of dirs) {
		if (!dir.isDirectory()) continue
		const configPath = path.join(AGENTS_ROOT, dir.name, "agent.json")
		try {
			const raw = await fs.readFile(configPath, "utf8")
			agents.push(JSON.parse(raw))
		} catch {
			// Skip invalid agent folders, but do not crash runtime.
		}
	}
	return agents
}

async function getAgent(agentId) {
	const agents = await listAgents()
	const agent = agents.find((a) => a.id === agentId)
	if (!agent) throw new Error(`Agent not found: ${agentId}`)
	return agent
}

async function loadAgentTextBundle(agent) {
	const agentRoot = path.join(AGENTS_ROOT, agent.id)
	const parts = []
	for (const rel of [...agent.skills, ...agent.workflows, ...agent.resources]) {
		const filePath = path.join(agentRoot, rel)
		try {
			const content = await fs.readFile(filePath, "utf8")
			parts.push(`\n--- ${rel} ---\n${content}`)
		} catch {
			parts.push(`\n--- ${rel} ---\nMISSING FILE`)
		}
	}
	return parts.join("\n")
}

module.exports = { listAgents, getAgent, loadAgentTextBundle }
