/**
 * Cloud Orchestrator — NeuralNetwork
 *
 * JavaScript port of src/super-roo/ml/engine/NeuralNetwork.ts for the cloud runtime.
 * Provides a sequential deep neural network builder with Tensor ops, layers,
 * optimizers, loss functions, training loop, and serialisation.
 *
 * API surface mirrors the TypeScript original:
 *   - Tensor (1D/2D ops)
 *   - Dense, ReLU, Tanh, Sigmoid, Softmax, Dropout, BatchNorm, Conv2D layers
 *   - Adam, SGD, Momentum optimizers
 *   - MSE, CrossEntropy, BinaryCrossEntropy loss functions
 *   - Sequential model with compile(), fit(), predict(), evaluate()
 */

// ─── Tensor ──────────────────────────────────────────────────────────────────────

class Tensor {
	/**
	 * @param {number[]|number[][]} data - Flat array (1D) or array of arrays (2D).
	 * @param {object} [opts]
	 * @param {boolean} [opts.requiresGrad=false]
	 */
	constructor(data, opts = {}) {
		if (Array.isArray(data) && data.length > 0 && Array.isArray(data[0])) {
			// 2D array
			this._rows = data.length
			this._cols = data[0].length
			this._data = new Float64Array(this._rows * this._cols)
			for (let r = 0; r < this._rows; r++) {
				for (let c = 0; c < this._cols; c++) {
					this._data[r * this._cols + c] = data[r][c]
				}
			}
		} else {
			// 1D array
			const flat = Array.isArray(data) ? data : [data]
			this._rows = flat.length
			this._cols = 1
			this._data = new Float64Array(flat)
		}
		this.requiresGrad = opts.requiresGrad || false
		this.grad = null
	}

	get rows() { return this._rows }
	get cols() { return this._cols }
	get data() { return this._data }
	get shape() { return [this._rows, this._cols] }

	get(row, col = 0) { return this._data[row * this._cols + col] }
	set(row, col, value) { this._data[row * this._cols + col] = value }

	to1D() { return Array.from(this._data) }

	to2D() {
		const out = []
		for (let r = 0; r < this._rows; r++) {
			const row = []
			for (let c = 0; c < this._cols; c++) row.push(this._data[r * this._cols + c])
			out.push(row)
		}
		return out
	}

	sliceRows(start, end) {
		const count = end - start
		const out = new Array(count)
		for (let r = 0; r < count; r++) {
			const row = []
			for (let c = 0; c < this._cols; c++) row.push(this._data[(start + r) * this._cols + c])
			out[r] = row
		}
		return new Tensor(out)
	}

	clone() {
		const t = new Tensor(Array.from(this._data), { requiresGrad: this.requiresGrad })
		t._rows = this._rows; t._cols = this._cols
		if (this.grad) t.grad = new Float64Array(this.grad)
		return t
	}

	fill(value) { this._data.fill(value); return this }

	map(fn) {
		const out = new Tensor(Array.from(this._data))
		out._rows = this._rows; out._cols = this._cols
		for (let i = 0; i < out._data.length; i++) out._data[i] = fn(out._data[i], i)
		return out
	}

	add(other) {
		if (this._data.length !== other._data.length) throw new Error(`Tensor shape mismatch: ${this.shape} vs ${other.shape}`)
		const out = new Tensor(Array.from(this._data))
		out._rows = this._rows; out._cols = this._cols
		for (let i = 0; i < out._data.length; i++) out._data[i] += other._data[i]
		return out
	}

	sub(other) {
		if (this._data.length !== other._data.length) throw new Error(`Tensor shape mismatch: ${this.shape} vs ${other.shape}`)
		const out = new Tensor(Array.from(this._data))
		out._rows = this._rows; out._cols = this._cols
		for (let i = 0; i < out._data.length; i++) out._data[i] -= other._data[i]
		return out
	}

	mulScalar(scalar) {
		const out = new Tensor(Array.from(this._data))
		out._rows = this._rows; out._cols = this._cols
		for (let i = 0; i < out._data.length; i++) out._data[i] *= scalar
		return out
	}

