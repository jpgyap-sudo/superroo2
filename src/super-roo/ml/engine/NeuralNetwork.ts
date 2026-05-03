/**
 * Super Roo ML — NeuralNetwork
 *
 * A sequential deep neural network builder. Supports arbitrary layer stacks,
 * training loops, inference, and serialisation for persistence.
 */

import {
	DenseLayer,
	ReLULayer,
	TanhLayer,
	SigmoidLayer,
	SoftmaxLayer,
	DropoutLayer,
	BatchNormLayer,
	type Layer,
} from "./Layer"
import type { LossFn } from "./Loss"
import { AdamOptimizer } from "./Optimizer"
import { Tensor } from "./Tensor"

interface TrainableLayer {
	setTraining(v: boolean): void
}

function isTrainable(l: unknown): l is TrainableLayer {
	return typeof (l as TrainableLayer).setTraining === "function"
}

export interface NeuralNetworkConfig {
	inputDim: number
	outputDim: number
	/** Hidden layer sizes, e.g. [128, 64, 32] */
	hiddenDims?: number[]
	/** Activation between hidden layers. Default: "relu". */
	activation?: "relu" | "tanh" | "sigmoid"
	/** Final activation. Default: "softmax" for classification. */
	finalActivation?: "softmax" | "sigmoid" | "none"
	/** Dropout rate between hidden layers. 0 = disabled. */
	dropout?: number
	/** Use batch norm after each hidden layer. */
	useBatchNorm?: boolean
}

export interface TrainingConfig {
	epochs: number
	batchSize: number
	learningRate: number
	/** Optional validation data for early stopping. */
	validationSplit?: number
	/** Callback after each epoch: (epoch, trainLoss, valLoss?) => shouldStop */
	onEpoch?: (epoch: number, trainLoss: number, valLoss?: number) => boolean
}

export class NeuralNetwork {
	private layers: Layer[] = []
	private config: NeuralNetworkConfig
	private optimizer: AdamOptimizer | null = null

	constructor(config: NeuralNetworkConfig) {
		this.config = config
		this.buildLayers()
	}

	private buildLayers() {
		const dims = [this.config.inputDim, ...(this.config.hiddenDims ?? []), this.config.outputDim]
		const act = this.config.activation ?? "relu"
		const finalAct = this.config.finalActivation ?? "softmax"
		const dropout = this.config.dropout ?? 0
		const useBN = this.config.useBatchNorm ?? false

		for (let i = 0; i < dims.length - 1; i++) {
			const isLast = i === dims.length - 2
			const dense = new DenseLayer(dims[i], dims[i + 1], isLast ? "xavier" : "he")
			if (!isLast && act === "relu") {
				dense.biases.data.fill(0.01)
			}
			this.layers.push(dense)

			if (useBN && !isLast) {
				this.layers.push(new BatchNormLayer(dims[i + 1]))
			}

			if (!isLast) {
				switch (act) {
					case "relu":
						this.layers.push(new ReLULayer())
						break
					case "tanh":
						this.layers.push(new TanhLayer())
						break
					case "sigmoid":
						this.layers.push(new SigmoidLayer())
						break
				}
				if (dropout > 0) {
					this.layers.push(new DropoutLayer(dropout))
				}
			} else {
				switch (finalAct) {
					case "softmax":
						this.layers.push(new SoftmaxLayer())
						break
					case "sigmoid":
						this.layers.push(new SigmoidLayer())
						break
				}
			}
		}
	}

	predict(input: Tensor): Tensor {
		this.setTraining(false)
		let out = input
		for (const layer of this.layers) {
			out = layer.forward(out)
		}
		return out
	}

	/** Forward pass with training mode enabled (affects dropout, batch norm). */
	forwardTraining(input: Tensor): Tensor {
		this.setTraining(true)
		let out = input
		for (const layer of this.layers) {
			out = layer.forward(out)
		}
		return out
	}

