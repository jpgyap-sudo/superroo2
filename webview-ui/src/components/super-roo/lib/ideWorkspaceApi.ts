/**
 * IDE Workspace API Client
 *
 * Provides typed fetch wrappers for all IDE workspace backend endpoints.
 * Types are defined inline to avoid cross-package import issues.
 */

// ── Types (mirrored from backend for frontend use) ──────────────────────────

export interface WorkspaceFile {
	path: string
	name: string
	kind: "folder" | "file"
	modified?: boolean
	children?: WorkspaceFile[]
}

export type PipelineStatus = "done" | "running" | "approval" | "pending" | "blocked"

export interface PipelineStep {
	id: string
	label: string
	agent?: string
	duration?: string
	status: PipelineStatus
}

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

export interface TerminalSession {
	id: string
	name: string
	cwd: string
	createdAt: string
	output: string[]
}

export interface WorkspaceStateResponse {
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

// ── API client ──────────────────────────────────────────────────────────────

const API_BASE = "/api/ide-workspace"

async function json<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(`${API_BASE}${path}`, {
		headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
		...init,
	})
	if (!res.ok) throw new Error(await res.text())
	return res.json()
}

export const ideWorkspaceApi = {
	/** Get or create a workspace session */
	workspace: (sessionId: string) =>
		json<WorkspaceStateResponse>(`/workspace?sessionId=${encodeURIComponent(sessionId)}`),

	/** Reset a workspace session */
	reset: (sessionId: string) =>
		json<WorkspaceStateResponse>(`/workspace/reset?sessionId=${encodeURIComponent(sessionId)}`, {
			method: "POST",
		}),

	/** Set the file tree */
	setFileTree: (sessionId: string, files: WorkspaceFile[]) =>
		json<WorkspaceStateResponse>(`/workspace/files?sessionId=${encodeURIComponent(sessionId)}`, {
			method: "PUT",
			body: JSON.stringify({ files }),
		}),

	/** Open a file */
	openFile: (sessionId: string, filePath: string) =>
		json<WorkspaceStateResponse>(`/workspace/open-file?sessionId=${encodeURIComponent(sessionId)}`, {
			method: "POST",
			body: JSON.stringify({ filePath }),
		}),

	/** Close a file */
	closeFile: (sessionId: string, filePath: string) =>
		json<WorkspaceStateResponse>(`/workspace/close-file?sessionId=${encodeURIComponent(sessionId)}`, {
			method: "POST",
			body: JSON.stringify({ filePath }),
		}),

	/** Send a chat message */
	sendMessage: (sessionId: string, message: ChatMessage) =>
		json<WorkspaceStateResponse>(`/chat?sessionId=${encodeURIComponent(sessionId)}`, {
			method: "POST",
			body: JSON.stringify({ message }),
		}),

	/** Execute a terminal command */
	executeCommand: (sessionId: string, terminalId: string, command: string) =>
		json<WorkspaceStateResponse>(`/terminal/execute?sessionId=${encodeURIComponent(sessionId)}`, {
			method: "POST",
			body: JSON.stringify({ terminalId, command }),
		}),

	/** Create a new terminal session */
	createTerminal: (sessionId: string, name?: string) =>
		json<WorkspaceStateResponse>(`/terminal/create?sessionId=${encodeURIComponent(sessionId)}`, {
			method: "POST",
			body: JSON.stringify({ name: name ?? "bash" }),
		}),

	/** Update pipeline step status */
	updatePipeline: (sessionId: string, stepId: string, status: string) =>
		json<WorkspaceStateResponse>(`/pipeline?sessionId=${encodeURIComponent(sessionId)}`, {
			method: "PATCH",
			body: JSON.stringify({ stepId, status }),
		}),
}
