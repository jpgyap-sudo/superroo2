/**
 * Super Roo — Skill Edit Budget Scheduler
 *
 * Ported from SkillOpt's `skillopt/optimizer/scheduler.py`.
 *
 * The "learning rate" in ReflACT is the maximum number of edits allowed
 * per training step. This module provides schedulers that control how
 * the edit budget changes over the course of training.
 *
 * Scheduler types:
 *   - constant:   Fixed budget throughout training
 *   - linear:     Linear decay from maxEdits to minEdits
 *   - cosine:     Cosine annealing from maxEdits to minEdits
 *   - autonomous: LLM decides the budget based on rollout evidence
 */

// ─────────────────────────────────────────────────────────────────────────────
// Abstract base
// ─────────────────────────────────────────────────────────────────────────────

export abstract class SkillLRScheduler {
	protected currentStep = 0
	protected readonly maxEdits: number
	protected readonly minEdits: number
	protected readonly totalSteps: number

	constructor(maxEdits: number, minEdits: number, totalSteps: number) {
		if (maxEdits < 1) throw new Error("maxEdits must be >= 1")
		if (minEdits < 1) throw new Error("minEdits must be >= 1")
		if (minEdits > maxEdits) throw new Error("minEdits must be <= maxEdits")
		if (totalSteps < 1) throw new Error("totalSteps must be >= 1")
		this.maxEdits = maxEdits
		this.minEdits = minEdits
		this.totalSteps = totalSteps
	}

	/** Advance one step and return the edit budget for this step. */
	step(): number {
		const budget = this._computeBudget(this.currentStep)
		this.currentStep++
		return Math.max(this.minEdits, Math.min(this.maxEdits, Math.round(budget)))
	}

	/** Get the current budget without advancing. */
	peek(): number {
		return Math.max(this.minEdits, Math.min(this.maxEdits, Math.round(this._computeBudget(this.currentStep))))
	}

	/** Reset scheduler state. */
	reset(): void {
		this.currentStep = 0
	}

	/** Subclass must implement budget computation. */
	protected abstract _computeBudget(step: number): number
}

// ─────────────────────────────────────────────────────────────────────────────
// Constant — fixed budget throughout training
// ─────────────────────────────────────────────────────────────────────────────

export class ConstantSkillLR extends SkillLRScheduler {
	protected _computeBudget(_step: number): number {
		return this.maxEdits
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Linear — linear decay from maxEdits to minEdits
// ─────────────────────────────────────────────────────────────────────────────

export class LinearSkillLR extends SkillLRScheduler {
	protected _computeBudget(step: number): number {
		// Use (totalSteps - 1) so the last step (step === totalSteps - 1) reaches minEdits exactly
		const denom = this.totalSteps > 1 ? this.totalSteps - 1 : 1
		const progress = Math.min(step / denom, 1)
		return this.maxEdits - (this.maxEdits - this.minEdits) * progress
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Cosine — cosine annealing from maxEdits to minEdits
// ─────────────────────────────────────────────────────────────────────────────

export class CosineSkillLR extends SkillLRScheduler {
	protected _computeBudget(step: number): number {
		// Use (totalSteps - 1) so the last step (step === totalSteps - 1) reaches minEdits exactly
		const denom = this.totalSteps > 1 ? this.totalSteps - 1 : 1
		const progress = Math.min(step / denom, 1)
		const cos = Math.cos((Math.PI * progress) / 2)
		return this.minEdits + (this.maxEdits - this.minEdits) * cos
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Autonomous — LLM decides the budget (delegates to external decision)
// ─────────────────────────────────────────────────────────────────────────────

export class AutonomousSkillLR extends SkillLRScheduler {
	private lastDecision: number | null = null

	constructor(
		maxEdits: number,
		minEdits: number,
		totalSteps: number,
		private readonly decisionFn: (context: AutonomousContext) => Promise<number>,
	) {
		super(maxEdits, minEdits, totalSteps)
	}

	protected _computeBudget(_step: number): number {
		// Return last decision or default to maxEdits
		return this.lastDecision ?? this.maxEdits
	}

	/** Called externally with rollout evidence to set the budget. */
	async decide(context: AutonomousContext): Promise<number> {
		const decision = await this.decisionFn(context)
		this.lastDecision = Math.max(this.minEdits, Math.min(this.maxEdits, Math.round(decision)))
		return this.lastDecision
	}

	override reset(): void {
		super.reset()
		this.lastDecision = null
	}
}

export interface AutonomousContext {
	step: number
	epoch: number
	recentSuccessRate: number
	recentAvgQuality: number
	rolloutCount: number
	failurePatterns: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

export type SkillLRType = "constant" | "linear" | "cosine" | "autonomous"

type SchedulerCtor = new (...args: any[]) => SkillLRScheduler

const REGISTRY: Record<string, SchedulerCtor> = {
	constant: ConstantSkillLR,
	linear: LinearSkillLR,
	cosine: CosineSkillLR,
	autonomous: AutonomousSkillLR,
}

export function buildSkillLRScheduler(
	type: SkillLRType,
	maxEdits: number,
	minEdits: number,
	totalSteps: number,
	...args: unknown[]
): SkillLRScheduler {
	const Ctor = REGISTRY[type]
	if (!Ctor) {
		throw new Error(`Unknown scheduler type: "${type}". Valid: ${Object.keys(REGISTRY).join(", ")}`)
	}
	return new Ctor(maxEdits, minEdits, totalSteps, ...args)
}
