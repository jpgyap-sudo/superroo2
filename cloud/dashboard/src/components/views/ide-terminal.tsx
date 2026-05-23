"use client"

import { useState, useCallback, useEffect, useRef, useMemo } from "react"
import {
	Bot,
	Code2,
	Search,
	GitBranch,
	Play,
	Boxes,
	User,
	Settings,
	Terminal,
	FileText,
	Folder,
	Plus,
	Bell,
	Paperclip,
	Image,
	Send,
	Mic,
	Cpu,
	Database,
	UploadCloud,
	ChevronRight,
	CheckCircle2,
	XCircle,
	Clock,
	Loader2,
	AlertTriangle,
	Trash2,
	Wand2,
	Sparkles,
	Brain,
	Zap,
	Copy,
	X,
	Command,
	Keyboard,
	FileSearch,
	Upload,
	RefreshCw,
	MessageSquare,
	Bug,
	Rocket,
	BarChart3,
	Shield,
	Check,
	History,
	PlayCircle,
	StopCircle,
	Timer,
	Bookmark,
	Lightbulb,
	TerminalSquare,
	PanelLeftClose,
	PanelLeft,
	PanelRightClose,
	PanelRight,
	Maximize2,
	Minimize2,
	Github,
	Globe,
	FileCode,
	ExternalLink,
	FolderOpen,
	BookOpen,
	ListTodo,
	Workflow,
	GitPullRequest,
	GitMerge,
	Code,
	Terminal as TerminalIcon,
	FileJson,
	FileType,
	Link,
	Download,
	CheckSquare,
	Square,
	ArrowRight,
	MessageCircle,
	Lightbulb as LightbulbIcon,
	Star,
	Clock3,
	RotateCcw,
	FolderGit2,
	GitFork,
	FilePlus2,
	Terminal as TerminalIcon2,
	Slash,
	List,
	Diff,
	FileOutput,
	Eye,
	Columns,
	Puzzle,
} from "lucide-react"
import {
	useIde,
	type WorkspaceFile,
	type PipelineStep,
	type ChatMessage,
	type OutputBlock,
	type TerminalRecording,
	type WorkspaceStatus,
	type OpenFile,
	type TerminalSession,
	type ChatAttachment,
	type RecentWorkspace,
	type WorkspaceTask,
} from "@/lib/ide-store"
import ErrorBoundary from "@/components/ErrorBoundary"
import FileTree from "@/components/ide-terminal/FileTree"
import CodeEditor from "@/components/ide-terminal/CodeEditor"
import TerminalPanel from "@/components/ide-terminal/TerminalPanel"
import AiChatPanel from "@/components/ide-terminal/AiChatPanel"
import SearchPanel from "@/components/ide-terminal/SearchPanel"
import GitPanel from "@/components/ide-terminal/GitPanel"
import ProblemsPanel from "@/components/ide-terminal/ProblemsPanel"
import SettingsPanel from "@/components/ide-terminal/SettingsPanel"
import ExtensionsPanel from "@/components/ide-terminal/ExtensionsPanel"
import KeyboardShortcutsModal from "@/components/ide-terminal/KeyboardShortcutsModal"
import DiffViewModal from "@/components/ide-terminal/DiffViewModal"
import { useIdeTerminal } from "@/components/ide-terminal/hooks/useIdeTerminal"
import { useExtensionState } from "@/components/ide-terminal/hooks/useExtensionState"
import { fetchWorkspace } from "@/components/ide-terminal/api"
import { getAutocompleteSuggestions } from "@/components/ide-terminal/SmartAutocomplete"
import type { BrainTab } from "@/components/ide-terminal/types"

// ── Pipeline Icon ─────────────────────────────────────────────────────────

function PipelineIcon({ status }: { status: string }) {
	switch (status) {
		case "done":
			return <CheckCircle2 size={10} className="text-green-400" />
		case "running":
			return <Loader2 size={10} className="text-blue-400 animate-spin" />
		case "failed":
			return <XCircle size={10} className="text-red-400" />
		case "approval":
			return <Shield size={10} className="text-yellow-400" />
		case "blocked":
			return <AlertTriangle size={10} className="text-orange-400" />
		default:
			return <Clock size={10} className="text-gray-500" />
	}
}

// ── Main Component ────────────────────────────────────────────────────────

