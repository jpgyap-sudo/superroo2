"use client"

import { createContext, useContext, useReducer, useEffect, useCallback, type ReactNode, type Dispatch } from "react"

// ── Helpers ──────────────────────────────────────────────────────────────

function getScrollbackLimit(): number {
	try {
		const saved = localStorage.getItem("superroo-settings")
		if (saved) {
			const parsed = JSON.parse(saved)
			const limit = parseInt(parsed["terminal.scrollback"], 10)
			return isNaN(limit) ? 5000 : Math.max(100, Math.min(50000, limit))
		}
	} catch {}
	return 5000
}

function trimOutputBlocks(blocks: OutputBlock[]): OutputBlock[] {
	const limit = getScrollbackLimit()
	if (blocks.length > limit) {
		return blocks.slice(blocks.length - limit)
	}
	return blocks
}

// ─── Types ────────────────────────────────────────────────────────────────

export interface WorkspaceFile {
	path: string
	name: string
	kind: "file" | "folder"
	modified?: boolean
	children?: WorkspaceFile[]
}

export interface PipelineStep {
	id: string
	label: string
	status: "pending" | "running" | "done" | "approval" | "blocked" | "failed"
	agent?: string
	duration?: string
}

export interface ChatAttachment {
	id: string
	filename: string
	type: string
	size: string
}

export interface ChatMessage {
	id: string
	role: "user" | "assistant" | "agent" | "system"
	author: string
	meta?: string
	time: string
	content: string
	attachments?: ChatAttachment[]
}

export interface OutputBlock {
	id: string
	type: "command" | "output" | "error" | "warning" | "success" | "info" | "agent" | "divider"
	content: string
	command?: string
	timestamp: string
	collapsed?: boolean
}

export interface TerminalRecording {
	id: string
	name: string
	blocks: OutputBlock[]
	commandCount: number
	duration: string
	createdAt: string
}

export interface WorkspaceStatus {
	connected: boolean
	docker: boolean
	redis: boolean
	cpu: string
	ram: string
}

export interface OpenFile {
	path: string
	name: string
	content: string
	language: string
	modified?: boolean
}

export interface WorkspaceTask {
	id: string
	title: string
	status: "pending" | "done" | "failed"
	createdAt: string
}

export interface RecentWorkspace {
	name: string
	path: string
	lastOpened: string
}

export interface TerminalSession {
	id: string
	output: string[]
	createdAt: string
}

// #3: Terminal Session Persistence
export interface PersistedTerminalSession {
	id: string
	name: string
	outputBlocks: OutputBlock[]
	createdAt: string
	lastActivity: string
	commandCount: number
}

// #4: Split Terminal Panels
export interface SplitTerminalTab {
	id: string
	name: string
	sessionId: string
	outputBlocks: OutputBlock[]
	terminalInput: string
	recentCommands: string[]
	isRecording: boolean
	recordingBlocks: OutputBlock[]
}

// #9: Terminal Bell/Notification
export interface TerminalNotification {
	id: string
	message: string
	type: "info" | "success" | "error"
	timestamp: string
	dismissed: boolean
}

// #10: Command Bookmarking/Snippets
export interface CommandSnippet {
	id: string
	name: string
	command: string
	description: string
	category: string
	createdAt: string
	pinned: boolean
}

// #11: Terminal Sharing
export interface SharedTerminalSession {
	id: string
	shareId: string
	createdAt: string
	expiresAt: string
	blocks: OutputBlock[]
	sharedBy: string
}

// #12: Terminal CPU/Memory Usage
export interface TerminalResourceUsage {
	cpu: number
	memory: number
	processCount: number
	uptime: number
}

// ─── State ────────────────────────────────────────────────────────────────

export interface IdeState {
	// Chat
	aiMessages: ChatMessage[]
	aiInput: string
	aiSending: boolean
	aiAttachments: ChatAttachment[]
	aiTab: string
	proactiveSuggestions: string[]

	// Terminal
	terminalInput: string
	outputBlocks: OutputBlock[]
	collapsedBlocks: Set<string>
	recentCommands: string[]
	recordings: TerminalRecording[]
	isRecording: boolean
	recordingBlocks: OutputBlock[]
	showRecordings: boolean

