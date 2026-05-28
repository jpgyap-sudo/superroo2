/**
 * Super Roo — SkillTrainer (ReflACT Training Loop)
 *
 * Ported from SkillOpt's `skillopt/engine/trainer.py`.
 *
 * The SkillTrainer orchestrates the full ReflACT-inspired training loop:
 *
 *   Rollout → Reflect → Aggregate → Select (Clip) → Update → Evaluate
 *
 * At each step:
 *   1. ROLLOUT:   Run the skill on multiple tasks, collect trajectories
 *   2. REFLECT:   Group trajectories into minibatches, analyze with LLM
 *   3. AGGREGATE: Merge patches from all minibatches hierarchically
 *   4. SELECT:    Rank edits by importance, keep top-L (edit budget)
 *   5. UPDATE:    Apply selected edits to the skill document
 *   6. EVALUATE:  Run validation rollouts, compute gate decision
 *
 * At epoch boundaries:
 *   - SLOW UPDATE: Update protected sections with strategic guidance
 *   - META SKILL:  Update optimizer-side memory
 *
 * The edit budget (learning rate) is controlled by a scheduler.
 */

import type {
	SkillDocument,
	SkillTrainingConfig,
	TrainingStepResult,
	TrainingSummary,
	RolloutResult,
	Patch,
	Edit,
	GateResult,
	SlowUpdateResult,
	MetaSkill,
} from "./types"

import { buildSkillLRScheduler, type SkillLRScheduler, type AutonomousContext } from "./SkillLRScheduler"
import { evaluateGate, applyGateResult } from "./Gate"
import {
	applyPatchWithReport,
	injectEmptySlowUpdateField,
	replaceSlowUpdateField,
	extractSlowUpdateField,
} from "./SkillEditOps"
import { runMinibatchReflect, type ReflectConfig, type AnalystFn } from "./Reflect"
import { runAggregate, type AggregateConfig, type MergeFn } from "./Aggregate"
import { runClip, type ClipConfig, type RankingFn } from "./Clip"
import { runSlowUpdate, type SlowUpdateConfig, type SlowUpdateFn } from "./SlowUpdate"
import { runMetaSkill, type MetaSkillConfig, type MetaSkillFn } from "./MetaSkill"

// ─────────────────────────────────────────────────────────────────────────────
// External function types (injected dependencies)
// ─────────────────────────────────────────────────────────────────────────────

/** Function that runs a rollout for a given skill and task. */
export type RolloutFn = (skillContent: string, taskId: string) => Promise<RolloutResult>

/** Function that evaluates a skill on validation tasks. */
export type EvalFn = (skillContent: string, taskIds: string[]) => Promise<RolloutResult[]>

/** Function that computes a quality score from rollout results. */
export type ScoreFn = (rollouts: RolloutResult[]) => number

// ─────────────────────────────────────────────────────────────────────────────
// SkillTrainer
// ─────────────────────────────────────────────────────────────────────────────

export class SkillTrainer {
	private config: SkillTrainingConfig
	private scheduler: SkillLRScheduler
	private skill: SkillDocument
	private history: TrainingStepResult[] = []
	private metaSkill: MetaSkill | null = null
	private previousEpochRollouts: RolloutResult[] = []

	// Injected functions
	private rolloutFn: RolloutFn
	private evalFn: EvalFn
	private scoreFn: ScoreFn
	private errorAnalystFn: AnalystFn
	private successAnalystFn: AnalystFn
	private mergeFn: MergeFn
	private rankingFn: RankingFn
	private slowUpdateFn: SlowUpdateFn
	private metaSkillFn: MetaSkillFn

	constructor(
		config: SkillTrainingConfig,
		deps: {
			rolloutFn: RolloutFn
			evalFn: EvalFn
			scoreFn: ScoreFn
			errorAnalystFn: AnalystFn
			successAnalystFn: AnalystFn
			mergeFn: MergeFn
			rankingFn: RankingFn
			slowUpdateFn: SlowUpdateFn
			metaSkillFn: MetaSkillFn
		},
	) {
		this.config = config
		this.skill = { ...config.skill }
		this.rolloutFn = deps.rolloutFn
		this.evalFn = deps.evalFn
		this.scoreFn = deps.scoreFn
		this.errorAnalystFn = deps.errorAnalystFn
		this.successAnalystFn = deps.successAnalystFn
		this.mergeFn = deps.mergeFn
		this.rankingFn = deps.rankingFn
		this.slowUpdateFn = deps.slowUpdateFn
		this.metaSkillFn = deps.metaSkillFn

		// Ensure skill has slow update field if configured
		if (config.useSlowUpdate) {
			this.skill = {
				...this.skill,
				content: injectEmptySlowUpdateField(this.skill.content),
			}
		}

		const totalSteps = config.epochs * Math.ceil(config.rolloutsPerStep / config.minibatchSize)
		this.scheduler = buildSkillLRScheduler(
			config.schedulerType as any,
			config.maxEditsPerStep,
			config.minEditsPerStep,
			totalSteps,
		)
	}

