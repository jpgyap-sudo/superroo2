/**
 * CursorSync — Real-time cursor and selection synchronization.
 *
 * Manages cursor position broadcasting and receiving between collaborators.
 * Provides debounced updates to avoid flooding the network.
 *
 * Inspired by Eclipse Theia's collaboration package which provides
 * real-time cursor and selection sharing across collaborators.
 *
 * @see https://github.com/eclipse-theia/theia/blob/master/packages/collaboration/
 */

const EventEmitter = require("node:events")

/**
 * @typedef {Object} CursorPosition
 * @property {number} line
 * @property {number} column
 */

/**
 * @typedef {Object} TextSelection
 * @property {CursorPosition} start
 * @property {CursorPosition} end
 */

/**
 * @typedef {Object} CursorUpdate
 * @property {string} sessionId
 * @property {string} userId
 * @property {string} userName
 * @property {CursorPosition} position
 * @property {TextSelection} [selection]
 * @property {number} timestamp
 */

class CursorSync extends EventEmitter {
	/**
	 * @param {Object} [options]
	 * @param {number} [options.debounceMs=50] — Debounce interval for cursor updates
	 */
	constructor(options = {}) {
		super()

		/** @type {Map<string, CursorUpdate>} */
		this._cursors = new Map()

		/** @type {Map<string, NodeJS.Timeout>} */
		this._debounceTimers = new Map()

		this._debounceMs = options.debounceMs ?? 50
	}

	/**
	 * Update a collaborator's cursor position (debounced).
	 * @param {string} sessionId
	 * @param {string} userId
	 * @param {string} userName
	 * @param {CursorPosition} position
	 * @param {TextSelection} [selection]
	 */
	updateCursor(sessionId, userId, userName, position, selection) {
		const key = `${sessionId}_${userId}`

		// Debounce to avoid flooding
		if (this._debounceTimers.has(key)) {
			clearTimeout(this._debounceTimers.get(key))
		}

		this._debounceTimers.set(
			key,
			setTimeout(() => {
				const update = {
					sessionId,
					userId,
					userName,
					position: { ...position },
					selection: selection ? { start: { ...selection.start }, end: { ...selection.end } } : undefined,
					timestamp: Date.now(),
				}

				this._cursors.set(key, update)
				this.emit("cursor:updated", update)
				this._debounceTimers.delete(key)
			}, this._debounceMs),
		)
	}

	/**
	 * Flush a pending cursor update immediately.
	 * @param {string} sessionId
	 * @param {string} userId
	 */
	flush(sessionId, userId) {
		const key = `${sessionId}_${userId}`
		if (this._debounceTimers.has(key)) {
			clearTimeout(this._debounceTimers.get(key))
			this._debounceTimers.delete(key)
			// Re-trigger with the last known position
			const last = this._cursors.get(key)
			if (last) {
				this.emit("cursor:updated", last)
			}
		}
	}

	/**
	 * Get the current cursor position for a collaborator.
	 * @param {string} sessionId
	 * @param {string} userId
	 * @returns {CursorUpdate|undefined}
	 */
	getCursor(sessionId, userId) {
		return this._cursors.get(`${sessionId}_${userId}`)
	}

	/**
	 * Get all cursor positions in a session.
	 * @param {string} sessionId
	 * @returns {CursorUpdate[]}
	 */
	getCursorsInSession(sessionId) {
		return Array.from(this._cursors.values()).filter((c) => c.sessionId === sessionId)
	}

	/**
	 * Remove a collaborator's cursor when they leave.
	 * @param {string} sessionId
	 * @param {string} userId
	 */
	removeCursor(sessionId, userId) {
		const key = `${sessionId}_${userId}`
		if (this._debounceTimers.has(key)) {
			clearTimeout(this._debounceTimers.get(key))
			this._debounceTimers.delete(key)
		}
		this._cursors.delete(key)
		this.emit("cursor:removed", { sessionId, userId })
	}

	/**
	 * Remove all cursors for a session.
	 * @param {string} sessionId
	 */
	clearSession(sessionId) {
		for (const [key, cursor] of this._cursors) {
			if (cursor.sessionId === sessionId) {
				if (this._debounceTimers.has(key)) {
					clearTimeout(this._debounceTimers.get(key))
					this._debounceTimers.delete(key)
				}
				this._cursors.delete(key)
			}
		}
	}

	/**
	 * Clear all cursors and timers.
	 */
	clear() {
		for (const timer of this._debounceTimers.values()) {
			clearTimeout(timer)
		}
		this._debounceTimers.clear()
		this._cursors.clear()
		this.removeAllListeners()
	}
}

module.exports = { CursorSync }