	// #1: PTY/Shell Integration
	ptySessionId: string | null
	ptyConnected: boolean
	ptyShell: string | null
	ptyCwd: string | null

	// #3: Terminal Session Persistence
	persistedSessions: PersistedTerminalSession[]

	// #4: Split Terminal Panels
	splitTerminals: SplitTerminalTab[]
	activeSplitTerminal: string | null

	// #6: Terminal Output Search
	terminalSearchQuery: string
	terminalSearchResults: number[]
	terminalSearchActiveIndex: number

	// #9: Terminal Bell/Notification
	terminalNotifications: TerminalNotification[]

	// #10: Command Bookmarking/Snippets
	commandSnippets: CommandSnippet[]
	showSnippetsPanel: boolean

	// #11: Terminal Sharing
	sharedSessions: SharedTerminalSession[]
	showShareDialog: boolean

	// #12: Terminal Resource Usage
	terminalResources: TerminalResourceUsage | null

	// Terminal Theme & Accessibility
	terminalTheme: "dark" | "light" | "high-contrast"
	terminalFontSize: number

	// Inline Error Fixes
	fixableErrors: Map<
		string,
		{ lineIndex: number; lineText: string; errorType: string; fixSuggestion: string | null }[]
	>

	// Files
	files: WorkspaceFile[]
	openFiles: OpenFile[]
	activeFilePath: string | null
	fileSearchQuery: string
	showFileSearch: boolean

	// Pipeline
	pipeline: PipelineStep[]

	// Status
	status: WorkspaceStatus
	repoName: string
	branch: string
	loading: boolean

	// UI
	showFilePanel: boolean
	showAiPanel: boolean
	showTerminal: boolean
	terminalHeight: number
	isTerminalMaximized: boolean
	showShortcuts: boolean
	showImportGithub: boolean
	showOpenWorkspace: boolean
	showDiffView: boolean
	showSlashCommands: boolean
	showAgentSuggestions: boolean
	showSmartSuggestions: boolean
	showInlineAiButton: boolean
	showQuickActions: string | null

	// Workspace
	recentWorkspaces: RecentWorkspace[]
	workspaceTasks: WorkspaceTask[]

	// Dashboard extras
	hermesStats: any
	deployments: any[]

	// Hydration
	_hydrated: boolean
}

const STORAGE_KEY = "superroo-ide-state"

const initialState: IdeState = {
	aiMessages: [],
	aiInput: "",
	aiSending: false,
	aiAttachments: [],
	aiTab: "chat",
	proactiveSuggestions: [],

	terminalInput: "",
	outputBlocks: toOutputBlocks([
		"Welcome to SuperRoo IDE Terminal",
		"Type a command to get started...",
		"",
		"╔══════════════════════════════════════════════╗",
		"║  Agent Mode: Prefix commands with / or @    ║",
		"║  /help — Show all agent commands            ║",
		"║  /skills — List available skills            ║",
		"║  /deploy — Deploy the project               ║",
		"║  /orchestrate — Break down complex tasks    ║",
		"║  @coder <task> — Delegate to Coder agent    ║",
		"╚══════════════════════════════════════════════╝",
		"",
	]),
	collapsedBlocks: new Set(),
	recentCommands: [],
	recordings: [],
	isRecording: false,
	recordingBlocks: [],
	showRecordings: false,

	// #1: PTY
	ptySessionId: null,
	ptyConnected: false,
	ptyShell: null,
	ptyCwd: null,

	// #3: Persisted sessions
	persistedSessions: [],

	// #4: Split terminals
	splitTerminals: [],
	activeSplitTerminal: null,

	// #6: Terminal search
	terminalSearchQuery: "",
	terminalSearchResults: [],
	terminalSearchActiveIndex: -1,

	// #9: Notifications
	terminalNotifications: [],

	// #10: Snippets
	commandSnippets: [],
	showSnippetsPanel: false,

	// #11: Sharing
	sharedSessions: [],
	showShareDialog: false,

	// #12: Resources
	terminalResources: null,

	// Terminal Theme & Accessibility
	terminalTheme: "dark",
	terminalFontSize: 12,

	// Inline Error Fixes
	fixableErrors: new Map(),

	files: [],
	openFiles: [],
	activeFilePath: null,
	fileSearchQuery: "",
	showFileSearch: false,

	pipeline: [],

	status: {
		connected: true,
		docker: false,
		redis: false,
		cpu: "0%",
		ram: "0MB",
	},
	repoName: "superroo2",
	branch: "auto-improvement",
	loading: true,

	showFilePanel: true,
	showAiPanel: true,
	showTerminal: true,
	terminalHeight: 180,
	isTerminalMaximized: false,
	showShortcuts: false,
	showImportGithub: false,
	showOpenWorkspace: false,
	showDiffView: false,
	showSlashCommands: false,
	showAgentSuggestions: false,
	showSmartSuggestions: false,
	showInlineAiButton: false,
	showQuickActions: null,

	recentWorkspaces: [],
	workspaceTasks: [],

	hermesStats: null,
	deployments: [],

	_hydrated: false,
}