	matMul(other) {
		if (this._cols !== other._rows) throw new Error(`Matrix multiply shape mismatch: ${this.shape} x ${other.shape}`)
		const m = this._rows, n = this._cols, p = other._cols
		const out = new Array(m)
		for (let r = 0; r < m; r++) {
			const row = new Array(p)
			for (let c = 0; c < p; c++) {
				let sum = 0
				for (let k = 0; k < n; k++) sum += this._data[r * n + k] * other._data[k * p + c]
				row[c] = sum
			}
			out[r] = row
		}
		return new Tensor(out)
	}

	T() {
		const out = new Array(this._cols)
		for (let c = 0; c < this._cols; c++) {
			const row = new Array(this._rows)
			for (let r = 0; r < this._rows; r++) row[r] = this._data[r * this._cols + c]
			out[c] = row
		}
		return new Tensor(out)
	}

	sum() { let s = 0; for (let i = 0; i < this._data.length; i++) s += this._data[i]; return s }
	mean() { return this.sum() / this._data.length }

	diag() {
		const n = Math.min(this._rows, this._cols)
		const out = []
		for (let i = 0; i < n; i++) out.push(this._data[i * this._cols + i])
		return out
	}

	static zeros(rows, cols = 1) {
		const data = new Array(rows)
		for (let r = 0; r < rows; r++) data[r] = cols === 1 ? 0 : new Array(cols).fill(0)
		return new Tensor(cols === 1 ? data : data)
	}

	static rand(rows, cols = 1, scale = 1) {
		const data = new Array(rows)
		for (let r = 0; r < rows; r++) {
			if (cols === 1) {
				data[r] = (Math.random() - 0.5) * 2 * scale
			} else {
				const row = new Array(cols)
				for (let c = 0; c < cols; c++) row[c] = (Math.random() - 0.5) * 2 * scale
				data[r] = row
			}
		}
		return new Tensor(cols === 1 ? data : data)
	}

	static fromFlat(data, rows, cols) {
		const t = new Tensor(new Array(rows * cols).fill(0))
		t._rows = rows; t._cols = cols
		t._data = new Float64Array(data)
		return t
	}

	static xavier(rows, cols) {
		const limit = Math.sqrt(6 / (rows + cols))
		return Tensor.rand(rows, cols, limit)
	}

	static he(rows, cols) {
		const std = Math.sqrt(2 / rows)
		return Tensor.rand(rows, cols, std * Math.sqrt(3))
	}
}

// ─── Base Layer ──────────────────────────────────────────────────────────────────

class Layer {
	constructor() { this._training = true }
	setTraining(v) { this._training = v }
	parameters() { return [] }
	forward(input) { throw new Error("Layer.forward() not implemented") }
	backward(outputGrad) { throw new Error("Layer.backward() not implemented") }
	describe() { return this.constructor.name }
}

// ─── Dense Layer ─────────────────────────────────────────────────────────────────

class DenseLayer extends Layer {
	constructor(inputDim, outputDim, init = "xavier") {
		super()
		this.inputDim = inputDim
		this.outputDim = outputDim
		const initFn = init === "he" ? Tensor.he : Tensor.xavier
		this.weights = initFn(inputDim, outputDim)
		this.biases = new Tensor(new Array(outputDim).fill(0))
		this._wGrad = Tensor.zeros(inputDim, outputDim)
		this._bGrad = Tensor.zeros(outputDim)
		this._input = null
	}

	parameters() {
		return [
			{ tensor: this.weights, grad: this._wGrad, name: "weight" },
			{ tensor: this.biases, grad: this._bGrad, name: "bias" },
		]
	}

	forward(input) {
		this._input = input
		const product = input.matMul(this.weights)
		const out = new Tensor(Array.from(product._data))
		out._rows = product._rows; out._cols = product._cols
		for (let r = 0; r < out._rows; r++)
			for (let c = 0; c < out._cols; c++)
				out._data[r * out._cols + c] += this.biases._data[c]
		return out
	}

