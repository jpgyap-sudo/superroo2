import * as fs from "fs/promises"
import * as path from "path"
import type { CodeChange } from "@superroo/types"
import { safeWriteJson } from "../../utils/safeWriteJson"
import { getTaskDirectoryPath } from "../../utils/storage"

const CODE_CHANGES_FILE = "code_changes.json"

/**
 * Persists code changes per task so users can review history and revert.
 */
export class CodeChangeStore {
	private readonly globalStoragePath: string

	constructor(globalStoragePath: string) {
		this.globalStoragePath = globalStoragePath
	}

	private async getFilePath(taskId: string): Promise<string> {
		const taskDir = await getTaskDirectoryPath(this.globalStoragePath, taskId)
		return path.join(taskDir, CODE_CHANGES_FILE)
	}

	async load(taskId: string): Promise<CodeChange[]> {
		const filePath = await this.getFilePath(taskId)
		try {
			const raw = await fs.readFile(filePath, "utf8")
			const parsed = JSON.parse(raw) as CodeChange[]
			return Array.isArray(parsed) ? parsed : []
		} catch {
			return []
		}
	}

	async append(taskId: string, change: CodeChange): Promise<void> {
		const items = await this.load(taskId)
		items.push(change)
		const filePath = await this.getFilePath(taskId)
		await safeWriteJson(filePath, items)
	}

	async remove(taskId: string, changeId: string): Promise<void> {
		const items = await this.load(taskId)
		const filtered = items.filter((c) => c.id !== changeId)
		const filePath = await this.getFilePath(taskId)
		await safeWriteJson(filePath, filtered)
	}

	async revert(taskId: string, changeId: string): Promise<CodeChange | undefined> {
		const items = await this.load(taskId)
		const index = items.findIndex((c) => c.id === changeId)
		if (index === -1) return undefined

		const change = items[index]

		if (change.operation === "create") {
			await fs.rm(change.filePath, { force: true })
		} else if (change.beforeContent !== undefined) {
			await fs.writeFile(change.filePath, change.beforeContent, "utf8")
		} else if (change.operation === "write" || change.operation === "delete") {
			return undefined
		}

		// Remove the reverted change from history
		items.splice(index, 1)
		const filePath = await this.getFilePath(taskId)
		await safeWriteJson(filePath, items)

		return change
	}
}
