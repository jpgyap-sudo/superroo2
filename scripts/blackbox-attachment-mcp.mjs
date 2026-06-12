#!/usr/bin/env node
import fs from "fs"
import os from "os"
import path from "path"
import readline from "readline"
import { createRequire } from "module"
import { execSync } from "child_process"

const require = createRequire(import.meta.url)
const PROJECT_ROOT = process.env.PROJECT_ROOT || "C:/Users/user/Documents/superroo2"
const SRC_NODE_MODULES = path.join(PROJECT_ROOT, "src", "node_modules")
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "blackbox-attach-"))
const LOCAL_OLLAMA_URL = "http://127.0.0.1:11434"
const VPS_OLLAMA_URL = "http://100.64.175.88:11434"
const OLLAMA_URL = process.env.OLLAMA_URL || process.env.OLLAMA_HOST || LOCAL_OLLAMA_URL
const OLLAMA_FALLBACK_URL = process.env.OLLAMA_FALLBACK_URL || "http://127.0.0.1:11435"
const VISION_MODEL = process.env.BLACKBOX_VISION_MODEL || process.env.OLLAMA_VISION_MODEL || "llava:7b"
const DEFAULT_MAX_CHARS = Number.parseInt(process.env.BLACKBOX_ATTACHMENT_MAX_CHARS || "120000", 10)

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"])
const TEXT_EXTENSIONS = new Set([
	".txt",
	".md",
	".mdx",
	".json",
	".jsonl",
	".js",
	".mjs",
	".cjs",
	".ts",
	".tsx",
	".jsx",
	".py",
	".rb",
	".go",
	".rs",
	".java",
	".c",
	".cpp",
	".h",
	".hpp",
	".cs",
	".php",
	".swift",
	".kt",
	".kts",
	".sql",
	".yaml",
	".yml",
	".xml",
	".html",
	".css",
	".scss",
	".sass",
	".less",
	".vue",
	".svelte",
	".astro",
	".toml",
	".ini",
	".cfg",
	".conf",
	".env",
	".gitignore",
	".dockerfile",
	".lock",
	".log",
	".csv",
	".sh",
	".bash",
	".zsh",
	".ps1",
])

function log(message) {
	console.error(`[blackbox-attachment-mcp] ${message}`)
}

function moduleRequire(moduleName) {
	return require(path.join(SRC_NODE_MODULES, moduleName))
}

