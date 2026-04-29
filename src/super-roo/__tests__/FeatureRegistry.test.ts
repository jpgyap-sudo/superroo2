import { describe, expect, it, beforeEach, afterEach } from "vitest"

import { EventLog } from "../logging/EventLog"
import { FeatureRegistry } from "../features/FeatureRegistry"
import { MemoryStore } from "../memory/MemoryStore"

describe("FeatureRegistry", () => {
	let store: MemoryStore
	let log: EventLog
	let registry: FeatureRegistry

	beforeEach(() => {
		store = new MemoryStore(":memory:")
		log = new EventLog(store)
		registry = new FeatureRegistry(store, log)
	})

	afterEach(() => store.close())

	it("creates a feature with defaults filled in", () => {
		const f = registry.create({ name: "Kimi API", description: "Moonshot integration" })
		expect(f.id).toMatch(/^feat_/)
		expect(f.status).toBe("planned")
		expect(f.health).toBe("unknown")
		expect(f.priority).toBe("normal")
		expect(f.fixAttempts).toBe(0)
		expect(f.lastCheckedAt).toBeNull()
		expect(f.bugIds).toEqual([])
	})

	it("emits a feature.created event", () => {
		registry.create({ name: "X" })
		const events = log.recent({ type: "feature.created" })
		expect(events).toHaveLength(1)
		expect(events[0].featureId).toMatch(/^feat_/)
	})

	it("rejects missing name via Zod", () => {
		expect(() => registry.create({ name: "" } as never)).toThrow()
	})

	it("retrieves by id and by name", () => {
		const f = registry.create({ name: "Telegram Bot" })
		expect(registry.get(f.id)?.id).toBe(f.id)
		expect(registry.getByName("Telegram Bot")?.id).toBe(f.id)
		expect(registry.get("missing")).toBeNull()
	})

	it("lists with status filter", () => {
		registry.create({ name: "A", status: "working" })
		registry.create({ name: "B", status: "broken" })
		registry.create({ name: "C", status: "broken" })
		expect(registry.list({ status: "broken" })).toHaveLength(2)
		expect(registry.list({ status: "working" })).toHaveLength(1)
		expect(registry.list()).toHaveLength(3)
	})

	it("update emits feature.status_changed when status differs", () => {
		const f = registry.create({ name: "A" })
		registry.update(f.id, { status: "broken" })
		const evs = log.recent({ type: "feature.status_changed" })
		expect(evs).toHaveLength(1)
		expect(evs[0].data).toMatchObject({ from: "planned", to: "broken" })
	})

	it("update emits feature.updated when status unchanged", () => {
		const f = registry.create({ name: "A" })
		registry.update(f.id, { description: "new desc" })
		expect(log.recent({ type: "feature.updated" })).toHaveLength(1)
		expect(log.recent({ type: "feature.status_changed" })).toHaveLength(0)
	})

	it("recordHealthCheck updates timestamp and health", () => {
		const f = registry.create({ name: "A" })
		const updated = registry.recordHealthCheck(f.id, "healthy")
		expect(updated.health).toBe("healthy")
		expect(updated.lastCheckedAt).not.toBeNull()
	})

	it("delete returns true when row removed", () => {
		const f = registry.create({ name: "A" })
		expect(registry.delete(f.id)).toBe(true)
		expect(registry.get(f.id)).toBeNull()
		expect(registry.delete(f.id)).toBe(false)
	})

	it("enforces unique name", () => {
		registry.create({ name: "Same" })
		expect(() => registry.create({ name: "Same" })).toThrow()
	})
})
