// npx vitest run src/components/chat/__tests__/ChatView.file-attachments.spec.tsx

import { describe, it, expect, vi } from "vitest"
import { renderHook } from "@testing-library/react"
import { useState } from "react"

// Standalone test of the message-building logic extracted from ChatView
function buildMessageWithFiles(text: string, selectedFiles: { name: string; content: string }[]): string {
	if (selectedFiles.length === 0) return text
	const fileContents = selectedFiles
		.filter((f) => f.name.toLowerCase().endsWith(".md"))
		.map((f) => `--- ${f.name} ---\n${f.content}`)
		.join("\n\n")
	if (!fileContents) return text
	return text ? `${text}\n\n${fileContents}` : fileContents
}

describe("buildMessageWithFiles", () => {
	it("returns plain text when no files are attached", () => {
		const result = buildMessageWithFiles("Hello", [])
		expect(result).toBe("Hello")
	})

	it("appends markdown file content to the message", () => {
		const files = [{ name: "README.md", content: "# Title\nSome content" }]
		const result = buildMessageWithFiles("Hello", files)
		expect(result).toBe("Hello\n\n--- README.md ---\n# Title\nSome content")
	})

	it("ignores non-markdown files", () => {
		const files = [
			{ name: "README.md", content: "# Title" },
			{ name: "image.png", content: "base64..." },
		]
		const result = buildMessageWithFiles("Hello", files)
		expect(result).toBe("Hello\n\n--- README.md ---\n# Title")
	})

	it("handles multiple markdown files", () => {
		const files = [
			{ name: "A.md", content: "Content A" },
			{ name: "B.md", content: "Content B" },
		]
		const result = buildMessageWithFiles("Hello", files)
		expect(result).toBe("Hello\n\n--- A.md ---\nContent A\n\n--- B.md ---\nContent B")
	})

	it("returns only file contents when text is empty", () => {
		const files = [{ name: "notes.md", content: "Important notes" }]
		const result = buildMessageWithFiles("", files)
		expect(result).toBe("--- notes.md ---\nImportant notes")
	})

	it("is case-insensitive for .md extension", () => {
		const files = [{ name: "README.MD", content: "Uppercase extension" }]
		const result = buildMessageWithFiles("Hello", files)
		expect(result).toBe("Hello\n\n--- README.MD ---\nUppercase extension")
	})
})
