"use client"

import { useState, useCallback, useMemo } from "react"
import { X, Search, Download, Trash2, Check, ExternalLink, Loader2, Puzzle, Star } from "lucide-react"
import type { ExtensionManifest } from "./hooks/useExtensionState"

interface ExtensionsPanelProps {
	onClose?: () => void
	extensions: ExtensionManifest[]
	toggleEnabled: (id: string) => void
	install: (ext: ExtensionManifest) => void
	uninstall: (id: string) => void
}

// ── Built-in extensions ────────────────────────────────────────
const BUILTIN_EXTENSIONS: ExtensionManifest[] = [
	{
		id: "superroo.typescript",
		name: "TypeScript Intelligence",
		version: "1.0.0",
		description: "TypeScript/JavaScript language support with IntelliSense, error diagnostics, and code navigation",
		publisher: "SuperRoo",
		categories: ["Programming Languages", "Linters"],
		tags: ["typescript", "javascript", "intellisense"],
		installed: true,
		enabled: true,
		rating: 5,
		downloads: 1200,
	},
	{
		id: "superroo.python",
		name: "Python Intelligence",
		version: "1.0.0",
		description: "Python language support with IntelliSense, linting, and code navigation",
		publisher: "SuperRoo",
		categories: ["Programming Languages"],
		tags: ["python", "intellisense"],
		installed: true,
		enabled: true,
		rating: 4,
		downloads: 800,
	},
	{
		id: "superroo.git",
		name: "Git Integration",
		version: "1.0.0",
		description: "Built-in Git source control with commit, push, pull, and branch management",
		publisher: "SuperRoo",
		categories: ["Source Control"],
		tags: ["git", "source control"],
		installed: true,
		enabled: true,
		rating: 5,
		downloads: 2000,
	},
	{
		id: "superroo.ai-assistant",
		name: "AI Assistant",
		version: "1.0.0",
		description: "AI-powered code assistance with inline actions, smart suggestions, and code generation",
		publisher: "SuperRoo",
		categories: ["AI", "Programming Languages"],
		tags: ["ai", "assistant", "code generation"],
		installed: true,
		enabled: true,
		rating: 5,
		downloads: 3000,
	},
	{
		id: "superroo.telegram",
		name: "Telegram Integration",
		version: "1.0.0",
		description: "Telegram bot integration for remote monitoring, task management, and notifications",
		publisher: "SuperRoo",
		categories: ["Chat", "Notifications"],
		tags: ["telegram", "chat", "notifications"],
		installed: true,
		enabled: true,
		rating: 4,
		downloads: 500,
	},
	{
		id: "superroo.theme-dark",
		name: "SuperRoo Dark Theme",
		version: "1.0.0",
		description: "Custom dark theme optimized for the SuperRoo dashboard",
		publisher: "SuperRoo",
		categories: ["Themes"],
		tags: ["theme", "dark"],
		installed: true,
		enabled: true,
		rating: 4,
		downloads: 1500,
	},
]

const MARKETPLACE_EXTENSIONS: ExtensionManifest[] = [
	{
		id: "esbenp.prettier",
		name: "Prettier",
		version: "10.4.0",
		description: "Code formatter using prettier",
		publisher: "Prettier",
		categories: ["Formatters"],
		tags: ["formatter", "prettier"],
		rating: 5,
		downloads: 50000,
		repository: "https://github.com/prettier/prettier-vscode",
	},
	{
		id: "dbaeumer.vscode-eslint",
		name: "ESLint",
		version: "3.0.0",
		description: "Integrates ESLint JavaScript into the dashboard",
		publisher: "Microsoft",
		categories: ["Linters"],
		tags: ["linter", "eslint", "javascript"],
		rating: 5,
		downloads: 80000,
		repository: "https://github.com/microsoft/vscode-eslint",
	},
	{
		id: "github.copilot",
		name: "GitHub Copilot",
		version: "1.200.0",
		description: "AI-powered code completions powered by GitHub Copilot",
		publisher: "GitHub",
		categories: ["AI", "Programming Languages"],
		tags: ["ai", "copilot", "completions"],
		rating: 5,
		downloads: 100000,
		repository: "https://github.com/github/copilot-docs",
	},
	{
		id: "ms-python.python",
		name: "Python",
		version: "2024.0.0",
		description: "Python language support with extension access points for debuggers",
		publisher: "Microsoft",
		categories: ["Programming Languages"],
		tags: ["python", "debugger"],
		rating: 4,
		downloads: 90000,
		repository: "https://github.com/microsoft/vscode-python",
	},
	{
		id: "eamodio.gitlens",
		name: "GitLens",
		version: "15.0.0",
		description: "Supercharge Git with insights into code authorship and history",
		publisher: "GitKraken",
		categories: ["Source Control"],
		tags: ["git", "blame", "history"],
		rating: 5,
		downloads: 70000,
		repository: "https://github.com/gitkraken/vscode-gitlens",
	},
]

