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
const { InfiniteImprovementLoop } = require("./modules/InfiniteImprovementLoop")
const { CrawlerAgent } = require("./modules/CrawlerAgent")
const { DeployOrchestrator } = require("./modules/DeployOrchestrator")
const { FileImporter } = require("./modules/FileImporter")
const { AutonomousLoop } = require("./modules/AutonomousLoop")
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
	InfiniteImprovementLoop,
	CrawlerAgent,
	DeployOrchestrator,
	FileImporter,
	AutonomousLoop,
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
}
