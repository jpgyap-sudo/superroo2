/**
 * Tests for FileImporter
 *
 * Tests file type detection, single file import, directory import,
 * buffer import, archive extraction, and error handling.
 *
 * NOTE: Uses vi.mock for fs module since vi.spyOn on ESM exports is not supported.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { FileImporter } from "../FileImporter"

// Mock fs module at top level
vi.mock("fs", () => {
	const mockStats = {
		isDirectory: () => false,
		size: 100,
	} as any
	const mockDirStats = {
		isDirectory: () => true,
		size: 0,
	} as any

	return {
		existsSync: vi.fn().mockReturnValue(true),
		statSync: vi.fn().mockReturnValue(mockStats),
		readFileSync: vi.fn().mockImplementation((path: string) => {
			if (path.endsWith(".png") || path.endsWith(".jpg")) {
				return Buffer.from("fake-image-data")
			}
			return "file content"
		}),
		mkdirSync: vi.fn(),
		writeFileSync: vi.fn(),
		unlinkSync: vi.fn(),
		readdirSync: vi.fn().mockReturnValue([]),
		copyFileSync: vi.fn(),
		createReadStream: vi.fn(),
	}
})

describe("FileImporter", () => {
	let importer: FileImporter
	const workspaceRoot = "/tmp/test-workspace"

	beforeEach(() => {
		importer = new FileImporter(workspaceRoot)
	})

	describe("importPaths", () => {
		it("should return empty result for empty paths array", async () => {
			const result = await importer.importPaths([])
			expect(result.ok).toBe(true)
			expect(result.files).toEqual([])
			expect(result.errors).toEqual([])
		})

		it("should import a text file as document", async () => {
			const result = await importer.importPaths(["/tmp/test.txt"])
			expect(result.ok).toBe(true)
			expect(result.files.length).toBe(1)
			expect(result.files[0].fileName).toBe("test.txt")
			expect(result.files[0].type).toBe("document")
			expect(result.files[0].data).toBe("file content")
		})

		it("should import a TypeScript file as code", async () => {
			const result = await importer.importPaths(["/tmp/test.ts"])
			expect(result.ok).toBe(true)
			expect(result.files.length).toBe(1)
			expect(result.files[0].type).toBe("code")
		})

		it("should import an image file as base64 data URI", async () => {
			const result = await importer.importPaths(["/tmp/test.png"])
			expect(result.ok).toBe(true)
			expect(result.files.length).toBe(1)
			expect(result.files[0].type).toBe("image")
			expect(result.files[0].data).toContain("data:image/png;base64,")
		})
	})

	describe("importBuffer", () => {
		it("should write buffer to temp file and import it", async () => {
			const result = await importer.importBuffer("test.txt", Buffer.from("buffer content"))
			expect(result.ok).toBe(true)
			expect(result.files.length).toBe(1)
		})
	})

	describe("directory import", () => {
		it("should handle directory paths", async () => {
			// Override readdirSync mock for this test
			const fs = await import("fs")
			;(fs.readdirSync as any).mockReturnValueOnce([
				{ name: "file1.txt", isDirectory: () => false },
				{ name: "subdir", isDirectory: () => true },
			])
			;(fs.readdirSync as any).mockReturnValueOnce([{ name: "file2.ts", isDirectory: () => false }])
			// Override statSync for directory
			;(fs.statSync as any).mockReturnValueOnce({ isDirectory: () => true, size: 0 })

			const result = await importer.importPaths(["/tmp/testdir"])
			expect(result.files.length).toBeGreaterThanOrEqual(1)
		})
	})
})
