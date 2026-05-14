"use client"

import { useState, useCallback } from "react"
import {
	GitBranch,
	GitCommit,
	GitPullRequest,
	RefreshCw,
	Check,
	X,
	Loader2,
	File,
	Plus,
	Trash2,
	RotateCcw,
} from "lucide-react"
import { gitCommand } from "./api"

interface GitFile {
	path: string
	status: "modified" | "added" | "deleted" | "renamed"
}

interface GitPanelProps {
	onFileClick: (path: string, name: string) => void
	onClose: () => void
}

export default function GitPanel({ onFileClick, onClose }: GitPanelProps) {
	const [branch, setBranch] = useState("main")
	const [changedFiles, setChangedFiles] = useState<GitFile[]>([])
	const [commitMessage, setCommitMessage] = useState("")
	const [isLoading, setIsLoading] = useState(false)
	const [statusMessage, setStatusMessage] = useState<string | null>(null)
	const [statusType, setStatusType] = useState<"success" | "error" | null>(null)
	const [activeView, setActiveView] = useState<"changes" | "log" | "branches">("changes")
	const [log, setLog] = useState<string[]>([])

	const fetchStatus = useCallback(async () => {
		setIsLoading(true)
		try {
			const data = await gitCommand("status")
			if (data.success && data.output) {
				const lines = data.output.split("\n")
				const files: GitFile[] = []
				let currentBranch = "main"
				for (const line of lines) {
					const branchMatch = line.match(/On branch (.+)/)
					if (branchMatch) currentBranch = branchMatch[1]
					const modifiedMatch = line.match(/^\s+modified:\s+(.+)/)
					if (modifiedMatch) files.push({ path: modifiedMatch[1].trim(), status: "modified" })
					const addedMatch = line.match(/^\s+new file:\s+(.+)/)
					if (addedMatch) files.push({ path: addedMatch[1].trim(), status: "added" })
					const deletedMatch = line.match(/^\s+deleted:\s+(.+)/)
					if (deletedMatch) files.push({ path: deletedMatch[1].trim(), status: "deleted" })
				}
				setBranch(currentBranch)
				setChangedFiles(files)
			}
		} catch {
			setChangedFiles([])
		} finally {
			setIsLoading(false)
		}
	}, [])

	const handleCommit = useCallback(async () => {
		if (!commitMessage.trim()) return
		setIsLoading(true)
		try {
			const data = await gitCommand("commit", { message: commitMessage })
			if (data.success) {
				setStatusMessage("Committed successfully")
				setStatusType("success")
				setCommitMessage("")
				fetchStatus()
			} else {
				setStatusMessage(data.output || "Commit failed")
				setStatusType("error")
			}
		} catch (err: any) {
			setStatusMessage(err.message || "Commit failed")
			setStatusType("error")
		} finally {
			setIsLoading(false)
			setTimeout(() => setStatusMessage(null), 3000)
		}
	}, [commitMessage, fetchStatus])

	const handlePush = useCallback(async () => {
		setIsLoading(true)
		try {
			const data = await gitCommand("push")
			if (data.success) {
				setStatusMessage("Pushed successfully")
				setStatusType("success")
			} else {
				setStatusMessage(data.output || "Push failed")
				setStatusType("error")
			}
		} catch (err: any) {
			setStatusMessage(err.message || "Push failed")
			setStatusType("error")
		} finally {
			setIsLoading(false)
			setTimeout(() => setStatusMessage(null), 3000)
		}
	}, [])

	const handlePull = useCallback(async () => {
		setIsLoading(true)
		try {
			const data = await gitCommand("pull")
			if (data.success) {
				setStatusMessage("Pulled successfully")
				setStatusType("success")
				fetchStatus()
			} else {
				setStatusMessage(data.output || "Pull failed")
				setStatusType("error")
			}
		} catch (err: any) {
			setStatusMessage(err.message || "Pull failed")
			setStatusType("error")
		} finally {
			setIsLoading(false)
			setTimeout(() => setStatusMessage(null), 3000)
		}
	}, [fetchStatus])

	const fetchLog = useCallback(async () => {
		setIsLoading(true)
		try {
			const data = await gitCommand("log", { count: "20" })
			if (data.success && data.output) {
				setLog(data.output.split("\n").filter((l: string) => l.trim()))
			}
		} catch {
			setLog([])
		} finally {
			setIsLoading(false)
		}
	}, [])

	const getStatusIcon = (status: string) => {
		switch (status) {
			case "modified":
				return <File className="w-3 h-3 text-[#d29922]" />
			case "added":
				return <Plus className="w-3 h-3 text-[#3fb950]" />
			case "deleted":
				return <Trash2 className="w-3 h-3 text-[#f85149]" />
			default:
				return <File className="w-3 h-3 text-[#8b949e]" />
		}
	}

	const getStatusBadge = (status: string) => {
		switch (status) {
			case "modified":
				return <span className="text-[10px] text-[#d29922] font-mono">M</span>
			case "added":
				return <span className="text-[10px] text-[#3fb950] font-mono">A</span>
			case "deleted":
				return <span className="text-[10px] text-[#f85149] font-mono">D</span>
			default:
				return null
		}
	}

	return (
		<div className="flex flex-col h-full bg-[#0f1117] border-l border-[#1e2535]">
			{/* Header */}
			<div className="flex items-center justify-between px-3 py-2 border-b border-[#1e2535]">
				<div className="flex items-center gap-2">
					<GitBranch className="w-3.5 h-3.5 text-[#8b949e]" />
					<span className="text-[12px] font-medium text-[#e6edf3]">Git</span>
					<span className="text-[10px] text-[#58a6ff] font-mono">{branch}</span>
				</div>
				<button
					className="p-1 rounded hover:bg-[#1e2535] text-[#8b949e] hover:text-[#e6edf3] transition-colors"
					onClick={onClose}>
					<X className="w-3.5 h-3.5" />
				</button>
			</div>

			{/* Action bar */}
			<div className="flex items-center gap-1 px-2 py-1.5 border-b border-[#1e2535]">
				<button
					className="flex items-center gap-1 px-2 py-1 text-[11px] bg-[#1f6feb] text-white rounded hover:bg-[#388bfd] transition-colors"
					onClick={handlePull}
					disabled={isLoading}>
					<RotateCcw className="w-3 h-3" />
					Pull
				</button>
				<button
					className="flex items-center gap-1 px-2 py-1 text-[11px] bg-[#238636] text-white rounded hover:bg-[#2ea043] transition-colors"
					onClick={handlePush}
					disabled={isLoading}>
					<GitPullRequest className="w-3 h-3" />
					Push
				</button>
				<button
					className="p-1 rounded hover:bg-[#1e2535] text-[#8b949e] hover:text-[#e6edf3] transition-colors"
					onClick={fetchStatus}
					title="Refresh">
					<RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
				</button>
			</div>

			{/* Tab bar */}
			<div className="flex border-b border-[#1e2535]">
				{(["changes", "log", "branches"] as const).map((view) => (
					<button
						key={view}
						className={`flex-1 px-2 py-1 text-[11px] border-b-2 transition-colors ${
							activeView === view
								? "border-[#1f6feb] text-[#e6edf3]"
								: "border-transparent text-[#8b949e] hover:text-[#e6edf3]"
						}`}
						onClick={() => {
							setActiveView(view)
							if (view === "log") fetchLog()
							if (view === "changes") fetchStatus()
						}}>
						{view === "changes" && "Changes"}
						{view === "log" && "History"}
						{view === "branches" && "Branches"}
					</button>
				))}
			</div>

			{/* Status message */}
			{statusMessage && (
				<div
					className={`px-3 py-1 text-[11px] flex items-center gap-1 ${
						statusType === "success" ? "bg-[#3fb95022] text-[#3fb950]" : "bg-[#f8514922] text-[#f85149]"
					}`}>
					{statusType === "success" ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
					{statusMessage}
				</div>
			)}

			{/* Content */}
			<div className="flex-1 overflow-y-auto">
				{activeView === "changes" && (
					<div>
						{changedFiles.length === 0 ? (
							<div className="text-center py-8">
								<GitCommit className="w-6 h-6 mx-auto mb-2 text-[#30363d]" />
								<p className="text-[11px] text-[#484f58]">No changes</p>
							</div>
						) : (
							<div>
								{changedFiles.map((file, i) => (
									<button
										key={i}
										className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-[#1e2535] transition-colors text-left"
										onClick={() => {
											const name = file.path.split("/").pop() || file.path
											onFileClick(file.path, name)
										}}>
										{getStatusIcon(file.status)}
										<span className="flex-1 text-[12px] text-[#e6edf3] truncate">{file.path}</span>
										{getStatusBadge(file.status)}
									</button>
								))}

								{/* Commit area */}
								<div className="border-t border-[#1e2535] p-2">
									<textarea
										value={commitMessage}
										onChange={(e) => setCommitMessage(e.target.value)}
										placeholder="Commit message..."
										rows={2}
										className="w-full bg-[#0d1117] border border-[#1e2535] rounded px-2 py-1.5 text-[12px] text-[#e6edf3] placeholder-[#484f58] outline-none resize-none focus:border-[#1f6feb] transition-colors"
									/>
									<button
										className="w-full mt-1 px-2 py-1.5 bg-[#238636] text-white text-[12px] rounded hover:bg-[#2ea043] transition-colors disabled:opacity-50 flex items-center justify-center gap-1"
										onClick={handleCommit}
										disabled={!commitMessage.trim() || isLoading}>
										{isLoading ? (
											<Loader2 className="w-3 h-3 animate-spin" />
										) : (
											<GitCommit className="w-3 h-3" />
										)}
										Commit
									</button>
								</div>
							</div>
						)}
					</div>
				)}

				{activeView === "log" && (
					<div>
						{log.length === 0 ? (
							<div className="text-center py-8">
								<p className="text-[11px] text-[#484f58]">No commit history</p>
							</div>
						) : (
							log.map((line, i) => (
								<div
									key={i}
									className="px-3 py-1 text-[11px] font-mono text-[#8b949e] border-b border-[#1e2535] last:border-0">
									{line}
								</div>
							))
						)}
					</div>
				)}

				{activeView === "branches" && (
					<div className="text-center py-8">
						<GitBranch className="w-6 h-6 mx-auto mb-2 text-[#30363d]" />
						<p className="text-[11px] text-[#484f58]">Branch management coming soon</p>
					</div>
				)}
			</div>
		</div>
	)
}
