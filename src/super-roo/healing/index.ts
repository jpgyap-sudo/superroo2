/**
 * Super Roo — Healing module.
 *
 * The self-healing architecture provides autonomous incident detection,
 * classification, repair planning, and resolution tracking.
 *
 * Core components:
 *   - HealingBus: Central coordination and incident storage
 *   - SelfHealingLoop: Autonomous healing engine with state machine
 *   - RootCauseClassifier: ML-free pattern-based classification
 *   - RepairPlanBuilder: Generates structured repair plans
 *   - HealingMetrics: Success rate tracking and persistence
 */

export {
	HealingBus,
	makeIncidentFingerprint,
	severityRank,
	type HealingBusConfig,
	type IncidentFilter,
} from "./HealingBus"

export {
	classifyRootCause,
	classifyFromText,
	isSecurityRisk,
	requiresHumanApproval,
	getDiagnosticSteps,
	type ClassificationResult,
	type ClassificationPattern,
} from "./RootCauseClassifier"

export {
	buildRepairPlan,
	severityToPriority,
	summarizeRepairPlan,
	markPlanExecuted,
	markPlanInProgress,
	markPlanCancelled,
	type RepairPlanOptions,
} from "./RepairPlanBuilder"

export {
	SelfHealingLoop,
	type SelfHealingConfig,
	type SelfHealingStats,
	type EscalationPolicy,
	type EscalationAction,
	type IncidentSignature,
	type FailureRecord,
} from "./SelfHealingLoop"

export {
	HealingMetrics,
	type CategoryMetrics,
	type PlanTypeMetrics,
	type MetricsSnapshot,
	type HealingMetricsOptions,
} from "./HealingMetrics"

// Re-export from agents for convenience
export {
	SelfHealingAgent,
	createReportIncidentTask,
	createRunHealingCycleTask,
	type SelfHealingAgentOptions,
} from "../agents/SelfHealingAgent"
