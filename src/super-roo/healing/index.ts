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
 */

export { HealingBus, makeIncidentFingerprint, severityRank, type HealingBusConfig, type IncidentFilter } from "./HealingBus"

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
	type RepairPlanOptions,
} from "./RepairPlanBuilder"

export {
	SelfHealingLoop,
	type SelfHealingConfig,
	type SelfHealingStats,
} from "./SelfHealingLoop"

// Re-export from agents for convenience
export {
	SelfHealingAgent,
	createReportIncidentTask,
	createRunHealingCycleTask,
	type SelfHealingAgentOptions,
} from "../agents/SelfHealingAgent"
