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
		for (let i = 0; i < pred.rows; i++) {
			for (let j = 0; j < pred.cols; j++) {
				const p = Math.max(pred.get(i, j), 1e-8)
				const t = target.get(i, j)
				totalLoss -= t * Math.log(p)
				grad.set(i, j, t === 0 ? 0 : -t / p / pred.rows)
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
				totalLoss -= (t * Math.log(p) + (1 - t) * Math.log(1 - p))
				grad.set(i, j, (p - t) / n)
			}
		}
		return { loss: totalLoss / n, grad }
	}
}
