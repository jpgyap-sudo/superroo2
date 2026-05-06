/**
 * Types for the IDE Workspace / IDE Terminal feature.
 *
 * Mirrors the concepts from the SuperRoo IDE Workspace Package reference
 * and integrates them into the existing SuperRoo backend architecture.
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
}
