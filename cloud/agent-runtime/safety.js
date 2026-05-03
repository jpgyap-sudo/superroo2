const DEFAULT_BLOCKED = [
	"rm -rf /",
	"shutdown",
	"reboot",
	"docker prune",
	"mkfs",
	"dd if=",
	".env",
	"authorized_keys",
	"passwd",
	"shadow",
]

function validateAgentJob(agent, job) {
	if (!agent.enabled) {
		throw new Error(`Agent disabled: ${agent.id}`)
	}

	const blocked = [...DEFAULT_BLOCKED, ...(agent.safety?.blockedCommands || [])]
	for (const cmd of job.commands || []) {
		for (const bad of blocked) {
			if (cmd.includes(bad)) {
				throw new Error(`Blocked dangerous command for ${agent.id}: ${cmd}`)
			}
		}
	}

	if (agent.safety?.canDeploy === false && job.task && job.task.toLowerCase().includes("deploy production")) {
		return { approvalRequired: true, reason: "Production deploy requires approval." }
	}

	if (agent.safety?.requiresApproval) {
		const lower = (job.task || "").toLowerCase()
		const triggers = agent.safety.approvalTriggers || []
		const trigger = triggers.find((t) => lower.includes(t.toLowerCase()))
		if (trigger) {
			return { approvalRequired: true, reason: `Approval trigger matched: ${trigger}` }
		}
	}

	return { approvalRequired: false }
}

module.exports = { validateAgentJob }
