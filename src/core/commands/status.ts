import { SuperRooCore } from "../SuperRooCore"
import { logHeader, logStep } from "../utils/logger"
import { runShellArgs } from "../utils/shell"

interface StatusOptions {
	project?: string
}

export async function runStatusCommand(options: StatusOptions): Promise<void> {
	logHeader("SuperRoo Status")

	const core = new SuperRooCore({ projectPath: options.project })
	await core.verifyProject()

	logStep("Git status")
	console.log((await core.gitStatus()) || "Clean working tree")

	logStep("Current branch")
	await runShellArgs("git", ["branch", "--show-current"], { cwd: core.projectPath, allowFailure: true, inheritStdio: true })

	logStep("Node version")
	await runShellArgs("node", ["-v"], { cwd: core.projectPath, allowFailure: true, inheritStdio: true })

	logStep("Package manager")
	const pnpm = await runShellArgs("pnpm", ["-v"], { cwd: core.projectPath, allowFailure: true, inheritStdio: true })
	if (pnpm.code !== 0) {
		await runShellArgs("npm", ["-v"], { cwd: core.projectPath, allowFailure: true, inheritStdio: true })
	}
}
