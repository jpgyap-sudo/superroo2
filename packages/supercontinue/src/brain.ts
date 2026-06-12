/**
 * SuperContinue Central Brain Integration
 *
 * Connects SuperContinue to the SuperRoo Central Brain MCP server
 * for lesson learning, task memory, and cross-project knowledge.
 */

import * as http from "node:http"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as crypto from "node:crypto"

const MCP_SERVER_URL = process.env.SUPERROO_MCP_URL || "http://127.0.0.1:3419/mcp"
const BRAIN_V2_API_URL = process.env.BRAIN_API_URL || "http://127.0.0.1:3456/api/brain"
const SUPERCONTINUE_TASK_LOG_PATH = path.resolve(
  process.cwd(),
  "server/src/memory/supercontinue-task.json"
)

interface SuperContinueTaskRecord {
  id: string
  title: string
  summary: string
  status: "active" | "completed" | "blocked" | "cancelled"
  project: string
  agent: string
  filesChanged: string[]
  featuresAffected: string[]
  notes: string[]
  startedAt: string
  updatedAt: string
  completedAt: string | null
}

interface SuperContinueTaskLogFile {
  tasks: SuperContinueTaskRecord[]
}

/**
 * SuperContinue Central Brain Client
 * Provides MCP-based access to the SuperRoo learning layer
 */
export class SuperContinueBrain {
  private lessonObligationRegistered = false
  private obligationTask = ""

  /**
   * Register intent to contribute a lesson (call at session start)
   */
  async registerLessonIntent(task: string): Promise<void> {
    this.obligationTask = task
    this.lessonObligationRegistered = true

    try {
      const result = await this._callMcp("brain_register_lesson_intent", {
        agent: "supercontinue",
        projectId: "superroo2",
        task,
      })
      console.log("[SuperContinue] Lesson intent registered:", result)
    } catch (err) {
      console.warn("[SuperContinue] Failed to register lesson intent:", err)
    }
  }

  /**
   * Store a lesson in the Central Brain (call before disconnecting)
   */
  async storeLesson(
    title: string,
    content: string,
    tags: string[] = [],
    files: string[] = []
  ): Promise<void> {
    try {
      const result = await this._callMcp("brain_store_lesson", {
        title,
        content,
        agent: "supercontinue",
        projectId: "superroo2",
        tags,
        files,
        confidence: 0.8,
      })
      console.log("[SuperContinue] Lesson stored:", result)
      this.lessonObligationRegistered = false
    } catch (err) {
      console.warn("[SuperContinue] Failed to store lesson, using local fallback:", err)
      await this._storeLocalLesson(title, content, tags, files)
    }
  }

  /**
   * Get relevant lessons for a task
   */
  async getRelevantLessons(task: string, limit = 5): Promise<string> {
    try {
      const result = await this._callMcp("brain_search_memory", {
        query: task,
        projectId: "superroo2",
        limit,
        minSimilarity: 0.3,
      })

      const memories = (result as { data?: { memories?: Array<{ title?: string; summary?: string; content?: string }> } })?.data?.memories || []
      if (memories.length === 0) return ""

      return memories
        .map((m, i) => `${i + 1}. ${m.title}\n   → ${m.summary || m.content?.slice(0, 100)}`)
        .join("\n\n")
    } catch (err) {
      console.warn("[SuperContinue] Failed to get lessons, using local fallback:", err)
      return await this._getLocalLessons(task, limit)
    }
  }

