/**
 * Super Roo ML — Neural Network Layers
 *
 * Implements forward/backward passes for common deep-learning layers.
 * All layers operate on Tensor objects.
 */

import { Tensor } from "./Tensor"

export type LayerParameter = { tensor: Tensor; grad: Tensor; name: string }

export interface Layer {
	/** Forward pass: input → output */
	forward(input: Tensor): Tensor
	/** Backward pass: outputGrad → inputGrad. Must be called after forward. */
	backward(outputGrad: Tensor): Tensor
	/** Return list of parameter tensors (weights, biases) for the optimizer. */
	parameters(): LayerParameter[]
	/** Human-readable description. */
	describe(): string
}

// ─────────────────────────────────────────────────────────────────────────────
// Dense (fully-connected) layer
// ─────────────────────────────────────────────────────────────────────────────

export class DenseLayer implements Layer {
	readonly weights: Tensor
	readonly biases: Tensor
	readonly weightGrad: Tensor
	readonly biasGrad: Tensor
	private inputCache: Tensor | null = null

	constructor(
		readonly inFeatures: number,
		readonly outFeatures: number,
		readonly init: "xavier" | "he" = "xavier",
	) {
		this.weights = new Tensor(inFeatures, outFeatures, init)
		this.biases = new Tensor(1, outFeatures, "zeros")
		this.weightGrad = new Tensor(inFeatures, outFeatures, "zeros")
		this.biasGrad = new Tensor(1, outFeatures, "zeros")
	}

	forward(input: Tensor): Tensor {
		this.inputCache = input.clone()
		const out = input.matmul(this.weights).add(this.biases)
		return out
	}

	backward(outputGrad: Tensor): Tensor {
		if (!this.inputCache) throw new Error("backward called before forward")
		const input = this.inputCache
		// dW = input^T · outputGrad
		const dW = input.transpose().matmul(outputGrad)
		// db = sum(outputGrad, axis=0)
		const db = outputGrad.sum(0)
		// dInput = outputGrad · W^T
		const dInput = outputGrad.matmul(this.weights.transpose())

		this.weightGrad.addInPlace(dW)
		this.biasGrad.addInPlace(db)
		return dInput
	}

	parameters(): LayerParameter[] {
		return [
			{ tensor: this.weights, grad: this.weightGrad, name: "W" },
			{ tensor: this.biases, grad: this.biasGrad, name: "b" },
		]
	}

