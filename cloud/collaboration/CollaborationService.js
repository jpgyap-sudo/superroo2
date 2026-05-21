/**
 * CollaborationService — Real-time collaborative editing service.
 *
 * Manages collaboration sessions, user presence, cursor sync, and file changes.
 * Uses WebSocket for real-time communication between collaborators.
 *
 * Inspired by Eclipse Theia's collaboration package which provides
 * real-time collaborative editing, workspace sharing, and cursor sync.
 *
 * @see https://github.com/eclipse-theia/theia/blob/master/packages/collaboration/
 */

const EventEmitter = require("node:events")

/**
 * @typedef {Object} Collaborator
 * @property {string} sessionId — Unique session identifier
 * @property {string} userId — User identifier
 * @property {string} userName — Display name
 * @property {string} workspaceId — Workspace they're collaborating on
 * @property {number} joinedAt — Timestamp when they joined
 * @property {Object} [cursor] — Current cursor position
 * @property {number} [cursor.line] — Line number
 * @property {number} [cursor.column] — Column number
 * @property {Object} [selection] — Current text selection
 * @property {Object} [selection.start] — Selection start position
 * @property {Object} [selection.end] — Selection end position
 */

/**
 * @typedef {Object} CollaborationSession
 * @property {string} id — Session identifier
 * @property {string} workspaceId — Workspace being collaborated on
 * @property {Collaborator[]} collaborators — Active collaborators
 * @property {number} createdAt — When the session was created
 * @property {'active'|'closed'} status — Session status
 */

class CollaborationService extends EventEmitter {
	constructor() {
		super()

		/** @type {Map<string, CollaborationSession>} */
		this._sessions = new Map()

		/** @type {Map<string, Collaborator>} */
		this._collaborators = new Map()
	}

	// ── Session management ─────────────────────────────────────────────────

