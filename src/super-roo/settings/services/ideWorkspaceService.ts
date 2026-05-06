/**
 * IDE Workspace Service
 *
 * Manages workspace file trees, terminal sessions, pipeline state,
 * and AI assistant chat for the IDE Terminal tab.
 *
 * This service mirrors the concepts from the SuperRoo IDE Workspace Package
 * reference and integrates them into the existing SuperRoo backend.
 */

import type { IdeWorkspaceState, WorkspaceFile, TerminalSession, ChatMessage, PipelineStep } from "./ideWorkspaceTypes"

// ─── In-memory state (per-session) ──────────────────────────────────────

const workspaces = new Map<string, IdeWorkspaceState>()

function createInitialState(): IdeWorkspaceState {
	return {
		workspaceId: null,
		repoName: null,
		branch: "main",
		files: [],
		openFiles: [],
		activeFile: null,
		pipeline: [
			{ id: "plan", label: "Plan", status: "pending" },
			{ id: "crawl", label: "Crawl", status: "pending" },
			{ id: "patch", label: "Patch", status: "pending" },
			{ id: "approval", label: "Approval", status: "pending" },
			{ id: "tests", label: "Tests", status: "pending" },
			{ id: "deploy", label: "Deploy", status: "pending" },
		],
		terminalSessions: [
			{
				id: "term-1",
				name: "bash",
				cwd: "/workspace",
				createdAt: new Date().toISOString(),
				output: ["Welcome to SuperRoo IDE Terminal", "Type a command to get started..."],
			},
		],
		activeTerminal: "term-1",
		chatMessages: [],
		status: {
			connected: true,
			docker: false,
			redis: false,
			cpu: "0%",
			ram: "0MB",
		},
	}
}

// ─── Public API ─────────────────────────────────────────────────────────

export function getOrCreateWorkspace(sessionId: string): IdeWorkspaceState {
	if (!workspaces.has(sessionId)) {
		workspaces.set(sessionId, createInitialState())
	}
	return workspaces.get(sessionId)!
}

export function getWorkspace(sessionId: string): IdeWorkspaceState | null {
	return workspaces.get(sessionId) ?? null
}

export function resetWorkspace(sessionId: string): IdeWorkspaceState {
	const state = createInitialState()
	workspaces.set(sessionId, state)
	return state
}

// ─── File Tree ──────────────────────────────────────────────────────────

export function setFileTree(sessionId: string, files: WorkspaceFile[]): IdeWorkspaceState {
	const ws = getOrCreateWorkspace(sessionId)
	ws.files = files
	return ws
}

export function openFile(sessionId: string, filePath: string): IdeWorkspaceState {
	const ws = getOrCreateWorkspace(sessionId)
	if (!ws.openFiles.includes(filePath)) {
		ws.openFiles.push(filePath)
	}
	ws.activeFile = filePath
	return ws
}

export function closeFile(sessionId: string, filePath: string): IdeWorkspaceState {
	const ws = getOrCreateWorkspace(sessionId)
	ws.openFiles = ws.openFiles.filter((f) => f !== filePath)
	if (ws.activeFile === filePath) {
		ws.activeFile = ws.openFiles.length > 0 ? ws.openFiles[ws.openFiles.length - 1] : null
	}
	return ws
}

// ─── Terminal ───────────────────────────────────────────────────────────

export function createTerminalSession(sessionId: string, name = "bash"): TerminalSession {
	const ws = getOrCreateWorkspace(sessionId)
	const term: TerminalSession = {
		id: `term-${Date.now()}`,
		name,
		cwd: "/workspace",
		createdAt: new Date().toISOString(),
		output: [],
	}
	ws.terminalSessions.push(term)
	ws.activeTerminal = term.id
	return term
}

export function appendTerminalOutput(sessionId: string, terminalId: string, line: string): IdeWorkspaceState {
	const ws = getOrCreateWorkspace(sessionId)
	const term = ws.terminalSessions.find((t) => t.id === terminalId)
	if (term) {
		term.output.push(line)
	}
	return ws
}

export function setActiveTerminal(sessionId: string, terminalId: string): IdeWorkspaceState {
	const ws = getOrCreateWorkspace(sessionId)
	ws.activeTerminal = terminalId
	return ws
}

// ─── Chat ───────────────────────────────────────────────────────────────

export function addChatMessage(sessionId: string, message: ChatMessage): IdeWorkspaceState {
	const ws = getOrCreateWorkspace(sessionId)
	ws.chatMessages.push(message)
	return ws
}

// ─── Pipeline ───────────────────────────────────────────────────────────

export function updatePipelineStep(
	sessionId: string,
	stepId: string,
	status: PipelineStep["status"],
): IdeWorkspaceState {
	const ws = getOrCreateWorkspace(sessionId)
	const step = ws.pipeline.find((s) => s.id === stepId)
	if (step) {
		step.status = status
	}
	return ws
}

// ─── Status ─────────────────────────────────────────────────────────────

export function updateStatus(sessionId: string, partial: Partial<IdeWorkspaceState["status"]>): IdeWorkspaceState {
	const ws = getOrCreateWorkspace(sessionId)
	Object.assign(ws.status, partial)
	return ws
}
