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
} from "./types.js"

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

	getActiveSessionForUser(_userId: string): TerminalSession | undefined {
		// In-memory store doesn't track users — return most recent active session
		const all = Array.from(this.data.sessions.values())
		return all.find((s) => s.status === "active")
	}

	getPopularCommands(_workspaceId: string, limit = 10): { command: string; count: number }[] {
		const counts = new Map<string, number>()
		for (const cmd of this.data.commands.values()) {
			counts.set(cmd.command, (counts.get(cmd.command) || 0) + 1)
		}
		return Array.from(counts.entries())
			.map(([command, count]) => ({ command, count }))
			.sort((a, b) => b.count - a.count)
			.slice(0, limit)
	}

	getRecentCommands(_workspaceId: string, limit = 10): { command: string; startedAt: number }[] {
		const seen = new Set<string>()
		const result: { command: string; startedAt: number }[] = []
		for (const cmd of Array.from(this.data.commands.values()).sort((a, b) => b.startedAt - a.startedAt)) {
			if (!seen.has(cmd.command)) {
				seen.add(cmd.command)
				result.push({ command: cmd.command, startedAt: cmd.startedAt })
				if (result.length >= limit) break
			}
		}
		return result
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

	recordDeployment(version: string, commitSha: string, status: DeploymentLogRecord["status"]): DeploymentLogRecord {
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
			if (data.deployments)
				data.deployments.forEach((d: DeploymentLogRecord) => this.data.deployments.set(d.id, d))
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

// ─── Terminal Memory Interface ───────────────────────────────────────────

export interface ITerminalMemory {
	createSession(workspaceId: string, userId?: string): Promise<TerminalSession> | TerminalSession
	closeSession(sessionId: string): Promise<void> | void
	getSession(sessionId: string): Promise<TerminalSession | undefined> | TerminalSession | undefined
	getSessions(workspaceId?: string, userId?: string): Promise<TerminalSession[]> | TerminalSession[]
	getActiveSessionForUser(userId: string): Promise<TerminalSession | undefined> | TerminalSession | undefined

	recordCommand(sessionId: string, command: string): Promise<TerminalCommandRecord> | TerminalCommandRecord
	completeCommand(
		commandId: string,
		exitCode: number,
		outputSummary: string,
		errorSummary: string | null,
		filesChanged: string[],
	): Promise<void> | void
	getCommands(sessionId?: string): Promise<TerminalCommandRecord[]> | TerminalCommandRecord[]
	getLastCommand(sessionId: string): Promise<TerminalCommandRecord | undefined> | TerminalCommandRecord | undefined
	getPopularCommands(
		workspaceId: string,
		limit?: number,
	): Promise<{ command: string; count: number }[]> | { command: string; count: number }[]
	getRecentCommands(
		workspaceId: string,
		limit?: number,
	): Promise<{ command: string; startedAt: number }[]> | { command: string; startedAt: number }[]

	recordError(
		commandId: string,
		errorType: ErrorType,
		errorMessage: string,
		rootCause: string,
		relatedFiles: string[],
		fixSuggested: string | null,
	): Promise<TerminalErrorRecord> | TerminalErrorRecord
	markFixApplied(errorId: string, succeeded: boolean): Promise<void> | void
	getErrors(commandId?: string): Promise<TerminalErrorRecord[]> | TerminalErrorRecord[]
	getRecentErrors(limit?: number): Promise<TerminalErrorRecord[]> | TerminalErrorRecord[]

	recordFix(
		errorId: string,
		summary: string,
		filesChanged: string[],
		patch: string,
		result: AgentFixRecord["result"],
	): Promise<AgentFixRecord> | AgentFixRecord
	getFixes(errorId?: string): Promise<AgentFixRecord[]> | AgentFixRecord[]

	recordDeployment(
		version: string,
		commitSha: string,
		status: DeploymentLogRecord["status"],
	): Promise<DeploymentLogRecord> | DeploymentLogRecord
	updateDeploymentStatus(deployId: string, status: DeploymentLogRecord["status"], logs?: string): Promise<void> | void
	getDeployments(): Promise<DeploymentLogRecord[]> | DeploymentLogRecord[]

	toJSON(): Promise<string> | string
	fromJSON(json: string): Promise<void> | void

	getStats():
		| Promise<{
				totalSessions: number
				totalCommands: number
				totalErrors: number
				totalFixes: number
				totalDeployments: number
				successRate: number
		  }>
		| {
				totalSessions: number
				totalCommands: number
				totalErrors: number
				totalFixes: number
				totalDeployments: number
				successRate: number
		  }
}

// ─── Persistent Terminal Memory (PostgreSQL) ─────────────────────────────

import { PgTerminalStore } from "./db.js"

export class PersistentTerminalMemory implements ITerminalMemory {
	private store: PgTerminalStore

	constructor(store: PgTerminalStore) {
		this.store = store
	}

	createSession(workspaceId: string, userId?: string) {
		return this.store.createSession(workspaceId, userId)
	}
	closeSession(sessionId: string) {
		return this.store.closeSession(sessionId)
	}
	getSession(sessionId: string) {
		return this.store.getSession(sessionId)
	}
	getSessions(workspaceId?: string, userId?: string) {
		return this.store.getSessions(workspaceId, userId)
	}
	getActiveSessionForUser(userId: string) {
		return this.store.getActiveSessionForUser(userId)
	}

	recordCommand(sessionId: string, command: string) {
		return this.store.recordCommand(sessionId, command)
	}
	completeCommand(
		commandId: string,
		exitCode: number,
		outputSummary: string,
		errorSummary: string | null,
		filesChanged: string[],
	) {
		return this.store.completeCommand(commandId, exitCode, outputSummary, errorSummary, filesChanged)
	}
	getCommands(sessionId?: string) {
		return this.store.getCommands(sessionId)
	}
	getLastCommand(sessionId: string) {
		return this.store.getLastCommand(sessionId)
	}
	getPopularCommands(workspaceId: string, limit?: number) {
		return this.store.getPopularCommands(workspaceId, limit)
	}
	getRecentCommands(workspaceId: string, limit?: number) {
		return this.store.getRecentCommands(workspaceId, limit)
	}

	recordError(
		commandId: string,
		errorType: ErrorType,
		errorMessage: string,
		rootCause: string,
		relatedFiles: string[],
		fixSuggested: string | null,
	) {
		return this.store.recordError(commandId, errorType, errorMessage, rootCause, relatedFiles, fixSuggested)
	}
	markFixApplied(errorId: string, succeeded: boolean) {
		return this.store.markFixApplied(errorId, succeeded)
	}
	getErrors(commandId?: string) {
		return this.store.getErrors(commandId)
	}
	getRecentErrors(limit?: number) {
		return this.store.getRecentErrors(limit)
	}

	recordFix(
		errorId: string,
		summary: string,
		filesChanged: string[],
		patch: string,
		result: AgentFixRecord["result"],
	) {
		return this.store.recordFix(errorId, summary, filesChanged, patch, result)
	}
	getFixes(errorId?: string) {
		return this.store.getFixes(errorId)
	}

	recordDeployment(version: string, commitSha: string, status: DeploymentLogRecord["status"]) {
		return this.store.recordDeployment(version, commitSha, status)
	}
	updateDeploymentStatus(deployId: string, status: DeploymentLogRecord["status"], logs?: string) {
		return this.store.updateDeploymentStatus(deployId, status, logs)
	}
	getDeployments() {
		return this.store.getDeployments()
	}

	async toJSON(): Promise<string> {
		const sessions = await this.store.getSessions()
		const commands = await this.store.getCommands()
		const errors = await this.store.getErrors()
		const fixes = await this.store.getFixes()
		const deployments = await this.store.getDeployments()
		return JSON.stringify({ sessions, commands, errors, fixes, deployments })
	}

	async fromJSON(_json: string): Promise<void> {
		// No-op for persistent store — data is already in the DB
	}

	getStats() {
		return this.store.getStats()
	}
}

// ─── Singleton ───────────────────────────────────────────────────────────

let _instance: TerminalMemory | PersistentTerminalMemory | null = null

export function getTerminalMemory(): TerminalMemory {
	if (!_instance) {
		_instance = new TerminalMemory()
	}
	return _instance as TerminalMemory
}

export function getPersistentTerminalMemory(store: PgTerminalStore): PersistentTerminalMemory {
	if (!_instance || !(_instance instanceof PersistentTerminalMemory)) {
		_instance = new PersistentTerminalMemory(store)
	}
	return _instance as PersistentTerminalMemory
}

export function resetTerminalMemory(): void {
	_instance = new TerminalMemory()
}
