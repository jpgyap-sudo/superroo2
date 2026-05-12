import type { SharedContextPacket } from "@superroo/memory-core"

export interface VscodeBrainBridgeOptions {
	brainUrl: string
	deviceToken?: string
	projectId?: string
}

export interface VscodeContextPayload {
	currentFile?: string
	selectedCode?: string
	openTabs?: string[]
	gitBranch?: string
	gitDiff?: string
	recentTerminalErrors?: string[]
	buildStatus?: string
	testStatus?: string
	userMessage: string
}

/**
 * VscodeBrainBridge connects the local VS Code extension to the Cloud Central Brain.
 *
 * VS Code sends rich local context (current file, selected code, open tabs,
 * terminal errors, git diff) to the cloud brain via REST API or WebSocket.
 *
 * The cloud brain is the source of truth:
 *   - PostgreSQL + pgvector memory
 *   - RAG context retrieval
 *   - Model routing
 *   - Agent execution
 *   - Audit logging
 *
 * VS Code never calls an LLM directly. All AI goes through the cloud brain.
 */
export class VscodeBrainBridge {
	private readonly brainUrl: string
	private readonly deviceToken?: string
	private readonly projectId: string
	private ws: WebSocket | null = null

	constructor(options: VscodeBrainBridgeOptions) {
		this.brainUrl = options.brainUrl.replace(/\/$/, "")
		this.deviceToken = options.deviceToken
		this.projectId = options.projectId ?? process.env.SUPERROO_PROJECT_ID ?? "superroo2"
	}

	/**
	 * Send a one-off chat message to the cloud brain (REST).
	 * Use this for simple queries that don't need streaming.
	 */
	async chat(payload: VscodeContextPayload): Promise<{
		ok: boolean
		summary: string
		route: string
		memorySaved: boolean
	}> {
		const packet = this._buildPacket(payload)
		const res = await fetch(`${this.brainUrl}/api/brain/chat`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				...(this.deviceToken ? { authorization: `Bearer ${this.deviceToken}` } : {}),
			},
			body: JSON.stringify(packet),
		})

		if (!res.ok) {
			const body = await res.text()
			throw new Error(`Brain chat failed: ${res.status} ${body}`)
		}

		const json = (await res.json()) as { ok: boolean; summary: string; route: string; memorySaved: boolean }
		return json
	}

	/**
	 * Send a task to the cloud brain (REST).
	 * Use this for coding tasks that need agent execution.
	 */
	async runTask(payload: VscodeContextPayload & { agent?: string }): Promise<{
		ok: boolean
		summary: string
		route: string
		memorySaved: boolean
		taskId?: string
	}> {
		const packet = this._buildPacket(payload)
		const res = await fetch(`${this.brainUrl}/api/brain/run`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				...(this.deviceToken ? { authorization: `Bearer ${this.deviceToken}` } : {}),
			},
			body: JSON.stringify({
				...packet,
				agent: payload.agent ?? "coder",
			}),
		})

		if (!res.ok) {
			const body = await res.text()
			throw new Error(`Brain run failed: ${res.status} ${body}`)
		}

		const json = (await res.json()) as {
			ok: boolean
			summary: string
			route: string
			memorySaved: boolean
			taskId?: string
		}
		return json
	}

	/**
	 * Connect to the cloud brain via WebSocket for live coding.
	 * Streams tokens, patches, and commands in real-time.
	 */
	connectWebSocket(onMessage: (msg: BrainWebSocketMessage) => void): void {
		const wsUrl = this.brainUrl.replace(/^http/, "ws") + "/ws/brain"
		this.ws = new WebSocket(wsUrl)

		this.ws.onopen = () => {
			console.log("[vscode-brain] WebSocket connected")
		}

		this.ws.onmessage = (event) => {
			try {
				const msg = JSON.parse(event.data as string) as BrainWebSocketMessage
				onMessage(msg)
			} catch {
				console.error("[vscode-brain] Failed to parse WebSocket message")
			}
		}

		this.ws.onerror = (err) => {
			console.error("[vscode-brain] WebSocket error:", err)
		}

		this.ws.onclose = () => {
			console.log("[vscode-brain] WebSocket closed")
		}
	}

	/**
	 * Send a context update via WebSocket.
	 */
	sendWebSocketContext(payload: VscodeContextPayload): void {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
			throw new Error("WebSocket not connected")
		}
		const packet = this._buildPacket(payload)
		this.ws.send(JSON.stringify({ type: "context", packet }))
	}

	/**
	 * Send a user message via WebSocket.
	 */
	sendWebSocketMessage(userMessage: string): void {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
			throw new Error("WebSocket not connected")
		}
		this.ws.send(JSON.stringify({ type: "message", userMessage }))
	}

	disconnect(): void {
		this.ws?.close()
		this.ws = null
	}

	private _buildPacket(payload: VscodeContextPayload): SharedContextPacket {
		return {
			source: "vscode",
			projectId: this.projectId,
			userMessage: payload.userMessage,
			currentFile: payload.currentFile,
			selectedCode: payload.selectedCode,
			openTabs: payload.openTabs,
			gitBranch: payload.gitBranch,
			gitDiff: payload.gitDiff,
			recentTerminalErrors: payload.recentTerminalErrors,
			buildStatus: payload.buildStatus,
			testStatus: payload.testStatus,
			timestamp: new Date().toISOString(),
		}
	}
}

export interface BrainWebSocketMessage {
	type: "connected" | "token" | "patch" | "command" | "test" | "done" | "error"
	data?: unknown
	message?: string
}
