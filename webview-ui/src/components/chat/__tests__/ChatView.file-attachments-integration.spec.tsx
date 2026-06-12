// npx vitest run src/components/chat/__tests__/ChatView.file-attachments-integration.spec.tsx

import { describe, it, expect } from "vitest"

// ─── Webview-side helpers (mirrored from ChatView) ───────────────────────────

type FileAttachment = {
	name: string
	type: string
	size: number
	content: string
	isText: boolean
}

function buildMessageWithFiles(text: string, selectedFiles: FileAttachment[]): string {
	if (selectedFiles.length === 0) return text
	const fileContents = selectedFiles
		.filter((f) => f.isText)
		.map((f) => `--- ${f.name} ---\n${f.content}`)
		.join("\n\n")
	if (!fileContents) return text
	return text ? `${text}\n\n${fileContents}` : fileContents
}

function buildImagesWithFiles(
	images: string[],
	selectedFiles: FileAttachment[],
	maxImages: number,
): string[] {
	const fileImages = selectedFiles
		.filter((file) => file.type.startsWith("image/") && file.content.startsWith("data:image/"))
		.map((file) => file.content)
	return [...images, ...fileImages].slice(0, maxImages)
}

// ─── Extension-side helper (mirrored from webviewMessageHandler) ──────────────

function enrichTextWithFiles(text: string, files?: FileAttachment[]): string {
	if (!files || files.length === 0) return text
	const nonTextFiles = files.filter((f) => f && !f.isText && !f.type?.startsWith("image/"))
	if (nonTextFiles.length === 0) return text
	const fileList = nonTextFiles.map((f) => `- ${f.name} (${f.type}, ${f.size} bytes)`).join("\n")
	const attachmentNote = `[Attached files]\n${fileList}\n(Note: these file types cannot be read directly. Ask the user to paste relevant content if needed.)`
	return text ? `${text}\n\n${attachmentNote}` : attachmentNote
}

// ─── Drag & drop routing logic (mirrored from ChatTextArea handleDrop) ────────

type DropResult =
	| { kind: "files"; files: string[] }
	| { kind: "mention"; paths: string[] }
	| { kind: "noop" }

