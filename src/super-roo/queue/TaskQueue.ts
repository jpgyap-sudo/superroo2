/**
 * Super Roo — Task Queue.
 *
 * Persistent priority queue backed by the `tasks` SQLite table. Survives
 * extension reloads — pending tasks pick up where they left off. Phase 1 is
 * intentionally serial (concurrency=1); the orchestrator will use this queue
 * to feed work to the (Phase 2) agent registry one task at a time.
 *
 * Priority ordering: critical > high > normal > low, then FIFO by createdAt.
 *
 * Why SQL-backed (not just in-memory)?
 *   - The architecture pack lists "task queue" as a Phase 1 deliverable that
 *     must persist across runs.
 *   - It plays nice with the future BullMQ swap: same enqueue/dequeue API,
 *     just a different backend.
 */

import { v4 as uuidv4 } from "uuid"

import type { EventLog } from "../logging/EventLog"
import type { MemoryStore } from "../memory/MemoryStore"
import type { Task, TaskInput, TaskInputRaw, TaskPriority, TaskStatus } from "../types"
import { TaskInputSchema } from "../types"


interface TaskRow {
	id: string
	agent: string
	goal: string
	priority: string
	status: string
	parent_task_id: string | null
	feature_id: string | null
	bug_id: string | null
	required_capabilities: string
	payload: string
	max_iterations: number
	attempts: number
	error: string | null
	result_summary: string | null
	coded_by: string | null
	created_at: number
	updated_at: number
	started_at: number | null
	finished_at: number | null
}

function rowToTask(r: TaskRow): Task {
	return {
		id: r.id,
		agent: r.agent,
		goal: r.goal,
		priority: r.priority as TaskPriority,
		status: r.status as TaskStatus,
		parentTaskId: r.parent_task_id ?? undefined,
		featureId: r.feature_id ?? undefined,
		bugId: r.bug_id ?? undefined,
		requiredCapabilities: JSON.parse(r.required_capabilities) as string[],
		payload: JSON.parse(r.payload) as Record<string, unknown>,
		maxIterations: r.max_iterations,
		attempts: r.attempts,
		error: r.error ?? undefined,
		resultSummary: r.result_summary ?? undefined,
		codedBy: r.coded_by ?? undefined,
		createdAt: r.created_at,
		updatedAt: r.updated_at,
		startedAt: r.started_at ?? undefined,
		finishedAt: r.finished_at ?? undefined,
	}
}

export class TaskQueue {
	constructor(
		private readonly memory: MemoryStore,
		private readonly events: EventLog,
	) {}

	enqueue(input: TaskInputRaw): Task {
		// TaskInputSchema.parse() returns the schema's output type with defaults
		// filled. The runtime guarantees the TaskInput shape; we assert it.
		const parsed = TaskInputSchema.parse(input) as TaskInput
		const now = Date.now()
		const id = `task_${uuidv4()}`

		this.memory
			.getDb()
			.prepare(
				`INSERT INTO tasks
					(id, agent, goal, priority, status, parent_task_id, feature_id, bug_id,
					 required_capabilities, payload, max_iterations, attempts, coded_by,
					 created_at, updated_at)
				 VALUES
					(@id, @agent, @goal, @priority, 'pending', @parentTaskId, @featureId, @bugId,
					 @requiredCapabilities, @payload, @maxIterations, 0, @codedBy, @now, @now)`,
			)
			.run({
				id,
				agent: parsed.agent,
				goal: parsed.goal,
				priority: parsed.priority,
				parentTaskId: parsed.parentTaskId ?? null,
				featureId: parsed.featureId ?? null,
				bugId: parsed.bugId ?? null,
				requiredCapabilities: JSON.stringify(parsed.requiredCapabilities),
				payload: JSON.stringify(parsed.payload),
				maxIterations: parsed.maxIterations,
				codedBy: parsed.codedBy ?? null,
				now,
			})

		const task = this.get(id)!
		this.events.info("task.enqueued", `Enqueued: ${task.goal}`, {
			taskId: id,
			agent: task.agent,
			featureId: task.featureId,
			bugId: task.bugId,
			data: { priority: task.priority },
		})
		return task
	}

