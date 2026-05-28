/**
 * Super Roo — Skill Optimization Module
 *
 * ReflACT-inspired skill optimization pipeline.
 * Treats skill documents as trainable parameters.
 *
 * Pipeline: Rollout → Reflect → Aggregate → Select (Clip) → Update → Evaluate
 *
 * Exports all public types, classes, and functions.
 */

// Types
export type {
	Edit,
	Patch,
	RolloutResult,
	FailureSummaryEntry,
	RawPatch,
	SlowUpdateResult,
	GateResult,
	GateAction,
	MetaSkill,
	SkillDocument,
	SkillTrainingConfig,
	TrainingStepResult,
	TrainingSummary,
	ComparisonPair,
	UpdateMode,
	LRControlMode,
} from "./types"

// Edit Budget Scheduler (Learning Rate)
export {
	SkillLRScheduler,
	ConstantSkillLR,
	LinearSkillLR,
	CosineSkillLR,
	AutonomousSkillLR,
	buildSkillLRScheduler,
	type SkillLRType,
	type AutonomousContext,
} from "./SkillLRScheduler"

// Validation Gate
export { evaluateGate, applyGateResult, type GateConfig } from "./Gate"

// Skill Edit Operations
export {
	isInSlowUpdateRegion,
	stripSlowUpdateMarkers,
	injectEmptySlowUpdateField,
	extractSlowUpdateField,
	stripAllSlowUpdateFields,
	replaceSlowUpdateField,
	applyEditWithReport,
	applyEdit,
	applyPatchWithReport,
	applyPatch,
} from "./SkillEditOps"

// Reflect Stage
export {
	formatTrajectory,
	formatMinibatchTrajectories,
	shuffleForMinibatch,
	groupIntoMinibatches,
	runErrorAnalystMinibatch,
	runSuccessAnalystMinibatch,
	runMinibatchReflect,
	type ReflectConfig,
	type ReflectResult,
	type AnalystFn,
	type AnalystContext,
} from "./Reflect"

// Aggregate Stage
export {
	rawPatchToPatch,
	sortPatchesByPriority,
	deduplicatePatches,
	mergeBatch,
	hierarchicalMerge,
	runAggregate,
	type AggregateConfig,
	type AggregateResult,
	type MergeFn,
	type MergeContext,
} from "./Aggregate"

// Clip Stage
export {
	truncateEdits,
	rankAndSelect,
	runClip,
	type ClipConfig,
	type ClipResult,
	type RankingFn,
	type RankingContext,
} from "./Clip"

// Rewrite Stage
export { rewriteSkillFromSuggestions, type RewriteConfig, type RewriteContext, type RewriteFn } from "./Rewrite"

// Slow Update
export {
	buildComparisonPairs,
	filterComparisonPairs,
	pairCategoryCounts,
	formatComparisonText,
	serializeComparisonPairs,
	runSlowUpdate,
	type SlowUpdateConfig,
	type SlowUpdateContext,
	type SlowUpdateFn,
} from "./SlowUpdate"

// Meta Skill
export {
	formatMetaSkillContext,
	runMetaSkill,
	type MetaSkillConfig,
	type MetaSkillContext,
	type MetaSkillFn,
} from "./MetaSkill"

// SkillTrainer (main training loop)
export { SkillTrainer, type RolloutFn, type EvalFn, type ScoreFn } from "./SkillTrainer"