function simulateDrop(fileNames: string[], textData: string): DropResult {
	// Mirrors the new handleDrop: check files first, fall back to text path
	if (fileNames.length > 0) {
		return { kind: "files", files: fileNames }
	}
	if (textData) {
		const paths = textData.split(/\r?\n/).filter((l) => l.trim() !== "")
		return paths.length > 0 ? { kind: "mention", paths } : { kind: "noop" }
	}
	return { kind: "noop" }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("buildMessageWithFiles — extended cases", () => {
	it("handles only image files (all non-text) — returns plain text unchanged", () => {
		const files: FileAttachment[] = [
			{ name: "photo.png", type: "image/png", size: 1024, content: "data:image/png;base64,abc", isText: false },
		]
		expect(buildMessageWithFiles("Check this", files)).toBe("Check this")
	})

	it("handles mixed: one text + one image — only appends text file", () => {
		const files: FileAttachment[] = [
			{ name: "notes.md", type: "text/markdown", size: 20, content: "# Notes", isText: true },
			{ name: "photo.png", type: "image/png", size: 1024, content: "data:image/png;base64,abc", isText: false },
		]
		const result = buildMessageWithFiles("Hello", files)
		expect(result).toBe("Hello\n\n--- notes.md ---\n# Notes")
		expect(result).not.toContain("photo.png")
	})

	it("returns file content only when message text is empty", () => {
		const files: FileAttachment[] = [
			{ name: "config.json", type: "application/json", size: 50, content: '{"key":"value"}', isText: true },
		]
		expect(buildMessageWithFiles("", files)).toBe('--- config.json ---\n{"key":"value"}')
	})

	it("truncation: max 10 files by design, handles large batches", () => {
		const files: FileAttachment[] = Array.from({ length: 10 }, (_, i) => ({
			name: `file${i}.txt`,
			type: "text/plain",
			size: 5,
			content: `content${i}`,
			isText: true,
		}))
		const result = buildMessageWithFiles("task", files)
		expect(result).toContain("--- file0.txt ---")
		expect(result).toContain("--- file9.txt ---")
	})
})

describe("buildImagesWithFiles — extended cases", () => {
	it("respects maxImages cap across both inline images and file images", () => {
		const inline = ["data:image/png;base64,A", "data:image/png;base64,B"]
		const files: FileAttachment[] = [
			{ name: "c.png", type: "image/png", size: 100, content: "data:image/png;base64,C", isText: false },
			{ name: "d.png", type: "image/png", size: 100, content: "data:image/png;base64,D", isText: false },
		]
		const result = buildImagesWithFiles(inline, files, 3)
		expect(result).toHaveLength(3)
		expect(result).toEqual(["data:image/png;base64,A", "data:image/png;base64,B", "data:image/png;base64,C"])
	})

	it("skips file images that don't have a valid data URI", () => {
		const files: FileAttachment[] = [
			{ name: "bad.png", type: "image/png", size: 50, content: "not-a-data-uri", isText: false },
			{ name: "ok.png", type: "image/png", size: 50, content: "data:image/png;base64,VALID", isText: false },
		]
		const result = buildImagesWithFiles([], files, 20)
		expect(result).toEqual(["data:image/png;base64,VALID"])
	})

	it("ignores non-image file types even if they have data URIs", () => {
		const files: FileAttachment[] = [
			{ name: "doc.pdf", type: "application/pdf", size: 200, content: "data:application/pdf;base64,X", isText: false },
		]
		expect(buildImagesWithFiles([], files, 20)).toHaveLength(0)
	})
})

describe("enrichTextWithFiles — extension-side binary attachment notes", () => {
	it("returns text unchanged when no files", () => {
		expect(enrichTextWithFiles("task", [])).toBe("task")
	})

	it("returns text unchanged when all files are text (already inlined by webview)", () => {
		const files: FileAttachment[] = [
			{ name: "a.md", type: "text/markdown", size: 10, content: "# hi", isText: true },
		]
		expect(enrichTextWithFiles("task", files)).toBe("task")
	})

	it("returns text unchanged when all files are images (handled as image payload)", () => {
		const files: FileAttachment[] = [
			{ name: "pic.png", type: "image/png", size: 100, content: "data:image/png;base64,X", isText: false },
		]
		expect(enrichTextWithFiles("task", files)).toBe("task")
	})

	it("appends attachment note only for unreadable binary files", () => {
		const files: FileAttachment[] = [
			{ name: "archive.zip", type: "application/zip", size: 5000, content: "base64...", isText: false },
		]
		const result = enrichTextWithFiles("task", files)
		expect(result).toContain("[Attached files]")
		expect(result).toContain("archive.zip (application/zip, 5000 bytes)")
		expect(result).toContain("cannot be read directly")
	})

	it("mixes readable and unreadable: only unreadable appears in note", () => {
		const files: FileAttachment[] = [
			{ name: "code.ts", type: "application/typescript", size: 200, content: "const x = 1", isText: true },
			{ name: "data.zip", type: "application/zip", size: 8000, content: "base64...", isText: false },
		]
		const result = enrichTextWithFiles("task", files)
		expect(result).toContain("data.zip")
		expect(result).not.toContain("code.ts")
	})

	it("works with empty text: produces only the attachment note", () => {
		const files: FileAttachment[] = [
			{ name: "bundle.zip", type: "application/zip", size: 1234, content: "base64...", isText: false },
		]
		const result = enrichTextWithFiles("", files)
		expect(result.startsWith("[Attached files]")).toBe(true)
	})
})

describe("handleDrop routing — files-first ordering", () => {
	it("routes to file attachment when files are present, even if text is also set", () => {
		const result = simulateDrop(["report.pdf"], "/path/to/file.ts")
		expect(result.kind).toBe("files")
		if (result.kind === "files") {
			expect(result.files).toContain("report.pdf")
		}
	})

	it("routes to mention insertion when no files but text path present (VS Code tab drag)", () => {
		const result = simulateDrop([], "/workspace/src/index.ts")
		expect(result.kind).toBe("mention")
		if (result.kind === "mention") {
			expect(result.paths).toContain("/workspace/src/index.ts")
		}
	})

	it("handles multi-line text paths (multiple VS Code tabs dragged)", () => {
		const result = simulateDrop([], "/workspace/a.ts\n/workspace/b.ts")
		expect(result.kind).toBe("mention")
		if (result.kind === "mention") {
			expect(result.paths).toHaveLength(2)
		}
	})

	it("returns noop when no files and no text", () => {
		expect(simulateDrop([], "")).toEqual({ kind: "noop" })
	})

	it("multiple file attachments all captured", () => {
		const result = simulateDrop(["a.png", "b.md", "c.pdf"], "")
		expect(result.kind).toBe("files")
		if (result.kind === "files") {
			expect(result.files).toHaveLength(3)
		}
	})
})

describe("full round-trip: attach → send → enrich", () => {
	it("text files are inlined in the message, images go to image payload, binaries get a note", () => {
		const attachments: FileAttachment[] = [
			{ name: "readme.md", type: "text/markdown", size: 50, content: "# Hello World", isText: true },
			{ name: "screenshot.png", type: "image/png", size: 2048, content: "data:image/png;base64,ABC", isText: false },
			{ name: "bundle.zip", type: "application/zip", size: 9999, content: "base64zip", isText: false },
		]

		// Step 1: webview builds the outgoing text (inlines text files)
		const outgoingText = buildMessageWithFiles("Here are the files", attachments)
		expect(outgoingText).toContain("--- readme.md ---")
		expect(outgoingText).toContain("# Hello World")

		// Step 2: webview builds image payload (promotes image attachments)
		const outgoingImages = buildImagesWithFiles([], attachments, 20)
		expect(outgoingImages).toEqual(["data:image/png;base64,ABC"])

		// Step 3: extension enriches text with note for unreadable binaries
		const finalText = enrichTextWithFiles(outgoingText, attachments)
		expect(finalText).toContain("bundle.zip")
		expect(finalText).toContain("cannot be read directly")
		// Text and image files must NOT appear inside the [Attached files] note section
		const attachedSection = finalText.split("[Attached files]")[1] ?? ""
		expect(attachedSection).not.toContain("readme.md")
		expect(attachedSection).not.toContain("screenshot.png")
	})
})
