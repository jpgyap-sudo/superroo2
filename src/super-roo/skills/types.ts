/**
 * Super Roo — Skill Optimization Types
 *
 * Standardized I/O types for the ReflACT-inspired skill optimization pipeline.
 * Ported from SkillOpt's `skillopt/types.py` with SuperRoo-specific adaptations.
 *
 * Core concept: Skill documents are treated as trainable parameters.
 * The pipeline iteratively improves skill markdown through:
 *   Rollout → Reflect → Aggregate → Select → Update → Evaluate
 */

// ─────────────────────────────────────────────────────────────────────────────
// Edit — a single atomic change to a skill document
// ─────────────────────────────────────────────────────────────────────────────

export interface Edit {
	/** Type of edit: "replace", "insert", "delete" */
	op: "replace" | "insert" | "delete"
	/** The exact string to find (for replace/delete) or insertion point */
	search: string
	/** The replacement text (for replace/insert) */
	replace: string
	/** Optional line number hint for ordering */
	line?: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Patch — a set of edits with reasoning
// ─────────────────────────────────────────────────────────────────────────────

export interface Patch {
	/** Human-readable reasoning for this patch */
	reasoning: string
	/** Ordered list of edits */
	edits: Edit[]
	/** Source type: "error_analyst" | "success_analyst" | "merge" | "slow_update" */
	sourceType: string
	/** How many rollouts support this patch */
	supportCount: number
	/** Unique identifier for deduplication */
	id?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// RolloutResult — result of a single episode/task rollout
// ─────────────────────────────────────────────────────────────────────────────

export interface RolloutResult {
	/** Unique task/episode identifier */
	taskId: string
	/** Whether the rollout succeeded */
	success: boolean
	/** The skill content used for this rollout */
	skillContent: string
	/** Full trajectory log (conversation, actions, observations) */
	trajectory: string
	/** Error message if failed */
	error?: string
	/** Quality score 0-1 if available */
	quality?: number
	/** Execution time in ms */
	durationMs: number
	/** Task type for bucketing */
	taskType?: string
	/** Arbitrary metadata */
	metadata?: Record<string, unknown>
}

// ─────────────────────────────────────────────────────────────────────────────
// FailureSummaryEntry — structured failure analysis
// ─────────────────────────────────────────────────────────────────────────────

export interface FailureSummaryEntry {
	/** Short failure description */
	summary: string
	/** Root cause category */
	category: string
	/** Suggested fix description */
	suggestion: string
	/** Confidence in this analysis 0-1 */
	confidence: number
}

// ─────────────────────────────────────────────────────────────────────────────
// RawPatch — analyst output from the Reflect stage
// ─────────────────────────────────────────────────────────────────────────────

export interface RawPatch {
	/** Failure summary entries (for error analysts) */
	failureSummary?: FailureSummaryEntry[]
	/** Edits to apply to the skill */
	edits?: Edit[]
	/** Full rewrite suggestions (alternative to edits) */
	reviseSuggestions?: string[]
	/** Source type */
	sourceType: string
	/** Whether this patch is from a success or error analyst */
	isSuccess: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// SlowUpdateResult — epoch-level strategic guidance
// ─────────────────────────────────────────────────────────────────────────────

export interface SlowUpdateResult {
	/** Strategic guidance content for the slow update field */
	strategicGuidance: string
	/** Reasoning behind the guidance */
	reasoning: string
	/** Confidence 0-1 */
	confidence: number
	/** Comparison statistics */
	stats?: {
		improved: number
		regressed: number
		persistentFail: number
		stableSuccess: number
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// GateResult — validation gate decision
// ─────────────────────────────────────────────────────────────────────────────

export type GateAction = "accept_new_best" | "accept" | "reject"

export interface GateResult {
	action: GateAction
	/** Score of the candidate skill */
	candidateScore: number
	/** Score of the current best skill */
	bestScore: number
	/** Score of the previous skill */
	previousScore: number
	/** Reasoning for the decision */
	reasoning: string
}

// ─────────────────────────────────────────────────────────────────────────────
// MetaSkill — optimizer-side memory
// ─────────────────────────────────────────────────────────────────────────────

export interface MetaSkill {
	/** The meta skill content (optimizer strategies) */
	content: string
	/** Epoch this meta skill was generated */
	epoch: number
	/** Reasoning behind the meta skill */
	reasoning: string
}

// ─────────────────────────────────────────────────────────────────────────────
// SkillDocument — a skill with metadata
// ─────────────────────────────────────────────────────────────────────────────

export interface SkillDocument {
	/** Unique skill identifier */
	id: string
	/** Skill name */
	name: string
	/** Full markdown content */
	content: string
	/** Version number (incremented on each update) */
	version: number
	/** Current quality score 0-1 */
	score: number
	/** Best score ever achieved */
	bestScore: number
	/** Epoch last updated */
	lastUpdatedEpoch: number
	/** Tags for categorization */
	tags: string[]
	/** Creation timestamp */
	createdAt: number
	/** Last update timestamp */
	updatedAt: number
}

// ─────────────────────────────────────────────────────────────────────────────
// SkillTrainingConfig — configuration for the training loop
// ─────────────────────────────────────────────────────────────────────────────

export interface SkillTrainingConfig {
	/** Skill document to optimize */
	skill: SkillDocument
	/** Number of epochs to train */
	epochs: number
	/** Rollouts per step */
	rolloutsPerStep: number
	/** Minibatch size for trajectory analysis */
	minibatchSize: number
	/** Max edits per step (edit budget / learning rate) */
	maxEditsPerStep: number
	/** Min edits per step */
	minEditsPerStep: number
	/** Scheduler type: "constant" | "linear" | "cosine" | "autonomous" */
	schedulerType: string
	/** Validation split ratio (0-1) */
	validationSplit: number
	/** Whether to use slow update */
	useSlowUpdate: boolean
	/** Slow update interval in epochs */
	slowUpdateInterval: number
	/** Whether to use meta skill */
	useMetaSkill: boolean
	/** Model backend for optimizer calls */
	optimizerBackend: string
	/** Model backend for target rollouts */
	targetBackend: string
	/** Output directory for artifacts */
	outputDir?: string
	/** Resume from last checkpoint */
	resume?: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// TrainingStepResult — result of one training step
// ─────────────────────────────────────────────────────────────────────────────

export interface TrainingStepResult {
	step: number
	epoch: number
	/** The updated skill content after this step */
	skillContent: string
	/** Number of edits applied */
	editsApplied: number
	/** Gate decision */
	gateResult: GateResult
	/** Rollout results for this step */
	rollouts: RolloutResult[]
	/** Number of successful rollouts */
	successCount: number
	/** Number of failed rollouts */
	failCount: number
	/** Average quality score */
	avgQuality: number
	/** Duration of this step in ms */
	durationMs: number
}

// ─────────────────────────────────────────────────────────────────────────────
// TrainingSummary — final summary of a training run
// ─────────────────────────────────────────────────────────────────────────────

export interface TrainingSummary {
	skillId: string
	skillName: string
	epochsCompleted: number
	stepsCompleted: number
	initialScore: number
	finalScore: number
	bestScore: number
	totalEditsApplied: number
	totalRollouts: number
	successRate: number
	avgStepDurationMs: number
	totalDurationMs: number
	gateHistory: GateResult[]
	metaSkillEpochs: number[]
	slowUpdateEpochs: number[]
}

// ─────────────────────────────────────────────────────────────────────────────
// ComparisonPair — structured per-sample comparison for slow update
// ─────────────────────────────────────────────────────────────────────────────

export interface ComparisonPair {
	taskId: string
	category: "improved" | "regressed" | "persistent_fail" | "stable_success"
	previousTrajectory: string
	currentTrajectory: string
	previousScore: number
	currentScore: number
}

// ─────────────────────────────────────────────────────────────────────────────
// UpdateMode — how to apply updates to a skill
// ─────────────────────────────────────────────────────────────────────────────

export type UpdateMode = "patch" | "rewrite_from_suggestions"

// ─────────────────────────────────────────────────────────────────────────────
// LRControlMode — how the edit budget is determined
// ─────────────────────────────────────────────────────────────────────────────

export type LRControlMode = "scheduler" | "autonomous"