	// ── Public API ──────────────────────────────────────────────────────────

	/** Get current skill state. */
	getSkill(): SkillDocument {
		return { ...this.skill }
	}

	/** Get training history. */
	getHistory(): TrainingStepResult[] {
		return [...this.history]
	}

	/** Get current meta skill. */
	getMetaSkill(): MetaSkill | null {
		return this.metaSkill ? { ...this.metaSkill } : null
	}

	/** Get scheduler state. */
	getScheduler(): SkillLRScheduler {
		return this.scheduler
	}

	// ── Main training loop ──────────────────────────────────────────────────

	/**
	 * Run the full ReflACT training loop.
	 *
	 * For each epoch:
	 *   For each step:
	 *     1. ROLLOUT: Run skill on training tasks
	 *     2. REFLECT: Analyze trajectories → patches
	 *     3. AGGREGATE: Merge patches into one
	 *     4. SELECT (CLIP): Rank edits, keep top-L
	 *     5. UPDATE: Apply edits to skill
	 *     6. EVALUATE: Validate, compute gate decision
	 *   At epoch boundary:
	 *     - SLOW UPDATE (if configured)
	 *     - META SKILL (if configured)
	 */
	async train(): Promise<TrainingSummary> {
		const startTime = Date.now()
		const summary: TrainingSummary = {
			skillId: this.skill.id,
			skillName: this.skill.name,
			epochsCompleted: 0,
			stepsCompleted: 0,
			initialScore: this.skill.score,
			finalScore: 0,
			bestScore: this.skill.bestScore,
			totalEditsApplied: 0,
			totalRollouts: 0,
			successRate: 0,
			avgStepDurationMs: 0,
			totalDurationMs: 0,
			gateHistory: [],
			metaSkillEpochs: [],
			slowUpdateEpochs: [],
		}

		for (let epoch = 0; epoch < this.config.epochs; epoch++) {
			console.log(`[SkillTrainer] Epoch ${epoch + 1}/${this.config.epochs}`)

			const epochRollouts: RolloutResult[] = []
			const epochStepResults: TrainingStepResult[] = []

			// Generate task IDs for this epoch
			const taskIds = Array.from({ length: this.config.rolloutsPerStep }, (_, i) => `task-${epoch}-${i}`)

			// ── Steps within epoch ──────────────────────────────────────────
			for (let step = 0; step < taskIds.length; step += this.config.minibatchSize) {
				const stepStartTime = Date.now()
				const stepTaskIds = taskIds.slice(step, step + this.config.minibatchSize)

				// 1. ROLLOUT
				const rollouts = await this.runRollouts(this.skill.content, stepTaskIds)
				epochRollouts.push(...rollouts)

				// 2. REFLECT
				const reflectResult = await runMinibatchReflect(
					rollouts,
					this.skill.content,
					this.errorAnalystFn,
					this.successAnalystFn,
					{
						minibatchSize: this.config.minibatchSize,
						maxWorkers: 4,
					},
				)

				// 3. AGGREGATE
				const aggregateResult = await runAggregate(
					reflectResult.errorPatches,
					reflectResult.successPatches,
					this.skill.content,
					this.mergeFn,
				)

				if (!aggregateResult.mergedPatch) {
					console.log(`[SkillTrainer] Step ${step}: No patches to apply, skipping`)
					continue
				}

				// 4. SELECT (CLIP)
				const editBudget = this.scheduler.step()
				const clipResult = await runClip(
					aggregateResult.mergedPatch,
					this.skill.content,
					editBudget,
					this.rankingFn,
				)

				// 5. UPDATE
				const updatePatch: Patch = {
					...aggregateResult.mergedPatch,
					edits: clipResult.selectedEdits,
				}
				const [newContent, editReports] = applyPatchWithReport(this.skill.content, updatePatch)
				const editsApplied = editReports.filter((r) => r.applied).length

				// 6. EVALUATE
				const evalTaskIds = taskIds.slice(
					0,
					Math.max(1, Math.floor(taskIds.length * this.config.validationSplit)),
				)
				const evalResults = await this.evalFn(newContent, evalTaskIds)
				const candidateScore = this.scoreFn(evalResults)

				const gateResult = evaluateGate(candidateScore, this.skill.score, this.skill.bestScore)

				const { newBestScore, accepted } = applyGateResult(gateResult, this.skill.bestScore)

				if (accepted) {
					this.skill = {
						...this.skill,
						content: newContent,
						score: candidateScore,
						bestScore: newBestScore,
						version: this.skill.version + 1,
						lastUpdatedEpoch: epoch,
						updatedAt: Date.now(),
					}
				}

				const stepResult: TrainingStepResult = {
					step,
					epoch,
					skillContent: this.skill.content,
					editsApplied,
					gateResult,
					rollouts,
					successCount: rollouts.filter((r) => r.success).length,
					failCount: rollouts.filter((r) => !r.success).length,
					avgQuality: rollouts.reduce((sum, r) => sum + (r.quality ?? 0), 0) / rollouts.length,
					durationMs: Date.now() - stepStartTime,
				}

				epochStepResults.push(stepResult)
				this.history.push(stepResult)
				summary.stepsCompleted++
				summary.totalEditsApplied += editsApplied
				summary.totalRollouts += rollouts.length
				summary.gateHistory.push(gateResult)

				console.log(
					`[SkillTrainer] Step ${step}: edits=${editsApplied}/${editBudget} ` +
						`score=${candidateScore.toFixed(4)} gate=${gateResult.action} ` +
						`(${Date.now() - stepStartTime}ms)`,
				)
			}

			// ── Epoch boundary: Slow Update ─────────────────────────────────
			if (this.config.useSlowUpdate && epoch > 0 && epoch % this.config.slowUpdateInterval === 0) {
				const slowUpdateResult = await runSlowUpdate(
					this.previousEpochRollouts,
					epochRollouts,
					this.skill.content,
					this.metaSkill?.content ?? "",
					this.slowUpdateFn,
					epoch,
				)

				if (slowUpdateResult) {
					this.skill = {
						...this.skill,
						content: replaceSlowUpdateField(this.skill.content, slowUpdateResult.strategicGuidance),
						updatedAt: Date.now(),
					}
					summary.slowUpdateEpochs.push(epoch)
					console.log(`[SkillTrainer] Slow update applied at epoch ${epoch}`)
				}
			}

			// ── Epoch boundary: Meta Skill ──────────────────────────────────
			if (this.config.useMetaSkill && epoch > 0) {
				const metaSkillResult = await runMetaSkill(
					{
						previousMetaSkill: this.metaSkill?.content ?? "",
						currentSkillContent: this.skill.content,
						previousSkillContent:
							this.previousEpochRollouts.length > 0
								? (this.previousEpochRollouts[0]?.skillContent ?? "")
								: "",
						epochHistory: epochStepResults.map((r) => ({
							step: r.step,
							editsApplied: r.editsApplied,
							gateAction: r.gateResult.action,
							successRate: r.successCount / Math.max(r.successCount + r.failCount, 1),
							avgQuality: r.avgQuality,
						})),
						epoch,
					},
					this.metaSkillFn,
				)

				this.metaSkill = metaSkillResult
				summary.metaSkillEpochs.push(epoch)
				console.log(`[SkillTrainer] Meta skill updated at epoch ${epoch}`)
			}

			// Store rollouts for next epoch's comparison
			this.previousEpochRollouts = epochRollouts
			summary.epochsCompleted++
		}

		// ── Final summary ───────────────────────────────────────────────────
		summary.finalScore = this.skill.score
		summary.totalDurationMs = Date.now() - startTime
		summary.avgStepDurationMs = summary.stepsCompleted > 0 ? summary.totalDurationMs / summary.stepsCompleted : 0
		summary.successRate =
			summary.totalRollouts > 0
				? this.history.reduce((sum, r) => sum + r.successCount, 0) / summary.totalRollouts
				: 0

		console.log(
			`[SkillTrainer] Training complete: ${summary.epochsCompleted} epochs, ` +
				`${summary.stepsCompleted} steps, ` +
				`${summary.initialScore.toFixed(4)} → ${summary.finalScore.toFixed(4)} ` +
				`(best: ${summary.bestScore.toFixed(4)}) ` +
				`in ${summary.totalDurationMs}ms`,
		)

		return summary
	}

	// ── Private helpers ─────────────────────────────────────────────────────

	private async runRollouts(skillContent: string, taskIds: string[]): Promise<RolloutResult[]> {
		return Promise.all(taskIds.map((taskId) => this.rolloutFn(skillContent, taskId)))
	}
}
