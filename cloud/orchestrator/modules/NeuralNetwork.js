/**
 * Super Roo ML — NeuralNetwork (Cloud JS Port)
 *
 * Ported from src/super-roo/ml/engine/ (Tensor.ts, Layer.ts, Loss.ts, Optimizer.ts, NeuralNetwork.ts)
 * Lightweight 2-D tensor neural network engine with training, inference, and serialisation.
 * No external dependencies.
 *
 * Exports:
 *   Tensor, DenseLayer, ReLULayer, SigmoidLayer, TanhLayer, SoftmaxLayer,
 *   DropoutLayer, BatchNormLayer, CrossEntropyLoss, MSELoss, HuberLoss,
 *   HingeLoss, MAELoss, KLLoss, CosineSimilarityLoss, BCELoss,
 *   AdamOptimizer, SGDOptimizer, NeuralNetwork
 */

// ═══════════════════════════════════════════════════════════════════════════════
// Tensor
// ═══════════════════════════════════════════════════════════════════════════════

class Tensor {
	constructor(rows, cols, init = "zeros") {
		this.rows = rows
		this.cols = cols
		this.data = new Float64Array(rows * cols)
		this._fill(init)
	}

	static from2D(arr) {
		const rows = arr.length
		const cols = arr[0]?.length ?? 0
		const t = new Tensor(rows, cols, "zeros")
		for (let i = 0; i < rows; i++) {
			for (let j = 0; j < cols; j++) {
				t.set(i, j, arr[i][j] ?? 0)
			}
		}
		return t
	}

	static from1D(arr) {
		const t = new Tensor(1, arr.length, "zeros")
		for (let j = 0; j < arr.length; j++) {
			t.set(0, j, arr[j])
		}
		return t
	}

	static zeros(rows, cols) {
		return new Tensor(rows, cols, "zeros")
	}

	static ones(rows, cols) {
		return new Tensor(rows, cols, "ones")
	}

	static random(rows, cols, scale = 1) {
		const t = new Tensor(rows, cols, "zeros")
		for (let i = 0; i < t.data.length; i++) {
			t.data[i] = (Math.random() * 2 - 1) * scale
		}
		return t
	}

	_fill(init) {
		const n = this.data.length
		switch (init) {
			case "zeros":
				this.data.fill(0)
				break
			case "ones":
				this.data.fill(1)
				break
			case "random":
				for (let i = 0; i < n; i++) this.data[i] = Math.random() * 2 - 1
				break
			case "xavier": {
				const scale = Math.sqrt(6 / (this.rows + this.cols))
				for (let i = 0; i < n; i++) this.data[i] = (Math.random() * 2 - 1) * scale
				break
			}
			case "he": {
				const scale = Math.sqrt(6 / this.rows)
				for (let i = 0; i < n; i++) this.data[i] = (Math.random() * 2 - 1) * scale
				break
			}
		}
	}

	get(i, j) {
		return this.data[i * this.cols + j]
	}

	set(i, j, v) {
		this.data[i * this.cols + j] = v
	}

	shape() {
		return [this.rows, this.cols]
	}

	clone() {
		const t = new Tensor(this.rows, this.cols, "zeros")
		t.data.set(this.data)
		return t
	}

	// ── Element-wise ops ───────────────────────────────────────────────

	add(other) {
		if (typeof other === "number") {
			const out = new Tensor(this.rows, this.cols, "zeros")
			for (let i = 0; i < this.data.length; i++) out.data[i] = this.data[i] + other
			return out
		}
		if (this.rows === other.rows && this.cols === other.cols) {
			const out = new Tensor(this.rows, this.cols, "zeros")
			for (let i = 0; i < this.data.length; i++) out.data[i] = this.data[i] + other.data[i]
			return out
		}
		// Broadcast row vector (other is [1,cols])
		if (other.rows === 1 && other.cols === this.cols) {
			const out = new Tensor(this.rows, this.cols, "zeros")
			for (let i = 0; i < this.rows; i++) {
				for (let j = 0; j < this.cols; j++) {
					out.set(i, j, this.get(i, j) + other.get(0, j))
				}
			}
			return out
		}
		// Broadcast row vector (this is [1,cols])
		if (this.rows === 1 && this.cols === other.cols) {
			const out = new Tensor(other.rows, other.cols, "zeros")
			for (let i = 0; i < other.rows; i++) {
				for (let j = 0; j < this.cols; j++) {
					out.set(i, j, this.get(0, j) + other.get(i, j))
				}
			}
			return out
		}
		if (other.rows === 1 && other.cols === 1) {
			return this.add(other.get(0, 0))
		}
		if (this.rows === 1 && this.cols === 1) {
			return other.add(this.get(0, 0))
		}
		throw new Error(
			`Tensor shape mismatch in 'add': Cannot add tensors with shapes [${this.rows},${this.cols}] and [${other.rows},${other.cols}]. ` +
				"Ensure both tensors have the same dimensions, or one is a scalar (1,1) or row vector (1,cols).",
		)
	}