function toOutputBlocks(lines: string[], startIndex = 0): OutputBlock[] {
	return lines.map((line, offset) => {
		const trimmed = line.trim()
		let type: OutputBlock["type"] = "info"

		if (trimmed.startsWith("$ ")) {
			type = "command"
		} else if (/error|failed|exception|traceback|errno/i.test(trimmed)) {
			type = "error"
		} else if (/warning|warn/i.test(trimmed)) {
			type = "warning"
		} else if (/success|done|compiled|passed/i.test(trimmed)) {
			type = "success"
		}

		return {
			id: `block-${Date.now()}-${startIndex + offset}`,
			type,
			content: line,
			timestamp: new Date().toISOString(),
			collapsed: false,
		}
	})
}

function toTerminalLines(blocks: OutputBlock[]): string[] {
	return blocks.map((block) => block.content)
}

// ─── Actions ──────────────────────────────────────────────────────────────

export type IdeAction =
	| { type: "HYDRATE"; payload: Partial<IdeState> }
	| { type: "SET_AI_MESSAGES"; payload: ChatMessage[] }
	| { type: "ADD_AI_MESSAGE"; payload: ChatMessage }
	| { type: "UPDATE_LAST_AI_MESSAGE"; payload: Partial<ChatMessage> }
	| { type: "SET_AI_INPUT"; payload: string }
	| { type: "SET_AI_SENDING"; payload: boolean }
	| { type: "SET_AI_ATTACHMENTS"; payload: ChatAttachment[] }
	| { type: "ADD_AI_ATTACHMENT"; payload: ChatAttachment }
	| { type: "SET_AI_TAB"; payload: string }
	| { type: "SET_PROACTIVE_SUGGESTIONS"; payload: string[] }
	| { type: "SET_TERMINAL_INPUT"; payload: string }
	| { type: "SET_TERMINAL_OUTPUT"; payload: string[] }
	| { type: "APPEND_TERMINAL_OUTPUT"; payload: string[] }
	| { type: "SET_OUTPUT_BLOCKS"; payload: OutputBlock[] }
	| { type: "SET_COLLAPSED_BLOCKS"; payload: Set<string> }
	| { type: "SET_RECENT_COMMANDS"; payload: string[] }
	| { type: "SET_RECORDINGS"; payload: TerminalRecording[] }
	| { type: "SET_IS_RECORDING"; payload: boolean }
	| { type: "SET_RECORDING_BLOCKS"; payload: OutputBlock[] }
	| { type: "SET_SHOW_RECORDINGS"; payload: boolean }
	// #1: PTY
	| { type: "SET_PTY_SESSION_ID"; payload: string | null }
	| { type: "SET_PTY_CONNECTED"; payload: boolean }
	| { type: "SET_PTY_SHELL"; payload: string | null }
	| { type: "SET_PTY_CWD"; payload: string | null }
	// #3: Persisted sessions
	| { type: "SET_PERSISTED_SESSIONS"; payload: PersistedTerminalSession[] }
	| { type: "ADD_PERSISTED_SESSION"; payload: PersistedTerminalSession }
	| { type: "REMOVE_PERSISTED_SESSION"; payload: string }
	// #4: Split terminals
	| { type: "SET_SPLIT_TERMINALS"; payload: SplitTerminalTab[] }
	| { type: "ADD_SPLIT_TERMINAL"; payload: SplitTerminalTab }
	| { type: "REMOVE_SPLIT_TERMINAL"; payload: string }
	| { type: "SET_ACTIVE_SPLIT_TERMINAL"; payload: string | null }
	| { type: "UPDATE_SPLIT_TERMINAL"; payload: { id: string; changes: Partial<SplitTerminalTab> } }
	// #6: Terminal search
	| { type: "SET_TERMINAL_SEARCH_QUERY"; payload: string }
	| { type: "SET_TERMINAL_SEARCH_RESULTS"; payload: number[] }
	| { type: "SET_TERMINAL_SEARCH_ACTIVE_INDEX"; payload: number }
	// #9: Notifications
	| { type: "SET_TERMINAL_NOTIFICATIONS"; payload: TerminalNotification[] }
	| { type: "ADD_TERMINAL_NOTIFICATION"; payload: TerminalNotification }
	| { type: "DISMISS_TERMINAL_NOTIFICATION"; payload: string }
	// #10: Snippets
	| { type: "SET_COMMAND_SNIPPETS"; payload: CommandSnippet[] }
	| { type: "ADD_COMMAND_SNIPPET"; payload: CommandSnippet }
	| { type: "REMOVE_COMMAND_SNIPPET"; payload: string }
	| { type: "SET_SHOW_SNIPPETS_PANEL"; payload: boolean }
	// #11: Sharing
	| { type: "SET_SHARED_SESSIONS"; payload: SharedTerminalSession[] }
	| { type: "SET_SHOW_SHARE_DIALOG"; payload: boolean }
	// #12: Resources
	| { type: "SET_TERMINAL_RESOURCES"; payload: TerminalResourceUsage | null }
	| { type: "SET_FILES"; payload: WorkspaceFile[] }
	| { type: "SET_OPEN_FILES"; payload: OpenFile[] }
	| { type: "SET_ACTIVE_FILE_PATH"; payload: string | null }
	| { type: "SET_FILE_SEARCH_QUERY"; payload: string }
	| { type: "SET_SHOW_FILE_SEARCH"; payload: boolean }
	| { type: "SET_PIPELINE"; payload: PipelineStep[] }
	| { type: "SET_STATUS"; payload: WorkspaceStatus }
	| { type: "SET_REPO_NAME"; payload: string }
	| { type: "SET_BRANCH"; payload: string }
	| { type: "SET_LOADING"; payload: boolean }
	| { type: "SET_SHOW_FILE_PANEL"; payload: boolean }
	| { type: "SET_SHOW_AI_PANEL"; payload: boolean }
	| { type: "SET_SHOW_TERMINAL"; payload: boolean }
	| { type: "SET_TERMINAL_HEIGHT"; payload: number }
	| { type: "SET_IS_TERMINAL_MAXIMIZED"; payload: boolean }
	| { type: "SET_SHOW_SHORTCUTS"; payload: boolean }
	| { type: "SET_SHOW_IMPORT_GITHUB"; payload: boolean }
	| { type: "SET_SHOW_OPEN_WORKSPACE"; payload: boolean }
	| { type: "SET_SHOW_DIFF_VIEW"; payload: boolean }
	| { type: "SET_SHOW_SLASH_COMMANDS"; payload: boolean }
	| { type: "SET_SHOW_AGENT_SUGGESTIONS"; payload: boolean }
	| { type: "SET_SHOW_SMART_SUGGESTIONS"; payload: boolean }
	| { type: "SET_SHOW_INLINE_AI_BUTTON"; payload: boolean }
	| { type: "SET_SHOW_QUICK_ACTIONS"; payload: string | null }
	| { type: "SET_RECENT_WORKSPACES"; payload: RecentWorkspace[] }
	| { type: "SET_WORKSPACE_TASKS"; payload: WorkspaceTask[] }
	| { type: "SET_HERMES_STATS"; payload: any }
	| { type: "SET_DEPLOYMENTS"; payload: any[] }
	| { type: "SET_TERMINAL_THEME"; payload: "dark" | "light" | "high-contrast" }
	| { type: "SET_TERMINAL_FONT_SIZE"; payload: number }
	| {
			type: "SET_FIXABLE_ERRORS"
			payload: {
				blockId: string
				errors: { lineIndex: number; lineText: string; errorType: string; fixSuggestion: string | null }[]
			}
	  }

