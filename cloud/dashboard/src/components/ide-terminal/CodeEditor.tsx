"use client"

import { useRef, useEffect, useCallback, useState } from "react"
import { Loader2, Save, RotateCcw } from "lucide-react"

interface CodeEditorProps {
	value: string
	language?: string
	filePath?: string | null
	onChange?: (value: string) => void
	onSave?: (value: string) => void
	readOnly?: boolean
	height?: string
}

// Simple syntax highlighting for common languages
function highlightCode(code: string, language?: string): string {
	const escaped = code.replace(/&/g, "&").replace(/</g, "<").replace(/>/g, ">")

	if (!language || language === "plaintext") return escaped

	const patterns: Record<string, RegExp[]> = {
		typescript: [
			/\/\/.*$/gm,
			/\/\*[\s\S]*?\*\//g,
			/"(?:[^"\\]|\\.)*"/g,
			/'(?:[^'\\]|\\.)*'/g,
			/`(?:[^`\\]|\\.)*`/g,
			/\b(const|let|var|function|return|if|else|for|while|import|export|from|async|await|type|interface|class|extends|implements|new|this|throw|try|catch|finally|typeof|instanceof|in|of|as|enum|declare|namespace|module|public|private|protected|readonly|static|abstract)\b/g,
			/\b(string|number|boolean|void|any|never|unknown|undefined|null|Record|Partial|Required|Pick|Omit|Promise|Array|Map|Set)\b/g,
		],
		javascript: [
			/\/\/.*$/gm,
			/\/\*[\s\S]*?\*\//g,
			/"(?:[^"\\]|\\.)*"/g,
			/'(?:[^'\\]|\\.)*'/g,
			/`(?:[^`\\]|\\.)*`/g,
			/\b(const|let|var|function|return|if|else|for|while|import|export|from|async|await|class|extends|new|this|throw|try|catch|finally|typeof|instanceof|of|in)\b/g,
		],
		python: [
			/#.*$/gm,
			/"""[\s\S]*?"""/g,
			/"(?:[^"\\]|\\.)*"/g,
			/'(?:[^'\\]|\\.)*'/g,
			/\b(def|class|return|if|elif|else|for|while|import|from|as|try|except|finally|with|yield|lambda|pass|break|continue|async|await|raise|self|True|False|None)\b/g,
		],
		html: [
			/<!--[\s\S]*?-->/g,
			/<\/?[\w-]+(?:\s+[\w-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[\w-]+))?)*\s*\/?>/g,
			/<[\/\w-]+/g,
			/<!--[\s\S]*?-->/g,
		],
		css: [
			/\/\*[\s\S]*?\*\//g,
			/"(?:[^"\\]|\\.)*"/g,
			/'(?:[^'\\]|\\.)*'/g,
			/([\w-]+)\s*:/g,
			/\.([\w-]+)/g,
			/#([\w-]+)/g,
			/\b(@media|@keyframes|@import|@font-face|!important)\b/g,
		],
		json: [/"(?:[^"\\]|\\.)*"/g, /\b(true|false|null)\b/g, /\b-?\d+\.?\d*(?:[eE][+-]?\d+)?\b/g],
	}

	const langPatterns = patterns[language] || patterns.typescript
	let result = escaped
	for (const pattern of langPatterns) {
		result = result.replace(pattern, (match) => {
			if (match.startsWith("//") || match.startsWith("#") || match.startsWith("/*") || match.startsWith("<!--"))
				return `<span class="code-comment">${match}</span>`
			if (match.startsWith('"') || match.startsWith("'") || match.startsWith("`") || match.startsWith('"""')) {
				return `<span class="code-string">${match}</span>`
			}
			if (match.startsWith("<")) return `<span class="code-tag">${match}</span>`
			if (match.endsWith(":")) return `<span class="code-property">${match}</span>`
			if (match.startsWith(".")) return `<span class="code-class">${match}</span>`
			if (match.startsWith("#")) return `<span class="code-id">${match}</span>`
			if (match === "true" || match === "false" || match === "null")
				return `<span class="code-literal">${match}</span>`
			if (/^-?\d/.test(match)) return `<span class="code-number">${match}</span>`
			return `<span class="code-keyword">${match}</span>`
		})
	}

	return result
}

const LANGUAGE_MAP: Record<string, string> = {
	ts: "typescript",
	tsx: "typescript",
	js: "javascript",
	jsx: "javascript",
	py: "python",
	html: "html",
	css: "css",
	json: "json",
	md: "plaintext",
	txt: "plaintext",
	yaml: "plaintext",
	yml: "plaintext",
	sql: "plaintext",
	sh: "plaintext",
	bash: "plaintext",
}

