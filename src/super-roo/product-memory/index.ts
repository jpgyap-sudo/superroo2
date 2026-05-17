/**
 * SuperRoo Product Memory Module
 *
 * Centralized tracking for commits, deployments, model usage, and workflow compliance.
 *
 * Exports:
 * - CommitDeployLog: Track commits and deployments
 * - ModelUsageTracker: Track AI model API usage
 * - WorkflowEnforcer: Enforce SuperRoo workflow compliance
 */

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
