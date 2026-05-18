/**
 * SuperRoo Product Memory Module
 *
 * Centralized tracking for commits, deployments, model usage, workflow compliance,
 * product features, updates, test history, and bug-to-feature mappings.
 */

// Export ProductMemoryService
export { ProductMemoryService } from "./ProductMemoryService"

// Export Agents
export {
	ProductFeatureAgent,
	ProductUpdatesAgent,
	FeatureTesterAgent,
	BugFeatureMapperAgent,
	WorkingTreeAgent,
} from "./agents"

// Export Agent Options
export type {
	ProductFeatureAgentOptions,
	ProductUpdatesAgentOptions,
	FeatureTesterAgentOptions,
	BugFeatureMapperAgentOptions,
	WorkingTreeAgentOptions,
	WorkingTreeSnapshot,
} from "./agents"

// Export CommitDeployLog
export {
	CommitDeployLog,
	type CommitRecord,
	type CommitType,
	type DeployRecord,
	type DeployStatus,
	type ModelUsage,
	type WorkflowCompliance,
	type CommitDeployLogFile,
} from "./CommitDeployLog"

// Export ModelUsageTracker
export {
	ModelUsageTracker,
	initializeModelUsageTracker,
	getModelUsageTracker,
	type ModelUsageRecord,
	type TaskUsageSummary,
	type ModelUsageStats,
} from "./ModelUsageTracker"

// Export WorkflowEnforcer
export {
	WorkflowEnforcer,
	initializeWorkflowEnforcer,
	getWorkflowEnforcer,
	isWorkflowEnforcerInitialized,
	type WorkflowPhase,
	type ViolationAction,
	type WorkflowEnforcerConfig,
	type WorkflowViolation,
	type WorkflowState,
} from "./WorkflowEnforcer"

// Export Product Memory Types
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
