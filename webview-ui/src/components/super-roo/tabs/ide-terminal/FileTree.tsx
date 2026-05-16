import { useState } from "react"
import { ChevronRight, ChevronDown, File, Folder, FolderOpen, GitBranch, Github, RefreshCw } from "lucide-react"
import type { WorkspaceFile } from "../../lib/ideWorkspaceApi"

interface FileTreeProps {
	files: WorkspaceFile[]
	activeFile: string | null
	onOpenFile: (path: string) => void
	onImportGithub?: () => void
	branch?: string
}

function FileTreeNode({
	item,
	depth,
	activeFile,
	onOpenFile,
}: {
	item: WorkspaceFile
	depth: number
	activeFile: string | null
	onOpenFile: (path: string) => void
}) {
	const [expanded, setExpanded] = useState(depth < 1)
	const isFolder = item.kind === "folder"
	const isActive = activeFile === item.path

	function handleClick() {
		if (isFolder) {
			setExpanded(!expanded)
		} else {
			onOpenFile(item.path)
		}
	}

	return (
		<div>
			<button
				onClick={handleClick}
				className={`w-full flex items-center gap-1 px-2 py-0.5 text-xs text-left transition-colors hover:bg-vscode-list-hoverBackground ${
					isActive
						? "bg-vscode-list-activeSelectionBackground text-vscode-list-activeSelectionForeground"
						: ""
				}`}
				style={{ paddingLeft: `${8 + depth * 16}px` }}>
				{isFolder ? (
					<>
						{expanded ? (
							<ChevronDown size={12} className="shrink-0" />
						) : (
							<ChevronRight size={12} className="shrink-0" />
						)}
						{expanded ? (
							<FolderOpen size={14} className="shrink-0 text-vscode-terminal-ansiYellow" />
						) : (
							<Folder size={14} className="shrink-0 text-vscode-terminal-ansiYellow" />
						)}
					</>
				) : (
					<>
						<span className="w-3 shrink-0" />
						<File size={14} className="shrink-0 text-vscode-descriptionForeground" />
					</>
				)}
				<span className="truncate">{item.name}</span>
				{item.modified && <span className="ml-auto text-[9px] text-vscode-terminal-ansiYellow">M</span>}
			</button>
			{isFolder &&
				expanded &&
				item.children?.map((child) => (
					<FileTreeNode
						key={child.path}
						item={child}
						depth={depth + 1}
						activeFile={activeFile}
						onOpenFile={onOpenFile}
					/>
				))}
		</div>
	)
}

export function FileTreePanel({ files, activeFile, onOpenFile, onImportGithub, branch }: FileTreeProps) {
	return (
		<div className="flex flex-col h-full bg-vscode-sideBar-background rounded-lg border border-vscode-panel-border overflow-hidden">
			{/* Header */}
			<div className="flex items-center justify-between px-3 py-2 border-b border-vscode-panel-border shrink-0">
				<div className="flex items-center gap-2">
					{branch ? (
						<>
							<GitBranch size={14} className="text-vscode-terminal-ansiGreen" />
							<span className="text-xs font-medium text-vscode-foreground">{branch}</span>
						</>
					) : (
						<span className="text-xs font-medium text-vscode-foreground">Workspace</span>
					)}
				</div>
				<div className="flex items-center gap-1">
					{onImportGithub && (
						<button
							onClick={onImportGithub}
							className="p-1 text-vscode-descriptionForeground hover:text-vscode-foreground"
							title="Import from GitHub">
							<Github size={14} />
						</button>
					)}
					<button
						className="p-1 text-vscode-descriptionForeground hover:text-vscode-foreground"
						title="Refresh">
						<RefreshCw size={14} />
					</button>
				</div>
			</div>

			{/* File list */}
			<div className="flex-1 overflow-y-auto py-1">
				{files.length === 0 ? (
					<div className="flex items-center justify-center h-full text-xs text-vscode-descriptionForeground p-4 text-center">
						No files loaded. Import a GitHub repository to get started.
					</div>
				) : (
					files.map((file) => (
						<FileTreeNode
							key={file.path}
							item={file}
							depth={0}
							activeFile={activeFile}
							onOpenFile={onOpenFile}
						/>
					))
				)}
			</div>
		</div>
	)
}
