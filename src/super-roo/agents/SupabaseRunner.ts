import type { Capability } from "../types"

export type SupabaseAction =
	| "status"
	| "start"
	| "stop"
	| "migration-new"
	| "db-push"
	| "db-reset"
	| "sql"

export type SqlIntent = "read" | "write" | "admin"

export interface SupabaseRequest {
	action: SupabaseAction
	cwd?: string
	timeoutMs?: number
	signal?: AbortSignal
	sql?: string
	sqlIntent?: SqlIntent
	migrationName?: string
	databaseUrl?: string
}

export interface SupabaseResult {
	action: SupabaseAction
	command: string
	args: string[]
	cwd: string
	exitCode: number | null
	durationMs: number
	stdout: string
	stderr: string
	passed: boolean
	timedOut: boolean
	aborted: boolean
}

export interface SupabaseRunner {
	isReady(): boolean
	run(req: SupabaseRequest): Promise<SupabaseResult>
}

export function capabilityForSupabaseRequest(req: Pick<SupabaseRequest, "action" | "sql" | "sqlIntent">): Capability {
	switch (req.action) {
		case "status":
		case "start":
		case "stop":
			return "supabase.manage.local"
		case "migration-new":
		case "db-push":
			return "database.sql.migrate"
		case "db-reset":
			return "database.sql.admin"
		case "sql":
			return `database.sql.${req.sqlIntent ?? inferSqlIntent(req.sql ?? "")}`
	}
}

export function inferSqlIntent(sql: string): SqlIntent {
	const normalized = sql.trim().replace(/^\/\*[\s\S]*?\*\//, "").trim().toLowerCase()
	if (/^(select|with|explain|show)\b/.test(normalized)) return "read"
	if (/^(drop|truncate|alter\s+database|alter\s+schema|create\s+extension|grant|revoke)\b/.test(normalized)) {
		return "admin"
	}
	return "write"
}
