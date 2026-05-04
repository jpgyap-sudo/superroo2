import { useState, useEffect, useCallback } from "react"
import { RefreshCw, GitCommit, Bug, Palette, Cpu, Globe, Rocket, RotateCcw, Beaker, Shield } from "lucide-react"

import { cn } from "@/lib/utils"
import { useSr } from "../hooks/SrContext"

interface ProductUpdate {
	id: string
	timestamp: string
	type: string
	title: string
	summary: string
	filesChanged: string[]
	status: string
	linkedFeatures: string[]
	rollbackAvailable: boolean
}

const TYPE_CONFIG: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> =
	{
		feature_added: {
			label: "Feature Added",
			icon: GitCommit,
			color: "text-green-400 bg-green-500/10 border-green-500/30",
		},
		bug_fixed: { label: "Bug Fixed", icon: Bug, color: "text-red-400 bg-red-500/10 border-red-500/30" },
		ui_changed: {
			label: "UI Changed",
			icon: Palette,
			color: "text-purple-400 bg-purple-500/10 border-purple-500/30",
		},
		agent_updated: { label: "Agent Updated", icon: Cpu, color: "text-blue-400 bg-blue-500/10 border-blue-500/30" },
		api_changed: { label: "API Changed", icon: Globe, color: "text-cyan-400 bg-cyan-500/10 border-cyan-500/30" },
		deployment: {
			label: "Deployment",
			icon: Rocket,
			color: "text-orange-400 bg-orange-500/10 border-orange-500/30",
		},
		rollback: {
			label: "Rollback",
			icon: RotateCcw,
			color: "text-yellow-400 bg-yellow-500/10 border-yellow-500/30",
		},
		test_result: {
			label: "Test Result",
			icon: Beaker,
			color: "text-indigo-400 bg-indigo-500/10 border-indigo-500/30",
		},
		security_change: { label: "Security", icon: Shield, color: "text-rose-400 bg-rose-500/10 border-rose-500/30" },
	}

function getTypeConfig(type: string) {
	return (
		TYPE_CONFIG[type] || { label: type, icon: GitCommit, color: "text-gray-400 bg-gray-500/10 border-gray-500/30" }
	)
}

function formatTimestamp(ts: string): string {
	const d = new Date(ts)
	const now = new Date()
	const diffMs = now.getTime() - d.getTime()
	const diffMins = Math.floor(diffMs / 60000)
	if (diffMins < 1) return "just now"
	if (diffMins < 60) return `${diffMins}m ago`
	const diffHours = Math.floor(diffMins / 60)
	if (diffHours < 24) return `${diffHours}h ago`
	const diffDays = Math.floor(diffHours / 24)
	if (diffDays < 7) return `${diffDays}d ago`
	return d.toLocaleDateString()
}

export function ProductUpdatesTab() {
	const { send } = useSr()
	const [updates, setUpdates] = useState<ProductUpdate[]>([])
	const [loading, setLoading] = useState(true)

	const loadUpdates = useCallback(async () => {
		setLoading(true)
		try {
			// In a real implementation, the extension host would push product memory
			// data via superRoo:productMemory messages.
			setUpdates([])
		} catch {
			setUpdates([])
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		loadUpdates()
	}, [loadUpdates])

	if (loading) {
		return (
			<div className="p-6 text-vscode-descriptionForeground">
				<div className="flex items-center gap-2">
					<RefreshCw className="size-4 animate-spin" />
					<span>Loading product updates…</span>
				</div>
			</div>
		)
	}

	return (
		<div className="p-4 flex flex-col gap-4">
			{/* Header */}
			<div className="flex items-center justify-between">
				<h2 className="text-lg font-semibold">Product Updates</h2>
				<span className="text-xs text-vscode-descriptionForeground">
					{updates.length} update{updates.length !== 1 ? "s" : ""}
				</span>
			</div>

			{/* Timeline */}
			{updates.length === 0 && (
				<div className="text-sm text-vscode-descriptionForeground text-center py-8">
					No updates recorded yet. Use the Product Updates Agent to record changes.
				</div>
			)}
			<div className="relative">
				{/* Timeline line */}
				<div className="absolute left-[11px] top-2 bottom-2 w-0.5 bg-vscode-panel-border" />

				<div className="space-y-3">
					{updates.map((update) => {
						const typeCfg = getTypeConfig(update.type)
						const Icon = typeCfg.icon
						return (
							<div key={update.id} className="relative pl-8">
								{/* Timeline dot */}
								<div
									className={cn(
										"absolute left-[5px] top-1.5 size-3.5 rounded-full border-2 flex items-center justify-center",
										typeCfg.color,
									)}>
									<Icon className="size-2" />
								</div>

								{/* Card */}
								<div className="rounded border border-vscode-panel-border bg-vscode-sideBar-background overflow-hidden">
									<div className="px-3 py-2 flex items-start justify-between gap-2 border-b border-vscode-panel-border">
										<div className="min-w-0">
											<div className="text-sm font-medium truncate">{update.title}</div>
											<div className="text-xs text-vscode-descriptionForeground mt-0.5">
												{formatTimestamp(update.timestamp)}
											</div>
										</div>
										<span
											className={cn(
												"shrink-0 px-2 py-0.5 text-xs rounded-full border",
												typeCfg.color,
											)}>
											{typeCfg.label}
										</span>
									</div>

									<div className="px-3 py-2 space-y-1.5">
										{update.summary && (
											<p className="text-xs text-vscode-descriptionForeground">
												{update.summary}
											</p>
										)}

										{update.filesChanged.length > 0 && (
											<div>
												<div className="text-xs font-medium text-vscode-descriptionForeground mb-0.5">
													Files changed ({update.filesChanged.length})
												</div>
												<ul className="space-y-0.5">
													{update.filesChanged.map((file, i) => (
														<li
															key={i}
															className="text-xs text-vscode-descriptionForeground font-mono truncate">
															{file}
														</li>
													))}
												</ul>
											</div>
										)}

										{update.linkedFeatures.length > 0 && (
											<div className="flex items-center gap-1.5 text-xs text-vscode-descriptionForeground">
												<span>Linked features:</span>
												<span className="font-medium">{update.linkedFeatures.join(", ")}</span>
											</div>
										)}

										{update.rollbackAvailable && (
											<div className="text-xs text-yellow-400 flex items-center gap-1">
												<RotateCcw className="size-3" />
												Rollback available
											</div>
										)}
									</div>
								</div>
							</div>
						)
					})}
				</div>
			</div>
		</div>
	)
}
