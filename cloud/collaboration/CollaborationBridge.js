/**
 * CollaborationBridge — WebSocket bridge for the collaboration module.
 *
 * Connects the collaboration services (CollaborationService, A2AProtocol,
 * PairProgrammingMode) to the Mini IDE WebSocket server and the EventLog.
 *
 * Provides:
 *   - WebSocket message routing for collaboration events
 *   - EventLog integration for audit trail
 *   - A2A protocol transport over WebSocket
 *   - Pair programming session management via WebSocket
 *
 * @module cloud/collaboration/CollaborationBridge
 */

const EventEmitter = require("node:events")

/**
 * @typedef {Object} BridgeOptions
 * @property {import('./CollaborationService')} collaborationService
 * @property {import('./A2AProtocol')} a2aProtocol
 * @property {import('./PairProgrammingMode')} pairProgrammingMode
 * @property {import('./WorkspaceProvider')} workspaceProvider
 * @property {import('./CursorSync')} cursorSync
 * @property {import('./FileSync')} fileSync
 * @property {Object} [eventLog] — Optional EventLog instance for audit trail
 * @property {Function} [broadcastFn] — Function(workspaceId, message) to broadcast to workspace clients
 */

class CollaborationBridge extends EventEmitter {
	/**
	 * @param {BridgeOptions} opts
	 */
	constructor(opts) {
		super()

		this.collaborationService = opts.collaborationService
		this.a2aProtocol = opts.a2aProtocol
		this.pairProgrammingMode = opts.pairProgrammingMode
		this.workspaceProvider = opts.workspaceProvider
		this.cursorSync = opts.cursorSync
		this.fileSync = opts.fileSync
		this.eventLog = opts.eventLog || null
		this.broadcastFn = opts.broadcastFn || null

		// Wire up internal event propagation
		this._wireInternalEvents()
	}

	// ── Event wiring ───────────────────────────────────────────────────────

