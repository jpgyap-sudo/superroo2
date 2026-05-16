// npx vitest run src/components/chat/__tests__/ChatView.file-attachments.spec.tsx

import { describe, it, expect } from "vitest"

// Standalone test of the message-building logic extracted from ChatView
function buildMessageWithFiles(
	text: string,
	selectedFiles: { name: string; content: string; isText: boolean }[],
): string {
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
	selectedFiles: { type: string; content: string }[],
	maxImages: number,
): string[] {
	const fileImages = selectedFiles
		.filter((file) => file.type.startsWith("image/") && file.content.startsWith("data:image/"))
		.map((file) => file.content)

	return [...images, ...fileImages].slice(0, maxImages)
}

describe("buildMessageWithFiles", () => {
	it("returns plain text when no files are attached", () => {
		const result = buildMessageWithFiles("Hello", [])
		expect(result).toBe("Hello")
	})

	it("appends text file content to the message", () => {
		const files = [{ name: "README.md", content: "# Title\nSome content", isText: true }]
		const result = buildMessageWithFiles("Hello", files)
		expect(result).toBe("Hello\n\n--- README.md ---\n# Title\nSome content")
	})

	it("ignores non-text files", () => {
		const files = [
			{ name: "README.md", content: "# Title", isText: true },
			{ name: "image.png", content: "base64...", isText: false },
		]
		const result = buildMessageWithFiles("Hello", files)
		expect(result).toBe("Hello\n\n--- README.md ---\n# Title")
	})

	it("handles multiple text files", () => {
		const files = [
			{ name: "A.md", content: "Content A", isText: true },
			{ name: "B.txt", content: "Content B", isText: true },
		]
		const result = buildMessageWithFiles("Hello", files)
		expect(result).toBe("Hello\n\n--- A.md ---\nContent A\n\n--- B.txt ---\nContent B")
	})

	it("returns only file contents when text is empty", () => {
		const files = [{ name: "notes.md", content: "Important notes", isText: true }]
		const result = buildMessageWithFiles("", files)
		expect(result).toBe("--- notes.md ---\nImportant notes")
	})
})

describe("buildImagesWithFiles", () => {
	it("promotes paperclip image files into the outgoing image payload", () => {
		const result = buildImagesWithFiles([], [{ type: "image/png", content: "data:image/png;base64,abc123" }], 20)

		expect(result).toEqual(["data:image/png;base64,abc123"])
	})
})
