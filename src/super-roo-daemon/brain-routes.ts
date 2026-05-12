/**
 * SuperRoo Daemon — Brain-aware HTTP routes.
 *
 * These routes replace the legacy /tasks endpoint with a Brain-aware
 * UnifiedTaskRouter that enforces: RAG → Router → Permissions → Execute → Memory Save.
 *
 * Every interface (VS Code, Cloud IDE, Telegram, CLI) hits these routes.
 */

import * as http from "node:http"
import { UnifiedTaskRouter } from "../super-roo/brain"
import type { Agent } from "../super-roo/types"
import type { SuperRooOrchestrator } from "../super-roo"

function json(res: http.ServerResponse, statusCode: number, body: unknown): void {
	const payload = JSON.stringify(body)
	res.writeHead(statusCode, {
		"content-type": "application/json; charset=utf-8",
		"content-length": Buffer.byteLength(payload),
	})
	res.end(payload)
}

function readBody(req: http.IncomingMessage, maxBytes = 128 * 1024): Promise<string> {
	return new Promise((resolve, reject) => {
		let size = 0
		let body = ""
		req.setEncoding("utf8")
		req.on("data", (chunk) => {
			size += Buffer.byteLength(chunk)
			if (size > maxBytes) {
				reject(new Error("request_body_too_large"))
				req.destroy()
				return
			}
			body += chunk
		})
		req.on("end", () => resolve(body))
		req.on("error", reject)
	})
}

function isAuthorized(req: http.IncomingMessage, token?: string): boolean {
	if (!token) return true
	const auth = req.headers.authorization
	return auth === `Bearer ${token}`
}

export interface BrainRouteConfig {
	orch: SuperRooOrchestrator
	router: UnifiedTaskRouter
	token?: string
}

export async function handleBrainRoutes(
	req: http.IncomingMessage,
	res: http.ServerResponse,
	config: BrainRouteConfig,
): Promise<boolean> {
	const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)

	// ── Health ──
	if (req.method === "GET" && url.pathname === "/health") {
		json(res, 200, { ok: true, brain: true })
		return true
	}

	// ── Brain Task Router (ALL interfaces) ──
	if (req.method === "POST" && url.pathname === "/brain/run") {
		if (!isAuthorized(req, config.token)) {
			json(res, 401, { ok: false, error: "unauthorized" })
			return true
		}
		const body = await readBody(req)
		let parsed: unknown
		try {
			parsed = JSON.parse(body)
		} catch {
			json(res, 400, { ok: false, error: "invalid_json" })
			return true
		}
		if (parsed === null || typeof parsed !== "object") {
			json(res, 400, { ok: false, error: "body_must_be_object" })
			return true
		}

		const raw = parsed as Record<string, unknown>
		const source = raw.source as "vscode" | "cloud" | "telegram" | "cli"

		try {
			let result: import("../super-roo/brain").UnifiedTaskResult

			if (source === "vscode") {
				result = await config.router.handleVscodeMessage({
					userMessage: String(raw.userMessage ?? raw.goal ?? ""),
					currentFile: raw.currentFile as string | undefined,
					selectedCode: raw.selectedCode as string | undefined,
					openTabs: raw.openTabs as string[] | undefined,
					gitBranch: raw.gitBranch as string | undefined,
					gitDiff: raw.gitDiff as string | undefined,
					recentTerminalErrors: raw.recentTerminalErrors as string[] | undefined,
					buildStatus: raw.buildStatus as string | undefined,
					testStatus: raw.testStatus as string | undefined,
					vscodePanelId: raw.vscodePanelId as string | undefined,
					agent: raw.agent as string | undefined,
				})
			} else if (source === "cloud") {
				result = await config.router.handleCloudMessage({
					userMessage: String(raw.userMessage ?? raw.goal ?? ""),
					currentFile: raw.currentFile as string | undefined,
					selectedCode: raw.selectedCode as string | undefined,
					openTabs: raw.openTabs as string[] | undefined,
					terminalOutput: raw.terminalOutput as string[] | undefined,
					gitBranch: raw.gitBranch as string | undefined,
					gitDiff: raw.gitDiff as string | undefined,
					buildStatus: raw.buildStatus as string | undefined,
					testStatus: raw.testStatus as string | undefined,
					cloudSessionId: raw.cloudSessionId as string | undefined,
					agent: raw.agent as string | undefined,
				})
			} else if (source === "telegram") {
				result = await config.router.handleTelegramCommand({
					command: String(raw.userMessage ?? raw.goal ?? ""),
					chatId: Number(raw.chatId ?? 0),
					userId: Number(raw.userId ?? 0),
					messageId: Number(raw.messageId ?? 0),
					agent: raw.agent as string | undefined,
				})
			} else {
				result = await config.router.handleCliTask({
					goal: String(raw.userMessage ?? raw.goal ?? ""),
					agent: raw.agent as string | undefined,
				})
			}

			json(res, 200, {
				ok: result.ok,
				summary: result.summary,
				route: result.route,
				memorySaved: result.memorySaved,
				replyTo: result.replyTo,
			})
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			json(res, 500, { ok: false, error: msg })
		}
		return true
	}

	// ── Legacy /tasks endpoint (still supported, now Brain-wrapped) ──
	if (req.method === "POST" && url.pathname === "/tasks") {
		if (!isAuthorized(req, config.token)) {
			json(res, 401, { ok: false, error: "unauthorized" })
			return true
		}
		const body = await readBody(req)
		let parsed: unknown
		try {
			parsed = JSON.parse(body)
		} catch {
			json(res, 400, { ok: false, error: "invalid_json" })
			return true
		}
		if (parsed === null || typeof parsed !== "object") {
			json(res, 400, { ok: false, error: "body_must_be_object" })
			return true
		}

		// Forward legacy tasks through the brain router as CLI tasks
		const raw = parsed as Record<string, unknown>
		const goal = String(raw.goal ?? "")
		const source = String(raw.source ?? "cli") as "vscode" | "cloud" | "telegram" | "cli"

		try {
			const result = await config.router.routeTask({
				source,
				projectId: process.env.SUPERROO_PROJECT_ID ?? "superroo2",
				userMessage: goal,
				goal,
				agent: String(raw.agent ?? "coder"),
				payload: raw.payload as Record<string, unknown> | undefined,
			})
			json(res, 200, { ok: result.ok, summary: result.summary, route: result.route })
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			json(res, 500, { ok: false, error: msg })
		}
		return true
	}

	return false // Not a brain route, let the caller handle it
}
