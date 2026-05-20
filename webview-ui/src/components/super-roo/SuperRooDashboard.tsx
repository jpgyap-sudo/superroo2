import { useState } from "react"
import {
	Bug,
	Layers,
	LayoutDashboard,
	ScrollText,
	Settings as SettingsIcon,
	ListChecks,
	History,
	FileJson,
	Key,
	Shield,
	BrainCircuit,
	Terminal,
	Server,
} from "lucide-react"

import { cn } from "@/lib/utils"

import ErrorBoundary from "@src/components/ErrorBoundary"
import { SrProvider, type SrContextValue } from "./hooks/SrContext"
import type { VsCodeLike } from "./messaging/client"
import { BugsTab } from "./tabs/BugsTab"
import { DashboardTab } from "./tabs/DashboardTab"
import { FeaturesTab } from "./tabs/FeaturesTab"
import { LogsTab } from "./tabs/LogsTab"
import { SettingsTab } from "./tabs/SettingsTab"
import { ProductFeaturesTab } from "./tabs/ProductFeaturesTab"
import { ProductUpdatesTab } from "./tabs/ProductUpdatesTab"
import { MemoryLogTab } from "./tabs/MemoryLogTab"
import { ApiKeysProvidersTab } from "./tabs/settings/ApiKeysProvidersTab"
import { AdvancedVpsSettingsTab } from "./tabs/settings/AdvancedVpsSettingsTab"
import { ModelRouterView } from "./tabs/ModelRouterView"
import { IdeTerminalView } from "./tabs/IdeTerminalView"
import { VpsHealthTab } from "./tabs/VpsHealthTab"

export interface SuperRooDashboardProps {
	/** Optional: inject the host's VsCode wrapper. If unset, the context auto-detects (and falls back to mock data). */
	vscode?: VsCodeLike
	/** Force mock-data mode (e.g. for Storybook or screenshots). */
	forceMock?: boolean
	/** Initial active tab. */
	initialTab?: TabId
	className?: string
}

type TabId =
	| "dashboard"
	| "features"
	| "bugs"
	| "logs"
	| "vps-health"
	| "settings"
	| "api-keys"
	| "model-router"
	| "ide-terminal"
	| "advanced-vps"
	| "product-features"
	| "product-updates"
	| "memory-log"

const TABS: Array<{ id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }> = [
	{ id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
	{ id: "features", label: "Features", icon: Layers },
	{ id: "bugs", label: "Bugs", icon: Bug },
	{ id: "logs", label: "Logs", icon: ScrollText },
	{ id: "vps-health", label: "VPS Health", icon: Server },
	{ id: "settings", label: "Settings", icon: SettingsIcon },
	// Settings sub-tabs
	{ id: "api-keys", label: "API Keys", icon: Key },
	{ id: "model-router", label: "AI Model Router", icon: BrainCircuit },
	// NOTE: ide-terminal is hidden until backend wiring is complete
	// { id: "ide-terminal", label: "IDE Terminal", icon: Terminal },
	{ id: "advanced-vps", label: "VPS Settings", icon: Shield },
	// Product Memory tabs
	// NOTE: product-features and product-updates are hidden until backend wiring is complete
	// { id: "product-features", label: "Product Features", icon: ListChecks },
	// { id: "product-updates", label: "Updates", icon: History },
	{ id: "memory-log", label: "Memory Log", icon: FileJson },
]

export function SuperRooDashboard({ vscode, forceMock, initialTab = "dashboard", className }: SuperRooDashboardProps) {
	const [active, setActive] = useState<TabId>(initialTab)

	return (
		<SrProvider vscode={vscode} forceMock={forceMock}>
			<div className={cn("flex flex-col h-full bg-vscode-editor-background text-vscode-foreground", className)}>
				<nav
					role="tablist"
					aria-label="Super Roo tabs"
					className="flex border-b border-vscode-panel-border bg-vscode-sideBar-background overflow-x-auto">
					{TABS.map(({ id, label, icon: Icon }) => {
						const isActive = active === id
						return (
							<button
								key={id}
								role="tab"
								type="button"
								aria-selected={isActive}
								onClick={() => setActive(id)}
								className={cn(
									"inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors shrink-0",
									isActive
										? "border-vscode-focusBorder text-vscode-foreground"
										: "border-transparent text-vscode-descriptionForeground hover:text-vscode-foreground",
								)}>
								<Icon className="size-3.5" />
								{label}
							</button>
						)
					})}
				</nav>
				<div className="flex-1 min-h-0 overflow-auto" role="tabpanel">
					{active === "dashboard" && (
						<ErrorBoundary>
							<DashboardTab />
						</ErrorBoundary>
					)}
					{active === "features" && (
						<ErrorBoundary>
							<FeaturesTab />
						</ErrorBoundary>
					)}
					{active === "bugs" && (
						<ErrorBoundary>
							<BugsTab />
						</ErrorBoundary>
					)}
					{active === "logs" && (
						<ErrorBoundary>
							<LogsTab />
						</ErrorBoundary>
					)}
					{active === "vps-health" && (
						<ErrorBoundary>
							<VpsHealthTab />
						</ErrorBoundary>
					)}
					{active === "settings" && (
						<ErrorBoundary>
							<SettingsTab />
						</ErrorBoundary>
					)}
					{active === "api-keys" && (
						<ErrorBoundary>
							<ApiKeysProvidersTab />
						</ErrorBoundary>
					)}
					{active === "model-router" && (
						<ErrorBoundary>
							<ModelRouterView />
						</ErrorBoundary>
					)}
					{active === "ide-terminal" && (
						<ErrorBoundary>
							<IdeTerminalView />
						</ErrorBoundary>
					)}
					{active === "advanced-vps" && (
						<ErrorBoundary>
							<AdvancedVpsSettingsTab />
						</ErrorBoundary>
					)}
					{active === "product-features" && (
						<ErrorBoundary>
							<ProductFeaturesTab />
						</ErrorBoundary>
					)}
					{active === "product-updates" && (
						<ErrorBoundary>
							<ProductUpdatesTab />
						</ErrorBoundary>
					)}
					{active === "memory-log" && (
						<ErrorBoundary>
							<MemoryLogTab />
						</ErrorBoundary>
					)}
				</div>
			</div>
		</SrProvider>
	)
}

// Re-export the context value type for any host code that wants to type
// its message-routing layer against it.
export type { SrContextValue }
