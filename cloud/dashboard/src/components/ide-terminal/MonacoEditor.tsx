"use client"

import { useRef, useEffect, useCallback, useState, useMemo } from "react"
import { Loader2, Save, Bug, MessageCircle, Zap, Search } from "lucide-react"

// ── Types ──────────────────────────────────────────────────────
interface MonacoEditorProps {
	value: string
	language?: string
	filePath?: string | null
	onChange?: (value: string) => void
	onSave?: (value: string) => void
	readOnly?: boolean
	height?: string
	onCursorChange?: (line: number, column: number) => void
	onSelectionChange?: (selectedText: string, line: number, column: number) => void
	onMarkersChange?: (markers: any[]) => void
}

interface InlineAction {
	id: string
	label: string
	icon: React.ReactNode
	action: (text: string) => void
}

// ── Language detection ─────────────────────────────────────────
const LANGUAGE_MAP: Record<string, string> = {
	ts: "typescript",
	tsx: "typescript",
	js: "javascript",
	jsx: "javascript",
	py: "python",
	html: "html",
	css: "css",
	json: "json",
	md: "markdown",
	txt: "plaintext",
	yaml: "yaml",
	yml: "yaml",
	sql: "sql",
	sh: "shell",
	bash: "shell",
	rs: "rust",
	go: "go",
	rb: "ruby",
	php: "php",
	java: "java",
	kt: "kotlin",
	swift: "swift",
	c: "c",
	cpp: "cpp",
	h: "c",
	hpp: "cpp",
}

function detectLanguage(filePath?: string | null): string {
	if (!filePath) return "plaintext"
	const ext = filePath.split(".").pop()?.toLowerCase()
	return LANGUAGE_MAP[ext || ""] || "plaintext"
}

