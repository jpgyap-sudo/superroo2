import { SuperRooCore } from "../SuperRooCore"
import { logHeader, logStep } from "../utils/logger"
import { runShell } from "../utils/shell"

interface DeployOptions {
	project?: string
	script?: string
}

export async function runDeployCommand(options: DeployOptions): Promise<void> {
	logHeader("SuperRoo Deploy")

	const core = new SuperRooCore({ projectPath: options.project })
	await core.verifyProject()

	logStep("Building before deploy")
	await core.runBuild()

	const deployCommand = options.script || "pnpm deploy"
	logStep(`Running deploy command: ${deployCommand}`)
	await runShell(deployCommand, { cwd: core.projectPath })

	logHeader("Deploy completed")
}