// ─── Reducer ──────────────────────────────────────────────────────────────

function ideReducer(state: IdeState, action: IdeAction): IdeState {
	switch (action.type) {
		case "HYDRATE": {
			const payload = action.payload || {}
			const legacyTerminalOutput = (payload as Partial<IdeState> & { terminalOutput?: string[] }).terminalOutput
			return {
				...state,
				...payload,
				outputBlocks:
					payload.outputBlocks ||
					(Array.isArray(legacyTerminalOutput) ? toOutputBlocks(legacyTerminalOutput) : state.outputBlocks),
				collapsedBlocks:
					payload.collapsedBlocks instanceof Set ? payload.collapsedBlocks : state.collapsedBlocks,
				_hydrated: true,
			}
		}
		case "SET_AI_MESSAGES":
			return { ...state, aiMessages: action.payload }
		case "ADD_AI_MESSAGE":
			return { ...state, aiMessages: [...state.aiMessages, action.payload] }
		case "UPDATE_LAST_AI_MESSAGE":
			return {
				...state,
				aiMessages: state.aiMessages.map((m, i) =>
					i === state.aiMessages.length - 1 ? { ...m, ...action.payload } : m,
				),
			}
		case "SET_AI_INPUT":
			return { ...state, aiInput: action.payload }
		case "SET_AI_SENDING":
			return { ...state, aiSending: action.payload }
		case "SET_AI_ATTACHMENTS":
			return { ...state, aiAttachments: action.payload }
		case "ADD_AI_ATTACHMENT":
			return { ...state, aiAttachments: [...state.aiAttachments, action.payload] }
		case "SET_AI_TAB":
			return { ...state, aiTab: action.payload }
		case "SET_PROACTIVE_SUGGESTIONS":
			return { ...state, proactiveSuggestions: action.payload }
		case "SET_TERMINAL_INPUT":
			return { ...state, terminalInput: action.payload }
		case "SET_TERMINAL_OUTPUT":
			return { ...state, outputBlocks: toOutputBlocks(action.payload) }
		case "APPEND_TERMINAL_OUTPUT":
			return {
				...state,
				outputBlocks: trimOutputBlocks([
					...state.outputBlocks,
					...toOutputBlocks(action.payload, state.outputBlocks.length),
				]),
			}
		case "SET_OUTPUT_BLOCKS":
			return { ...state, outputBlocks: action.payload }
		case "SET_COLLAPSED_BLOCKS":
			return { ...state, collapsedBlocks: action.payload }
		case "SET_RECENT_COMMANDS":
			return { ...state, recentCommands: action.payload }
		case "SET_RECORDINGS":
			return { ...state, recordings: action.payload }
		case "SET_IS_RECORDING":
			return { ...state, isRecording: action.payload }
		case "SET_RECORDING_BLOCKS":
			return { ...state, recordingBlocks: action.payload }
		case "SET_SHOW_RECORDINGS":
			return { ...state, showRecordings: action.payload }
		// #1: PTY
		case "SET_PTY_SESSION_ID":
			return { ...state, ptySessionId: action.payload }
		case "SET_PTY_CONNECTED":
			return { ...state, ptyConnected: action.payload }
		case "SET_PTY_SHELL":
			return { ...state, ptyShell: action.payload }
		case "SET_PTY_CWD":
			return { ...state, ptyCwd: action.payload }
		// #3: Persisted sessions
		case "SET_PERSISTED_SESSIONS":
			return { ...state, persistedSessions: action.payload }
		case "ADD_PERSISTED_SESSION":
			return { ...state, persistedSessions: [...state.persistedSessions, action.payload] }
		case "REMOVE_PERSISTED_SESSION":
			return { ...state, persistedSessions: state.persistedSessions.filter((s) => s.id !== action.payload) }
		// #4: Split terminals
		case "SET_SPLIT_TERMINALS":
			return { ...state, splitTerminals: action.payload }
		case "ADD_SPLIT_TERMINAL":
			return { ...state, splitTerminals: [...state.splitTerminals, action.payload] }
		case "REMOVE_SPLIT_TERMINAL":
			return { ...state, splitTerminals: state.splitTerminals.filter((t) => t.id !== action.payload) }
		case "SET_ACTIVE_SPLIT_TERMINAL":
			return { ...state, activeSplitTerminal: action.payload }
		case "UPDATE_SPLIT_TERMINAL":
			return {
				...state,
				splitTerminals: state.splitTerminals.map((t) =>
					t.id === action.payload.id ? { ...t, ...action.payload.changes } : t,
				),
			}
		// #6: Terminal search
		case "SET_TERMINAL_SEARCH_QUERY":
			return { ...state, terminalSearchQuery: action.payload }
		case "SET_TERMINAL_SEARCH_RESULTS":
			return { ...state, terminalSearchResults: action.payload }
		case "SET_TERMINAL_SEARCH_ACTIVE_INDEX":
			return { ...state, terminalSearchActiveIndex: action.payload }
		// #9: Notifications
		case "SET_TERMINAL_NOTIFICATIONS":
			return { ...state, terminalNotifications: action.payload }
		case "ADD_TERMINAL_NOTIFICATION":
			return { ...state, terminalNotifications: [...state.terminalNotifications, action.payload] }
		case "DISMISS_TERMINAL_NOTIFICATION":
			return {
				...state,
				terminalNotifications: state.terminalNotifications.map((n) =>
					n.id === action.payload ? { ...n, dismissed: true } : n,
				),
			}
		// #10: Snippets
		case "SET_COMMAND_SNIPPETS":
			return { ...state, commandSnippets: action.payload }
		case "ADD_COMMAND_SNIPPET":
			return { ...state, commandSnippets: [...state.commandSnippets, action.payload] }
		case "REMOVE_COMMAND_SNIPPET":
			return { ...state, commandSnippets: state.commandSnippets.filter((s) => s.id !== action.payload) }
		case "SET_SHOW_SNIPPETS_PANEL":
			return { ...state, showSnippetsPanel: action.payload }
		// #11: Sharing
		case "SET_SHARED_SESSIONS":
			return { ...state, sharedSessions: action.payload }
		case "SET_SHOW_SHARE_DIALOG":
			return { ...state, showShareDialog: action.payload }
		// #12: Resources
		case "SET_TERMINAL_RESOURCES":
			return { ...state, terminalResources: action.payload }
		case "SET_FILES":
			return { ...state, files: action.payload }
		case "SET_OPEN_FILES":
			return { ...state, openFiles: action.payload }
		case "SET_ACTIVE_FILE_PATH":
			return { ...state, activeFilePath: action.payload }
		case "SET_FILE_SEARCH_QUERY":
			return { ...state, fileSearchQuery: action.payload }
		case "SET_SHOW_FILE_SEARCH":
			return { ...state, showFileSearch: action.payload }
		case "SET_PIPELINE":
			return { ...state, pipeline: action.payload }
		case "SET_STATUS":
			return { ...state, status: action.payload }
		case "SET_REPO_NAME":
			return { ...state, repoName: action.payload }
		case "SET_BRANCH":
			return { ...state, branch: action.payload }
		case "SET_LOADING":
			return { ...state, loading: action.payload }
		case "SET_SHOW_FILE_PANEL":
			return { ...state, showFilePanel: action.payload }
		case "SET_SHOW_AI_PANEL":
			return { ...state, showAiPanel: action.payload }
		case "SET_SHOW_TERMINAL":
			return { ...state, showTerminal: action.payload }
		case "SET_TERMINAL_HEIGHT":
			return { ...state, terminalHeight: action.payload }
		case "SET_IS_TERMINAL_MAXIMIZED":
			return { ...state, isTerminalMaximized: action.payload }
		case "SET_SHOW_SHORTCUTS":
			return { ...state, showShortcuts: action.payload }
		case "SET_SHOW_IMPORT_GITHUB":
			return { ...state, showImportGithub: action.payload }
		case "SET_SHOW_OPEN_WORKSPACE":
			return { ...state, showOpenWorkspace: action.payload }
		case "SET_SHOW_DIFF_VIEW":
			return { ...state, showDiffView: action.payload }
		case "SET_SHOW_SLASH_COMMANDS":
			return { ...state, showSlashCommands: action.payload }
		case "SET_SHOW_AGENT_SUGGESTIONS":
			return { ...state, showAgentSuggestions: action.payload }
		case "SET_SHOW_SMART_SUGGESTIONS":
			return { ...state, showSmartSuggestions: action.payload }
		case "SET_SHOW_INLINE_AI_BUTTON":
			return { ...state, showInlineAiButton: action.payload }
		case "SET_SHOW_QUICK_ACTIONS":
			return { ...state, showQuickActions: action.payload }
		case "SET_RECENT_WORKSPACES":
			return { ...state, recentWorkspaces: action.payload }
		case "SET_WORKSPACE_TASKS":
			return { ...state, workspaceTasks: action.payload }
		case "SET_HERMES_STATS":
			return { ...state, hermesStats: action.payload }
		case "SET_DEPLOYMENTS":
			return { ...state, deployments: action.payload }
		case "SET_TERMINAL_THEME":
			return { ...state, terminalTheme: action.payload }
		case "SET_TERMINAL_FONT_SIZE":
			return { ...state, terminalFontSize: action.payload }
		case "SET_FIXABLE_ERRORS": {
			const next = new Map(state.fixableErrors)
			next.set(action.payload.blockId, action.payload.errors)
			return { ...state, fixableErrors: next }
		}
		default:
			return state
	}
}

