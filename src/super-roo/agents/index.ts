/**
 * Super Roo — Agents Module.
 *
 * Contains specialized agents that can run in parallel with the main agent.
 */

export { HermesAgent } from "./HermesAgent"
export type { HermesQuestion, HermesResponse } from "./HermesAgent"

export { CoderAgent } from "./CoderAgent"
export type { CoderAgentOptions } from "./CoderAgent"

export { DebuggerAgent } from "./DebuggerAgent"
export type { DebuggerAgentOptions } from "./DebuggerAgent"

export { PmAgent } from "./PmAgent"
export type { PmAgentOptions } from "./PmAgent"

export { SupabaseAgent } from "./SupabaseAgent"
export type { SupabaseAgentOptions } from "./SupabaseAgent"

export { TesterAgent } from "./TesterAgent"
export type { TesterAgentOptions } from "./TesterAgent"

export { SelfHealingAgent } from "./SelfHealingAgent"

export type { RooTaskRunner, RooTaskRequest, RooTaskOutcome, RooTaskEvent, RooTaskEventListener, RooTokenUsage, RooToolUsageSummary } from "./RooTaskAdapter"

export type { TestRunner, TestRequest, TestResult, TestKind } from "./TestRunner"

export type { SupabaseRunner, SupabaseRequest, SupabaseResult, SupabaseAction, SqlIntent } from "./SupabaseRunner"
export { capabilityForSupabaseRequest, inferSqlIntent } from "./SupabaseRunner"