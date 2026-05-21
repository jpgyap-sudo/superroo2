/**
 * WorkspaceProvider — Shared workspace management for collaboration.
 *
 * Manages shared workspaces that multiple collaborators can join.
 * Tracks workspace state, file locks, and access control.
 *
 * Inspired by Eclipse Theia's collaboration-workspace-service which
 * manages shared workspace state across collaborators.
 *
 * @see https://github.com/eclipse-theia/theia/blob/master/packages/collaboration/
 */

const EventEmitter = require("node:events")

/**
 * @typedef {Object} SharedWorkspace
 * @property {string} id — Workspace identifier
 * @property {string} name — Display name
 * @property {string} rootPath — Root file path
 * @property {string[]} openFiles — Currently open files
 * @property {Map<string, string>} fileLocks — userId -> filePath locks
 * @property {number} createdAt — Timestamp
 * @property {'active'|'archived'} status
 */

class WorkspaceProvider extends EventEmitter {
	constructor() {
		super()

		/** @type {Map<string, SharedWorkspace>} */
		this._workspaces = new Map()
	}

	/**
	 * Register a workspace for collaboration.
	 * @param {Object} opts
	 * @param {string} opts.id
	 * @param {string} opts.name
	 * @param {string} opts.rootPath
	 * @returns {SharedWorkspace}
	 */
	registerWorkspace({ id, name, rootPath }) {
		const workspace = {
			id,
			name: name || id,
			rootPath,
			openFiles: [],
			fileLocks: new Map(),
			createdAt: Date.now(),
			status: "active",
		}
		this._workspaces.set(id, workspace)
		this.emit("workspace:registered", { workspaceId: id, name: workspace.name })
		return workspace
	}

	/**
	 * Get a workspace by ID.
	 * @param {string} id
	 * @returns {SharedWorkspace|undefined}
	 */
	getWorkspace(id) {
		return this._workspaces.get(id)
	}

	/**
	 * Get all registered workspaces.
	 * @returns {SharedWorkspace[]}
	 */
	getAllWorkspaces() {
		return Array.from(this._workspaces.values())
	}

	/**
	 * Archive a workspace.
	 * @param {string} id
	 */
	archiveWorkspace(id) {
		const ws = this._workspaces.get(id)
		if (ws) {
			ws.status = "archived"
			this.emit("workspace:archived", { workspaceId: id })
		}
	}

	// ── File management ────────────────────────────────────────────────────

	/**
	 * Mark a file as open in a workspace.
	 * @param {string} workspaceId
	 * @param {string} filePath
	 */
	openFile(workspaceId, filePath) {
		const ws = this._workspaces.get(workspaceId)
		if (ws && !ws.openFiles.includes(filePath)) {
			ws.openFiles.push(filePath)
			this.emit("file:opened", { workspaceId, filePath })
		}
	}

	/**
	 * Mark a file as closed in a workspace.
	 * @param {string} workspaceId
	 * @param {string} filePath
	 */
	closeFile(workspaceId, filePath) {
		const ws = this._workspaces.get(workspaceId)
		if (ws) {
			ws.openFiles = ws.openFiles.filter((f) => f !== filePath)
			this.emit("file:closed", { workspaceId, filePath })
		}
	}

	/**
	 * Get open files in a workspace.
	 * @param {string} workspaceId
	 * @returns {string[]}
	 */
	getOpenFiles(workspaceId) {
		const ws = this._workspaces.get(workspaceId)
		return ws ? [...ws.openFiles] : []
	}

	// ── File locking ───────────────────────────────────────────────────────

	/**
	 * Lock a file for exclusive editing by a user.
	 * @param {string} workspaceId
	 * @param {string} filePath
	 * @param {string} userId
	 * @returns {boolean} — Whether the lock was acquired
	 */
	lockFile(workspaceId, filePath, userId) {
		const ws = this._workspaces.get(workspaceId)
		if (!ws) return false

		// Check if already locked by someone else
		for (const [lockedBy, lockedFile] of ws.fileLocks) {
			if (lockedFile === filePath && lockedBy !== userId) {
				return false // Already locked by another user
			}
		}

		ws.fileLocks.set(userId, filePath)
		this.emit("file:locked", { workspaceId, filePath, userId })
		return true
	}

	/**
	 * Release a file lock.
	 * @param {string} workspaceId
	 * @param {string} filePath
	 * @param {string} userId
	 */
	unlockFile(workspaceId, filePath, userId) {
		const ws = this._workspaces.get(workspaceId)
		if (ws && ws.fileLocks.get(userId) === filePath) {
			ws.fileLocks.delete(userId)
			this.emit("file:unlocked", { workspaceId, filePath, userId })
		}
	}

	/**
	 * Get the user who has locked a file, if any.
	 * @param {string} workspaceId
	 * @param {string} filePath
	 * @returns {string|null}
	 */
	getFileLockOwner(workspaceId, filePath) {
		const ws = this._workspaces.get(workspaceId)
		if (!ws) return null
		for (const [userId, lockedFile] of ws.fileLocks) {
			if (lockedFile === filePath) return userId
		}
		return null
	}

	/**
	 * Release all locks held by a user.
	 * @param {string} workspaceId
	 * @param {string} userId
	 */
	releaseUserLocks(workspaceId, userId) {
		const ws = this._workspaces.get(workspaceId)
		if (ws) {
			ws.fileLocks.delete(userId)
			this.emit("locks:released", { workspaceId, userId })
		}
	}

	// ── Cleanup ────────────────────────────────────────────────────────────

	clear() {
		this._workspaces.clear()
		this.removeAllListeners()
	}
}

module.exports = { WorkspaceProvider }