	get(id: string): Task | null {
		const row = this.memory.getDb().prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined
		return row ? rowToTask(row) : null
	}

	/**
	 * Pop the highest-priority pending task and mark it RUNNING. Atomic via a
	 * transaction so two callers never grab the same row. Returns null if
	 * nothing is pending.
	 */
	dequeue(): Task | null {
		const db = this.memory.getDb()
		const tx = db.transaction(() => {
			// Order: critical < high < normal < low (lowest rank = highest priority),
			// then oldest first.
			const row = db
				.prepare(
					`SELECT * FROM tasks
					 WHERE status = 'pending'
					 ORDER BY
						CASE priority
							WHEN 'critical' THEN 0
							WHEN 'high' THEN 1
							WHEN 'normal' THEN 2
							WHEN 'low' THEN 3
							ELSE 4
						END,
						created_at ASC
					 LIMIT 1`,
				)
				.get() as TaskRow | undefined
			if (!row) return null
			const now = Date.now()
			db.prepare(
				`UPDATE tasks SET status = 'running', started_at = @now, updated_at = @now,
				                  attempts = attempts + 1
				 WHERE id = @id`,
			).run({ id: row.id, now })
			row.status = "running"
			row.started_at = now
			row.updated_at = now
			row.attempts += 1
			return row
		})
		const row = tx()
		if (!row) return null
		const task = rowToTask(row)
		this.events.info("task.dequeued", `Dequeued: ${task.goal}`, { taskId: task.id, agent: task.agent })
		return task
	}

	/** Used by the orchestrator after agent.run() returns. */
	markFinished(id: string, status: Extract<TaskStatus, "succeeded" | "failed" | "blocked" | "cancelled">, opts: {
		resultSummary?: string
		error?: string
	} = {}): void {
		const now = Date.now()
		this.memory
			.getDb()
			.prepare(
				`UPDATE tasks SET status = @status, finished_at = @now, updated_at = @now,
				                  result_summary = @resultSummary, error = @error
				 WHERE id = @id`,
			)
			.run({
				id,
				status,
				now,
				resultSummary: opts.resultSummary ?? null,
				error: opts.error ?? null,
			})

		const task = this.get(id)
		if (task) {
			const eventType =
				status === "succeeded"
					? "task.succeeded"
					: status === "failed"
						? "task.failed"
						: status === "blocked"
							? "task.blocked"
							: "task.cancelled"
			const level = status === "succeeded" ? "info" : status === "failed" ? "error" : "warn"
			this.events.emit(level, eventType, `Task ${status}: ${task.goal}`, {
				taskId: id,
				agent: task.agent,
				data: { error: opts.error, resultSummary: opts.resultSummary },
			})
		}
	}

	/** All tasks matching a status, newest first. */
	list(filter: { status?: TaskStatus; agent?: string; limit?: number } = {}): Task[] {
		const where: string[] = []
		const params: Record<string, unknown> = {}
		if (filter.status) {
			where.push("status = @status")
			params.status = filter.status
		}
		if (filter.agent) {
			where.push("agent = @agent")
			params.agent = filter.agent
		}
		const limit = filter.limit ?? 200
		const rows = this.memory
			.getDb()
			.prepare(
				`SELECT * FROM tasks ${where.length ? "WHERE " + where.join(" AND ") : ""}
				 ORDER BY created_at DESC LIMIT @limit`,
			)
			.all({ ...params, limit }) as TaskRow[]
		return rows.map(rowToTask)
	}

	/** How many tasks are currently pending. */
	pendingCount(): number {
		const row = this.memory.getDb().prepare("SELECT COUNT(*) as n FROM tasks WHERE status = 'pending'").get() as
			| { n: number }
			| undefined
		return row?.n ?? 0
	}

	/**
	 * Recovery hook: any tasks left in 'running' from a previous process
	 * (e.g., crashed extension host) are reset to 'pending' so the queue can
	 * re-pick them up. Called by the orchestrator on start.
	 */
	recoverOrphanedRunningTasks(): number {
		const now = Date.now()
		const res = this.memory
			.getDb()
			.prepare(
				`UPDATE tasks SET status = 'pending', started_at = NULL, updated_at = @now
				 WHERE status = 'running'`,
			)
			.run({ now })
		return res.changes
	}
}
