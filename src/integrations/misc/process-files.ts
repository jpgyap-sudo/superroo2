import * as vscode from "vscode"
import fs from "fs/promises"
import * as path from "path"

export interface FileAttachment {
	name: string
	type: string
	size: number
	content: string
	isText: boolean
}

const TEXT_EXTENSIONS = new Set([
	".txt",
	".md",
	".json",
	".js",
	".ts",
	".jsx",
	".tsx",
	".py",
	".rb",
	".go",
	".rs",
	".java",
	".c",
	".cpp",
	".h",
	".cs",
	".php",
	".swift",
	".kt",
	".scala",
	".sh",
	".bash",
	".zsh",
	".ps1",
	".sql",
	".yaml",
	".yml",
	".xml",
	".csv",
	".html",
	".css",
	".scss",
	".sass",
	".less",
	".vue",
	".svelte",
	".astro",
	".prisma",
	".graphql",
	".gql",
	".dockerfile",
	".env",
	".gitignore",
	".htaccess",
	".conf",
	".ini",
	".cfg",
	".toml",
	".lock",
	".log",
])

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".svg", ".ico"])

function getMimeType(filePath: string): string {
	const ext = path.extname(filePath).toLowerCase()
	switch (ext) {
		case ".png":
			return "image/png"
		case ".jpg":
		case ".jpeg":
			return "image/jpeg"
		case ".webp":
			return "image/webp"
		case ".gif":
			return "image/gif"
		case ".bmp":
			return "image/bmp"
		case ".svg":
			return "image/svg+xml"
		case ".ico":
			return "image/x-icon"
		case ".pdf":
			return "application/pdf"
		case ".zip":
			return "application/zip"
		case ".txt":
			return "text/plain"
		case ".md":
			return "text/markdown"
		case ".json":
			return "application/json"
		case ".csv":
			return "text/csv"
		case ".xml":
			return "application/xml"
		case ".yaml":
		case ".yml":
			return "application/yaml"
		case ".html":
			return "text/html"
		case ".css":
			return "text/css"
		case ".js":
			return "application/javascript"
		case ".ts":
			return "application/typescript"
		default:
			return "application/octet-stream"
	}
}

function isTextFile(filePath: string): boolean {
	const ext = path.extname(filePath).toLowerCase()
	return TEXT_EXTENSIONS.has(ext)
}

function isImageFile(filePath: string): boolean {
	const ext = path.extname(filePath).toLowerCase()
	return IMAGE_EXTENSIONS.has(ext)
}

export async function selectFiles(): Promise<FileAttachment[]> {
	const options: vscode.OpenDialogOptions = {
		canSelectMany: true,
		openLabel: "Select Files",
		filters: {
			"All Supported": [
				"png",
				"jpg",
				"jpeg",
				"webp",
				"gif",
				"pdf",
				"zip",
				"txt",
				"md",
				"json",
				"js",
				"ts",
				"jsx",
				"tsx",
				"py",
				"rb",
				"go",
				"rs",
				"java",
				"c",
				"cpp",
				"cs",
				"php",
				"swift",
				"kt",
				"sql",
				"yaml",
				"yml",
				"xml",
				"csv",
				"html",
				"css",
				"scss",
				"vue",
				"svelte",
				"dockerfile",
				"env",
				"gitignore",
				"conf",
				"ini",
				"cfg",
				"toml",
				"lock",
				"log",
			],
			Images: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg", "ico"],
			Documents: ["pdf", "txt", "md", "csv"],
			Code: [
				"json",
				"js",
				"ts",
				"jsx",
				"tsx",
				"py",
				"rb",
				"go",
				"rs",
				"java",
				"c",
				"cpp",
				"cs",
				"php",
				"swift",
				"kt",
				"sql",
				"yaml",
				"yml",
				"xml",
				"html",
				"css",
				"scss",
				"vue",
				"svelte",
			],
			Archives: ["zip"],
			"All Files": ["*"],
		},
	}

	const fileUris = await vscode.window.showOpenDialog(options)

	if (!fileUris || fileUris.length === 0) {
		return []
	}

	return await Promise.all(
		fileUris.map(async (uri) => {
			const filePath = uri.fsPath
			const buffer = await fs.readFile(filePath)
			const mimeType = getMimeType(filePath)
			const isText = isTextFile(filePath)
			const isImage = isImageFile(filePath)

			let content: string
			if (isText) {
				content = buffer.toString("utf-8")
			} else if (isImage) {
				const base64 = buffer.toString("base64")
				content = `data:${mimeType};base64,${base64}`
			} else {
				// For binary files (PDF, ZIP, etc.), encode as base64
				content = buffer.toString("base64")
			}

			return {
				name: path.basename(filePath),
				type: mimeType,
				size: buffer.length,
				content,
				isText,
			} satisfies FileAttachment
		}),
	)
}
