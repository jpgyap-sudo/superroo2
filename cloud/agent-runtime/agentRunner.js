const fs = require("fs/promises")
const path = require("path")
const { getAgent, loadAgentTextBundle } = require("./agentRegistry")
const { validateAgentJob } = require("./safety")

const AGENTS_ROOT = process.env.SUPERROO_AGENTS_ROOT || path.join(process.cwd(), "cloud", "agents")

function escapeForHereDoc(input) {
	return input.replace(/INNER_EOF/g, "INNER_EOF_ESCAPED")
}

async function runAgentJob(job, runInSandbox) {
	const agent = await getAgent(job.agentId)
	const safety = validateAgentJob(agent, job)

	if (safety.approvalRequired) {
		return {
			jobId: job.id,
			agentId: agent.id,
			status: "approval_required",
			summary: safety.reason || "Approval required before execution.",
			suggestedActions: ["Create approval request", "Wait for user approval"],
		}
	}

	const bundle = await loadAgentTextBundle(agent)
	const outputDir = path.join(AGENTS_ROOT, agent.id, agent.outputs || "outputs")
	await fs.mkdir(outputDir, { recursive: true })

	const commands = job.commands || [
		"pwd",
		"node -v",
		"pnpm -v",
		`cat > agent-context.md <<'INNER_EOF'\n${escapeForHereDoc(bundle)}\nINNER_EOF`,
		"ls -la",
	]

	const payload = {
		id: job.id,
		task: job.task || `${agent.name} run`,
		commands,
		network: job.network || "none",
	}

	const sandboxResult = await runInSandbox(payload)
	const outputPath = path.join(outputDir, `${job.id}.summary.md`)

	await fs.writeFile(
		outputPath,
		`# Agent Run Summary\n\nAgent: ${agent.name}\nJob: ${job.id}\nTask: ${job.task || ""}\n\nSandbox log: ${sandboxResult.logPath || ""}\n`,
	)

	return {
		jobId: job.id,
		agentId: agent.id,
		status: "completed",
		outputPath,
		logPath: sandboxResult.logPath,
		summary: `${agent.name} completed job ${job.id}.`,
	}
}

module.exports = { runAgentJob }
