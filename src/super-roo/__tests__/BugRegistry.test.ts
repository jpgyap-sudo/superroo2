import { describe, expect, it, beforeEach, afterEach } from "vitest"

import { BugRegistry } from "../bugs/BugRegistry"
import { EventLog } from "../logging/EventLog"
import { MemoryStore } from "../memory/MemoryStore"

describe("BugRegistry", () => {
	let store: MemoryStore
	let log: EventLog
	let bugs: BugRegistry

	beforeEach(() => {
		store = new MemoryStore(":memory:")
		log = new EventLog(store)
		bugs = new BugRegistry(store, log)
	})

	afterEach(() => store.close())

	it("creates a bug with defaults", () => {
		const b = bugs.create({ title: "Login crashes on empty password" })
		expect(b.id).toMatch(/^bug_/)
		expect(b.severity).toBe("medium")
		expect(b.status).toBe("open")
		expect(b.fixAttempts).toBe(0)
		expect(b.symptoms).toEqual([])
	})

	it("emits a warn-level bug.recorded event", () => {
		bugs.create({ title: "x", severity: "high" })
		const ev = log.recent({ type: "bug.recorded" })[0]
		expect(ev).toBeDefined()
		expect(ev.level).toBe("warn")
		expect(ev.data).toMatchObject({ severity: "high" })
	})

	it("rejects empty title", () => {
		expect(() => bugs.create({ title: "" })).toThrow()
		expect(() => bugs.create({ title: "   " })).toThrow()
	})

	it("retrieves by id", () => {
		const b = bugs.create({ title: "x" })
		expect(bugs.get(b.id)?.id).toBe(b.id)
		expect(bugs.get("missing")).toBeNull()
	})

	it("lists with severity and status filters", () => {
		bugs.create({ title: "a", severity: "low" })
		bugs.create({ title: "b", severity: "critical", status: "investigating" })
		bugs.create({ title: "c", severity: "critical" })
		expect(bugs.list({ severity: "critical" })).toHaveLength(2)
		expect(bugs.list({ status: "investigating" })).toHaveLength(1)
	})

	it("update patches fields and emits event", () => {
		const b = bugs.create({ title: "x" })
		const updated = bugs.update(b.id, { suspectedRootCause: "race condition", severity: "high" })
		expect(updated.suspectedRootCause).toBe("race condition")
		expect(updated.severity).toBe("high")
	})

	it("update emits bug.fixed event when status moves to fixed", () => {
		const b = bugs.create({ title: "x" })
		bugs.update(b.id, { status: "fixed" })
		expect(log.recent({ type: "bug.fixed" })).toHaveLength(1)
	})

	it("recordFix increments fixAttempts and links to bug", () => {
		const b = bugs.create({ title: "x" })
		const fix = bugs.recordFix({ bugId: b.id, summary: "patched the regex", succeeded: true })
		expect(fix.id).toMatch(/^fix_/)
		expect(fix.succeeded).toBe(true)
		const reread = bugs.get(b.id)!
		expect(reread.fixAttempts).toBe(1)
		expect(reread.status).toBe("fixed")
	})

	it("recordFix with succeeded=false leaves bug status alone but increments attempts", () => {
		const b = bugs.create({ title: "x", status: "investigating" })
		bugs.recordFix({ bugId: b.id, summary: "tried but reverted", succeeded: false })
		const reread = bugs.get(b.id)!
		expect(reread.status).toBe("investigating")
		expect(reread.fixAttempts).toBe(1)
	})

	it("listFixes returns all fixes for a bug", () => {
		const b = bugs.create({ title: "x" })
		bugs.recordFix({ bugId: b.id, summary: "a", succeeded: false })
		bugs.recordFix({ bugId: b.id, summary: "b", succeeded: true })
		expect(bugs.listFixes(b.id)).toHaveLength(2)
	})

	it("recordFix throws on unknown bugId", () => {
		expect(() => bugs.recordFix({ bugId: "missing", summary: "x", succeeded: true })).toThrow()
	})

	it("delete removes the bug and cascades to fixes", () => {
		const b = bugs.create({ title: "x" })
		bugs.recordFix({ bugId: b.id, summary: "a", succeeded: true })
		expect(bugs.delete(b.id)).toBe(true)
		expect(bugs.get(b.id)).toBeNull()
		expect(bugs.listFixes(b.id)).toHaveLength(0)
	})
})
