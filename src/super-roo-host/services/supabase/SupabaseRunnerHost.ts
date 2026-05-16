import { spawn, type ChildProcessByStdio } from "node:child_process"
import type { Readable } from "node:stream"

import type { SafetyManager } from "../../../super-roo/safety/SafetyManager"
import {
	capabilityForSupabaseRequest,
	type SupabaseRequest,
	type SupabaseResult,
	type SupabaseRunner,
} from "../../../super-roo/agents/SupabaseRunner"

export interface SupabaseRunnerHostOptions {
	defaultCwd: string
	safety: Pick<SafetyManager, "checkCapability" | "checkCommand" | "checkSql">
	databaseUrl?: string
	env?: Record<string, string>
	timeoutMs?: number
	spawnImpl?: typeof spawn
}

interface CommandSpec {
	command: string
	args: string[]
}

export class SupabaseRunnerHost implements SupabaseRunner {
	constructor(private readonly opts: SupabaseRunnerHostOptions) {}

	isReady(): boolean {
		return Boolean(this.opts.defaultCwd)
	}

	async run(req: SupabaseRequest): Promise<SupabaseResult> {
		const spec = this.resolveCommand(req)
		const cwd = req.cwd ?? this.opts.defaultCwd
		const timeoutMs = req.timeoutMs ?? this.opts.timeoutMs ?? 600_000

		this.assertAllowed(req, spec)

		const start = Date.now()
		return await new Promise<SupabaseResult>((resolve) => {
			const child = (this.opts.spawnImpl ?? spawn)(spec.command, spec.args, {
				cwd,
				env: {
					...process.env,
					...(this.opts.env ?? {}),
					...(this.opts.databaseUrl ? { DATABASE_URL: this.opts.databaseUrl } : {}),
					...(req.databaseUrl ? { DATABASE_URL: req.databaseUrl } : {}),
				},
				stdio: ["ignore", "pipe", "pipe"],
				shell: false,
			}) as ChildProcessByStdio<null, Readable, Readable>

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

			child.stdout.on("data", (chunk: Buffer) => {
				stdout += chunk.toString("utf8")
			})
			child.stderr.on("data", (chunk: Buffer) => {
				stderr += chunk.toString("utf8")
			})

			const finish = (exitCode: number | null, extraStderr = "") => {
				if (settled) return
				settled = true
				clearTimeout(timer)
				if (req.signal) req.signal.removeEventListener("abort", onAbort)
				resolve({
					action: req.action,
					command: spec.command,
					args: spec.args,
					cwd,
					exitCode,
					durationMs: Date.now() - start,
					stdout,
					stderr: stderr + extraStderr,
					passed: exitCode === 0 && !timedOut && !aborted,
					timedOut,
					aborted,
				})
			}

			child.on("error", (err) => finish(null, `\n[spawn error] ${err.message}`))
			child.on("close", (code) => finish(code))
		})
	}

	resolveCommand(req: SupabaseRequest): CommandSpec {
		switch (req.action) {
			case "status":
				return { command: bin("supabase"), args: ["status"] }
			case "start":
				return { command: bin("supabase"), args: ["start"] }
			case "stop":
				return { command: bin("supabase"), args: ["stop"] }
			case "migration-new":
				if (!req.migrationName) throw new Error("SupabaseRunnerHost: migration-new requires migrationName")
				return { command: bin("supabase"), args: ["migration", "new", req.migrationName] }
			case "db-push":
				return { command: bin("supabase"), args: ["db", "push"] }
			case "db-reset":
				return { command: bin("supabase"), args: ["db", "reset"] }
			case "sql":
				if (!req.sql) throw new Error("SupabaseRunnerHost: sql action requires sql")
				if (!(req.databaseUrl ?? this.opts.databaseUrl)) {
					throw new Error("SupabaseRunnerHost: sql action requires databaseUrl or options.databaseUrl")
				}
				return { command: bin("psql"), args: ["--set", "ON_ERROR_STOP=1", "--command", req.sql] }
		}
	}

	private assertAllowed(req: SupabaseRequest, spec: CommandSpec): void {
		const safety = this.opts.safety

		const capability = capabilityForSupabaseRequest(req)
		const cap = safety.checkCapability(capability)
		if (!cap.allowed) throw new Error(cap.reason)

		if (req.sql) {
			const sql = safety.checkSql(req.sql)
			if (!sql.allowed) throw new Error(sql.reason)
		}

		const command = [spec.command, ...spec.args].join(" ")
		const commandDecision = safety.checkCommand(command)
		if (!commandDecision.allowed) throw new Error(commandDecision.reason)
	}
}

function bin(name: "supabase" | "psql"): string {
	if (process.platform !== "win32") return name
	return name === "psql" ? "psql.exe" : "supabase.exe"
}
