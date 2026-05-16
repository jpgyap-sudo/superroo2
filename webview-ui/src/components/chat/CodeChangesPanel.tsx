import { useEffect, useState } from "react"
import type { CodeChange } from "@superroo/types"
import { vscode } from "@/utils/vscode"
import { HistoryIcon, UndoIcon, XIcon } from "lucide-react"

interface CodeChangesPanelProps {
	taskId: string
	onClose: () => void
}

export default function CodeChangesPanel({ taskId, onClose }: CodeChangesPanelProps) {
	const [changes, setChanges] = useState<CodeChange[]>([])
	const [loading, setLoading] = useState(true)

	useEffect(() => {
		setLoading(true)
		vscode.postMessage({ type: "getCodeChanges", text: taskId })

		const handler = (event: MessageEvent) => {
			const msg = event.data
			if (msg.type === "codeChanges" && msg.text === taskId) {
				setChanges(msg.changes ?? [])
				setLoading(false)
			}
			if (msg.type === "codeChangeReverted") {
				vscode.postMessage({ type: "getCodeChanges", text: taskId })
			}
		}

		window.addEventListener("message", handler)
		return () => window.removeEventListener("message", handler)
	}, [taskId])

	const handleRevert = (changeId: string) => {
		vscode.postMessage({
			type: "revertCodeChange",
			text: JSON.stringify({ taskId, changeId }),
		})
	}

	const operationLabel = (operation: CodeChange["operation"]) => {
		switch (operation) {
			case "create":
				return "new"
			case "write":
				return "write"
			case "diff":
				return "diff"
			case "edit":
				return "edit"
			case "patch":
				return "patch"
			case "delete":
				return "delete"
			default:
				return "change"
		}
	}

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
			<div className="bg-vscode-editor-background border border-vscode-panel-border rounded-lg shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col m-4">
				<div className="flex items-center justify-between px-4 py-3 border-b border-vscode-panel-border">
					<div className="flex items-center gap-2 text-vscode-foreground font-medium">
						<HistoryIcon className="size-4" />
						<span>Code Changes</span>
						<span className="text-vscode-descriptionForeground text-sm">({changes.length})</span>
					</div>
					<button
						onClick={onClose}
						className="text-vscode-descriptionForeground hover:text-vscode-foreground">
						<XIcon className="size-4" />
					</button>
				</div>

				<div className="overflow-y-auto p-4 flex-1">
					{loading && <div className="text-vscode-descriptionForeground text-sm">Loading...</div>}
					{!loading && changes.length === 0 && (
						<div className="text-vscode-descriptionForeground text-sm">
							No code changes recorded for this task.
						</div>
					)}
					<div className="space-y-2">
						{changes.map((change) => (
							<div
								key={change.id}
								className="flex items-center justify-between gap-3 p-2 rounded bg-vscode-input-background hover:bg-vscode-list-hoverBackground transition-colors">
								<div className="flex items-center gap-2 min-w-0">
									<span className="text-xs uppercase tracking-wide text-vscode-descriptionForeground w-12">
										{operationLabel(change.operation)}
									</span>
									<div className="min-w-0">
										<div className="text-vscode-foreground text-sm truncate">{change.filePath}</div>
										<div className="text-vscode-descriptionForeground text-xs">
											{new Date(change.timestamp).toLocaleString()}
										</div>
									</div>
								</div>
								{(change.beforeContent !== undefined || change.operation === "create") && (
									<button
										onClick={() => handleRevert(change.id)}
										className="shrink-0 text-vscode-descriptionForeground hover:text-vscode-foreground"
										title="Revert this change">
										<UndoIcon className="size-4" />
									</button>
								)}
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	)
}
