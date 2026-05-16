import { Wifi, WifiOff, Container, Database, Cpu, MemoryStick } from "lucide-react"

interface StatusBarProps {
	status: {
		connected: boolean
		docker: boolean
		redis: boolean
		cpu: string
		ram: string
	}
	branch?: string
}

export function StatusBar({ status, branch }: StatusBarProps) {
	return (
		<div className="flex items-center gap-3 px-4 py-1 bg-vscode-statusBar-background text-vscode-statusBar-foreground text-[11px] shrink-0 overflow-x-auto">
			{branch && <span className="text-vscode-statusBar-foreground whitespace-nowrap">{branch}</span>}

			<div className="flex items-center gap-1.5 ml-auto">
				{/* Connection status */}
				<span
					className={`inline-flex items-center gap-1 ${
						status.connected ? "text-vscode-terminal-ansiGreen" : "text-vscode-terminal-ansiRed"
					}`}>
					{status.connected ? <Wifi size={12} /> : <WifiOff size={12} />}
					<span className="hidden sm:inline">{status.connected ? "Connected" : "Disconnected"}</span>
				</span>

				<span className="text-vscode-statusBar-foreground opacity-40">|</span>

				{/* Docker */}
				<span
					className={`inline-flex items-center gap-1 ${
						status.docker ? "text-vscode-terminal-ansiGreen" : "text-vscode-descriptionForeground"
					}`}>
					<Container size={12} />
					<span className="hidden sm:inline">Docker</span>
				</span>

				<span className="text-vscode-statusBar-foreground opacity-40">|</span>

				{/* Redis */}
				<span
					className={`inline-flex items-center gap-1 ${
						status.redis ? "text-vscode-terminal-ansiGreen" : "text-vscode-descriptionForeground"
					}`}>
					<Database size={12} />
					<span className="hidden sm:inline">Redis</span>
				</span>

				<span className="text-vscode-statusBar-foreground opacity-40">|</span>

				{/* CPU */}
				<span className="inline-flex items-center gap-1 text-vscode-statusBar-foreground">
					<Cpu size={12} />
					<span className="hidden sm:inline">CPU {status.cpu}</span>
				</span>

				<span className="text-vscode-statusBar-foreground opacity-40">|</span>

				{/* RAM */}
				<span className="inline-flex items-center gap-1 text-vscode-statusBar-foreground">
					<MemoryStick size={12} />
					<span className="hidden sm:inline">RAM {status.ram}</span>
				</span>
			</div>
		</div>
	)
}