	backward(outputGrad) {
		const inputT = this._input.T()
		this._wGrad = inputT.matMul(outputGrad)
		const bGrad = new Array(this.outputDim).fill(0)
		for (let r = 0; r < outputGrad._rows; r++)
			for (let c = 0; c < outputGrad._cols; c++)
				bGrad[c] += outputGrad._data[r * outputGrad._cols + c]
		this._bGrad = new Tensor(bGrad)
		const wT = this.weights.T()
		return outputGrad.matMul(wT)
	}

	describe() { return `Dense(${this.inputDim}→${this.outputDim})` }
}

// ─── Activation Layers ───────────────────────────────────────────────────────────

class ReLULayer extends Layer {
	forward(input) { this._input = input; return input.map((v) => Math.max(0, v)) }
	backward(outputGrad) {
		const grad = new Tensor(Array.from(outputGrad._data))
		grad._rows = outputGrad._rows; grad._cols = outputGrad._cols
		for (let i = 0; i < grad._data.length; i++)
			if (this._input._data[i] <= 0) grad._data[i] = 0
		return grad
	}
	describe() { return "ReLU" }
}

class TanhLayer extends Layer {
	forward(input) { this._output = input.map((v) => Math.tanh(v)); return this._output }
	backward(outputGrad) {
		const grad = new Tensor(Array.from(outputGrad._data))
		grad._rows = outputGrad._rows; grad._cols = outputGrad._cols
		for (let i = 0; i < grad._data.length; i++) {
			const t = this._output._data[i]
			grad._data[i] *= 1 - t * t
		}
		return grad
	}
	describe() { return "Tanh" }
}

class SigmoidLayer extends Layer {
	forward(input) { this._output = input.map((v) => 1 / (1 + Math.exp(-v))); return this._output }
	backward(outputGrad) {
		const grad = new Tensor(Array.from(outputGrad._data))
		grad._rows = outputGrad._rows; grad._cols = outputGrad._cols
		for (let i = 0; i < grad._data.length; i++) {
			const s = this._output._data[i]
			grad._data[i] *= s * (1 - s)
		}
		return grad
	}
	describe() { return "Sigmoid" }
}

class SoftmaxLayer extends Layer {
	forward(input) {
		this._input = input
		const out = new Tensor(Array.from(input._data))
		out._rows = input._rows; out._cols = input._cols
		for (let r = 0; r < input._rows; r++) {
			let maxVal = -Infinity
			for (let c = 0; c < input._cols; c++) maxVal = Math.max(maxVal, input._data[r * input._cols + c])
			let sum = 0
			for (let c = 0; c < input._cols; c++) {
				const expVal = Math.exp(input._data[r * input._cols + c] - maxVal)
				out._data[r * input._cols + c] = expVal; sum += expVal
			}
			for (let c = 0; c < input._cols; c++) out._data[r * input._cols + c] /= sum
		}
		this._output = out
		return out
	}
	backward(outputGrad) {
		const grad = new Tensor(Array.from(outputGrad._data))
		grad._rows = outputGrad._rows; grad._cols = outputGrad._cols
		for (let r = 0; r < this._output._rows; r++) {
			let dot = 0
			for (let c = 0; c < this._output._cols; c++)
				dot += this._output._data[r * this._output._cols + c] * outputGrad._data[r * outputGrad._cols + c]
			for (let c = 0; c < this._output._cols; c++) {
				const s = this._output._data[r * this._output._cols + c]
				grad._data[r * grad._cols + c] = s * (outputGrad._data[r * outputGrad._cols + c] - dot)
			}
		}
		return grad
	}
	describe() { return "Softmax" }
}

// ─── Dropout Layer ───────────────────────────────────────────────────────────────