	/**
	 * Wire up internal events between collaboration services.
	 */
	_wireInternalEvents() {
		// CollaborationService -> broadcast
		this.collaborationService.on("collaborator:joined", (data) => {
			this._broadcastToWorkspace(data.sessionId, {
				type: "collaboration:collaborator-joined",
				payload: data,
			})
			this._logEvent("collaboration.collaborator_joined", data)
		})

		this.collaborationService.on("collaborator:left", (data) => {
			this._broadcastToWorkspace(data.sessionId, {
				type: "collaboration:collaborator-left",
				payload: data,
			})
			this._logEvent("collaboration.collaborator_left", data)
		})

		this.collaborationService.on("session:created", (data) => {
			this._broadcastToWorkspace(data.workspaceId, {
				type: "collaboration:session-created",
				payload: data,
			})
			this._logEvent("collaboration.session_created", data)
		})

		this.collaborationService.on("session:closed", (data) => {
			this._logEvent("collaboration.session_closed", data)
		})

		this.collaborationService.on("cursor:updated", (data) => {
			this._broadcastToWorkspace(data.sessionId, {
				type: "collaboration:cursor-updated",
				payload: data,
			})
		})

		this.collaborationService.on("file:changed", (data) => {
			this._broadcastToWorkspace(data.sessionId, {
				type: "collaboration:file-changed",
				payload: data,
			})
		})

		// A2A protocol -> broadcast
		this.a2aProtocol.on("message:outgoing", (message) => {
			// Broadcast A2A messages to all agents in the workspace
			this._broadcastToAll({
				type: "a2a:message",
				payload: message,
			})
		})

		this.a2aProtocol.on("agent:discovered", (data) => {
			this._broadcastToAll({
				type: "a2a:agent-discovered",
				payload: data,
			})
			this._logEvent("a2a.agent_discovered", data)
		})

		this.a2aProtocol.on("task:created", (task) => {
			this._logEvent("a2a.task_created", {
				taskId: task.taskId,
				type: task.type,
				sourceAgent: task.sourceAgent,
				targetAgent: task.targetAgent,
			})
		})

		this.a2aProtocol.on("task:completed", (task) => {
			this._logEvent("a2a.task_completed", {
				taskId: task.taskId,
				type: task.type,
			})
		})

		this.a2aProtocol.on("task:failed", (task) => {
			this._logEvent(
				"a2a.task_failed",
				{
					taskId: task.taskId,
					type: task.type,
					error: task.error,
				},
				"error",
			)
		})

		// Pair programming mode -> broadcast
		this.pairProgrammingMode.on("session:created", (data) => {
			this._broadcastToWorkspace(data.workspaceId, {
				type: "pair:session-created",
				payload: data,
			})
			this._logEvent("pair.session_created", data)
		})

		this.pairProgrammingMode.on("session:started", (data) => {
			this._broadcastToWorkspace(data.sessionId, {
				type: "pair:session-started",
				payload: data,
			})
			this._logEvent("pair.session_started", data)
		})

		this.pairProgrammingMode.on("session:completed", (data) => {
			this._broadcastToWorkspace(data.sessionId, {
				type: "pair:session-completed",
				payload: data,
			})
			this._logEvent("pair.session_completed", data)
		})

		this.pairProgrammingMode.on("driver:switched", (data) => {
			this._broadcastToWorkspace(data.sessionId, {
				type: "pair:driver-switched",
				payload: data,
			})
			this._logEvent("pair.driver_switched", data)
		})

		this.pairProgrammingMode.on("comment:added", (comment) => {
			this._broadcastToWorkspace(comment.sessionId, {
				type: "pair:comment-added",
				payload: comment,
			})
		})

		// FileSync events -> broadcast
		this.fileSync.on("change:applied", (data) => {
			this._broadcastToWorkspace(data.sessionId, {
				type: "file:change-applied",
				payload: data,
			})
		})

		this.fileSync.on("change:conflict", (data) => {
			this._broadcastToWorkspace(data.sessionId, {
				type: "file:change-conflict",
				payload: data,
			})
			this._logEvent("file.change_conflict", data, "warning")
		})

		this.fileSync.on("conflict:resolved", (data) => {
			this._broadcastToWorkspace(data.sessionId, {
				type: "file:conflict-resolved",
				payload: data,
			})
		})

		// WorkspaceProvider events -> broadcast
		this.workspaceProvider.on("file:locked", (data) => {
			this._broadcastToWorkspace(data.workspaceId, {
				type: "file:locked",
				payload: data,
			})
		})

		this.workspaceProvider.on("file:unlocked", (data) => {
			this._broadcastToWorkspace(data.workspaceId, {
				type: "file:unlocked",
				payload: data,
			})
		})
	}

	// ── WebSocket message handling ─────────────────────────────────────────