function detectLanguage(filePath?: string | null): string {
	if (!filePath) return "plaintext"
	const ext = filePath.split(".").pop()?.toLowerCase()
	return LANGUAGE_MAP[ext || ""] || "plaintext"
}

export default function CodeEditor({
	value,
	language,
	filePath,
	onChange,
	onSave,
	readOnly = false,
	height = "100%",
}: CodeEditorProps) {
	const editorRef = useRef<HTMLDivElement>(null)
	const [isDirty, setIsDirty] = useState(false)
	const [internalValue, setInternalValue] = useState(value)
	const [showLineNumbers, setShowLineNumbers] = useState(true)
	const [wordWrap, setWordWrap] = useState(true)

	const lang = language || detectLanguage(filePath)
	const lines = internalValue.split("\n")

	useEffect(() => {
		setInternalValue(value)
		setIsDirty(false)
	}, [value])

	const handleInput = useCallback(
		(e: React.FormEvent<HTMLDivElement>) => {
			const text = e.currentTarget.textContent || ""
			setInternalValue(text)
			setIsDirty(text !== value)
			onChange?.(text)
		},
		[value, onChange],
	)

	const handleSave = useCallback(() => {
		onSave?.(internalValue)
		setIsDirty(false)
	}, [internalValue, onSave])

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if ((e.ctrlKey || e.metaKey) && e.key === "s") {
				e.preventDefault()
				handleSave()
			}
			if (e.key === "Tab") {
				e.preventDefault()
				document.execCommand("insertText", false, "  ")
			}
		},
		[handleSave],
	)

	return (
		<div className="flex flex-col h-full">
			{/* Editor toolbar */}
			<div className="flex items-center justify-between px-2 py-1 border-b border-[#1e2535] bg-[#0f1117] shrink-0">
				<div className="flex items-center gap-2 text-[11px] text-[#8b949e]">
					<span className="text-[#519aba] font-medium">{lang}</span>
					{filePath && <span className="truncate max-w-[200px]">{filePath}</span>}
					{isDirty && <span className="text-[#d29922]">● unsaved</span>}
				</div>
				<div className="flex items-center gap-1">
					<button
						className={`px-1.5 py-0.5 text-[11px] rounded ${showLineNumbers ? "bg-[#1e2535] text-[#e6edf3]" : "text-[#8b949e] hover:text-[#e6edf3]"}`}
						onClick={() => setShowLineNumbers((v) => !v)}
						title="Toggle line numbers">
						Ln
					</button>
					<button
						className={`px-1.5 py-0.5 text-[11px] rounded ${wordWrap ? "bg-[#1e2535] text-[#e6edf3]" : "text-[#8b949e] hover:text-[#e6edf3]"}`}
						onClick={() => setWordWrap((v) => !v)}
						title="Toggle word wrap">
						Wrap
					</button>
					{!readOnly && onSave && (
						<button
							className={`flex items-center gap-1 px-2 py-0.5 text-[11px] rounded transition-colors ${
								isDirty
									? "bg-[#1f6feb] text-white hover:bg-[#388bfd]"
									: "text-[#8b949e] hover:text-[#e6edf3]"
							}`}
							onClick={handleSave}
							disabled={!isDirty}
							title="Save (Ctrl+S)">
							<Save className="w-3 h-3" />
							Save
						</button>
					)}
				</div>
			</div>

			{/* Code area */}
			<div ref={editorRef} className="flex-1 overflow-auto bg-[#0d1117]" style={{ height }}>
				<div className="flex">
					{/* Line numbers */}
					{showLineNumbers && (
						<div className="select-none text-right pr-3 pl-2 py-3 text-[12px] leading-[1.5] text-[#484f58] border-r border-[#1e2535] bg-[#0d1117] shrink-0">
							{lines.map((_, i) => (
								<div key={i}>{i + 1}</div>
							))}
						</div>
					)}

					{/* Editable content */}
					{readOnly ? (
						<pre
							className="flex-1 p-3 text-[12px] font-mono leading-[1.5] text-[#e6edf3] whitespace-pre-wrap overflow-x-auto"
							dangerouslySetInnerHTML={{ __html: highlightCode(internalValue, lang) }}
						/>
					) : (
						<div
							className="flex-1 p-3 text-[12px] font-mono leading-[1.5] text-[#e6edf3] whitespace-pre-wrap outline-none overflow-x-auto"
							contentEditable
							suppressContentEditableWarning
							onInput={handleInput}
							onKeyDown={handleKeyDown}
							dangerouslySetInnerHTML={{ __html: highlightCode(internalValue, lang) }}
						/>
					)}
				</div>
			</div>
		</div>
	)
}