	sub(other) {
		if (typeof other === "number") {
			const out = new Tensor(this.rows, this.cols, "zeros")
			for (let i = 0; i < this.data.length; i++) out.data[i] = this.data[i] - other
			return out
		}
		if (this.rows === other.rows && this.cols === other.cols) {
			const out = new Tensor(this.rows, this.cols, "zeros")
			for (let i = 0; i < this.data.length; i++) out.data[i] = this.data[i] - other.data[i]
			return out
		}
		if (other.rows === 1 && other.cols === this.cols) {
			const out = new Tensor(this.rows, this.cols, "zeros")
			for (let i = 0; i < this.rows; i++) {
				for (let j = 0; j < this.cols; j++) {
					out.set(i, j, this.get(i, j) - other.get(0, j))
				}
			}
			return out
		}
		if (this.rows === 1 && this.cols === other.cols) {
			const out = new Tensor(other.rows, other.cols, "zeros")
			for (let i = 0; i < other.rows; i++) {
				for (let j = 0; j < this.cols; j++) {
					out.set(i, j, this.get(0, j) - other.get(i, j))
				}
			}
			return out
		}
		if (other.rows === 1 && other.cols === 1) {
			return this.sub(other.get(0, 0))
		}
		if (this.rows === 1 && this.cols === 1) {
			const out = new Tensor(other.rows, other.cols, "zeros")
			for (let i = 0; i < other.rows; i++) {
				for (let j = 0; j < other.cols; j++) {
					out.set(i, j, this.get(0, 0) - other.get(i, j))
				}
			}
			return out
		}
		throw new Error(
			`Tensor shape mismatch in 'sub': Cannot subtract tensors with shapes [${this.rows},${this.cols}] and [${other.rows},${other.cols}]. ` +
				"Ensure both tensors have the same dimensions, or one is a scalar (1,1) or row vector (1,cols).",
		)
	}

	mul(other) {
		if (typeof other === "number") {
			const out = new Tensor(this.rows, this.cols, "zeros")
			for (let i = 0; i < this.data.length; i++) out.data[i] = this.data[i] * other
			return out
		}
		if (this.rows === other.rows && this.cols === other.cols) {
			const out = new Tensor(this.rows, this.cols, "zeros")
			for (let i = 0; i < this.data.length; i++) out.data[i] = this.data[i] * other.data[i]
			return out
		}
		if (other.rows === 1 && other.cols === this.cols) {
			const out = new Tensor(this.rows, this.cols, "zeros")
			for (let i = 0; i < this.rows; i++) {
				for (let j = 0; j < this.cols; j++) {
					out.set(i, j, this.get(i, j) * other.get(0, j))
				}
			}
			return out
		}
		if (this.rows === 1 && this.cols === other.cols) {
			const out = new Tensor(other.rows, other.cols, "zeros")
			for (let i = 0; i < other.rows; i++) {
				for (let j = 0; j < this.cols; j++) {
					out.set(i, j, this.get(0, j) * other.get(i, j))
				}
			}
			return out
		}
		if (other.rows === 1 && other.cols === 1) {
			return this.mul(other.get(0, 0))
		}
		if (this.rows === 1 && this.cols === 1) {
			return other.mul(this.get(0, 0))
		}
		throw new Error(
			`Tensor shape mismatch in 'mul': Cannot multiply tensors with shapes [${this.rows},${this.cols}] and [${other.rows},${other.cols}]. ` +
				"Ensure both tensors have the same dimensions, or one is a scalar (1,1) or row vector (1,cols).",
		)
	}