// ─── Serialization helpers ────────────────────────────────────────────────

/** Serialize state to JSON, converting Sets to arrays */
function serialize(state: IdeState): string {
	const { collapsedBlocks, fixableErrors, ...rest } = state
	return JSON.stringify({
		...rest,
		_collapsedBlocks: Array.from(collapsedBlocks),
		_fixableErrors: Array.from(fixableErrors.entries()),
	})
}

/** Deserialize state from JSON, converting arrays back to Sets */
function deserialize(raw: string): Partial<IdeState> {
	try {
		const parsed = JSON.parse(raw)
		if (!parsed || typeof parsed !== "object") return {}
		const { _collapsedBlocks, _fixableErrors, ...rest } = parsed
		return {
			...rest,
			collapsedBlocks: new Set<string>(Array.isArray(_collapsedBlocks) ? _collapsedBlocks : []),
			fixableErrors: new Map<string, any>(Array.isArray(_fixableErrors) ? _fixableErrors : []),
		}
	} catch {
		return {}
	}
}

// ─── Context ──────────────────────────────────────────────────────────────

interface IdeContextValue {
	state: IdeState
	dispatch: Dispatch<IdeAction>
}

const IdeContext = createContext<IdeContextValue | null>(null)

// ─── Provider ─────────────────────────────────────────────────────────────

