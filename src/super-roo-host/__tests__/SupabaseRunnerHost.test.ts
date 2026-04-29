import { describe, expect, it } from "vitest"

import { SupabaseRunnerHost } from "../services/supabase"
import { SafetyManager } from "../../super-roo/safety/SafetyManager"
import { SafetyMode } from "../../super-roo/types"

const BLOCKLIST = {
	commandPatterns: [],
	sqlPatterns: ["DROP\\s+DATABASE"],
	pathPatterns: [],
	capabilityRules: {
		OFF: [],
		SAFE: ["read.file"],
		AUTO: ["database.sql.read", "database.sql.write", "database.sql.migrate", "supabase.manage.local"],
		FULL_AUTONOMOUS: [
			"database.sql.read",
			"database.sql.write",
			"database.sql.migrate",
			"database.sql.admin",
			"supabase.manage.local",
			"supabase.manage.remote",
		],
	},
}

describe("SupabaseRunnerHost command resolution", () => {
	const safety = new SafetyManager({ initialMode: SafetyMode.FULL_AUTONOMOUS, blocklist: BLOCKLIST })

	it("builds Supabase CLI commands", () => {
		const runner = new SupabaseRunnerHost({ defaultCwd: "/repo", safety })
		expect(runner.resolveCommand({ action: "status" })).toMatchObject({ args: ["status"] })
		expect(runner.resolveCommand({ action: "migration-new", migrationName: "add_profiles" })).toMatchObject({
			args: ["migration", "new", "add_profiles"],
		})
		expect(runner.resolveCommand({ action: "db-push" })).toMatchObject({ args: ["db", "push"] })
	})

	it("builds psql SQL commands without shell expansion", () => {
		const runner = new SupabaseRunnerHost({ defaultCwd: "/repo", databaseUrl: "postgres://example", safety })
		expect(runner.resolveCommand({ action: "sql", sql: "select 1" })).toMatchObject({
			args: ["--set", "ON_ERROR_STOP=1", "--command", "select 1"],
		})
	})

	it("requires a database URL for raw SQL", () => {
		const runner = new SupabaseRunnerHost({ defaultCwd: "/repo", safety })
		expect(() => runner.resolveCommand({ action: "sql", sql: "select 1" })).toThrow(/databaseUrl/)
	})
})

describe("SupabaseRunnerHost safety checks", () => {
	it("blocks destructive SQL even in full autonomous mode", async () => {
		const safety = new SafetyManager({ initialMode: SafetyMode.FULL_AUTONOMOUS, blocklist: BLOCKLIST })
		const runner = new SupabaseRunnerHost({ defaultCwd: "/repo", databaseUrl: "postgres://example", safety })
		await expect(runner.run({ action: "sql", sql: "DROP DATABASE prod" })).rejects.toThrow(/SQL matches blocklist/)
	})

	it("blocks admin operations outside full autonomous mode", async () => {
		const safety = new SafetyManager({ initialMode: SafetyMode.AUTO, blocklist: BLOCKLIST })
		const runner = new SupabaseRunnerHost({ defaultCwd: "/repo", safety })
		await expect(runner.run({ action: "db-reset" })).rejects.toThrow(/database\.sql\.admin/)
	})
})