	div(other) {
		if (typeof other === "number") {
			if (other === 0) throw new Error("Tensor.div: division by zero")
			const out = new Tensor(this.rows, this.cols, "zeros")
			for (let i = 0; i < this.data.length; i++) out.data[i] = this.data[i] / other
			return out
		}
		if (this.rows === other.rows && this.cols === other.cols) {
			const out = new Tensor(this.rows, this.cols, "zeros")
			for (let i = 0; i < this.data.length; i++) {
				if (other.data[i] === 0) throw new Error(`Tensor.div: division by zero at index ${i}`)
				out.data[i] = this.data[i] / other.data[i]
			}
			return out
		}
		if (other.rows === 1 && other.cols === this.cols) {
			const out = new Tensor(this.rows, this.cols, "zeros")
			for (let i = 0; i < this.rows; i++) {
				for (let j = 0; j < this.cols; j++) {
					const divisor = other.get(0, j)
					if (divisor === 0) throw new Error(`Tensor.div: division by zero at [${i},${j}]`)
					out.set(i, j, this.get(i, j) / divisor)
				}
			}
			return out
		}
		if (this.rows === 1 && this.cols === other.cols) {
			const out = new Tensor(other.rows, other.cols, "zeros")
			for (let i = 0; i < other.rows; i++) {
				for (let j = 0; j < this.cols; j++) {
					const divisor = other.get(i, j)
					if (divisor === 0) throw new Error(`Tensor.div: division by zero at [${i},${j}]`)
					out.set(i, j, this.get(0, j) / divisor)
				}
			}
			return out
		}
		if (other.rows === 1 && other.cols === 1) {
			return this.div(other.get(0, 0))
		}
		if (this.rows === 1 && this.cols === 1) {
			const out = new Tensor(other.rows, other.cols, "zeros")
			for (let i = 0; i < other.rows; i++) {
				for (let j = 0; j < other.cols; j++) {
					const divisor = other.get(i, j)
					if (divisor === 0) throw new Error(`Tensor.div: division by zero at [${i},${j}]`)
					out.set(i, j, this.get(0, 0) / divisor)
				}
			}
			return out
		}
		throw new Error(
			`Tensor shape mismatch in 'div': Cannot divide tensors with shapes [${this.rows},${this.cols}] and [${other.rows},${other.cols}]. ` +
				"Ensure both tensors have the same dimensions, or one is a scalar (1,1) or row vector (1,cols).",
		)
	}

	pow(exp) {
		const out = new Tensor(this.rows, this.cols, "zeros")
		for (let i = 0; i < this.data.length; i++) {
			const val = Math.pow(this.data[i], exp)
			out.data[i] = Number.isFinite(val) ? val : 0
		}
		return out
	}

	abs() {
		const out = new Tensor(this.rows, this.cols, "zeros")
		for (let i = 0; i < this.data.length; i++) out.data[i] = Math.abs(this.data[i])
		return out
	}

	sqrt() {
		const out = new Tensor(this.rows, this.cols, "zeros")
		for (let i = 0; i < this.data.length; i++) out.data[i] = Math.sqrt(Math.max(0, this.data[i]))
		return out
	}

	log() {
		const out = new Tensor(this.rows, this.cols, "zeros")
		for (let i = 0; i < this.data.length; i++) out.data[i] = Math.log(Math.max(this.data[i], 1e-8))
		return out
	}

	exp() {
		const out = new Tensor(this.rows, this.cols, "zeros")
		for (let i = 0; i < this.data.length; i++) out.data[i] = Math.exp(this.data[i])
		return out
	}

	neg() {
		return this.mul(-1)
	}

	// ── Matrix ops ─────────────────────────────────────────────────────

	transpose() {
		const out = new Tensor(this.cols, this.rows, "zeros")
		for (let i = 0; i < this.rows; i++) {
			for (let j = 0; j < this.cols; j++) {
				out.set(j, i, this.get(i, j))
			}
		}
		return out
	}

