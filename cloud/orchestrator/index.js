/**
 * Cloud Orchestrator — Public API exports.
 *
 * Usage:
 *   const { CloudOrchestrator, SafetyMode } = require('./orchestrator');
 *   const orchestrator = new CloudOrchestrator({ dbPath: '/opt/superroo2/cloud/orchestrator/data/orchestrator.db' });
 *   await orchestrator.start();
 */

const { CloudOrchestrator, SafetyMode } = require("./CloudOrchestrator")
const MemoryStore = require("./stores/MemoryStore")
const EventLog = require("./modules/EventLog")
const TaskQueueBullMQ = require("./modules/TaskQueueBullMQ")
const { SafetyManager } = require("./modules/SafetyManager")
const { AgentRegistry } = require("./modules/AgentRegistry")
const { FeatureRegistry } = require("./modules/FeatureRegistry")
const { BugRegistry } = require("./modules/BugRegistry")
const { CommitDeployLog } = require("./modules/CommitDeployLog")
const { HealingBus } = require("./modules/HealingBus")
const { SelfHealingLoop } = require("./modules/SelfHealingLoop")
const { ParallelExecutor } = require("./modules/ParallelExecutor")
const { AgentBus } = require("./modules/AgentBus")
const { ParallelHealingPipeline } = require("./modules/ParallelHealingPipeline")
const { ParallelMLTrainer } = require("./modules/ParallelMLTrainer")
const { InfiniteImprovementLoop } = require("./modules/InfiniteImprovementLoop")
const { CrawlerAgent } = require("./modules/CrawlerAgent")
const { DeployOrchestrator } = require("./modules/DeployOrchestrator")
const { FileImporter } = require("./modules/FileImporter")
const { AutonomousLoop } = require("./modules/AutonomousLoop")
const { CommissioningLoop } = require("./modules/CommissioningLoop")
const {
	getCpuUsagePercent,
	getRamUsagePercent,
	getResourceSample,
	onResourceGuardEvent,
	waitForCpuBelow,
	runGuardedAgentLoop,
	GuardedLoopError,
	autonomousController,
	onAutonomousControllerEvent,
	runControlledAutonomousTask,
} = require("./modules/CPUGuard")
const { RAMMonitor, DEFAULT_THRESHOLDS } = require("./modules/RAMMonitor")
const { RAMScheduler, PRIORITY } = require("./modules/RAMScheduler")
const { WorkerPauseManager, WORKER_CRITICALITY, DEFAULT_WORKER_CRITICALITY } = require("./modules/WorkerPauseManager")

// ── OpenHands-style upgrade modules ────────────────────────────────────────────
const {
	assertTransition,
	nextAllowed,
	isTerminal,
	transition: taskTransition,
	ALLOWED: TASK_TRANSITIONS,
} = require("./modules/TaskStateMachine")
const { SuperRooEventBus, eventBus } = require("./modules/SuperRooEventBus")
const { BrainClient, brainClient } = require("./modules/BrainClient")

module.exports = {
	CloudOrchestrator,
	SafetyMode,
	MemoryStore,
	EventLog,
	TaskQueueBullMQ,
	SafetyManager,
	AgentRegistry,
	FeatureRegistry,
	BugRegistry,
	CommitDeployLog,
	HealingBus,
	SelfHealingLoop,
	ParallelExecutor,
	AgentBus,
	ParallelHealingPipeline,
	ParallelMLTrainer,
	InfiniteImprovementLoop,
	CrawlerAgent,
	DeployOrchestrator,
	FileImporter,
	AutonomousLoop,
	CommissioningLoop,
	// CPU Guard exports
	getCpuUsagePercent,
	getRamUsagePercent,
	getResourceSample,
	onResourceGuardEvent,
	waitForCpuBelow,
	runGuardedAgentLoop,
	GuardedLoopError,
	autonomousController,
	onAutonomousControllerEvent,
	runControlledAutonomousTask,
	// RAM Orchestrator exports
	RAMMonitor,
	DEFAULT_THRESHOLDS,
	RAMScheduler,
	PRIORITY,
	WorkerPauseManager,
	WORKER_CRITICALITY,
	DEFAULT_WORKER_CRITICALITY,
	// OpenHands-style upgrade exports
	assertTransition,
	nextAllowed,
	isTerminal,
	taskTransition,
	TASK_TRANSITIONS,
	SuperRooEventBus,
	eventBus,
	BrainClient,
	brainClient,
}
