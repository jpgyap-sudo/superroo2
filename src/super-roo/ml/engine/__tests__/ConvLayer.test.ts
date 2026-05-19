/**
 * Super Roo ML — Convolutional Layer Tests
 *
 * Tests Conv2D, MaxPool2D, and Flatten layers.
 */

import { Tensor } from "../Tensor"
import { Conv2D, MaxPool2D, Flatten } from "../layers/conv"

// ---------------------------------------------------------------------------
// Conv2D
// ---------------------------------------------------------------------------

describe("Conv2D", () => {
	it("produces correct output shape for valid padding", () => {
		const conv = new Conv2D({
			inChannels: 1,
			outChannels: 2,
			kernelHeight: 3,
			kernelWidth: 3,
			inputHeight: 5,
			inputWidth: 5,
			stride: 1,
			padding: 0,
		})
		// Input: batch=1, channels=1, height=5, width=5 => cols = 1*5*5 = 25
		const input = new Tensor(1, 25)
		input.data.fill(1.0)
		const output = conv.forward(input)
		// With valid padding: (5-3)/1+1 = 3 => outCh*OH*OW = 2*3*3 = 18
		expect(output.rows).toBe(1)
		expect(output.cols).toBe(2 * 3 * 3) // 18
	})

	it("produces correct output shape for same padding", () => {
		const conv = new Conv2D({
			inChannels: 1,
			outChannels: 2,
			kernelHeight: 3,
			kernelWidth: 3,
			inputHeight: 5,
			inputWidth: 5,
			stride: 1,
			padding: 1,
		})
		const input = new Tensor(1, 25)
		input.data.fill(1.0)
		const output = conv.forward(input)
		// With same padding: output spatial = 5
		expect(output.rows).toBe(1)
		expect(output.cols).toBe(2 * 5 * 5) // 50
	})

	it("handles stride > 1", () => {
		const conv = new Conv2D({
			inChannels: 1,
			outChannels: 1,
			kernelHeight: 3,
			kernelWidth: 3,
			inputHeight: 7,
			inputWidth: 7,
			stride: 2,
			padding: 0,
		})
		const input = new Tensor(1, 49)
		input.data.fill(1.0)
		const output = conv.forward(input)
		// (7-3)/2+1 = 3
		expect(output.rows).toBe(1)
		expect(output.cols).toBe(1 * 3 * 3) // 9
	})

	it("backward returns gradient with same shape as input", () => {
		const conv = new Conv2D({
			inChannels: 1,
			outChannels: 2,
			kernelHeight: 3,
			kernelWidth: 3,
			inputHeight: 5,
			inputWidth: 5,
			stride: 1,
			padding: 0,
		})
		const input = new Tensor(1, 25)
		input.data.fill(1.0)
		conv.forward(input)

		const outputGrad = new Tensor(1, 2 * 3 * 3)
		outputGrad.data.fill(1.0)
		const inputGrad = conv.backward(outputGrad)
		expect(inputGrad.rows).toBe(1)
		expect(inputGrad.cols).toBe(25)
	})

	it("returns parameters with correct shapes", () => {
		const conv = new Conv2D({
			inChannels: 1,
			outChannels: 2,
			kernelHeight: 3,
			kernelWidth: 3,
			inputHeight: 5,
			inputWidth: 5,
			stride: 1,
			padding: 0,
		})
		const params = conv.parameters()
		// Weight: [outChannels, inChannels * KH * KW] = [2, 1*3*3] = 18 params
		// Bias: [1, outChannels] = 2 params
		expect(params.length).toBe(2)
		expect(params[0].tensor.data.length).toBe(2 * 1 * 3 * 3) // 18
		expect(params[1].tensor.data.length).toBe(2) // bias
	})
})

// ---------------------------------------------------------------------------
// MaxPool2D
// ---------------------------------------------------------------------------

describe("MaxPool2D", () => {
	it("reduces spatial dimensions", () => {
		const pool = new MaxPool2D({
			poolHeight: 2,
			poolWidth: 2,
			stride: 2,
			inputHeight: 4,
			inputWidth: 4,
			channels: 1,
		})
		// Input: batch=1, channels=1, height=4, width=4 => cols = 1*4*4 = 16
		const input = new Tensor(1, 16)
		input.data.fill(1.0)
		const output = pool.forward(input)
		expect(output.rows).toBe(1)
		expect(output.cols).toBe(1 * 2 * 2) // 4
	})

	it("selects maximum value in each pool window", () => {
		const pool = new MaxPool2D({
			poolHeight: 2,
			poolWidth: 2,
			stride: 2,
			inputHeight: 2,
			inputWidth: 2,
			channels: 1,
		})
		// 2x2 input with values [1, 2, 3, 4]
		const input = new Tensor(1, 4)
		input.data.set([1, 2, 3, 4])
		const output = pool.forward(input)
		expect(output.rows).toBe(1)
		expect(output.cols).toBe(1)
		expect(output.get(0, 0)).toBe(4)
	})

	it("backward returns gradient with same shape as input", () => {
		const pool = new MaxPool2D({
			poolHeight: 2,
			poolWidth: 2,
			stride: 2,
			inputHeight: 4,
			inputWidth: 4,
			channels: 1,
		})
		const input = new Tensor(1, 16)
		input.data.fill(1.0)
		pool.forward(input)

		const outputGrad = new Tensor(1, 4)
		outputGrad.data.fill(1.0)
		const inputGrad = pool.backward(outputGrad)
		expect(inputGrad.rows).toBe(1)
		expect(inputGrad.cols).toBe(16)
	})

	it("handles overlapping pools (stride < poolSize)", () => {
		const pool = new MaxPool2D({
			poolHeight: 3,
			poolWidth: 3,
			stride: 1,
			inputHeight: 5,
			inputWidth: 5,
			channels: 1,
		})
		const input = new Tensor(1, 25)
		input.data.fill(1.0)
		const output = pool.forward(input)
		// (5-3)/1+1 = 3
		expect(output.rows).toBe(1)
		expect(output.cols).toBe(1 * 3 * 3) // 9
	})
})

// ---------------------------------------------------------------------------
// Flatten
// ---------------------------------------------------------------------------

describe("Flatten", () => {
	it("flattens spatial dimensions into 1D per batch", () => {
		const flatten = new Flatten({ channels: 3, height: 4, width: 5 })
		// Input: batch=2, channels=3, height=4, width=5 => cols = 3*4*5 = 60
		const input = new Tensor(2, 60)
		const output = flatten.forward(input)
		expect(output.rows).toBe(2)
		expect(output.cols).toBe(60)
	})

	it("backward returns gradient with same shape as input", () => {
		const flatten = new Flatten({ channels: 3, height: 4, width: 5 })
		const input = new Tensor(1, 60)
		flatten.forward(input)

		const outputGrad = new Tensor(1, 60)
		outputGrad.data.fill(1.0)
		const inputGrad = flatten.backward(outputGrad)
		expect(inputGrad.rows).toBe(1)
		expect(inputGrad.cols).toBe(60)
	})

	it("handles 2D input (already flat)", () => {
		const flatten = new Flatten({ channels: 1, height: 1, width: 10 })
		const input = new Tensor(2, 10)
		const output = flatten.forward(input)
		expect(output.rows).toBe(2)
		expect(output.cols).toBe(10)
	})
})
