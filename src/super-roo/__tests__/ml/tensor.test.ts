import { describe, expect, it } from "vitest"
import { Tensor } from "../../ml/engine/Tensor"

describe("Tensor.div", () => {
	it("broadcasts a row vector over matrix rows in left-to-right order", () => {
		const row = Tensor.from2D([[10, 20]])
		const matrix = Tensor.from2D([
			[2, 4],
			[5, 10],
		])

		expect(row.div(matrix).to2D()).toEqual([
			[5, 5],
			[2, 2],
		])
	})

	it("broadcasts a scalar tensor over a matrix as the dividend", () => {
		const scalar = Tensor.from2D([[20]])
		const matrix = Tensor.from2D([
			[2, 4],
			[5, 10],
		])

		expect(scalar.div(matrix).to2D()).toEqual([
			[10, 5],
			[4, 2],
		])
	})
})
