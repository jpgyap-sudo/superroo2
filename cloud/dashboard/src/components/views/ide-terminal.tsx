"use client"

import { useState, useCallback, useEffect, useRef } from "react"
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
import ErrorBoundary from "@/components/ide-terminal/ErrorBoundary"
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
		terminalOutput,
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
	} = state

	// ── All logic extracted into hook ─────────────────────────────────────
	const hook = useIdeTerminal()

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
						<button
							onClick={() => dispatch({ type: "SET_SHOW_SHORTCUTS", payload: true })}
							className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-gray-200 hover:bg-[#3c3c3c] rounded"
							title="Keyboard Shortcuts">
							<Keyboard size={12} />
						</button>
						<div className="w-px h-4 bg-[#3c3c3c] mx-1" />
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
						{/* ── Pipeline Bar ────────────────────────────────── */}
						{pipeline.length > 0 && (
							<div className="px-4 py-1.5 bg-[#252526] border-b border-[#3c3c3c] flex items-center gap-2 text-xs overflow-x-auto shrink-0">
								<Workflow size={12} className="text-gray-500 shrink-0" />
								{pipeline.map((step) => (
									<span key={step.id} className="flex items-center gap-1 whitespace-nowrap">
										<PipelineIcon status={step.status} />
										<span
											className={
												step.status === "done"
													? "text-green-400"
													: step.status === "failed"
														? "text-red-400"
														: "text-gray-400"
											}>
											{step.label}
										</span>
										{step.duration && <span className="text-gray-600">({step.duration})</span>}
										<ChevronRight size={10} className="text-gray-600" />
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
							{showInlineAiButton && hook.inlineSelectionPos && (
								<div
									className="absolute z-50 flex items-center gap-1 bg-[#2d2d2d] border border-[#3c3c3c] rounded-md shadow-lg px-1 py-0.5"
									style={{ top: hook.inlineSelectionPos.top, left: hook.inlineSelectionPos.left }}>
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
											onTerminalInputChange={(val: string) =>
												dispatch({ type: "SET_TERMINAL_INPUT", payload: val })
											}
											onTerminalCommand={() => hook.handleTerminalCommand(terminalInput)}
											onTerminalKeyDown={(e: React.KeyboardEvent) => {
												if (e.key === "Enter") {
													hook.handleTerminalCommand(terminalInput)
												}
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
										/>
									</div>
								</div>
							</ErrorBoundary>
						)}
					</div>

					{/* ── AI Chat Panel ──────────────────────────────────── */}
					{showAiPanel && (
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
										onApplyCode={(code: string, language: string) => {
											hook.setCurrentFileContent(code)
										}}
										onRunInTerminal={(code: string) => {
											dispatch({ type: "SET_TERMINAL_INPUT", payload: code })
										}}
										onFileLinkClick={(path: string) => {
											hook.handleFileSelect(path)
										}}
										aiMessagesEndRef={hook.aiMessagesEndRef}
										textareaRef={hook.textareaRef}
										slashCommandFilter={hook.slashCommandFilter}
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
				{hook.showGitPanel && (
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
							<ExtensionsPanel onClose={() => hook.setShowExtensionsPanel(false)} />
						</div>
					</div>
				)}

				{/* Keyboard Shortcuts Modal */}
				{showShortcuts && (
					<KeyboardShortcutsModal onClose={() => dispatch({ type: "SET_SHOW_SHORTCUTS", payload: false })} />
				)}
			</div>
		</ErrorBoundary>
	)
}
