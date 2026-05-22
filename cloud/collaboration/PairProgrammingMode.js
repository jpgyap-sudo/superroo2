/**
 * PairProgrammingMode — Real-time pair programming between two agents.
 *
 * Manages a pair programming session where two agents (or an agent + human)
 * share a workspace, take turns as "driver" and "navigator", and collaborate
 * on code in real-time.
 *
 * Inspired by Eclipse Theia's collaboration package and VoltAgent's A2A protocol.
 *
 * Features:
 *   - Role management (driver/navigator)
 *   - Turn-based editing with file locking
 *   - Real-time cursor and selection sync
 *   - Chat/comment system for the navigator
 *   - Session recording for audit trail
 *
 * @module cloud/collaboration/PairProgrammingMode
 */

const EventEmitter = require("node:events")
const crypto = require("crypto")

/**
 * @typedef {'driver'|'navigator'|'observer'} PairRole
 */

/**
 * @typedef {Object} PairProgrammingSession
 * @property {string} id — Session identifier
 * @property {string} workspaceId — Shared workspace
 * @property {Object<string, PairRole>} participants — userId -> role
 * @property {string|null} driverId — Current driver (has edit control)
 * @property {'idle'|'active'|'paused'|'completed'} status
 * @property {number} createdAt
 * @property {number} [completedAt]
 * @property {Array<Object>} events — Session event log
 */

/**
 * @typedef {Object} PairComment
 * @property {string} id
 * @property {string} sessionId
 * @property {string} userId
 * @property {string} userName
 * @property {string} text
 * @property {string} [filePath] — Optional file reference
 * @property {Object} [range] — Optional code range reference
 * @property {number} timestamp
 */

class PairProgrammingMode extends EventEmitter {
	constructor() {
		super()

		/** @type {Map<string, PairProgrammingSession>} */
		this._sessions = new Map()

		/** @type {Map<string, PairComment[]>} */
		this._comments = new Map()
	}

	// ── Session management ─────────────────────────────────────────────────

	/**
	 * Create a new pair programming session.
	 * @param {Object} opts
	 * @param {string} opts.workspaceId
	 * @param {Object<string, PairRole>} opts.participants — userId -> role
	 * @returns {PairProgrammingSession}
	 */
	createSession({ workspaceId, participants }) {
		const id = `pair_${crypto.randomUUID().slice(0, 12)}`

		// First participant with 'driver' role becomes the initial driver
		const driverEntry = Object.entries(participants).find(([, role]) => role === "driver")
		const driverId = driverEntry ? driverEntry[0] : Object.keys(participants)[0]

		const session = {
			id,
			workspaceId,
			participants: { ...participants },
			driverId,
			status: "idle",
			createdAt: Date.now(),
			events: [],
		}

		this._sessions.set(id, session)
		this._comments.set(id, [])
		this._logEvent(session, "session:created", { participants, driverId })
		this.emit("session:created", { sessionId: id, workspaceId, participants })

		return session
	}

	/**
	 * Get a session by ID.
	 * @param {string} sessionId
	 * @returns {PairProgrammingSession|undefined}
	 */
	getSession(sessionId) {
		return this._sessions.get(sessionId)
	}

	/**
	 * Get all active sessions.
	 * @returns {PairProgrammingSession[]}
	 */
	getActiveSessions() {
		return Array.from(this._sessions.values()).filter((s) => s.status === "active" || s.status === "idle")
	}

	/**
	 * Start a pair programming session.
	 * @param {string} sessionId
	 */
	startSession(sessionId) {
		const session = this._sessions.get(sessionId)
		if (!session) return

		session.status = "active"
		this._logEvent(session, "session:started", {})
		this.emit("session:started", { sessionId })
	}

	/**
	 * Pause a session.
	 * @param {string} sessionId
	 * @param {string} [reason]
	 */
	pauseSession(sessionId, reason) {
		const session = this._sessions.get(sessionId)
		if (!session) return

		session.status = "paused"
		this._logEvent(session, "session:paused", { reason })
		this.emit("session:paused", { sessionId, reason })
	}

	/**
	 * Resume a paused session.
	 * @param {string} sessionId
	 */
	resumeSession(sessionId) {
		const session = this._sessions.get(sessionId)
		if (!session || session.status !== "paused") return

		session.status = "active"
		this._logEvent(session, "session:resumed", {})
		this.emit("session:resumed", { sessionId })
	}

	/**
	 * End a session.
	 * @param {string} sessionId
	 */
	endSession(sessionId) {
		const session = this._sessions.get(sessionId)
		if (!session) return

		session.status = "completed"
		session.completedAt = Date.now()
		this._logEvent(session, "session:completed", {})
		this.emit("session:completed", { sessionId })
	}

	// ── Role management ────────────────────────────────────────────────────

	/**
	 * Get the current driver.
	 * @param {string} sessionId
	 * @returns {string|null}
	 */
	getDriver(sessionId) {
		const session = this._sessions.get(sessionId)
		return session ? session.driverId : null
	}

