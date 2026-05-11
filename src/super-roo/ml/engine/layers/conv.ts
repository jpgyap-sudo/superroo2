/**
 * Super Roo ML — Convolutional Layers
 *
 * Implements Conv2D, MaxPool2D, and Flatten layers for convolutional neural networks.
 * All layers operate on 2D Tensor objects where:
 *   - rows = batch size (N)
 *   - cols = spatial dims flattened: (C * H * W)
 *
 * For Conv2D, we use an im2col approach internally for efficient matrix multiplication.
 */

import { Tensor } from "../Tensor"
import type { Layer, LayerParameter } from "../Layer"

// ─────────────────────────────────────────────────────────────────────────────
// Utility: im2col — convert image patches to columns for conv via matmul
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract patches from a batch of images and arrange them as columns.
 *
 * Input tensor shape: [N, C * H * W] (flattened 2D)
 * Output tensor shape: [N * OH * OW, C * KH * KW]
 *
 * Where:
 *   OH = floor((H + 2*P - KH) / S) + 1
 *   OW = floor((W + 2*P - KW) / S) + 1
 */
function im2col(
	input: Tensor,
	N: number,
	C: number,
	H: number,
	W: number,
	KH: number,
	KW: number,
	stride: number,
	padding: number,
): { cols: Tensor; OH: number; OW: number } {
	const OH = Math.floor((H + 2 * padding - KH) / stride) + 1
	const OW = Math.floor((W + 2 * padding - KW) / stride) + 1

	const cols = new Tensor(N * OH * OW, C * KH * KW, "zeros")

	for (let n = 0; n < N; n++) {
		for (let oh = 0; oh < OH; oh++) {
			for (let ow = 0; ow < OW; ow++) {
				const rowIdx = n * OH * OW + oh * OW + ow
				for (let c = 0; c < C; c++) {
					for (let kh = 0; kh < KH; kh++) {
						for (let kw = 0; kw < KW; kw++) {
							const ih = oh * stride + kh - padding
							const iw = ow * stride + kw - padding
							if (ih >= 0 && ih < H && iw >= 0 && iw < W) {
								const colIdx = c * KH * KW + kh * KW + kw
								const val = input.get(n, c * H * W + ih * W + iw)
								cols.set(rowIdx, colIdx, val)
							}
							// else: stays 0 (zero-padding)
						}
					}
				}
			}
		}
	}

	return { cols, OH, OW }
}

/**
 * Reverse of im2col — distributes column gradients back to the input.
 */
function col2im(
	colGrad: Tensor,
	N: number,
	C: number,
	H: number,
	W: number,
	KH: number,
	KW: number,
	stride: number,
	padding: number,
	OH: number,
	OW: number,
): Tensor {
	const dInput = new Tensor(N, C * H * W, "zeros")

	for (let n = 0; n < N; n++) {
		for (let oh = 0; oh < OH; oh++) {
			for (let ow = 0; ow < OW; ow++) {
				const rowIdx = n * OH * OW + oh * OW + ow
				for (let c = 0; c < C; c++) {
					for (let kh = 0; kh < KH; kh++) {
						for (let kw = 0; kw < KW; kw++) {
							const ih = oh * stride + kh - padding
							const iw = ow * stride + kw - padding
							if (ih >= 0 && ih < H && iw >= 0 && iw < W) {
								const colIdx = c * KH * KW + kh * KW + kw
								const gradVal = colGrad.get(rowIdx, colIdx)
								const outIdx = c * H * W + ih * W + iw
								dInput.set(n, outIdx, dInput.get(n, outIdx) + gradVal)
							}
						}
					}
				}
			}
		}
	}

	return dInput
}

// ─────────────────────────────────────────────────────────────────────────────
// Conv2D Layer
// ─────────────────────────────────────────────────────────────────────────────

export interface Conv2DConfig {
	/** Number of input channels. */
	inChannels: number
	/** Number of output channels (filters). */
	outChannels: number
	/** Height of the convolution kernel. */
	kernelHeight: number
	/** Width of the convolution kernel. */
	kernelWidth: number
	/** Input height (spatial). */
	inputHeight: number
	/** Input width (spatial). */
	inputWidth: number
	/** Stride of the convolution. Default: 1. */
	stride?: number
	/** Zero-padding. Default: 0. */
	padding?: number
}

export class Conv2D implements Layer {
	readonly weights: Tensor
	readonly biases: Tensor
	readonly weightGrad: Tensor
	readonly biasGrad: Tensor

	private readonly inChannels: number
	private readonly outChannels: number
	private readonly kernelHeight: number
	private readonly kernelWidth: number
	private readonly inputHeight: number
	private readonly inputWidth: number
	private readonly stride: number
	private readonly padding: number

	// Cache for backward pass
	private inputCache: Tensor | null = null
	private colCache: Tensor | null = null
	private ohCache = 0
	private owCache = 0
	private nCache = 0

