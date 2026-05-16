/**
 * Super Roo — public webview component surface.
 *
 * Phase 4 will mount <SuperRooDashboard /> somewhere in Roo's webview app.
 * Until then, this barrel is the only stable import point.
 */

export { SuperRooDashboard } from "./SuperRooDashboard"
export type { SuperRooDashboardProps, SrContextValue } from "./SuperRooDashboard"

export { SrProvider, useSr } from "./hooks/SrContext"
export { SrMessageClient } from "./messaging/client"
export type { VsCodeLike } from "./messaging/client"

export type { SrWebviewMessage, SrExtensionMessage } from "./messaging/protocol"
export { SR_MESSAGE_PREFIX, isSrExtensionMessage } from "./messaging/protocol"

export type {
	SafetyMode,
	SrTask,
	SrFeature,
	SrBug,
	SrEvent,
	SrDashboardSnapshot,
	SrSettings,
	TaskStatus,
	TaskPriority,
	FeatureStatus,
	FeatureHealth,
	BugSeverity,
	BugStatus,
	EventLevel,
} from "./types"

export {
	mockSnapshot,
	mockFeatures,
	mockBugs,
	mockEvents,
	mockTasks,
} from "./messaging/mockData"