	matmul(other) {
		if (this.cols !== other.rows) {
			throw new Error(
				`Tensor shape mismatch in 'matmul': Cannot multiply [${this.rows},${this.cols}] × [${other.rows},${other.cols}]. ` +
					`The number of columns in the first tensor (${this.cols}) must equal the number of rows in the second tensor (${other.rows}).`,
			)
		}

		// Use optimized matrix multiplication for large matrices
		const LARGE_MATRIX_THRESHOLD = 64
		const useOptimization =
			this.rows > LARGE_MATRIX_THRESHOLD ||
			this.cols > LARGE_MATRIX_THRESHOLD ||
			other.cols > LARGE_MATRIX_THRESHOLD

		if (useOptimization) {
			return this._matmulOptimized(other)
		}

		// Standard matrix multiplication for smaller matrices
		const out = new Tensor(this.rows, other.cols, "zeros")
		for (let i = 0; i < this.rows; i++) {
			for (let k = 0; k < this.cols; k++) {
				const aik = this.get(i, k)
				if (aik === 0) continue
				for (let j = 0; j < other.cols; j++) {
					out.data[i * other.cols + j] += aik * other.get(k, j)
				}
			}
		}
		return out
	}

	/**
	 * Optimized matrix multiplication using tiling for cache efficiency.
	 * Improves performance for large matrices by reducing cache misses.
	 */
	_matmulOptimized(other) {
		const out = new Tensor(this.rows, other.cols, "zeros")
		const TILE_SIZE = 32

		for (let i0 = 0; i0 < this.rows; i0 += TILE_SIZE) {
			for (let j0 = 0; j0 < other.cols; j0 += TILE_SIZE) {
				for (let k0 = 0; k0 < this.cols; k0 += TILE_SIZE) {
					const iMax = Math.min(i0 + TILE_SIZE, this.rows)
					const jMax = Math.min(j0 + TILE_SIZE, other.cols)
					const kMax = Math.min(k0 + TILE_SIZE, this.cols)

					for (let i = i0; i < iMax; i++) {
						for (let k = k0; k < kMax; k++) {
							const aik = this.get(i, k)
							if (aik === 0) continue
							for (let j = j0; j < jMax; j++) {
								out.data[i * other.cols + j] += aik * other.get(k, j)
							}
						}
					}
				}
			}
		}
		return out
	}

	// ── Reductions ─────────────────────────────────────────────────────

	sum(axis) {
		if (axis === undefined) {
			let s = 0
			for (let i = 0; i < this.data.length; i++) s += this.data[i]
			return Tensor.from1D([s])
		}
		if (axis === 0) {
			const out = new Tensor(1, this.cols, "zeros")
			for (let j = 0; j < this.cols; j++) {
				let s = 0
				for (let i = 0; i < this.rows; i++) s += this.get(i, j)
				out.set(0, j, s)
			}
			return out
		}
		if (axis === 1) {
			const out = new Tensor(this.rows, 1, "zeros")
			for (let i = 0; i < this.rows; i++) {
				let s = 0
				for (let j = 0; j < this.cols; j++) s += this.get(i, j)
				out.set(i, 0, s)
			}
			return out
		}
		throw new Error(`Invalid axis ${axis}`)
	}

	mean(axis) {
		if (axis === undefined) {
			return this.sum().div(this.data.length)
		}
		if (axis === 0) return this.sum(0).div(this.rows)
		if (axis === 1) return this.sum(1).div(this.cols)
		throw new Error(`Invalid axis ${axis}`)
	}

	max() {
		let m = -Infinity
		for (let i = 0; i < this.data.length; i++) if (this.data[i] > m) m = this.data[i]
		return m
	}

	min() {
		let m = Infinity
		for (let i = 0; i < this.data.length; i++) if (this.data[i] < m) m = this.data[i]
		return m
	}

	// ── In-place ops ───────────────────────────────────────────────────

	addInPlace(other) {
		if (this.rows !== other.rows || this.cols !== other.cols) {
			throw new Error("addInPlace shape mismatch")
		}
		for (let i = 0; i < this.data.length; i++) this.data[i] += other.data[i]
	}

	mulInPlace(scalar) {
		for (let i = 0; i < this.data.length; i++) this.data[i] *= scalar
	}

