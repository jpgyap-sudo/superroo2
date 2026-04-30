import path from "node:path"
import { readFile } from "node:fs/promises"
import { fileExistsAtPath } from "../utils/fs"
import { logStep, logWarn } from "./utils/logger"
import { runShell, runShellArgs } from "./utils/shell"

export interface SuperRooCoreOptions {
	projectPath?: string
	autoApprove?: boolean
	allowDeploy?: boolean
}

export class SuperRooCore {
	public readonly projectPath: string
	public readonly autoApprove: boolean
	public readonly allowDeploy: boolean

	constructor(options: SuperRooCoreOptions = {}) {
		this.projectPath = path.resolve(options.projectPath || process.env.SUPERROO_DEFAULT_PROJECT || process.cwd())
		this.autoApprove = Boolean(options.autoApprove)
		this.allowDeploy = Boolean(options.allowDeploy)
	}

	async verifyProject(): Promise<void> {
		logStep(`Checking project path: ${this.projectPath}`)

		if (!(await fileExistsAtPath(this.projectPath))) {
			throw new Error(`Project path does not exist: ${this.projectPath}`)
		}

		if (!(await fileExistsAtPath(path.join(this.projectPath, "package.json")))) {
			logWarn("No package.json found. This may not be a Node/TypeScript project.")
		}
	}

	async gitStatus(): Promise<string> {
		const result = await runShell("git status --short", {
			cwd: this.projectPath,
			allowFailure: true,
		})
		return result.stdout.trim()
	}

	async runInstall(): Promise<void> {
		if (await fileExistsAtPath(path.join(this.projectPath, "pnpm-lock.yaml"))) {
			await runShell("pnpm install", { cwd: this.projectPath })
			return
		}

		if (await fileExistsAtPath(path.join(this.projectPath, "package-lock.json"))) {
			await runShell("npm install", { cwd: this.projectPath })
			return
		}

		if (await fileExistsAtPath(path.join(this.projectPath, "yarn.lock"))) {
			await runShell("yarn install", { cwd: this.projectPath })
			return
		}

		logWarn("No known lockfile found. Skipping install.")
	}

	async runBuild(): Promise<void> {
		if (await this.isSuperRooWorkspace()) {
			await runShellArgs("pnpm", ["--filter", "superroo", "bundle"], { cwd: this.projectPath })
			return
		}

		if (await fileExistsAtPath(path.join(this.projectPath, "pnpm-lock.yaml"))) {
			await runShellArgs("pnpm", ["build"], { cwd: this.projectPath })
			return
		}

		await runShellArgs("npm", ["run", "build"], { cwd: this.projectPath })
	}

	async runTests(): Promise<void> {
		if (await this.isSuperRooWorkspace()) {
			await runShellArgs(
				"pnpm",
				["--filter", "superroo", "test", "cli", path.join("core", "__tests__", "SuperRooTask.test.ts")],
				{
					cwd: this.projectPath,
					allowFailure: true,
				},
			)
			return
		}

		if (await fileExistsAtPath(path.join(this.projectPath, "pnpm-lock.yaml"))) {
			await runShellArgs("pnpm", ["test"], { cwd: this.projectPath, allowFailure: true })
			return
		}

		await runShellArgs("npm", ["test"], { cwd: this.projectPath, allowFailure: true })
	}

	async createCheckpointCommit(message = "chore: superroo checkpoint"): Promise<void> {
		const status = await this.gitStatus()
		if (!status) {
			logStep("No git changes to commit.")
			return
		}

		await runShellArgs("git", ["add", "-A"], { cwd: this.projectPath })
		await runShellArgs("git", ["commit", "-m", message], {
			cwd: this.projectPath,
			allowFailure: true,
		})
	}

	private async isSuperRooWorkspace(): Promise<boolean> {
		const extensionPackagePath = path.join(this.projectPath, "src", "package.json")
		if (!(await fileExistsAtPath(extensionPackagePath))) {
			return false
		}

		try {
			const packageJson = JSON.parse(await readFile(extensionPackagePath, "utf8")) as { name?: string }
			return packageJson.name === "superroo"
		} catch {
			return false
		}
	}
}
