/**
 * Super Roo ML — Loss Functions
 *
 * Cross-entropy and MSE loss with automatic gradient computation.
 */

import { Tensor } from "./Tensor"

export interface LossFn {
	/** Compute loss and return gradient w.r.t. predictions. */
	forward(pred: Tensor, target: Tensor): { loss: number; grad: Tensor }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cross-entropy (for classification)
// ─────────────────────────────────────────────────────────────────────────────

export class CrossEntropyLoss implements LossFn {
	forward(pred: Tensor, target: Tensor): { loss: number; grad: Tensor } {
		if (pred.rows !== target.rows || pred.cols !== target.cols) {
			throw new Error("Shape mismatch in CrossEntropyLoss")
		}
		let totalLoss = 0
		const grad = new Tensor(pred.rows, pred.cols, "zeros")
		const rowNorm = 1 / pred.rows
		for (let i = 0; i < pred.rows; i++) {
			for (let j = 0; j < pred.cols; j++) {
				const p = Math.max(pred.get(i, j), 1e-8)
				const t = target.get(i, j)
				totalLoss -= t * Math.log(p)
				grad.set(i, j, t === 0 ? 0 : (-t / p) * rowNorm)
			}
		}
		return { loss: totalLoss / pred.rows, grad }
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Mean Squared Error (for regression)
// ─────────────────────────────────────────────────────────────────────────────

export class MSELoss implements LossFn {
	forward(pred: Tensor, target: Tensor): { loss: number; grad: Tensor } {
		if (pred.rows !== target.rows || pred.cols !== target.cols) {
			throw new Error("Shape mismatch in MSELoss")
		}
		let totalLoss = 0
		const grad = new Tensor(pred.rows, pred.cols, "zeros")
		const n = pred.rows * pred.cols
		for (let i = 0; i < pred.rows; i++) {
			for (let j = 0; j < pred.cols; j++) {
				const diff = pred.get(i, j) - target.get(i, j)
				totalLoss += diff * diff
				grad.set(i, j, (2 * diff) / n)
			}
		}
		return { loss: totalLoss / n, grad }
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Huber Loss — combines MSE and MAE, robust to outliers
// ─────────────────────────────────────────────────────────────────────────────

export class HuberLoss implements LossFn {
	private readonly delta: number

	constructor(delta = 1.0) {
		this.delta = delta
	}

	forward(pred: Tensor, target: Tensor): { loss: number; grad: Tensor } {
		if (pred.rows !== target.rows || pred.cols !== target.cols) {
			throw new Error("Shape mismatch in HuberLoss")
		}
		let totalLoss = 0
		const grad = new Tensor(pred.rows, pred.cols, "zeros")
		const n = pred.rows * pred.cols

		for (let i = 0; i < pred.rows; i++) {
			for (let j = 0; j < pred.cols; j++) {
				const diff = pred.get(i, j) - target.get(i, j)
				const absDiff = Math.abs(diff)
				if (absDiff <= this.delta) {
					// MSE region: 0.5 * diff^2
					totalLoss += 0.5 * diff * diff
					grad.set(i, j, diff / n)
				} else {
					// MAE region: delta * (|diff| - 0.5 * delta)
					totalLoss += this.delta * (absDiff - 0.5 * this.delta)
					grad.set(i, j, (this.delta * Math.sign(diff)) / n)
				}
			}
		}

		return { loss: totalLoss / n, grad }
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Hinge Loss — for SVM-style classification (targets should be -1 or 1)
// ─────────────────────────────────────────────────────────────────────────────

export class HingeLoss implements LossFn {
	forward(pred: Tensor, target: Tensor): { loss: number; grad: Tensor } {
		if (pred.rows !== target.rows || pred.cols !== target.cols) {
			throw new Error("Shape mismatch in HingeLoss")
		}
		let totalLoss = 0
		const grad = new Tensor(pred.rows, pred.cols, "zeros")
		const n = pred.rows * pred.cols

		for (let i = 0; i < pred.rows; i++) {
			for (let j = 0; j < pred.cols; j++) {
				const p = pred.get(i, j)
				const t = target.get(i, j)
				const margin = 1 - t * p
				const lossVal = Math.max(0, margin)
				totalLoss += lossVal
				// Gradient: -t if margin > 0, else 0
				grad.set(i, j, margin > 0 ? -t / n : 0)
			}
		}

		return { loss: totalLoss / n, grad }
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Binary Cross-Entropy (for binary classification)
// ─────────────────────────────────────────────────────────────────────────────

export class BCELoss implements LossFn {
	forward(pred: Tensor, target: Tensor): { loss: number; grad: Tensor } {
		if (pred.rows !== target.rows || pred.cols !== target.cols) {
			throw new Error("Shape mismatch in BCELoss")
		}
		let totalLoss = 0
		const grad = new Tensor(pred.rows, pred.cols, "zeros")
		const n = pred.rows * pred.cols
		for (let i = 0; i < pred.rows; i++) {
			for (let j = 0; j < pred.cols; j++) {
				const p = Math.min(Math.max(pred.get(i, j), 1e-8), 1 - 1e-8)
				const t = target.get(i, j)
				totalLoss -= t * Math.log(p) + (1 - t) * Math.log(1 - p)
				grad.set(i, j, (p - t) / n)
			}
		}
		return { loss: totalLoss / n, grad }
	}
}
