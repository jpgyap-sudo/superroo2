/**
 * Terminal Memory — Persistent Storage for Terminal Events
 *
 * Stores terminal sessions, commands, errors, fixes, and deployment logs.
 * Uses an in-memory store with JSON persistence for the cloud dashboard.
 * Can be backed by SQLite (via MemoryStore) for the VS Code extension.
 */

import type {
	TerminalSession,
	TerminalCommandRecord,
	TerminalErrorRecord,
	AgentFixRecord,
	DeploymentLogRecord,
	ErrorType,
} from "./types"

// ─── In-Memory Store ─────────────────────────────────────────────────────

interface MemoryData {
	sessions: Map<string, TerminalSession>
	commands: Map<string, TerminalCommandRecord>
	errors: Map<string, TerminalErrorRecord>
	fixes: Map<string, AgentFixRecord>
	deployments: Map<string, DeploymentLogRecord>
}

export class TerminalMemory {
	private data: MemoryData = {
		sessions: new Map(),
		commands: new Map(),
		errors: new Map(),
		fixes: new Map(),
		deployments: new Map(),
	}

	// ─── Sessions ───────────────────────────────────────────────────────

	createSession(workspaceId: string): TerminalSession {
		const session: TerminalSession = {
			id: `ts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			workspaceId,
			startedAt: Date.now(),
			endedAt: null,
			status: "active",
			metadata: {},
		}
		this.data.sessions.set(session.id, session)
		return session
	}

	closeSession(sessionId: string): void {
		const session = this.data.sessions.get(sessionId)
		if (session) {
			session.endedAt = Date.now()
			session.status = "closed"
		}
	}

	getSession(sessionId: string): TerminalSession | undefined {
		return this.data.sessions.get(sessionId)
	}

	getSessions(workspaceId?: string): TerminalSession[] {
		const all = Array.from(this.data.sessions.values())
		if (workspaceId) {
			return all.filter((s) => s.workspaceId === workspaceId)
		}
		return all.sort((a, b) => b.startedAt - a.startedAt)
	}

	// ─── Commands ───────────────────────────────────────────────────────

	recordCommand(sessionId: string, command: string): TerminalCommandRecord {
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
		this.data.commands.set(record.id, record)
		return record
	}

	completeCommand(
		commandId: string,
		exitCode: number,
		outputSummary: string,
		errorSummary: string | null,
		filesChanged: string[],
	): void {
		const record = this.data.commands.get(commandId)
		if (record) {
			record.exitCode = exitCode
			record.outputSummary = outputSummary.slice(0, 500)
			record.errorSummary = errorSummary
			record.filesChanged = filesChanged
			record.finishedAt = Date.now()
			record.durationMs = record.finishedAt - record.startedAt
		}
	}

	getCommands(sessionId?: string): TerminalCommandRecord[] {
		const all = Array.from(this.data.commands.values())
		if (sessionId) {
			return all.filter((c) => c.sessionId === sessionId)
		}
		return all.sort((a, b) => b.startedAt - a.startedAt)
	}

	getLastCommand(sessionId: string): TerminalCommandRecord | undefined {
		const commands = this.getCommands(sessionId)
		return commands.length > 0 ? commands[0] : undefined
	}

	// ─── Errors ─────────────────────────────────────────────────────────

	recordError(
		commandId: string,
		errorType: ErrorType,
		errorMessage: string,
		rootCause: string,
		relatedFiles: string[],
		fixSuggested: string | null,
	): TerminalErrorRecord {
		const record: TerminalErrorRecord = {
			id: `te-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			commandId,
			errorType,
			errorMessage: errorMessage.slice(0, 500),
			rootCause,
			relatedFiles,
			fixSuggested,
			fixApplied: false,
			fixSucceeded: false,
			createdAt: Date.now(),
		}
		this.data.errors.set(record.id, record)
		return record
	}

	markFixApplied(errorId: string, succeeded: boolean): void {
		const record = this.data.errors.get(errorId)
		if (record) {
			record.fixApplied = true
			record.fixSucceeded = succeeded
		}
	}