	/**
	 * Create a new collaboration session for a workspace.
	 * @param {string} workspaceId
	 * @returns {CollaborationSession}
	 */
	createSession(workspaceId) {
		const id = `collab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
		const session = {
			id,
			workspaceId,
			collaborators: [],
			createdAt: Date.now(),
			status: "active",
		}
		this._sessions.set(id, session)
		this.emit("session:created", { sessionId: id, workspaceId })
		return session
	}

	/**
	 * Get a session by ID.
	 * @param {string} sessionId
	 * @returns {CollaborationSession|undefined}
	 */
	getSession(sessionId) {
		return this._sessions.get(sessionId)
	}

	/**
	 * Find active sessions for a workspace.
	 * @param {string} workspaceId
	 * @returns {CollaborationSession[]}
	 */
	getSessionsForWorkspace(workspaceId) {
		return Array.from(this._sessions.values()).filter((s) => s.workspaceId === workspaceId && s.status === "active")
	}

	/**
	 * Close a session.
	 * @param {string} sessionId
	 */
	closeSession(sessionId) {
		const session = this._sessions.get(sessionId)
		if (!session) return

		// Remove all collaborators from this session
		for (const collab of session.collaborators) {
			this._collaborators.delete(collab.sessionId)
		}

		session.status = "closed"
		session.collaborators = []
		this.emit("session:closed", { sessionId })
	}

	/**
	 * Get all active sessions.
	 * @returns {CollaborationSession[]}
	 */
	getActiveSessions() {
		return Array.from(this._sessions.values()).filter((s) => s.status === "active")
	}

	// ── Collaborator management ────────────────────────────────────────────

	/**
	 * Add a collaborator to a session.
	 * @param {string} sessionId
	 * @param {Object} opts
	 * @param {string} opts.userId
	 * @param {string} opts.userName
	 * @returns {Collaborator|null}
	 */
	joinSession(sessionId, { userId, userName }) {
		const session = this._sessions.get(sessionId)
		if (!session || session.status !== "active") return null

		const collaborator = {
			sessionId: `${sessionId}_${userId}`,
			userId,
			userName: userName || userId,
			workspaceId: session.workspaceId,
			joinedAt: Date.now(),
		}

		this._collaborators.set(collaborator.sessionId, collaborator)
		session.collaborators.push(collaborator)

		this.emit("collaborator:joined", {
			sessionId,
			collaborator: { ...collaborator },
			collaboratorCount: session.collaborators.length,
		})

		return collaborator
	}

	/**
	 * Remove a collaborator from a session.
	 * @param {string} sessionId
	 * @param {string} userId
	 */
	leaveSession(sessionId, userId) {
		const session = this._sessions.get(sessionId)
		if (!session) return

		const collabKey = `${sessionId}_${userId}`
		this._collaborators.delete(collabKey)

		session.collaborators = session.collaborators.filter((c) => c.userId !== userId)

		this.emit("collaborator:left", {
			sessionId,
			userId,
			collaboratorCount: session.collaborators.length,
		})

		// Auto-close session if no collaborators remain
		if (session.collaborators.length === 0) {
			this.closeSession(sessionId)
		}
	}

	/**
	 * Get all collaborators in a session.
	 * @param {string} sessionId
	 * @returns {Collaborator[]}
	 */
	getCollaborators(sessionId) {
		const session = this._sessions.get(sessionId)
		return session ? [...session.collaborators] : []
	}

	/**
	 * Get a specific collaborator.
	 * @param {string} sessionId
	 * @param {string} userId
	 * @returns {Collaborator|undefined}
	 */
	getCollaborator(sessionId, userId) {
		const session = this._sessions.get(sessionId)
		return session?.collaborators.find((c) => c.userId === userId)
	}

	// ── Cursor sync ────────────────────────────────────────────────────────

	/**
	 * Update a collaborator's cursor position.
	 * @param {string} sessionId
	 * @param {string} userId
	 * @param {Object} position
	 * @param {number} position.line
	 * @param {number} position.column
	 * @param {Object} [selection]
	 * @param {Object} [selection.start]
	 * @param {Object} [selection.end]
	 */
	updateCursor(sessionId, userId, position, selection) {
		const collaborator = this.getCollaborator(sessionId, userId)
		if (!collaborator) return

		collaborator.cursor = position
		collaborator.selection = selection

		this.emit("cursor:updated", {
			sessionId,
			userId,
			userName: collaborator.userName,
			position,
			selection,
		})
	}

	// ── File sync ──────────────────────────────────────────────────────────

	/**
	 * Broadcast a file change to all collaborators in a session.
	 * @param {string} sessionId
	 * @param {string} userId
	 * @param {string} filePath
	 * @param {Array<{range: Object, text: string}>} changes
	 */
	broadcastFileChange(sessionId, userId, filePath, changes) {
		const collaborator = this.getCollaborator(sessionId, userId)
		if (!collaborator) return

		this.emit("file:changed", {
			sessionId,
			userId,
			userName: collaborator.userName,
			filePath,
			changes,
		})
	}

	// ── Session info ───────────────────────────────────────────────────────

	/**
	 * Get summary of all active sessions.
	 * @returns {Object[]}
	 */
	getSummary() {
		return this.getActiveSessions().map((session) => ({
			id: session.id,
			workspaceId: session.workspaceId,
			collaboratorCount: session.collaborators.length,
			collaborators: session.collaborators.map((c) => ({
				userId: c.userId,
				userName: c.userName,
				joinedAt: c.joinedAt,
				hasCursor: !!c.cursor,
			})),
			createdAt: session.createdAt,
		}))
	}

	// ── Cleanup ────────────────────────────────────────────────────────────

	/**
	 * Remove all sessions and collaborators.
	 */
	clear() {
		this._sessions.clear()
		this._collaborators.clear()
		this.removeAllListeners()
	}
}

module.exports = { CollaborationService }
