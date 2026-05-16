/**
 * Command Runner — Safe Executor
 *
 * Executes shell commands with safety checks, timeouts,
 * and structured output capture. Integrates with the
 * Safety Guard for approval-based execution.
 */

import { exec, type ChildProcess } from "node:child_process"
import * as path from "node:path"
import type { CommandResult, PlannedCommand, SafetyDecision } from "../../terminal-core/src/types"

export interface RunnerOptions {
	defaultTimeout?: number
	maxBuffer?: number
}

const DEFAULT_OPTIONS: RunnerOptions = {
	defaultTimeout: 60_000, // 60 seconds
	maxBuffer: 10 * 1024 * 1024, // 10MB
}

/**
 * Execute a planned command with safety checks.
 * Returns structured output including exit code, stdout, stderr.
 */
export function executeCommand(
	planned: PlannedCommand,
	safety: SafetyDecision,
	opts: RunnerOptions = {},
): Promise<CommandResult> {
	const { defaultTimeout = 60_000, maxBuffer = 10 * 1024 * 1024 } = { ...DEFAULT_OPTIONS, ...opts }

	return new Promise((resolve) => {
		if (!safety.allowed) {
			resolve({
				commandId: planned.id,
				exitCode: -1,
				stdout: "",
				stderr: safety.reason,
				output: [`[BLOCKED] ${safety.reason}`],
				durationMs: 0,
				timedOut: false,
			})
			return
		}

		const startTime = Date.now()
		const cwd = planned.cwd || process.cwd()
		let timedOut = false

		const child = exec(
			planned.command,
			{
				cwd: path.resolve(cwd),
				timeout: planned.timeout || defaultTimeout,
				maxBuffer,
				shell: process.platform === "win32" ? "cmd.exe" : "/bin/bash",
			},
			(error, stdout, stderr) => {
				const durationMs = Date.now() - startTime
				const exitCode = error?.code ?? (error ? 1 : 0)
				const outputLines = [
					...(stdout ? stdout.split("\n").filter(Boolean) : []),
					...(stderr ? stderr.split("\n").filter(Boolean) : []),
				]

				resolve({
					commandId: planned.id,
					exitCode: exitCode ?? null,
					stdout: stdout || "",
					stderr: stderr || "",
					output: outputLines,
					durationMs,
					timedOut,
				})
			},
		)

		// Handle timeout
		const timeout = planned.timeout || defaultTimeout
		const timer = setTimeout(() => {
			timedOut = true
			child.kill("SIGTERM")
		}, timeout)

		;(child as ChildProcess).on("close", () => {
			clearTimeout(timer)
		})
	})
}

/**
 * Execute a command and return only the exit code and output lines.
 * Simpler interface for quick commands.
 */
export async function runQuickCommand(
	command: string,
	cwd?: string,
	timeout?: number,
): Promise<{ exitCode: number; output: string[] }> {
	const planned: PlannedCommand = {
		id: `quick-${Date.now()}`,
		intent: "unknown",
		command,
		description: "Quick command",
		requiresApproval: false,
		cwd,
		timeout,
	}

	const safety: SafetyDecision = { allowed: true, reason: "quick command", requiresApproval: false }
	const result = await executeCommand(planned, safety)

	return {
		exitCode: result.exitCode ?? -1,
		output: result.output,
	}
}
