/**
 * Collaboration Module — Barrel exports.
 *
 * Provides real-time collaborative editing, workspace sharing,
 * cursor synchronization, and file change propagation.
 *
 * Inspired by Eclipse Theia's collaboration package.
 *
 * @see https://github.com/eclipse-theia/theia/blob/master/packages/collaboration/
 *
 * @module cloud/collaboration
 */

const { CollaborationService } = require("./CollaborationService")
const { WorkspaceProvider } = require("./WorkspaceProvider")
const { CursorSync } = require("./CursorSync")
const { FileSync } = require("./FileSync")

/**
 * Create a fully-configured collaboration system.
 * @param {Object} [options]
 * @param {number} [options.cursorDebounceMs=50] — Debounce interval for cursor updates
 * @returns {{
 *   collaborationService: CollaborationService,
 *   workspaceProvider: WorkspaceProvider,
 *   cursorSync: CursorSync,
 *   fileSync: FileSync,
 * }}
 */
function createCollaborationSystem(options = {}) {
	const collaborationService = new CollaborationService()
	const workspaceProvider = new WorkspaceProvider()
	const cursorSync = new CursorSync({ debounceMs: options.cursorDebounceMs ?? 50 })
	const fileSync = new FileSync()

	// Wire up events between services
	collaborationService.on("collaborator:left", ({ sessionId, userId }) => {
		cursorSync.removeCursor(sessionId, userId)
	})

	collaborationService.on("session:closed", ({ sessionId }) => {
		cursorSync.clearSession(sessionId)
	})

	workspaceProvider.on("file:locked", ({ workspaceId, filePath, userId }) => {
		collaborationService.getSessionsForWorkspace(workspaceId).forEach((session) => {
			collaborationService.emit("file:locked", {
				sessionId: session.id,
				filePath,
				userId,
			})
		})
	})

	workspaceProvider.on("file:unlocked", ({ workspaceId, filePath, userId }) => {
		collaborationService.getSessionsForWorkspace(workspaceId).forEach((session) => {
			collaborationService.emit("file:unlocked", {
				sessionId: session.id,
				filePath,
				userId,
			})
		})
	})

	return {
		collaborationService,
		workspaceProvider,
		cursorSync,
		fileSync,
	}
}

module.exports = {
	CollaborationService,
	WorkspaceProvider,
	CursorSync,
	FileSync,
	createCollaborationSystem,
}
