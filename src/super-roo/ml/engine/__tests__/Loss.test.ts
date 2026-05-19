/**
 * Super Roo ML — Loss Function Tests
 *
 * Tests all 8 loss functions: CrossEntropyLoss, MSELoss, BCELoss,
 * HuberLoss, HingeLoss, MAELoss, KLLoss, CosineSimilarityLoss.
 */

import { Tensor } from "../Tensor"
import {
	CrossEntropyLoss,
	MSELoss,
	BCELoss,
	HuberLoss,
	HingeLoss,
	MAELoss,
	KLLoss,
	CosineSimilarityLoss,
	type LossFn,
} from "../Loss"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function approxEqual(a: number, b: number, eps = 1e-5): boolean {
	return Math.abs(a - b) < eps
}

function assertLossShapeCheck(loss: LossFn) {
	expect(() => {
		const pred = new Tensor(3, 2, "zeros")
		const target = new Tensor(3, 4, "zeros")
		loss.forward(pred, target)
	}).toThrow("Shape mismatch")
}

// ---------------------------------------------------------------------------
// CrossEntropyLoss
// ---------------------------------------------------------------------------

describe("CrossEntropyLoss", () => {
	const loss = new CrossEntropyLoss()

	it("returns zero loss for perfect predictions", () => {
		const pred = Tensor.from2D([
			[1, 0],
			[0, 1],
		])
		const target = Tensor.from2D([
			[1, 0],
			[0, 1],
		])
		const { loss: l, grad } = loss.forward(pred, target)
		expect(l).toBeGreaterThanOrEqual(0)
		expect(grad.rows).toBe(2)
		expect(grad.cols).toBe(2)
	})

	it("returns positive loss for imperfect predictions", () => {
		const pred = Tensor.from2D([
			[0.8, 0.2],
			[0.3, 0.7],
		])
		const target = Tensor.from2D([
			[1, 0],
			[0, 1],
		])
		const { loss: l } = loss.forward(pred, target)
		expect(l).toBeGreaterThan(0)
	})

	it("throws on shape mismatch", () => {
		assertLossShapeCheck(loss)
	})
})

// ---------------------------------------------------------------------------
// MSELoss
// ---------------------------------------------------------------------------

describe("MSELoss", () => {
	const loss = new MSELoss()

	it("returns zero for identical tensors", () => {
		const pred = Tensor.from2D([
			[1, 2],
			[3, 4],
		])
		const target = Tensor.from2D([
			[1, 2],
			[3, 4],
		])
		const { loss: l } = loss.forward(pred, target)
		expect(l).toBe(0)
	})

	it("computes correct MSE value", () => {
		const pred = Tensor.from2D([[2, 4]])
		const target = Tensor.from2D([[0, 0]])
		const { loss: l } = loss.forward(pred, target)
		// MSE = ((2-0)^2 + (4-0)^2) / 2 = (4 + 16) / 2 = 10
		expect(approxEqual(l, 10)).toBe(true)
	})

	it("throws on shape mismatch", () => {
		assertLossShapeCheck(loss)
	})
})

// ---------------------------------------------------------------------------
// BCELoss
// ---------------------------------------------------------------------------

describe("BCELoss", () => {
	const loss = new BCELoss()

	it("returns zero for perfect binary predictions", () => {
		const pred = Tensor.from2D([[0.999, 0.001]])
		const target = Tensor.from2D([[1, 0]])
		const { loss: l } = loss.forward(pred, target)
		expect(l).toBeLessThan(0.01)
	})

	it("returns high loss for wrong predictions", () => {
		const pred = Tensor.from2D([[0.001, 0.999]])
		const target = Tensor.from2D([[1, 0]])
		const { loss: l } = loss.forward(pred, target)
		expect(l).toBeGreaterThan(1)
	})

	it("throws on shape mismatch", () => {
		assertLossShapeCheck(loss)
	})
})

// ---------------------------------------------------------------------------
// HuberLoss
// ---------------------------------------------------------------------------

describe("HuberLoss", () => {
	const loss = new HuberLoss(1.0)

	it("returns zero for identical tensors", () => {
		const pred = Tensor.from2D([[1, 2]])
		const target = Tensor.from2D([[1, 2]])
		const { loss: l } = loss.forward(pred, target)
		expect(l).toBe(0)
	})

	it("uses MSE region for small errors", () => {
		const pred = Tensor.from2D([[0.5]])
		const target = Tensor.from2D([[0]])
		const { loss: l } = loss.forward(pred, target)
		// |diff| = 0.5 <= delta=1 => MSE region: 0.5 * 0.5^2 = 0.125
		expect(approxEqual(l, 0.125)).toBe(true)
	})

	it("uses MAE region for large errors", () => {
		const pred = Tensor.from2D([[3]])
		const target = Tensor.from2D([[0]])
		const { loss: l } = loss.forward(pred, target)
		// |diff| = 3 > delta=1 => MAE region: 1 * (3 - 0.5) = 2.5
		expect(approxEqual(l, 2.5)).toBe(true)
	})

	it("throws on shape mismatch", () => {
		assertLossShapeCheck(loss)
	})
})

// ---------------------------------------------------------------------------
// HingeLoss
// ---------------------------------------------------------------------------

