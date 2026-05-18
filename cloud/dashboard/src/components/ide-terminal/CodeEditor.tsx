"use client"

import dynamic from "next/dynamic"
import { Loader2 } from "lucide-react"

// Dynamically import MonacoEditor to avoid SSR issues
const MonacoEditor = dynamic(() => import("./MonacoEditor"), {
	ssr: false,
	loading: () => (
		<div className="flex items-center justify-center h-full bg-[#0d1117]">
			<Loader2 className="w-5 h-5 animate-spin text-[#8b949e]" />
		</div>
	),
})

interface CodeEditorProps {
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
	onLspCompletion?: (lang: string, uri: string, line: number, column: number) => Promise<any>
	onLspHover?: (lang: string, uri: string, line: number, column: number) => Promise<any>
	onLspDefinition?: (lang: string, uri: string, line: number, column: number) => Promise<any>
	onLspReferences?: (lang: string, uri: string, line: number, column: number) => Promise<any>
	onLspCodeActions?: (lang: string, uri: string, line: number, column: number, diagnostics: any[]) => Promise<any>
	onLspOpenDocument?: (lang: string, uri: string, text: string, version: number) => Promise<any>
	onLspChangeDocument?: (lang: string, uri: string, text: string, version: number) => Promise<any>
	lspDiagnostics?: any[]
	jumpToPosition?: { line: number; column: number } | null
	onLspCloseDocument?: (lang: string, uri: string) => Promise<any>
}

export default function CodeEditor(props: CodeEditorProps) {
	return <MonacoEditor {...props} />
}
