/**
 * Collaboration Module — Barrel exports.
 *
 * Provides real-time collaborative editing, workspace sharing,
 * cursor synchronization, file change propagation, A2A agent protocol,
 * and pair programming mode.
 *
 * Inspired by Eclipse Theia's collaboration package and VoltAgent's A2A protocol.
 *
 * @see https://github.com/eclipse-theia/theia/blob/master/packages/collaboration/
 * @see https://github.com/voltagent/voltagent/blob/main/packages/a2a/
 *
 * @module cloud/collaboration
 */

const { CollaborationService } = require("./CollaborationService")
const { WorkspaceProvider } = require("./WorkspaceProvider")
const { CursorSync } = require("./CursorSync")
const { FileSync } = require("./FileSync")
const { A2AProtocol } = require("./A2AProtocol")
const { PairProgrammingMode } = require("./PairProgrammingMode")
const { CollaborationBridge } = require("./CollaborationBridge")

/**
 * Create a fully-configured collaboration system.
 * @param {Object} [options]
 * @param {number} [options.cursorDebounceMs=50] — Debounce interval for cursor updates
 * @param {Object} [options.eventLog] — Optional EventLog instance for audit trail
 * @param {Function} [options.broadcastFn] — Function(workspaceId, message) to broadcast
 * @returns {{
 *   collaborationService: CollaborationService,
 *   workspaceProvider: WorkspaceProvider,
 *   cursorSync: CursorSync,
 *   fileSync: FileSync,
 *   a2aProtocol: A2AProtocol,
 *   pairProgrammingMode: PairProgrammingMode,
 *   collaborationBridge: CollaborationBridge,
 * }}
 */
function createCollaborationSystem(options = {}) {
	const collaborationService = new CollaborationService()
	const workspaceProvider = new WorkspaceProvider()
	const cursorSync = new CursorSync({ debounceMs: options.cursorDebounceMs ?? 50 })
	const fileSync = new FileSync()
	const a2aProtocol = new A2AProtocol()
	const pairProgrammingMode = new PairProgrammingMode()

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

	// Create the bridge that connects everything
	const collaborationBridge = new CollaborationBridge({
		collaborationService,
		a2aProtocol,
		pairProgrammingMode,
		workspaceProvider,
		cursorSync,
		fileSync,
		eventLog: options.eventLog || null,
		broadcastFn: options.broadcastFn || null,
	})

	return {
		collaborationService,
		workspaceProvider,
		cursorSync,
		fileSync,
		a2aProtocol,
		pairProgrammingMode,
		collaborationBridge,
	}
}

module.exports = {
	CollaborationService,
	WorkspaceProvider,
	CursorSync,
	FileSync,
	A2AProtocol,
	PairProgrammingMode,
	CollaborationBridge,
	createCollaborationSystem,
}
