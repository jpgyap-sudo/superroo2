#!/usr/bin/env node
/**
 * Coder Sandbox Entrypoint
 *
 * Runs inside the Docker sandbox container to execute the coder agent.
 * The project repo is mounted at /project.
 * LLM API keys are passed via environment variables.
 *
 * Usage (inside Docker):
 *   node /opt/superroo2/cloud/worker/coder-sandbox.js <jobId> <previewOnly> '<goal>' '<repo>' '<branch>' '<filesJson>'
 *
 * Outputs CODER_RESULT:JSON to stdout for the worker to parse.
 */

const { executeRunner } = require("/opt/superroo2/cloud/worker/agentRunners")

async function main() {
	const jobId = process.argv[2] || "unknown"
	const previewOnly = process.argv[3] === "true"
	const goal = process.argv[4] || ""
	const repo = process.argv[5] || "superroo2"
	const branch = process.argv[6] || "main"
	let files = []
	try {
		files = JSON.parse(process.argv[7] || "[]")
	} catch {
		files = []
	}

	const result = await executeRunner("coder", {
		id: jobId,
		data: {
			instruction: goal,
			workspaceDir: "/project",
			repoName: repo,
			branch: branch,
			files: files,
			previewOnly: previewOnly,
		},
	})

	// Output result as JSON for the worker to parse
	console.log("CODER_RESULT:" + JSON.stringify(result))
}

main().catch((err) => {
	console.log("CODER_RESULT:" + JSON.stringify({ success: false, error: err.message, output: [] }))
	process.exit(1)
})