class DropoutLayer extends Layer {
	constructor(rate) { super(); this.rate = rate; this._mask = null }
	forward(input) {
		if (!this._training) return input
		const scale = 1 / (1 - this.rate)
		const mask = new Float64Array(input._data.length)
		for (let i = 0; i < mask.length; i++) mask[i] = Math.random() > this.rate ? scale : 0
		this._mask = mask
		const out = new Tensor(Array.from(input._data))
		out._rows = input._rows; out._cols = input._cols
		for (let i = 0; i < out._data.length; i++) out._data[i] *= mask[i]
		return out
	}
	backward(outputGrad) {
		if (!this._mask) return outputGrad
		const grad = new Tensor(Array.from(outputGrad._data))
		grad._rows = outputGrad._rows; grad._cols = outputGrad._cols
		for (let i = 0; i < grad._data.length; i++) grad._data[i] *= this._mask[i]
		return grad
	}
	describe() { return `Dropout(${this.rate})` }
}

// ─── Batch Normalization Layer ───────────────────────────────────────────────────

class BatchNormLayer extends Layer {
	constructor(dim, eps = 1e-5, momentum = 0.9) {
		super()
		this.dim = dim; this.eps = eps; this.momentum = momentum
		this.gamma = new Tensor(new Array(dim).fill(1))
		this.beta = new Tensor(new Array(dim).fill(0))
		this._gammaGrad = Tensor.zeros(dim)
		this._betaGrad = Tensor.zeros(dim)
		this.runningMean = new Tensor(new Array(dim).fill(0))
		this.runningVar = new Tensor(new Array(dim).fill(1))
		this._xNorm = null; this._xMu = null; this._xVar = null; this._input = null
	}

	parameters() {
		return [
			{ tensor: this.gamma, grad: this._gammaGrad, name: "gamma" },
			{ tensor: this.beta, grad: this._betaGrad, name: "beta" },
		]
	}

	forward(input) {
		this._input = input
		const N = input._rows, D = input._cols
		if (this._training) {
			const mean = new Array(D).fill(0)
			for (let r = 0; r < N; r++) for (let c = 0; c < D; c++) mean[c] += input._data[r * D + c]
			for (let c = 0; c < D; c++) mean[c] /= N

			const var_ = new Array(D).fill(0)
			for (let r = 0; r < N; r++) for (let c = 0; c < D; c++) { const d = input._data[r * D + c] - mean[c]; var_[c] += d * d }
			for (let c = 0; c < D; c++) var_[c] /= N

			const xNorm = new Tensor(Array.from(input._data))
			xNorm._rows = N; xNorm._cols = D
			for (let r = 0; r < N; r++) for (let c = 0; c < D; c++)
				xNorm._data[r * D + c] = (input._data[r * D + c] - mean[c]) / Math.sqrt(var_[c] + this.eps)

			const out = new Tensor(Array.from(xNorm._data))
			out._rows = N; out._cols = D
			for (let r = 0; r < N; r++) for (let c = 0; c < D; c++)
				out._data[r * D + c] = this.gamma._data[c] * xNorm._data[r * D + c] + this.beta._data[c]

			for (let c = 0; c < D; c++) {
				this.runningMean._data[c] = this.momentum * this.runningMean._data[c] + (1 - this.momentum) * mean[c]
				this.runningVar._data[c] = this.momentum * this.runningVar._data[c] + (1 - this.momentum) * var_[c]
			}
			this._xNorm = xNorm; this._xMu = mean; this._xVar = var_
			return out
		} else {
			const out = new Tensor(Array.from(input._data))
			out._rows = N; out._cols = D
			for (let r = 0; r < N; r++) for (let c = 0; c < D; c++)
				out._data[r * D + c] = this.gamma._data[c] * ((input._data[r * D + c] - this.runningMean._data[c]) / Math.sqrt(this.runningVar._data[c] + this.eps)) + this.beta._data[c]
			return out
		}
	}