	// ── Utilities ──────────────────────────────────────────────────────

	to2D() {
		const out = []
		for (let i = 0; i < this.rows; i++) {
			const row = []
			for (let j = 0; j < this.cols; j++) row.push(this.get(i, j))
			out.push(row)
		}
		return out
	}

	to1D() {
		return Array.from(this.data)
	}

	argmax(axis = 1) {
		if (axis !== 1) throw new Error("argmax only supports axis=1")
		const out = []
		for (let i = 0; i < this.rows; i++) {
			let bestJ = 0
			let bestV = this.get(i, 0)
			for (let j = 1; j < this.cols; j++) {
				const v = this.get(i, j)
				if (v > bestV) {
					bestV = v
					bestJ = j
				}
			}
			out.push(bestJ)
		}
		return out
	}

	/** Extract rows [start, end) into a new Tensor. */
	sliceRows(start, end) {
		if (start < 0 || end > this.rows || start >= end) {
			throw new Error(`Invalid slice: [${start}, ${end}) for tensor with ${this.rows} rows`)
		}
		const newRows = end - start
		const out = new Tensor(newRows, this.cols, "zeros")
		for (let i = 0; i < newRows; i++) {
			for (let j = 0; j < this.cols; j++) {
				out.set(i, j, this.get(start + i, j))
			}
		}
		return out
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Layer types
// ═══════════════════════════════════════════════════════════════════════════════

// ── Dense (fully-connected) layer ────────────────────────────────────────────

class DenseLayer {
	constructor(inFeatures, outFeatures, init = "xavier") {
		this.inFeatures = inFeatures
		this.outFeatures = outFeatures
		this.weights = new Tensor(inFeatures, outFeatures, init)
		this.biases = new Tensor(1, outFeatures, "zeros")
		this.weightGrad = new Tensor(inFeatures, outFeatures, "zeros")
		this.biasGrad = new Tensor(1, outFeatures, "zeros")
		this.inputCache = null
	}

	forward(input) {
		this.inputCache = input.clone()
		const out = input.matmul(this.weights).add(this.biases)
		return out
	}

	backward(outputGrad) {
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

	parameters() {
		return [
			{ tensor: this.weights, grad: this.weightGrad, name: "W" },
			{ tensor: this.biases, grad: this.biasGrad, name: "b" },
		]
	}

	describe() {
		return `Dense(${this.inFeatures} → ${this.outFeatures})`
	}
}

// ── Activation layers ───────────────────────────────────────────────────────

class ReLULayer {
	constructor() {
		this.maskCache = null
	}

	forward(input) {
		const out = new Tensor(input.rows, input.cols, "zeros")
		this.maskCache = new Tensor(input.rows, input.cols, "zeros")
		for (let i = 0; i < input.data.length; i++) {
			const v = input.data[i]
			out.data[i] = v > 0 ? v : 0
			this.maskCache.data[i] = v > 0 ? 1 : 0
		}
		return out
	}

	backward(outputGrad) {
		if (!this.maskCache) throw new Error("backward called before forward")
		const out = new Tensor(outputGrad.rows, outputGrad.cols, "zeros")
		for (let i = 0; i < outputGrad.data.length; i++) {
			out.data[i] = outputGrad.data[i] * this.maskCache.data[i]
		}
		return out
	}

	parameters() {
		return []
	}

	describe() {
		return "ReLU"
	}
}

class SigmoidLayer {
	constructor() {
		this.outputCache = null
	}

	forward(input) {
		const out = new Tensor(input.rows, input.cols, "zeros")
		for (let i = 0; i < input.data.length; i++) {
			out.data[i] = 1 / (1 + Math.exp(-input.data[i]))
		}
		this.outputCache = out.clone()
		return out
	}

	backward(outputGrad) {
		if (!this.outputCache) throw new Error("backward called before forward")
		const out = new Tensor(outputGrad.rows, outputGrad.cols, "zeros")
		for (let i = 0; i < outputGrad.data.length; i++) {
			const s = this.outputCache.data[i]
			out.data[i] = outputGrad.data[i] * s * (1 - s)
		}
		return out
	}

	parameters() {
		return []
	}

	describe() {
		return "Sigmoid"
	}
}

class TanhLayer {
	constructor() {
		this.outputCache = null
	}

	forward(input) {
		const out = new Tensor(input.rows, input.cols, "zeros")
		for (let i = 0; i < input.data.length; i++) {
			out.data[i] = Math.tanh(input.data[i])
		}
		this.outputCache = out.clone()
		return out
	}

	backward(outputGrad) {
		if (!this.outputCache) throw new Error("backward called before forward")
		const out = new Tensor(outputGrad.rows, outputGrad.cols, "zeros")
		for (let i = 0; i < outputGrad.data.length; i++) {
			const t = this.outputCache.data[i]
			out.data[i] = outputGrad.data[i] * (1 - t * t)
		}
		return out
	}

	parameters() {
		return []
	}

	describe() {
		return "Tanh"
	}
}

class SoftmaxLayer {
	constructor() {
		this.outputCache = null
	}

	forward(input) {
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

	backward(outputGrad) {
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

	parameters() {
		return []
	}

	describe() {
		return "Softmax"
	}
}

// ── Dropout (training-time regularisation) ───────────────────────────────────

class DropoutLayer {
	constructor(rate = 0.5) {
		if (rate < 0 || rate >= 1) throw new Error("Dropout rate must be in [0, 1)")
		this.rate = rate
		this.currentRate = rate
		this.maskCache = null
		this.training = true
	}

	setTraining(v) {
		this.training = v
	}

	setRate(newRate) {
		if (newRate < 0 || newRate >= 1) throw new Error("Dropout rate must be in [0, 1)")
		this.currentRate = newRate
	}

	getRate() {
		return this.currentRate
	}

	resetRate() {
		this.currentRate = this.rate
	}

	forward(input) {
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

	backward(outputGrad) {
		if (!this.maskCache) throw new Error("backward called before forward")
		const out = new Tensor(outputGrad.rows, outputGrad.cols, "zeros")
		const scale = 1 / (1 - this.currentRate)
		for (let i = 0; i < outputGrad.data.length; i++) {
			out.data[i] = outputGrad.data[i] * this.maskCache.data[i] * scale
		}
		return out
	}

	parameters() {
		return []
	}

	describe() {
		return `Dropout(p=${this.currentRate})`
	}
}

// ── Batch Normalisation ─────────────────────────────────────────────────────

class BatchNormLayer {
	constructor(features, affine = true) {
		this.features = features
		this.affine = affine
		this.gamma = new Tensor(1, features, "ones")
		this.beta = new Tensor(1, features, "zeros")
		this.gammaGrad = new Tensor(1, features, "zeros")
		this.betaGrad = new Tensor(1, features, "zeros")
		this.runningMean = new Tensor(1, features, "zeros")
		this.runningVar = new Tensor(1, features, "ones")
		this.inputCache = null
		this.meanCache = null
		this.varCache = null
		this.normCache = null
		this.training = true
		this.momentum = 0.9
		this.eps = 1e-5
	}

	setTraining(v) {
		this.training = v
	}

	forward(input) {
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

	backward(outputGrad) {
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

	parameters() {
		if (!this.affine) return []
		return [
			{ tensor: this.gamma, grad: this.gammaGrad, name: "gamma" },
			{ tensor: this.beta, grad: this.betaGrad, name: "beta" },
			{ tensor: this.runningMean, grad: new Tensor(1, this.features, "zeros"), name: "runningMean" },
			{ tensor: this.runningVar, grad: new Tensor(1, this.features, "zeros"), name: "runningVar" },
		]
	}

	describe() {
		return `BatchNorm(${this.features})`
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Loss Functions
// ═══════════════════════════════════════════════════════════════════════════════

// ── Cross-entropy (for classification) ──────────────────────────────────────

class CrossEntropyLoss {
	forward(pred, target) {
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

// ── Mean Squared Error (for regression) ─────────────────────────────────────

class MSELoss {
	forward(pred, target) {
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

// ── Huber Loss — combines MSE and MAE, robust to outliers ───────────────────

class HuberLoss {
	constructor(delta = 1.0) {
		this.delta = delta
	}

	forward(pred, target) {
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

// ── Hinge Loss — for SVM-style classification (targets should be -1 or 1) ───

class HingeLoss {
	forward(pred, target) {
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

// ── Mean Absolute Error (for regression, robust to outliers) ────────────────

class MAELoss {
	forward(pred, target) {
		if (pred.rows !== target.rows || pred.cols !== target.cols) {
			throw new Error("Shape mismatch in MAELoss")
		}
		let totalLoss = 0
		const grad = new Tensor(pred.rows, pred.cols, "zeros")
		const n = pred.rows * pred.cols
		for (let i = 0; i < pred.rows; i++) {
			for (let j = 0; j < pred.cols; j++) {
				const diff = pred.get(i, j) - target.get(i, j)
				totalLoss += Math.abs(diff)
				grad.set(i, j, Math.sign(diff) / n)
			}
		}
		return { loss: totalLoss / n, grad }
	}
}

// ── KL Divergence — for variational models, knowledge distillation ──────────

class KLLoss {
	forward(pred, target) {
		if (pred.rows !== target.rows || pred.cols !== target.cols) {
			throw new Error("Shape mismatch in KLLoss")
		}
		let totalLoss = 0
		const grad = new Tensor(pred.rows, pred.cols, "zeros")
		const rowNorm = 1 / pred.rows
		for (let i = 0; i < pred.rows; i++) {
			for (let j = 0; j < pred.cols; j++) {
				const p = Math.max(pred.get(i, j), 1e-8)
				const t = Math.max(target.get(i, j), 1e-8)
				totalLoss += t * Math.log(t / p)
				// Gradient of KL(p||t) w.r.t. p: -t/p
				grad.set(i, j, (-t / p) * rowNorm)
			}
		}
		return { loss: totalLoss / pred.rows, grad }
	}
}

// ── Cosine Similarity Loss — for embedding/similarity learning ──────────────

class CosineSimilarityLoss {
	forward(pred, target) {
		if (pred.rows !== target.rows || pred.cols !== target.cols) {
			throw new Error("Shape mismatch in CosineSimilarityLoss")
		}
		let totalLoss = 0
		const grad = new Tensor(pred.rows, pred.cols, "zeros")
		const n = pred.rows

		for (let i = 0; i < pred.rows; i++) {
			// Extract row vectors
			let dot = 0
			let normPred = 0
			let normTarget = 0
			for (let j = 0; j < pred.cols; j++) {
				const p = pred.get(i, j)
				const t = target.get(i, j)
				dot += p * t
				normPred += p * p
				normTarget += t * t
			}
			normPred = Math.sqrt(Math.max(normPred, 1e-8))
			normTarget = Math.sqrt(Math.max(normTarget, 1e-8))
			const cosine = dot / (normPred * normTarget)
			// Loss = 1 - cosine (range [0, 2])
			totalLoss += 1 - cosine

			// Gradient of (1 - cosine) w.r.t. pred row
			// d/dp (1 - dot/(np*nt)) = -t/(np*nt) + dot*p/(np^3*nt)
			for (let j = 0; j < pred.cols; j++) {
				const p = pred.get(i, j)
				const t = target.get(i, j)
				const gradVal = -t / (normPred * normTarget) + (dot * p) / (normPred * normPred * normPred * normTarget)
				grad.set(i, j, gradVal / n)
			}
		}

		return { loss: totalLoss / n, grad }
	}
}

// ── Binary Cross-Entropy (for binary classification) ────────────────────────

class BCELoss {
	forward(pred, target) {
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

// ═══════════════════════════════════════════════════════════════════════════════
// Optimizers
// ═══════════════════════════════════════════════════════════════════════════════

// ── Adam (Adaptive Moment Estimation) ───────────────────────────────────────

class AdamOptimizer {
	constructor(params, beta1 = 0.9, beta2 = 0.999, eps = 1e-8, lrScheduler) {
		this.params = params
		this.beta1 = beta1
		this.beta2 = beta2
		this.eps = eps
		this.lrScheduler = lrScheduler
		this.m = new Map()
		this.v = new Map()
		this.t = 0
	}

	step(lr) {
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
			const m = this.m.get(w)
			const v = this.v.get(w)

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

	zeroGrad() {
		for (const p of this.params) {
			p.grad.data.fill(0)
		}
	}
}

// ── SGD with momentum ───────────────────────────────────────────────────────

class SGDOptimizer {
	constructor(params, momentum = 0.9, lrScheduler) {
		this.params = params
		this.momentum = momentum
		this.lrScheduler = lrScheduler
		this.velocity = new Map()
		this.t = 0
	}

	step(lr) {
		// Apply LR scheduler if present
		const effectiveLR = this.lrScheduler ? this.lrScheduler.getLearningRate(this.t) : lr
		this.t++
		for (const p of this.params) {
			const { tensor: w, grad: g } = p
			if (!this.velocity.has(w)) {
				this.velocity.set(w, new Tensor(w.rows, w.cols, "zeros"))
			}
			const v = this.velocity.get(w)
			for (let i = 0; i < w.data.length; i++) {
				v.data[i] = this.momentum * v.data[i] + g.data[i]
				w.data[i] -= effectiveLR * v.data[i]
			}
		}
	}

	zeroGrad() {
		for (const p of this.params) {
			p.grad.data.fill(0)
		}
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// NeuralNetwork
// ═══════════════════════════════════════════════════════════════════════════════

function isTrainable(l) {
	return typeof l.setTraining === "function"
}

class NeuralNetwork {
	constructor(config) {
		this.config = config
		this.layers = []
		this.optimizer = null
		this._buildLayers()
	}

	_buildLayers() {
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

	predict(input) {
		this._setTraining(false)
		let out = input
		for (const layer of this.layers) {
			out = layer.forward(out)
		}
		return out
	}

	/** Forward pass with training mode enabled (affects dropout, batch norm). */
	forwardTraining(input) {
		this._setTraining(true)
		let out = input
		for (const layer of this.layers) {
			out = layer.forward(out)
		}
		return out
	}

	/** Backward pass. Must be called after forwardTraining. Returns gradient w.r.t. input. */
	backward(outputGrad) {
		let dOut = outputGrad
		for (let li = this.layers.length - 1; li >= 0; li--) {
			dOut = this.layers[li].backward(dOut)
		}
		return dOut
	}

	/** Optimizer step. Creates optimizer lazily if needed. */
	step(learningRate) {
		if (!this.optimizer) this.optimizer = new AdamOptimizer(this._allParameters())
		this.optimizer.step(learningRate)
	}

	/** Zero all parameter gradients. */
	zeroGrad() {
		if (!this.optimizer) this.optimizer = new AdamOptimizer(this._allParameters())
		this.optimizer.zeroGrad()
	}

	/** Restore weights from serialised format. */
	deserialise(weights) {
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

	train(X, y, lossFn, cfg) {
		const losses = []
		if (!this.optimizer) this.optimizer = new AdamOptimizer(this._allParameters())
		const opt = this.optimizer
		const N = X.rows
		const valSplit = Math.floor(N * (cfg.validationSplit ?? 0))
		const trainN = N - valSplit

		for (let epoch = 0; epoch < cfg.epochs; epoch++) {
			this._setTraining(true)
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
			let valLoss
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

	_allParameters() {
		const params = []
		for (const layer of this.layers) {
			params.push(...layer.parameters())
		}
		return params
	}

	_setTraining(v) {
		for (const layer of this.layers) {
			if (isTrainable(layer)) {
				layer.setTraining(v)
			}
		}
	}

	/** Serialise weights to a plain JSON-friendly structure. */
	serialise() {
		return this.layers.map((layer) => layer.parameters().map((p) => p.tensor.to1D()))
	}

	/** Describe architecture. */
	summary() {
		return this.layers.map((l) => l.describe()).join(" → ")
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
	Tensor,
	DenseLayer,
	ReLULayer,
	SigmoidLayer,
	TanhLayer,
	SoftmaxLayer,
	DropoutLayer,
	BatchNormLayer,
	CrossEntropyLoss,
	MSELoss,
	HuberLoss,
	HingeLoss,
	MAELoss,
	KLLoss,
	CosineSimilarityLoss,
	BCELoss,
	AdamOptimizer,
	SGDOptimizer,
	NeuralNetwork,
}
