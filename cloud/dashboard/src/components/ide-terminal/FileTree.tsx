"use client"

import { useState, useCallback } from "react"
import { ChevronRight, ChevronDown, File, Folder, FileCode, FileJson, FileText, Image } from "lucide-react"
import type { WorkspaceFile } from "@/lib/ide-store"

interface FileTreeProps {
	items: WorkspaceFile[]
	onFileClick: (path: string, name: string) => void
	activeFilePath?: string | null
	filter?: string
}

function getFileIcon(name: string) {
	const ext = name.split(".").pop()?.toLowerCase()
	switch (ext) {
		case "ts":
		case "tsx":
		case "js":
		case "jsx":
			return <FileCode className="w-3.5 h-3.5 text-[#519aba]" />
		case "json":
			return <FileJson className="w-3.5 h-3.5 text-[#cbcb41]" />
		case "md":
			return <FileText className="w-3.5 h-3.5 text-[#42a5f5]" />
		case "png":
		case "jpg":
		case "jpeg":
		case "gif":
		case "svg":
			return <Image className="w-3.5 h-3.5 text-[#ab47bc]" />
		default:
			return <File className="w-3.5 h-3.5 text-[#607d8b]" />
	}
}

export default function FileTree({ items, onFileClick, activeFilePath, filter }: FileTreeProps) {
	const [expanded, setExpanded] = useState<Set<string>>(new Set())

	const toggle = useCallback((path: string) => {
		setExpanded((prev) => {
			const next = new Set(prev)
			if (next.has(path)) next.delete(path)
			else next.add(path)
			return next
		})
	}, [])

	const filtered = filter ? items.filter((item) => item.name.toLowerCase().includes(filter.toLowerCase())) : items

	const renderItem = (item: WorkspaceFile, depth: number): React.ReactNode => {
		const isExpanded = expanded.has(item.path)
		const isActive = activeFilePath === item.path

		if (item.kind === "folder") {
			return (
				<div key={item.path}>
					<button
						className={`flex items-center gap-1 w-full text-left px-1 py-0.5 rounded hover:bg-[#1e2535] text-[12px] text-[#8b949e] transition-colors`}
						style={{ paddingLeft: `${depth * 12 + 4}px` }}
						onClick={() => toggle(item.path)}>
						{isExpanded ? (
							<ChevronDown className="w-3 h-3 shrink-0" />
						) : (
							<ChevronRight className="w-3 h-3 shrink-0" />
						)}
						<Folder className="w-3.5 h-3.5 shrink-0 text-[#d29922]" />
						<span className="truncate">{item.name}</span>
					</button>
					{isExpanded && item.children?.map((child) => renderItem(child, depth + 1))}
				</div>
			)
		}

		return (
			<button
				key={item.path}
				className={`flex items-center gap-1.5 w-full text-left px-1 py-0.5 rounded text-[12px] transition-colors ${
					isActive
						? "bg-[#1f6feb33] text-[#e6edf3]"
						: "text-[#8b949e] hover:bg-[#1e2535] hover:text-[#e6edf3]"
				}`}
				style={{ paddingLeft: `${depth * 12 + 20}px` }}
				onClick={() => onFileClick(item.path, item.name)}>
				{getFileIcon(item.name)}
				<span className="truncate">{item.name}</span>
			</button>
		)
	}

	return (
		<div className="flex flex-col gap-0.5 py-1 overflow-y-auto flex-1">
			{filtered.length === 0 ? (
				<div className="text-[11px] text-[#484f58] text-center py-4">
					{filter ? "No files match filter" : "No files"}
				</div>
			) : (
				filtered.map((item) => renderItem(item, 0))
			)}
		</div>
	)
}