export function IdeProvider({ children }: { children: ReactNode }) {
	const [state, dispatch] = useReducer(ideReducer, initialState)

	// Hydrate from localStorage on mount (runs once)
	useEffect(() => {
		try {
			const stored = localStorage.getItem(STORAGE_KEY)
			if (stored) {
				const parsed = deserialize(stored)
				dispatch({ type: "HYDRATE", payload: { ...parsed, _hydrated: true } })
			} else {
				dispatch({ type: "HYDRATE", payload: { _hydrated: true } })
			}
		} catch {
			dispatch({ type: "HYDRATE", payload: { _hydrated: true } })
		}
	}, [])

	// Persist to localStorage on every state change (debounced via animation frame)
	useEffect(() => {
		if (!state._hydrated) return
		const timer = requestAnimationFrame(() => {
			try {
				localStorage.setItem(STORAGE_KEY, serialize(state))
			} catch {
				// Storage full or unavailable — silently fail
			}
		})
		return () => cancelAnimationFrame(timer)
	}, [state])

	return <IdeContext.Provider value={{ state, dispatch }}>{children}</IdeContext.Provider>
}

// ─── Hook ─────────────────────────────────────────────────────────────────

export function useIde(): IdeContextValue {
	const ctx = useContext(IdeContext)
	if (!ctx) throw new Error("useIde must be used within an IdeProvider")
	return ctx
}

// ─── Convenience selectors ────────────────────────────────────────────────

export function useAiMessages() {
	const { state } = useIde()
	return state.aiMessages
}

export function useTerminalOutput() {
	const { state } = useIde()
	return toTerminalLines(state.outputBlocks)
}

export function useOpenFiles() {
	const { state } = useIde()
	return state.openFiles
}
