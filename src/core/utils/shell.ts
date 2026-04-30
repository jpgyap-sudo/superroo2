import { execa } from "execa"

export interface RunShellOptions {
	cwd?: string
	allowFailure?: boolean
	inheritStdio?: boolean
}

export interface RunShellResult {
	code: number
	stdout: string
	stderr: string
}

export async function runShellArgs(command: string, args: string[] = [], options: RunShellOptions = {}): Promise<RunShellResult> {
	const cwd = options.cwd || process.cwd()

	try {
		const result = await execa(command, args, {
			cwd,
			env: process.env,
			stdio: options.inheritStdio ? "inherit" : "pipe",
			reject: false,
			all: true,
		} as any)

		const finalCode = result.exitCode ?? 1
		const stdout = result.stdout || ""
		const stderr = result.stderr || ""

		if (finalCode !== 0 && !options.allowFailure) {
			throw new Error(`Command failed with code ${finalCode}: ${[command, ...args].join(" ")}`)
		}

		return { code: finalCode, stdout, stderr }
	} catch (error) {
		if (options.allowFailure) {
			return { code: 1, stdout: "", stderr: String(error) }
		}
		throw error
	}
}

export async function runShell(command: string, options: RunShellOptions = {}): Promise<RunShellResult> {
	const parts = command.split(/\s+/).filter(Boolean)
	return runShellArgs(parts[0], parts.slice(1), options)
}