  /**
   * Get workflow rules from Central Brain
   */
  async getWorkflowRules(): Promise<{
    defaultCoder: string
    defaultEmbeddings: string
    defaultMemory: string
    rules: Array<{ id: string; description: string; severity: string }>
  }> {
    try {
      const result = await this._callMcp("brain_get_workflow_rules", {})
      return (result as { success?: boolean; defaultCoder?: string; defaultEmbeddings?: string; defaultMemory?: string; rules?: unknown }).success
        ? {
            defaultCoder: "deepseek",
            defaultEmbeddings: "ollama",
            defaultMemory: "central-brain-pgvector",
            rules: [],
          }
        : {
            defaultCoder: "deepseek",
            defaultEmbeddings: "ollama",
            defaultMemory: "central-brain-pgvector",
            rules: [],
          }
    } catch {
      return {
        defaultCoder: "deepseek",
        defaultEmbeddings: "ollama",
        defaultMemory: "central-brain-pgvector",
        rules: [],
      }
    }
  }

  /**
   * Check lesson obligation status
   */
  async checkLessonStatus(): Promise<{ registered: boolean; fulfilled: boolean }> {
    try {
      const result = await this._callMcp("brain_lesson_status", { agent: "supercontinue" })
      const data = result as { registered?: boolean; fulfilled?: boolean }
      return {
        registered: data.registered ?? false,
        fulfilled: data.fulfilled ?? false,
      }
    } catch {
      return {
        registered: this.lessonObligationRegistered,
        fulfilled: false,
      }
    }
  }

  /**
   * Submit a task to the Central Brain
   */
  async submitTask(goal: string, project = "superroo2"): Promise<string> {
    try {
      const result = await this._callMcp("submit_task", {
        goal,
        project,
        agent: "supercontinue",
      })
      const taskId = (result as { task?: { id?: string } })?.task?.id
      if (taskId) {
        await this._upsertTask({
          id: taskId,
          title: goal.slice(0, 120),
          summary: goal,
          status: "active",
          project,
          agent: "supercontinue",
        })
      }
      return taskId || ""
    } catch (err) {
      console.warn("[SuperContinue] Failed to submit task, using local fallback:", err)
      const task = await this._upsertTask({
        title: goal.slice(0, 120),
        summary: goal,
        status: "active",
        project,
        agent: "supercontinue",
      })
      return task.id
    }
  }

  /**
   * Get active task
   */
  async getActiveTask(): Promise<SuperContinueTaskRecord | null> {
    try {
      const result = await this._callMcp("supercontinue_task_get_active", {})
      return (result as { task?: SuperContinueTaskRecord })?.task || null
    } catch {
      return await this._getActiveTask()
    }
  }

  /**
   * Update task status
   */
  async updateTask(
    id: string,
    updates: Partial<SuperContinueTaskRecord>
  ): Promise<void> {
    const task = await this._getTask(id)
    if (task) {
      await this._upsertTask({ ...task, ...updates })
    }
  }

  // ── Private Methods ──

  private async _callMcp(method: string, params: Record<string, unknown>): Promise<unknown> {
    const res = await fetch(MCP_SERVER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "tools/call",
        params: { name: method, arguments: params },
      }),
      signal: AbortSignal.timeout(5000),
    })

    if (!res.ok) {
      throw new Error(`MCP call failed: ${res.status}`)
    }

