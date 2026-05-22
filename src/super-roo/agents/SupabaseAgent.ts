import type { Agent, AgentRunContext, AgentRunResult, Capability } from "../types"
import {
	capabilityForSupabaseRequest,
	type SupabaseAction,
	type SupabaseRequest,
	type SupabaseRunner,
	type SqlIntent,
} from "./SupabaseRunner"

export interface SupabaseAgentOptions {
	defaultAction?: SupabaseAction
}

export class SupabaseAgent implements Agent {
	readonly name = "supabase"
	readonly description = "Runs Supabase CLI/database operations through the host Supabase runner."
	readonly requiredCapabilities: Capability[] = ["supabase.manage.local"]
	readonly tags: string[] = ["database", "supabase", "infrastructure"]

	constructor(
		private readonly runner: SupabaseRunner,
		private readonly opts: SupabaseAgentOptions = {},
	) {}

	async run(ctx: AgentRunContext): Promise<AgentRunResult> {
		if (!this.runner.isReady()) {
			return { ok: false, summary: "Supabase Agent: runner not ready", error: "runner_not_ready" }
		}

		const req = this.requestFromPayload(ctx)
		const required = capabilityForSupabaseRequest(req)
		ctx.emit("info", "agent.invoked", `Supabase Agent running ${req.action}`, {
			action: req.action,
			requiredCapability: required,
		})

		try {
			const result = await this.runner.run(req)
			const tail = [result.stdout, result.stderr]
				.filter(Boolean)
				.join("\n")
				.slice(-1000)
				.trim()
			return {
				ok: result.passed,
				summary: result.passed
					? `Supabase Agent: ${req.action} completed.`
					: `Supabase Agent: ${req.action} failed with exit code ${result.exitCode ?? "n/a"}.`,
				error: result.passed ? undefined : tail || `exit_code:${result.exitCode ?? "null"}`,
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			return { ok: false, summary: `Supabase Agent: setup error - ${msg}`, error: msg }
		}
	}

	private requestFromPayload(ctx: AgentRunContext): SupabaseRequest {
		const payload = ctx.task.payload ?? {}
		const action = parseAction(payload.action) ?? this.opts.defaultAction ?? "status"
		const sql = typeof payload.sql === "string" ? payload.sql : undefined
		const migrationName = typeof payload.migrationName === "string" ? payload.migrationName : undefined
		const cwd = typeof payload.cwd === "string" ? payload.cwd : undefined
		const databaseUrl = typeof payload.databaseUrl === "string" ? payload.databaseUrl : undefined
		const timeoutMs = typeof payload.timeoutMs === "number" ? payload.timeoutMs : undefined
		const sqlIntent = parseSqlIntent(payload.sqlIntent)

		return {
			action,
			sql,
			sqlIntent,
			migrationName,
			cwd,
			databaseUrl,
			timeoutMs,
			signal: ctx.signal,
		}
	}
}

function parseAction(value: unknown): SupabaseAction | undefined {
	const allowed: SupabaseAction[] = ["status", "start", "stop", "migration-new", "db-push", "db-reset", "sql"]
	return typeof value === "string" && allowed.includes(value as SupabaseAction) ? (value as SupabaseAction) : undefined
}

function parseSqlIntent(value: unknown): SqlIntent | undefined {
	return value === "read" || value === "write" || value === "admin" ? value : undefined
}
