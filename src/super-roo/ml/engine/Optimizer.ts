/**
 * Super Roo ML — Optimizers
 *
 * Adam and SGD optimizers for training the neural network.
 * Supports optional learning rate schedulers.
 */

import { Tensor } from "./Tensor"
import type { LRScheduler } from "./LRScheduler"

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
		private readonly lrScheduler?: LRScheduler,
	) {}

	step(lr: number): void {
		this.t++
		// Apply LR scheduler if present
		const effectiveLR = this.lrScheduler ? this.lrScheduler.getLearningRate(this.t - 1) : lr
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
				w.data[i] -= (effectiveLR * mHat) / (Math.sqrt(vHat) + this.eps)
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
	private t = 0

	constructor(
		private readonly params: { tensor: Tensor; grad: Tensor; name: string }[],
		private readonly momentum = 0.9,
		private readonly lrScheduler?: LRScheduler,
	) {}

	step(lr: number): void {
		// Apply LR scheduler if present
		const effectiveLR = this.lrScheduler ? this.lrScheduler.getLearningRate(this.t) : lr
		this.t++
		for (const p of this.params) {
			const { tensor: w, grad: g } = p
			if (!this.velocity.has(w)) {
				this.velocity.set(w, new Tensor(w.rows, w.cols, "zeros"))
			}
			const v = this.velocity.get(w)!
			for (let i = 0; i < w.data.length; i++) {
				v.data[i] = this.momentum * v.data[i] + g.data[i]
				w.data[i] -= effectiveLR * v.data[i]
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
// Optimizer state serialisation helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Serializable snapshot of an optimizer's internal state. */
export interface OptimizerState {
	type: "sgd" | "adam"
	t: number
	/** Per-parameter momentum / velocity buffers (serialised as 1D arrays). */
	buffers: Record<string, { m?: number[]; v?: number[] }>
}

/**
 * Capture the current state of an SGD optimizer for checkpointing.
 */
export function captureSGDOptimizerState(opt: SGDOptimizer): OptimizerState {
	const buffers: Record<string, { m?: number[]; v?: number[] }> = {}
	for (const [key, vel] of (opt as any).velocity.entries()) {
		buffers[(key as any).name ?? "param"] = { v: Array.from(vel.data) }
	}
	return { type: "sgd", t: (opt as any).t ?? 0, buffers }
}

/**
 * Capture the current state of an Adam optimizer for checkpointing.
 */
export function captureAdamOptimizerState(opt: AdamOptimizer): OptimizerState {
	const buffers: Record<string, { m?: number[]; v?: number[] }> = {}
	const mMap = (opt as any).m as Map<Tensor, Tensor>
	const vMap = (opt as any).v as Map<Tensor, Tensor>
	for (const [key, m] of mMap.entries()) {
		const v = vMap.get(key)
		buffers[(key as any).name ?? "param"] = {
			m: Array.from(m.data),
			v: v ? Array.from(v.data) : undefined,
		}
	}
	return { type: "adam", t: (opt as any).t ?? 0, buffers }
}

/**
 * Restore optimizer state from a snapshot.
 */
export function restoreOptimizerState(opt: Optimizer, state: OptimizerState): void {
	if (opt instanceof SGDOptimizer && state.type === "sgd") {
		;(opt as any).t = state.t
		const velMap = (opt as any).velocity as Map<Tensor, Tensor>
		let idx = 0
		for (const [, vel] of velMap.entries()) {
			const buf = state.buffers[`param${idx}`] ?? state.buffers[`param`]
			if (buf?.v) {
				vel.data.set(Float64Array.from(buf.v))
			}
			idx++
		}
	} else if (opt instanceof AdamOptimizer && state.type === "adam") {
		;(opt as any).t = state.t
		const mMap = (opt as any).m as Map<Tensor, Tensor>
		const vMap = (opt as any).v as Map<Tensor, Tensor>
		let idx = 0
		for (const [key] of mMap.entries()) {
			const buf = state.buffers[`param${idx}`] ?? state.buffers[`param`]
			if (buf?.m) {
				mMap.get(key)!.data.set(Float64Array.from(buf.m))
			}
			if (buf?.v) {
				vMap.get(key)!.data.set(Float64Array.from(buf.v))
			}
			idx++
		}
	}
}