const json = (await res.json()) as { result?: unknown }
     return json.result
  }

  private async _readTaskLog(): Promise<SuperContinueTaskLogFile> {
    try {
      const raw = await fs.readFile(SUPERCONTINUE_TASK_LOG_PATH, "utf8")
      const parsed = JSON.parse(raw) as Partial<SuperContinueTaskLogFile>
      return { tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [] }
    } catch (err) {
      if (err instanceof Error && err.message.includes("ENOENT")) {
        return { tasks: [] }
      }
      throw err
    }
  }

  private async _writeTaskLog(data: SuperContinueTaskLogFile): Promise<void> {
    await fs.mkdir(path.dirname(SUPERCONTINUE_TASK_LOG_PATH), { recursive: true })
    const tempPath = `${SUPERCONTINUE_TASK_LOG_PATH}.tmp`
    await fs.writeFile(tempPath, JSON.stringify(data, null, 2), "utf8")
    await fs.rename(tempPath, SUPERCONTINUE_TASK_LOG_PATH)
  }

  private async _upsertTask(input: Partial<SuperContinueTaskRecord>): Promise<SuperContinueTaskRecord> {
    const now = new Date().toISOString()
    const data = await this._readTaskLog()
    const requestedId = typeof input.id === "string" ? input.id : undefined
    const existing = requestedId ? data.tasks.find((task) => task.id === requestedId) : undefined
    const status = (input.status as string) || existing?.status || "active"

    const task: SuperContinueTaskRecord = {
      id: existing?.id || requestedId || `sc_task_${crypto.randomUUID()}`,
      title: typeof input.title === "string" ? input.title : existing?.title || "Untitled task",
      summary: typeof input.summary === "string" ? input.summary : existing?.summary || "",
      status: status as "active" | "completed" | "blocked" | "cancelled",
      project: typeof input.project === "string" ? input.project : existing?.project || "superroo2",
      agent: typeof input.agent === "string" ? input.agent : existing?.agent || "supercontinue",
      filesChanged: Array.isArray(input.filesChanged)
        ? input.filesChanged
        : existing?.filesChanged || [],
      featuresAffected: Array.isArray(input.featuresAffected)
        ? input.featuresAffected
        : existing?.featuresAffected || [],
      notes: Array.isArray(input.notes) ? input.notes : existing?.notes || [],
      startedAt: existing?.startedAt || now,
      updatedAt: now,
      completedAt: ["completed", "blocked", "cancelled"].includes(status)
        ? now
        : existing?.completedAt || null,
    }

    if (existing) {
      Object.assign(existing, task)
    } else {
      data.tasks.unshift(task)
    }
    data.tasks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    await this._writeTaskLog({ tasks: data.tasks.slice(0, 500) })
    return task
  }

  private async _getTask(id: string): Promise<SuperContinueTaskRecord | null> {
    const data = await this._readTaskLog()
    return data.tasks.find((task) => task.id === id) || null
  }

  private async _getActiveTask(): Promise<SuperContinueTaskRecord | null> {
    const data = await this._readTaskLog()
    return data.tasks.find((task) => task.status === "active") || null
  }

  private async _storeLocalLesson(
    title: string,
    content: string,
    tags: string[],
    files: string[]
  ): Promise<void> {
    const lessonEntry = {
      id: `sc_${crypto.randomUUID()}`,
      title,
      type: "lesson",
      date: new Date().toISOString().split("T")[0],
      source: "supercontinue",
      model: "local-ollama",
      confidence: "high" as const,
      files,
      tags: [...tags, "supercontinue"],
      relevance_score: 0.8,
      relevance_factors: {},
      rule_summary: content.slice(0, 200),
      lesson_summary: content.slice(0, 300),
    }

    const lessonIndexPath = path.resolve(process.cwd(), "memory/lesson-index.jsonl")
    await fs.appendFile(lessonIndexPath, JSON.stringify(lessonEntry) + "\n", "utf8")
  }

  private async _getLocalLessons(task: string, limit: number): Promise<string> {
    try {
      const lessonIndexPath = path.resolve(process.cwd(), "memory/lesson-index.jsonl")
      const raw = await fs.readFile(lessonIndexPath, "utf8")
      const lines = raw.split("\n").filter((l) => l.trim())
      const q = task.toLowerCase()

      const matches = lines
        .map((line) => {
          try {
            return JSON.parse(line) as { title?: string; rule_summary?: string }
          } catch {
            return null
          }
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
        .filter((entry) => JSON.stringify(entry).toLowerCase().includes(q))
        .slice(0, limit)

      return matches
        .map((m, i) => `${i + 1}. ${m.title}\n   → ${m.rule_summary}`)
        .join("\n\n")
    } catch {
      return ""
    }
  }
}

// Singleton instance
let defaultBrain: SuperContinueBrain | null = null

export function getSuperContinueBrain(): SuperContinueBrain {
  if (!defaultBrain) {
    defaultBrain = new SuperContinueBrain()
  }
  return defaultBrain
}