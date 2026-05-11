/**
 * Types for the IDE Workspace / IDE Terminal feature.
 *
 * Mirrors the concepts from the SuperRoo IDE Workspace Package reference
 * and integrates them into the existing SuperRoo backend architecture.
 * Extended with Terminal Brain Layer types for smart terminal features.
 */

// ─── Workspace File Tree ────────────────────────────────────────────────

export interface WorkspaceFile {
	path: string
	name: string
	kind: "folder" | "file"
	modified?: boolean
	children?: WorkspaceFile[]
}

// ─── Pipeline ───────────────────────────────────────────────────────────

export type PipelineStatus = "done" | "running" | "approval" | "pending" | "blocked"

export interface PipelineStep {
	id: string
	label: string
	agent?: string
	duration?: string
	status: PipelineStatus
}

// ─── Chat / Assistant ───────────────────────────────────────────────────

export type ChatAttachmentType = "LOG" | "PNG" | "TXT" | "PDF" | "YML" | "CODE"

export interface ChatAttachment {
	id: string
	filename: string
	type: ChatAttachmentType
	size: string
}

export interface ChatMessage {
	id: string
	role: "user" | "assistant" | "agent"
	author: string
	meta?: string
	time: string
	content: string
	attachments?: ChatAttachment[]
}

// ─── Terminal ───────────────────────────────────────────────────────────

export interface TerminalSession {
	id: string
	name: string
	cwd: string
	createdAt: string
	output: string[]
}

// ─── Terminal Brain Types ───────────────────────────────────────────────

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

export interface TerminalMemoryData {
	sessions: TerminalSession[]
	commands: TerminalCommandRecord[]
	errors: TerminalErrorRecord[]
	fixes: AgentFixRecord[]
	deployments: DeploymentLogRecord[]
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

// ─── IDE Workspace State ────────────────────────────────────────────────

export interface IdeWorkspaceState {
	workspaceId: string | null
	repoName: string | null
	branch: string
	files: WorkspaceFile[]
	openFiles: string[]
	activeFile: string | null
	pipeline: PipelineStep[]
	terminalSessions: TerminalSession[]
	activeTerminal: string | null
	chatMessages: ChatMessage[]
	status: {
		connected: boolean
		docker: boolean
		redis: boolean
		cpu: string
		ram: string
	}
	// Terminal Brain Layer additions
	projectContext: ProjectContext | null
	terminalFeedback: TerminalFeedback | null
	memory: TerminalMemoryData | null
	activeTab: TerminalTab
}

export type TerminalTab =
	| "terminal"
	| "ai-command"
	| "errors"
	| "fix-plan"
	| "services"
	| "deployments"
	| "environment"
	| "logs"
	| "memory"
	| "approvals"
