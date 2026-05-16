/**
 * Super Roo — Product Memory module.
 *
 * Provides a product-control-center layer with:
 * - Product features tracking
 * - Product updates timeline
 * - Feature test history
 * - Bug-to-feature mappings
 * - Agent notes
 * - Working Tree monitoring & auto-update
 * - Centralized Commit & Deploy Log (THE single source of truth for all commits/deploys)
 *
 * All data is stored as human-readable JSON files in the workspace.
 * Integrates with the existing EventLog for observability.
 */

export { ProductMemoryService } from "./ProductMemoryService"

export {
	ProductFeatureAgent,
	ProductUpdatesAgent,
	FeatureTesterAgent,
	BugFeatureMapperAgent,
	WorkingTreeAgent,
} from "./agents"
export type {
	ProductFeatureAgentOptions,
	ProductUpdatesAgentOptions,
	FeatureTesterAgentOptions,
	BugFeatureMapperAgentOptions,
	WorkingTreeAgentOptions,
	WorkingTreeSnapshot,
} from "./agents"

export { CommitDeployLog } from "./CommitDeployLog"
export type { CommitRecord, DeployRecord, CommitDeployLogFile, CommitType, DeployStatus } from "./CommitDeployLog"

export type {
	ProductFeatureStatus,
	ProductUpdateType,
	ProductFeature,
	ProductUpdate,
	FeatureTestRecord,
	BugFeatureMapping,
	AgentNote,
	ProductFeaturesFile,
	ProductUpdatesFile,
	FeatureTestHistoryFile,
	BugFeatureMapFile,
	AgentNotesFile,
} from "./types"
