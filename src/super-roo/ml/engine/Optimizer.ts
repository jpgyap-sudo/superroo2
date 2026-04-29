/**
 * Super Roo ML — Optimizers
 *
 * Adam and SGD optimizers for training the neural network.
 */

import { Tensor } from "./Tensor"

export interface Optimizer {
	step(lr: number): void
	zeroGrad(): void
}

// ─────────────────────────────────────────────────────────────────────────────
// Adam (Adaptive Moment Estimation)
// ─────────────────────────────────────────────────────────────────────────────

export class AdamOptimizer implements Optimizer {
	private m: Map<Tensor, Tensor> = new Map()
	private v: Map<Tensor, Tensor> = new Map()
	private t = 0

	constructor(
		private readonly params: { tensor: Tensor; grad: Tensor; name: string }[],
		private readonly beta1 = 0.9,
		private readonly beta2 = 0.999,
		private readonly eps = 1e-8,
	) {}

	step(lr: number): void {
		this.t++
		const biasCorr1 = 1 - Math.pow(this.beta1, this.t)
		const biasCorr2 = 1 - Math.pow(this.beta2, this.t)

		for (const p of this.params) {
			const { tensor: w, grad: g } = p
			if (!this.m.has(w)) {
				this.m.set(w, new Tensor(w.rows, w.cols, "zeros"))
				this.v.set(w, new Tensor(w.rows, w.cols, "zeros"))
			}
			const m = this.m.get(w)!
			const v = this.v.get(w)!

			for (let i = 0; i < w.data.length; i++) {
				// m = beta1*m + (1-beta1)*g
				m.data[i] = this.beta1 * m.data[i] + (1 - this.beta1) * g.data[i]
				// v = beta2*v + (1-beta2)*g^2
				v.data[i] = this.beta2 * v.data[i] + (1 - this.beta2) * g.data[i] * g.data[i]
				// w = w - lr * m_hat / (sqrt(v_hat) + eps)
				const mHat = m.data[i] / biasCorr1
				const vHat = v.data[i] / biasCorr2
				w.data[i] -= (lr * mHat) / (Math.sqrt(vHat) + this.eps)
			}
		}
	}

	zeroGrad(): void {
		for (const p of this.params) {
			p.grad.data.fill(0)
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// SGD with momentum
// ─────────────────────────────────────────────────────────────────────────────

export class SGDOptimizer implements Optimizer {
	private velocity: Map<Tensor, Tensor> = new Map()

	constructor(
		private readonly params: { tensor: Tensor; grad: Tensor; name: string }[],
		private readonly momentum = 0.9,
	) {}

	step(lr: number): void {
		for (const p of this.params) {
			const { tensor: w, grad: g } = p
			if (!this.velocity.has(w)) {
				this.velocity.set(w, new Tensor(w.rows, w.cols, "zeros"))
			}
			const v = this.velocity.get(w)!
			for (let i = 0; i < w.data.length; i++) {
				v.data[i] = this.momentum * v.data[i] + g.data[i]
				w.data[i] -= lr * v.data[i]
			}
		}
	}

	zeroGrad(): void {
		for (const p of this.params) {
			p.grad.data.fill(0)
		}
	}
}
