/**
 * IDE Workspace — Express API routes.
 *
 * These routes expose the IDE workspace service to the frontend dashboard.
 * They follow the same pattern as the existing modelRouterRoutes.ts.
 */

import { Router, type Request, type Response } from "express"
import {
	getOrCreateWorkspace,
	resetWorkspace,
	setFileTree,
	openFile,
	closeFile,
	addChatMessage,
	appendTerminalOutput,
	createTerminalSession,
	setActiveTerminal,
	updatePipelineStep,
	updateStatus,
} from "../services/ideWorkspaceService"

export function createIdeWorkspaceRouter(): Router {
	const router = Router()

	/**
	 * GET /workspace — Get or create a workspace session.
	 */
	router.get("/workspace", (req: Request, res: Response) => {
		const sessionId = (req.query.sessionId as string) || "default"
		res.json(getOrCreateWorkspace(sessionId))
	})

	/**
	 * POST /workspace/reset — Reset a workspace session.
	 */
	router.post("/workspace/reset", (req: Request, res: Response) => {
		const sessionId = (req.query.sessionId as string) || "default"
		res.json(resetWorkspace(sessionId))
	})

	/**
	 * PUT /workspace/files — Set the file tree for a session.
	 */
	router.put("/workspace/files", (req: Request, res: Response) => {
		const sessionId = (req.query.sessionId as string) || "default"
		const { files } = req.body
		res.json(setFileTree(sessionId, files))
	})

	/**
	 * POST /workspace/open-file — Open a file in the workspace.
	 */
	router.post("/workspace/open-file", (req: Request, res: Response) => {
		const sessionId = (req.query.sessionId as string) || "default"
		const { filePath } = req.body
		res.json(openFile(sessionId, filePath))
	})

	/**
	 * POST /workspace/close-file — Close a file in the workspace.
	 */
	router.post("/workspace/close-file", (req: Request, res: Response) => {
		const sessionId = (req.query.sessionId as string) || "default"
		const { filePath } = req.body
		res.json(closeFile(sessionId, filePath))
	})

	/**
	 * POST /chat — Send a chat message to the workspace assistant.
	 */
	router.post("/chat", (req: Request, res: Response) => {
		const sessionId = (req.query.sessionId as string) || "default"
		const { message } = req.body
		res.json(addChatMessage(sessionId, message))
	})

	/**
	 * POST /terminal/execute — Execute a command in a terminal session.
	 */
	router.post("/terminal/execute", (req: Request, res: Response) => {
		const sessionId = (req.query.sessionId as string) || "default"
		const { terminalId, command } = req.body
		// Append the command as output
		appendTerminalOutput(sessionId, terminalId, `$ ${command}`)
		appendTerminalOutput(sessionId, terminalId, `[executed: ${command}]`)
		res.json(getOrCreateWorkspace(sessionId))
	})

	/**
	 * POST /terminal/create — Create a new terminal session.
	 */
	router.post("/terminal/create", (req: Request, res: Response) => {
		const sessionId = (req.query.sessionId as string) || "default"
		const { name } = req.body
		createTerminalSession(sessionId, name)
		res.json(getOrCreateWorkspace(sessionId))
	})

	/**
	 * PATCH /pipeline — Update a pipeline step status.
	 */
	router.patch("/pipeline", (req: Request, res: Response) => {
		const sessionId = (req.query.sessionId as string) || "default"
		const { stepId, status } = req.body
		res.json(updatePipelineStep(sessionId, stepId, status))
	})

	return router
}