	constructor(config: Conv2DConfig) {
		this.inChannels = config.inChannels
		this.outChannels = config.outChannels
		this.kernelHeight = config.kernelHeight
		this.kernelWidth = config.kernelWidth
		this.inputHeight = config.inputHeight
		this.inputWidth = config.inputWidth
		this.stride = config.stride ?? 1
		this.padding = config.padding ?? 0

		// Weights: [outChannels, inChannels * KH * KW]
		const weightSize = this.inChannels * this.kernelHeight * this.kernelWidth
		this.weights = new Tensor(this.outChannels, weightSize, "he")
		this.biases = new Tensor(1, this.outChannels, "zeros")
		this.weightGrad = new Tensor(this.outChannels, weightSize, "zeros")
		this.biasGrad = new Tensor(1, this.outChannels, "zeros")
	}

	forward(input: Tensor): Tensor {
		// Input shape: [N, C * H * W]
		const N = input.rows
		const C = this.inChannels
		const H = this.inputHeight
		const W = this.inputWidth

		// Validate input dimensions
		if (input.cols !== C * H * W) {
			throw new Error(
				`Conv2D forward: expected input.cols = ${C * H * W} (C=${C}, H=${H}, W=${W}), got ${input.cols}`,
			)
		}

		this.inputCache = input.clone()
		this.nCache = N

		// im2col: [N * OH * OW, C * KH * KW]
		const { cols, OH, OW } = im2col(
			input,
			N,
			C,
			H,
			W,
			this.kernelHeight,
			this.kernelWidth,
			this.stride,
			this.padding,
		)
		this.colCache = cols
		this.ohCache = OH
		this.owCache = OW

		// Output = cols @ W^T + bias
		// cols: [N*OH*OW, C*KH*KW], W: [outCh, C*KH*KW]
		// result: [N*OH*OW, outCh]
		const out = cols.matmul(this.weights.transpose()).add(this.biases)

		// Reshape to [N, outCh * OH * OW]
		const reshaped = new Tensor(N, this.outChannels * OH * OW, "zeros")
		for (let n = 0; n < N; n++) {
			for (let oh = 0; oh < OH; oh++) {
				for (let ow = 0; ow < OW; ow++) {
					for (let oc = 0; oc < this.outChannels; oc++) {
						const srcRow = n * OH * OW + oh * OW + ow
						const val = out.get(srcRow, oc)
						reshaped.set(n, oc * OH * OW + oh * OW + ow, val)
					}
				}
			}
		}

		return reshaped
	}

	backward(outputGrad: Tensor): Tensor {
		if (!this.inputCache || !this.colCache) {
			throw new Error("Conv2D backward called before forward")
		}

		const N = this.nCache
		const OH = this.ohCache
		const OW = this.owCache
		const C = this.inChannels
		const H = this.inputHeight
		const W = this.inputWidth
		const KH = this.kernelHeight
		const KW = this.kernelWidth

		// Reshape outputGrad from [N, outCh * OH * OW] to [N*OH*OW, outCh]
		const dOut = new Tensor(N * OH * OW, this.outChannels, "zeros")
		for (let n = 0; n < N; n++) {
			for (let oh = 0; oh < OH; oh++) {
				for (let ow = 0; ow < OW; ow++) {
					for (let oc = 0; oc < this.outChannels; oc++) {
						const srcRow = n * OH * OW + oh * OW + ow
						const val = outputGrad.get(n, oc * OH * OW + oh * OW + ow)
						dOut.set(srcRow, oc, val)
					}
				}
			}
		}

		// dW = dOut^T @ cols
		// dOut: [N*OH*OW, outCh], cols: [N*OH*OW, C*KH*KW]
		// dW: [outCh, C*KH*KW]
		const dW = dOut.transpose().matmul(this.colCache)
		this.weightGrad.addInPlace(dW)

		// db = sum(dOut, axis=0)
		const db = dOut.sum(0)
		this.biasGrad.addInPlace(db)

		// dInput = dOut @ W  (then col2im)
		// dOut: [N*OH*OW, outCh], W: [outCh, C*KH*KW]
		// dCol: [N*OH*OW, C*KH*KW]
		const dCol = dOut.matmul(this.weights)

		const dInput = col2im(dCol, N, C, H, W, KH, KW, this.stride, this.padding, OH, OW)

		return dInput
	}

	parameters(): LayerParameter[] {
		return [
			{ tensor: this.weights, grad: this.weightGrad, name: "W" },
			{ tensor: this.biases, grad: this.biasGrad, name: "b" },
		]
	}

