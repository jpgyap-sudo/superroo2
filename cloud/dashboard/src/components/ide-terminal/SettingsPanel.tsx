"use client"

import { useState, useCallback, useEffect } from "react"
import { X, Search, ChevronRight, RotateCcw } from "lucide-react"

// ── Types ──────────────────────────────────────────────────────
interface SettingItem {
	id: string
	label: string
	description: string
	type: "toggle" | "number" | "string" | "dropdown" | "color"
	value: any
	defaultValue: any
	category: string
	options?: { label: string; value: string }[] // for dropdown
	min?: number
	max?: number
}

interface SettingsPanelProps {
	onClose?: () => void
}

// ── Default settings ───────────────────────────────────────────
const DEFAULT_SETTINGS: SettingItem[] = [
	// Editor
	{
		id: "editor.fontSize",
		label: "Font Size",
		description: "Controls the editor font size",
		type: "number",
		value: 13,
		defaultValue: 13,
		category: "Editor",
		min: 10,
		max: 24,
	},
	{
		id: "editor.fontFamily",
		label: "Font Family",
		description: "Controls the editor font family",
		type: "string",
		value: "'JetBrains Mono', 'Cascadia Code', monospace",
		defaultValue: "'JetBrains Mono', 'Cascadia Code', monospace",
		category: "Editor",
	},
	{
		id: "editor.tabSize",
		label: "Tab Size",
		description: "Number of spaces for a tab",
		type: "number",
		value: 2,
		defaultValue: 2,
		category: "Editor",
		min: 1,
		max: 8,
	},
	{
		id: "editor.wordWrap",
		label: "Word Wrap",
		description: "Controls word wrapping",
		type: "dropdown",
		value: "on",
		defaultValue: "on",
		category: "Editor",
		options: [
			{ label: "On", value: "on" },
			{ label: "Off", value: "off" },
			{ label: "Word Wrap Column", value: "wordWrapColumn" },
			{ label: "Bounded", value: "bounded" },
		],
	},
	{
		id: "editor.minimap",
		label: "Minimap",
		description: "Show the minimap",
		type: "toggle",
		value: true,
		defaultValue: true,
		category: "Editor",
	},
	{
		id: "editor.breadcrumbs",
		label: "Breadcrumbs",
		description: "Show file breadcrumbs",
		type: "toggle",
		value: true,
		defaultValue: true,
		category: "Editor",
	},
	{
		id: "editor.lineNumbers",
		label: "Line Numbers",
		description: "Show line numbers",
		type: "toggle",
		value: true,
		defaultValue: true,
		category: "Editor",
	},
	{
		id: "editor.cursorBlinking",
		label: "Cursor Blinking",
		description: "Cursor animation style",
		type: "dropdown",
		value: "smooth",
		defaultValue: "smooth",
		category: "Editor",
		options: [
			{ label: "Smooth", value: "smooth" },
			{ label: "Blink", value: "blink" },
			{ label: "Phase", value: "phase" },
			{ label: "Expand", value: "expand" },
			{ label: "Solid", value: "solid" },
		],
	},
	{
		id: "editor.mouseWheelZoom",
		label: "Mouse Wheel Zoom",
		description: "Zoom editor with Ctrl+Mouse Wheel",
		type: "toggle",
		value: true,
		defaultValue: true,
		category: "Editor",
	},
	{
		id: "editor.formatOnPaste",
		label: "Format On Paste",
		description: "Auto-format pasted code",
		type: "toggle",
		value: true,
		defaultValue: true,
		category: "Editor",
	},
	{
		id: "editor.suggestOnTrigger",
		label: "Suggest On Trigger Characters",
		description: "Show suggestions when typing trigger characters",
		type: "toggle",
		value: true,
		defaultValue: true,
		category: "Editor",
	},
	{
		id: "editor.quickSuggestions",
		label: "Quick Suggestions",
		description: "Show suggestions as you type",
		type: "toggle",
		value: true,
		defaultValue: true,
		category: "Editor",
	},

	// Terminal
	{
		id: "terminal.fontSize",
		label: "Terminal Font Size",
		description: "Controls the terminal font size",
		type: "number",
		value: 12,
		defaultValue: 12,
		category: "Terminal",
		min: 10,
		max: 24,
	},
	{
		id: "terminal.scrollback",
		label: "Scrollback Lines",
		description: "Number of lines to keep in terminal history",
		type: "number",
		value: 5000,
		defaultValue: 5000,
		category: "Terminal",
		min: 100,
		max: 50000,
	},
	{
		id: "terminal.cursorStyle",
		label: "Cursor Style",
		description: "Terminal cursor appearance",
		type: "dropdown",
		value: "block",
		defaultValue: "block",
		category: "Terminal",
		options: [
			{ label: "Block", value: "block" },
			{ label: "Line", value: "line" },
			{ label: "Underline", value: "underline" },
		],
	},
	{
		id: "terminal.theme",
		label: "Terminal Theme",
		description: "Color theme for terminal output",
		type: "dropdown",
		value: "dark",
		defaultValue: "dark",
		category: "Terminal",
		options: [
			{ label: "Dark (Default)", value: "dark" },
			{ label: "Light", value: "light" },
			{ label: "Green on Black", value: "green-on-black" },
			{ label: "Amber on Black", value: "amber-on-black" },
			{ label: "Solarized Dark", value: "solarized-dark" },
			{ label: "Solarized Light", value: "solarized-light" },
			{ label: "Dracula", value: "dracula" },
			{ label: "Nord", value: "nord" },
		],
	},
	{
		id: "terminal.foreground",
		label: "Terminal Foreground",
		description: "Custom terminal text color",
		type: "color",
		value: "#e6edf3",
		defaultValue: "#e6edf3",
		category: "Terminal",
	},
	{
		id: "terminal.background",
		label: "Terminal Background",
		description: "Custom terminal background color",
		type: "color",
		value: "#0d1117",
		defaultValue: "#0d1117",
		category: "Terminal",
	},
	{
		id: "terminal.selectionBackground",
		label: "Selection Background",
		description: "Terminal selection highlight color",
		type: "color",
		value: "#1f6feb44",
		defaultValue: "#1f6feb44",
		category: "Terminal",
	},
	{
		id: "terminal.cursorColor",
		label: "Cursor Color",
		description: "Terminal cursor color",
		type: "color",
		value: "#3fb950",
		defaultValue: "#3fb950",
		category: "Terminal",
	},
	{
		id: "terminal.ansiBlack",
		label: "ANSI Black",
		description: "ANSI color 0 (black)",
		type: "color",
		value: "#0d1117",
		defaultValue: "#0d1117",
		category: "Terminal",
	},
	{
		id: "terminal.ansiRed",
		label: "ANSI Red",
		description: "ANSI color 1 (red)",
		type: "color",
		value: "#f85149",
		defaultValue: "#f85149",
		category: "Terminal",
	},
	{
		id: "terminal.ansiGreen",
		label: "ANSI Green",
		description: "ANSI color 2 (green)",
		type: "color",
		value: "#3fb950",
		defaultValue: "#3fb950",
		category: "Terminal",
	},
	{
		id: "terminal.ansiYellow",
		label: "ANSI Yellow",
		description: "ANSI color 3 (yellow)",
		type: "color",
		value: "#d29922",
		defaultValue: "#d29922",
		category: "Terminal",
	},
	{
		id: "terminal.ansiBlue",
		label: "ANSI Blue",
		description: "ANSI color 4 (blue)",
		type: "color",
		value: "#58a6ff",
		defaultValue: "#58a6ff",
		category: "Terminal",
	},
	{
		id: "terminal.ansiMagenta",
		label: "ANSI Magenta",
		description: "ANSI color 5 (magenta)",
		type: "color",
		value: "#bc8cff",
		defaultValue: "#bc8cff",
		category: "Terminal",
	},
	{
		id: "terminal.ansiCyan",
		label: "ANSI Cyan",
		description: "ANSI color 6 (cyan)",
		type: "color",
		value: "#39d2c0",
		defaultValue: "#39d2c0",
		category: "Terminal",
	},
	{
		id: "terminal.ansiWhite",
		label: "ANSI White",
		description: "ANSI color 7 (white)",
		type: "color",
		value: "#e6edf3",
		defaultValue: "#e6edf3",
		category: "Terminal",
	},
	{
		id: "terminal.ansiBrightBlack",
		label: "ANSI Bright Black",
		description: "ANSI color 8 (bright black)",
		type: "color",
		value: "#484f58",
		defaultValue: "#484f58",
		category: "Terminal",
	},
	{
		id: "terminal.ansiBrightRed",
		label: "ANSI Bright Red",
		description: "ANSI color 9 (bright red)",
		type: "color",
		value: "#ff7b72",
		defaultValue: "#ff7b72",
		category: "Terminal",
	},
	{
		id: "terminal.ansiBrightGreen",
		label: "ANSI Bright Green",
		description: "ANSI color 10 (bright green)",
		type: "color",
		value: "#7ee787",
		defaultValue: "#7ee787",
		category: "Terminal",
	},
	{
		id: "terminal.ansiBrightYellow",
		label: "ANSI Bright Yellow",
		description: "ANSI color 11 (bright yellow)",
		type: "color",
		value: "#d29922",
		defaultValue: "#d29922",
		category: "Terminal",
	},
	{
		id: "terminal.ansiBrightBlue",
		label: "ANSI Bright Blue",
		description: "ANSI color 12 (bright blue)",
		type: "color",
		value: "#58a6ff",
		defaultValue: "#58a6ff",
		category: "Terminal",
	},
	{
		id: "terminal.ansiBrightMagenta",
		label: "ANSI Bright Magenta",
		description: "ANSI color 13 (bright magenta)",
		type: "color",
		value: "#d2a8ff",
		defaultValue: "#d2a8ff",
		category: "Terminal",
	},
	{
		id: "terminal.ansiBrightCyan",
		label: "ANSI Bright Cyan",
		description: "ANSI color 14 (bright cyan)",
		type: "color",
		value: "#56d4dd",
		defaultValue: "#56d4dd",
		category: "Terminal",
	},
	{
		id: "terminal.ansiBrightWhite",
		label: "ANSI Bright White",
		description: "ANSI color 15 (bright white)",
		type: "color",
		value: "#f0f6fc",
		defaultValue: "#f0f6fc",
		category: "Terminal",
	},

	// AI
	{
		id: "ai.autoSuggest",
		label: "Auto Suggestions",
		description: "Show AI suggestions automatically",
		type: "toggle",
		value: true,
		defaultValue: true,
		category: "AI",
	},
	{
		id: "ai.inlineActions",
		label: "Inline Actions",
		description: "Show AI actions on text selection",
		type: "toggle",
		value: true,
		defaultValue: true,
		category: "AI",
	},
	{
		id: "ai.contextLines",
		label: "Context Lines",
		description: "Number of context lines to include in AI requests",
		type: "number",
		value: 10,
		defaultValue: 10,
		category: "AI",
		min: 0,
		max: 50,
	},

	// Git
	{
		id: "git.autoFetch",
		label: "Auto Fetch",
		description: "Automatically fetch from remote",
		type: "toggle",
		value: true,
		defaultValue: true,
		category: "Git",
	},
	{
		id: "git.fetchInterval",
		label: "Fetch Interval (seconds)",
		description: "How often to fetch from remote",
		type: "number",
		value: 60,
		defaultValue: 60,
		category: "Git",
		min: 10,
		max: 600,
	},
]

