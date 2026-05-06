import { CheckCircle2, Loader2, AlertCircle, Circle, Play, XCircle } from "lucide-react"
import type { PipelineStep, PipelineStatus } from "../../lib/ideWorkspaceApi"

interface PipelineBarProps {
	steps: PipelineStep[]
	onApprove?: (stepId: string) => void
	onReject?: (stepId: string) => void
}

function StatusIcon({ status }: { status: PipelineStatus }) {
	switch (status) {
		case "done":
			return <CheckCircle2 size={14} className="text-vscode-terminal-ansiGreen" />
		case "running":
			return <Loader2 size={14} className="text-vscode-terminal-ansiCyan animate-spin" />
		case "approval":
			return <AlertCircle size={14} className="text-vscode-terminal-ansiYellow" />
		case "blocked":
			return <XCircle size={14} className="text-vscode-terminal-ansiRed" />
		case "pending":
		default:
			return <Circle size={14} className="text-vscode-descriptionForeground" />
	}
}

function StatusBar({ status }: { status: PipelineStatus }) {
	const colors: Record<PipelineStatus, string> = {
		done: "bg-vscode-terminal-ansiGreen",
		running: "bg-vscode-terminal-ansiCyan",
		approval: "bg-vscode-terminal-ansiYellow",
		blocked: "bg-vscode-terminal-ansiRed",
		pending: "bg-vscode-descriptionForeground",
	}
	return (
		<div
			className={`h-1 rounded-full transition-all duration-500 ${
				status === "pending" ? "w-0 opacity-30" : "w-full opacity-100"
			} ${colors[status]}`}
		/>
	)
}

export function PipelineBar({ steps, onApprove, onReject }: PipelineBarProps) {
	return (
		<div className="flex items-center gap-3 px-4 py-1.5 bg-vscode-sideBar-background border-b border-vscode-panel-border overflow-x-auto shrink-0">
			{steps.map((step, idx) => (
				<div key={step.id} className="flex items-center gap-2">
					<div className="flex items-center gap-1.5">
						<StatusIcon status={step.status} />
						<div>
							<div className="flex items-center gap-1">
								<span
									className={`text-[10px] font-medium ${
										step.status === "running"
											? "text-vscode-terminal-ansiCyan"
											: step.status === "approval"
												? "text-vscode-terminal-ansiYellow"
												: "text-vscode-descriptionForeground"
									}`}>
									{step.label}
								</span>
								{step.agent && (
									<span className="text-[9px] text-vscode-descriptionForeground">{step.agent}</span>
								)}
							</div>
							<StatusBar status={step.status} />
						</div>
					</div>
					{step.status === "approval" && (
						<div className="flex items-center gap-1 ml-1">
							{onApprove && (
								<button
									onClick={() => onApprove(step.id)}
									className="p-0.5 rounded text-vscode-terminal-ansiGreen hover:bg-vscode-sideBar-background"
									title="Approve">
									<Play size={12} />
								</button>
							)}
							{onReject && (
								<button
									onClick={() => onReject(step.id)}
									className="p-0.5 rounded text-vscode-terminal-ansiRed hover:bg-vscode-sideBar-background"
									title="Reject">
									<XCircle size={12} />
								</button>
							)}
						</div>
					)}
					{idx < steps.length - 1 && <div className="w-4 h-px bg-vscode-panel-border" />}
				</div>
			))}
		</div>
	)
}