	backward(outputGrad) {
		const N = outputGrad._rows, D = outputGrad._cols
		const xNorm = this._xNorm, mu = this._xMu, var_ = this._xVar

		const gammaGrad = new Array(D).fill(0)
		for (let r = 0; r < N; r++) for (let c = 0; c < D; c++)
			gammaGrad[c] += outputGrad._data[r * D + c] * xNorm._data[r * D + c]
		this._gammaGrad = new Tensor(gammaGrad)

		const betaGrad = new Array(D).fill(0)
		for (let r = 0; r < N; r++) for (let c = 0; c < D; c++)
			betaGrad[c] += outputGrad._data[r * D + c]
		this._betaGrad = new Tensor(betaGrad)

		const dxNorm = new Tensor(Array.from(outputGrad._data))
		dxNorm._rows = N; dxNorm._cols = D
		for (let r = 0; r < N; r++) for (let c = 0; c < D; c++)
			dxNorm._data[r * D + c] *= this.gamma._data[c]

		const grad = new Tensor(Array.from(this._input._data))
		grad._rows = N; grad._cols = D
		const invStd = new Array(D)
		for (let c = 0; c < D; c++) invStd[c] = 1 / Math.sqrt(var_[c] + this.eps)

		for (let r = 0; r < N; r++) {
			for (let c = 0; c < D; c++) {
				let sum1 = 0, sum2 = 0
				for (let rr = 0; rr < N; rr++) {
					sum1 += dxNorm._data[rr * D + c]
					sum2 += dxNorm._data[rr * D + c] * xNorm._data[rr * D + c]
				}
				grad._data[r * D + c] = (1 / N) * invStd[c] * (N * dxNorm._data[r * D + c] - sum1 - xNorm._data[r * D + c] * sum2)
			}
		}
		return grad
	}

	describe() { return `BatchNorm(${this.dim})` }
}

// ─── Conv2D Layer ────────────────────────────────────────────────────────────────

class Conv2DLayer extends Layer {
	constructor(inChannels, outChannels, kernelSize, stride = 1, padding = 0) {
		super()
		this.inChannels = inChannels; this.outChannels = outChannels
		this.kernelSize = kernelSize; this.stride = stride; this.padding = padding
		const std = Math.sqrt(2 / (inChannels * kernelSize * kernelSize))
		this.kernels = Tensor.rand(outChannels, inChannels * kernelSize * kernelSize, std * Math.sqrt(3))
		this.bias = new Tensor(new Array(outChannels).fill(0))
		this._kGrad = Tensor.zeros(outChannels, inChannels * kernelSize * kernelSize)
		this._bGrad = Tensor.zeros(outChannels)
		this._input = null; this._col = null
	}

	parameters() {
		return [
			{ tensor: this.kernels, grad: this._kGrad, name: "kernel" },
			{ tensor: this.bias, grad: this._bGrad, name: "bias" },
		]
	}

	forward(input) {
		this._input = input
		const batchSize = input._rows
		const totalInput = input._cols
		const H = Math.floor(Math.sqrt(totalInput / this.inChannels))
		const W = H
		const outH = Math.floor((H + 2 * this.padding - this.kernelSize) / this.stride + 1)
		const outW = Math.floor((W + 2 * this.padding - this.kernelSize) / this.stride + 1)
		const colRows = outH * outW
		const colCols = this.inChannels * this.kernelSize * this.kernelSize
		const colData = new Float64Array(batchSize * colRows * colCols)

		for (let b = 0; b < batchSize; b++) {
			for (let oh = 0; oh < outH; oh++) {
				for (let ow = 0; ow < outW; ow++) {
					const colRow = oh * outW + ow
					for (let c = 0; c < this.inChannels; c++) {
						for (let kh = 0; kh < this.kernelSize; kh++) {
							for (let kw = 0; kw < this.kernelSize; kw++) {
								const ih = oh * this.stride + kh - this.padding
								const iw = ow * this.stride + kw - this.padding
								let val = 0
								if (ih >= 0 && ih < H && iw >= 0 && iw < W) {
									const idx = b * (H * W * this.inChannels) + c * (H * W) + ih * W + iw
									val = input._data[idx]
								}
								const colIdx = b * (colRows * colCols) + colRow * colCols + c * this.kernelSize * this.kernelSize + kh * this.kernelSize + kw
								colData[colIdx] = val
							}
						}
					}
				}
			}
		}

		this._col = { data: colData, rows: colRows, cols: colCols, batchSize, outH, outW }

		const outRows = batchSize * colRows
		const outCols = this.outChannels
		const outData = new Float64Array(outRows * outCols)
		for (let i = 0; i < outRows; i++) {
			for (let j = 0; j < outCols; j++) {
				let sum = this.bias._data[j]
				for (let k = 0; k < colCols; k++) sum += colData[i * colCols + k] * this.kernels._data[j * colCols + k]
				outData[i * outCols + j] = sum
			}
		}

		const out = new Tensor(Array.from(outData))
		out._rows = outRows; out._cols = outCols
		return out
	}