	getErrors(commandId?: string): TerminalErrorRecord[] {
		const all = Array.from(this.data.errors.values())
		if (commandId) {
			return all.filter((e) => e.commandId === commandId)
		}
		return all.sort((a, b) => b.createdAt - a.createdAt)
	}

	getRecentErrors(limit = 10): TerminalErrorRecord[] {
		return this.getErrors().slice(0, limit)
	}

	// ─── Fixes ──────────────────────────────────────────────────────────

	recordFix(
		errorId: string,
		summary: string,
		filesChanged: string[],
		patch: string,
		result: AgentFixRecord["result"],
	): AgentFixRecord {
		const record: AgentFixRecord = {
			id: `tf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			errorId,
			summary,
			filesChanged,
			patch,
			result,
			createdAt: Date.now(),
		}
		this.data.fixes.set(record.id, record)
		return record
	}

	getFixes(errorId?: string): AgentFixRecord[] {
		const all = Array.from(this.data.fixes.values())
		if (errorId) {
			return all.filter((f) => f.errorId === errorId)
		}
		return all.sort((a, b) => b.createdAt - a.createdAt)
	}

	// ─── Deployments ────────────────────────────────────────────────────

	recordDeployment(
		version: string,
		commitSha: string,
		status: DeploymentLogRecord["status"],
	): DeploymentLogRecord {
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
		this.data.deployments.set(record.id, record)
		return record
	}

	updateDeploymentStatus(deployId: string, status: DeploymentLogRecord["status"], logs?: string): void {
		const record = this.data.deployments.get(deployId)
		if (record) {
			record.status = status
			if (logs) record.logs = logs
			if (status === "healthy" || status === "failed" || status === "rolled_back") {
				record.finishedAt = Date.now()
			}
		}
	}

	getDeployments(): DeploymentLogRecord[] {
		return Array.from(this.data.deployments.values()).sort((a, b) => b.createdAt - a.createdAt)
	}

	// ─── Serialization ──────────────────────────────────────────────────

	toJSON(): string {
		return JSON.stringify({
			sessions: Array.from(this.data.sessions.values()),
			commands: Array.from(this.data.commands.values()),
			errors: Array.from(this.data.errors.values()),
			fixes: Array.from(this.data.fixes.values()),
			deployments: Array.from(this.data.deployments.values()),
		})
	}

	fromJSON(json: string): void {
		try {
			const data = JSON.parse(json)
			if (data.sessions) data.sessions.forEach((s: TerminalSession) => this.data.sessions.set(s.id, s))
			if (data.commands) data.commands.forEach((c: TerminalCommandRecord) => this.data.commands.set(c.id, c))
			if (data.errors) data.errors.forEach((e: TerminalErrorRecord) => this.data.errors.set(e.id, e))
			if (data.fixes) data.fixes.forEach((f: AgentFixRecord) => this.data.fixes.set(f.id, f))
			if (data.deployments) data.deployments.forEach((d: DeploymentLogRecord) => this.data.deployments.set(d.id, d))
		} catch {
			// Invalid JSON — start fresh
		}
	}

	// ─── Stats ──────────────────────────────────────────────────────────

	getStats(): {
		totalSessions: number
		totalCommands: number
		totalErrors: number
		totalFixes: number
		totalDeployments: number
		successRate: number
	} {
		const commands = Array.from(this.data.commands.values())
		const succeeded = commands.filter((c) => c.exitCode === 0).length
		const total = commands.length

		return {
			totalSessions: this.data.sessions.size,
			totalCommands: total,
			totalErrors: this.data.errors.size,
			totalFixes: this.data.fixes.size,
			totalDeployments: this.data.deployments.size,
			successRate: total > 0 ? Math.round((succeeded / total) * 100) : 100,
		}
	}
}

// ─── Singleton ───────────────────────────────────────────────────────────

let _instance: TerminalMemory | null = null

export function getTerminalMemory(): TerminalMemory {
	if (!_instance) {
		_instance = new TerminalMemory()
	}
	return _instance
}

export function resetTerminalMemory(): void {
	_instance = new TerminalMemory()
}
