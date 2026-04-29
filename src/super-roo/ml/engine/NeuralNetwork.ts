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
			this.layers.push(new DenseLayer(dims[i], dims[i + 1], isLast ? "xavier" : "he"))

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

	train(X: Tensor, y: Tensor, lossFn: LossFn, cfg: TrainingConfig): number[] {
		const losses: number[] = []
		const opt = new AdamOptimizer(this.allParameters())
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
			if ("setTraining" in layer && typeof (layer as any).setTraining === "function") {
				(layer as any).setTraining(v)
			}
		}
	}

	/** Serialise weights to a plain JSON-friendly structure. */
	serialise(): number[][][] {
		return this.layers.map((layer) =>
			layer.parameters().map((p) => p.tensor.to1D()),
		)
	}

	/** Describe architecture. */
	summary(): string {
		return this.layers.map((l) => l.describe()).join(" → ")
	}
}