	backward(outputGrad) {
		const { data: colData, rows: colRows, cols: colCols, batchSize, outH, outW } = this._col
		const outRows = batchSize * colRows

		const kGradData = new Float64Array(this.outChannels * colCols)
		for (let j = 0; j < this.outChannels; j++)
			for (let k = 0; k < colCols; k++) {
				let sum = 0
				for (let i = 0; i < outRows; i++) sum += colData[i * colCols + k] * outputGrad._data[i * this.outChannels + j]
				kGradData[j * colCols + k] = sum
			}
		this._kGrad = Tensor.fromFlat(kGradData, this.outChannels, colCols)

		const bGrad = new Array(this.outChannels).fill(0)
		for (let i = 0; i < outRows; i++) for (let j = 0; j < this.outChannels; j++) bGrad[j] += outputGrad._data[i * this.outChannels + j]
		this._bGrad = new Tensor(bGrad)

		const totalInput = this._input._cols
		const H = Math.floor(Math.sqrt(totalInput / this.inChannels))
		const W = H
		const dxData = new Float64Array(batchSize * totalInput)
		for (let b = 0; b < batchSize; b++) {
			for (let oh = 0; oh < outH; oh++) {
				for (let ow = 0; ow < outW; ow++) {
					const colRow = oh * outW + ow
					const outRow = b * colRows + colRow
					for (let c = 0; c < this.inChannels; c++) {
						for (let kh = 0; kh < this.kernelSize; kh++) {
							for (let kw = 0; kw < this.kernelSize; kw++) {
								const ih = oh * this.stride + kh - this.padding
								const iw = ow * this.stride + kw - this.padding
								if (ih >= 0 && ih < H && iw >= 0 && iw < W) {
									const idx = b * (H * W * this.inChannels) + c * (H * W) + ih * W + iw
									for (let j = 0; j < this.outChannels; j++) {
										const kIdx = j * colCols + c * this.kernelSize * this.kernelSize + kh * this.kernelSize + kw
										dxData[idx] += outputGrad._data[outRow * this.outChannels + j] * this.kernels._data[kIdx]
									}
								}
							}
						}
					}
				}
			}
		}
		return Tensor.fromFlat(dxData, batchSize, totalInput)
	}

	describe() { return `Conv2D(${this.inChannels}→${this.outChannels},${this.kernelSize}x${this.kernelSize})` }
}

// ─── Optimizers ──────────────────────────────────────────────────────────────────

class SGD {
	constructor(params, learningRate = 0.01) {
		this.params = params
		this.lr = learningRate
	}

	step(lr) {
		const rate = lr || this.lr
		for (const p of this.params) {
			for (let i = 0; i < p.tensor._data.length; i++)
				p.tensor._data[i] -= rate * p.grad._data[i]
		}
	}

	zeroGrad() {
		for (const p of this.params) p.grad.fill(0)
	}
}

class Momentum {
	constructor(params, learningRate = 0.01, momentum = 0.9) {
		this.params = params
		this.lr = learningRate
		this.momentum = momentum
		this._velocities = params.map((p) => new Float64Array(p.tensor._data.length).fill(0))
	}

