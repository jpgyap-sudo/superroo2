/**
 * Code Chunker — Splits source files into semantic chunks for embedding.
 *
 * Uses language-aware heuristics to split by:
 * - Function/class/component boundaries (for structured languages)
 * - Line count limits (for unstructured files)
 * - Blank line boundaries (for markdown/config files)
 *
 * @module server/src/memory/chunker
 */

export interface ChunkResult {
	filePath: string
	language: string
	chunks: CodeChunk[]
}

export interface CodeChunk {
	content: string
	symbolName?: string
	symbolType?: string
	startLine: number
	endLine: number
	chunkIndex: number
	totalChunks: number
	summary?: string
}

export interface ChunkerOptions {
	maxLinesPerChunk?: number
	minLinesPerChunk?: number
	overlapLines?: number
}

const DEFAULT_OPTIONS: Required<ChunkerOptions> = {
	maxLinesPerChunk: 80,
	minLinesPerChunk: 5,
	overlapLines: 3,
}

/**
 * Language-specific comment syntax for summary extraction.
 */
const COMMENT_PATTERNS: Record<string, { line: string; blockStart: string; blockEnd: string }> = {
	typescript: { line: "//", blockStart: "/*", blockEnd: "*/" },
	javascript: { line: "//", blockStart: "/*", blockEnd: "*/" },
	tsx: { line: "//", blockStart: "/*", blockEnd: "*/" },
	jsx: { line: "//", blockStart: "/*", blockEnd: "*/" },
	python: { line: "#", blockStart: '"""', blockEnd: '"""' },
	go: { line: "//", blockStart: "/*", blockEnd: "*/" },
	rust: { line: "//", blockStart: "/*", blockEnd: "*/" },
	java: { line: "//", blockStart: "/*", blockEnd: "*/" },
	cpp: { line: "//", blockStart: "/*", blockEnd: "*/" },
	c: { line: "//", blockStart: "/*", blockEnd: "*/" },
	php: { line: "//", blockStart: "/*", blockEnd: "*/" },
	ruby: { line: "#", blockStart: "=begin", blockEnd: "=end" },
	swift: { line: "//", blockStart: "/*", blockEnd: "*/" },
	kotlin: { line: "//", blockStart: "/*", blockEnd: "*/" },
	shell: { line: "#", blockStart: "", blockEnd: "" },
	yaml: { line: "#", blockStart: "", blockEnd: "" },
	toml: { line: "#", blockStart: "", blockEnd: "" },
	sql: { line: "--", blockStart: "/*", blockEnd: "*/" },
}

/**
 * Language-specific function/class boundary regex patterns.
 */
