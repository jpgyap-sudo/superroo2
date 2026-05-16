import { describe, test, expect, beforeEach } from "vitest"
import {
	getOrCreateWorkspace,
	resetWorkspace,
	setFileTree,
	openFile,
	closeFile,
	createTerminalSession,
	appendTerminalOutput,
	setActiveTerminal,
	addChatMessage,
	updatePipelineStep,
	updateStatus,
} from "../services/ideWorkspaceService"
import type { WorkspaceFile, ChatMessage } from "../services/ideWorkspaceTypes"

const SESSION = "test-session"

beforeEach(() => {
	resetWorkspace(SESSION)
})

describe("ideWorkspaceService", () => {
	describe("getOrCreateWorkspace", () => {
		test("creates a new workspace with default state", () => {
			const ws = getOrCreateWorkspace("new-session")
			expect(ws.workspaceId).toBeNull()
			expect(ws.branch).toBe("main")
			expect(ws.files).toEqual([])
			expect(ws.openFiles).toEqual([])
			expect(ws.activeFile).toBeNull()
			expect(ws.pipeline).toHaveLength(6)
			expect(ws.terminalSessions).toHaveLength(1)
			expect(ws.chatMessages).toEqual([])
			expect(ws.status.connected).toBe(true)
		})

		test("returns existing workspace for same session", () => {
			const ws1 = getOrCreateWorkspace(SESSION)
			ws1.branch = "feature-branch"
			const ws2 = getOrCreateWorkspace(SESSION)
			expect(ws2.branch).toBe("feature-branch")
		})
	})

	describe("resetWorkspace", () => {
		test("resets workspace to initial state", () => {
			const ws = getOrCreateWorkspace(SESSION)
			ws.branch = "custom-branch"
			resetWorkspace(SESSION)
			const reset = getOrCreateWorkspace(SESSION)
			expect(reset.branch).toBe("main")
		})
	})

	describe("setFileTree", () => {
		test("sets the file tree for a session", () => {
			const files: WorkspaceFile[] = [
				{
					path: "src",
					name: "src",
					kind: "folder",
					children: [{ path: "src/index.ts", name: "index.ts", kind: "file" }],
				},
			]
			const ws = setFileTree(SESSION, files)
			expect(ws.files).toEqual(files)
			expect(ws.files[0].children).toHaveLength(1)
		})
	})

	describe("openFile / closeFile", () => {
		test("opens a file and sets it as active", () => {
			const ws = openFile(SESSION, "src/App.tsx")
			expect(ws.openFiles).toContain("src/App.tsx")
			expect(ws.activeFile).toBe("src/App.tsx")
		})

		test("does not duplicate open files", () => {
			openFile(SESSION, "src/App.tsx")
			const ws = openFile(SESSION, "src/App.tsx")
			expect(ws.openFiles.filter((f) => f === "src/App.tsx")).toHaveLength(1)
		})

		test("closes a file and switches active file", () => {
			openFile(SESSION, "src/App.tsx")
			openFile(SESSION, "src/index.ts")
			const ws = closeFile(SESSION, "src/App.tsx")
			expect(ws.openFiles).not.toContain("src/App.tsx")
			expect(ws.activeFile).toBe("src/index.ts")
		})

		test("sets activeFile to null when closing last file", () => {
			openFile(SESSION, "src/App.tsx")
			const ws = closeFile(SESSION, "src/App.tsx")
			expect(ws.openFiles).toHaveLength(0)
			expect(ws.activeFile).toBeNull()
		})
	})

	describe("terminal sessions", () => {
		test("creates a new terminal session", () => {
			const term = createTerminalSession(SESSION, "zsh")
			expect(term.name).toBe("zsh")
			expect(term.output).toEqual([])
			expect(term.id).toMatch(/^term-/)
		})

		test("appends output to a terminal session", () => {
			createTerminalSession(SESSION, "bash")
			const ws = getOrCreateWorkspace(SESSION)
			const termId = ws.activeTerminal!
			appendTerminalOutput(SESSION, termId, "Hello")
			appendTerminalOutput(SESSION, termId, "World")
			const updated = getOrCreateWorkspace(SESSION)
			const term = updated.terminalSessions.find((t) => t.id === termId)
			expect(term?.output).toEqual(["Hello", "World"])
		})

		test("setActiveTerminal switches the active terminal", () => {
			const term1 = createTerminalSession(SESSION, "bash")
			const term2 = createTerminalSession(SESSION, "zsh")
			const ws = setActiveTerminal(SESSION, term1.id)
			expect(ws.activeTerminal).toBe(term1.id)
		})
	})

	describe("chat messages", () => {
		test("adds a chat message", () => {
			const msg: ChatMessage = {
				id: "msg-1",
				role: "user",
				author: "You",
				time: new Date().toISOString(),
				content: "Hello",
			}
			const ws = addChatMessage(SESSION, msg)
			expect(ws.chatMessages).toHaveLength(1)
			expect(ws.chatMessages[0].content).toBe("Hello")
		})

		test("appends multiple messages", () => {
			addChatMessage(SESSION, {
				id: "msg-1",
				role: "user",
				author: "You",
				time: "10:00",
				content: "First",
			})
			addChatMessage(SESSION, {
				id: "msg-2",
				role: "assistant",
				author: "Kimi",
				time: "10:01",
				content: "Response",
			})
			const ws = getOrCreateWorkspace(SESSION)
			expect(ws.chatMessages).toHaveLength(2)
		})
	})

	describe("pipeline", () => {
		test("updates a pipeline step status", () => {
			const ws = updatePipelineStep(SESSION, "plan", "done")
			const plan = ws.pipeline.find((s) => s.id === "plan")
			expect(plan?.status).toBe("done")
		})

		test("updates multiple pipeline steps", () => {
			updatePipelineStep(SESSION, "plan", "done")
			updatePipelineStep(SESSION, "crawl", "running")
			updatePipelineStep(SESSION, "patch", "approval")
			const ws = getOrCreateWorkspace(SESSION)
			expect(ws.pipeline.find((s) => s.id === "plan")?.status).toBe("done")
			expect(ws.pipeline.find((s) => s.id === "crawl")?.status).toBe("running")
			expect(ws.pipeline.find((s) => s.id === "patch")?.status).toBe("approval")
		})

		test("ignores unknown step ids", () => {
			const ws = updatePipelineStep(SESSION, "unknown", "done")
			expect(ws.pipeline.every((s) => s.status === "pending")).toBe(true)
		})
	})

	describe("status", () => {
		test("updates status fields", () => {
			const ws = updateStatus(SESSION, { cpu: "5%", ram: "256MB" })
			expect(ws.status.cpu).toBe("5%")
			expect(ws.status.ram).toBe("256MB")
			expect(ws.status.connected).toBe(true) // unchanged
		})
	})
})
