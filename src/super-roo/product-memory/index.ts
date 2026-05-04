/**
 * Super Roo — Product Memory module.
 *
 * Provides a product-control-center layer with:
 * - Product features tracking
 * - Product updates timeline
 * - Feature test history
 * - Bug-to-feature mappings
 * - Agent notes
 *
 * All data is stored as human-readable JSON files in the workspace.
 * Integrates with the existing EventLog for observability.
 */

export { ProductMemoryService } from "./ProductMemoryService"

export { ProductFeatureAgent, ProductUpdatesAgent, FeatureTesterAgent, BugFeatureMapperAgent } from "./agents"
export type {
	ProductFeatureAgentOptions,
	ProductUpdatesAgentOptions,
	FeatureTesterAgentOptions,
	BugFeatureMapperAgentOptions,
} from "./agents"

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
