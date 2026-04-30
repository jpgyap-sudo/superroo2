import { describe, expect, it, beforeEach, afterEach } from "vitest"

import { EventLog } from "../logging/EventLog"
import { MemoryStore } from "../memory/MemoryStore"

describe("MemoryStore — migrations + meta", () => {
	let store: MemoryStore

	beforeEach(() => {
		store = new MemoryStore(":memory:")
	})

	afterEach(() => {
		store.close()
	})

	it("applies initial schema and reports version 3", () => {
		expect(store.getSchemaVersion()).toBe(3)
	})

	it("creates all expected tables", () => {
		const rows = store
			.getDb()
			.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
			.all() as Array<{ name: string }>
		const names = rows.map((r) => r.name)
		for (const t of ["_meta", "tasks", "features", "bugs", "fixes", "decisions", "events"]) {
			expect(names).toContain(t)
		}
	})

	it("is idempotent on reopen (in-memory case via fresh store)", () => {
		const v1 = store.getSchemaVersion()
		// Re-running migrations on the same db must not throw.
		expect(() => new MemoryStore(":memory:")).not.toThrow()
		expect(v1).toBe(3)
	})
})

describe("MemoryStore — decisions", () => {
	let store: MemoryStore
	beforeEach(() => {
		store = new MemoryStore(":memory:")
	})
	afterEach(() => store.close())

	it("records and lists decisions in reverse chronological order", () => {
		store.recordDecision({ id: "d1", title: "first", context: "c", decision: "x", createdAt: 100 })
		store.recordDecision({ id: "d2", title: "second", context: "c", decision: "y", createdAt: 200 })
		const list = store.listDecisions()
		expect(list).toHaveLength(2)
		expect(list[0].id).toBe("d2")
		expect(list[1].id).toBe("d1")
	})

	it("preserves alternatives and tags", () => {
		store.recordDecision({
			id: "d1",
			title: "t",
			context: "c",
			decision: "d",
			alternatives: ["a", "b"],
			tags: ["x", "y"],
		})
		const [row] = store.listDecisions()
		expect(row.alternatives).toEqual(["a", "b"])
		expect(row.tags).toEqual(["x", "y"])
	})
})

describe("EventLog — emit, persist, subscribe", () => {
	let store: MemoryStore
	let log: EventLog
	beforeEach(() => {
		store = new MemoryStore(":memory:")
		log = new EventLog(store)
	})
	afterEach(() => store.close())

	it("persists emitted events", () => {
		log.info("orchestrator.started", "boot")
		log.error("task.failed", "kaboom", { taskId: "t1" })
		const events = log.recent()
		expect(events).toHaveLength(2)
		expect(events.map((e) => e.type).sort()).toEqual(["orchestrator.started", "task.failed"])
	})

	it("notifies subscribers synchronously", () => {
		const seen: string[] = []
		log.subscribe((ev) => seen.push(ev.type))
		log.info("a.b", "1")
		log.warn("c.d", "2")
		expect(seen).toEqual(["a.b", "c.d"])
	})

	it("subscriber errors do not break emit", () => {
		log.subscribe(() => {
			throw new Error("nope")
		})
		expect(() => log.info("a.b", "ok")).not.toThrow()
		expect(log.recent()).toHaveLength(1)
	})

	it("unsubscribe stops further notifications", () => {
		const seen: string[] = []
		const unsub = log.subscribe((ev) => seen.push(ev.type))
		log.info("a", "1")
		unsub()
		log.info("b", "2")
		expect(seen).toEqual(["a"])
	})

	it("filters by type and taskId", () => {
		log.info("a.b", "1", { taskId: "t1" })
		log.info("a.b", "2", { taskId: "t2" })
		log.info("c.d", "3", { taskId: "t1" })
		expect(log.recent({ type: "a.b" })).toHaveLength(2)
		expect(log.recent({ taskId: "t1" })).toHaveLength(2)
		expect(log.recent({ taskId: "t1", type: "a.b" })).toHaveLength(1)
	})

	it("limits results", () => {
		for (let i = 0; i < 5; i++) log.info("e", `m${i}`)
		expect(log.recent({ limit: 2 })).toHaveLength(2)
	})
})
