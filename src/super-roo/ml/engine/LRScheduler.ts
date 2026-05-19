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

// ─────────────────────────────────────────────────────────────────────────────
// Cosine Annealing — smooth cosine decay with optional warm restarts
// ─────────────────────────────────────────────────────────────────────────────

export interface CosineAnnealingConfig {
	initialLR: number
	/** Number of epochs for one full cosine cycle. Default: 50 */
	T_max?: number
	/** Minimum LR floor. Default: 1e-8 */
	minLR?: number
	/** Number of warm restarts (0 = no restarts). Default: 0 */
	restarts?: number
	/** Multiplicative factor for T_max after each restart. Default: 1 */
	T_mult?: number
}

export class CosineAnnealingScheduler implements LRScheduler {
	private readonly initialLR: number
	private readonly T_max: number
	private readonly minLR: number
	private readonly restarts: number
	private readonly T_mult: number
	private currentRestart = 0
	private epochOffset = 0

	constructor(config: CosineAnnealingConfig) {
		this.initialLR = config.initialLR
		this.T_max = config.T_max ?? 50
		this.minLR = config.minLR ?? 1e-8
		this.restarts = config.restarts ?? 0
		this.T_mult = config.T_mult ?? 1
	}

	getLearningRate(epoch: number): number {
		const localEpoch = epoch - this.epochOffset
		const T_cur = Math.min(localEpoch, this.T_max)
		const cos = Math.cos((Math.PI * T_cur) / this.T_max)
		const lr = this.minLR + 0.5 * (this.initialLR - this.minLR) * (1 + cos)

		// Handle warm restarts
		if (this.restarts > 0 && localEpoch >= this.T_max && this.currentRestart < this.restarts) {
			this.currentRestart++
			this.epochOffset = epoch
			return this.initialLR // Reset to initial LR after restart
		}

		return Math.max(lr, this.minLR)
	}

	reset(): void {
		this.currentRestart = 0
		this.epochOffset = 0
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Dropout Scheduler — anneals dropout rate during training
// ─────────────────────────────────────────────────────────────────────────────

export interface DropoutSchedulerConfig {
	/** Initial dropout rate. Default: 0.5 */
	initialRate: number
	/** Final dropout rate after annealing. Default: 0.1 */
	finalRate: number
	/** Number of epochs over which to anneal. Default: 100 */
	totalEpochs: number
	/** Annealing strategy: "linear" | "exponential" | "cosine". Default: "linear" */
	mode?: "linear" | "exponential" | "cosine"
}

export class DropoutScheduler {
	private readonly initialRate: number
	private readonly finalRate: number
	private readonly totalEpochs: number
	private readonly mode: "linear" | "exponential" | "cosine"

	constructor(config: DropoutSchedulerConfig) {
		this.initialRate = config.initialRate
		this.finalRate = config.finalRate
		this.totalEpochs = config.totalEpochs
		this.mode = config.mode ?? "linear"
	}

	/** Get the dropout rate for the given epoch. */
	getRate(epoch: number): number {
		const t = Math.min(epoch / this.totalEpochs, 1)
		switch (this.mode) {
			case "linear":
				return this.initialRate + (this.finalRate - this.initialRate) * t
			case "exponential":
				return this.initialRate * Math.pow(this.finalRate / this.initialRate, t)
			case "cosine": {
				const cos = Math.cos((Math.PI * t) / 2)
				return this.finalRate + (this.initialRate - this.finalRate) * cos
			}
			default:
				return this.initialRate + (this.finalRate - this.initialRate) * t
		}
	}

	reset(): void {
		// No mutable state
	}
}
