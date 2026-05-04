const fs = require("fs/promises")
const path = require("path")

const AGENTS_ROOT =
	process.env.SUPERROO_AGENTS_ROOT || path.join(process.env.SUPERROO_ROOT || "/opt/superroo2", "cloud", "agents")

/** Path to the persistent agent state file (tracks enabled/disabled toggles). */
function agentStatePath() {
	const root = process.env.SUPERROO_ROOT || "/opt/superroo2"
	return path.join(root, "cloud", "agent-state.json")
}

/** Read the persistent agent state file. Returns {} if missing or corrupt. */
async function readAgentState() {
	try {
		const raw = await fs.readFile(agentStatePath(), "utf8")
		return JSON.parse(raw)
	} catch {
		return {}
	}
}

/** Write the persistent agent state file atomically. */
async function writeAgentState(state) {
	const filePath = agentStatePath()
	const tmp = filePath + ".tmp"
	await fs.writeFile(tmp, JSON.stringify(state, null, 2), "utf8")
	await fs.rename(tmp, filePath)
}

async function listAgents() {
	let dirs = []
	try {
		dirs = await fs.readdir(AGENTS_ROOT, { withFileTypes: true })
	} catch {
		return []
	}
	const state = await readAgentState()
	const agents = []
	for (const dir of dirs) {
		if (!dir.isDirectory()) continue
		const configPath = path.join(AGENTS_ROOT, dir.name, "agent.json")
		try {
			const raw = await fs.readFile(configPath, "utf8")
			const agent = JSON.parse(raw)
			// Override `enabled` with persisted toggle state if available.
			if (state[agent.id] !== undefined) {
				agent.enabled = state[agent.id]
			}
			agents.push(agent)
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

/**
 * Toggle an agent's enabled/disabled state.
 * Returns the new state after toggling.
 */
async function toggleAgent(agentId) {
	const agents = await listAgents()
	const agent = agents.find((a) => a.id === agentId)
	if (!agent) throw new Error(`Agent not found: ${agentId}`)

	const state = await readAgentState()
	const current = state[agentId] !== undefined ? state[agentId] : agent.enabled
	state[agentId] = !current
	await writeAgentState(state)
	return state[agentId]
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

module.exports = { listAgents, getAgent, toggleAgent, loadAgentTextBundle }