	/**
	 * Handle an incoming WebSocket message from a client.
	 * @param {Object} msg — Parsed JSON message
	 * @param {Object} context — Connection context
	 * @param {string} context.workspaceId
	 * @param {string} context.userId
	 * @param {string} context.userName
	 * @returns {Promise<Object|null>} — Response to send back, if any
	 */
	async handleMessage(msg, context) {
		const { workspaceId, userId, userName } = context

		switch (msg.type) {
			// ── Collaboration session management ──────────────────────────
			case "collaboration:create-session": {
				const session = this.collaborationService.createSession(workspaceId)
				const collaborator = this.collaborationService.joinSession(session.id, { userId, userName })
				return { type: "collaboration:session-created", payload: { session, collaborator } }
			}

			case "collaboration:join-session": {
				const { sessionId } = msg.payload
				const collaborator = this.collaborationService.joinSession(sessionId, { userId, userName })
				if (!collaborator) {
					return { type: "collaboration:error", payload: { error: "Session not found or closed" } }
				}
				const session = this.collaborationService.getSession(sessionId)
				return { type: "collaboration:session-joined", payload: { session, collaborator } }
			}

			case "collaboration:leave-session": {
				const { sessionId } = msg.payload
				this.collaborationService.leaveSession(sessionId, userId)
				return { type: "collaboration:session-left", payload: { sessionId } }
			}

			case "collaboration:get-sessions": {
				const sessions = this.collaborationService.getSessionsForWorkspace(workspaceId)
				return { type: "collaboration:sessions", payload: { sessions } }
			}

			case "collaboration:get-collaborators": {
				const { sessionId } = msg.payload
				const collaborators = this.collaborationService.getCollaborators(sessionId)
				return { type: "collaboration:collaborators", payload: { sessionId, collaborators } }
			}

			// ── Cursor sync ──────────────────────────────────────────────
			case "cursor:update": {
				const { sessionId, position, selection } = msg.payload
				this.collaborationService.updateCursor(sessionId, userId, position, selection)
				return null // No direct response, broadcast handles it
			}

			// ── File sync ────────────────────────────────────────────────
			case "file:change": {
				const { sessionId, filePath, change, baseVersion } = msg.payload
				const result = this.fileSync.applyChange({
					sessionId,
					userId,
					userName,
					filePath,
					change,
					baseVersion,
				})
				return { type: "file:change-result", payload: result }
			}

			case "file:batch-changes": {
				const { sessionId, filePath, changes } = msg.payload
				const result = this.fileSync.applyBatch({
					sessionId,
					userId,
					userName,
					filePath,
					changes,
				})
				return { type: "file:batch-result", payload: result }
			}

			case "file:get-snapshot": {
				const { filePath } = msg.payload
				const snapshot = this.fileSync.getSnapshot(filePath)
				return { type: "file:snapshot", payload: { filePath, snapshot } }
			}

			case "file:resolve-conflict": {
				const { sessionId, filePath, change } = msg.payload
				const result = this.fileSync.resolveConflict({
					sessionId,
					userId,
					userName,
					filePath,
					change,
				})
				return { type: "file:conflict-resolved", payload: result }
			}

			// ── Workspace file locking ───────────────────────────────────
			case "file:lock": {
				const { filePath } = msg.payload
				const locked = this.workspaceProvider.lockFile(workspaceId, filePath, userId)
				return { type: "file:lock-result", payload: { filePath, locked, userId } }
			}

			case "file:unlock": {
				const { filePath } = msg.payload
				this.workspaceProvider.unlockFile(workspaceId, filePath, userId)
				return { type: "file:unlock-result", payload: { filePath, userId } }
			}

			case "file:get-lock-owner": {
				const { filePath } = msg.payload
				const owner = this.workspaceProvider.getFileLockOwner(workspaceId, filePath)
				return { type: "file:lock-owner", payload: { filePath, owner } }
			}

			// ── A2A protocol ─────────────────────────────────────────────
			case "a2a:send-message": {
				const message = msg.payload
				try {
					const response = await this.a2aProtocol.receiveMessage(message)
					return response ? { type: "a2a:message", payload: response } : null
				} catch (err) {
					return { type: "a2a:error", payload: { error: err.message } }
				}
			}

			case "a2a:register-agent": {
				const { capability } = msg.payload
				if (capability) {
					this.a2aProtocol.registerRemoteAgent(capability)
				}
				return { type: "a2a:agent-registered", payload: { agentId: capability?.agentId } }
			}

			case "a2a:discover": {
				const agents = this.a2aProtocol.getAgents()
				return { type: "a2a:discover-result", payload: { agents } }
			}

			case "a2a:delegate-task": {
				const { targetAgent, taskType, input } = msg.payload
				try {
					const result = await this.a2aProtocol.delegateTask({ targetAgent, taskType, input })
					return { type: "a2a:task-result", payload: { result } }
				} catch (err) {
					return { type: "a2a:error", payload: { error: err.message } }
				}
			}

			// ── Pair programming ─────────────────────────────────────────
			case "pair:create-session": {
				const { participants } = msg.payload
				const session = this.pairProgrammingMode.createSession({
					workspaceId,
					participants: { ...participants, [userId]: "driver" },
				})
				this.pairProgrammingMode.startSession(session.id)
				return { type: "pair:session-created", payload: { session } }
			}

			case "pair:join-session": {
				const { sessionId, role } = msg.payload
				this.pairProgrammingMode.addParticipant(sessionId, userId, role || "navigator")
				const session = this.pairProgrammingMode.getSession(sessionId)
				return { type: "pair:session-joined", payload: { session } }
			}

			case "pair:switch-driver": {
				const { sessionId, newDriverId } = msg.payload
				const switched = this.pairProgrammingMode.switchDriver(sessionId, newDriverId)
				return { type: "pair:driver-switched", payload: { sessionId, newDriverId, switched } }
			}

			case "pair:add-comment": {
				const { sessionId, text, filePath, range } = msg.payload
				const comment = this.pairProgrammingMode.addComment({
					sessionId,
					userId,
					userName,
					text,
					filePath,
					range,
				})
				return { type: "pair:comment-added", payload: { comment } }
			}

			case "pair:get-comments": {
				const { sessionId } = msg.payload
				const comments = this.pairProgrammingMode.getComments(sessionId)
				return { type: "pair:comments", payload: { sessionId, comments } }
			}

			case "pair:end-session": {
				const { sessionId } = msg.payload
				this.pairProgrammingMode.endSession(sessionId)
				return { type: "pair:session-ended", payload: { sessionId } }
			}

			case "pair:get-summary": {
				const summary = this.pairProgrammingMode.getSummary()
				return { type: "pair:summary", payload: { sessions: summary } }
			}

			// ── Workspace management ─────────────────────────────────────
			case "workspace:register": {
				const { name, rootPath } = msg.payload
				this.workspaceProvider.registerWorkspace({ id: workspaceId, name, rootPath })
				return { type: "workspace:registered", payload: { workspaceId } }
			}

			case "workspace:open-file": {
				const { filePath } = msg.payload
				this.workspaceProvider.openFile(workspaceId, filePath)
				return { type: "workspace:file-opened", payload: { workspaceId, filePath } }
			}

			case "workspace:close-file": {
				const { filePath } = msg.payload
				this.workspaceProvider.closeFile(workspaceId, filePath)
				return { type: "workspace:file-closed", payload: { workspaceId, filePath } }
			}

			default:
				return null // Unknown message type, let the server handle it
		}
	}