	describe(): string {
		return `Conv2D(${this.inChannels}→${this.outChannels}, ${this.kernelHeight}×${this.kernelWidth}, s=${this.stride}, p=${this.padding})`
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// MaxPool2D Layer
// ─────────────────────────────────────────────────────────────────────────────

export interface MaxPool2DConfig {
	/** Pooling window height. */
	poolHeight: number
	/** Pooling window width. */
	poolWidth: number
	/** Stride. Default: poolHeight (non-overlapping). */
	stride?: number
	/** Input height. */
	inputHeight: number
	/** Input width. */
	inputWidth: number
	/** Number of input channels. */
	channels: number
}

export class MaxPool2D implements Layer {
	private readonly poolHeight: number
	private readonly poolWidth: number
	private readonly stride: number
	private readonly inputHeight: number
	private readonly inputWidth: number
	private readonly channels: number

	// Cache for backward pass
	private inputCache: Tensor | null = null
	private maxIdxCache: number[] | null = null
	private ohCache = 0
	private owCache = 0

	constructor(config: MaxPool2DConfig) {
		this.poolHeight = config.poolHeight
		this.poolWidth = config.poolWidth
		this.stride = config.stride ?? config.poolHeight
		this.inputHeight = config.inputHeight
		this.inputWidth = config.inputWidth
		this.channels = config.channels
	}

	forward(input: Tensor): Tensor {
		const N = input.rows
		const C = this.channels
		const H = this.inputHeight
		const W = this.inputWidth
		const PH = this.poolHeight
		const PW = this.poolWidth
		const S = this.stride

		if (input.cols !== C * H * W) {
			throw new Error(`MaxPool2D forward: expected input.cols = ${C * H * W}, got ${input.cols}`)
		}

		const OH = Math.floor((H - PH) / S) + 1
		const OW = Math.floor((W - PW) / S) + 1

		this.inputCache = input.clone()
		this.ohCache = OH
		this.owCache = OW

		const out = new Tensor(N, C * OH * OW, "zeros")
		const maxIdx: number[] = []

		for (let n = 0; n < N; n++) {
			for (let c = 0; c < C; c++) {
				for (let oh = 0; oh < OH; oh++) {
					for (let ow = 0; ow < OW; ow++) {
						let maxVal = -Infinity
						let maxPos = 0
						for (let ph = 0; ph < PH; ph++) {
							for (let pw = 0; pw < PW; pw++) {
								const ih = oh * S + ph
								const iw = ow * S + pw
								const idx = c * H * W + ih * W + iw
								const val = input.get(n, idx)
								if (val > maxVal) {
									maxVal = val
									maxPos = idx
								}
							}
						}
						const outIdx = c * OH * OW + oh * OW + ow
						out.set(n, outIdx, maxVal)
						maxIdx.push(maxPos)
					}
				}
			}
		}

		this.maxIdxCache = maxIdx
		return out
	}

	backward(outputGrad: Tensor): Tensor {
		if (!this.inputCache || !this.maxIdxCache) {
			throw new Error("MaxPool2D backward called before forward")
		}

		const N = this.inputCache.rows
		const C = this.channels
		const H = this.inputHeight
		const W = this.inputWidth
		const OH = this.ohCache
		const OW = this.owCache

		const dInput = new Tensor(N, C * H * W, "zeros")

		let idx = 0
		for (let n = 0; n < N; n++) {
			for (let c = 0; c < C; c++) {
				for (let oh = 0; oh < OH; oh++) {
					for (let ow = 0; ow < OW; ow++) {
						const maxPos = this.maxIdxCache[idx]
						const outIdx = c * OH * OW + oh * OW + ow
						dInput.set(n, maxPos, dInput.get(n, maxPos) + outputGrad.get(n, outIdx))
						idx++
					}
				}
			}
		}

		return dInput
	}

	parameters(): LayerParameter[] {
		return []
	}

	describe(): string {
		return `MaxPool2D(${this.poolHeight}×${this.poolWidth}, s=${this.stride})`
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Flatten Layer — converts 2D feature maps to 1D vectors
// ─────────────────────────────────────────────────────────────────────────────

export interface FlattenConfig {
	/** Number of channels. */
	channels: number
	/** Height of each channel. */
	height: number
	/** Width of each channel. */
	width: number
}

export class Flatten implements Layer {
	private readonly channels: number
	private readonly height: number
	private readonly width: number
	private inputShape: { rows: number; cols: number } | null = null

	constructor(config: FlattenConfig) {
		this.channels = config.channels
		this.height = config.height
		this.width = config.width
	}

	forward(input: Tensor): Tensor {
		this.inputShape = { rows: input.rows, cols: input.cols }
		const expectedCols = this.channels * this.height * this.width
		if (input.cols !== expectedCols) {
			throw new Error(
				`Flatten forward: expected input.cols = ${expectedCols} (C=${this.channels}, H=${this.height}, W=${this.width}), got ${input.cols}`,
			)
		}
		// Already flat — just return a clone
		return input.clone()
	}

	backward(outputGrad: Tensor): Tensor {
		if (!this.inputShape) {
			throw new Error("Flatten backward called before forward")
		}
		// Gradient passes through unchanged
		return outputGrad.clone()
	}

	parameters(): LayerParameter[] {
		return []
	}

	describe(): string {
		return `Flatten(${this.channels}×${this.height}×${this.width})`
	}
}
