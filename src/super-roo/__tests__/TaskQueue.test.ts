import { describe, expect, it, beforeEach, afterEach } from "vitest"

import { EventLog } from "../logging/EventLog"
import { MemoryStore } from "../memory/MemoryStore"
import { TaskQueue } from "../queue/TaskQueue"

describe("TaskQueue", () => {
	let store: MemoryStore
	let log: EventLog
	let queue: TaskQueue

	beforeEach(() => {
		store = new MemoryStore(":memory:")
		log = new EventLog(store)
		queue = new TaskQueue(store, log)
	})

	afterEach(() => store.close())

	it("enqueues with id, status=pending, attempts=0", () => {
		const t = queue.enqueue({
			agent: "coder",
			goal: "fix login bug",
			priority: "normal",
			requiredCapabilities: [],
			payload: {},
			maxIterations: 5,
		})
		expect(t.id).toMatch(/^task_/)
		expect(t.status).toBe("pending")
		expect(t.attempts).toBe(0)
		expect(queue.pendingCount()).toBe(1)
	})

	it("dequeues by priority: critical > high > normal > low", () => {
		queue.enqueue({ agent: "a", goal: "low", priority: "low" } as never)
		queue.enqueue({ agent: "a", goal: "critical", priority: "critical" } as never)
		queue.enqueue({ agent: "a", goal: "normal", priority: "normal" } as never)
		queue.enqueue({ agent: "a", goal: "high", priority: "high" } as never)

		expect(queue.dequeue()?.goal).toBe("critical")
		expect(queue.dequeue()?.goal).toBe("high")
		expect(queue.dequeue()?.goal).toBe("normal")
		expect(queue.dequeue()?.goal).toBe("low")
		expect(queue.dequeue()).toBeNull()
	})

	it("FIFO within same priority", () => {
		const a = queue.enqueue({ agent: "x", goal: "first" } as never)
		const b = queue.enqueue({ agent: "x", goal: "second" } as never)
		expect(queue.dequeue()?.id).toBe(a.id)
		expect(queue.dequeue()?.id).toBe(b.id)
	})

	it("dequeue marks status=running, sets startedAt, increments attempts", () => {
		queue.enqueue({ agent: "a", goal: "g" } as never)
		const t = queue.dequeue()!
		expect(t.status).toBe("running")
		expect(t.startedAt).toBeTypeOf("number")
		expect(t.attempts).toBe(1)
	})

	it("markFinished moves task to terminal status with summary", () => {
		queue.enqueue({ agent: "a", goal: "g" } as never)
		const t = queue.dequeue()!
		queue.markFinished(t.id, "succeeded", { resultSummary: "all green" })
		const reread = queue.get(t.id)!
		expect(reread.status).toBe("succeeded")
		expect(reread.resultSummary).toBe("all green")
		expect(reread.finishedAt).toBeTypeOf("number")
	})

	it("emits task.enqueued / task.dequeued / task.succeeded events", () => {
		queue.enqueue({ agent: "a", goal: "g" } as never)
		const t = queue.dequeue()!
		queue.markFinished(t.id, "succeeded")
		const types = log.recent().map((e) => e.type)
		expect(types).toContain("task.enqueued")
		expect(types).toContain("task.dequeued")
		expect(types).toContain("task.succeeded")
	})

	it("emits task.failed at error level on failure", () => {
		queue.enqueue({ agent: "a", goal: "g" } as never)
		const t = queue.dequeue()!
		queue.markFinished(t.id, "failed", { error: "boom" })
		const ev = log.recent({ type: "task.failed" })[0]
		expect(ev.level).toBe("error")
		expect(ev.data).toMatchObject({ error: "boom" })
	})

	it("recoverOrphanedRunningTasks resets running tasks to pending", () => {
		queue.enqueue({ agent: "a", goal: "g" } as never)
		queue.dequeue() // status=running
		expect(queue.pendingCount()).toBe(0)
		const recovered = queue.recoverOrphanedRunningTasks()
		expect(recovered).toBe(1)
		expect(queue.pendingCount()).toBe(1)
	})

	it("list filters by agent and status", () => {
		queue.enqueue({ agent: "coder", goal: "1" } as never)
		queue.enqueue({ agent: "coder", goal: "2" } as never)
		queue.enqueue({ agent: "tester", goal: "3" } as never)
		expect(queue.list({ agent: "coder" })).toHaveLength(2)
		expect(queue.list({ agent: "tester" })).toHaveLength(1)
	})
})
