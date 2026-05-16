/**
 * Super Roo ML — Learning Rate Schedulers
 *
 * Provides learning rate scheduling strategies that can be attached
 * to optimizers (SGD, Adam) to adjust the learning rate during training.
 */

// ─────────────────────────────────────────────────────────────────────────────
// LRScheduler base class
// ─────────────────────────────────────────────────────────────────────────────

export interface LRScheduler {
	/** Get the learning rate for the given epoch. */
	getLearningRate(epoch: number): number
	/** Reset scheduler state (e.g., for a new training run). */
	reset(): void
}

// ─────────────────────────────────────────────────────────────────────────────
// Step Decay — drops LR by factor every N epochs
// ─────────────────────────────────────────────────────────────────────────────

export interface StepDecayConfig {
	initialLR: number
	/** Factor to multiply LR by at each drop. Default: 0.1 */
	dropFactor?: number
	/** Number of epochs between drops. Default: 10 */
	stepSize?: number
	/** Minimum LR floor. Default: 1e-8 */
	minLR?: number
}

export class StepDecayScheduler implements LRScheduler {
	private readonly initialLR: number
	private readonly dropFactor: number
	private readonly stepSize: number
	private readonly minLR: number

	constructor(config: StepDecayConfig) {
		this.initialLR = config.initialLR
		this.dropFactor = config.dropFactor ?? 0.1
		this.stepSize = config.stepSize ?? 10
		this.minLR = config.minLR ?? 1e-8
	}

	getLearningRate(epoch: number): number {
		const factor = Math.pow(this.dropFactor, Math.floor(epoch / this.stepSize))
		return Math.max(this.initialLR * factor, this.minLR)
	}

	reset(): void {
		// No mutable state to reset
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Exponential Decay — LR = initial * decayRate^epoch
// ─────────────────────────────────────────────────────────────────────────────

export interface ExponentialDecayConfig {
	initialLR: number
	/** Decay rate applied each epoch. Default: 0.95 */
	decayRate?: number
	/** Minimum LR floor. Default: 1e-8 */
	minLR?: number
}

export class ExponentialDecayScheduler implements LRScheduler {
	private readonly initialLR: number
	private readonly decayRate: number
	private readonly minLR: number

	constructor(config: ExponentialDecayConfig) {
		this.initialLR = config.initialLR
		this.decayRate = config.decayRate ?? 0.95
		this.minLR = config.minLR ?? 1e-8
	}

	getLearningRate(epoch: number): number {
		return Math.max(this.initialLR * Math.pow(this.decayRate, epoch), this.minLR)
	}

	reset(): void {
		// No mutable state to reset
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// ReduceLROnPlateau — reduces LR when loss stops improving
// ─────────────────────────────────────────────────────────────────────────────

export interface ReduceLROnPlateauConfig {
	initialLR: number
	/** Factor to multiply LR by when reducing. Default: 0.1 */
	factor?: number
	/** Number of epochs with no improvement before reducing. Default: 5 */
	patience?: number
	/** Minimum change in loss to qualify as improvement. Default: 1e-4 */
	threshold?: number
	/** Minimum LR floor. Default: 1e-8 */
	minLR?: number
	/** Cooldown epochs after a reduction before resuming normal operation. Default: 0 */
	cooldown?: number
}

export class ReduceLROnPlateau implements LRScheduler {
	private readonly initialLR: number
	private readonly factor: number
	private readonly patience: number
	private readonly threshold: number
	private readonly minLR: number
	private readonly cooldown: number

	private bestLoss: number | null = null
	private epochsSinceImprovement = 0
	private cooldownRemaining = 0
	private currentLR: number

	constructor(config: ReduceLROnPlateauConfig) {
		this.initialLR = config.initialLR
		this.factor = config.factor ?? 0.1
		this.patience = config.patience ?? 5
		this.threshold = config.threshold ?? 1e-4
		this.minLR = config.minLR ?? 1e-8
		this.cooldown = config.cooldown ?? 0
		this.currentLR = config.initialLR
	}

	getLearningRate(epoch: number): number {
		// This returns the current LR; call onPlateauEnd after each epoch
		return this.currentLR
	}

	/**
	 * Call after each validation epoch with the current loss.
	 * Returns the new (possibly reduced) learning rate.
	 */
	onPlateauEnd(loss: number): number {
		if (this.cooldownRemaining > 0) {
			this.cooldownRemaining--
			return this.currentLR
		}

		if (this.bestLoss === null) {
			this.bestLoss = loss
			this.epochsSinceImprovement = 0
			return this.currentLR
		}

		const improvement = this.bestLoss - loss
		if (improvement > this.threshold) {
			// Loss improved
			this.bestLoss = loss
			this.epochsSinceImprovement = 0
		} else {
			// No significant improvement
			this.epochsSinceImprovement++
			if (this.epochsSinceImprovement >= this.patience) {
				const newLR = Math.max(this.currentLR * this.factor, this.minLR)
				if (newLR < this.currentLR) {
					this.currentLR = newLR
					this.epochsSinceImprovement = 0
					this.cooldownRemaining = this.cooldown
				}
			}
		}

		return this.currentLR
	}

	reset(): void {
		this.bestLoss = null
		this.epochsSinceImprovement = 0
		this.cooldownRemaining = 0
		this.currentLR = this.initialLR
	}
}