const BOUNDARY_PATTERNS: Record<string, RegExp[]> = {
	typescript: [
		/^(export\s+)?(async\s+)?function\s+\w+/,
		/^(export\s+)?(abstract\s+)?class\s+\w+/,
		/^(export\s+)?interface\s+\w+/,
		/^(export\s+)?type\s+\w+\s*=/,
		/^(export\s+)?(const|let|var)\s+\w+\s*[:=]\s*(\(|async|function)/,
		/^(export\s+)?enum\s+\w+/,
		/^(export\s+)?namespace\s+\w+/,
		/^(export\s+)?module\s+\w+/,
		/^(export\s+)?default\s+(function|class)/,
		/^(export\s+)?const\s+\w+\s*:\s*(React\.FC|React\.ComponentType)/,
	],
	javascript: [
		/^(export\s+)?(async\s+)?function\s+\w+/,
		/^(export\s+)?class\s+\w+/,
		/^(export\s+)?default\s+(function|class)/,
		/^(const|let|var)\s+\w+\s*[:=]\s*(\(|async|function)/,
	],
	tsx: [
		/^(export\s+)?(async\s+)?function\s+\w+/,
		/^(export\s+)?(abstract\s+)?class\s+\w+/,
		/^(export\s+)?interface\s+\w+/,
		/^(export\s+)?const\s+\w+\s*[:=]\s*(React\.FC|React\.ComponentType)/,
		/^(export\s+)?function\s+\w+/,
	],
	python: [
		/^def\s+\w+/,
		/^async\s+def\s+\w+/,
		/^class\s+\w+/,
		/^@\w+/,
	],
	go: [
		/^func\s+\w+/,
		/^type\s+\w+\s+struct/,
		/^type\s+\w+\s+interface/,
	],
	rust: [
		/^fn\s+\w+/,
		/^struct\s+\w+/,
		/^enum\s+\w+/,
		/^impl\s+\w+/,
		/^trait\s+\w+/,
		/^mod\s+\w+/,
	],
	java: [
		/^public\s+(class|interface|enum|record)\s+\w+/,
		/^private\s+(class|interface)\s+\w+/,
		/^protected\s+(class|interface)\s+\w+/,
		/^(public|private|protected)\s+\w+\s*\(/,
	],
}

/**
 * Detect language from file extension.
 */
export function detectLanguage(filePath: string): string {
	const ext = filePath.split(".").pop()?.toLowerCase() ?? ""
	const extMap: Record<string, string> = {
		ts: "typescript",
		tsx: "tsx",
		js: "javascript",
		jsx: "jsx",
		mjs: "javascript",
		cjs: "javascript",
		mts: "typescript",
		cts: "typescript",
		py: "python",
		go: "go",
		rs: "rust",
		java: "java",
		cpp: "cpp",
		c: "c",
		h: "c",
		hpp: "cpp",
		php: "php",
		rb: "ruby",
		swift: "swift",
		kt: "kotlin",
		kts: "kotlin",
		sh: "shell",
		bash: "shell",
		zsh: "shell",
		yaml: "yaml",
		yml: "yaml",
		toml: "toml",
		json: "json",
		md: "markdown",
		mdx: "markdown",
		sql: "sql",
		css: "css",
		scss: "scss",
		less: "less",
		html: "html",
		xml: "xml",
		vue: "typescript",
		svelte: "typescript",
	}
	return extMap[ext] ?? "text"
}

/**
 * Extract the top-level symbol name from a line of code.
 */
function extractSymbolName(line: string, language: string): string | undefined {
	// Try language-specific patterns first
	const patterns = BOUNDARY_PATTERNS[language]
	if (patterns) {
		for (const pattern of patterns) {
			const match = line.match(pattern)
			if (match) {
				// Extract the name after the keyword
				const parts = match[0].split(/\s+/)
				// Find the first word that looks like a name (not a keyword)
				const keywords = new Set([
					"export", "default", "async", "function", "class", "interface",
					"type", "enum", "namespace", "module", "const", "let", "var",
					"def", "fn", "func", "struct", "impl", "trait", "mod", "public",
					"private", "protected", "abstract", "static",
				])
				for (const part of parts) {
					const clean = part.replace(/[^a-zA-Z0-9_]/g, "")
					if (clean && !keywords.has(clean) && !clean.startsWith("(")) {
						return clean
					}
				}
			}
		}
	}

	// Fallback: try to find any identifier after common keywords
	const genericMatch = line.match(
		/(?:function|class|interface|type|enum|def|fn|func|struct|impl|trait|mod|const|let|var)\s+([a-zA-Z_]\w*)/,
	)
	return genericMatch?.[1]
}

/**
 * Extract symbol type from a line of code.
 */
function extractSymbolType(line: string): string {
	const lower = line.trimStart()
	if (/^(export\s+)?(abstract\s+)?class\s/.test(lower)) return "class"
	if (/^(export\s+)?interface\s/.test(lower)) return "interface"
	if (/^(export\s+)?type\s/.test(lower)) return "type"
	if (/^(export\s+)?enum\s/.test(lower)) return "enum"
	if (/^(export\s+)?(async\s+)?function\s/.test(lower)) return "function"
	if (/^(export\s+)?const\s+\w+\s*[:=]\s*(React\.FC|React\.ComponentType)/.test(lower)) return "component"
	if (/^(export\s+)?default\s+(function|class)/.test(lower)) return "default_export"
	if (/^def\s/.test(lower)) return "function"
	if (/^class\s/.test(lower)) return "class"
	if (/^func\s/.test(lower)) return "function"
	if (/^fn\s/.test(lower)) return "function"
	if (/^type\s+\w+\s+struct/.test(lower)) return "struct"
	if (/^impl\s/.test(lower)) return "impl"
	if (/^trait\s/.test(lower)) return "trait"
	if (/^mod\s/.test(lower)) return "module"
	if (/^namespace\s/.test(lower)) return "namespace"
	return "block"
}

/**
 * Generate a summary for a code chunk by extracting the first comment block
 * or the first meaningful line.
 */
function generateSummary(content: string, language: string): string | undefined {
	const lines = content.split("\n")
	if (lines.length === 0) return undefined

	const comment = COMMENT_PATTERNS[language]

	// Try to find a JSDoc/docstring comment at the start
	if (comment) {
		const firstLine = lines[0].trim()
		if (firstLine.startsWith(comment.blockStart) && comment.blockStart) {
			// Extract the doc comment content
			const docLines: string[] = []
			for (const line of lines) {
				const trimmed = line.trim()
				if (trimmed.startsWith(comment.blockStart)) continue
				if (trimmed.startsWith(comment.blockEnd)) break
				if (trimmed.startsWith(comment.line)) {
					docLines.push(trimmed.replace(comment.line, "").trim())
				} else {
					docLines.push(trimmed)
				}
			}
			const summary = docLines.filter(Boolean).join(" ").slice(0, 200)
			if (summary) return summary
		}
	}

	// Fallback: return the first non-empty, non-comment line
	for (const line of lines) {
		const trimmed = line.trim()
		if (!trimmed) continue
		if (comment && trimmed.startsWith(comment.line)) continue
		if (comment && trimmed.startsWith(comment.blockStart)) continue
		return trimmed.slice(0, 100)
	}

	return undefined
}

/**
 * Check if a file extension should be indexed.
 */
export function isIndexableFile(filePath: string): boolean {
	const skipExtensions = new Set([
		".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp",
		".woff", ".woff2", ".ttf", ".eot",
		".mp4", ".mp3", ".avi", ".mov",
		".zip", ".tar", ".gz", ".rar",
		".pdf", ".doc", ".docx",
		".exe", ".dll", ".so", ".dylib",
		".o", ".obj", ".class",
		".map", ".d.ts",
	])
	const ext = filePath.split(".").pop()?.toLowerCase()
	if (!ext) return false
	if (skipExtensions.has(`.${ext}`)) return false

	// Skip common non-source directories
	const skipDirs = [
		"/node_modules/",
		"/.git/",
		"/dist/",
		"/build/",
		"/.next/",
		"/.turbo/",
		"/coverage/",
		"/.vscode/",
		"/__pycache__/",
		"/.venv/",
		"/venv/",
		"/vendor/",
		"/.roo/",
	]
	for (const dir of skipDirs) {
		if (filePath.includes(dir)) return false
	}

	return true
}

/**
 * Split a source file into semantic chunks.
 *
 * Strategy:
 * 1. For structured languages (TS, JS, Python, etc.), split by function/class boundaries
 * 2. For unstructured files, split by line count with overlap
 * 3. Always respect maxLinesPerChunk
 */
export function chunkFile(
	filePath: string,
	content: string,
	options: ChunkerOptions = {},
): ChunkResult {
	const opts = { ...DEFAULT_OPTIONS, ...options }
	const language = detectLanguage(filePath)
	const lines = content.split("\n")
	const chunks: CodeChunk[] = []

	if (lines.length === 0) return { filePath, language, chunks: [] }

	// For structured languages, try semantic boundary splitting
	const boundaries = BOUNDARY_PATTERNS[language]
	if (boundaries) {
		// Find all boundary lines
		const boundaryLines: number[] = []
		for (let i = 0; i < lines.length; i++) {
			const trimmed = lines[i].trimStart()
			for (const pattern of boundaries) {
				if (pattern.test(trimmed)) {
					boundaryLines.push(i)
					break
				}
			}
		}

		if (boundaryLines.length > 0) {
			// Split at boundaries, but merge small adjacent chunks
			let chunkStart = 0
			for (let i = 0; i < boundaryLines.length; i++) {
				const boundary = boundaryLines[i]
				const nextBoundary = boundaryLines[i + 1] ?? lines.length

				// If this boundary is too close to the previous one, skip it
				if (boundary - chunkStart < opts.minLinesPerChunk && i > 0) {
					continue
				}

				// If the chunk would be too large, split it further
				if (nextBoundary - chunkStart > opts.maxLinesPerChunk) {
					// Emit chunk up to this boundary
					const chunkLines = lines.slice(chunkStart, boundary)
					if (chunkLines.length >= opts.minLinesPerChunk) {
						const symbolLine = lines[chunkStart]
						chunks.push({
							content: chunkLines.join("\n"),
							symbolName: extractSymbolName(symbolLine, language),
							symbolType: extractSymbolType(symbolLine),
							startLine: chunkStart + 1,
							endLine: boundary,
							chunkIndex: chunks.length,
							totalChunks: 0, // will fix after
							summary: generateSummary(chunkLines.join("\n"), language),
						})
					}
					chunkStart = boundary
				}
			}

			// Emit the last chunk
			if (chunkStart < lines.length) {
				const chunkLines = lines.slice(chunkStart)
				if (chunkLines.length >= opts.minLinesPerChunk) {
					const symbolLine = lines[chunkStart]
					chunks.push({
						content: chunkLines.join("\n"),
						symbolName: extractSymbolName(symbolLine, language),
						symbolType: extractSymbolType(symbolLine),
						startLine: chunkStart + 1,
						endLine: lines.length,
						chunkIndex: chunks.length,
						totalChunks: 0,
						summary: generateSummary(chunkLines.join("\n"), language),
					})
				}
			}
		}
	}

	// If no semantic chunks were created, fall back to line-count splitting
	if (chunks.length === 0) {
		for (let i = 0; i < lines.length; i += opts.maxLinesPerChunk - opts.overlapLines) {
			const end = Math.min(i + opts.maxLinesPerChunk, lines.length)
			const chunkLines = lines.slice(i, end)
			if (chunkLines.length < opts.minLinesPerChunk && i > 0) break

			const symbolLine = lines[i]
			chunks.push({
				content: chunkLines.join("\n"),
				symbolName: extractSymbolName(symbolLine, language),
				symbolType: extractSymbolType(symbolLine),
				startLine: i + 1,
				endLine: end,
				chunkIndex: chunks.length,
				totalChunks: 0,
				summary: generateSummary(chunkLines.join("\n"), language),
			})
		}
	}

	// Fix totalChunks
	for (const chunk of chunks) {
		chunk.totalChunks = chunks.length
	}

	return { filePath, language, chunks }
}