	/** Backward pass. Must be called after forwardTraining. Returns gradient w.r.t. input. */
	backward(outputGrad: Tensor): Tensor {
		let dOut = outputGrad
		for (let li = this.layers.length - 1; li >= 0; li--) {
			dOut = this.layers[li].backward(dOut)
		}
		return dOut
	}

	/** Optimizer step. Creates optimizer lazily if needed. */
	step(learningRate: number): void {
		this.optimizer ??= new AdamOptimizer(this.allParameters())
		this.optimizer.step(learningRate)
	}

	/** Zero all parameter gradients. */
	zeroGrad(): void {
		this.optimizer ??= new AdamOptimizer(this.allParameters())
		this.optimizer.zeroGrad()
	}

	/** Restore weights from serialised format. */
	deserialise(weights: number[][][]): void {
		for (let i = 0; i < this.layers.length; i++) {
			const layerParams = this.layers[i].parameters()
			const layerWeights = weights[i]
			if (!layerWeights || layerParams.length !== layerWeights.length) {
				throw new Error(
					`Layer ${i} parameter count mismatch: expected ${layerParams.length}, got ${layerWeights?.length ?? 0}`,
				)
			}
			for (let j = 0; j < layerParams.length; j++) {
				const p = layerParams[j]
				const w = layerWeights[j]
				if (w.length !== p.tensor.data.length) {
					throw new Error(
						`Shape mismatch deserialising layer ${i} param ${j}: expected ${p.tensor.data.length}, got ${w.length}`,
					)
				}
				p.tensor.data.set(Float64Array.from(w))
			}
		}
	}

	train(X: Tensor, y: Tensor, lossFn: LossFn, cfg: TrainingConfig): number[] {
		const losses: number[] = []
		this.optimizer ??= new AdamOptimizer(this.allParameters())
		const opt = this.optimizer
		const N = X.rows
		const valSplit = Math.floor(N * (cfg.validationSplit ?? 0))
		const trainN = N - valSplit

		for (let epoch = 0; epoch < cfg.epochs; epoch++) {
			this.setTraining(true)
			let epochLoss = 0
			let batches = 0

			for (let i = 0; i < trainN; i += cfg.batchSize) {
				const end = Math.min(i + cfg.batchSize, trainN)
				const xBatch = X.sliceRows(i, end)
				const yBatch = y.sliceRows(i, end)

				// Forward
				let out = xBatch
				for (const layer of this.layers) {
					out = layer.forward(out)
				}

				// Loss + backward
				const { loss, grad } = lossFn.forward(out, yBatch)
				epochLoss += loss
				batches++

				let dOut = grad
				for (let li = this.layers.length - 1; li >= 0; li--) {
					dOut = this.layers[li].backward(dOut)
				}

				opt.step(cfg.learningRate)
				opt.zeroGrad()
			}

			const avgLoss = epochLoss / Math.max(batches, 1)
			losses.push(avgLoss)

			// Validation
			let valLoss: number | undefined
			if (valSplit > 0) {
				const xVal = X.sliceRows(trainN, N)
				const yVal = y.sliceRows(trainN, N)
				const pred = this.predict(xVal)
				valLoss = lossFn.forward(pred, yVal).loss
			}

			if (cfg.onEpoch?.(epoch, avgLoss, valLoss)) break
		}

		return losses
	}

	private allParameters(): { tensor: Tensor; grad: Tensor; name: string }[] {
		const params: { tensor: Tensor; grad: Tensor; name: string }[] = []
		for (const layer of this.layers) {
			params.push(...layer.parameters())
		}
		return params
	}

	private setTraining(v: boolean) {
		for (const layer of this.layers) {
			if (isTrainable(layer)) {
				layer.setTraining(v)
			}
		}
	}

	/** Serialise weights to a plain JSON-friendly structure. */
	serialise(): number[][][] {
		return this.layers.map((layer) => layer.parameters().map((p) => p.tensor.to1D()))
	}

	/** Describe architecture. */
	summary(): string {
		return this.layers.map((l) => l.describe()).join(" → ")
	}
}