function callOllama(endpoint, body, timeoutMs = 120000) {
	const urls = [OLLAMA_URL, OLLAMA_FALLBACK_URL, VPS_OLLAMA_URL].filter(Boolean)
	const bodyFile = path.join(TMP_DIR, `body-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
	const outFile = path.join(TMP_DIR, `out-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
	fs.writeFileSync(bodyFile, JSON.stringify(body), "utf8")
	for (const baseUrl of urls) {
		try {
			execSync(`curl.exe -sS --max-time ${Math.ceil(timeoutMs / 1000)} -H "Content-Type: application/json" -d @"${bodyFile}" "${baseUrl}${endpoint}" -o "${outFile}"`, {
				timeout: timeoutMs + 5000,
				stdio: ["pipe", "pipe", "ignore"],
				windowsHide: true,
			})
			const raw = fs.readFileSync(outFile, "utf8")
			if (raw.trim()) return JSON.parse(raw)
		} catch {}
	}
	throw new Error(`Ollama did not respond on ${urls.join(", ")}`)
}

function truncate(text, maxChars = DEFAULT_MAX_CHARS) {
	if (!text || text.length <= maxChars) return { text: text || "", truncated: false }
	const head = Math.floor(maxChars * 0.55)
	const tail = maxChars - head
	return {
		text: `${text.slice(0, head)}\n\n[... ${text.length - maxChars} characters omitted ...]\n\n${text.slice(-tail)}`,
		truncated: true,
	}
}

function addLineNumbers(content) {
	return content
		.split(/\r?\n/)
		.map((line, index) => `${String(index + 1).padStart(4, " ")} | ${line}`)
		.join("\n")
}

async function extractPdf(filePath) {
	const pdf = moduleRequire("pdf-parse/lib/pdf-parse")
	const data = await pdf(fs.readFileSync(filePath))
	return data.text || ""
}

async function extractDocx(filePath) {
	const mammoth = moduleRequire("mammoth")
	const result = await mammoth.extractRawText({ path: filePath })
	return result.value || ""
}

function readNotebook(filePath) {
	const notebook = JSON.parse(fs.readFileSync(filePath, "utf8"))
	return (notebook.cells || [])
		.filter((cell) => cell && (cell.cell_type === "markdown" || cell.cell_type === "code"))
		.map((cell) => Array.isArray(cell.source) ? cell.source.join("") : String(cell.source || ""))
		.join("\n\n")
}

async function readAttachment({ file_path, prompt, model, max_chars }) {
	if (!file_path || typeof file_path !== "string") {
		throw new Error("file_path is required")
	}
	const resolved = path.resolve(file_path)
	if (!fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`)

	const stat = fs.statSync(resolved)
	const ext = path.extname(resolved).toLowerCase()
	const name = path.basename(resolved)
	const maxChars = Number.isFinite(max_chars) ? max_chars : DEFAULT_MAX_CHARS

	if (IMAGE_EXTENSIONS.has(ext)) {
		const imageBase64 = fs.readFileSync(resolved).toString("base64")
		const data = callOllama("/api/chat", {
			model: model || VISION_MODEL,
			messages: [
				{
					role: "user",
					content:
						prompt ||
						"Analyze this coding-related image. Extract visible text, UI details, error messages, diagrams, and any implementation-relevant observations.",
					images: [imageBase64],
				},
			],
			stream: false,
		})
		return {
			kind: "image",
			name,
			path: resolved,
			size: stat.size,
			model: model || VISION_MODEL,
			content: data.message?.content || data.response || "",
		}
	}

	let content
	let kind = "text"
	if (ext === ".pdf") {
		kind = "pdf"
		content = await extractPdf(resolved)
	} else if (ext === ".docx") {
		kind = "docx"
		content = await extractDocx(resolved)
	} else if (ext === ".ipynb") {
		kind = "notebook"
		content = readNotebook(resolved)
	} else if (TEXT_EXTENSIONS.has(ext) || stat.size <= 1024 * 1024) {
		content = fs.readFileSync(resolved, "utf8")
	} else {
		throw new Error(`Unsupported binary attachment type: ${ext || "(no extension)"}`)
	}

	const limited = truncate(addLineNumbers(content), maxChars)
	return {
		kind,
		name,
		path: resolved,
		size: stat.size,
		truncated: limited.truncated,
		content: limited.text,
	}
}

async function readManyAttachments({ file_paths, prompt, model, max_chars }) {
	if (!Array.isArray(file_paths) || file_paths.length === 0) {
		throw new Error("file_paths must be a non-empty array")
	}
	const results = []
	for (const file_path of file_paths) {
		results.push(await readAttachment({ file_path, prompt, model, max_chars }))
	}
	return results
}

const TOOLS = [
	{
		name: "blackbox_read_attachment",
		description:
			"Read a local coding attachment by path. Images (png, jpg, jpeg, webp, gif, bmp) are analyzed with Ollama vision; pdf/docx/ipynb/text/code files are extracted into readable prompt context.",
		inputSchema: {
			type: "object",
			properties: {
				file_path: { type: "string", description: "Absolute or workspace-relative local file path" },
				prompt: { type: "string", description: "Optional image-analysis prompt for vision files" },
				model: { type: "string", description: `Optional vision model for images (default: ${VISION_MODEL})` },
				max_chars: { type: "number", description: `Maximum extracted characters for text documents (default: ${DEFAULT_MAX_CHARS})` },
			},
			required: ["file_path"],
		},
	},
	{
		name: "blackbox_read_attachments",
		description:
			"Read multiple local attachments by path. Use this when the user references several files, screenshots, PDFs, docs, or coding artifacts.",
		inputSchema: {
			type: "object",
			properties: {
				file_paths: { type: "array", items: { type: "string" }, description: "Local file paths to read" },
				prompt: { type: "string", description: "Optional image-analysis prompt for image files" },
				model: { type: "string", description: `Optional vision model for images (default: ${VISION_MODEL})` },
				max_chars: { type: "number", description: `Maximum extracted characters per text document (default: ${DEFAULT_MAX_CHARS})` },
			},
			required: ["file_paths"],
		},
	},
]

async function callTool(name, args) {
	try {
		const result =
			name === "blackbox_read_attachment"
				? await readAttachment(args || {})
				: name === "blackbox_read_attachments"
					? await readManyAttachments(args || {})
					: null
		if (!result) throw new Error(`Unknown tool: ${name}`)
		return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
	} catch (error) {
		return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true }
	}
}

function main() {
	log(`Starting with Ollama vision model ${VISION_MODEL}`)
	const reader = readline.createInterface({ input: process.stdin })
	let pending = 0
	let closed = false
	const keepAlive = setInterval(() => {}, 1000)

	async function handleLine(line) {
		let request
		try {
			request = JSON.parse(String(line).replace(/^\uFEFF/, "").trim())
		} catch {
			return
		}
		const { id, method, params } = request
		if (method === "initialize") {
			console.log(JSON.stringify({ jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "blackbox-attachment-mcp", version: "1.0.0" } } }))
		} else if (method === "tools/list") {
			console.log(JSON.stringify({ jsonrpc: "2.0", id, result: { tools: TOOLS } }))
		} else if (method === "tools/call") {
			const result = await callTool(params?.name, params?.arguments || {})
			console.log(JSON.stringify({ jsonrpc: "2.0", id, result }))
		} else if (method === "notifications/initialized") {
			// no-op
		} else {
			console.log(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } }))
		}
	}

	function cleanupIfDone() {
		if (!closed || pending > 0) return
		try {
			fs.rmSync(TMP_DIR, { recursive: true, force: true })
		} catch {}
		clearInterval(keepAlive)
	}

	reader.on("line", (line) => {
		pending += 1
		handleLine(line)
			.catch((error) => {
				console.log(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: error.message } }))
			})
			.finally(() => {
				pending -= 1
				cleanupIfDone()
			})
	})

	reader.on("close", () => {
		closed = true
		cleanupIfDone()
	})
}

main()
