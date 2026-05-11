/**
 * Terminal Brain Layer — Core Types
 *
 * Shared types for the smart terminal system: project context,
 * commands, errors, fixes, memory, and UI feedback.
 */

// ─── Project Context ─────────────────────────────────────────────────────

export interface ProjectContext {
	packageManager: "pnpm" | "npm" | "yarn" | "unknown"
	framework: "nextjs" | "vite" | "express" | "angular" | "react" | "unknown"
	hasDocker: boolean
	hasDockerCompose: boolean
	hasEnvExample: boolean
	hasTypeScript: boolean
	scripts: Record<string, string>
	devCommand: string | null
	buildCommand: string | null
	testCommand: string | null
	lintCommand: string | null
	port: number | null
	branch: string
	repoName: string
	workspaceRoot: string
	detectedFiles: string[]
	envVars: string[]
}

// ─── Command Types ───────────────────────────────────────────────────────

export type CommandIntent =
	| "build"
	| "test"
	| "dev"
	| "deploy"
	| "install"
	| "lint"
	| "typecheck"
	| "docker"
	| "git"
	| "file_ops"
	| "unknown"

export interface PlannedCommand {
	id: string
	intent: CommandIntent
	command: string
	description: string
	requiresApproval: boolean
	cwd?: string
	timeout?: number
}

export interface CommandResult {
	commandId: string
	exitCode: number | null
	stdout: string
	stderr: string
	output: string[]
	durationMs: number
	timedOut: boolean
}

// ─── Error Types ─────────────────────────────────────────────────────────

export type ErrorType =
	| "typescript"
	| "missing_env"
	| "dependency"
	| "docker"
	| "port_conflict"
	| "build_failure"
	| "runtime_crash"
	| "git_conflict"
	| "permission"
	| "network"
	| "unknown"

export interface ErrorAnalysis {
	errorType: ErrorType
	errorMessage: string
	rootCause: string
	relatedFiles: string[]
	confidence: number
	fixSuggestion: string | null
}

// ─── Memory Types ────────────────────────────────────────────────────────

export interface TerminalSession {
	id: string
	workspaceId: string
	startedAt: number
	endedAt: number | null
	status: "active" | "closed"
	metadata: Record<string, unknown>
}

export interface TerminalCommandRecord {
	id: string
	sessionId: string
	command: string
	exitCode: number | null
	outputSummary: string
	errorSummary: string | null
	filesChanged: string[]
	startedAt: number
	finishedAt: number | null
	durationMs: number | null
}

export interface TerminalErrorRecord {
	id: string
	commandId: string
	errorType: ErrorType
	errorMessage: string
	rootCause: string
	relatedFiles: string[]
	fixSuggested: string | null
	fixApplied: boolean
	fixSucceeded: boolean
	createdAt: number
}

export interface AgentFixRecord {
	id: string
	errorId: string
	summary: string
	filesChanged: string[]
	patch: string
	result: "success" | "failed" | "rolled_back"
	createdAt: number
}

export interface DeploymentLogRecord {
	id: string
	version: string
	commitSha: string
	status: "deploying" | "healthy" | "unhealthy" | "rolled_back" | "failed"
	checks: string[]
	logs: string
	createdAt: number
	finishedAt: number | null
}

// ─── Safety Types ────────────────────────────────────────────────────────

export interface SafetyDecision {
	allowed: boolean
	reason: string
	requiresApproval: boolean
}

// ─── UI Feedback ─────────────────────────────────────────────────────────

export interface TerminalFeedback {
	plan: string
	command: string
	exitCode: number | null
	output: string
	errors: ErrorAnalysis[]
	fixes: string[]
	verification: string
	status: "success" | "failed" | "needs_approval" | "running"
	memory: {
		sessionId: string
		commandId: string
		errorId: string | null
	}
}

// ─── Agent Router Types ──────────────────────────────────────────────────

export type AgentType = "terminal" | "debugger" | "deployer" | "tester" | "coder" | "orchestrator"

export interface AgentHandoff {
	to: AgentType
	reason: string
	errorSummary: string
	relatedFiles: string[]
	context: Record<string, unknown>
}

// ─── API Types ───────────────────────────────────────────────────────────

export interface TerminalBrainRequest {
	action: "execute" | "plan" | "analyze" | "fix" | "memory" | "context"
	command?: string
	nlQuery?: string
	sessionId?: string
	workspaceId?: string
}

export interface TerminalBrainResponse {
	ok: boolean
	feedback?: TerminalFeedback
	context?: ProjectContext
	memory?: {
		sessions: TerminalSession[]
		commands: TerminalCommandRecord[]
		errors: TerminalErrorRecord[]
		fixes: AgentFixRecord[]
		deployments: DeploymentLogRecord[]
	}
	error?: string
}
