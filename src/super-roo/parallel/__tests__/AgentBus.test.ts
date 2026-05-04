/**
 * Tests for AgentBus — direct agent-to-agent messaging.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

import { AgentBus } from "../AgentBus"
import type { AgentMessage, AgentMessageHandler } from "../AgentBus"
import type { EventLog } from "../../logging/EventLog"

// ── Fake dependencies ────────────────────────────────────────────────────────

function fakeEventLog(): EventLog {
	return {
		emit: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		subscribe: vi.fn(),
		unsubscribe: vi.fn(),
		recent: vi.fn().mockReturnValue([]),
	} as unknown as EventLog
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("AgentBus", () => {
	let bus: AgentBus
	let events: EventLog

	beforeEach(() => {
		events = fakeEventLog()
		bus = new AgentBus(events)
	})

	describe("agent lifecycle", () => {
		it("registers and unregisters agents", () => {
			bus.registerAgent("coder")
			expect(bus.isAgentOnline("coder")).toBe(true)
			expect(bus.getOnlineAgents()).toEqual(["coder"])

			bus.unregisterAgent("coder")
			expect(bus.isAgentOnline("coder")).toBe(false)
			expect(bus.getOnlineAgents()).toEqual([])
		})

		it("unregisterAgent removes subscriptions", () => {
			bus.registerAgent("coder")
			bus.subscribe("coder", "test_event", vi.fn())
			bus.unregisterAgent("coder")

			// Re-register and verify no stale subscriptions
			bus.registerAgent("coder")
			const stats = bus.getStats()
			expect(stats.activeSubscriptions).toBe(0)
		})

		it("getOnlineAgents returns all registered agents", () => {
			bus.registerAgent("coder")
			bus.registerAgent("debugger")
			bus.registerAgent("tester")

			const agents = bus.getOnlineAgents()
			expect(agents).toHaveLength(3)
			expect(agents).toContain("coder")
			expect(agents).toContain("debugger")
			expect(agents).toContain("tester")
		})
	})

	describe("send", () => {
		it("delivers a message to an online agent's subscriber", async () => {
			bus.registerAgent("coder")
			bus.registerAgent("debugger")

			const handler = vi.fn()
			bus.subscribe("debugger", "diagnose", handler)

			const msgId = await bus.send({
				from: "coder",
				to: "debugger",
				type: "diagnose",
				payload: { error: "crash" },
				priority: "high",
			})

			expect(msgId).not.toBeNull()
			expect(handler).toHaveBeenCalledTimes(1)

			const received = handler.mock.calls[0][0] as AgentMessage
			expect(received.from).toBe("coder")
			expect(received.to).toBe("debugger")
			expect(received.type).toBe("diagnose")
			expect(received.payload).toEqual({ error: "crash" })
		})

		it("queues messages when target agent is offline", async () => {
			bus.registerAgent("coder")
			// debugger is NOT registered

			const msgId = await bus.send({
				from: "coder",
				to: "debugger",
				type: "diagnose",
				payload: { error: "crash" },
				priority: "normal",
			})

			expect(msgId).not.toBeNull()

			const stats = bus.getStats()
			expect(stats.pendingMessages).toBe(1)
		})

		it("delivers queued messages when agent comes online", async () => {
			bus.registerAgent("coder")

			// Send while debugger is offline
			await bus.send({
				from: "coder",
				to: "debugger",
				type: "diagnose",
				payload: { error: "crash" },
				priority: "normal",
			})

			// Register debugger with a subscriber
			const handler = vi.fn()
			bus.registerAgent("debugger")
			bus.subscribe("debugger", "diagnose", handler)

			// Drain pending messages
			const delivered = await bus.drainPending()
			expect(delivered).toBe(1)
			expect(handler).toHaveBeenCalledTimes(1)
		})
	})

	describe("broadcast", () => {
		it("sends a message to all online agents except sender", async () => {
			bus.registerAgent("pm")
			bus.registerAgent("coder")
			bus.registerAgent("debugger")
			bus.registerAgent("tester")

			const coderHandler = vi.fn()
			const debuggerHandler = vi.fn()
			const testerHandler = vi.fn()

			bus.subscribe("coder", "status_update", coderHandler)
			bus.subscribe("debugger", "status_update", debuggerHandler)
			bus.subscribe("tester", "status_update", testerHandler)

			const ids = await bus.broadcast("pm", "status_update", { feature: "login", status: "done" })

			// Should have sent to 3 agents (not pm)
			expect(ids).toHaveLength(3)
			expect(coderHandler).toHaveBeenCalledTimes(1)
			expect(debuggerHandler).toHaveBeenCalledTimes(1)
			expect(testerHandler).toHaveBeenCalledTimes(1)
		})

		it("sends to no one when only sender is online", async () => {
			bus.registerAgent("pm")
			const ids = await bus.broadcast("pm", "status_update", {})
			expect(ids).toHaveLength(0)
		})
	})

	describe("request / reply", () => {
		it("request receives a reply from the target agent", async () => {
			bus.registerAgent("coder")
			bus.registerAgent("debugger")

			// Debugger subscribes to "diagnose" and replies
			bus.subscribe("debugger", "diagnose", async (msg: AgentMessage) => {
				return {
					...msg,
					from: msg.to,
					to: msg.from,
					type: "reply",
					payload: { rootCause: "null pointer" },
				}
			})

			const reply = await bus.request("coder", "debugger", "diagnose", { error: "crash" }, 5000)

			expect(reply).not.toBeNull()
			expect(reply!.from).toBe("debugger")
			expect(reply!.to).toBe("coder")
			expect(reply!.payload).toEqual({ rootCause: "null pointer" })
		})

		it("request times out when no reply is sent", async () => {
			bus.registerAgent("coder")
			bus.registerAgent("debugger")

			// Debugger subscribes but never replies
			bus.subscribe("debugger", "diagnose", vi.fn())

			const reply = await bus.request("coder", "debugger", "diagnose", { error: "crash" }, 100)

			expect(reply).toBeNull()
		})
	})

	describe("subscribe", () => {
		it("delivers to wildcard '*' subscribers", async () => {
			bus.registerAgent("coder")
			bus.registerAgent("debugger")

			const wildcardHandler = vi.fn()
			bus.subscribe("debugger", "*", wildcardHandler)

			await bus.send({
				from: "coder",
				to: "debugger",
				type: "any_type",
				payload: {},
				priority: "normal",
			})

			expect(wildcardHandler).toHaveBeenCalledTimes(1)
		})

		it("unsubscribe function stops delivery", () => {
			bus.registerAgent("coder")
			bus.registerAgent("debugger")

			const handler = vi.fn()
			const unsub = bus.subscribe("debugger", "test", handler)
			unsub()

			bus.send({
				from: "coder",
				to: "debugger",
				type: "test",
				payload: {},
				priority: "normal",
			})

			expect(handler).not.toHaveBeenCalled()
		})

		it("subscribeMany subscribes to multiple types", async () => {
			bus.registerAgent("coder")
			bus.registerAgent("debugger")

			const handler = vi.fn()
			bus.subscribeMany("debugger", ["type_a", "type_b"], handler)

			await bus.send({ from: "coder", to: "debugger", type: "type_a", payload: {}, priority: "normal" })
			await bus.send({ from: "coder", to: "debugger", type: "type_b", payload: {}, priority: "normal" })

			expect(handler).toHaveBeenCalledTimes(2)
		})
	})

	describe("reply", () => {
		it("sends a reply to the original sender", async () => {
			bus.registerAgent("coder")
			bus.registerAgent("debugger")

			const handler = vi.fn()
			bus.subscribe("coder", "reply", handler)

			const original: AgentMessage = {
				id: "msg_1",
				from: "coder",
				to: "debugger",
				type: "diagnose",
				payload: {},
				priority: "high",
				timestamp: Date.now(),
				correlationId: "req_1",
			}

			await bus.reply(original, { result: "done" })

			expect(handler).toHaveBeenCalledTimes(1)
			const reply = handler.mock.calls[0][0] as AgentMessage
			expect(reply.from).toBe("debugger")
			expect(reply.to).toBe("coder")
			expect(reply.type).toBe("reply")
			expect(reply.correlationId).toBe("req_1")
		})
	})

	describe("getStats", () => {
		it("returns correct statistics", async () => {
			bus.registerAgent("coder")
			bus.registerAgent("debugger")

			bus.subscribe("debugger", "test", vi.fn())

			await bus.send({ from: "coder", to: "debugger", type: "test", payload: {}, priority: "normal" })

			const stats = bus.getStats()
			expect(stats.totalMessagesSent).toBeGreaterThanOrEqual(1)
			expect(stats.totalMessagesDelivered).toBeGreaterThanOrEqual(1)
			expect(stats.activeSubscriptions).toBe(1)
			expect(stats.agentsOnline).toContain("coder")
			expect(stats.agentsOnline).toContain("debugger")
		})
	})

	describe("reset", () => {
		it("clears all state", () => {
			bus.registerAgent("coder")
			bus.subscribe("coder", "test", vi.fn())

			bus.reset()

			const stats = bus.getStats()
			expect(stats.agentsOnline).toHaveLength(0)
			expect(stats.activeSubscriptions).toBe(0)
			expect(stats.pendingMessages).toBe(0)
			expect(stats.totalMessagesSent).toBe(0)
		})
	})
})
