import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"

import { CodeChangeStore } from "../CodeChangeStore"

let tmpDir: string
let store: CodeChangeStore

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "code-change-test-"))
	store = new CodeChangeStore(tmpDir)
})

afterEach(async () => {
	await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
})

describe("CodeChangeStore", () => {
	it("loads empty array when no file exists", async () => {
		const changes = await store.load("task-1")
		expect(changes).toEqual([])
	})

	it("appends and loads changes", async () => {
		await store.append("task-1", {
			id: "c1",
			taskId: "task-1",
			timestamp: 1000,
			filePath: "/workspace/a.ts",
			operation: "write",
			beforeContent: "old",
			afterContent: "new",
		})
		const changes = await store.load("task-1")
		expect(changes).toHaveLength(1)
		expect(changes[0].filePath).toBe("/workspace/a.ts")
	})

	it("reverts a change by restoring beforeContent", async () => {
		const filePath = path.join(tmpDir, "a.ts")
		await fs.writeFile(filePath, "current", "utf8")

		await store.append("task-1", {
			id: "c1",
			taskId: "task-1",
			timestamp: 1000,
			filePath,
			operation: "write",
			beforeContent: "original",
			afterContent: "current",
		})

		const reverted = await store.revert("task-1", "c1")
		expect(reverted).toBeDefined()
		expect(reverted!.id).toBe("c1")

		const restored = await fs.readFile(filePath, "utf8")
		expect(restored).toBe("original")

		const remaining = await store.load("task-1")
		expect(remaining).toHaveLength(0)
	})

	it("reverts a create change by removing the created file", async () => {
		const filePath = path.join(tmpDir, "created.ts")
		await fs.writeFile(filePath, "created", "utf8")

		await store.append("task-1", {
			id: "c-create",
			taskId: "task-1",
			timestamp: 1000,
			filePath,
			operation: "create",
			afterContent: "created",
		})

		const reverted = await store.revert("task-1", "c-create")
		expect(reverted).toBeDefined()
		await expect(fs.stat(filePath)).rejects.toThrow()

		const remaining = await store.load("task-1")
		expect(remaining).toHaveLength(0)
	})

	it("returns undefined when reverting non-existent change", async () => {
		const result = await store.revert("task-1", "no-such-id")
		expect(result).toBeUndefined()
	})

	it("returns undefined when reverting without beforeContent", async () => {
		await store.append("task-1", {
			id: "c2",
			taskId: "task-1",
			timestamp: 1000,
			filePath: "/workspace/b.ts",
			operation: "delete",
		})
		const result = await store.revert("task-1", "c2")
		expect(result).toBeUndefined()
	})
})
