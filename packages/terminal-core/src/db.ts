/**
 * PgTerminalStore — PostgreSQL persistence for terminal memory
 *
 * Stores sessions, commands, errors, fixes, and deployments
 * using the same pg pool pattern as @superroo/memory-core.
 */

import { Pool, type PoolConfig } from "pg"
import type {
	TerminalSession,
	TerminalCommandRecord,
	TerminalErrorRecord,
	AgentFixRecord,
	DeploymentLogRecord,
} from "./types.js"

export interface PgTerminalStoreOptions {
	connectionString?: string
	poolConfig?: PoolConfig
}

export class PgTerminalStore {
	private pool: Pool

	constructor(options: PgTerminalStoreOptions = {}) {
		const connectionString = options.connectionString ?? process.env.DATABASE_URL
		if (!connectionString) throw new Error("DATABASE_URL is required for PgTerminalStore")
		this.pool = new Pool({ connectionString, ...options.poolConfig })
	}

	async close(): Promise<void> {
		await this.pool.end()
	}

	// ─── Sessions ───────────────────────────────────────────────────────

	async createSession(workspaceId: string, userId?: string): Promise<TerminalSession> {
		const session: TerminalSession = {
			id: `ts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			workspaceId,
			startedAt: Date.now(),
			endedAt: null,
			status: "active",
			metadata: userId ? { userId } : {},
		}
		await this.pool.query(
			`INSERT INTO terminal_sessions (id, workspace_id, user_id, started_at, status, metadata)
			 VALUES ($1, $2, $3, to_timestamp($4 / 1000.0), $5, $6)`,
			[
				session.id,
				workspaceId,
				userId || null,
				session.startedAt,
				session.status,
				JSON.stringify(session.metadata),
			],
		)
		return session
	}

	async closeSession(sessionId: string): Promise<void> {
		await this.pool.query(
			`UPDATE terminal_sessions
			 SET status = 'closed', ended_at = now()
			 WHERE id = $1`,
			[sessionId],
		)
	}

	async getSession(sessionId: string): Promise<TerminalSession | undefined> {
		const result = await this.pool.query(
			`SELECT id, workspace_id, user_id, started_at, ended_at, status, metadata
			 FROM terminal_sessions WHERE id = $1`,
			[sessionId],
		)
		if (result.rows.length === 0) return undefined
		return this.rowToSession(result.rows[0])
	}

	async getSessions(workspaceId?: string, userId?: string): Promise<TerminalSession[]> {
		let query = `SELECT id, workspace_id, user_id, started_at, ended_at, status, metadata FROM terminal_sessions`
		const conditions: string[] = []
		const values: (string | null)[] = []
		if (workspaceId) {
			conditions.push(`workspace_id = $${values.length + 1}`)
			values.push(workspaceId)
		}
		if (userId) {
			conditions.push(`user_id = $${values.length + 1}`)
			values.push(userId)
		}
		if (conditions.length > 0) {
			query += ` WHERE ${conditions.join(" AND ")}`
		}
		query += ` ORDER BY started_at DESC`
		const result = await this.pool.query(query, values)
		return result.rows.map((r) => this.rowToSession(r))
	}

	async getActiveSessionForUser(userId: string): Promise<TerminalSession | undefined> {
		const result = await this.pool.query(
			`SELECT id, workspace_id, user_id, started_at, ended_at, status, metadata
			 FROM terminal_sessions
			 WHERE user_id = $1 AND status = 'active'
			 ORDER BY started_at DESC
			 LIMIT 1`,
			[userId],
		)
		if (result.rows.length === 0) return undefined
		return this.rowToSession(result.rows[0])
	}

	// ─── Commands ───────────────────────────────────────────────────────

	async recordCommand(sessionId: string, command: string): Promise<TerminalCommandRecord> {
		const record: TerminalCommandRecord = {
			id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			sessionId,
			command,
			exitCode: null,
			outputSummary: "",
			errorSummary: null,
			filesChanged: [],
			startedAt: Date.now(),
			finishedAt: null,
			durationMs: null,
		}
		await this.pool.query(
			`INSERT INTO terminal_commands (id, session_id, command, exit_code, output_summary, error_summary, files_changed, started_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8 / 1000.0))`,
			[record.id, sessionId, command, null, "", null, "[]", record.startedAt],
		)
		return record
	}

	async completeCommand(
		commandId: string,
		exitCode: number,
		outputSummary: string,
		errorSummary: string | null,
		filesChanged: string[],
	): Promise<void> {
		const startedResult = await this.pool.query(`SELECT started_at FROM terminal_commands WHERE id = $1`, [
			commandId,
		])
		const startedAt = startedResult.rows[0]?.started_at
			? new Date(startedResult.rows[0].started_at).getTime()
			: Date.now()
		const durationMs = Date.now() - startedAt
		await this.pool.query(
			`UPDATE terminal_commands
			 SET exit_code = $2, output_summary = $3, error_summary = $4, files_changed = $5,
			     finished_at = now(), duration_ms = $6
			 WHERE id = $1`,
			[commandId, exitCode, outputSummary.slice(0, 500), errorSummary, JSON.stringify(filesChanged), durationMs],
		)
	}

	async getCommands(sessionId?: string): Promise<TerminalCommandRecord[]> {
		let query = `SELECT id, session_id, command, exit_code, output_summary, error_summary, files_changed, started_at, finished_at, duration_ms FROM terminal_commands`
		const values: (string | null)[] = []
		if (sessionId) {
			query += ` WHERE session_id = $1`
			values.push(sessionId)
		}
		query += ` ORDER BY started_at DESC`
		const result = await this.pool.query(query, values)
		return result.rows.map((r) => this.rowToCommand(r))
	}

	async getLastCommand(sessionId: string): Promise<TerminalCommandRecord | undefined> {
		const result = await this.pool.query(
			`SELECT id, session_id, command, exit_code, output_summary, error_summary, files_changed, started_at, finished_at, duration_ms
			 FROM terminal_commands
			 WHERE session_id = $1
			 ORDER BY started_at DESC
			 LIMIT 1`,
			[sessionId],
		)
		if (result.rows.length === 0) return undefined
		return this.rowToCommand(result.rows[0])
	}

	async getPopularCommands(workspaceId: string, limit = 10): Promise<{ command: string; count: number }[]> {
		const result = await this.pool.query(
			`SELECT c.command, COUNT(*) as count
			 FROM terminal_commands c
			 JOIN terminal_sessions s ON c.session_id = s.id
			 WHERE s.workspace_id = $1
			 GROUP BY c.command
			 ORDER BY count DESC
			 LIMIT $2`,
			[workspaceId, limit],
		)
		return result.rows.map((r) => ({ command: r.command, count: Number(r.count) }))
	}

	async getRecentCommands(workspaceId: string, limit = 10): Promise<{ command: string; startedAt: number }[]> {
		const result = await this.pool.query(
			`SELECT DISTINCT ON (c.command) c.command, c.started_at
			 FROM terminal_commands c
			 JOIN terminal_sessions s ON c.session_id = s.id
			 WHERE s.workspace_id = $1
			 ORDER BY c.command, c.started_at DESC
			 LIMIT $2`,
			[workspaceId, limit],
		)
		return result.rows.map((r) => ({
			command: r.command,
			startedAt: new Date(r.started_at).getTime(),
		}))
	}

	// ─── Errors ─────────────────────────────────────────────────────────

	async recordError(
		commandId: string,
		errorType: string,
		errorMessage: string,
		rootCause: string,
		relatedFiles: string[],
		fixSuggested: string | null,
	): Promise<TerminalErrorRecord> {
		const record: TerminalErrorRecord = {
			id: `te-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			commandId,
			errorType: errorType as TerminalErrorRecord["errorType"],
			errorMessage: errorMessage.slice(0, 500),
			rootCause,
			relatedFiles,
			fixSuggested,
			fixApplied: false,
			fixSucceeded: false,
			createdAt: Date.now(),
		}
		await this.pool.query(
			`INSERT INTO terminal_errors (id, command_id, error_type, error_message, root_cause, related_files, fix_suggested, created_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8 / 1000.0))`,
			[
				record.id,
				commandId,
				errorType,
				record.errorMessage,
				rootCause,
				JSON.stringify(relatedFiles),
				fixSuggested,
				record.createdAt,
			],
		)
		return record
	}

	async markFixApplied(errorId: string, succeeded: boolean): Promise<void> {
		await this.pool.query(
			`UPDATE terminal_errors
			 SET fix_applied = true, fix_succeeded = $2
			 WHERE id = $1`,
			[errorId, succeeded],
		)
	}

	async getErrors(commandId?: string): Promise<TerminalErrorRecord[]> {
		let query = `SELECT id, command_id, error_type, error_message, root_cause, related_files, fix_suggested, fix_applied, fix_succeeded, created_at FROM terminal_errors`
		const values: (string | null)[] = []
		if (commandId) {
			query += ` WHERE command_id = $1`
			values.push(commandId)
		}
		query += ` ORDER BY created_at DESC`
		const result = await this.pool.query(query, values)
		return result.rows.map((r) => this.rowToError(r))
	}

	async getRecentErrors(limit = 10): Promise<TerminalErrorRecord[]> {
		const result = await this.pool.query(
			`SELECT id, command_id, error_type, error_message, root_cause, related_files, fix_suggested, fix_applied, fix_succeeded, created_at
			 FROM terminal_errors
			 ORDER BY created_at DESC
			 LIMIT $1`,
			[limit],
		)
		return result.rows.map((r) => this.rowToError(r))
	}

	// ─── Fixes ──────────────────────────────────────────────────────────

	async recordFix(
		errorId: string,
		summary: string,
		filesChanged: string[],
		patch: string,
		result: AgentFixRecord["result"],
	): Promise<AgentFixRecord> {
		const record: AgentFixRecord = {
			id: `tf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			errorId,
			summary,
			filesChanged,
			patch,
			result,
			createdAt: Date.now(),
		}
		await this.pool.query(
			`INSERT INTO terminal_fixes (id, error_id, summary, files_changed, patch, result, created_at)
			 VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0))`,
			[record.id, errorId, summary, JSON.stringify(filesChanged), patch, result, record.createdAt],
		)
		return record
	}

	async getFixes(errorId?: string): Promise<AgentFixRecord[]> {
		let query = `SELECT id, error_id, summary, files_changed, patch, result, created_at FROM terminal_fixes`
		const values: (string | null)[] = []
		if (errorId) {
			query += ` WHERE error_id = $1`
			values.push(errorId)
		}
		query += ` ORDER BY created_at DESC`
		const result = await this.pool.query(query, values)
		return result.rows.map((r) => this.rowToFix(r))
	}

	// ─── Deployments ────────────────────────────────────────────────────

	async recordDeployment(
		version: string,
		commitSha: string,
		status: DeploymentLogRecord["status"],
	): Promise<DeploymentLogRecord> {
		const record: DeploymentLogRecord = {
			id: `td-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			version,
			commitSha,
			status,
			checks: [],
			logs: "",
			createdAt: Date.now(),
			finishedAt: null,
		}
		await this.pool.query(
			`INSERT INTO terminal_deployments (id, version, commit_sha, status, checks, logs, created_at)
			 VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0))`,
			[record.id, version, commitSha, status, "[]", "", record.createdAt],
		)
		return record
	}

	async updateDeploymentStatus(
		deployId: string,
		status: DeploymentLogRecord["status"],
		logs?: string,
	): Promise<void> {
		const finishedAt = status === "healthy" || status === "failed" || status === "rolled_back" ? "now()" : null
		await this.pool.query(
			`UPDATE terminal_deployments
			 SET status = $2, logs = COALESCE($3, logs), finished_at = ${finishedAt}
			 WHERE id = $1`,
			[deployId, status, logs || null],
		)
	}

	async getDeployments(): Promise<DeploymentLogRecord[]> {
		const result = await this.pool.query(
			`SELECT id, version, commit_sha, status, checks, logs, created_at, finished_at
			 FROM terminal_deployments
			 ORDER BY created_at DESC`,
		)
		return result.rows.map((r) => this.rowToDeployment(r))
	}

	// ─── Stats ──────────────────────────────────────────────────────────

	async getStats(): Promise<{
		totalSessions: number
		totalCommands: number
		totalErrors: number
		totalFixes: number
		totalDeployments: number
		successRate: number
	}> {
		const sessionsResult = await this.pool.query(`SELECT COUNT(*) FROM terminal_sessions`)
		const commandsResult = await this.pool.query(
			`SELECT COUNT(*), COUNT(CASE WHEN exit_code = 0 THEN 1 END) FROM terminal_commands`,
		)
		const errorsResult = await this.pool.query(`SELECT COUNT(*) FROM terminal_errors`)
		const fixesResult = await this.pool.query(`SELECT COUNT(*) FROM terminal_fixes`)
		const deploymentsResult = await this.pool.query(`SELECT COUNT(*) FROM terminal_deployments`)

		const totalCommands = Number(commandsResult.rows[0].count)
		const succeeded = Number(commandsResult.rows[0].count)
		// Wait, the query above has a bug — COUNT(CASE...) needs an alias
		// Actually let's fix the query:
		const cmdResult = await this.pool.query(
			`SELECT COUNT(*) as total, COUNT(CASE WHEN exit_code = 0 THEN 1 END) as succeeded FROM terminal_commands`,
		)
		const total = Number(cmdResult.rows[0].total)
		const successCount = Number(cmdResult.rows[0].succeeded)

		return {
			totalSessions: Number(sessionsResult.rows[0].count),
			totalCommands: total,
			totalErrors: Number(errorsResult.rows[0].count),
			totalFixes: Number(fixesResult.rows[0].count),
			totalDeployments: Number(deploymentsResult.rows[0].count),
			successRate: total > 0 ? Math.round((successCount / total) * 100) : 100,
		}
	}

	// ─── Row Mappers ────────────────────────────────────────────────────

	private rowToSession(row: Record<string, unknown>): TerminalSession {
		return {
			id: row.id as string,
			workspaceId: row.workspace_id as string,
			startedAt: new Date(row.started_at as string).getTime(),
			endedAt: row.ended_at ? new Date(row.ended_at as string).getTime() : null,
			status: row.status as "active" | "closed",
			metadata: (row.metadata as Record<string, unknown>) ?? {},
		}
	}

	private rowToCommand(row: Record<string, unknown>): TerminalCommandRecord {
		return {
			id: row.id as string,
			sessionId: row.session_id as string,
			command: row.command as string,
			exitCode: row.exit_code !== null ? Number(row.exit_code) : null,
			outputSummary: (row.output_summary as string) ?? "",
			errorSummary: (row.error_summary as string) ?? null,
			filesChanged: Array.isArray(row.files_changed)
				? (row.files_changed as string[])
				: JSON.parse((row.files_changed as string) || "[]"),
			startedAt: new Date(row.started_at as string).getTime(),
			finishedAt: row.finished_at ? new Date(row.finished_at as string).getTime() : null,
			durationMs: row.duration_ms !== null ? Number(row.duration_ms) : null,
		}
	}

	private rowToError(row: Record<string, unknown>): TerminalErrorRecord {
		return {
			id: row.id as string,
			commandId: row.command_id as string,
			errorType: row.error_type as TerminalErrorRecord["errorType"],
			errorMessage: row.error_message as string,
			rootCause: row.root_cause as string,
			relatedFiles: Array.isArray(row.related_files)
				? (row.related_files as string[])
				: JSON.parse((row.related_files as string) || "[]"),
			fixSuggested: (row.fix_suggested as string) ?? null,
			fixApplied: Boolean(row.fix_applied),
			fixSucceeded: Boolean(row.fix_succeeded),
			createdAt: new Date(row.created_at as string).getTime(),
		}
	}

	private rowToFix(row: Record<string, unknown>): AgentFixRecord {
		return {
			id: row.id as string,
			errorId: row.error_id as string,
			summary: row.summary as string,
			filesChanged: Array.isArray(row.files_changed)
				? (row.files_changed as string[])
				: JSON.parse((row.files_changed as string) || "[]"),
			patch: row.patch as string,
			result: row.result as AgentFixRecord["result"],
			createdAt: new Date(row.created_at as string).getTime(),
		}
	}

	private rowToDeployment(row: Record<string, unknown>): DeploymentLogRecord {
		return {
			id: row.id as string,
			version: row.version as string,
			commitSha: row.commit_sha as string,
			status: row.status as DeploymentLogRecord["status"],
			checks: Array.isArray(row.checks) ? (row.checks as string[]) : JSON.parse((row.checks as string) || "[]"),
			logs: (row.logs as string) ?? "",
			createdAt: new Date(row.created_at as string).getTime(),
			finishedAt: row.finished_at ? new Date(row.finished_at as string).getTime() : null,
		}
	}
}
