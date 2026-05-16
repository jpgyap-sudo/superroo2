import { useState, useRef, useEffect } from "react"
import { Terminal, Plus, X } from "lucide-react"
import { TerminalOutput } from "../../chat/TerminalOutput"
import type { TerminalSession } from "../../lib/ideWorkspaceApi"

interface TerminalPaneProps {
	sessions: TerminalSession[]
	activeTerminal: string | null
	onSetActive: (id: string) => void
	onCreateSession: (name?: string) => void
	onExecuteCommand: (terminalId: string, command: string) => void
}

export function TerminalPane({
	sessions,
	activeTerminal,
	onSetActive,
	onCreateSession,
	onExecuteCommand,
}: TerminalPaneProps) {
	const [commandInput, setCommandInput] = useState("")
	const inputRef = useRef<HTMLInputElement>(null)
	const outputEndRef = useRef<HTMLDivElement>(null)

	const activeSession = sessions.find((s) => s.id === activeTerminal)

	useEffect(() => {
		outputEndRef.current?.scrollIntoView({ behavior: "smooth" })
	}, [activeSession?.output])

	function handleKeyDown(e: React.KeyboardEvent) {
		if (e.key === "Enter" && commandInput.trim() && activeTerminal) {
			onExecuteCommand(activeTerminal, commandInput.trim())
			setCommandInput("")
		}
	}

	return (
		<div className="flex flex-col h-full bg-vscode-terminal-background rounded-lg border border-vscode-panel-border overflow-hidden">
			{/* Terminal tabs header */}
			<div className="flex items-center gap-1 px-2 py-1 bg-vscode-sideBar-background border-b border-vscode-panel-border overflow-x-auto shrink-0">
				<Terminal size={14} className="text-vscode-descriptionForeground shrink-0" />
				{sessions.map((s) => (
					<button
						key={s.id}
						onClick={() => onSetActive(s.id)}
						className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-t transition-colors ${
							s.id === activeTerminal
								? "bg-vscode-terminal-background text-vscode-foreground border-t border-x border-vscode-panel-border"
								: "text-vscode-descriptionForeground hover:text-vscode-foreground"
						}`}>
						{s.name}
						<X size={10} className="opacity-50 hover:opacity-100" />
					</button>
				))}
				<button
					onClick={() => onCreateSession()}
					className="ml-auto p-0.5 text-vscode-descriptionForeground hover:text-vscode-foreground"
					title="New terminal">
					<Plus size={14} />
				</button>
			</div>

			{/* Terminal output */}
			<div className="flex-1 overflow-y-auto font-mono text-xs">
				{activeSession ? (
					<TerminalOutput content={activeSession.output.join("\n")} />
				) : (
					<div className="p-3 text-vscode-descriptionForeground text-xs">
						No terminal session. Create one to get started.
					</div>
				)}
				<div ref={outputEndRef} />
			</div>

			{/* Command input */}
			<div className="flex items-center gap-2 px-3 py-1.5 border-t border-vscode-panel-border bg-vscode-sideBar-background shrink-0">
				<span className="text-vscode-terminal-ansiGreen text-xs font-mono">$</span>
				<input
					ref={inputRef}
					type="text"
					value={commandInput}
					onChange={(e) => setCommandInput(e.target.value)}
					onKeyDown={handleKeyDown}
					placeholder="Type a command..."
					className="flex-1 bg-transparent border-none outline-none text-xs font-mono text-vscode-input-foreground placeholder-vscode-input-placeholder"
					autoFocus
				/>
			</div>
		</div>
	)
}