	/**
	 * Switch the driver role to another participant.
	 * @param {string} sessionId
	 * @param {string} newDriverId
	 * @returns {boolean}
	 */
	switchDriver(sessionId, newDriverId) {
		const session = this._sessions.get(sessionId)
		if (!session || !session.participants[newDriverId]) return false

		const oldDriver = session.driverId
		session.driverId = newDriverId
		this._logEvent(session, "driver:switched", { from: oldDriver, to: newDriverId })
		this.emit("driver:switched", { sessionId, from: oldDriver, to: newDriverId })
		return true
	}

	/**
	 * Get the role of a participant.
	 * @param {string} sessionId
	 * @param {string} userId
	 * @returns {PairRole|undefined}
	 */
	getRole(sessionId, userId) {
		const session = this._sessions.get(sessionId)
		return session?.participants[userId]
	}

	/**
	 * Check if a user is the current driver.
	 * @param {string} sessionId
	 * @param {string} userId
	 * @returns {boolean}
	 */
	isDriver(sessionId, userId) {
		const session = this._sessions.get(sessionId)
		return session?.driverId === userId
	}

	/**
	 * Check if a user can edit (must be driver).
	 * @param {string} sessionId
	 * @param {string} userId
	 * @returns {boolean}
	 */
	canEdit(sessionId, userId) {
		return this.isDriver(sessionId, userId)
	}

	/**
	 * Add a participant to a session.
	 * @param {string} sessionId
	 * @param {string} userId
	 * @param {PairRole} role
	 */
	addParticipant(sessionId, userId, role = "observer") {
		const session = this._sessions.get(sessionId)
		if (!session) return

		session.participants[userId] = role
		this._logEvent(session, "participant:added", { userId, role })
		this.emit("participant:added", { sessionId, userId, role })
	}

	/**
	 * Remove a participant from a session.
	 * @param {string} sessionId
	 * @param {string} userId
	 */
	removeParticipant(sessionId, userId) {
		const session = this._sessions.get(sessionId)
		if (!session) return

		delete session.participants[userId]

		// If the driver leaves, assign a new driver
		if (session.driverId === userId) {
			const remaining = Object.keys(session.participants)
			if (remaining.length > 0) {
				session.driverId = remaining[0]
				this._logEvent(session, "driver:auto-assigned", { newDriver: session.driverId })
			} else {
				session.driverId = null
				session.status = "completed"
			}
		}

		this._logEvent(session, "participant:removed", { userId })
		this.emit("participant:removed", { sessionId, userId })
	}

	// ── Comments / Navigator feedback ──────────────────────────────────────

	/**
	 * Add a comment to the session (navigator feedback).
	 * @param {Object} opts
	 * @param {string} opts.sessionId
	 * @param {string} opts.userId
	 * @param {string} opts.userName
	 * @param {string} opts.text
	 * @param {string} [opts.filePath]
	 * @param {Object} [opts.range]
	 * @returns {PairComment}
	 */
	addComment({ sessionId, userId, userName, text, filePath, range }) {
		const session = this._sessions.get(sessionId)
		if (!session) return null

		const comment = {
			id: `cmt_${crypto.randomUUID().slice(0, 8)}`,
			sessionId,
			userId,
			userName,
			text,
			filePath,
			range,
			timestamp: Date.now(),
		}

		this._comments.get(sessionId).push(comment)
		this._logEvent(session, "comment:added", { commentId: comment.id, userId, filePath })
		this.emit("comment:added", comment)
		return comment
	}

	/**
	 * Get all comments for a session.
	 * @param {string} sessionId
	 * @returns {PairComment[]}
	 */
	getComments(sessionId) {
		return [...(this._comments.get(sessionId) || [])]
	}

	// ── Session info ───────────────────────────────────────────────────────

	/**
	 * Get a summary of all active pair programming sessions.
	 * @returns {Object[]}
	 */
	getSummary() {
		return this.getActiveSessions().map((session) => ({
			id: session.id,
			workspaceId: session.workspaceId,
			participants: Object.entries(session.participants).map(([userId, role]) => ({
				userId,
				role,
				isDriver: userId === session.driverId,
			})),
			driverId: session.driverId,
			status: session.status,
			commentCount: (this._comments.get(session.id) || []).length,
			eventCount: session.events.length,
			createdAt: session.createdAt,
		}))
	}

	// ── Internal ───────────────────────────────────────────────────────────

	/**
	 * Log an event to the session's event log.
	 * @param {PairProgrammingSession} session
	 * @param {string} type
	 * @param {Object} data
	 */
	_logEvent(session, type, data) {
		session.events.push({
			type,
			...data,
			timestamp: Date.now(),
		})
	}

	// ── Cleanup ────────────────────────────────────────────────────────────

	/**
	 * Remove all sessions and comments.
	 */
	clear() {
		this._sessions.clear()
		this._comments.clear()
		this.removeAllListeners()
	}
}

module.exports = { PairProgrammingMode }