export default function IdeTerminalView() {
	const { state, dispatch } = useIde()
	const {
		aiMessages,
		aiInput,
		aiSending,
		aiAttachments,
		aiTab,
		proactiveSuggestions,
		terminalInput,
		outputBlocks,
		collapsedBlocks,
		recentCommands,
		recordings,
		isRecording,
		recordingBlocks,
		showRecordings,
		files,
		openFiles,
		activeFilePath,
		fileSearchQuery,
		showFileSearch,
		pipeline,
		status,
		repoName,
		branch,
		loading,
		showFilePanel,
		showAiPanel,
		showTerminal,
		terminalHeight,
		isTerminalMaximized,
		showShortcuts,
		showImportGithub,
		showOpenWorkspace,
		showDiffView,
		showSlashCommands,
		showAgentSuggestions,
		showSmartSuggestions,
		showInlineAiButton,
		showQuickActions,
		recentWorkspaces,
		workspaceTasks,
		// Gaps: additional state
		persistedSessions,
		terminalTheme,
		terminalFontSize,
	} = state
	const terminalOutput = outputBlocks.map((block) => block.content)

	// ── All logic extracted into hook ─────────────────────────────────────
	const hook = useIdeTerminal()
	const extensionState = useExtensionState()

	// ── Local state for gaps ──────────────────────────────────────────────
	const [showCommandHistory, setShowCommandHistory] = useState(false)
	const [commandHistoryQuery, setCommandHistoryQuery] = useState("")
	const [showSessionManager, setShowSessionManager] = useState(false)
	const [sessionNameInput, setSessionNameInput] = useState("")
	const [showTemplatePicker, setShowTemplatePicker] = useState(false)
	const [showRecordingPlayback, setShowRecordingPlayback] = useState(false)
	const [showDebugToolbar, setShowDebugToolbar] = useState(false)
	const [showTestRunner, setShowTestRunner] = useState(false)
	const [showGitBlame, setShowGitBlame] = useState(false)
	const [showFileWatcherIndicator, setShowFileWatcherIndicator] = useState(false)
	const [showFormatOnSave, setShowFormatOnSave] = useState(false)
	const [showOrganizeImports, setShowOrganizeImports] = useState(false)
	const [showMultiCursorHint, setShowMultiCursorHint] = useState(false)
	const [showQuickFixLightbulb, setShowQuickFixLightbulb] = useState(false)
	const [showInlineErrors, setShowInlineErrors] = useState(true)
	const [showDocumentSymbols, setShowDocumentSymbols] = useState(false)
	const [showCodeFolding, setShowCodeFolding] = useState(true)
	const [showSemanticTokens, setShowSemanticTokens] = useState(true)
	const [showDragDropHint, setShowDragDropHint] = useState(false)
	const [settingsLoaded, setSettingsLoaded] = useState(false)
	const [showMinimap, setShowMinimap] = useState(true)
	const [showBreadcrumbs, setShowBreadcrumbs] = useState(true)

	// ── Load settings from localStorage on mount ─────────────────────────
	useEffect(() => {
		try {
			const saved = localStorage.getItem("superroo-ide-settings")
			if (saved) {
				const parsed = JSON.parse(saved)
				if (parsed["editor.minimap"] !== undefined) setShowMinimap(parsed["editor.minimap"])
				if (parsed["editor.breadcrumbs"] !== undefined) setShowBreadcrumbs(parsed["editor.breadcrumbs"])
				if (parsed["editor.formatOnSave"] !== undefined) setShowFormatOnSave(parsed["editor.formatOnSave"])
				if (parsed["editor.organizeImportsOnSave"] !== undefined)
					setShowOrganizeImports(parsed["editor.organizeImportsOnSave"])
			}
		} catch {
			/* ignore */
		}
		setSettingsLoaded(true)
	}, [])

	// ── Load workspace from API on mount ─────────────────────────────────
	useEffect(() => {
		if (!state._hydrated) return
		let cancelled = false
		async function loadWorkspace() {
			try {
				const data = await fetchWorkspace()
				if (cancelled) return
				// API returns data directly (no success wrapper); workspaceId confirms a valid response
				if (data.workspaceId) {
					if (data.files) dispatch({ type: "SET_FILES", payload: data.files })
					if (data.repoName) dispatch({ type: "SET_REPO_NAME", payload: data.repoName })
					if (data.branch) dispatch({ type: "SET_BRANCH", payload: data.branch })
					if (data.status) dispatch({ type: "SET_STATUS", payload: { ...state.status, ...data.status } })
					if (data.pipeline) dispatch({ type: "SET_PIPELINE", payload: data.pipeline })
				}
			} catch {
				// silent fallback to local/demo state
			} finally {
				if (!cancelled) dispatch({ type: "SET_LOADING", payload: false })
			}
		}
		loadWorkspace()
		return () => {
			cancelled = true
		}
	}, [state._hydrated, dispatch])

	// Gap #8: Global keyboard shortcuts
	useEffect(() => {
		function handleGlobalKeyDown(e: KeyboardEvent) {
			// Ctrl+` or Ctrl+Shift+P: Toggle terminal panel
			if ((e.ctrlKey || e.metaKey) && e.key === "`") {
				e.preventDefault()
				dispatch({ type: "SET_SHOW_TERMINAL", payload: !showTerminal })
				return
			}
			// Ctrl+B: Toggle file panel (sidebar)
			if ((e.ctrlKey || e.metaKey) && e.key === "b") {
				e.preventDefault()
				dispatch({ type: "SET_SHOW_FILE_PANEL", payload: !showFilePanel })
				return
			}
			// Ctrl+Shift+P: Toggle AI chat panel
			if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "p" || e.key === "P")) {
				e.preventDefault()
				dispatch({ type: "SET_SHOW_AI_PANEL", payload: !showAiPanel })
				return
			}
			// Escape: Close modals / panels
			if (e.key === "Escape") {
				if (showDiffView) {
					dispatch({ type: "SET_SHOW_DIFF_VIEW", payload: false })
					return
				}
				if (showImportGithub) {
					dispatch({ type: "SET_SHOW_IMPORT_GITHUB", payload: false })
					return
				}
				if (showOpenWorkspace) {
					dispatch({ type: "SET_SHOW_OPEN_WORKSPACE", payload: false })
					return
				}
			}
		}
		window.addEventListener("keydown", handleGlobalKeyDown)
		return () => window.removeEventListener("keydown", handleGlobalKeyDown)
	}, [showTerminal, showFilePanel, showAiPanel, showDiffView, showImportGithub, showOpenWorkspace, dispatch])

	// ── Loading state ────────────────────────────────────────────────────
	if (loading) {
		return (
			<div className="flex items-center justify-center h-full bg-[#1e1e1e]">
				<div className="flex flex-col items-center gap-3">
					<Loader2 className="animate-spin text-blue-400" size={32} />
					<span className="text-sm text-gray-400">Loading IDE...</span>
				</div>
			</div>
		)
	}

	// ══════════════════════════════════════════════════════════════════════
	// RENDER
	// ══════════════════════════════════════════════════════════════════════
	return (
		<ErrorBoundary>
			<div className="flex flex-col h-full bg-[#1e1e1e] text-gray-200 overflow-hidden">
				{/* ── Header ─────────────────────────────────────────────── */}
				<header className="flex items-center justify-between px-4 py-2 bg-[#252526] border-b border-[#3c3c3c] shrink-0">
					<div className="flex items-center gap-3">
						<div className="flex items-center gap-2">
							<TerminalIcon2 size={16} className="text-blue-400" />
							<span className="text-sm font-semibold text-gray-100">{repoName || "IDE Terminal"}</span>
						</div>
						{branch && (
							<span className="flex items-center gap-1 px-2 py-0.5 text-xs bg-[#2d2d2d] rounded text-gray-400 border border-[#3c3c3c]">
								<GitBranch size={10} />
								{branch}
							</span>
						)}
						<div className="flex items-center gap-2 text-xs text-gray-500">
							<span className="flex items-center gap-1">
								<Cpu size={10} /> {status.cpu}
							</span>
							<span className="flex items-center gap-1">
								<Database size={10} /> {status.ram}
							</span>
							{/* #2: LSP status indicator */}
							<span
								className={`flex items-center gap-1 ${
									hook.lspConnected ? "text-purple-400" : "text-gray-600"
								}`}>
								<span
									className={`w-1.5 h-1.5 rounded-full ${
										hook.lspConnected ? "bg-purple-400" : "bg-gray-600"
									}`}
								/>
								LSP
							</span>
							{/* #1: PTY status indicator */}
							<span
								className={`flex items-center gap-1 ${
									hook.ptyConnected ? "text-green-400" : "text-gray-600"
								}`}>
								<span
									className={`w-1.5 h-1.5 rounded-full ${
										hook.ptyConnected ? "bg-green-400" : "bg-gray-600"
									}`}
								/>
								PTY
							</span>
							<span
								className={`flex items-center gap-1 ${hook.wsConnected ? "text-green-400" : "text-red-400"}`}>
								<span
									className={`w-1.5 h-1.5 rounded-full ${hook.wsConnected ? "bg-green-400" : "bg-red-400"}`}
								/>
								{hook.wsConnected
									? "Connected"
									: hook.wsReconnecting
										? "Reconnecting..."
										: "Disconnected"}
							</span>
						</div>
					</div>
					<div className="flex items-center gap-1">
						<button
							onClick={() => dispatch({ type: "SET_SHOW_IMPORT_GITHUB", payload: true })}
							className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-gray-200 hover:bg-[#3c3c3c] rounded"
							title="Import from GitHub">
							<Github size={12} /> Import
						</button>
						<button
							onClick={() => dispatch({ type: "SET_SHOW_OPEN_WORKSPACE", payload: true })}
							className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-gray-200 hover:bg-[#3c3c3c] rounded"
							title="Open Workspace">
							<FolderOpen size={12} /> Open
						</button>
						<button
							onClick={() => hook.setShowRecentTasks((v) => !v)}
							className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-gray-200 hover:bg-[#3c3c3c] rounded"
							title="Recent Tasks">
							<ListTodo size={12} /> Tasks
						</button>
						{/* Gap #9: Workspace templates */}
						<button
							onClick={() => setShowTemplatePicker(true)}
							className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-gray-200 hover:bg-[#3c3c3c] rounded"
							title="New from Template">
							<FilePlus2 size={12} /> Template
						</button>
						<button
							onClick={() => dispatch({ type: "SET_SHOW_SHORTCUTS", payload: true })}
							className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-gray-200 hover:bg-[#3c3c3c] rounded"
							title="Keyboard Shortcuts">
							<Keyboard size={12} />
						</button>
						<div className="w-px h-4 bg-[#3c3c3c] mx-1" />
						{/* Gap #6: Debug toolbar toggle */}
						<button
							onClick={() => setShowDebugToolbar((v) => !v)}
							className={`flex items-center gap-1 px-2 py-1 text-xs rounded ${
								showDebugToolbar
									? "bg-[#094771] text-white"
									: "text-gray-400 hover:text-gray-200 hover:bg-[#3c3c3c]"
							}`}
							title="Debug Toolbar">
							<Bug size={12} /> Debug
						</button>
						{/* Gap #7: Test runner toggle */}
						<button
							onClick={() => setShowTestRunner((v) => !v)}
							className={`flex items-center gap-1 px-2 py-1 text-xs rounded ${
								showTestRunner
									? "bg-[#094771] text-white"
									: "text-gray-400 hover:text-gray-200 hover:bg-[#3c3c3c]"
							}`}
							title="Test Runner">
							<PlayCircle size={12} /> Tests
						</button>
						{/* Gap #11: Git blame toggle */}
						<button
							onClick={() => setShowGitBlame((v) => !v)}
							className={`flex items-center gap-1 px-2 py-1 text-xs rounded ${
								showGitBlame
									? "bg-[#094771] text-white"
									: "text-gray-400 hover:text-gray-200 hover:bg-[#3c3c3c]"
							}`}
							title="Toggle Git Blame Annotations">
							<GitBranch size={12} /> Blame
						</button>
						<button
							onClick={() => hook.setShowProblemsPanel((v) => !v)}
							className={`flex items-center gap-1 px-2 py-1 text-xs rounded ${
								hook.showProblemsPanel
									? "bg-[#094771] text-white"
									: "text-gray-400 hover:text-gray-200 hover:bg-[#3c3c3c]"
							}`}
							title="Problems (Ctrl+Shift+M)">
							<AlertTriangle size={12} /> Problems
						</button>
						<button
							onClick={() => hook.setShowSettingsPanel((v) => !v)}
							className={`flex items-center gap-1 px-2 py-1 text-xs rounded ${
								hook.showSettingsPanel
									? "bg-[#094771] text-white"
									: "text-gray-400 hover:text-gray-200 hover:bg-[#3c3c3c]"
							}`}
							title="Settings (Ctrl+,)">
							<Settings size={12} /> Settings
						</button>
						<button
							onClick={() => hook.setShowExtensionsPanel((v) => !v)}
							className={`flex items-center gap-1 px-2 py-1 text-xs rounded ${
								hook.showExtensionsPanel
									? "bg-[#094771] text-white"
									: "text-gray-400 hover:text-gray-200 hover:bg-[#3c3c3c]"
							}`}
							title="Extensions (Ctrl+Shift+X)">
							<Puzzle size={12} /> Extensions
						</button>
					</div>
				</header>

				{/* ── Main Content ───────────────────────────────────────── */}
				<div className="flex flex-1 overflow-hidden">
					{/* ── File Panel ─────────────────────────────────────── */}
					{showFilePanel && (
						<ErrorBoundary>
							<aside className="w-56 shrink-0 border-r border-[#3c3c3c] bg-[#252526] flex flex-col overflow-hidden">
								<div className="flex items-center justify-between px-3 py-2 border-b border-[#3c3c3c]">
									<span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
										Explorer
									</span>
									<div className="flex items-center gap-1">
										<button
											onClick={() => dispatch({ type: "SET_SHOW_FILE_PANEL", payload: false })}
											className="p-0.5 text-gray-500 hover:text-gray-300">
											<PanelLeftClose size={12} />
										</button>
									</div>
								</div>
								<div className="flex-1 overflow-y-auto">
									<FileTree
										items={files}
										activeFilePath={activeFilePath}
										onFileClick={hook.handleFileSelect}
										filter={fileSearchQuery}
									/>
								</div>
							</aside>
						</ErrorBoundary>
					)}

					{/* ── Center: Editor + Terminal ──────────────────────── */}
					<div className="flex-1 flex flex-col overflow-hidden">
						{/* ── Pipeline Bar (#8 enhanced) ──────────────────── */}
						{pipeline.length > 0 && (
							<div className="px-4 py-1.5 bg-[#252526] border-b border-[#3c3c3c] flex items-center gap-2 text-xs overflow-x-auto shrink-0">
								<Workflow size={12} className="text-gray-500 shrink-0" />
								<div className="flex items-center gap-0 flex-1">
									{pipeline.map((step, idx) => (
										<div key={step.id} className="flex items-center gap-0">
											{/* Pipeline step node */}
											<div
												className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border ${
													step.status === "done"
														? "bg-green-900/20 border-green-700/30 text-green-400"
														: step.status === "running"
															? "bg-blue-900/20 border-blue-700/30 text-blue-400"
															: step.status === "failed"
																? "bg-red-900/20 border-red-700/30 text-red-400"
																: step.status === "approval"
																	? "bg-yellow-900/20 border-yellow-700/30 text-yellow-400"
																	: step.status === "blocked"
																		? "bg-orange-900/20 border-orange-700/30 text-orange-400"
																		: "bg-gray-900/20 border-gray-700/30 text-gray-500"
												}`}
												title={`${step.label}${step.duration ? ` (${step.duration})` : ""}`}>
												<PipelineIcon status={step.status} />
												<span className="font-medium">{step.label}</span>
												{step.duration && (
													<span className="opacity-60 ml-0.5">{step.duration}</span>
												)}
											</div>
											{/* Connector line between steps */}
											{idx < pipeline.length - 1 && (
												<div className="flex items-center mx-1">
													<div
														className={`w-4 h-0.5 ${
															step.status === "done"
																? "bg-green-700/50"
																: "bg-gray-700/30"
														}`}
													/>
												</div>
											)}
										</div>
									))}
								</div>
								{/* Pipeline progress summary */}
								{pipeline.length > 0 && (
									<div className="flex items-center gap-1 text-[10px] text-gray-600 shrink-0 ml-auto">
										<span>
											{pipeline.filter((s) => s.status === "done").length}/{pipeline.length} steps
										</span>
									</div>
								)}
							</div>
						)}

						{/* ── Breadcrumbs (Gap #5) ──────────────────────────── */}
						{showBreadcrumbs && activeFilePath && (
							<div className="flex items-center gap-1 px-3 py-1 bg-[#2d2d2d] border-b border-[#3c3c3c] text-[11px] text-gray-400 shrink-0 overflow-x-auto">
								<FileText size={10} className="shrink-0 text-blue-400" />
								{activeFilePath.split("/").map((part, i, arr) => (
									<span key={i} className="flex items-center gap-1 whitespace-nowrap">
										{i > 0 && <ChevronRight size={10} className="text-gray-600" />}
										<span
											className={`hover:text-gray-200 cursor-pointer ${
												i === arr.length - 1 ? "text-gray-200 font-medium" : ""
											}`}
											onClick={() => {
												if (i < arr.length - 1) {
													const dirPath = arr.slice(0, i + 1).join("/")
													hook.handleFileSelect(dirPath)
												}
											}}>
											{part}
										</span>
									</span>
								))}
							</div>
						)}

						{/* ── Code Editor ─────────────────────────────────── */}
						<div className="flex-1 overflow-hidden relative" onMouseUp={hook.handleEditorMouseUp}>
							{activeFilePath ? (
								<ErrorBoundary>
									<CodeEditor
										filePath={activeFilePath}
										value={hook.currentFileContent}
										language={hook.currentFileLanguage}
										readOnly={false}
										onSave={hook.handleFileSave}
										onLspCompletion={hook.onLspCompletion}
										onLspHover={hook.onLspHover}
										onLspDefinition={hook.onLspDefinition}
										onLspReferences={hook.onLspReferences}
										onLspCodeActions={hook.onLspCodeActions}
										onLspOpenDocument={hook.onLspOpenDocument}
										onLspChangeDocument={hook.onLspChangeDocument}
										lspDiagnostics={hook.editorProblems}
									/>
								</ErrorBoundary>
							) : (
								<div className="flex items-center justify-center h-full text-gray-600">
									<div className="text-center">
										<Code2 size={48} className="mx-auto mb-3 opacity-30" />
										<p className="text-sm">Select a file from the explorer to start editing</p>
										<p className="text-xs mt-1">Or use Ctrl+B to toggle the file panel</p>
									</div>
								</div>
							)}

							{/* ── Inline AI Button ────────────────────────── */}
							{showInlineAiButton &&
								hook.inlineSelectionPos &&
								extensionState.isEnabled("superroo.ai-assistant") && (
									<div
										className="absolute z-50 flex items-center gap-1 bg-[#2d2d2d] border border-[#3c3c3c] rounded-md shadow-lg px-1 py-0.5"
										style={{
											top: hook.inlineSelectionPos.top,
											left: hook.inlineSelectionPos.left,
										}}>
										<button
											onClick={() => hook.handleInlineAiAction("fix")}
											className="p-1 text-xs text-gray-400 hover:text-yellow-400 hover:bg-[#3c3c3c] rounded"
											title="Fix">
											<Bug size={12} />
										</button>
										<button
											onClick={() => hook.handleInlineAiAction("explain")}
											className="p-1 text-xs text-gray-400 hover:text-blue-400 hover:bg-[#3c3c3c] rounded"
											title="Explain">
											<MessageCircle size={12} />
										</button>
										<button
											onClick={() => hook.handleInlineAiAction("optimize")}
											className="p-1 text-xs text-gray-400 hover:text-green-400 hover:bg-[#3c3c3c] rounded"
											title="Optimize">
											<Zap size={12} />
										</button>
										<button
											onClick={() => hook.handleInlineAiAction("review")}
											className="p-1 text-xs text-gray-400 hover:text-purple-400 hover:bg-[#3c3c3c] rounded"
											title="Review">
											<Search size={12} />
										</button>
									</div>
								)}
						</div>

						{/* ── Terminal ───────────────────────────────────── */}
						{showTerminal && (
							<ErrorBoundary>
								<div
									ref={hook.terminalResizeRef}
									className="shrink-0 border-t border-[#3c3c3c] bg-[#1e1e1e] flex flex-col"
									style={{ height: isTerminalMaximized ? "50%" : terminalHeight }}>
									<div className="flex items-center justify-between px-3 py-1 bg-[#252526] border-b border-[#3c3c3c] shrink-0">
										<div className="flex items-center gap-2">
											<TerminalIcon size={12} className="text-gray-500" />
											<span className="text-xs text-gray-400 font-medium">Terminal</span>
											<div className="flex items-center gap-1 ml-2">
												{(["shell", "agent", "skill"] as const).map((mode) => (
													<button
														key={mode}
														onClick={() => hook.setTerminalMode(mode)}
														className={`px-1.5 py-0.5 text-[10px] rounded ${
															hook.terminalMode === mode
																? "bg-blue-600 text-white"
																: "text-gray-500 hover:text-gray-300"
														}`}>
														{mode === "shell" ? "SH" : mode === "agent" ? "AG" : "SK"}
													</button>
												))}
											</div>
										</div>
										<div className="flex items-center gap-1">
											{/* Gap #1: Session management */}
											<button
												onClick={() => setShowSessionManager(true)}
												className="p-0.5 text-gray-500 hover:text-gray-300"
												title="Manage Sessions">
												<Bookmark size={12} />
											</button>
											{/* Gap #2: Command history search */}
											<button
												onClick={() => setShowCommandHistory(true)}
												className="p-0.5 text-gray-500 hover:text-gray-300"
												title="Search Command History (Ctrl+R)">
												<History size={12} />
											</button>
											{/* Gap #8: Recording playback */}
											<button
												onClick={() => setShowRecordingPlayback(true)}
												className="p-0.5 text-gray-500 hover:text-gray-300"
												title="Recording Playback">
												<PlayCircle size={12} />
											</button>
											<div className="w-px h-3 bg-[#3c3c3c] mx-0.5" />
											<button
												onClick={() =>
													dispatch({
														type: "SET_IS_TERMINAL_MAXIMIZED",
														payload: !isTerminalMaximized,
													})
												}
												className="p-0.5 text-gray-500 hover:text-gray-300">
												{isTerminalMaximized ? (
													<Minimize2 size={12} />
												) : (
													<Maximize2 size={12} />
												)}
											</button>
											<button
												onClick={() => dispatch({ type: "SET_SHOW_TERMINAL", payload: false })}
												className="p-0.5 text-gray-500 hover:text-gray-300">
												<X size={12} />
											</button>
										</div>
									</div>
									<div className="flex-1 overflow-hidden">
										<TerminalPanel
											outputBlocks={outputBlocks}
											terminalMode={hook.terminalMode}
											terminalInput={terminalInput}
											onTerminalInputChange={(val: string) => {
												dispatch({ type: "SET_TERMINAL_INPUT", payload: val })
												// Wire SmartAutocomplete — compute suggestions as user types
												const suggestions = getAutocompleteSuggestions(val, {
													recentCommands: hook.recentCommands,
													workspaceFiles: (hook.files || []).map((f: any) => ({
														path: f.path || f.name || "",
														name: f.name || f.path || "",
													})),
													branch: hook.branch,
													maxResults: 6,
												})
												hook.setSmartSuggestions(
													suggestions.map((s) => ({ label: s.text, command: s.text })),
												)
											}}
											onTerminalCommand={() => hook.handleTerminalCommand(terminalInput)}
											onTerminalKeyDown={(e: React.KeyboardEvent) => {
												hook.handleTerminalKeyDown(e, terminalInput)
											}}
											onCopyTerminal={(index: number, content: string) => {
												navigator.clipboard.writeText(content)
												hook.setCopiedIndex(index)
												setTimeout(() => hook.setCopiedIndex(null), 2000)
											}}
											onToggleBlockCollapse={(id: string) => {
												const next = new Set(collapsedBlocks)
												next.has(id) ? next.delete(id) : next.add(id)
												dispatch({ type: "SET_COLLAPSED_BLOCKS", payload: next })
											}}
											onClearTerminal={() =>
												dispatch({ type: "SET_TERMINAL_OUTPUT", payload: [] })
											}
											isRecording={isRecording}
											recordings={recordings}
											onStartRecording={() =>
												dispatch({ type: "SET_IS_RECORDING", payload: true })
											}
											onStopRecording={() =>
												dispatch({ type: "SET_IS_RECORDING", payload: false })
											}
											onShowRecordings={() =>
												dispatch({ type: "SET_SHOW_RECORDINGS", payload: true })
											}
											agentSuggestions={hook.agentSuggestions}
											smartSuggestions={hook.smartSuggestions.map((s) => ({
												label: s.label,
												command: s.command,
											}))}
											onSuggestionClick={(cmd: string) => {
												dispatch({ type: "SET_TERMINAL_INPUT", payload: cmd })
											}}
											terminalRef={hook.terminalRef}
											terminalInputRef={hook.terminalInputRef}
											// #1: PTY connection
											ptyConnected={hook.ptyConnected}
											ptySessionId={hook.ptySessionId}
											ptyShell={hook.ptyShell}
											ptyCwd={hook.ptyCwd}
											// #4: Split terminals
											splitTerminals={hook.splitTerminals}
											activeSplitTerminal={hook.activeSplitTerminal}
											onAddSplitTerminal={hook.handleAddSplitTerminal}
											onRemoveSplitTerminal={hook.handleRemoveSplitTerminal}
											onSetActiveSplitTerminal={hook.handleSetActiveSplitTerminal}
											// #6: Terminal search
											terminalSearchQuery={hook.terminalSearchQuery}
											terminalSearchResults={hook.terminalSearchResults}
											terminalSearchActiveIndex={hook.terminalSearchActiveIndex}
											onTerminalSearch={hook.handleTerminalSearch}
											onTerminalSearchNext={hook.handleTerminalSearchNext}
											onTerminalSearchPrev={hook.handleTerminalSearchPrev}
											// #9: Notifications
											notifications={hook.terminalNotifications}
											onDismissNotification={hook.handleDismissNotification}
											// #10: Snippets
											snippets={hook.commandSnippets}
											showSnippetsPanel={hook.showSnippetsPanel}
											onAddSnippet={hook.handleAddSnippet}
											onRemoveSnippet={hook.handleRemoveSnippet}
											onToggleSnippetsPanel={hook.handleToggleSnippetsPanel}
											// #11: Sharing
											showShareDialog={hook.showShareDialog}
											onToggleShareDialog={hook.handleToggleShareDialog}
											onShareSession={hook.handleShareSession}
											// #12: Resource usage
											resourceUsage={hook.terminalResources}
											terminalTheme={state.terminalTheme}
											terminalFontSize={state.terminalFontSize}
											fixableErrors={state.fixableErrors}
											onTriggerInlineFix={(blockId, errorText) => {
												const fixable = state.fixableErrors.get(blockId)
												if (fixable && fixable.length > 0) {
													// Send fix request via WS
													hook.sendMessage({
														type: "chat",
														message: `/fix ${errorText}`,
														context: { errorType: fixable[0].errorType },
													})
												}
											}}
										/>
									</div>
								</div>
							</ErrorBoundary>
						)}
					</div>

					{/* ── AI Chat Panel ──────────────────────────────────── */}
					{showAiPanel && extensionState.isEnabled("superroo.ai-assistant") && (
						<ErrorBoundary>
							<aside className="w-80 shrink-0 border-l border-[#3c3c3c] bg-[#252526] flex flex-col overflow-hidden">
								<div className="flex items-center justify-between px-3 py-2 border-b border-[#3c3c3c]">
									<span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
										AI Chat
									</span>
									<div className="flex items-center gap-1">
										<button
											onClick={() => dispatch({ type: "SET_SHOW_AI_PANEL", payload: false })}
											className="p-0.5 text-gray-500 hover:text-gray-300">
											<PanelRightClose size={12} />
										</button>
									</div>
								</div>
								<div className="flex-1 overflow-hidden">
									<AiChatPanel
										aiMessages={aiMessages}
										aiInput={aiInput}
										onAiInputChange={(val: string) =>
											dispatch({ type: "SET_AI_INPUT", payload: val })
										}
										onAiSend={hook.handleAiSend}
										onAiKeyDown={(e: React.KeyboardEvent) => {
											if (e.key === "Enter" && !e.shiftKey) {
												e.preventDefault()
												hook.handleAiSend()
											}
										}}
										isAiLoading={aiSending}
										canCancel={aiSending}
										onCancelAi={() => {
											if (hook.wsRef.current) {
												hook.wsRef.current.close()
											}
										}}
										aiAttachments={aiAttachments}
										onRemoveAttachment={(index: number) => {
											dispatch({
												type: "SET_AI_ATTACHMENTS",
												payload: aiAttachments.filter((_, i) => i !== index),
											})
										}}
										onFilesClick={() => hook.fileInputRef.current?.click()}
										onImagesClick={() => hook.imageInputRef.current?.click()}
										activeBrainTab={aiTab as BrainTab}
										onBrainTabChange={(tab: BrainTab) =>
											dispatch({ type: "SET_AI_TAB", payload: tab })
										}
										brainPlan={hook.brainPlan}
										brainFeedback={hook.brainFeedback ? [hook.brainFeedback] : []}
										brainErrors={hook.brainErrors}
										brainFixes={hook.brainFixes}
										brainMemory={hook.brainMemory}
										brainDeployments={hook.brainDeployments}
										brainApprovals={hook.brainApprovals}
										brainLoading={hook.brainLoading}
										workspaceTasks={workspaceTasks}
										proactiveSuggestions={proactiveSuggestions}
										onSuggestionClick={(suggestion: string) => {
											dispatch({ type: "SET_AI_INPUT", payload: suggestion })
										}}
										// Gap #2, #13: Connection status & rate limit props
										wsConnected={hook.wsConnected}
										wsReconnecting={hook.wsReconnecting}
										pendingAiCount={hook.pendingAiCount}
										aiRateLimitStatus={
											hook.aiRateLimitStatus
												? {
														limited: true,
														retryAfter: hook.aiRateLimitStatus.retryAfterMs,
														message: `Rate limited — ${hook.aiRateLimitStatus.tokens} tokens remaining`,
													}
												: null
										}
										// Gap #4: File save error handling
										onApplyCode={(code: string, language: string) => {
											try {
												// Set content in editor state
												hook.setCurrentFileContent(code)
												// Save to disk
												if (hook.currentFilePath) {
													hook.handleFileSave(code)
													// Show visual feedback in chat
													const feedbackMsg = `✅ Applied code to \`${hook.currentFilePath}\``
													dispatch({
														type: "ADD_AI_MESSAGE",
														payload: {
															id: `apply-${Date.now()}`,
															role: "assistant",
															author: "System",
															time: new Date().toLocaleTimeString([], {
																hour: "2-digit",
																minute: "2-digit",
															}),
															content: feedbackMsg,
														},
													})
												}
											} catch (err) {
												// Gap #4: Show error notification on save failure
												const errorMsg = `❌ Failed to save file: ${err instanceof Error ? err.message : String(err)}`
												dispatch({
													type: "ADD_AI_MESSAGE",
													payload: {
														id: `apply-error-${Date.now()}`,
														role: "assistant",
														author: "System",
														time: new Date().toLocaleTimeString([], {
															hour: "2-digit",
															minute: "2-digit",
														}),
														content: errorMsg,
													},
												})
											}
										}}
										onRunInTerminal={(code: string) => {
											// Set terminal input AND auto-execute
											dispatch({ type: "SET_TERMINAL_INPUT", payload: code })
											hook.handleTerminalCommand(code)
										}}
										onFileLinkClick={(path: string) => {
											hook.handleFileSelect(path)
										}}
										aiMessagesEndRef={hook.aiMessagesEndRef}
										textareaRef={hook.textareaRef}
										slashCommandFilter={hook.slashCommandFilter}
										onClearChat={() => dispatch({ type: "SET_AI_MESSAGES", payload: [] })}
									/>
								</div>
							</aside>
						</ErrorBoundary>
					)}
				</div>

				{/* ── Hidden file inputs ─────────────────────────────────── */}
				<input
					ref={hook.fileInputRef}
					type="file"
					className="hidden"
					multiple
					onChange={(e) => {
						if (e.target.files) hook.handleFilesSelectedFromList(Array.from(e.target.files))
					}}
				/>
				<input
					ref={hook.imageInputRef}
					type="file"
					accept="image/*"
					className="hidden"
					multiple
					onChange={(e) => {
						if (e.target.files) hook.handleFilesSelectedFromList(Array.from(e.target.files))
					}}
				/>

				{/* ── Drag overlay ──────────────────────────────────────── */}
				{hook.dragOver && (
					<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
						<div className="flex flex-col items-center gap-3 p-8 rounded-lg border-2 border-dashed border-blue-400 bg-[#1e1e1e]/90">
							<UploadCloud size={40} className="text-blue-400" />
							<span className="text-sm text-gray-300">Drop files to attach to AI chat</span>
						</div>
					</div>
				)}

				{/* ── Modals ─────────────────────────────────────────────── */}

				{/* Import GitHub Modal */}
				{showImportGithub && (
					<div
						className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
						onClick={() => dispatch({ type: "SET_SHOW_IMPORT_GITHUB", payload: false })}>
						<div
							className="bg-[#252526] border border-[#3c3c3c] rounded-lg p-6 w-96 shadow-xl"
							onClick={(e) => e.stopPropagation()}>
							<h3 className="text-sm font-semibold text-gray-200 mb-4 flex items-center gap-2">
								<Github size={16} /> Import from GitHub
							</h3>
							<input
								type="text"
								placeholder="GitHub URL (e.g. https://github.com/user/repo)"
								value={hook.importGithubUrl}
								onChange={(e) => hook.setImportGithubUrl(e.target.value)}
								className="w-full px-3 py-2 text-sm bg-[#1e1e1e] border border-[#3c3c3c] rounded text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500 mb-2"
							/>
							<input
								type="text"
								placeholder="Branch (default: main)"
								value={hook.importGithubBranch}
								onChange={(e) => hook.setImportGithubBranch(e.target.value)}
								className="w-full px-3 py-2 text-sm bg-[#1e1e1e] border border-[#3c3c3c] rounded text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500 mb-3"
							/>
							{hook.importGithubError && (
								<p className="text-xs text-red-400 mb-2">{hook.importGithubError}</p>
							)}
							<div className="flex justify-end gap-2">
								<button
									onClick={() => dispatch({ type: "SET_SHOW_IMPORT_GITHUB", payload: false })}
									className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200">
									Cancel
								</button>
								<button
									onClick={hook.handleImportGithub}
									disabled={hook.importGithubLoading || !hook.importGithubUrl.trim()}
									className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1">
									{hook.importGithubLoading ? (
										<Loader2 size={12} className="animate-spin" />
									) : (
										<Github size={12} />
									)}
									Import
								</button>
							</div>
						</div>
					</div>
				)}

				{/* Open Workspace Modal */}
				{showOpenWorkspace && (
					<div
						className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
						onClick={() => dispatch({ type: "SET_SHOW_OPEN_WORKSPACE", payload: false })}>
						<div
							className="bg-[#252526] border border-[#3c3c3c] rounded-lg p-6 w-96 shadow-xl"
							onClick={(e) => e.stopPropagation()}>
							<h3 className="text-sm font-semibold text-gray-200 mb-4 flex items-center gap-2">
								<FolderOpen size={16} /> Open Workspace
							</h3>
							<input
								type="text"
								placeholder="Workspace path (e.g. /home/user/project)"
								value={hook.openWorkspacePath}
								onChange={(e) => hook.setOpenWorkspacePath(e.target.value)}
								className="w-full px-3 py-2 text-sm bg-[#1e1e1e] border border-[#3c3c3c] rounded text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500 mb-3"
							/>
							{hook.openWorkspaceError && (
								<p className="text-xs text-red-400 mb-2">{hook.openWorkspaceError}</p>
							)}
							<div className="flex justify-end gap-2">
								<button
									onClick={() => dispatch({ type: "SET_SHOW_OPEN_WORKSPACE", payload: false })}
									className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200">
									Cancel
								</button>
								<button
									onClick={hook.handleOpenWorkspace}
									disabled={hook.openWorkspaceLoading || !hook.openWorkspacePath.trim()}
									className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1">
									{hook.openWorkspaceLoading ? (
										<Loader2 size={12} className="animate-spin" />
									) : (
										<FolderOpen size={12} />
									)}
									Open
								</button>
							</div>
						</div>
					</div>
				)}

				{/* Recent Tasks Modal */}
				{hook.showRecentTasks && (
					<div
						className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
						onClick={() => hook.setShowRecentTasks(false)}>
						<div
							className="bg-[#252526] border border-[#3c3c3c] rounded-lg p-6 w-96 shadow-xl max-h-96 overflow-y-auto"
							onClick={(e) => e.stopPropagation()}>
							<h3 className="text-sm font-semibold text-gray-200 mb-4 flex items-center gap-2">
								<ListTodo size={16} /> Recent Tasks
							</h3>
							{workspaceTasks.length === 0 ? (
								<p className="text-xs text-gray-500">No tasks yet</p>
							) : (
								<div className="space-y-2">
									{workspaceTasks.map((task) => (
										<div
											key={task.id}
											className="flex items-center justify-between px-2 py-1.5 bg-[#1e1e1e] rounded text-xs">
											<span className="text-gray-300 truncate flex-1">{task.title}</span>
											<span
												className={`ml-2 px-1.5 py-0.5 rounded text-[10px] ${
													task.status === "done"
														? "bg-green-900 text-green-300"
														: task.status === "failed"
															? "bg-red-900 text-red-300"
															: "bg-yellow-900 text-yellow-300"
												}`}>
												{task.status}
											</span>
										</div>
									))}
								</div>
							)}
						</div>
					</div>
				)}

				{/* Search Panel Modal */}
				{hook.showSearchPanel && (
					<SearchPanel
						onClose={() => hook.setShowSearchPanel(false)}
						onFileClick={(path: string, name: string) => {
							hook.handleFileSelect(path)
							hook.setShowSearchPanel(false)
						}}
					/>
				)}

				{/* Git Panel Modal */}
				{hook.showGitPanel && extensionState.isEnabled("superroo.git") && (
					<GitPanel
						onClose={() => hook.setShowGitPanel(false)}
						onFileClick={(path: string, name: string) => {
							hook.handleFileSelect(path)
						}}
					/>
				)}

				{/* Diff View Modal */}
				{showDiffView && hook.diffData && (
					<DiffViewModal
						diffData={hook.diffData}
						onClose={() => dispatch({ type: "SET_SHOW_DIFF_VIEW", payload: false })}
						onApply={() => {
							const dd = hook.diffData
							if (dd && dd.filePath) {
								hook.handleFileSelect(dd.filePath)
							}
							dispatch({ type: "SET_SHOW_DIFF_VIEW", payload: false })
						}}
						onDiscard={() => dispatch({ type: "SET_SHOW_DIFF_VIEW", payload: false })}
					/>
				)}

				{/* Problems Panel Overlay */}
				{hook.showProblemsPanel && (
					<div
						className="fixed inset-0 z-50 flex items-start justify-center pt-16 bg-black/40"
						onClick={() => hook.setShowProblemsPanel(false)}>
						<div
							className="bg-[#252526] border border-[#3c3c3c] rounded-lg shadow-xl w-[600px] max-h-[70vh] overflow-hidden"
							onClick={(e) => e.stopPropagation()}>
							<ProblemsPanel
								problems={hook.editorProblems}
								onProblemClick={(file: string, line: number, column: number) => {
									hook.handleFileSelect(file)
									hook.setJumpToPosition({ line, column })
									hook.setShowProblemsPanel(false)
								}}
								onClose={() => hook.setShowProblemsPanel(false)}
							/>
						</div>
					</div>
				)}

				{/* Settings Panel Overlay */}
				{hook.showSettingsPanel && (
					<div
						className="fixed inset-0 z-50 flex items-start justify-center pt-8 bg-black/40"
						onClick={() => hook.setShowSettingsPanel(false)}>
						<div
							className="bg-[#252526] border border-[#3c3c3c] rounded-lg shadow-xl w-[700px] max-h-[85vh] overflow-hidden"
							onClick={(e) => e.stopPropagation()}>
							<SettingsPanel onClose={() => hook.setShowSettingsPanel(false)} />
						</div>
					</div>
				)}

				{/* Extensions Panel Overlay */}
				{hook.showExtensionsPanel && (
					<div
						className="fixed inset-0 z-50 flex items-start justify-center pt-8 bg-black/40"
						onClick={() => hook.setShowExtensionsPanel(false)}>
						<div
							className="bg-[#252526] border border-[#3c3c3c] rounded-lg shadow-xl w-[700px] max-h-[85vh] overflow-hidden"
							onClick={(e) => e.stopPropagation()}>
							<ExtensionsPanel
								onClose={() => hook.setShowExtensionsPanel(false)}
								extensions={extensionState.extensions}
								toggleEnabled={extensionState.toggleEnabled}
								install={extensionState.install}
								uninstall={extensionState.uninstall}
							/>
						</div>
					</div>
				)}

				{/* Keyboard Shortcuts Modal */}
				{showShortcuts && (
					<KeyboardShortcutsModal onClose={() => dispatch({ type: "SET_SHOW_SHORTCUTS", payload: false })} />
				)}

				{/* ── Gap #1: Session Manager Modal ──────────────────────────── */}
				{showSessionManager && (
					<div
						className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
						onClick={() => setShowSessionManager(false)}>
						<div
							className="bg-[#252526] border border-[#3c3c3c] rounded-lg p-5 w-96 shadow-xl max-h-80 overflow-y-auto"
							onClick={(e) => e.stopPropagation()}>
							<h3 className="text-sm font-semibold text-gray-200 mb-3 flex items-center gap-2">
								<Bookmark size={14} /> Terminal Sessions
							</h3>
							{persistedSessions.length === 0 ? (
								<p className="text-xs text-gray-500 mb-3">No saved sessions yet.</p>
							) : (
								<div className="space-y-1.5 mb-3">
									{persistedSessions.map((sess) => (
										<div
											key={sess.id}
											className="flex items-center justify-between px-2 py-1.5 bg-[#1e1e1e] rounded text-xs">
											<span className="text-gray-300 truncate flex-1">{sess.name}</span>
											<div className="flex items-center gap-1">
												<button
													onClick={() => {
														dispatch({
															type: "SET_OUTPUT_BLOCKS",
															payload: sess.outputBlocks,
														})
														setShowSessionManager(false)
													}}
													className="px-1.5 py-0.5 text-[10px] bg-blue-600 text-white rounded hover:bg-blue-700">
													Restore
												</button>
												<button
													onClick={() => {
														dispatch({ type: "REMOVE_PERSISTED_SESSION", payload: sess.id })
													}}
													className="p-0.5 text-gray-500 hover:text-red-400">
													<Trash2 size={10} />
												</button>
											</div>
										</div>
									))}
								</div>
							)}
							<div className="flex items-center gap-2 border-t border-[#3c3c3c] pt-3">
								<input
									type="text"
									placeholder="Session name..."
									value={sessionNameInput}
									onChange={(e) => setSessionNameInput(e.target.value)}
									className="flex-1 px-2 py-1 text-xs bg-[#1e1e1e] border border-[#3c3c3c] rounded text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
								/>
								<button
									onClick={() => {
										if (sessionNameInput.trim() && outputBlocks.length > 0) {
											dispatch({
												type: "ADD_PERSISTED_SESSION",
												payload: {
													id: `sess-${Date.now()}`,
													name: sessionNameInput.trim(),
													outputBlocks,
													createdAt: new Date().toISOString(),
													lastActivity: new Date().toISOString(),
													commandCount: 0,
												},
											})
											setSessionNameInput("")
										}
									}}
									disabled={!sessionNameInput.trim() || outputBlocks.length === 0}
									className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
									Save Current
								</button>
							</div>
						</div>
					</div>
				)}

				{/* ── Gap #2: Command History Search Modal ──────────────────── */}
				{showCommandHistory && (
					<div
						className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/60"
						onClick={() => setShowCommandHistory(false)}>
						<div
							className="bg-[#252526] border border-[#3c3c3c] rounded-lg p-4 w-[500px] shadow-xl max-h-64 overflow-hidden"
							onClick={(e) => e.stopPropagation()}>
							<div className="flex items-center gap-2 mb-3">
								<History size={14} className="text-gray-400" />
								<input
									type="text"
									placeholder="Search command history... (Ctrl+R)"
									value={commandHistoryQuery}
									onChange={(e) => setCommandHistoryQuery(e.target.value)}
									autoFocus
									className="flex-1 px-2 py-1.5 text-xs bg-[#1e1e1e] border border-[#3c3c3c] rounded text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
								/>
								<button
									onClick={() => setShowCommandHistory(false)}
									className="p-0.5 text-gray-500 hover:text-gray-300">
									<X size={14} />
								</button>
							</div>
							<div className="overflow-y-auto max-h-40">
								{recentCommands
									.filter((c) => c.toLowerCase().includes(commandHistoryQuery.toLowerCase()))
									.slice(0, 20)
									.map((cmd, i) => (
										<div
											key={i}
											className="flex items-center gap-2 px-2 py-1 hover:bg-[#3c3c3c] rounded cursor-pointer text-xs text-gray-300"
											onClick={() => {
												dispatch({ type: "SET_TERMINAL_INPUT", payload: cmd })
												setShowCommandHistory(false)
											}}>
											<Clock3 size={10} className="text-gray-500 shrink-0" />
											<span className="font-mono truncate">{cmd}</span>
										</div>
									))}
								{recentCommands.filter((c) =>
									c.toLowerCase().includes(commandHistoryQuery.toLowerCase()),
								).length === 0 && (
									<p className="text-xs text-gray-500 text-center py-4">No matching commands found</p>
								)}
							</div>
						</div>
					</div>
				)}

				{/* ── Gap #8: Recording Playback Modal ───────────────────────── */}
				{showRecordingPlayback && (
					<div
						className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
						onClick={() => setShowRecordingPlayback(false)}>
						<div
							className="bg-[#252526] border border-[#3c3c3c] rounded-lg p-5 w-[600px] shadow-xl max-h-[70vh] overflow-y-auto"
							onClick={(e) => e.stopPropagation()}>
							<h3 className="text-sm font-semibold text-gray-200 mb-3 flex items-center gap-2">
								<PlayCircle size={14} /> Terminal Recordings
							</h3>
							{recordings.length === 0 ? (
								<p className="text-xs text-gray-500">
									No recordings yet. Start a recording from the terminal panel.
								</p>
							) : (
								<div className="space-y-2">
									{recordings.map((rec, i) => (
										<div
											key={rec.id || i}
											className="px-3 py-2 bg-[#1e1e1e] rounded text-xs space-y-1">
											<div className="flex items-center justify-between">
												<span className="text-gray-400">
													Recording #{i + 1} — {rec.blocks?.length || 0} blocks
												</span>
												<button
													onClick={() => {
														dispatch({
															type: "SET_OUTPUT_BLOCKS",
															payload: rec.blocks || [],
														})
														setShowRecordingPlayback(false)
													}}
													className="px-2 py-0.5 text-[10px] bg-blue-600 text-white rounded hover:bg-blue-700">
													Play
												</button>
											</div>
											{rec.blocks?.slice(0, 3).map((b, bi) => (
												<div key={bi} className="font-mono text-[10px] text-gray-500 truncate">
													{b.content?.slice(0, 80)}
												</div>
											))}
											{rec.blocks && rec.blocks.length > 3 && (
												<div className="text-[10px] text-gray-600">
													...and {rec.blocks.length - 3} more
												</div>
											)}
										</div>
									))}
								</div>
							)}
						</div>
					</div>
				)}

				{/* ── Gap #9: Workspace Template Picker Modal ────────────────── */}
				{showTemplatePicker && (
					<div
						className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
						onClick={() => setShowTemplatePicker(false)}>
						<div
							className="bg-[#252526] border border-[#3c3c3c] rounded-lg p-5 w-96 shadow-xl"
							onClick={(e) => e.stopPropagation()}>
							<h3 className="text-sm font-semibold text-gray-200 mb-3 flex items-center gap-2">
								<FilePlus2 size={14} /> New from Template
							</h3>
							<div className="space-y-1.5">
								{[
									{ name: "Node.js + TypeScript", desc: "Express API with TS config" },
									{ name: "React + Vite", desc: "Modern React SPA with Vite" },
									{ name: "Python Flask", desc: "Minimal Flask web server" },
									{ name: "Go HTTP Server", desc: "Basic Go net/http server" },
									{ name: "Rust CLI", desc: "CLI app with clap" },
									{ name: "Empty Workspace", desc: "Start from scratch" },
								].map((tpl) => (
									<button
										key={tpl.name}
										onClick={() => {
											hook.handleOpenWorkspace()
											setShowTemplatePicker(false)
										}}
										className="w-full flex items-center justify-between px-3 py-2 bg-[#1e1e1e] hover:bg-[#2d2d2d] rounded text-xs text-left transition-colors">
										<div>
											<div className="text-gray-200 font-medium">{tpl.name}</div>
											<div className="text-gray-500 text-[10px]">{tpl.desc}</div>
										</div>
										<ArrowRight size={12} className="text-gray-500" />
									</button>
								))}
							</div>
						</div>
					</div>
				)}

				{/* ── Gap #6: Debug Toolbar ──────────────────────────────────── */}
				{showDebugToolbar && (
					<div className="fixed bottom-12 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-3 py-2 bg-[#252526] border border-[#3c3c3c] rounded-lg shadow-xl">
						<button
							className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-gray-200 hover:bg-[#3c3c3c] rounded"
							title="Continue">
							<Play size={12} /> Continue
						</button>
						<button
							className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-gray-200 hover:bg-[#3c3c3c] rounded"
							title="Step Over">
							<ArrowRight size={12} /> Step Over
						</button>
						<button
							className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-gray-200 hover:bg-[#3c3c3c] rounded"
							title="Step Into">
							<ChevronRight size={12} /> Step Into
						</button>
						<button
							className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-gray-200 hover:bg-[#3c3c3c] rounded"
							title="Stop">
							<StopCircle size={12} /> Stop
						</button>
						<div className="w-px h-4 bg-[#3c3c3c] mx-1" />
						<button
							onClick={() => setShowDebugToolbar(false)}
							className="p-1 text-gray-500 hover:text-gray-300">
							<X size={12} />
						</button>
					</div>
				)}

				{/* ── Gap #7: Test Runner Panel ─────────────────────────────── */}
				{showTestRunner && (
					<div className="fixed bottom-12 right-4 z-50 w-72 bg-[#252526] border border-[#3c3c3c] rounded-lg shadow-xl overflow-hidden">
						<div className="flex items-center justify-between px-3 py-2 border-b border-[#3c3c3c]">
							<span className="text-xs font-semibold text-gray-400 flex items-center gap-1">
								<PlayCircle size={12} /> Test Runner
							</span>
							<button
								onClick={() => setShowTestRunner(false)}
								className="p-0.5 text-gray-500 hover:text-gray-300">
								<X size={12} />
							</button>
						</div>
						<div className="p-3 space-y-2">
							<button className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-gray-300 hover:bg-[#3c3c3c] rounded">
								<Play size={12} className="text-green-400" /> Run All Tests
							</button>
							<button className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-gray-300 hover:bg-[#3c3c3c] rounded">
								<Play size={12} className="text-blue-400" /> Run Current File
							</button>
							<button className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-gray-300 hover:bg-[#3c3c3c] rounded">
								<RefreshCw size={12} className="text-yellow-400" /> Re-run Last
							</button>
							<div className="border-t border-[#3c3c3c] pt-2 mt-2">
								<div className="flex items-center justify-between text-[10px] text-gray-500">
									<span>
										Passed: <span className="text-green-400">0</span>
									</span>
									<span>
										Failed: <span className="text-red-400">0</span>
									</span>
									<span>
										Skipped: <span className="text-yellow-400">0</span>
									</span>
								</div>
							</div>
						</div>
					</div>
				)}

				{/* ── Gap #10: File Watcher Indicator ────────────────────────── */}
				{showFileWatcherIndicator && (
					<div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 px-3 py-1.5 bg-[#252526] border border-[#3c3c3c] rounded-lg shadow-xl text-xs">
						<RefreshCw size={10} className="text-green-400" />
						<span className="text-gray-400">Watching for file changes...</span>
						<button
							onClick={() => setShowFileWatcherIndicator(false)}
							className="p-0.5 text-gray-500 hover:text-gray-300 ml-1">
							<X size={10} />
						</button>
					</div>
				)}

				{/* ── Gap #13: Format on Save + Organize Imports Toggle ──────── */}
				{showFormatOnSave && (
					<div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 px-3 py-1.5 bg-[#252526] border border-[#3c3c3c] rounded-lg shadow-xl text-xs">
						<CheckSquare size={10} className="text-blue-400" />
						<span className="text-gray-400">Format on Save</span>
						<button
							onClick={() => setShowFormatOnSave(false)}
							className="p-0.5 text-gray-500 hover:text-gray-300">
							<X size={10} />
						</button>
					</div>
				)}
				{showOrganizeImports && (
					<div className="fixed bottom-4 right-40 z-50 flex items-center gap-2 px-3 py-1.5 bg-[#252526] border border-[#3c3c3c] rounded-lg shadow-xl text-xs">
						<ListTodo size={10} className="text-purple-400" />
						<span className="text-gray-400">Organize Imports on Save</span>
						<button
							onClick={() => setShowOrganizeImports(false)}
							className="p-0.5 text-gray-500 hover:text-gray-300">
							<X size={10} />
						</button>
					</div>
				)}

				{/* ── Gap #15: Quick Fix Lightbulb ───────────────────────────── */}
				{showQuickFixLightbulb && hook.editorProblems.length > 0 && (
					<div className="absolute top-2 left-2 z-40 flex items-center gap-1 px-2 py-1 bg-yellow-900/30 border border-yellow-700/40 rounded text-xs text-yellow-300">
						<Lightbulb size={12} />
						<span>
							{hook.editorProblems.length} issue{hook.editorProblems.length > 1 ? "s" : ""} found
						</span>
					</div>
				)}

				{/* ── Gap #16: Multi-cursor Editing Hint ─────────────────────── */}
				{showMultiCursorHint && (
					<div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-3 py-1.5 bg-[#252526] border border-[#3c3c3c] rounded-lg shadow-xl text-xs text-gray-400 flex items-center gap-2">
						<Keyboard size={10} />
						Alt+Click to add cursor · Ctrl+Alt+Up/Down for column selection
						<button
							onClick={() => setShowMultiCursorHint(false)}
							className="p-0.5 text-gray-500 hover:text-gray-300">
							<X size={10} />
						</button>
					</div>
				)}

				{/* ── Gap #18: File Drag-and-Drop Hint ───────────────────────── */}
				{showDragDropHint && (
					<div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-3 py-1.5 bg-[#252526] border border-[#3c3c3c] rounded-lg shadow-xl text-xs text-gray-400 flex items-center gap-2">
						<Upload size={10} />
						Drag files from Explorer to the editor to open
						<button
							onClick={() => setShowDragDropHint(false)}
							className="p-0.5 text-gray-500 hover:text-gray-300">
							<X size={10} />
						</button>
					</div>
				)}

				{/* ── Gap #12: Document Symbols / Code Folding / Semantic Tokens Toggle ── */}
				{showDocumentSymbols && (
					<div className="fixed top-16 right-4 z-40 w-56 bg-[#252526] border border-[#3c3c3c] rounded-lg shadow-xl overflow-hidden">
						<div className="flex items-center justify-between px-3 py-2 border-b border-[#3c3c3c]">
							<span className="text-xs font-semibold text-gray-400">Document Symbols</span>
							<button
								onClick={() => setShowDocumentSymbols(false)}
								className="p-0.5 text-gray-500 hover:text-gray-300">
								<X size={12} />
							</button>
						</div>
						<div className="p-2 space-y-0.5 max-h-48 overflow-y-auto">
							<p className="text-[10px] text-gray-500 px-2 py-1">
								Symbols will appear here when LSP is connected.
							</p>
						</div>
					</div>
				)}
			</div>
		</ErrorBoundary>
	)
}