	describe(): string {
		return `Dense(${this.inFeatures} → ${this.outFeatures})`
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Activation layers
// ─────────────────────────────────────────────────────────────────────────────

export class ReLULayer implements Layer {
	private maskCache: Tensor | null = null

	forward(input: Tensor): Tensor {
		const out = new Tensor(input.rows, input.cols, "zeros")
		this.maskCache = new Tensor(input.rows, input.cols, "zeros")
		for (let i = 0; i < input.data.length; i++) {
			const v = input.data[i]
			out.data[i] = v > 0 ? v : 0
			this.maskCache.data[i] = v > 0 ? 1 : 0
		}
		return out
	}

	backward(outputGrad: Tensor): Tensor {
		if (!this.maskCache) throw new Error("backward called before forward")
		const out = new Tensor(outputGrad.rows, outputGrad.cols, "zeros")
		for (let i = 0; i < outputGrad.data.length; i++) {
			out.data[i] = outputGrad.data[i] * this.maskCache.data[i]
		}
		return out
	}

	parameters(): LayerParameter[] {
		return []
	}

	describe(): string {
		return "ReLU"
	}
}

export class SigmoidLayer implements Layer {
	private outputCache: Tensor | null = null

	forward(input: Tensor): Tensor {
		const out = new Tensor(input.rows, input.cols, "zeros")
		for (let i = 0; i < input.data.length; i++) {
			out.data[i] = 1 / (1 + Math.exp(-input.data[i]))
		}
		this.outputCache = out.clone()
		return out
	}

	backward(outputGrad: Tensor): Tensor {
		if (!this.outputCache) throw new Error("backward called before forward")
		const out = new Tensor(outputGrad.rows, outputGrad.cols, "zeros")
		for (let i = 0; i < outputGrad.data.length; i++) {
			const s = this.outputCache.data[i]
			out.data[i] = outputGrad.data[i] * s * (1 - s)
		}
		return out
	}

	parameters(): LayerParameter[] {
		return []
	}

	describe(): string {
		return "Sigmoid"
	}
}

export class TanhLayer implements Layer {
	private outputCache: Tensor | null = null

	forward(input: Tensor): Tensor {
		const out = new Tensor(input.rows, input.cols, "zeros")
		for (let i = 0; i < input.data.length; i++) {
			out.data[i] = Math.tanh(input.data[i])
		}
		this.outputCache = out.clone()
		return out
	}

	backward(outputGrad: Tensor): Tensor {
		if (!this.outputCache) throw new Error("backward called before forward")
		const out = new Tensor(outputGrad.rows, outputGrad.cols, "zeros")
		for (let i = 0; i < outputGrad.data.length; i++) {
			const t = this.outputCache.data[i]
			out.data[i] = outputGrad.data[i] * (1 - t * t)
		}
		return out
	}

	parameters(): LayerParameter[] {
		return []
	}

	describe(): string {
		return "Tanh"
	}
}

export class SoftmaxLayer implements Layer {
	private outputCache: Tensor | null = null

	forward(input: Tensor): Tensor {
		const out = new Tensor(input.rows, input.cols, "zeros")
		for (let i = 0; i < input.rows; i++) {
			// subtract max for numerical stability
			let maxVal = -Infinity
			for (let j = 0; j < input.cols; j++) {
				const v = input.get(i, j)
				if (v > maxVal) maxVal = v
			}
			let sum = 0
			for (let j = 0; j < input.cols; j++) {
				const e = Math.exp(input.get(i, j) - maxVal)
				out.set(i, j, e)
				sum += e
			}
			for (let j = 0; j < input.cols; j++) {
				out.set(i, j, out.get(i, j) / sum)
			}
		}
		this.outputCache = out.clone()
		return out
	}

	backward(outputGrad: Tensor): Tensor {
		if (!this.outputCache) throw new Error("backward called before forward")
		const out = new Tensor(outputGrad.rows, outputGrad.cols, "zeros")
		for (let i = 0; i < outputGrad.rows; i++) {
			for (let j = 0; j < outputGrad.cols; j++) {
				let sum = 0
				for (let k = 0; k < outputGrad.cols; k++) {
					const sJ = this.outputCache.get(i, j)
					const sK = this.outputCache.get(i, k)
					const delta = j === k ? 1 : 0
					sum += outputGrad.get(i, k) * sJ * (delta - sK)
				}
				out.set(i, j, sum)
			}
		}
		return out
	}

	parameters(): LayerParameter[] {
		return []
	}

	describe(): string {
		return "Softmax"
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Dropout (training-time regularisation)
// ─────────────────────────────────────────────────────────────────────────────

export class DropoutLayer implements Layer {
	private maskCache: Tensor | null = null
	private training = true
	private currentRate: number

	constructor(private readonly rate: number = 0.5) {
		if (rate < 0 || rate >= 1) throw new Error("Dropout rate must be in [0, 1)")
		this.currentRate = rate
	}

	setTraining(v: boolean) {
		this.training = v
	}

	/**
	 * Dynamically update the dropout rate at runtime.
	 * Useful for scheduling (e.g., annealing dropout during training).
	 */
	setRate(newRate: number): void {
		if (newRate < 0 || newRate >= 1) throw new Error("Dropout rate must be in [0, 1)")
		this.currentRate = newRate
	}

	/** Get the current dropout rate. */
	getRate(): number {
		return this.currentRate
	}

	/** Reset the dropout rate back to the initial constructor value. */
	resetRate(): void {
		this.currentRate = this.rate
	}

	forward(input: Tensor): Tensor {
		if (!this.training) return input
		const out = new Tensor(input.rows, input.cols, "zeros")
		this.maskCache = new Tensor(input.rows, input.cols, "zeros")
		const scale = 1 / (1 - this.currentRate)
		for (let i = 0; i < input.data.length; i++) {
			const keep = Math.random() >= this.currentRate ? 1 : 0
			this.maskCache.data[i] = keep
			out.data[i] = input.data[i] * keep * scale
		}
		return out
	}

	backward(outputGrad: Tensor): Tensor {
		if (!this.maskCache) throw new Error("backward called before forward")
		const out = new Tensor(outputGrad.rows, outputGrad.cols, "zeros")
		const scale = 1 / (1 - this.currentRate)
		for (let i = 0; i < outputGrad.data.length; i++) {
			out.data[i] = outputGrad.data[i] * this.maskCache.data[i] * scale
		}
		return out
	}

	parameters(): LayerParameter[] {
		return []
	}

	describe(): string {
		return `Dropout(p=${this.currentRate})`
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Batch Normalisation
// ─────────────────────────────────────────────────────────────────────────────

export class BatchNormLayer implements Layer {
	readonly gamma: Tensor
	readonly beta: Tensor
	readonly gammaGrad: Tensor
	readonly betaGrad: Tensor
	private inputCache: Tensor | null = null
	private meanCache: Tensor | null = null
	private varCache: Tensor | null = null
	private normCache: Tensor | null = null
	private training = true

	// Running statistics for inference
	private runningMean: Tensor
	private runningVar: Tensor
	private momentum = 0.9
	private eps = 1e-5

	constructor(
		readonly features: number,
		readonly affine = true,
	) {
		this.gamma = new Tensor(1, features, "ones")
		this.beta = new Tensor(1, features, "zeros")
		this.gammaGrad = new Tensor(1, features, "zeros")
		this.betaGrad = new Tensor(1, features, "zeros")
		this.runningMean = new Tensor(1, features, "zeros")
		this.runningVar = new Tensor(1, features, "ones")
	}

	setTraining(v: boolean) {
		this.training = v
	}

	forward(input: Tensor): Tensor {
		this.inputCache = input.clone()
		const mean = this.training ? input.mean(0) : this.runningMean
		const variance = this.training ? input.sub(mean).pow(2).mean(0) : this.runningVar
		this.meanCache = mean.clone()
		this.varCache = variance.clone()

		const std = variance.add(this.eps).sqrt()
		const norm = input.sub(mean).div(std)
		this.normCache = norm.clone()

		if (this.training) {
			this.runningMean = this.runningMean.mul(this.momentum).add(mean.mul(1 - this.momentum))
			this.runningVar = this.runningVar.mul(this.momentum).add(variance.mul(1 - this.momentum))
		}

		if (this.affine) {
			return norm.mul(this.gamma).add(this.beta)
		}
		return norm
	}

	backward(outputGrad: Tensor): Tensor {
		if (!this.inputCache || !this.meanCache || !this.varCache || !this.normCache) {
			throw new Error("backward called before forward")
		}
		const N = this.inputCache.rows
		const std = this.varCache.add(this.eps).sqrt()

		if (this.affine) {
			this.gammaGrad.addInPlace(outputGrad.mul(this.normCache).sum(0))
			this.betaGrad.addInPlace(outputGrad.sum(0))
		}

		const dNorm = this.affine ? outputGrad.mul(this.gamma) : outputGrad
		const dVar = dNorm
			.mul(this.inputCache.sub(this.meanCache))
			.mul(-0.5)
			.mul(this.varCache.add(this.eps).pow(-1.5))
			.sum(0)
		const dMean = dNorm
			.mul(-1)
			.div(std)
			.sum(0)
			.add(
				dVar
					.mul(this.inputCache.sub(this.meanCache))
					.mul(-2 / N)
					.sum(0),
			)

		const dInput = dNorm
			.div(std)
			.add(this.inputCache.sub(this.meanCache).mul(dVar.mul(2 / N)))
			.add(dMean.div(N))

		return dInput
	}

	parameters(): LayerParameter[] {
		if (!this.affine) return []
		return [
			{ tensor: this.gamma, grad: this.gammaGrad, name: "gamma" },
			{ tensor: this.beta, grad: this.betaGrad, name: "beta" },
			{ tensor: this.runningMean, grad: new Tensor(1, this.features, "zeros"), name: "runningMean" },
			{ tensor: this.runningVar, grad: new Tensor(1, this.features, "zeros"), name: "runningVar" },
		]
	}

	describe(): string {
		return `BatchNorm(${this.features})`
	}
}
