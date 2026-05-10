/**
 * Super Roo — Debug Team Module
 *
 * The Super Debugging Team is an autonomous multi-agent system for solving
 * complex feature problems through phase-by-phase breakdown, hypothesis-driven
 * iteration, safe container execution, automatic rollback, and skill generation.
 *
 * Architecture:
 *   SuperDebugLoop (orchestrator)
 *     ├── PhaseBreakdownEngine  — decomposes complex goals into phases
 *     ├── HypothesisEngine      — manages assumptions, critical thinking
 *     ├── ContainerSandbox      — safe 24/7 iteration in Docker
 *     ├── RollbackManager       — git snapshots + automatic rollback
 *     ├── FeatureSyncOrchestrator — coordinates multi-feature work
 *     └── SkillsGenerator       — auto-creates skills/resources from failures
 *
 * Integrates with:
 *   - SelfHealingLoop (reactive healing)
 *   - InfiniteImprovementLoop (ML-based improvement)
 *   - ParallelExecutor (concurrent agent execution)
 *   - HealingBus (incident management)
 *   - BugRegistry (bug tracking)
 *   - FeatureRegistry (feature tracking)
 *   - RemoteShell (VPS operations)
 *   - AgentBus (inter-agent communication)
 */

export { SuperDebugLoop } from "./SuperDebugLoop"
export type {
	SuperDebugConfig,
	SuperDebugStats,
	DebugJob,
	DebugJobStatus,
	DebugPhase,
	DebugHypothesis,
	DebugAssumption,
	DebugSnapshot,
	DebugLesson,
} from "./SuperDebugLoop"

export { PhaseBreakdownEngine } from "./engines/PhaseBreakdownEngine"
export type {
	PhaseBreakdown,
	PhaseDefinition,
	PhaseStatus,
	PhaseDependency,
	BreakdownOptions,
} from "./engines/PhaseBreakdownEngine"

export { HypothesisEngine } from "./engines/HypothesisEngine"
export type {
	Hypothesis,
	HypothesisStatus,
	Assumption,
	AssumptionStatus,
	HypothesisEngineConfig,
	HypothesisResult,
} from "./engines/HypothesisEngine"

export { ContainerSandbox } from "./sandbox/ContainerSandbox"
export type {
	SandboxConfig,
	SandboxResult,
	SandboxCommand,
	SandboxImage,
	SandboxNetworkMode,
} from "./sandbox/ContainerSandbox"

export { RollbackManager } from "./sandbox/RollbackManager"
export type {
	RollbackConfig,
	Snapshot,
	SnapshotType,
	RollbackResult,
	RollbackStrategy,
} from "./sandbox/RollbackManager"

export { FeatureSyncOrchestrator } from "./engines/FeatureSyncOrchestrator"
export type {
	FeatureSyncConfig,
	FeatureSyncPlan,
	FeatureDependency,
	SyncStatus,
	IntegrationCheck,
} from "./engines/FeatureSyncOrchestrator"

export { SkillsGenerator } from "./engines/SkillsGenerator"
export type {
	SkillsGeneratorConfig,
	SkillDefinition,
	ResourceDefinition,
	GeneratedArtifact,
	SkillSource,
} from "./engines/SkillsGenerator"

// ── Adapters ────────────────────────────────────────────────────────────────

export { OpenClawAdapter } from "./adapters/OpenClawAdapter"
export type { OpenClawAnalysisType, OpenClawAnalysisRequest, OpenClawAnalysisResult } from "./adapters/OpenClawAdapter"

export { HermesClawAdapter } from "./adapters/HermesClawAdapter"
export type {
	HermesClawOperation,
	HermesClawRequest,
	HermesClawResult,
	HermesClawAdapterConfig,
} from "./adapters/HermesClawAdapter"

// ── Ace Team Reporting ──────────────────────────────────────────────────────

export { AceTeamReportGenerator } from "./reporting/AceTeamReportGenerator"
export type {
	AceTeamReport,
	AceSessionSummary,
	AceJobReport,
	AceMLInsights,
	AceSkillRecord,
	AceErrorRecord,
	AceSystemHealth,
	AceTeamReportConfig,
} from "./reporting/AceTeamReportGenerator"