	// ── Broadcasting ───────────────────────────────────────────────────────

	/**
	 * Broadcast a message to all clients in a workspace.
	 * @param {string} workspaceId
	 * @param {Object} message
	 */
	_broadcastToWorkspace(workspaceId, message) {
		if (this.broadcastFn) {
			this.broadcastFn(workspaceId, message)
		}
	}

	/**
	 * Broadcast a message to all connected clients.
	 * @param {Object} message
	 */
	_broadcastToAll(message) {
		if (this.broadcastFn) {
			this.broadcastFn("*", message)
		}
	}

	// ── EventLog integration ───────────────────────────────────────────────

	/**
	 * Log an event to the EventLog for audit trail.
	 * @param {string} type
	 * @param {Object} payload
	 * @param {'info'|'warning'|'error'} [severity='info']
	 */
	_logEvent(type, payload, severity = "info") {
		if (!this.eventLog) return
		try {
			this.eventLog.record({
				type,
				source: "collaboration",
				payload,
				severity,
			})
		} catch (err) {
			// EventLog failure is non-fatal
			console.error("[CollaborationBridge] EventLog error:", err.message)
		}
	}

	// ── Cleanup ────────────────────────────────────────────────────────────

	/**
	 * Clean up all resources.
	 */
	clear() {
		this.collaborationService.removeAllListeners()
		this.a2aProtocol.removeAllListeners()
		this.pairProgrammingMode.removeAllListeners()
		this.workspaceProvider.removeAllListeners()
		this.cursorSync.removeAllListeners()
		this.fileSync.removeAllListeners()
		this.removeAllListeners()
	}
}

module.exports = { CollaborationBridge }
