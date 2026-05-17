/**
 * Tests for EventLog
 *
 * Tests event emission, persistence, subscriber notification,
 * convenience methods (debug/info/warn/error), mirror-to-console,
 * subscriber isolation, and recent event retrieval.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { EventLog } from "../EventLog"
import type { EventSubscriber, EventLogOptions } from "../EventLog"
import type { MemoryStore } from "../../memory/MemoryStore"
import type { LogEvent } from "../../types"

function createMockMemory(): MemoryStore {
	return {
		insertEvent: vi.fn(),
		listEvents: vi.fn().mockReturnValue([]),
	} as unknown as MemoryStore
}

describe("EventLog", () => {
	let memory: MemoryStore
	let log: EventLog

	beforeEach(() => {
		memory = createMockMemory()
		log = new EventLog(memory)
	})

	describe("emit", () => {
		it("should create an event with required fields", () => {
			const ev = log.emit("info", "task", "Test message")
			expect(ev.id).toBeTruthy()
			expect(ev.at).toBeGreaterThan(0)
			expect(ev.level).toBe("info")
			expect(ev.type).toBe("task")
			expect(ev.message).toBe("Test message")
		})

		it("should persist event to memory store", () => {
			log.emit("info", "task", "Test message")
			expect(memory.insertEvent).toHaveBeenCalledTimes(1)
			const inserted = (memory.insertEvent as ReturnType<typeof vi.fn>).mock.calls[0][0]
			expect(inserted.level).toBe("info")
			expect(inserted.message).toBe("Test message")
		})

		it("should include optional extra fields", () => {
			const ev = log.emit("error", "deploy", "Deploy failed", {
				taskId: "task-1",
				agent: "deployer",
				featureId: "feat-1",
				bugId: "bug-1",
				incidentId: "inc-1",
				codedBy: "codex",
				data: { retries: 3 },
			})
			expect(ev.taskId).toBe("task-1")
			expect(ev.agent).toBe("deployer")
			expect(ev.featureId).toBe("feat-1")
			expect(ev.bugId).toBe("bug-1")
			expect(ev.incidentId).toBe("inc-1")
			expect(ev.codedBy).toBe("codex")
			expect(ev.data).toEqual({ retries: 3 })
		})

		it("should not crash when memory store throws", () => {
			;(memory.insertEvent as ReturnType<typeof vi.fn>).mockImplementation(() => {
				throw new Error("DB error")
			})
			const ev = log.emit("info", "task", "Should not crash")
			expect(ev.message).toBe("Should not crash")
		})
	})

	describe("convenience methods", () => {
		it("debug should emit with debug level", () => {
			const ev = log.debug("task", "Debug message")
			expect(ev.level).toBe("debug")
		})

		it("info should emit with info level", () => {
			const ev = log.info("task", "Info message")
			expect(ev.level).toBe("info")
		})

		it("warn should emit with warn level", () => {
			const ev = log.warn("task", "Warn message")
			expect(ev.level).toBe("warn")
		})

		it("error should emit with error level", () => {
			const ev = log.error("task", "Error message")
			expect(ev.level).toBe("error")
		})
	})

	describe("subscribe", () => {
		it("should notify subscribers synchronously", () => {
			const subscriber = vi.fn()
			log.subscribe(subscriber)
			log.emit("info", "task", "Notify test")
			expect(subscriber).toHaveBeenCalledTimes(1)
			expect(subscriber.mock.calls[0][0].message).toBe("Notify test")
		})

		it("should return unsubscribe function", () => {
			const subscriber = vi.fn()
			const unsubscribe = log.subscribe(subscriber)
			unsubscribe()
			log.emit("info", "task", "After unsubscribe")
			expect(subscriber).not.toHaveBeenCalled()
		})

		it("should isolate subscribers so one bad listener doesn't break others", () => {
			const badSub = vi.fn().mockImplementation(() => {
				throw new Error("Bad subscriber")
			})
			const goodSub = vi.fn()
			log.subscribe(badSub)
			log.subscribe(goodSub)
			log.emit("info", "task", "Isolation test")
			expect(goodSub).toHaveBeenCalledTimes(1)
		})

		it("should support multiple subscribers", () => {
			const sub1 = vi.fn()
			const sub2 = vi.fn()
			log.subscribe(sub1)
			log.subscribe(sub2)
			log.emit("info", "task", "Multi test")
			expect(sub1).toHaveBeenCalledTimes(1)
			expect(sub2).toHaveBeenCalledTimes(1)
		})
	})

	describe("mirrorToConsole", () => {
		it("should not mirror to console by default", () => {
			const consoleSpy = vi.spyOn(console, "log")
			log.emit("info", "task", "No mirror")
			expect(consoleSpy).not.toHaveBeenCalled()
			consoleSpy.mockRestore()
		})

		it("should mirror to console when enabled", () => {
			const mirrorLog = new EventLog(memory, { mirrorToConsole: true })
			const consoleSpy = vi.spyOn(console, "log")
			mirrorLog.emit("info", "task", "Mirror test")
			expect(consoleSpy).toHaveBeenCalled()
			consoleSpy.mockRestore()
		})

		it("should use console.error for error level", () => {
			const mirrorLog = new EventLog(memory, { mirrorToConsole: true })
			const consoleSpy = vi.spyOn(console, "error")
			mirrorLog.emit("error", "task", "Error mirror")
			expect(consoleSpy).toHaveBeenCalled()
			consoleSpy.mockRestore()
		})
	})

	describe("recent", () => {
		it("should delegate to memory.listEvents", () => {
			const expectedEvents = [{ id: "1" }] as LogEvent[]
			;(memory.listEvents as ReturnType<typeof vi.fn>).mockReturnValue(expectedEvents)

			const result = log.recent({ limit: 10 })
			expect(result).toEqual(expectedEvents)
			expect(memory.listEvents).toHaveBeenCalledWith({ limit: 10 })
		})

		it("should pass empty options by default", () => {
			log.recent()
			expect(memory.listEvents).toHaveBeenCalledWith({})
		})
	})
})
