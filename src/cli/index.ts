import { Command } from "commander"
import { runAutonomous } from "../core/runAutonomous"
import { normalizeSuperRooTask, SuperRooTaskSource } from "../core/SuperRooTask"
import { runAutonomousCommand } from "../core/commands/autonomous"
import { runDeployCommand } from "../core/commands/deploy"
import { runCheckVpsCommand } from "../core/commands/check-vps"
import { runDebugApiCommand } from "../core/commands/debug-api"
import { runStatusCommand } from "../core/commands/status"

interface AutonomousCliOptions {
	project?: string
	hours?: string
	autoApprove?: boolean
	deploy?: boolean
}

interface DeployCliOptions {
	project?: string
	script?: string
}

interface CheckVpsCliOptions {
	url?: string
	retries?: string
}

interface DebugApiCliOptions {
	project?: string
}

interface StatusCliOptions {
	project?: string
}

const program = new Command()

async function postTaskToDaemon(task: unknown): Promise<unknown> {
	const daemonUrl = process.env.SUPERROO_DAEMON_URL
	if (!daemonUrl) return undefined

	const headers: Record<string, string> = { "content-type": "application/json" }
	if (process.env.SUPERROO_DAEMON_TOKEN) {
		headers.authorization = `Bearer ${process.env.SUPERROO_DAEMON_TOKEN}`
	}

	const response = await fetch(new URL("/tasks", daemonUrl), {
		method: "POST",
		headers,
		body: JSON.stringify(task),
	})
	const body = await response.json()
	if (!response.ok) {
		throw new Error(`Daemon task submission failed (${response.status}): ${JSON.stringify(body)}`)
	}
	return body
}

program
	.name("superroo")
	.description("SuperRoo CLI automation worker for coding, debugging, deployment, and VPS checks")
	.version("0.1.0")
	.configureOutput({
		writeOut: (str) => console.log(str.trimEnd()),
		writeErr: (str) => console.error(str.trimEnd()),
	})

program
	.command("autonomous")
	.description("Run autonomous coding/debug/test/deploy loop")
	.option("-p, --project <path>", "Project path to operate on")
	.option("--hours <number>", "Maximum runtime in hours", "1")
	.option("--auto-approve", "Allow safe auto-approved actions")
	.option("--no-deploy", "Run without deployment")
	.action(async (options: AutonomousCliOptions) => {
		const result = await runAutonomous({ task: "Run autonomous coding loop", source: SuperRooTaskSource.CLI })
		const submitted = await postTaskToDaemon(result.task)
		if (submitted) {
			console.log(JSON.stringify(submitted, null, 2))
			return
		}
		await runAutonomousCommand(options)
	})

program
	.command("deploy")
	.description("Deploy a project using its configured deploy script")
	.option("-p, --project <path>", "Project path to deploy")
	.option("--script <command>", "Deploy command", "pnpm deploy")
	.action(async (options: DeployCliOptions) => {
		await runDeployCommand(options)
	})

program
	.command("check-vps")
	.description("Check live VPS/site health")
	.option("--url <url>", "Health check URL")
	.option("--retries <number>", "Number of retries", "3")
	.action(async (options: CheckVpsCliOptions) => {
		await runCheckVpsCommand(options)
	})

program
	.command("debug-api")
	.description("Run API configuration diagnostics for Claude/Kimi/OpenRouter/etc.")
	.option("-p, --project <path>", "Project path to inspect")
	.action(async (options: DebugApiCliOptions) => {
		await runDebugApiCommand(options)
	})

program
	.command("status")
	.description("Show project git, dependency, test, and deploy status")
	.option("-p, --project <path>", "Project path to inspect")
	.action(async (options: StatusCliOptions) => {
		await runStatusCommand(options)
	})

program
	.command("task <goal...>")
	.description("Submit one shared SuperRooTask")
	.action(async (goal: string[]) => {
		if (!goal.length) {
			console.error("Usage: superroo task <goal>")
			process.exit(1)
		}

		const task = normalizeSuperRooTask({ source: SuperRooTaskSource.CLI, goal: goal.join(" ") })
		const submitted = await postTaskToDaemon(task)
		console.log(JSON.stringify(submitted ?? task, null, 2))
	})

if (process.argv.length <= 2) {
	program.outputHelp()
} else {
	program.parseAsync(process.argv).catch((error: unknown) => {
	console.error("[superroo] fatal error:", error)
	process.exit(1)
	})
}
