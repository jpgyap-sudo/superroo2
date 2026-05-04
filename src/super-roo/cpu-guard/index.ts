/**
 * Super Roo — CPU Guard Module
 *
 * Provides resource-aware backpressure for autonomous agent loops.
 * Integrates the improved CPU Guard package into the SuperRoo ecosystem.
 *
 * Key exports:
 * - `runGuardedAgentLoop` — bounded agent step loop with CPU/RAM backpressure
 * - `runControlledAutonomousTask` — full controlled autonomous task runner
 * - `waitForCpuBelow` — resource-aware pause until CPU/RAM are within limits
 * - `getCpuUsagePercent`, `getRamUsagePercent`, `getResourceSample` — resource sampling
 * - `autonomousController` — mode management (paused/controlled/aggressive)
 * - `onResourceGuardEvent`, `onAutonomousControllerEvent` — event subscriptions
 * - `GuardedLoopError` — typed error for loop guard violations
 * - `enqueueAgentTask` — BullMQ queue integration
 */

export { runGuardedAgentLoop, GuardedLoopError } from "./AgentLoopGuard"
export type { AgentStepResult, GuardedLoopOptions } from "./AgentLoopGuard"

export { runControlledAutonomousTask, autonomousController, onAutonomousControllerEvent } from "./autonomousController"
export type {
	AutonomousMode,
	ControlledAutonomousOptions,
	TaskSummary,
	AutonomousControllerEvent,
	AutonomousControllerListener,
} from "./autonomousController"

export {
	getCpuUsagePercent,
	getRamUsagePercent,
	getResourceSample,
	waitForCpuBelow,
	onResourceGuardEvent,
} from "./cpuGuard"
export type { ResourceSample, ResourceGuardEvent, ResourceGuardListener } from "./cpuGuard"

export { enqueueAgentTask, agentQueue, connection } from "./queue"
