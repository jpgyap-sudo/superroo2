/**
 * Super Roo ML — Tensor
 *
 * Lightweight 2-D tensor implementation for the neural network engine.
 * Supports element-wise ops, matrix multiplication, broadcasting,
 * and common utilities. No external deps.
 */

export class Tensor {
	readonly rows: number
	readonly cols: number
	readonly data: Float64Array

	constructor(rows: number, cols: number, init: "zeros" | "ones" | "random" | "xavier" | "he" = "zeros") {
		this.rows = rows
		this.cols = cols
		this.data = new Float64Array(rows * cols)
		this.fill(init)
	}

	static from2D(arr: number[][]): Tensor {
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

	static from1D(arr: number[]): Tensor {
		const t = new Tensor(1, arr.length, "zeros")
		for (let j = 0; j < arr.length; j++) {
			t.set(0, j, arr[j])
		}
		return t
	}

	static zeros(rows: number, cols: number): Tensor {
		return new Tensor(rows, cols, "zeros")
	}

	static ones(rows: number, cols: number): Tensor {
		return new Tensor(rows, cols, "ones")
	}

	static random(rows: number, cols: number, scale = 1): Tensor {
		const t = new Tensor(rows, cols, "zeros")
		for (let i = 0; i < t.data.length; i++) {
			t.data[i] = (Math.random() * 2 - 1) * scale
		}
		return t
	}

	private fill(init: "zeros" | "ones" | "random" | "xavier" | "he") {
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

	get(i: number, j: number): number {
		return this.data[i * this.cols + j]
	}

	set(i: number, j: number, v: number): void {
		this.data[i * this.cols + j] = v
	}

	shape(): [number, number] {
		return [this.rows, this.cols]
	}

	clone(): Tensor {
		const t = new Tensor(this.rows, this.cols, "zeros")
		t.data.set(this.data)
		return t
	}

	// ── Element-wise ops ───────────────────────────────────────────────

	add(other: Tensor | number): Tensor {
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
		// Broadcast row vector
		if (other.rows === 1 && other.cols === this.cols) {
			const out = new Tensor(this.rows, this.cols, "zeros")
			for (let i = 0; i < this.rows; i++) {
				for (let j = 0; j < this.cols; j++) {
					out.set(i, j, this.get(i, j) + other.get(0, j))
				}
			}
			return out
		}
		if (other.rows === 1 && other.cols === 1) {
			return this.add(other.get(0, 0))
		}
		throw new Error(
			`Tensor shape mismatch in 'add': Cannot add tensors with shapes [${this.rows},${this.cols}] and [${other.rows},${other.cols}]. ` +
				"Ensure both tensors have the same dimensions, or one is a scalar (1,1) or row vector (1,cols).",
		)
	}

	sub(other: Tensor | number): Tensor {
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
		if (other.rows === 1 && other.cols === 1) {
			return this.sub(other.get(0, 0))
		}
		throw new Error(
			`Tensor shape mismatch in 'sub': Cannot subtract tensors with shapes [${this.rows},${this.cols}] and [${other.rows},${other.cols}]. ` +
				"Ensure both tensors have the same dimensions, or one is a scalar (1,1) or row vector (1,cols).",
		)
	}

	mul(other: Tensor | number): Tensor {
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
		if (other.rows === 1 && other.cols === 1) {
			return this.mul(other.get(0, 0))
		}
		throw new Error(
			`Tensor shape mismatch in 'mul': Cannot multiply tensors with shapes [${this.rows},${this.cols}] and [${other.rows},${other.cols}]. ` +
				"Ensure both tensors have the same dimensions, or one is a scalar (1,1) or row vector (1,cols).",
		)
	}

	div(other: Tensor | number): Tensor {
		if (typeof other === "number") {
			const out = new Tensor(this.rows, this.cols, "zeros")
			for (let i = 0; i < this.data.length; i++) out.data[i] = this.data[i] / other
			return out
		}
		if (this.rows === other.rows && this.cols === other.cols) {
			const out = new Tensor(this.rows, this.cols, "zeros")
			for (let i = 0; i < this.data.length; i++) out.data[i] = this.data[i] / other.data[i]
			return out
		}
		if (other.rows === 1 && other.cols === this.cols) {
			const out = new Tensor(this.rows, this.cols, "zeros")
			for (let i = 0; i < this.rows; i++) {
				for (let j = 0; j < this.cols; j++) {
					out.set(i, j, this.get(i, j) / other.get(0, j))
				}
			}
			return out
		}
		if (other.rows === 1 && other.cols === 1) {
			return this.div(other.get(0, 0))
		}
		throw new Error(
			`Tensor shape mismatch in 'div': Cannot divide tensors with shapes [${this.rows},${this.cols}] and [${other.rows},${other.cols}]. ` +
				"Ensure both tensors have the same dimensions, or one is a scalar (1,1) or row vector (1,cols).",
		)
	}

	pow(exp: number): Tensor {
		const out = new Tensor(this.rows, this.cols, "zeros")
		for (let i = 0; i < this.data.length; i++) out.data[i] = Math.pow(this.data[i], exp)
		return out
	}

	abs(): Tensor {
		const out = new Tensor(this.rows, this.cols, "zeros")
		for (let i = 0; i < this.data.length; i++) out.data[i] = Math.abs(this.data[i])
		return out
	}

	sqrt(): Tensor {
		const out = new Tensor(this.rows, this.cols, "zeros")
		for (let i = 0; i < this.data.length; i++) out.data[i] = Math.sqrt(this.data[i])
		return out
	}

	log(): Tensor {
		const out = new Tensor(this.rows, this.cols, "zeros")
		for (let i = 0; i < this.data.length; i++) out.data[i] = Math.log(this.data[i] + 1e-8)
		return out
	}

	exp(): Tensor {
		const out = new Tensor(this.rows, this.cols, "zeros")
		for (let i = 0; i < this.data.length; i++) out.data[i] = Math.exp(this.data[i])
		return out
	}

	neg(): Tensor {
		return this.mul(-1)
	}

	// ── Matrix ops ─────────────────────────────────────────────────────

	transpose(): Tensor {
		const out = new Tensor(this.cols, this.rows, "zeros")
		for (let i = 0; i < this.rows; i++) {
			for (let j = 0; j < this.cols; j++) {
				out.set(j, i, this.get(i, j))
			}
		}
		return out
	}

	matmul(other: Tensor): Tensor {
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
			return this.matmulOptimized(other)
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
	private matmulOptimized(other: Tensor): Tensor {
		const out = new Tensor(this.rows, other.cols, "zeros")
		const TILE_SIZE = 32 // Tune based on typical CPU cache line size

		for (let i0 = 0; i0 < this.rows; i0 += TILE_SIZE) {
			for (let j0 = 0; j0 < other.cols; j0 += TILE_SIZE) {
				for (let k0 = 0; k0 < this.cols; k0 += TILE_SIZE) {
					// Process tile
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

	sum(axis?: number): Tensor {
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

	mean(axis?: number): Tensor {
		if (axis === undefined) {
			return this.sum().div(this.data.length)
		}
		if (axis === 0) return this.sum(0).div(this.rows)
		if (axis === 1) return this.sum(1).div(this.cols)
		throw new Error(`Invalid axis ${axis}`)
	}

	max(): number {
		let m = -Infinity
		for (let i = 0; i < this.data.length; i++) if (this.data[i] > m) m = this.data[i]
		return m
	}

	min(): number {
		let m = Infinity
		for (let i = 0; i < this.data.length; i++) if (this.data[i] < m) m = this.data[i]
		return m
	}

	// ── In-place ops ───────────────────────────────────────────────────

	addInPlace(other: Tensor): void {
		if (this.rows !== other.rows || this.cols !== other.cols) {
			throw new Error("addInPlace shape mismatch")
		}
		for (let i = 0; i < this.data.length; i++) this.data[i] += other.data[i]
	}

	mulInPlace(scalar: number): void {
		for (let i = 0; i < this.data.length; i++) this.data[i] *= scalar
	}

	// ── Utilities ──────────────────────────────────────────────────────

	to2D(): number[][] {
		const out: number[][] = []
		for (let i = 0; i < this.rows; i++) {
			const row: number[] = []
			for (let j = 0; j < this.cols; j++) row.push(this.get(i, j))
			out.push(row)
		}
		return out
	}

	to1D(): number[] {
		return Array.from(this.data)
	}

	argmax(axis = 1): number[] {
		if (axis !== 1) throw new Error("argmax only supports axis=1")
		const out: number[] = []
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
	sliceRows(start: number, end: number): Tensor {
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
