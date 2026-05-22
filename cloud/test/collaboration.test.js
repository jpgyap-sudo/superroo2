/**
 * Collaboration Module — Unit Tests
 *
 * Tests A2AProtocol, PairProgrammingMode, CollaborationBridge,
 * and the createCollaborationSystem() factory.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ─── A2AProtocol ──────────────────────────────────────────────────────────────

describe("A2AProtocol", () => {
	let A2AProtocol

	beforeEach(() => {
		;({ A2AProtocol } = require("../collaboration/A2AProtocol"))
	})

	it("creates a protocol with a default local agent ID", () => {
		const proto = new A2AProtocol()
		expect(proto.getLocalAgentId()).toMatch(/^agent_/)
		expect(proto.getAgents()).toEqual([])
	})

	it("registers local agent with capabilities", () => {
		const proto = new A2AProtocol()
		const agentId = proto.registerLocalAgent({
			agentName: "coder-agent",
			skills: ["code", "debug", "review"],
			models: ["deepseek", "gpt-4"],
			metadata: { version: "1.0" },
		})
		expect(agentId).toBe(proto.getLocalAgentId())
		const agents = proto.getAgents()
		expect(agents).toHaveLength(1)
		expect(agents[0].agentName).toBe("coder-agent")
		expect(agents[0].skills).toEqual(["code", "debug", "review"])
		expect(agents[0].models).toEqual(["deepseek", "gpt-4"])
	})

	it("allows overriding the local agent ID", () => {
		const proto = new A2AProtocol()
		proto.registerLocalAgent({ agentId: "my-custom-agent", agentName: "Custom", skills: ["code"] })
		expect(proto.getLocalAgentId()).toBe("my-custom-agent")
	})

	it("registers remote agents via capabilities", () => {
		const proto = new A2AProtocol()
		proto.registerRemoteAgent({
			agentId: "remote-1",
			agentName: "Remote Coder",
			skills: ["code"],
			models: [],
		})
		expect(proto.getAgents()).toHaveLength(1)
		expect(proto.getAgents()[0].agentId).toBe("remote-1")
	})

	it("unregisters agents", () => {
		const proto = new A2AProtocol()
		proto.registerRemoteAgent({ agentId: "remote-1", agentName: "R1", skills: ["code"], models: [] })
		proto.unregisterAgent("remote-1")
		expect(proto.getAgents()).toHaveLength(0)
	})

	it("finds agents by skill", () => {
		const proto = new A2AProtocol()
		proto.registerRemoteAgent({ agentId: "a1", agentName: "A1", skills: ["code", "debug"], models: [] })
		proto.registerRemoteAgent({ agentId: "a2", agentName: "A2", skills: ["review"], models: [] })
		proto.registerRemoteAgent({ agentId: "a3", agentName: "A3", skills: ["code"], models: [] })

		const coders = proto.findAgentsBySkill("code")
		expect(coders).toHaveLength(2)
		expect(coders.map((a) => a.agentId)).toEqual(["a1", "a3"])
	})

	it("registers and unregisters task handlers", () => {
		const proto = new A2AProtocol()
		const handler = vi.fn()
		proto.registerTaskHandler("code", handler)
		expect(proto.hasHandler("code")).toBe(true)
		proto.unregisterTaskHandler("code")
		expect(proto.hasHandler("code")).toBe(false)
	})

	it("handles a2a.ping with a2a.pong response", async () => {
		const proto = new A2AProtocol()
		proto.registerLocalAgent({ agentName: "test", skills: ["code"] })

		const response = await proto.receiveMessage({
			id: "msg-1",
			type: "a2a.ping",
			source: "remote-agent",
			target: proto.getLocalAgentId(),
			payload: {},
			timestamp: Date.now(),
		})

		expect(response).not.toBeNull()
		expect(response.type).toBe("a2a.pong")
		expect(response.target).toBe("remote-agent")
	})

	it("handles a2a.discover and responds with capabilities", async () => {
		const proto = new A2AProtocol()
		proto.registerLocalAgent({ agentName: "test", skills: ["code", "debug"] })

		const response = await proto.receiveMessage({
			id: "msg-1",
			type: "a2a.discover",
			source: "remote-agent",
			target: proto.getLocalAgentId(),
			payload: {
				capability: { agentId: "remote-agent", agentName: "Remote", skills: ["review"], models: [] },
			},
			timestamp: Date.now(),
		})

		// Should have registered the remote agent
		expect(proto.getAgents()).toHaveLength(2)

		// Should respond with agent list
		expect(response).not.toBeNull()
		expect(response.type).toBe("a2a.discover")
		expect(response.payload.agents).toHaveLength(2)
		expect(response.payload.capability.agentName).toBe("test")
	})

	it("handles a2a.register and registers the remote agent", async () => {
		const proto = new A2AProtocol()
		const result = await proto.receiveMessage({
			id: "msg-1",
			type: "a2a.register",
			source: "remote-agent",
			target: "*",
			payload: {
				capability: { agentId: "remote-agent", agentName: "Remote", skills: ["review"], models: [] },
			},
			timestamp: Date.now(),
		})
		expect(result).toBeNull() // No response for register
		expect(proto.getAgents()).toHaveLength(1)
		expect(proto.getAgents()[0].agentId).toBe("remote-agent")
	})

	it("delegates a task to a local agent and gets result", async () => {
		const proto = new A2AProtocol()
		proto.registerLocalAgent({ agentName: "worker", skills: ["code"] })

		// Register a task handler
		const handler = vi.fn().mockResolvedValue({ success: true, output: "console.log('hello')" })
		proto.registerTaskHandler("code", handler)

		// Delegate task
		const result = await proto.delegateTask({
			targetAgent: proto.getLocalAgentId(),
			taskType: "code",
			input: { language: "javascript", prompt: "log hello" },
		})

		expect(result).toEqual({ success: true, output: "console.log('hello')" })
		expect(handler).toHaveBeenCalledTimes(1)

		// Task should be recorded
		const tasks = proto.listTasks()
		expect(tasks).toHaveLength(1)
		expect(tasks[0].status).toBe("completed")
	})

	it("handles task delegation failure gracefully", async () => {
		const proto = new A2AProtocol()
		proto.registerLocalAgent({ agentName: "worker", skills: ["code"] })

		// No handler registered for "debug"
		await expect(
			proto.delegateTask({
				targetAgent: proto.getLocalAgentId(),
				taskType: "debug",
				input: { error: "crash" },
			}),
		).rejects.toThrow("No handler for task type: debug")

		const tasks = proto.listTasks()
		expect(tasks).toHaveLength(1)
		expect(tasks[0].status).toBe("failed")
	})

	it("handles handler throwing an error", async () => {
		const proto = new A2AProtocol()
		proto.registerLocalAgent({ agentName: "worker", skills: ["code"] })
		proto.registerTaskHandler("code", vi.fn().mockRejectedValue(new Error("Internal error")))

		await expect(
			proto.delegateTask({
				targetAgent: proto.getLocalAgentId(),
				taskType: "code",
				input: {},
			}),
		).rejects.toThrow("Internal error")
	})

	it("emits events for agent registration and discovery", () => {
		const proto = new A2AProtocol()
		const registeredHandler = vi.fn()
		const discoveredHandler = vi.fn()

		proto.on("agent:registered", registeredHandler)
		proto.on("agent:discovered", discoveredHandler)

		proto.registerLocalAgent({ agentName: "local", skills: ["code"] })
		expect(registeredHandler).toHaveBeenCalledTimes(1)

		proto.registerRemoteAgent({ agentId: "remote", agentName: "Remote", skills: ["debug"], models: [] })
		expect(discoveredHandler).toHaveBeenCalledTimes(1)
	})

	it("emits events for task lifecycle", async () => {
		const proto = new A2AProtocol()
		proto.registerLocalAgent({ agentName: "worker", skills: ["code"] })
		proto.registerTaskHandler("code", vi.fn().mockResolvedValue({ ok: true }))

		const createdHandler = vi.fn()
		const completedHandler = vi.fn()
		proto.on("task:created", createdHandler)
		proto.on("task:completed", completedHandler)

		await proto.delegateTask({
			targetAgent: proto.getLocalAgentId(),
			taskType: "code",
			input: {},
		})

		expect(createdHandler).toHaveBeenCalledTimes(1)
		expect(completedHandler).toHaveBeenCalledTimes(1)
	})

	it("lists tasks filtered by status", async () => {
		const proto = new A2AProtocol()
		proto.registerLocalAgent({ agentName: "worker", skills: ["code"] })
		proto.registerTaskHandler("code", vi.fn().mockResolvedValue({ ok: true }))

		await proto.delegateTask({ targetAgent: proto.getLocalAgentId(), taskType: "code", input: {} })

		const completed = proto.listTasks("completed")
		expect(completed).toHaveLength(1)

		const pending = proto.listTasks("pending")
		expect(pending).toHaveLength(0)
	})

	it("clears all state", () => {
		const proto = new A2AProtocol()
		proto.registerLocalAgent({ agentName: "test", skills: ["code"] })
		proto.registerTaskHandler("code", vi.fn())
		proto.clear()

		expect(proto.getAgents()).toHaveLength(0)
		expect(proto.hasHandler("code")).toBe(false)
	})

	it("handles unknown message types gracefully", async () => {
		const proto = new A2AProtocol()
		const result = await proto.receiveMessage({
			id: "msg-1",
			type: "a2a.unknown",
			source: "remote",
			target: "*",
			payload: {},
			timestamp: Date.now(),
		})
		expect(result).toBeNull()
	})

	it("resolves pending requests via correlation ID on receiveMessage", async () => {
		const proto = new A2AProtocol()
		proto.registerLocalAgent({ agentName: "test", skills: ["code"] })

		// Simulate a pending request
		const pendingPromise = new Promise((resolve, reject) => {
			proto._pendingRequests.set("corr-123", {
				resolve,
				reject,
				timer: setTimeout(() => {}, 10000),
			})
		})

		// Receive a response message with matching correlationId
		await proto.receiveMessage({
			id: "msg-resp",
			type: "a2a.result",
			source: "remote",
			target: proto.getLocalAgentId(),
			payload: { data: "hello back" },
			timestamp: Date.now(),
			correlationId: "corr-123",
		})

		const result = await pendingPromise
		expect(result).toEqual({ data: "hello back" })
	})

	it("emits message:outgoing for remote agent messages", async () => {
		const proto = new A2AProtocol()
		proto.registerLocalAgent({ agentName: "test", skills: ["code"] })
		proto.registerRemoteAgent({ agentId: "remote-1", agentName: "Remote", skills: ["code"], models: [] })

		const outgoingHandler = vi.fn()
		proto.on("message:outgoing", outgoingHandler)

		// Sending a message to a remote agent should emit outgoing
		const msg = proto._createMessage({ type: "a2a.ping", target: "remote-1" })
		proto.sendMessage(msg).catch(() => {}) // Will timeout, that's fine

		expect(outgoingHandler).toHaveBeenCalledWith(expect.objectContaining({ type: "a2a.ping", target: "remote-1" }))
	})
})

// ─── PairProgrammingMode ──────────────────────────────────────────────────────

describe("PairProgrammingMode", () => {
	let PairProgrammingMode

	beforeEach(() => {
		;({ PairProgrammingMode } = require("../collaboration/PairProgrammingMode"))
	})

	it("creates a session with participants", () => {
		const ppm = new PairProgrammingMode()
		const session = ppm.createSession({
			workspaceId: "ws-1",
			participants: { "user-1": "driver", "user-2": "navigator" },
		})

		expect(session.id).toMatch(/^pair_/)
		expect(session.workspaceId).toBe("ws-1")
		expect(session.driverId).toBe("user-1")
		expect(session.status).toBe("idle")
		expect(session.participants).toEqual({ "user-1": "driver", "user-2": "navigator" })
	})

	it("auto-assigns first participant as driver if none has driver role", () => {
		const ppm = new PairProgrammingMode()
		const session = ppm.createSession({
			workspaceId: "ws-1",
			participants: { "user-1": "navigator", "user-2": "observer" },
		})
		expect(session.driverId).toBe("user-1")
	})

	it("gets a session by ID", () => {
		const ppm = new PairProgrammingMode()
		const created = ppm.createSession({ workspaceId: "ws-1", participants: { u1: "driver" } })
		const fetched = ppm.getSession(created.id)
		expect(fetched).toBeDefined()
		expect(fetched.id).toBe(created.id)
	})

	it("returns undefined for non-existent session", () => {
		const ppm = new PairProgrammingMode()
		expect(ppm.getSession("nonexistent")).toBeUndefined()
	})

	it("starts, pauses, resumes, and ends a session", () => {
		const ppm = new PairProgrammingMode()
		const session = ppm.createSession({ workspaceId: "ws-1", participants: { u1: "driver" } })

		ppm.startSession(session.id)
		expect(ppm.getSession(session.id).status).toBe("active")

		ppm.pauseSession(session.id, "break time")
		expect(ppm.getSession(session.id).status).toBe("paused")

		ppm.resumeSession(session.id)
		expect(ppm.getSession(session.id).status).toBe("active")

		ppm.endSession(session.id)
		expect(ppm.getSession(session.id).status).toBe("completed")
		expect(ppm.getSession(session.id).completedAt).toBeDefined()
	})

	it("does not resume a non-paused session", () => {
		const ppm = new PairProgrammingMode()
		const session = ppm.createSession({ workspaceId: "ws-1", participants: { u1: "driver" } })
		ppm.resumeSession(session.id) // Not paused, should be no-op
		expect(ppm.getSession(session.id).status).toBe("idle")
	})

	it("switches driver to another participant", () => {
		const ppm = new PairProgrammingMode()
		const session = ppm.createSession({
			workspaceId: "ws-1",
			participants: { u1: "driver", u2: "navigator" },
		})

		const switched = ppm.switchDriver(session.id, "u2")
		expect(switched).toBe(true)
		expect(ppm.getSession(session.id).driverId).toBe("u2")
	})

	it("fails to switch driver to non-participant", () => {
		const ppm = new PairProgrammingMode()
		const session = ppm.createSession({ workspaceId: "ws-1", participants: { u1: "driver" } })

		const switched = ppm.switchDriver(session.id, "nonexistent")
		expect(switched).toBe(false)
		expect(ppm.getSession(session.id).driverId).toBe("u1")
	})

	it("checks if a user is driver and can edit", () => {
		const ppm = new PairProgrammingMode()
		const session = ppm.createSession({
			workspaceId: "ws-1",
			participants: { u1: "driver", u2: "navigator" },
		})

		expect(ppm.isDriver(session.id, "u1")).toBe(true)
		expect(ppm.isDriver(session.id, "u2")).toBe(false)
		expect(ppm.canEdit(session.id, "u1")).toBe(true)
		expect(ppm.canEdit(session.id, "u2")).toBe(false)
	})

	it("gets the role of a participant", () => {
		const ppm = new PairProgrammingMode()
		const session = ppm.createSession({
			workspaceId: "ws-1",
			participants: { u1: "driver", u2: "navigator" },
		})
		expect(ppm.getRole(session.id, "u1")).toBe("driver")
		expect(ppm.getRole(session.id, "u2")).toBe("navigator")
		expect(ppm.getRole(session.id, "nonexistent")).toBeUndefined()
	})

	it("adds a participant to a session", () => {
		const ppm = new PairProgrammingMode()
		const session = ppm.createSession({ workspaceId: "ws-1", participants: { u1: "driver" } })

		ppm.addParticipant(session.id, "u2", "navigator")
		expect(session.participants["u2"]).toBe("navigator")
	})

	it("adds participant with default observer role", () => {
		const ppm = new PairProgrammingMode()
		const session = ppm.createSession({ workspaceId: "ws-1", participants: { u1: "driver" } })

		ppm.addParticipant(session.id, "u2")
		expect(session.participants["u2"]).toBe("observer")
	})

	it("removes a participant and auto-assigns new driver", () => {
		const ppm = new PairProgrammingMode()
		const session = ppm.createSession({
			workspaceId: "ws-1",
			participants: { u1: "driver", u2: "navigator" },
		})

		ppm.removeParticipant(session.id, "u1")
		expect(session.participants["u1"]).toBeUndefined()
		expect(session.driverId).toBe("u2") // Auto-assigned
	})

	it("completes session when last participant leaves", () => {
		const ppm = new PairProgrammingMode()
		const session = ppm.createSession({ workspaceId: "ws-1", participants: { u1: "driver" } })

		ppm.removeParticipant(session.id, "u1")
		expect(session.status).toBe("completed")
		expect(session.driverId).toBeNull()
	})

	it("adds and retrieves comments", () => {
		const ppm = new PairProgrammingMode()
		const session = ppm.createSession({
			workspaceId: "ws-1",
			participants: { u1: "driver", u2: "navigator" },
		})

		const comment = ppm.addComment({
			sessionId: session.id,
			userId: "u2",
			userName: "Navigator",
			text: "Consider using async/await here",
			filePath: "src/index.js",
			range: { startLine: 10, endLine: 15 },
		})

		expect(comment).not.toBeNull()
		expect(comment.id).toMatch(/^cmt_/)
		expect(comment.text).toBe("Consider using async/await here")
		expect(comment.filePath).toBe("src/index.js")

		const comments = ppm.getComments(session.id)
		expect(comments).toHaveLength(1)
		expect(comments[0].userId).toBe("u2")
	})

	it("returns null for comment on non-existent session", () => {
		const ppm = new PairProgrammingMode()
		const comment = ppm.addComment({
			sessionId: "nonexistent",
			userId: "u1",
			userName: "User",
			text: "test",
		})
		expect(comment).toBeNull()
	})

	it("returns empty array for comments on non-existent session", () => {
		const ppm = new PairProgrammingMode()
		expect(ppm.getComments("nonexistent")).toEqual([])
	})

	it("gets active sessions", () => {
		const ppm = new PairProgrammingMode()
		const s1 = ppm.createSession({ workspaceId: "ws-1", participants: { u1: "driver" } })
		const s2 = ppm.createSession({ workspaceId: "ws-2", participants: { u2: "driver" } })

		ppm.startSession(s1.id)
		// s2 is idle, should also be active

		const active = ppm.getActiveSessions()
		expect(active).toHaveLength(2)
	})

	it("gets summary of active sessions", () => {
		const ppm = new PairProgrammingMode()
		const session = ppm.createSession({
			workspaceId: "ws-1",
			participants: { u1: "driver", u2: "navigator" },
		})
		ppm.startSession(session.id)
		ppm.addComment({ sessionId: session.id, userId: "u2", userName: "Nav", text: "Nice!" })

		const summary = ppm.getSummary()
		expect(summary).toHaveLength(1)
		expect(summary[0].workspaceId).toBe("ws-1")
		expect(summary[0].commentCount).toBe(1)
		expect(summary[0].participants).toHaveLength(2)
	})

	it("emits events for session lifecycle", () => {
		const ppm = new PairProgrammingMode()
		const createdHandler = vi.fn()
		const startedHandler = vi.fn()
		const completedHandler = vi.fn()

		ppm.on("session:created", createdHandler)
		ppm.on("session:started", startedHandler)
		ppm.on("session:completed", completedHandler)

		const session = ppm.createSession({ workspaceId: "ws-1", participants: { u1: "driver" } })
		ppm.startSession(session.id)
		ppm.endSession(session.id)

		expect(createdHandler).toHaveBeenCalledTimes(1)
		expect(startedHandler).toHaveBeenCalledTimes(1)
		expect(completedHandler).toHaveBeenCalledTimes(1)
	})

	it("emits events for driver switch and comments", () => {
		const ppm = new PairProgrammingMode()
		const session = ppm.createSession({
			workspaceId: "ws-1",
			participants: { u1: "driver", u2: "navigator" },
		})

		const switchedHandler = vi.fn()
		const commentHandler = vi.fn()
		ppm.on("driver:switched", switchedHandler)
		ppm.on("comment:added", commentHandler)

		ppm.switchDriver(session.id, "u2")
		expect(switchedHandler).toHaveBeenCalledTimes(1)

		ppm.addComment({ sessionId: session.id, userId: "u2", userName: "Nav", text: "test" })
		expect(commentHandler).toHaveBeenCalledTimes(1)
	})

	it("clears all sessions and comments", () => {
		const ppm = new PairProgrammingMode()
		ppm.createSession({ workspaceId: "ws-1", participants: { u1: "driver" } })
		ppm.clear()

		expect(ppm.getActiveSessions()).toHaveLength(0)
	})
})

// ─── CollaborationBridge ──────────────────────────────────────────────────────

describe("CollaborationBridge", () => {
	let CollaborationBridge,
		CollaborationService,
		A2AProtocol,
		PairProgrammingMode,
		WorkspaceProvider,
		CursorSync,
		FileSync
	let bridge, collaborationService, a2aProtocol, pairProgrammingMode, workspaceProvider, cursorSync, fileSync
	let broadcastFn, eventLog

	beforeEach(() => {
		;({ CollaborationBridge } = require("../collaboration/CollaborationBridge"))
		;({ CollaborationService } = require("../collaboration/CollaborationService"))
		;({ A2AProtocol } = require("../collaboration/A2AProtocol"))
		;({ PairProgrammingMode } = require("../collaboration/PairProgrammingMode"))
		;({ WorkspaceProvider } = require("../collaboration/WorkspaceProvider"))
		;({ CursorSync } = require("../collaboration/CursorSync"))
		;({ FileSync } = require("../collaboration/FileSync"))

		collaborationService = new CollaborationService()
		a2aProtocol = new A2AProtocol()
		pairProgrammingMode = new PairProgrammingMode()
		workspaceProvider = new WorkspaceProvider()
		cursorSync = new CursorSync()
		fileSync = new FileSync()

		broadcastFn = vi.fn()
		eventLog = { record: vi.fn() }

		bridge = new CollaborationBridge({
			collaborationService,
			a2aProtocol,
			pairProgrammingMode,
			workspaceProvider,
			cursorSync,
			fileSync,
			eventLog,
			broadcastFn,
		})
	})

	afterEach(() => {
		bridge.clear()
	})

	// ── Collaboration session management ────────────────────────────────────

	it("creates a collaboration session via handleMessage", async () => {
		const result = await bridge.handleMessage(
			{ type: "collaboration:create-session", payload: {} },
			{ workspaceId: "ws-1", userId: "user-1", userName: "User One" },
		)

		expect(result.type).toBe("collaboration:session-created")
		expect(result.payload.session).toBeDefined()
		expect(result.payload.collaborator).toBeDefined()
		expect(result.payload.collaborator.userId).toBe("user-1")
	})

	it("joins an existing collaboration session", async () => {
		const createResult = await bridge.handleMessage(
			{ type: "collaboration:create-session", payload: {} },
			{ workspaceId: "ws-1", userId: "user-1", userName: "User One" },
		)
		const sessionId = createResult.payload.session.id

		const joinResult = await bridge.handleMessage(
			{ type: "collaboration:join-session", payload: { sessionId } },
			{ workspaceId: "ws-1", userId: "user-2", userName: "User Two" },
		)

		expect(joinResult.type).toBe("collaboration:session-joined")
		expect(joinResult.payload.session).toBeDefined()
	})

	it("returns error when joining non-existent session", async () => {
		const result = await bridge.handleMessage(
			{ type: "collaboration:join-session", payload: { sessionId: "nonexistent" } },
			{ workspaceId: "ws-1", userId: "user-1", userName: "User" },
		)

		expect(result.type).toBe("collaboration:error")
	})

	it("leaves a collaboration session", async () => {
		const createResult = await bridge.handleMessage(
			{ type: "collaboration:create-session", payload: {} },
			{ workspaceId: "ws-1", userId: "user-1", userName: "User" },
		)
		const sessionId = createResult.payload.session.id

		const leaveResult = await bridge.handleMessage(
			{ type: "collaboration:leave-session", payload: { sessionId } },
			{ workspaceId: "ws-1", userId: "user-1", userName: "User" },
		)

		expect(leaveResult.type).toBe("collaboration:session-left")
	})

	it("gets sessions for a workspace", async () => {
		await bridge.handleMessage(
			{ type: "collaboration:create-session", payload: {} },
			{ workspaceId: "ws-1", userId: "user-1", userName: "User" },
		)

		const result = await bridge.handleMessage(
			{ type: "collaboration:get-sessions", payload: {} },
			{ workspaceId: "ws-1", userId: "user-1", userName: "User" },
		)

		expect(result.type).toBe("collaboration:sessions")
		expect(result.payload.sessions).toHaveLength(1)
	})

	it("gets collaborators for a session", async () => {
		const createResult = await bridge.handleMessage(
			{ type: "collaboration:create-session", payload: {} },
			{ workspaceId: "ws-1", userId: "user-1", userName: "User" },
		)
		const sessionId = createResult.payload.session.id

		const result = await bridge.handleMessage(
			{ type: "collaboration:get-collaborators", payload: { sessionId } },
			{ workspaceId: "ws-1", userId: "user-1", userName: "User" },
		)

		expect(result.type).toBe("collaboration:collaborators")
		expect(result.payload.collaborators).toHaveLength(1)
	})

	// ── Cursor sync ────────────────────────────────────────────────────────

	it("handles cursor updates", async () => {
		const result = await bridge.handleMessage(
			{
				type: "cursor:update",
				payload: { sessionId: "session-1", position: { line: 10, col: 5 }, selection: null },
			},
			{ workspaceId: "ws-1", userId: "user-1", userName: "User" },
		)

		expect(result).toBeNull() // No direct response for cursor updates
	})

	// ── File sync ──────────────────────────────────────────────────────────

	it("handles file changes", async () => {
		// Set up a snapshot first
		fileSync.setSnapshot({ filePath: "test.js", content: "hello", userId: "user-1" })

		const result = await bridge.handleMessage(
			{
				type: "file:change",
				payload: {
					sessionId: "session-1",
					filePath: "test.js",
					change: { type: "insert", range: { startLine: 0, startColumn: 5 }, text: " world" },
					baseVersion: 1,
				},
			},
			{ workspaceId: "ws-1", userId: "user-1", userName: "User" },
		)

		expect(result.type).toBe("file:change-result")
	})

	it("handles batch file changes", async () => {
		fileSync.setSnapshot({ filePath: "test.js", content: "hello", userId: "user-1" })

		const result = await bridge.handleMessage(
			{
				type: "file:batch-changes",
				payload: {
					sessionId: "session-1",
					filePath: "test.js",
					changes: [{ type: "insert", range: { startLine: 0, startColumn: 5 }, text: " world" }],
				},
			},
			{ workspaceId: "ws-1", userId: "user-1", userName: "User" },
		)

		expect(result.type).toBe("file:batch-result")
	})

	it("gets file snapshots", async () => {
		fileSync.setSnapshot({ filePath: "test.js", content: "hello", userId: "user-1" })

		const result = await bridge.handleMessage(
			{ type: "file:get-snapshot", payload: { filePath: "test.js" } },
			{ workspaceId: "ws-1", userId: "user-1", userName: "User" },
		)

		expect(result.type).toBe("file:snapshot")
		expect(result.payload.snapshot.content).toBe("hello")
	})

	// ── File locking ───────────────────────────────────────────────────────

	it("locks and unlocks files", async () => {
		workspaceProvider.registerWorkspace({ id: "ws-1", name: "Test", rootPath: "/test" })

		const lockResult = await bridge.handleMessage(
			{ type: "file:lock", payload: { filePath: "test.js" } },
			{ workspaceId: "ws-1", userId: "user-1", userName: "User" },
		)
		expect(lockResult.type).toBe("file:lock-result")
		expect(lockResult.payload.locked).toBe(true)

		const unlockResult = await bridge.handleMessage(
			{ type: "file:unlock", payload: { filePath: "test.js" } },
			{ workspaceId: "ws-1", userId: "user-1", userName: "User" },
		)
		expect(unlockResult.type).toBe("file:unlock-result")
	})

	it("gets file lock owner", async () => {
		workspaceProvider.registerWorkspace({ id: "ws-1", name: "Test", rootPath: "/test" })
		workspaceProvider.lockFile("ws-1", "test.js", "user-1")

		const result = await bridge.handleMessage(
			{ type: "file:get-lock-owner", payload: { filePath: "test.js" } },
			{ workspaceId: "ws-1", userId: "user-1", userName: "User" },
		)

		expect(result.type).toBe("file:lock-owner")
		expect(result.payload.owner).toBe("user-1")
	})

	// ── A2A protocol ───────────────────────────────────────────────────────

	it("handles A2A agent registration", async () => {
		const result = await bridge.handleMessage(
			{
				type: "a2a:register-agent",
				payload: {
					capability: { agentId: "agent-1", agentName: "Agent 1", skills: ["code"], models: [] },
				},
			},
			{ workspaceId: "ws-1", userId: "user-1", userName: "User" },
		)

		expect(result.type).toBe("a2a:agent-registered")
		expect(a2aProtocol.getAgents()).toHaveLength(1)
	})

	it("handles A2A agent discovery", async () => {
		a2aProtocol.registerLocalAgent({ agentName: "local", skills: ["code"] })

		const result = await bridge.handleMessage(
			{ type: "a2a:discover", payload: {} },
			{ workspaceId: "ws-1", userId: "user-1", userName: "User" },
		)

		expect(result.type).toBe("a2a:discover-result")
		expect(result.payload.agents).toHaveLength(1)
	})

	it("handles A2A task delegation", async () => {
		a2aProtocol.registerLocalAgent({ agentName: "worker", skills: ["code"] })
		a2aProtocol.registerTaskHandler("code", vi.fn().mockResolvedValue({ success: true }))

		const result = await bridge.handleMessage(
			{
				type: "a2a:delegate-task",
				payload: { targetAgent: a2aProtocol.getLocalAgentId(), taskType: "code", input: {} },
			},
			{ workspaceId: "ws-1", userId: "user-1", userName: "User" },
		)

		expect(result.type).toBe("a2a:task-result")
		expect(result.payload.result).toEqual({ success: true })
	})

	it("handles A2A task delegation failure", async () => {
		a2aProtocol.registerLocalAgent({ agentName: "worker", skills: ["code"] })

		const result = await bridge.handleMessage(
			{
				type: "a2a:delegate-task",
				payload: { targetAgent: a2aProtocol.getLocalAgentId(), taskType: "debug", input: {} },
			},
			{ workspaceId: "ws-1", userId: "user-1", userName: "User" },
		)

		expect(result.type).toBe("a2a:error")
	})

	// ── Pair programming ───────────────────────────────────────────────────

	it("creates a pair programming session via bridge", async () => {
		const result = await bridge.handleMessage(
			{
				type: "pair:create-session",
				payload: { participants: { "user-2": "navigator" } },
			},
			{ workspaceId: "ws-1", userId: "user-1", userName: "Driver" },
		)

		expect(result.type).toBe("pair:session-created")
		expect(result.payload.session).toBeDefined()
		expect(result.payload.session.driverId).toBe("user-1")
		expect(result.payload.session.status).toBe("active") // Auto-started
	})

	it("joins a pair programming session", async () => {
		const createResult = await bridge.handleMessage(
			{
				type: "pair:create-session",
				payload: { participants: {} },
			},
			{ workspaceId: "ws-1", userId: "user-1", userName: "Driver" },
		)
		const sessionId = createResult.payload.session.id

		const joinResult = await bridge.handleMessage(
			{
				type: "pair:join-session",
				payload: { sessionId, role: "navigator" },
			},
			{ workspaceId: "ws-1", userId: "user-2", userName: "Navigator" },
		)

		expect(joinResult.type).toBe("pair:session-joined")
		expect(joinResult.payload.session.participants["user-2"]).toBe("navigator")
	})

	it("switches driver in a pair programming session", async () => {
		const createResult = await bridge.handleMessage(
			{
				type: "pair:create-session",
				payload: { participants: { "user-2": "navigator" } },
			},
			{ workspaceId: "ws-1", userId: "user-1", userName: "Driver" },
		)
		const sessionId = createResult.payload.session.id

		const switchResult = await bridge.handleMessage(
			{
				type: "pair:switch-driver",
				payload: { sessionId, newDriverId: "user-2" },
			},
			{ workspaceId: "ws-1", userId: "user-1", userName: "Driver" },
		)

		expect(switchResult.type).toBe("pair:driver-switched")
		expect(switchResult.payload.switched).toBe(true)
	})

	it("adds a comment in a pair programming session", async () => {
		const createResult = await bridge.handleMessage(
			{
				type: "pair:create-session",
				payload: { participants: { "user-2": "navigator" } },
			},
			{ workspaceId: "ws-1", userId: "user-1", userName: "Driver" },
		)
		const sessionId = createResult.payload.session.id

		const commentResult = await bridge.handleMessage(
			{
				type: "pair:add-comment",
				payload: {
					sessionId,
					text: "Consider using a map instead",
					filePath: "src/index.js",
					range: { startLine: 5, endLine: 10 },
				},
			},
			{ workspaceId: "ws-1", userId: "user-2", userName: "Navigator" },
		)

		expect(commentResult.type).toBe("pair:comment-added")
		expect(commentResult.payload.comment.text).toBe("Consider using a map instead")
	})

	it("gets comments from a pair programming session", async () => {
		const createResult = await bridge.handleMessage(
			{
				type: "pair:create-session",
				payload: { participants: {} },
			},
			{ workspaceId: "ws-1", userId: "user-1", userName: "Driver" },
		)
		const sessionId = createResult.payload.session.id

		// Add a comment first
		await bridge.handleMessage(
			{
				type: "pair:add-comment",
				payload: { sessionId, text: "Nice work!" },
			},
			{ workspaceId: "ws-1", userId: "user-2", userName: "Nav" },
		)

		const commentsResult = await bridge.handleMessage(
			{
				type: "pair:get-comments",
				payload: { sessionId },
			},
			{ workspaceId: "ws-1", userId: "user-1", userName: "Driver" },
		)

		expect(commentsResult.type).toBe("pair:comments")
		expect(commentsResult.payload.comments).toHaveLength(1)
	})

	it("ends a pair programming session", async () => {
		const createResult = await bridge.handleMessage(
			{
				type: "pair:create-session",
				payload: { participants: {} },
			},
			{ workspaceId: "ws-1", userId: "user-1", userName: "Driver" },
		)
		const sessionId = createResult.payload.session.id

		const endResult = await bridge.handleMessage(
			{
				type: "pair:end-session",
				payload: { sessionId },
			},
			{ workspaceId: "ws-1", userId: "user-1", userName: "Driver" },
		)

		expect(endResult.type).toBe("pair:session-ended")
	})

	it("gets pair programming summary", async () => {
		await bridge.handleMessage(
			{
				type: "pair:create-session",
				payload: { participants: {} },
			},
			{ workspaceId: "ws-1", userId: "user-1", userName: "Driver" },
		)

		const summaryResult = await bridge.handleMessage(
			{ type: "pair:get-summary", payload: {} },
			{ workspaceId: "ws-1", userId: "user-1", userName: "Driver" },
		)

		expect(summaryResult.type).toBe("pair:summary")
		expect(summaryResult.payload.sessions).toHaveLength(1)
	})

	// ── Workspace management ───────────────────────────────────────────────

	it("registers a workspace", async () => {
		const result = await bridge.handleMessage(
			{
				type: "workspace:register",
				payload: { name: "My Workspace", rootPath: "/projects/my-app" },
			},
			{ workspaceId: "ws-1", userId: "user-1", userName: "User" },
		)

		expect(result.type).toBe("workspace:registered")
	})

	it("opens and closes files", async () => {
		workspaceProvider.registerWorkspace({ id: "ws-1", name: "Test", rootPath: "/test" })

		const openResult = await bridge.handleMessage(
			{
				type: "workspace:open-file",
				payload: { filePath: "src/index.js" },
			},
			{ workspaceId: "ws-1", userId: "user-1", userName: "User" },
		)

		expect(openResult.type).toBe("workspace:file-opened")

		const closeResult = await bridge.handleMessage(
			{
				type: "workspace:close-file",
				payload: { filePath: "src/index.js" },
			},
			{ workspaceId: "ws-1", userId: "user-1", userName: "User" },
		)

		expect(closeResult.type).toBe("workspace:file-closed")
	})

	// ── EventLog integration ───────────────────────────────────────────────

	it("logs events to EventLog when eventLog is provided", async () => {
		await bridge.handleMessage(
			{ type: "collaboration:create-session", payload: {} },
			{ workspaceId: "ws-1", userId: "user-1", userName: "User" },
		)

		// EventLog should have been called for session creation and collaborator join
		expect(eventLog.record).toHaveBeenCalled()
	})

	it("does not crash when eventLog is null", () => {
		const bridgeNoLog = new (require("../collaboration/CollaborationBridge").CollaborationBridge)({
			collaborationService: new (require("../collaboration/CollaborationService").CollaborationService)(),
			a2aProtocol: new (require("../collaboration/A2AProtocol").A2AProtocol)(),
			pairProgrammingMode: new (require("../collaboration/PairProgrammingMode").PairProgrammingMode)(),
			workspaceProvider: new (require("../collaboration/WorkspaceProvider").WorkspaceProvider)(),
			cursorSync: new (require("../collaboration/CursorSync").CursorSync)(),
			fileSync: new (require("../collaboration/FileSync").FileSync)(),
			eventLog: null,
			broadcastFn: null,
		})

		expect(() => {
			bridgeNoLog.handleMessage(
				{ type: "collaboration:create-session", payload: {} },
				{ workspaceId: "ws-1", userId: "user-1", userName: "User" },
			)
		}).not.toThrow()
	})

	// ── Broadcast integration ──────────────────────────────────────────────

	it("broadcasts collaboration events when broadcastFn is provided", async () => {
		await bridge.handleMessage(
			{ type: "collaboration:create-session", payload: {} },
			{ workspaceId: "ws-1", userId: "user-1", userName: "User" },
		)

		// broadcastFn should have been called for session creation
		expect(broadcastFn).toHaveBeenCalled()
	})

	it("handles unknown message types gracefully", async () => {
		const result = await bridge.handleMessage(
			{ type: "unknown:type", payload: {} },
			{ workspaceId: "ws-1", userId: "user-1", userName: "User" },
		)

		expect(result).toBeNull()
	})
})

// ─── createCollaborationSystem factory ────────────────────────────────────────

describe("createCollaborationSystem", () => {
	it("creates all collaboration services and bridge", () => {
		const { createCollaborationSystem } = require("../collaboration")
		const system = createCollaborationSystem({
			cursorDebounceMs: 100,
			broadcastFn: vi.fn(),
		})

		expect(system.collaborationService).toBeDefined()
		expect(system.a2aProtocol).toBeDefined()
		expect(system.pairProgrammingMode).toBeDefined()
		expect(system.workspaceProvider).toBeDefined()
		expect(system.cursorSync).toBeDefined()
		expect(system.fileSync).toBeDefined()
		expect(system.collaborationBridge).toBeDefined()
	})

	it("wires internal events between services", () => {
		const { createCollaborationSystem } = require("../collaboration")
		const broadcastFn = vi.fn()
		const system = createCollaborationSystem({ broadcastFn })

		// Create a session — should trigger broadcast via wired events
		const session = system.collaborationService.createSession("ws-1")
		system.collaborationService.joinSession(session.id, { userId: "u1", userName: "User" })

		// broadcastFn should have been called for session:created and collaborator:joined
		expect(broadcastFn).toHaveBeenCalled()
	})

	it("passes cursorDebounceMs to CursorSync", () => {
		const { createCollaborationSystem } = require("../collaboration")
		const system = createCollaborationSystem({ cursorDebounceMs: 200 })
		expect(system.cursorSync._debounceMs).toBe(200)
	})

	it("passes eventLog to CollaborationBridge", () => {
		const { createCollaborationSystem } = require("../collaboration")
		const eventLog = { record: vi.fn() }
		const system = createCollaborationSystem({ eventLog })
		expect(system.collaborationBridge.eventLog).toBe(eventLog)
	})

	it("works without any options", () => {
		const { createCollaborationSystem } = require("../collaboration")
		const system = createCollaborationSystem()
		expect(system.collaborationBridge).toBeDefined()
		expect(system.collaborationBridge.broadcastFn).toBeNull()
		expect(system.collaborationBridge.eventLog).toBeNull()
	})
})