// ── Monaco Editor Component ────────────────────────────────────
export default function MonacoEditor({
	value,
	language,
	filePath,
	onChange,
	onSave,
	readOnly = false,
	height = "100%",
	onCursorChange,
	onSelectionChange,
	onMarkersChange,
}: MonacoEditorProps) {
	const editorRef = useRef<any>(null)
	const monacoRef = useRef<any>(null)
	const containerRef = useRef<HTMLDivElement>(null)
	const [isDirty, setIsDirty] = useState(false)
	const [isMounted, setIsMounted] = useState(false)
	const [showMinimap, setShowMinimap] = useState(true)
	const [showBreadcrumbs, setShowBreadcrumbs] = useState(true)
	const [wordWrap, setWordWrap] = useState<"on" | "off">("on")
	const [fontSize, setFontSize] = useState(13)
	const [inlineActions, setInlineActions] = useState<{ top: number; left: number; text: string } | null>(null)
	const [MonacoEditorInner, setMonacoEditorInner] = useState<any>(null)

	const lang = language || detectLanguage(filePath)

	// ── Lazy-load @monaco-editor/react on mount (client-side only) ──
	useEffect(() => {
		let cancelled = false
		import("@monaco-editor/react").then((mod) => {
			if (!cancelled) {
				setMonacoEditorInner(() => mod.default)
			}
		})
		return () => {
			cancelled = true
		}
	}, [])

	// ── Monaco will mount handler ──────────────────────────────
	const handleBeforeMount: any = useCallback((monaco: any) => {
		monacoRef.current = monaco

		// Define a custom dark theme matching the dashboard
		monaco.editor.defineTheme("superroo-dark", {
			base: "vs-dark",
			inherit: true,
			rules: [
				{ token: "comment", foreground: "6a9955", fontStyle: "italic" },
				{ token: "keyword", foreground: "569cd6" },
				{ token: "string", foreground: "ce9178" },
				{ token: "number", foreground: "b5cea8" },
				{ token: "type", foreground: "4ec9b0" },
				{ token: "function", foreground: "dcdcaa" },
				{ token: "variable", foreground: "9cdcfe" },
				{ token: "constant", foreground: "4fc1ff" },
				{ token: "regexp", foreground: "d16969" },
				{ token: "tag", foreground: "569cd6" },
				{ token: "attribute", foreground: "9cdcfe" },
				{ token: "delimiter", foreground: "808080" },
			],
			colors: {
				"editor.background": "#0d1117",
				"editor.foreground": "#e6edf3",
				"editor.lineHighlightBackground": "#161b22",
				"editor.selectionBackground": "#264f78",
				"editor.inactiveSelectionBackground": "#264f7855",
				"editorCursor.foreground": "#528bff",
				"editorLineNumber.foreground": "#484f58",
				"editorLineNumber.activeForeground": "#e6edf3",
				"editor.selectionHighlightBackground": "#264f7844",
				"editorBracketMatch.background": "#264f7844",
				"editorBracketMatch.border": "#88888844",
				"editorGutter.background": "#0d1117",
				"editorWidget.background": "#161b22",
				"editorWidget.border": "#30363d",
				"input.background": "#0d1117",
				"input.border": "#30363d",
				"input.foreground": "#e6edf3",
				"list.activeSelectionBackground": "#1f6feb33",
				"list.hoverBackground": "#1f6feb22",
				"minimap.background": "#0d1117",
				"scrollbar.shadow": "#00000000",
				"scrollbarSlider.background": "#484f5844",
				"scrollbarSlider.hoverBackground": "#484f5866",
				"scrollbarSlider.activeBackground": "#484f5888",
			},
		})
	}, [])

	// ── Monaco mounted handler ─────────────────────────────────
	const handleMount: any = useCallback(
		(editorInstance: any, monaco: any) => {
			editorRef.current = editorInstance
			monacoRef.current = monaco
			setIsMounted(true)

			// Listen for cursor position changes
			editorInstance.onDidChangeCursorPosition((e: any) => {
				onCursorChange?.(e.position.lineNumber, e.position.column)
			})

			// Listen for selection changes (for inline actions)
			editorInstance.onDidChangeCursorSelection((e: any) => {
				const selection = e.selection
				const model = editorInstance.getModel()
				if (!model) return

				const selectedText = model.getValueInRange(selection)
				if (selectedText && !selection.isEmpty()) {
					const pos = editorInstance.getScrolledVisiblePosition({
						lineNumber: selection.positionLineNumber,
						column: selection.positionColumn,
					})
					if (pos) {
						setInlineActions({
							top: pos.top + 22,
							left: pos.left,
							text: selectedText,
						})
					}
				} else {
					setInlineActions(null)
				}

				onSelectionChange?.(
					selectedText,
					selection.positionLineNumber,
					selection.positionColumn,
				)
			})

			// Listen for markers (errors/warnings)
			monaco.editor.onDidChangeMarkers(([resource]: any) => {
				if (resource && onMarkersChange) {
					const markers = monaco.editor.getModelMarkers({ resource })
					onMarkersChange(markers)
				}
			})

			// Ctrl+S to save
			editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
				const val = editorInstance.getValue()
				onSave?.(val)
				setIsDirty(false)
			})

			// Focus the editor
			editorInstance.focus()
		},
		[onCursorChange, onSelectionChange, onMarkersChange, onSave],
	)

	// ── Sync external value changes ────────────────────────────
	useEffect(() => {
		const editor = editorRef.current
		if (!editor) return
		const current = editor.getValue()
		if (current !== value) {
			editor.setValue(value)
			setIsDirty(false)
		}
	}, [value])

	// ── Handle editor changes ──────────────────────────────────
	const handleChange = useCallback(
		(val: string | undefined) => {
			if (val !== undefined) {
				setIsDirty(val !== value)
				onChange?.(val)
			}
		},
		[value, onChange],
	)

	// ── Editor options ─────────────────────────────────────────
	const editorOptions = useMemo<any>(
		() => ({
			theme: "superroo-dark",
			fontSize,
			fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace",
			minimap: { enabled: showMinimap },
			automaticLayout: true,
			scrollBeyondLastLine: false,
			renderLineHighlight: "all",
			bracketPairColorization: { enabled: true },
			wordWrap,
			readOnly,
			lineNumbers: "on",
			tabSize: 2,
			insertSpaces: true,
			cursorBlinking: "smooth",
			cursorSmoothCaretAnimation: "on",
			smoothScrolling: true,
			folding: true,
			foldingHighlight: true,
			renderWhitespace: "selection",
			roundedSelection: true,
			occurrencesHighlight: "singleFile",
			selectionHighlight: true,
			codeLens: true,
			formatOnPaste: true,
			suggestOnTriggerCharacters: true,
			quickSuggestions: true,
			parameterHints: { enabled: true },
			hover: { enabled: true, delay: 300 },
			lightbulb: { enabled: !readOnly },
			links: true,
			colorDecorators: true,
			inlineSuggest: { enabled: true },
			multiCursorModifier: "alt",
			mouseWheelZoom: true,
		}),
		[fontSize, showMinimap, wordWrap, readOnly],
	)

	// ── Inline action handlers ─────────────────────────────────
	const handleInlineAction = useCallback(
		(actionId: string) => {
			if (!inlineActions) return
			onSelectionChange?.(inlineActions.text, 0, 0)
			setInlineActions(null)
		},
		[inlineActions, onSelectionChange],
	)

	// ── Render ─────────────────────────────────────────────────
	return (
		<div className="flex flex-col h-full">
			{/* Editor toolbar */}
			<div className="flex items-center justify-between px-2 py-1 border-b border-[#30363d] bg-[#0d1117] shrink-0">
				<div className="flex items-center gap-2 text-[11px] text-[#8b949e]">
					<span className="text-[#519aba] font-medium">{lang}</span>
					{filePath && <span className="truncate max-w-[200px]">{filePath}</span>}
					{isDirty && <span className="text-[#d29922]">● unsaved</span>}
				</div>
				<div className="flex items-center gap-1">
					{/* Font size controls */}
					<div className="flex items-center gap-0.5 mr-2">
						<button
							className="px-1 py-0.5 text-[11px] text-[#8b949e] hover:text-[#e6edf3] rounded hover:bg-[#21262d]"
							onClick={() => setFontSize((s) => Math.max(10, s - 1))}
							title="Decrease font size">
							A-
						</button>
						<span className="text-[11px] text-[#8b949e] w-4 text-center">{fontSize}</span>
						<button
							className="px-1 py-0.5 text-[11px] text-[#8b949e] hover:text-[#e6edf3] rounded hover:bg-[#21262d]"
							onClick={() => setFontSize((s) => Math.min(24, s + 1))}
							title="Increase font size">
							A+
						</button>
					</div>

					{/* Minimap toggle */}
					<button
						className={`px-1.5 py-0.5 text-[11px] rounded ${showMinimap ? "bg-[#21262d] text-[#e6edf3]" : "text-[#8b949e] hover:text-[#e6edf3]"}`}
						onClick={() => setShowMinimap((v) => !v)}
						title="Toggle minimap">
						Map
					</button>

					{/* Breadcrumbs toggle */}
					<button
						className={`px-1.5 py-0.5 text-[11px] rounded ${showBreadcrumbs ? "bg-[#21262d] text-[#e6edf3]" : "text-[#8b949e] hover:text-[#e6edf3]"}`}
						onClick={() => setShowBreadcrumbs((v) => !v)}
						title="Toggle breadcrumbs">
						Path
					</button>

					{/* Word wrap toggle */}
					<button
						className={`px-1.5 py-0.5 text-[11px] rounded ${wordWrap === "on" ? "bg-[#21262d] text-[#e6edf3]" : "text-[#8b949e] hover:text-[#e6edf3]"}`}
						onClick={() => setWordWrap((v) => (v === "on" ? "off" : "on"))}
						title="Toggle word wrap">
						Wrap
					</button>

					{/* Save button */}
					{!readOnly && onSave && (
						<button
							className={`flex items-center gap-1 px-2 py-0.5 text-[11px] rounded transition-colors ${
								isDirty
									? "bg-[#1f6feb] text-white hover:bg-[#388bfd]"
									: "text-[#8b949e] hover:text-[#e6edf3]"
							}`}
							onClick={() => {
								const val = editorRef.current?.getValue()
								if (val !== undefined) {
									onSave(val)
									setIsDirty(false)
								}
							}}
							disabled={!isDirty}
							title="Save (Ctrl+S)">
							<Save className="w-3 h-3" />
							Save
						</button>
					)}
				</div>
			</div>

			{/* Monaco Editor */}
			<div className="flex-1 overflow-hidden relative" ref={containerRef} style={{ height }}>
				{MonacoEditorInner ? (
					<MonacoEditorInner
						height="100%"
						language={lang}
						value={value}
						options={editorOptions}
						beforeMount={handleBeforeMount}
						onMount={handleMount}
						onChange={handleChange}
						loading={
							<div className="flex items-center justify-center h-full bg-[#0d1117]">
								<Loader2 className="w-5 h-5 animate-spin text-[#8b949e]" />
							</div>
						}
					/>
				) : (
					<div className="flex items-center justify-center h-full bg-[#0d1117]">
						<Loader2 className="w-5 h-5 animate-spin text-[#8b949e]" />
					</div>
				)}

				{/* Inline AI actions (appear on text selection) */}
				{inlineActions && !readOnly && (
					<div
						className="absolute z-50 flex items-center gap-1 bg-[#21262d] border border-[#30363d] rounded-md shadow-lg px-1 py-0.5"
						style={{
							top: inlineActions.top,
							left: inlineActions.left,
						}}>
						<button
							onClick={() => handleInlineAction("fix")}
							className="p-1 text-xs text-gray-400 hover:text-yellow-400 hover:bg-[#30363d] rounded"
							title="Fix">
							<Bug size={12} />
						</button>
						<button
							onClick={() => handleInlineAction("explain")}
							className="p-1 text-xs text-gray-400 hover:text-blue-400 hover:bg-[#30363d] rounded"
							title="Explain">
							<MessageCircle size={12} />
						</button>
						<button
							onClick={() => handleInlineAction("optimize")}
							className="p-1 text-xs text-gray-400 hover:text-green-400 hover:bg-[#30363d] rounded"
							title="Optimize">
							<Zap size={12} />
						</button>
						<button
							onClick={() => handleInlineAction("review")}
							className="p-1 text-xs text-gray-400 hover:text-purple-400 hover:bg-[#30363d] rounded"
							title="Review">
							<Search size={12} />
						</button>
					</div>
				)}
			</div>
		</div>
	)
}
