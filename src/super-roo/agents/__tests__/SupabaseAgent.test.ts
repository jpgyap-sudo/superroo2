import { describe, expect, it } from "vitest"

import { SupabaseAgent } from "../SupabaseAgent"
import type { SupabaseRunner } from "../SupabaseRunner"
import { capabilityForSupabaseRequest, inferSqlIntent } from "../SupabaseRunner"
import { SafetyMode } from "../../types"

function makeRunner(): { runner: SupabaseRunner; calls: unknown[] } {
	const calls: unknown[] = []
	return {
		calls,
		runner: {
			isReady: () => true,
			run: async (req) => {
				calls.push(req)
				return {
					action: req.action,
					command: "supabase",
					args: ["status"],
					cwd: req.cwd ?? "/workspace",
					exitCode: 0,
					durationMs: 1,
					stdout: "ok",
					stderr: "",
					passed: true,
					timedOut: false,
					aborted: false,
				}
			},
		},
	}
}

function makeCtx(payload: Record<string, unknown> = {}) {
	return {
		task: {
			id: "task_1",
			agent: "supabase",
			goal: "manage supabase",
			priority: "normal" as const,
			requiredCapabilities: [],
			payload,
			maxIterations: 5,
			status: "running" as const,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			attempts: 1,
		},
		safetyMode: SafetyMode.FULL_AUTONOMOUS,
		signal: new AbortController().signal,
		emit: () => {},
	}
}

describe("SupabaseRunner helpers", () => {
	it("infers read/write/admin SQL intent", () => {
		expect(inferSqlIntent("select * from users")).toBe("read")
		expect(inferSqlIntent("insert into users(id) values (1)")).toBe("write")
		expect(inferSqlIntent("drop schema public")).toBe("admin")
	})

	it("maps requests to capabilities", () => {
		expect(capabilityForSupabaseRequest({ action: "status" })).toBe("supabase.manage.local")
		expect(capabilityForSupabaseRequest({ action: "db-push" })).toBe("database.sql.migrate")
		expect(capabilityForSupabaseRequest({ action: "db-reset" })).toBe("database.sql.admin")
		expect(capabilityForSupabaseRequest({ action: "sql", sql: "select 1" })).toBe("database.sql.read")
	})
})

describe("SupabaseAgent", () => {
	it("passes payload through to the runner", async () => {
		const { runner, calls } = makeRunner()
		const agent = new SupabaseAgent(runner)
		const result = await agent.run(
			makeCtx({
				action: "sql",
				sql: "select 1",
				databaseUrl: "postgres://example",
				cwd: "/app",
			}) as never,
		)

		expect(result.ok).toBe(true)
		expect(calls[0]).toMatchObject({
			action: "sql",
			sql: "select 1",
			databaseUrl: "postgres://example",
			cwd: "/app",
		})
	})

	it("fails cleanly when the runner is not ready", async () => {
		const agent = new SupabaseAgent({ isReady: () => false, run: async () => { throw new Error("no") } })
		const result = await agent.run(makeCtx() as never)
		expect(result.ok).toBe(false)
		expect(result.error).toBe("runner_not_ready")
	})
})
