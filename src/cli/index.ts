import { Command } from "commander"
import { runAutonomous } from "../core/runAutonomous"
import { normalizeSuperRooTask, SuperRooTaskSource } from "../core/SuperRooTask"
import { runAutonomousCommand } from "../core/commands/autonomous"
import { runDeployCommand } from "../core/commands/deploy"
import { runCheckVpsCommand } from "../core/commands/check-vps"
import { runDebugApiCommand } from "../core/commands/debug-api"
import { runStatusCommand } from "../core/commands/status"
import { SuperRooOrchestrator as Phase3Orchestrator } from "../super-roo/core/SuperRooOrchestrator"
import { createDefaultRuntime } from "../super-roo/core/createDefaultRuntime"

interface AutonomousCliOptions {
	project?: string
	hours?: string
	mode?: "safe" | "auto"
	autoApprove?: boolean
	deploy?: boolean
	coder?: string
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

function createPhase3Orchestrator(projectPath?: string, codedBy?: string) {
	const runtime = createDefaultRuntime({
		source: "cli",
		workspaceRoot: projectPath || process.cwd(),
		codedBy: codedBy ?? process.env.SUPERROO_CODER_ID,
	})
	return new Phase3Orchestrator(runtime)
}

const program = new Command()

async function postTaskToDaemon(task: unknown): Promise<unknown> {
	const daemonUrl = process.env.SUPERROO_DAEMON_URL
	if (!daemonUrl) return undefined

	const headers: Record<string, string> = { "content-type": "application/json" }
	if (process.env.SUPERROO_DAEMON_TOKEN) {
		headers.authorization = `Bearer ${process.env.SUPERROO_DAEMON_TOKEN}`
	}

	// Use string join so a base-path in SUPERROO_DAEMON_URL is preserved.
	// new URL("/tasks", base) would strip the base path for absolute-path args.
	const url = daemonUrl.replace(/\/$/, "") + "/tasks"
	const response = await fetch(url, {
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
		writeOut: (str: string) => console.log(str.trimEnd()),
		writeErr: (str: string) => console.error(str.trimEnd()),
	})

program
	.command("autonomous")
	.description("Run autonomous coding/debug/test/deploy loop")
	.option("-p, --project <path>", "Project path to operate on")
	.option("--hours <number>", "Maximum runtime in hours", "1")
	.option("--mode <mode>", "Autonomy mode for local Phase 3 runner: safe or auto", "safe")
	.option("--auto-approve", "Allow safe auto-approved actions")
	.option("--no-deploy", "Run without deployment")
	.option("--coder <name>", "Coder identity stamp for this session (e.g. 'claude-sonnet-4-6')")
	.action(async (options: AutonomousCliOptions) => {
		const codedBy = options.coder ?? process.env.SUPERROO_CODER_ID
		const result = await runAutonomous({
			task: {
				source: SuperRooTaskSource.CLI,
				goal: "Run autonomous coding loop",
				workspacePath: options.project,
				codedBy,
				payload: {
					hours: Number(options.hours ?? "1"),
					autoApprove: Boolean(options.autoApprove),
					deploy: Boolean(options.deploy),
					mode: options.mode ?? "safe",
				},
			},
			source: SuperRooTaskSource.CLI,
		})
		const submitted = await postTaskToDaemon(result.task)
		if (submitted) {
			console.log(JSON.stringify(submitted, null, 2))
			return
		}

		const orchestrator = createPhase3Orchestrator(options.project, codedBy)
		await orchestrator.runAutonomous({ safeMode: options.mode !== "auto" })
		await runAutonomousCommand(options)
	})

program
	.command("deploy")
	.description("Deploy a project using its configured deploy script")
	.option("-p, --project <path>", "Project path to deploy")
	.option("--script <command>", "Deploy command", "pnpm deploy")
	.action(async (options: DeployCliOptions) => {
		const orchestrator = createPhase3Orchestrator(options.project)
		await orchestrator.deploy({ args: options.script ? ["--script", options.script] : [] })
		await runDeployCommand(options)
	})

program
	.command("check-vps")
	.description("Check live VPS/site health")
	.option("--url <url>", "Health check URL")
	.option("--retries <number>", "Number of retries", "3")
	.action(async (options: CheckVpsCliOptions) => {
		const orchestrator = createPhase3Orchestrator()
		await orchestrator.checkVps({ args: options.url ? ["--url", options.url] : [] })
		await runCheckVpsCommand(options)
	})

program
	.command("debug-api")
	.description("Run API configuration diagnostics for Claude/Kimi/OpenRouter/etc.")
	.option("-p, --project <path>", "Project path to inspect")
	.action(async (options: DebugApiCliOptions) => {
		const orchestrator = createPhase3Orchestrator(options.project)
		await orchestrator.debugApi({})
		await runDebugApiCommand(options)
	})

program
	.command("status")
	.description("Show project git, dependency, test, and deploy status")
	.option("-p, --project <path>", "Project path to inspect")
	.action(async (options: StatusCliOptions) => {
		const orchestrator = createPhase3Orchestrator(options.project)
		await orchestrator.status()
		await runStatusCommand(options)
	})

program
	.command("task <goal...>")
	.description("Submit one shared SuperRooTask")
	.option("--coder <name>", "Coder identity stamp for this task (e.g. 'claude-sonnet-4-6')")
	.action(async (goal: string[], options: { coder?: string }) => {
		const codedBy = options.coder ?? process.env.SUPERROO_CODER_ID
		const task = normalizeSuperRooTask({ source: SuperRooTaskSource.CLI, goal: goal.join(" "), codedBy })
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