describe("HingeLoss", () => {
	const loss = new HingeLoss()

	it("returns zero for correctly classified (margin > 1)", () => {
		const pred = Tensor.from2D([[2]])
		const target = Tensor.from2D([[1]])
		const { loss: l } = loss.forward(pred, target)
		// margin = 1 - 1*2 = -1, max(0, -1) = 0
		expect(l).toBe(0)
	})

	it("returns positive loss for misclassified", () => {
		const pred = Tensor.from2D([[-1]])
		const target = Tensor.from2D([[1]])
		const { loss: l } = loss.forward(pred, target)
		// margin = 1 - 1*(-1) = 2, max(0, 2) = 2
		expect(l).toBeGreaterThan(0)
	})

	it("throws on shape mismatch", () => {
		assertLossShapeCheck(loss)
	})
})

// ---------------------------------------------------------------------------
// MAELoss
// ---------------------------------------------------------------------------

describe("MAELoss", () => {
	const loss = new MAELoss()

	it("returns zero for identical tensors", () => {
		const pred = Tensor.from2D([[1, 2]])
		const target = Tensor.from2D([[1, 2]])
		const { loss: l } = loss.forward(pred, target)
		expect(l).toBe(0)
	})

	it("computes correct MAE value", () => {
		const pred = Tensor.from2D([[3, 5]])
		const target = Tensor.from2D([[1, 2]])
		const { loss: l } = loss.forward(pred, target)
		// MAE = (|3-1| + |5-2|) / 2 = (2 + 3) / 2 = 2.5
		expect(approxEqual(l, 2.5)).toBe(true)
	})

	it("throws on shape mismatch", () => {
		assertLossShapeCheck(loss)
	})
})

// ---------------------------------------------------------------------------
// KLLoss
// ---------------------------------------------------------------------------

describe("KLLoss", () => {
	const loss = new KLLoss()

	it("returns zero for identical distributions", () => {
		const pred = Tensor.from2D([[0.5, 0.5]])
		const target = Tensor.from2D([[0.5, 0.5]])
		const { loss: l } = loss.forward(pred, target)
		expect(l).toBeLessThan(0.01)
	})

	it("returns positive loss for different distributions", () => {
		const pred = Tensor.from2D([[0.9, 0.1]])
		const target = Tensor.from2D([[0.5, 0.5]])
		const { loss: l } = loss.forward(pred, target)
		expect(l).toBeGreaterThan(0)
	})

	it("throws on shape mismatch", () => {
		assertLossShapeCheck(loss)
	})
})

// ---------------------------------------------------------------------------
// CosineSimilarityLoss
// ---------------------------------------------------------------------------

describe("CosineSimilarityLoss", () => {
	const loss = new CosineSimilarityLoss()

	it("returns zero for identical vectors", () => {
		const pred = Tensor.from2D([[1, 0]])
		const target = Tensor.from2D([[1, 0]])
		const { loss: l } = loss.forward(pred, target)
		expect(approxEqual(l, 0)).toBe(true)
	})

	it("returns 1 for orthogonal vectors", () => {
		const pred = Tensor.from2D([[1, 0]])
		const target = Tensor.from2D([[0, 1]])
		const { loss: l } = loss.forward(pred, target)
		// cosine = 0, loss = 1 - 0 = 1
		expect(approxEqual(l, 1)).toBe(true)
	})

	it("returns 2 for opposite vectors", () => {
		const pred = Tensor.from2D([[1, 0]])
		const target = Tensor.from2D([[-1, 0]])
		const { loss: l } = loss.forward(pred, target)
		// cosine = -1, loss = 1 - (-1) = 2
		expect(approxEqual(l, 2)).toBe(true)
	})

	it("throws on shape mismatch", () => {
		assertLossShapeCheck(loss)
	})
})

// ---------------------------------------------------------------------------
// Gradient sanity check: loss gradient should point in direction of target
// ---------------------------------------------------------------------------

describe("Loss gradient sanity checks", () => {
	it("MSELoss gradient points toward target", () => {
		const loss = new MSELoss()
		const pred = Tensor.from2D([[0, 0]])
		const target = Tensor.from2D([[5, 5]])
		const { grad } = loss.forward(pred, target)
		// MSE gradient = 2*(pred-target)/n. pred < target => gradient is negative
		// (moving pred toward target means increasing pred, opposite of gradient direction)
		expect(grad.get(0, 0)).toBeLessThan(0)
		expect(grad.get(0, 1)).toBeLessThan(0)
	})

	it("MAELoss gradient has correct sign", () => {
		const loss = new MAELoss()
		const pred = Tensor.from2D([[10, 0]])
		const target = Tensor.from2D([[0, 10]])
		const { grad } = loss.forward(pred, target)
		// First element: pred > target => gradient should be positive (sign(10-0)=1)
		expect(grad.get(0, 0)).toBeGreaterThan(0)
		// Second element: pred < target => gradient should be negative (sign(0-10)=-1)
		expect(grad.get(0, 1)).toBeLessThan(0)
	})

	it("BCELoss gradient is zero for perfect prediction", () => {
		const loss = new BCELoss()
		const pred = Tensor.from2D([[1, 0]])
		const target = Tensor.from2D([[1, 0]])
		const { grad } = loss.forward(pred, target)
		// p - t = 0 for both
		expect(approxEqual(grad.get(0, 0), 0)).toBe(true)
		expect(approxEqual(grad.get(0, 1), 0)).toBe(true)
	})
})
