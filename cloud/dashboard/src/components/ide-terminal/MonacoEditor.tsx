"use client"

import { useRef, useEffect, useCallback, useState, useMemo } from "react"
import { Loader2, Save, Bug, MessageCircle, Zap, Search, Lightbulb } from "lucide-react"

// ── Types ──────────────────────────────────────────────────────
interface LspDiagnostic {
	file: string
	line: number
	column: number
	message: string
	severity: "error" | "warning" | "info"
	source?: string
}

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
	// #2: LSP integration
	lspConnected?: boolean
	onLspCompletion?: (lang: string, uri: string, line: number, column: number) => Promise<any>
	onLspHover?: (lang: string, uri: string, line: number, column: number) => Promise<any>
	onLspDefinition?: (lang: string, uri: string, line: number, column: number) => Promise<any>
	onLspReferences?: (lang: string, uri: string, line: number, column: number) => Promise<any>
	onLspCodeActions?: (lang: string, uri: string, line: number, column: number, diagnostics: any[]) => Promise<any>
	onLspOpenDocument?: (lang: string, uri: string, text: string, version: number) => Promise<any>
	onLspChangeDocument?: (lang: string, uri: string, text: string, version: number) => Promise<any>
	// LSP diagnostics from language server
	lspDiagnostics?: LspDiagnostic[]
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
	// #2: LSP integration
	lspConnected = false,
	onLspCompletion,
	onLspHover,
	onLspDefinition,
	onLspReferences,
	onLspCodeActions,
	onLspOpenDocument,
	onLspChangeDocument,
	lspDiagnostics = [],
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

			// Send LSP document open
			if (onLspOpenDocument && filePath && lspConnected) {
				onLspOpenDocument(lang, filePath, value, 1).catch(() => {})
			}

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

				onSelectionChange?.(selectedText, selection.positionLineNumber, selection.positionColumn)
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

			// #2: LSP completion provider
			if (onLspCompletion && lspConnected) {
				monaco.languages.registerCompletionItemProvider(lang, {
					provideCompletionItems: async (model: any, position: any) => {
						try {
							const uri = model.uri.toString()
							const result = await onLspCompletion(lang, uri, position.lineNumber, position.column)
							if (!result || !result.items) return { suggestions: [] }
							return {
								suggestions: result.items.map((item: any) => ({
									label: item.label,
									kind: mapLspKind(monaco, item.kind),
									insertText: item.insertText || item.label,
									detail: item.detail || "",
									documentation: item.documentation || "",
								})),
							}
						} catch {
							return { suggestions: [] }
						}
					},
				})
			}

			// #2: LSP hover provider
			if (onLspHover && lspConnected) {
				monaco.languages.registerHoverProvider(lang, {
					provideHover: async (model: any, position: any) => {
						try {
							const uri = model.uri.toString()
							const result = await onLspHover(lang, uri, position.lineNumber, position.column)
							if (!result || !result.contents) return null
							return {
								contents: [{ value: result.contents }],
								range: result.range || null,
							}
						} catch {
							return null
						}
					},
				})
			}

			// #2: LSP definition provider (Go to Definition)
			if (onLspDefinition && lspConnected) {
				monaco.languages.registerDefinitionProvider(lang, {
					provideDefinition: async (model: any, position: any) => {
						try {
							const uri = model.uri.toString()
							const result = await onLspDefinition(lang, uri, position.lineNumber, position.column)
							if (!result || !result.uri) return null
							return {
								uri: monaco.Uri.parse(result.uri),
								range: new monaco.Range(
									result.range.start.line,
									result.range.start.character,
									result.range.end.line,
									result.range.end.character,
								),
							}
						} catch {
							return null
						}
					},
				})
			}

			// #2: LSP references provider (Find All References)
			if (onLspReferences && lspConnected) {
				monaco.languages.registerReferenceProvider(lang, {
					provideReferences: async (model: any, position: any) => {
						try {
							const uri = model.uri.toString()
							const result = await onLspReferences(lang, uri, position.lineNumber, position.column)
							if (!result || !result.references) return []
							return result.references.map((ref: any) => ({
								uri: monaco.Uri.parse(ref.uri),
								range: new monaco.Range(
									ref.range.start.line,
									ref.range.start.character,
									ref.range.end.line,
									ref.range.end.character,
								),
							}))
						} catch {
							return []
						}
					},
				})
			}

			// Focus the editor
			editorInstance.focus()
		},
		[
			onCursorChange,
			onSelectionChange,
			onMarkersChange,
			onSave,
			lang,
			lspConnected,
			onLspCompletion,
			onLspHover,
			onLspDefinition,
			onLspReferences,
			onLspCodeActions,
			onLspOpenDocument,
			filePath,
			value,
		],
	)

	// #2: Helper to map LSP completion item kinds to Monaco kinds
	function mapLspKind(monaco: any, kind: number | string): number {
		if (typeof kind === "number") return kind
		const kindMap: Record<string, number> = {
			text: monaco.languages.CompletionItemKind.Text,
			method: monaco.languages.CompletionItemKind.Method,
			function: monaco.languages.CompletionItemKind.Function,
			constructor: monaco.languages.CompletionItemKind.Constructor,
			field: monaco.languages.CompletionItemKind.Field,
			variable: monaco.languages.CompletionItemKind.Variable,
			class: monaco.languages.CompletionItemKind.Class,
			interface: monaco.languages.CompletionItemKind.Interface,
			module: monaco.languages.CompletionItemKind.Module,
			property: monaco.languages.CompletionItemKind.Property,
			unit: monaco.languages.CompletionItemKind.Unit,
			value: monaco.languages.CompletionItemKind.Value,
			enum: monaco.languages.CompletionItemKind.Enum,
			keyword: monaco.languages.CompletionItemKind.Keyword,
			snippet: monaco.languages.CompletionItemKind.Snippet,
			color: monaco.languages.CompletionItemKind.Color,
			file: monaco.languages.CompletionItemKind.File,
			reference: monaco.languages.CompletionItemKind.Reference,
			folder: monaco.languages.CompletionItemKind.Folder,
			enumMember: monaco.languages.CompletionItemKind.EnumMember,
			constant: monaco.languages.CompletionItemKind.Constant,
			struct: monaco.languages.CompletionItemKind.Struct,
			event: monaco.languages.CompletionItemKind.Event,
			operator: monaco.languages.CompletionItemKind.Operator,
			typeParameter: monaco.languages.CompletionItemKind.TypeParameter,
		}
		return kindMap[kind] || monaco.languages.CompletionItemKind.Text
	}

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

	// ── Apply LSP diagnostics as model markers ─────────────────
	useEffect(() => {
		const monaco = monacoRef.current
		const editor = editorRef.current
		if (!monaco || !editor || !filePath) return

		const model = editor.getModel()
		if (!model) return

		const fileDiagnostics = lspDiagnostics.filter((d) => d.file === filePath || d.file.endsWith(filePath))
		const markers = fileDiagnostics.map((d) => ({
			severity:
				d.severity === "error"
					? monaco.MarkerSeverity.Error
					: d.severity === "warning"
						? monaco.MarkerSeverity.Warning
						: monaco.MarkerSeverity.Info,
			message: `[${d.source || "LSP"}] ${d.message}`,
			startLineNumber: d.line,
			startColumn: d.column,
			endLineNumber: d.line,
			endColumn: d.column + 1,
		}))

		monaco.editor.setModelMarkers(model, "lsp", markers)
	}, [lspDiagnostics, filePath])

	// ── Handle editor changes ──────────────────────────────────
	const handleChange = useCallback(
		(val: string | undefined) => {
			if (val !== undefined) {
				setIsDirty(val !== value)
				onChange?.(val)
				if (onLspChangeDocument && filePath && lspConnected) {
					onLspChangeDocument(lang, filePath, val, 1).catch(() => {})
				}
			}
		},
		[value, onChange, onLspChangeDocument, filePath, lspConnected, lang],
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

					{/* #2: LSP status indicator */}
					{lspConnected !== undefined && (
						<span
							className={`flex items-center gap-1 text-[11px] ${lspConnected ? "text-purple-400" : "text-gray-600"}`}>
							<span
								className={`w-1.5 h-1.5 rounded-full ${lspConnected ? "bg-purple-400" : "bg-gray-600"}`}
							/>
							LSP
						</span>
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