	step(lr) {
		const rate = lr || this.lr
		for (let pi = 0; pi < this.params.length; pi++) {
			const p = this.params[pi]
			const v = this._velocities[pi]
			for (let i = 0; i < p.tensor._data.length; i++) {
				v[i] = this.momentum * v[i] - rate * p.grad._data[i]
				p.tensor._data[i] += v[i]
			}
		}
	}

	zeroGrad() {
		for (const p of this.params) p.grad.fill(0)
	}
}

class AdamOptimizer {
	constructor(params, learningRate = 0.001, beta1 = 0.9, beta2 = 0.999, eps = 1e-8) {
		this.params = params
		this.lr = learningRate
		this.beta1 = beta1
		this.beta2 = beta2
		this.eps = eps
		this._m = params.map((p) => new Float64Array(p.tensor._data.length).fill(0))
		this._v = params.map((p) => new Float64Array(p.tensor._data.length).fill(0))
		this._t = 0
	}

	step(lr) {
		const rate = lr || this.lr
		this._t++
		const t = this._t
		for (let pi = 0; pi < this.params.length; pi++) {
			const p = this.params[pi]
			const m = this._m[pi]
			const v = this._v[pi]
			for (let i = 0; i < p.tensor._data.length; i++) {
				const g = p.grad._data[i]
				m[i] = this.beta1 * m[i] + (1 - this.beta1) * g
				v[i] = this.beta2 * v[i] + (1 - this.beta2) * g * g
				const mHat = m[i] / (1 - Math.pow(this.beta1, t))
				const vHat = v[i] / (1 - Math.pow(this.beta2, t))
				p.tensor._data[i] -= rate * mHat / (Math.sqrt(vHat) + this.eps)
			}
		}
	}

	zeroGrad() {
		for (const p of this.params) p.grad.fill(0)
	}
}

// ─── Loss Functions ──────────────────────────────────────────────────────────────

class MSELoss {
	/**
	 * @param {Tensor} prediction - [batch, outputDim]
	 * @param {Tensor} target - [batch, outputDim]
	 * @returns {{ loss: number, grad: Tensor }}
	 */
	forward(prediction, target) {
		let loss = 0
		const N = prediction._data.length
		const grad = new Tensor(Array.from(prediction._data))
		grad._rows = prediction._rows; grad._cols = prediction._cols
		for (let i = 0; i < N; i++) {
			const diff = prediction._data[i] - target._data[i]
			loss += diff * diff
			grad._data[i] = 2 * diff / N
		}
		loss /= N
		return { loss, grad }
	}
}

class CrossEntropyLoss {
	/**
	 * @param {Tensor} prediction - [batch, numClasses] (softmax output)
	 * @param {Tensor} target - [batch, numClasses] (one-hot)
	 * @returns {{ loss: number, grad: Tensor }}
	 */
	forward(prediction, target) {
		let loss = 0
		const N = prediction._rows
		const C = prediction._cols
		const grad = new Tensor(Array.from(prediction._data))
		grad._rows = N; grad._cols = C
		for (let r = 0; r < N; r++) {
			for (let c = 0; c < C; c++) {
				const p = Math.max(prediction._data[r * C + c], 1e-15)
				if (target._data[r * C + c] > 0) {
					loss -= target._data[r * C + c] * Math.log(p)
				}
				grad._data[r * C + c] = p - target._data[r * C + c]
			}
		}
		loss /= N
		return { loss, grad }
	}
}

class BinaryCrossEntropyLoss {
	/**
	 * @param {Tensor} prediction - [batch, 1] (sigmoid output)
	 * @param {Tensor} target - [batch, 1]
	 * @returns {{ loss: number, grad: Tensor }}
	 */
	forward(prediction, target) {
		let loss = 0
		const N = prediction._data.length
		const grad = new Tensor(Array.from(prediction._data))
		grad._rows = prediction._rows; grad._cols = prediction._cols
		for (let i = 0; i < N; i++) {
			const p = Math.max(Math.min(prediction