const CATEGORIES = ["Editor", "Terminal", "AI", "Git"]

// ── Settings Panel ─────────────────────────────────────────────
export default function SettingsPanel({ onClose }: SettingsPanelProps) {
	const [settings, setSettings] = useState<SettingItem[]>(() => {
		// Load from localStorage
		try {
			const saved = localStorage.getItem("superroo-settings")
			if (saved) {
				const parsed = JSON.parse(saved)
				return DEFAULT_SETTINGS.map((s) => ({
					...s,
					value: parsed[s.id] !== undefined ? parsed[s.id] : s.value,
				}))
			}
		} catch {}
		return DEFAULT_SETTINGS
	})
	const [searchQuery, setSearchQuery] = useState("")
	const [activeCategory, setActiveCategory] = useState("Editor")
	const [savedToast, setSavedToast] = useState(false)

	// ── Save to localStorage ───────────────────────────────────
	const saveSettings = useCallback((newSettings: SettingItem[]) => {
		setSettings(newSettings)
		const obj: Record<string, any> = {}
		for (const s of newSettings) {
			obj[s.id] = s.value
		}
		localStorage.setItem("superroo-settings", JSON.stringify(obj))
		setSavedToast(true)
		setTimeout(() => setSavedToast(false), 2000)
	}, [])

	// ── Update a setting ───────────────────────────────────────
	const updateSetting = useCallback(
		(id: string, newValue: any) => {
			const newSettings = settings.map((s) => (s.id === id ? { ...s, value: newValue } : s))
			saveSettings(newSettings)
		},
		[settings, saveSettings],
	)

	// ── Reset to defaults ──────────────────────────────────────
	const resetDefaults = useCallback(() => {
		saveSettings(DEFAULT_SETTINGS.map((s) => ({ ...s })))
	}, [saveSettings])

	// ── Reset single setting ───────────────────────────────────
	const resetSetting = useCallback(
		(id: string) => {
			const def = DEFAULT_SETTINGS.find((s) => s.id === id)
			if (def) updateSetting(id, def.defaultValue)
		},
		[updateSetting],
	)

	// ── Filter settings ────────────────────────────────────────
	const filteredSettings = settings.filter((s) => {
		const matchesSearch =
			!searchQuery ||
			s.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
			s.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
			s.id.toLowerCase().includes(searchQuery.toLowerCase())
		const matchesCategory = s.category === activeCategory
		return matchesSearch && matchesCategory
	})

	// ── Render setting control ─────────────────────────────────
	const renderControl = (setting: SettingItem) => {
		switch (setting.type) {
			case "toggle":
				return (
					<button
						className={`relative w-8 h-4 rounded-full transition-colors ${
							setting.value ? "bg-[#1f6feb]" : "bg-[#3c3c3c]"
						}`}
						onClick={() => updateSetting(setting.id, !setting.value)}>
						<div
							className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
								setting.value ? "translate-x-4" : "translate-x-0.5"
							}`}
						/>
					</button>
				)

			case "number":
				return (
					<div className="flex items-center gap-1">
						<input
							type="number"
							className="w-16 bg-[#0d1117] text-[11px] text-[#cccccc] border border-[#30363d] rounded px-1.5 py-0.5 outline-none focus:border-[#1f6feb]"
							value={setting.value}
							min={setting.min}
							max={setting.max}
							onChange={(e) =>
								updateSetting(setting.id, parseInt(e.target.value) || setting.defaultValue)
							}
						/>
						{setting.min !== undefined && setting.max !== undefined && (
							<input
								type="range"
								className="w-16 accent-[#1f6feb]"
								min={setting.min}
								max={setting.max}
								value={setting.value}
								onChange={(e) => updateSetting(setting.id, parseInt(e.target.value))}
							/>
						)}
					</div>
				)

			case "string":
				return (
					<input
						type="text"
						className="flex-1 max-w-[200px] bg-[#0d1117] text-[11px] text-[#cccccc] border border-[#30363d] rounded px-1.5 py-0.5 outline-none focus:border-[#1f6feb]"
						value={setting.value}
						onChange={(e) => updateSetting(setting.id, e.target.value)}
					/>
				)

			case "dropdown":
				return (
					<select
						className="bg-[#0d1117] text-[11px] text-[#cccccc] border border-[#30363d] rounded px-1.5 py-0.5 outline-none focus:border-[#1f6feb]"
						value={setting.value}
						onChange={(e) => updateSetting(setting.id, e.target.value)}>
						{setting.options?.map((opt) => (
							<option key={opt.value} value={opt.value}>
								{opt.label}
							</option>
						))}
					</select>
				)

			case "color":
				return (
					<input
						type="color"
						className="w-8 h-6 p-0 border border-[#30363d] rounded cursor-pointer bg-transparent"
						value={setting.value}
						onChange={(e) => updateSetting(setting.id, e.target.value)}
					/>
				)

			default:
				return null
		}
	}

	// ── Render ─────────────────────────────────────────────────
	return (
		<div className="flex flex-col h-full bg-[#252526]">
			{/* Header */}
			<div className="flex items-center justify-between px-3 py-1.5 border-b border-[#3c3c3c] bg-[#2d2d2d] shrink-0">
				<div className="flex items-center gap-2">
					<span className="text-xs font-medium text-[#cccccc]">SETTINGS</span>
					{savedToast && <span className="text-[11px] text-green-500">Saved ✓</span>}
				</div>
				<div className="flex items-center gap-1">
					<button
						className="flex items-center gap-1 px-1.5 py-0.5 text-[11px] text-[#8b949e] hover:text-[#cccccc] rounded hover:bg-[#3c3c3c]"
						onClick={resetDefaults}
						title="Reset to defaults">
						<RotateCcw size={10} />
						Reset
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
						placeholder="Search settings..."
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
					/>
				</div>
			</div>

			{/* Body: category sidebar + settings list */}
			<div className="flex flex-1 overflow-hidden">
				{/* Category sidebar */}
				<div className="w-28 shrink-0 border-r border-[#3c3c3c] bg-[#2d2d2d] overflow-y-auto">
					{CATEGORIES.map((cat) => (
						<button
							key={cat}
							className={`w-full text-left px-3 py-1.5 text-[11px] transition-colors ${
								activeCategory === cat
									? "bg-[#094771] text-white"
									: "text-[#8b949e] hover:text-[#cccccc] hover:bg-[#3c3c3c]"
							}`}
							onClick={() => setActiveCategory(cat)}>
							{cat}
						</button>
					))}
				</div>

				{/* Settings list */}
				<div className="flex-1 overflow-y-auto">
					{filteredSettings.length === 0 ? (
						<div className="flex items-center justify-center h-full text-[11px] text-[#8b949e]">
							No settings found
						</div>
					) : (
						filteredSettings.map((setting) => (
							<div
								key={setting.id}
								className="flex items-center justify-between px-3 py-2 border-b border-[#3c3c3c] hover:bg-[#2a2d2e]">
								<div className="flex-1 min-w-0">
									<div className="flex items-center gap-1">
										<span className="text-[11px] text-[#cccccc]">{setting.label}</span>
										<button
											className="opacity-0 hover:opacity-100 text-[#8b949e] hover:text-[#cccccc]"
											onClick={() => resetSetting(setting.id)}
											title="Reset to default">
											<RotateCcw size={8} />
										</button>
									</div>
									<div className="text-[10px] text-[#8b949e] truncate">{setting.description}</div>
								</div>
								<div className="shrink-0 ml-2">{renderControl(setting)}</div>
							</div>
						))
					)}
				</div>
			</div>
		</div>
	)
}
