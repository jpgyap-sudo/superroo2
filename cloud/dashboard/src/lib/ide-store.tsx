"use client"

import { createContext, useContext, useReducer, useEffect, useCallback, type ReactNode, type Dispatch } from "react"

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
	terminalOutput: string[]
	outputBlocks: OutputBlock[]
	collapsedBlocks: Set<string>
	recentCommands: string[]
	recordings: TerminalRecording[]
	isRecording: boolean
	recordingBlocks: OutputBlock[]
	showRecordings: boolean

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
	terminalOutput: [
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
	],
	outputBlocks: [],
	collapsedBlocks: new Set(),
	recentCommands: [],
	recordings: [],
	isRecording: false,
	recordingBlocks: [],
	showRecordings: false,

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

// ─── Reducer ──────────────────────────────────────────────────────────────

function ideReducer(state: IdeState, action: IdeAction): IdeState {
	switch (action.type) {
		case "HYDRATE":
			return { ...state, ...action.payload, _hydrated: true }
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
			return { ...state, terminalOutput: action.payload }
		case "APPEND_TERMINAL_OUTPUT":
			return { ...state, terminalOutput: [...state.terminalOutput, ...action.payload] }
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
		default:
			return state
	}
}

// ─── Serialization helpers ────────────────────────────────────────────────

/** Serialize state to JSON, converting Sets to arrays */
function serialize(state: IdeState): string {
	const { collapsedBlocks, ...rest } = state
	return JSON.stringify({
		...rest,
		_collapsedBlocks: Array.from(collapsedBlocks),
	})
}

/** Deserialize state from JSON, converting arrays back to Sets */
function deserialize(raw: string): Partial<IdeState> {
	const parsed = JSON.parse(raw)
	const { _collapsedBlocks, ...rest } = parsed
	return {
		...rest,
		collapsedBlocks: new Set<string>(_collapsedBlocks || []),
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
	return state.terminalOutput
}

export function useOpenFiles() {
	const { state } = useIde()
	return state.openFiles
}
