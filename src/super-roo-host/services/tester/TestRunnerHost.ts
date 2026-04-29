/**
 * Super Roo Host — Test Runner.
 *
 * Concrete TestRunner that spawns subprocesses via Node's `child_process`.
 * Picks a default command based on `kind`:
 *   unit       → `npm test`
 *   lint       → `npm run lint`
 *   typecheck  → `npm run check-types` (or `tsc --noEmit` fallback)
 *   e2e        → `npx playwright test`
 *   custom     → caller-supplied command/args
 *
 * Why detect by `kind` and not just always shell out to a user-supplied
 * command? Because the orchestrator and other agents may dispatch a
 * `kind: "unit"` task without knowing which package manager the user has.
 * The runner picks a sensible default.
 *
 * Phase 2.5 limitations:
 *   - Assumes Node 20.19.2 (matches Roo's `engines` pin)
 *   - Assumes the user's project has standard npm scripts. For non-npm projects
 *     callers must pass `kind: "custom"` with explicit `command`.
 *   - No streaming output — caller gets full stdout/stderr at the end. The
 *     orchestrator's EventLog gets a tail for the dashboard.
 *
 * Security note: the SafetyManager blocklist (Phase 1) does NOT apply here
 * because the test command isn't free-form — the agent's payload is
 * trusted-orchestrator-only. If a hostile task can reach this code, the
 * blocklist won't save you. Keep this in mind when extending Phase 2.5+.
 */

import { spawn } from "node:child_process"

import type { TestKind, TestRequest, TestResult, TestRunner } from "../../../super-roo/agents/TestRunner"

export interface TestRunnerHostOptions {
	/** Default cwd for test runs (the user's workspace). */
	defaultCwd: string
	/** Optional environment overrides applied to every run. */
	env?: Record<string, string>
}

interface DefaultCommand {
	command: string
	args: string[]
}

function defaultsFor(kind: TestKind): DefaultCommand {
	switch (kind) {
		case "unit":
			return { command: bin("npm"), args: ["test", "--", "--silent"] }
		case "lint":
			return { command: bin("npm"), args: ["run", "lint"] }
		case "typecheck":
			return { command: bin("npm"), args: ["run", "check-types"] }
		case "e2e":
			return { command: bin("npx"), args: ["playwright", "test"] }
		case "custom":
			// Caller MUST provide command/args for custom kind.
			return { command: "", args: [] }
	}
}

function bin(name: "npm" | "npx"): string {
	return process.platform === "win32" ? `${name}.cmd` : name
}

export class TestRunnerHost implements TestRunner {
	constructor(private readonly opts: TestRunnerHostOptions) {}

	isReady(): boolean {
		return Boolean(this.opts.defaultCwd)
	}

	async run(req: TestRequest): Promise<TestResult> {
		const { command, args } = this.resolveCommand(req)
		const cwd = req.cwd ?? this.opts.defaultCwd
		const timeoutMs = req.timeoutMs ?? 600_000

		if (!command) {
			throw new Error(`TestRunnerHost: kind="custom" requires explicit command`)
		}

		const start = Date.now()
		return await new Promise<TestResult>((resolve) => {
			const child = spawn(command, args, {
				cwd,
				env: { ...process.env, ...(this.opts.env ?? {}) },
				stdio: ["ignore", "pipe", "pipe"],
				// shell:false — args are passed as an array, no shell expansion.
				// This avoids accidental command injection from payload values.
				shell: false,
			})

			let stdout = ""
			let stderr = ""
			let timedOut = false
			let aborted = false
			let settled = false

			const timer: NodeJS.Timeout = setTimeout(() => {
				timedOut = true
				try {
					child.kill("SIGTERM")
					setTimeout(() => {
						if (!settled) child.kill("SIGKILL")
					}, 5000)
				} catch {
					// already exited
				}
			}, timeoutMs)

			const onAbort = () => {
				aborted = true
				try {
					child.kill("SIGTERM")
				} catch {
					// already exited
				}
			}
			if (req.signal) {
				if (req.signal.aborted) {
					onAbort()
				} else {
					req.signal.addEventListener("abort", onAbort)
				}
			}

			child.stdout?.on("data", (chunk: Buffer) => {
				stdout += chunk.toString("utf8")
			})
			child.stderr?.on("data", (chunk: Buffer) => {
				stderr += chunk.toString("utf8")
			})

			child.on("error", (err) => {
				if (settled) return
				settled = true
				clearTimeout(timer)
				if (req.signal) req.signal.removeEventListener("abort", onAbort)
				resolve({
					kind: req.kind,
					command,
					args,
					cwd,
					exitCode: null,
					durationMs: Date.now() - start,
					stdout,
					stderr: stderr + `\n[spawn error] ${err.message}`,
					passed: false,
					timedOut,
					aborted,
				})
			})

			child.on("close", (code) => {
				if (settled) return
				settled = true
				clearTimeout(timer)
				if (req.signal) req.signal.removeEventListener("abort", onAbort)
				resolve({
					kind: req.kind,
					command,
					args,
					cwd,
					exitCode: code,
					durationMs: Date.now() - start,
					stdout,
					stderr,
					passed: code === 0 && !timedOut && !aborted,
					timedOut,
					aborted,
				})
			})
		})
	}

	private resolveCommand(req: TestRequest): DefaultCommand {
		if (req.command) {
			return { command: req.command, args: req.args ?? [] }
		}
		return defaultsFor(req.kind)
	}
}
