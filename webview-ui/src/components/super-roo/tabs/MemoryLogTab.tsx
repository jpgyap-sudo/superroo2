import { useState, useEffect, useCallback } from "react"
import { RefreshCw, FileJson, FileText } from "lucide-react"

import { cn } from "@/lib/utils"
import { useSr } from "../hooks/SrContext"

const MEMORY_FILES = [
	"product-features.json",
	"product-updates.json",
	"feature-test-history.json",
	"bug-feature-map.json",
	"agent-notes.json",
	"codextask.json",
	"commit-deploy-log.json",
]

export function MemoryLogTab() {
	const { send, memoryFiles } = useSr()
	const [selectedFile, setSelectedFile] = useState<string>(MEMORY_FILES[0])
	const [loading, setLoading] = useState(true)

	const loadFile = useCallback(
		(fileName: string) => {
			setLoading(true)
			send({ type: "superRoo:productMemory", action: "readMemoryFile", fileName })
			// Give a brief grace period for the extension to reply.
			const timer = window.setTimeout(() => setLoading(false), 300)
			return () => window.clearTimeout(timer)
		},
		[send],
	)

	useEffect(() => {
		const cleanup = loadFile(selectedFile)
		return cleanup
	}, [selectedFile, loadFile])

	// When memoryFiles updates for our selected file, clear loading.
	useEffect(() => {
		if (selectedFile in memoryFiles) {
			setLoading(false)
		}
	}, [memoryFiles, selectedFile])

	const content = memoryFiles[selectedFile] ?? ""
	const hasError = content.startsWith("Error:") || content === "File not allowed"

	return (
		<div className="p-4 flex flex-col gap-4 h-full">
			{/* Header */}
			<div className="flex items-center justify-between">
				<h2 className="text-lg font-semibold">Memory Log</h2>
				<span className="text-xs text-vscode-descriptionForeground">Product memory JSON files</span>
			</div>

			<div className="flex gap-4 flex-1 min-h-0">
				{/* File selector sidebar */}
				<aside className="w-48 shrink-0 flex flex-col gap-1">
					{MEMORY_FILES.map((file) => (
						<button
							key={file}
							type="button"
							onClick={() => setSelectedFile(file)}
							className={cn(
								"flex items-center gap-2 px-3 py-2 text-xs rounded text-left transition-colors",
								selectedFile === file
									? "bg-vscode-list-activeSelectionBackground text-vscode-list-activeSelectionForeground"
									: "text-vscode-descriptionForeground hover:text-vscode-foreground hover:bg-vscode-list-hoverBackground",
							)}>
							<FileJson className="size-3.5 shrink-0" />
							<span className="truncate">{file}</span>
						</button>
					))}
				</aside>

				{/* JSON viewer */}
				<div className="flex-1 min-w-0 rounded border border-vscode-panel-border bg-vscode-editor-background overflow-hidden flex flex-col">
					{/* Tab bar */}
					<div className="flex items-center gap-2 px-3 py-1.5 border-b border-vscode-panel-border bg-vscode-sideBar-background">
						<FileText className="size-3.5 text-vscode-descriptionForeground" />
						<span className="text-xs font-medium">{selectedFile}</span>
					</div>

					{/* Content */}
					<div className="p-3 overflow-auto flex-1">
						{loading ? (
							<div className="flex items-center gap-2 text-vscode-descriptionForeground">
								<RefreshCw className="size-4 animate-spin" />
								<span className="text-xs">Loading…</span>
							</div>
						) : hasError ? (
							<pre className="text-xs font-mono text-vscode-errorForeground whitespace-pre-wrap break-all">
								{content}
							</pre>
						) : (
							<pre className="text-xs font-mono text-vscode-editor-foreground whitespace-pre-wrap break-all">
								{content}
							</pre>
						)}
					</div>
				</div>
			</div>
		</div>
	)
}
