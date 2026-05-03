import * as vscode from "vscode"
import fs from "fs/promises"
import * as path from "path"

const SUPPORTED_IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp"] as const
const IMAGE_DATA_URL_PATTERN = /^data:image\/(?:png|jpe?g|webp);base64,/i

export async function selectImages(): Promise<string[]> {
	const options: vscode.OpenDialogOptions = {
		canSelectMany: true,
		openLabel: "Select",
		filters: {
			Images: [...SUPPORTED_IMAGE_EXTENSIONS], // supported by anthropic and openrouter
		},
	}

	const fileUris = await vscode.window.showOpenDialog(options)

	if (!fileUris || fileUris.length === 0) {
		return []
	}

	return await Promise.all(fileUris.map(async (uri) => imagePathToDataUrl(uri.fsPath)))
}

export async function getImagesFromClipboard(): Promise<string[]> {
	const clipboardText = (await vscode.env.clipboard.readText()).trim()
	if (!clipboardText) {
		return []
	}

	if (IMAGE_DATA_URL_PATTERN.test(clipboardText)) {
		return [clipboardText]
	}

	const imagePaths = clipboardText
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			try {
				return line.startsWith("file:") ? vscode.Uri.parse(line).fsPath : line
			} catch {
				return line
			}
		})
		.filter((line) => {
			const ext = path.extname(line).toLowerCase().slice(1)
			return SUPPORTED_IMAGE_EXTENSIONS.includes(ext as (typeof SUPPORTED_IMAGE_EXTENSIONS)[number])
		})

	if (imagePaths.length === 0) {
		return []
	}

	return await Promise.all(imagePaths.map((imagePath) => imagePathToDataUrl(imagePath)))
}

async function imagePathToDataUrl(imagePath: string): Promise<string> {
	const buffer = await fs.readFile(imagePath)
	const base64 = buffer.toString("base64")
	const mimeType = getMimeType(imagePath)
	return `data:${mimeType};base64,${base64}`
}

function getMimeType(filePath: string): string {
	const ext = path.extname(filePath).toLowerCase()
	switch (ext) {
		case ".png":
			return "image/png"
		case ".jpeg":
		case ".jpg":
			return "image/jpeg"
		case ".webp":
			return "image/webp"
		default:
			throw new Error(`Unsupported file type: ${ext}`)
	}
}
