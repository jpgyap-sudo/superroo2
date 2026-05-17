/**
 * Persistent task memory for Codex-style agents.
 *
 * This log is intentionally small and boring: JSON on disk, newest-first,
 * with stable IDs so agents can update a task as it moves from active to done.
 */

const fs = require("fs/promises")
const path = require("path")
const crypto = require("crypto")

const DEFAULT_MAX_TASKS = Number(process.env.CODEX_TASK_MAX_ENTRIES || "500")
const DEFAULT_ROOT = process.env.SUPERROO_ROOT || path.resolve(__dirname, "..", "..", "..")
const DEFAULT_FILE_PATH =
	process.env.CODEX_TASK_LOG_PATH || path.join(DEFAULT_ROOT, "server", "src", "memory", "codextask.json")

class CodexTaskLog {
	constructor(config = {}) {
		this.filePath = config.filePath || DEFAULT_FILE_PATH
		this.maxTasks = Number(config.maxTasks || DEFAULT_MAX_TASKS)
	}

	async initialize() {
		await fs.mkdir(path.dirname(this.filePath), { recursive: true })
		try {
			await fs.access(this.filePath)
		} catch {
			await this._write({ tasks: [] })
		}
	}

	async upsertTask(input) {
		await this.initialize()
		const now = new Date().toISOString()
		const data = await this._read()
		const existing = input.id ? data.tasks.find((task) => task.id === input.id) : null

		const task = {
			id: existing?.id || input.id || `codex_task_${crypto.randomUUID()}`,
			title: input.title || existing?.title || "Untitled task",
			summary: input.summary ?? existing?.summary ?? "",
			status: input.status || existing?.status || "active",
			project: input.project || existing?.project || "superroo2",
			agent: input.agent || existing?.agent || "Codex",
			filesChanged: input.filesChanged || existing?.filesChanged || [],
			featuresAffected: input.featuresAffected || existing?.featuresAffected || [],
			notes: input.notes || existing?.notes || [],
			startedAt: existing?.startedAt || input.startedAt || now,
			updatedAt: now,
			completedAt:
				input.completedAt ??
				(["completed", "blocked", "cancelled"].includes(input.status) ? now : existing?.completedAt || null),
		}

		if (existing) {
			Object.assign(existing, task)
		} else {
			data.tasks.unshift(task)
		}

		data.tasks.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
		data.tasks = data.tasks.slice(0, this.maxTasks)
		await this._write(data)
		return task
	}

	async listTasks(limit = 20) {
		await this.initialize()
		const data = await this._read()
		return data.tasks.slice(0, Number(limit))
	}

	async getTask(id) {
		await this.initialize()
		const data = await this._read()
		return data.tasks.find((task) => task.id === id) || null
	}

	async getActiveTask() {
		await this.initialize()
		const data = await this._read()
		return data.tasks.find((task) => task.status === "active") || null
	}

	async _read() {
		try {
			const raw = await fs.readFile(this.filePath, "utf8")
			const parsed = JSON.parse(raw)
			return { tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [] }
		} catch (err) {
			if (err.code === "ENOENT") {
				return { tasks: [] }
			}
			throw err
		}
	}

	async _write(data) {
		await fs.mkdir(path.dirname(this.filePath), { recursive: true })
		const tempPath = `${this.filePath}.tmp`
		await fs.writeFile(tempPath, JSON.stringify(data, null, 2), "utf8")
		await fs.rename(tempPath, this.filePath)
	}
}

module.exports = { CodexTaskLog }
