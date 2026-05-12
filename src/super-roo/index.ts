/**
 * Super Roo — public entry point.
 *
 * Phase 1 surface. The rest of the Roo extension (and future Phases 2+) should
 * import from here, never from individual sub-paths, so we can refactor module
 * internals without breaking external callers.
 */

export { SuperRooOrchestrator } from "./orchestrator"
export type { ProcessResult } from "./orchestrator"
export { AgentRegistry } from "./orchestrator"

export { SafetyManager } from "./safety"
export type { SafetyManagerOptions } from "./safety"

export { MemoryStore } from "./memory"
export { FeatureRegistry } from "./features"
export { BugRegistry } from "./bugs"
export type { BugInputRaw, FixInputRaw, FixRecord } from "./bugs"
export { TaskQueue } from "./queue"
export { EventLog } from "./logging"
export type { EventSubscriber, EventLogOptions } from "./logging"

export { CoderAgent, DebuggerAgent, PmAgent, SupabaseAgent, TesterAgent } from "./agents"
export type {
	CoderAgentOptions,
	DebuggerAgentOptions,
	PmAgentOptions,
	SupabaseAgentOptions,
	TesterAgentOptions,
	RooTaskRunner,
	RooTaskRequest,
	RooTaskOutcome,
	RooTaskEvent,
	RooTaskEventListener,
	RooTokenUsage,
	RooToolUsageSummary,
	TestRunner,
	TestRequest,
	TestResult,
	TestKind,
	SupabaseRunner,
	SupabaseRequest,
	SupabaseResult,
	SupabaseAction,
	SqlIntent,
} from "./agents"
export { capabilityForSupabaseRequest, inferSqlIntent } from "./agents"

export * from "./types"

// Self-Healing module
export {
	HealingBus,
	SelfHealingLoop,
	makeIncidentFingerprint,
	severityRank,
	classifyRootCause,
	classifyFromText,
	isSecurityRisk,
	requiresHumanApproval,
	getDiagnosticSteps,
	buildRepairPlan,
	severityToPriority,
	summarizeRepairPlan,
	SelfHealingAgent,
	createReportIncidentTask,
	createRunHealingCycleTask,
} from "./healing"
export type {
	HealingBusConfig,
	IncidentFilter,
	ClassificationResult,
	ClassificationPattern,
	RepairPlanOptions,
	SelfHealingConfig,
	SelfHealingStats,
	SelfHealingAgentOptions,
} from "./healing"

// Machine Learning (deep learning + infinite improvement)
export {
	Tensor,
	DenseLayer,
	ReLULayer,
	SigmoidLayer,
	TanhLayer,
	SoftmaxLayer,
	DropoutLayer,
	BatchNormLayer,
	CrossEntropyLoss,
	MSELoss,
	BCELoss,
	AdamOptimizer,
	SGDOptimizer,
	NeuralNetwork,
	CodeLearner,
	DebugLearner,
	TestLearner,
	InfiniteImprovementLoop,
} from "./ml"
export type {
	Layer,
	LossFn,
	Optimizer,
	NeuralNetworkConfig,
	TrainingConfig,
	CodeSample,
	CodeLearnerConfig,
	DebugSample,
	DebugLearnerConfig,
	TestSample,
	TestLearnerConfig,
	LoopConfig,
	LoopStats,
} from "./ml"

// File Import
export { FileImporter } from "./import"
export type { ImportableFileType, ImportedFile, ImportResult } from "./import"

// Deploy System
export { DeployOrchestrator } from "./deploy"
export type { DeployConfig, DeployState } from "./deploy"

// Crawler Agent
export { CrawlerAgent } from "./crawler"
export type { CrawlSource, RawDocument, ExtractedEntity, Signal } from "./crawler"

// Parallel Execution Engine
export { ParallelExecutor, AgentBus, ParallelHealingPipeline, ParallelMLTrainer } from "./parallel"
export type {
	ParallelExecutorConfig,
	WorkerSlot,
	ExecutorStats,
	AgentMessage,
	AgentMessagePriority,
	AgentMessageHandler,
	AgentSubscription,
	AgentBusStats,
	ParallelHealingConfig,
	HealingBatchResult,
	HealingWorkerSlot,
	ParallelMLConfig,
	MLTrainerStats,
	TrainingBatchResult,
} from "./parallel"

// Product Memory (product control center)
export { ProductMemoryService } from "./product-memory"
export {
	ProductFeatureAgent,
	ProductUpdatesAgent,
	FeatureTesterAgent,
	BugFeatureMapperAgent,
	WorkingTreeAgent,
	CommitDeployLog,
} from "./product-memory"
export type {
	ProductFeatureAgentOptions,
	ProductUpdatesAgentOptions,
	FeatureTesterAgentOptions,
	BugFeatureMapperAgentOptions,
	WorkingTreeAgentOptions,
	WorkingTreeSnapshot,
	CommitRecord,
	DeployRecord,
	CommitDeployLogFile,
	CommitType,
	DeployStatus,
	ProductFeatureStatus,
	ProductUpdateType,
	ProductFeature,
	ProductUpdate,
	FeatureTestRecord,
	BugFeatureMapping,
	AgentNote,
} from "./product-memory"

// CPU Guard (resource-aware autonomous agent loop protection)
export {
	runGuardedAgentLoop,
	GuardedLoopError,
	runControlledAutonomousTask,
	autonomousController,
	onAutonomousControllerEvent,
	getCpuUsagePercent,
	getRamUsagePercent,
	getResourceSample,
	waitForCpuBelow,
	onResourceGuardEvent,
} from "./cpu-guard"
export type {
	AgentStepResult,
	GuardedLoopOptions,
	AutonomousMode,
	ControlledAutonomousOptions,
	TaskSummary,
	AutonomousControllerEvent,
	AutonomousControllerListener,
	ResourceSample,
	ResourceGuardEvent,
	ResourceGuardListener,
} from "./cpu-guard"

// Infrastructure (Log Aggregation & Monitoring)
export { LogAggregator, getLogAggregator } from "./infrastructure"
export type {
	LogEntry,
	LogSource,
	LogLevel,
	LogQueryOptions,
	LogQueryResult,
	LogAggregatorConfig,
} from "./infrastructure"

// Brain + Central Memory System
export {
	AgentRuntimeWrapper,
	CentralBrain,
	BrainEnabledAgent,
	TelegramBrainBridge,
	UnifiedTaskRouter,
	VscodeBrainBridge,
} from "./brain"
export type {
	AgentLike,
	AgentRuntimeWrapperOptions,
	CentralBrainOptions,
	CentralBrainRunResult,
	BrainEnabledAgentOptions,
	TelegramBrainBridgeOptions,
	UnifiedTask,
	UnifiedTaskResult,
	VscodeBrainBridgeOptions,
	VscodeContextPayload,
	BrainWebSocketMessage,
} from "./brain"