const CATEGORIES = [
	"All",
	"Installed",
	"AI",
	"Programming Languages",
	"Linters",
	"Formatters",
	"Source Control",
	"Themes",
	"Notifications",
]

// ── Extensions Panel ───────────────────────────────────────────
export default function ExtensionsPanel({
	onClose,
	extensions: installedExtensions,
	toggleEnabled,
	install,
	uninstall,
}: ExtensionsPanelProps) {
	const [searchQuery, setSearchQuery] = useState("")
	const [activeCategory, setActiveCategory] = useState("All")
	const [showMarketplace, setShowMarketplace] = useState(false)
	const [installingId, setInstallingId] = useState<string | null>(null)

	// ── Install from marketplace ───────────────────────────────
	const handleInstall = useCallback(
		async (ext: ExtensionManifest) => {
			setInstallingId(ext.id)
			// Simulate installation delay
			await new Promise((r) => setTimeout(r, 1000))
			install(ext)
			setInstallingId(null)
		},
		[install],
	)

	// ── Filter extensions ──────────────────────────────────────
	const filteredExtensions = useMemo(() => {
		const source = showMarketplace ? MARKETPLACE_EXTENSIONS : installedExtensions
		return source.filter((ext) => {
			const matchesSearch =
				!searchQuery ||
				ext.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
				ext.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
				ext.publisher.toLowerCase().includes(searchQuery.toLowerCase()) ||
				ext.tags?.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()))
			const matchesCategory =
				activeCategory === "All" ||
				(activeCategory === "Installed" && ext.installed) ||
				ext.categories?.includes(activeCategory)
			return matchesSearch && matchesCategory
		})
	}, [showMarketplace, installedExtensions, searchQuery, activeCategory])

	// ── Render ─────────────────────────────────────────────────
	return (
		<div className="flex flex-col h-full bg-[#252526]">
			{/* Header */}
			<div className="flex items-center justify-between px-3 py-1.5 border-b border-[#3c3c3c] bg-[#2d2d2d] shrink-0">
				<div className="flex items-center gap-2">
					<Puzzle size={12} className="text-[#cccccc]" />
					<span className="text-xs font-medium text-[#cccccc]">EXTENSIONS</span>
					<span className="text-[11px] text-[#8b949e]">
						{installedExtensions.filter((e) => e.enabled).length} active
					</span>
				</div>
				<div className="flex items-center gap-1">
					<button
						className={`px-1.5 py-0.5 text-[11px] rounded ${showMarketplace ? "bg-[#094771] text-white" : "text-[#8b949e] hover:text-[#cccccc]"}`}
						onClick={() => setShowMarketplace((v) => !v)}>
						{showMarketplace ? "Installed" : "Marketplace"}
					</button>
					{onClose && (
						<button className="p-0.5 text-[#8b949e] hover:text-[#cccccc] rounded" onClick={onClose}>
							<X size={12} />
						</button>
					)}
				</div>
			</div>

			{/* Search */}
			<div className="px-2 py-1.5 border-b border-[#3c3c3c]">
				<div className="flex items-center gap-1 bg-[#0d1117] border border-[#30363d] rounded px-2 py-1">
					<Search size={12} className="text-[#8b949e] shrink-0" />
					<input
						type="text"
						className="flex-1 bg-transparent text-[11px] text-[#cccccc] outline-none placeholder:text-[#8b949e]"
						placeholder={showMarketplace ? "Search marketplace..." : "Search installed extensions..."}
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
					/>
				</div>
			</div>

			{/* Category tabs */}
			<div className="flex gap-1 px-2 py-1 border-b border-[#3c3c3c] overflow-x-auto shrink-0">
				{CATEGORIES.map((cat) => (
					<button
						key={cat}
						className={`shrink-0 px-2 py-0.5 text-[10px] rounded-full transition-colors ${
							activeCategory === cat
								? "bg-[#094771] text-white"
								: "text-[#8b949e] hover:text-[#cccccc] hover:bg-[#3c3c3c]"
						}`}
						onClick={() => setActiveCategory(cat)}>
						{cat}
					</button>
				))}
			</div>

			{/* Extensions list */}
			<div className="flex-1 overflow-y-auto">
				{filteredExtensions.length === 0 ? (
					<div className="flex items-center justify-center h-full text-[11px] text-[#8b949e]">
						{showMarketplace ? "No extensions found in marketplace" : "No installed extensions"}
					</div>
				) : (
					filteredExtensions.map((ext) => {
						const isInstalled = installedExtensions.some((e) => e.id === ext.id)
						const isEnabled = installedExtensions.find((e) => e.id === ext.id)?.enabled
						const isInstalling = installingId === ext.id

						return (
							<div
								key={ext.id}
								className="flex items-start gap-3 px-3 py-2.5 border-b border-[#3c3c3c] hover:bg-[#2a2d2e]">
								{/* Icon */}
								<div className="w-8 h-8 rounded bg-gradient-to-br from-[#1f6feb] to-[#58a6ff] flex items-center justify-center shrink-0">
									<Puzzle size={14} className="text-white" />
								</div>

								{/* Info */}
								<div className="flex-1 min-w-0">
									<div className="flex items-center gap-2">
										<span className="text-[12px] font-medium text-[#cccccc] truncate">
											{ext.name}
										</span>
										<span className="text-[10px] text-[#8b949e] shrink-0">v{ext.version}</span>
										{ext.rating && (
											<span className="flex items-center gap-0.5 text-[10px] text-yellow-500 shrink-0">
												<Star size={8} fill="currentColor" />
												{ext.rating}
											</span>
										)}
									</div>
									<div className="text-[10px] text-[#8b949e] mt-0.5">
										{ext.publisher}
										{ext.downloads && (
											<span className="ml-2">{(ext.downloads / 1000).toFixed(0)}k downloads</span>
										)}
									</div>
									<p className="text-[11px] text-[#8b949e] mt-1 line-clamp-2">{ext.description}</p>
									{ext.categories && (
										<div className="flex gap-1 mt-1.5 flex-wrap">
											{ext.categories.map((cat) => (
												<span
													key={cat}
													className="px-1.5 py-0.5 text-[9px] bg-[#1e2535] text-[#8b949e] rounded">
													{cat}
												</span>
											))}
										</div>
									)}
								</div>

								{/* Actions */}
								<div className="flex items-center gap-1 shrink-0">
									{showMarketplace ? (
										isInstalled ? (
											<span className="flex items-center gap-1 text-[10px] text-green-500 px-2">
												<Check size={10} /> Installed
											</span>
										) : (
											<button
												className="px-2 py-1 text-[10px] bg-[#1f6feb] text-white rounded hover:bg-[#388bfd] disabled:opacity-50 flex items-center gap-1"
												onClick={() => handleInstall(ext)}
												disabled={isInstalling}>
												{isInstalling ? (
													<Loader2 size={10} className="animate-spin" />
												) : (
													<Download size={10} />
												)}
												{isInstalling ? "Installing..." : "Install"}
											</button>
										)
									) : (
										<>
											{/* Enable/disable toggle */}
											<button
												className={`relative w-7 h-3.5 rounded-full transition-colors ${
													isEnabled ? "bg-[#1f6feb]" : "bg-[#3c3c3c]"
												}`}
												onClick={() => toggleEnabled(ext.id)}
												title={isEnabled ? "Disable" : "Enable"}>
												<div
													className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white transition-transform ${
														isEnabled ? "translate-x-4" : "translate-x-0.5"
													}`}
												/>
											</button>

											{/* Uninstall */}
											<button
												className="p-1 text-[#8b949e] hover:text-red-400 rounded hover:bg-[#3c3c3c]"
												onClick={() => uninstall(ext.id)}
												title="Uninstall">
												<Trash2 size={10} />
											</button>
										</>
									)}
								</div>
							</div>
						)
					})
				)}
			</div>
		</div>
	)
}
