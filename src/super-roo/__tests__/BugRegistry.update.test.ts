import { describe, expect, it, beforeEach, afterEach } from "vitest"

import { BugRegistry } from "../bugs/BugRegistry"
import { EventLog } from "../logging/EventLog"
import { MemoryStore } from "../memory/MemoryStore"

describe("BugRegistry.update fixAttempts", () => {
	let store: MemoryStore
	let log: EventLog
	let bugs: BugRegistry

	beforeEach(() => {
		store = new MemoryStore(":memory:")
		log = new EventLog(store)
		bugs = new BugRegistry(store, log)
	})

	afterEach(() => store.close())

	it("can patch fixAttempts via update", () => {
		const b = bugs.create({ title: "x" })
		expect(b.fixAttempts).toBe(0)

		const updated = bugs.update(b.id, { fixAttempts: 3 })
		expect(updated.fixAttempts).toBe(3)

		const reread = bugs.get(b.id)!
		expect(reread.fixAttempts).toBe(3)
	})
})
