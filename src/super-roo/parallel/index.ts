/**
 * Super Roo — Parallel Execution Module.
 *
 * Provides the infrastructure for true parallel AI agent coordination:
 *   - ParallelExecutor: Resource-aware concurrent task execution
 *   - AgentBus: Direct agent-to-agent messaging
 *   - ParallelHealingPipeline: Batch incident processing
 *   - ParallelMLTrainer: Concurrent learner training
 */

export { ParallelExecutor } from "./ParallelExecutor"
export type { ParallelExecutorConfig, WorkerSlot, ExecutorStats } from "./ParallelExecutor"

export { AgentBus } from "./AgentBus"
export type {
	AgentMessage,
	AgentMessagePriority,
	AgentMessageHandler,
	AgentSubscription,
	AgentBusStats,
} from "./AgentBus"

export { ParallelHealingPipeline } from "./ParallelHealingPipeline"
export type { ParallelHealingConfig, HealingBatchResult, HealingWorkerSlot } from "./ParallelHealingPipeline"

export { ParallelMLTrainer } from "./ParallelMLTrainer"
export type { ParallelMLConfig, MLTrainerStats, TrainingBatchResult } from "./ParallelMLTrainer"
