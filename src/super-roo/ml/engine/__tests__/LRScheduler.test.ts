/**
 * Super Roo ML — Learning Rate Scheduler Tests
 *
 * Tests StepDecayScheduler, ExponentialDecayScheduler, ReduceLROnPlateau,
 * CosineAnnealingScheduler, and DropoutScheduler.
 */

import {
	StepDecayScheduler,
	ExponentialDecayScheduler,
	ReduceLROnPlateau,
	CosineAnnealingScheduler,
	DropoutScheduler,
} from "../LRScheduler"

// ---------------------------------------------------------------------------
// StepDecayScheduler
// ---------------------------------------------------------------------------

describe("StepDecayScheduler", () => {
	it("returns initial LR before first step", () => {
		const sched = new StepDecayScheduler({
			initialLR: 0.1,
			dropFactor: 0.5,
			stepSize: 10,
		})
		expect(sched.getLearningRate(0)).toBe(0.1)
	})

	it("decays LR at step boundaries", () => {
		const sched = new StepDecayScheduler({
			initialLR: 0.1,
			dropFactor: 0.5,
			stepSize: 10,
		})
		// Before step 10: LR = 0.1
		expect(sched.getLearningRate(9)).toBe(0.1)
		// At step 10: LR = 0.1 * 0.5 = 0.05
		expect(sched.getLearningRate(10)).toBe(0.05)
		// At step 20: LR = 0.1 * 0.5^2 = 0.025
		expect(sched.getLearningRate(20)).toBe(0.025)
	})

	it("handles multiple decay steps", () => {
		const sched = new StepDecayScheduler({
			initialLR: 1.0,
			dropFactor: 0.1,
			stepSize: 1,
		})
		expect(sched.getLearningRate(0)).toBe(1.0)
		expect(sched.getLearningRate(1)).toBe(0.1)
		expect(sched.getLearningRate(2)).toBeCloseTo(0.01)
		expect(sched.getLearningRate(3)).toBeCloseTo(0.001)
	})
})

// ---------------------------------------------------------------------------
// ExponentialDecayScheduler
// ---------------------------------------------------------------------------

describe("ExponentialDecayScheduler", () => {
	it("returns initial LR at epoch 0", () => {
		const sched = new ExponentialDecayScheduler({
			initialLR: 0.1,
			decayRate: 0.9,
		})
		expect(sched.getLearningRate(0)).toBe(0.1)
	})

	it("decays exponentially", () => {
		const sched = new ExponentialDecayScheduler({
			initialLR: 1.0,
			decayRate: 0.5,
		})
		// LR = 1.0 * 0.5^1 = 0.5
		expect(sched.getLearningRate(1)).toBe(0.5)
		// LR = 1.0 * 0.5^2 = 0.25
		expect(sched.getLearningRate(2)).toBe(0.25)
		// LR = 1.0 * 0.5^10 = ~0.0009766
		expect(sched.getLearningRate(10)).toBeCloseTo(0.0009766, 4)
	})

	it("respects minLR floor", () => {
		const sched = new ExponentialDecayScheduler({
			initialLR: 0.1,
			decayRate: 0.5,
		})
		const lr = sched.getLearningRate(100)
		// minLR default is 1e-8, so LR is clamped at 1e-8
		expect(lr).toBe(1e-8)
	})
})

// ---------------------------------------------------------------------------
// ReduceLROnPlateau
// ---------------------------------------------------------------------------

describe("ReduceLROnPlateau", () => {
	it("returns initial LR", () => {
		const sched = new ReduceLROnPlateau({
			initialLR: 0.1,
			factor: 0.5,
			patience: 3,
		})
		expect(sched.getLearningRate(0)).toBe(0.1)
	})

	it("does not reduce LR before patience is exceeded", () => {
		const sched = new ReduceLROnPlateau({
			initialLR: 0.1,
			factor: 0.5,
			patience: 3,
		})
		// Loss not improving for 2 epochs (within patience)
		sched.onPlateauEnd(1.0)
		sched.onPlateauEnd(1.0)
		expect(sched.getLearningRate(2)).toBe(0.1)
	})

	it("reduces LR when patience is exceeded", () => {
		const sched = new ReduceLROnPlateau({
			initialLR: 0.1,
			factor: 0.5,
			patience: 2,
		})
		// Loss not improving for 3 epochs (exceeds patience of 2)
		sched.onPlateauEnd(1.0)
		sched.onPlateauEnd(1.0)
		sched.onPlateauEnd(1.0)
		expect(sched.getLearningRate(3)).toBe(0.05)
	})

	it("resets patience when loss improves", () => {
		const sched = new ReduceLROnPlateau({
			initialLR: 0.1,
			factor: 0.5,
			patience: 3,
		})
		sched.onPlateauEnd(1.0) // best=1.0
		sched.onPlateauEnd(0.5) // improves (0.5 < 1.0), resets patience
		sched.onPlateauEnd(0.5) // not improving (epochsSinceImprovement=1)
		sched.onPlateauEnd(0.5) // not improving (epochsSinceImprovement=2)
		// patience=3, so 2 < 3, no reduction yet
		expect(sched.getLearningRate(4)).toBe(0.1)
	})

	it("respects minLR", () => {
		const sched = new ReduceLROnPlateau({
			initialLR: 0.1,
			factor: 0.5,
			patience: 1,
			minLR: 0.01,
		})

		// ---------------------------------------------------------------------------
		// CosineAnnealingScheduler
		// ---------------------------------------------------------------------------

		describe("CosineAnnealingScheduler", () => {
			it("returns initial LR at epoch 0", () => {
				const sched = new CosineAnnealingScheduler({
					initialLR: 0.1,
					T_max: 10,
				})
				expect(sched.getLearningRate(0)).toBeCloseTo(0.1, 6)
			})

			it("reaches minLR at T_max", () => {
				const sched = new CosineAnnealingScheduler({
					initialLR: 0.1,
					T_max: 10,
					minLR: 0.01,
				})
				const lr = sched.getLearningRate(10)
				expect(lr).toBeCloseTo(0.01, 4)
			})

			it("follows cosine curve", () => {
				const sched = new CosineAnnealingScheduler({
					initialLR: 1.0,
					T_max: 4,
					minLR: 0,
				})
				// At T_max/2 = 2, LR should be at midpoint
				const lrMid = sched.getLearningRate(2)
				expect(lrMid).toBeCloseTo(0.5, 2)
				// At T_max = 4, LR should be 0
				const lrEnd = sched.getLearningRate(4)
				expect(lrEnd).toBeCloseTo(0, 2)
			})

			it("resets after warm restart", () => {
				const sched = new CosineAnnealingScheduler({
					initialLR: 0.1,
					T_max: 5,
					T_mult: 2,
				})
				// First cycle: T_max=5
				const lrEnd1 = sched.getLearningRate(5)
				expect(lrEnd1).toBeCloseTo(0, 2)
				// Second cycle: T_max=10 (T_mult=2)
				const lrStart2 = sched.getLearningRate(6)
				expect(lrStart2).toBeCloseTo(0.1, 2)
			})

			it("handles reset() correctly", () => {
				const sched = new CosineAnnealingScheduler({
					initialLR: 0.1,
					T_max: 5,
				})
				sched.getLearningRate(5)
				sched.reset()
				expect(sched.getLearningRate(0)).toBeCloseTo(0.1, 6)
			})
		})

		// ---------------------------------------------------------------------------
		// DropoutScheduler
		// ---------------------------------------------------------------------------

		describe("DropoutScheduler", () => {
			it("returns initial rate at epoch 0", () => {
				const sched = new DropoutScheduler({
					initialRate: 0.5,
					finalRate: 0.1,
					totalEpochs: 100,
					mode: "linear",
				})
				expect(sched.getRate(0)).toBe(0.5)
			})

			it("reaches final rate at totalEpochs (linear mode)", () => {
				const sched = new DropoutScheduler({
					initialRate: 0.5,
					finalRate: 0.1,
					totalEpochs: 100,
					mode: "linear",
				})
				expect(sched.getRate(100)).toBeCloseTo(0.1, 4)
			})

			it("decays exponentially in exponential mode", () => {
				const sched = new DropoutScheduler({
					initialRate: 0.5,
					finalRate: 0.1,
					totalEpochs: 100,
					mode: "exponential",
				})
				const mid = sched.getRate(50)
				// Exponential decay should be faster than linear at midpoint
				const linearMid = 0.5 - (0.5 - 0.1) * (50 / 100) // 0.3
				expect(mid).toBeLessThan(linearMid)
			})

			it("follows cosine curve in cosine mode", () => {
				const sched = new DropoutScheduler({
					initialRate: 0.5,
					finalRate: 0.1,
					totalEpochs: 100,
					mode: "cosine",
				})
				const mid = sched.getRate(50)
				// Cosine midpoint should be between linear and exponential
				const linearMid = 0.5 - (0.5 - 0.1) * (50 / 100) // 0.3
				expect(mid).toBeGreaterThan(linearMid * 0.8)
				expect(mid).toBeLessThan(0.5)
			})

			it("clamps rate between finalRate and initialRate", () => {
				const sched = new DropoutScheduler({
					initialRate: 0.5,
					finalRate: 0.1,
					totalEpochs: 100,
					mode: "linear",
				})
				// Beyond totalEpochs, rate should be clamped to finalRate
				expect(sched.getRate(200)).toBeCloseTo(0.1, 4)
				// Before epoch 0, rate should be initialRate
				expect(sched.getRate(0)).toBe(0.5)
			})
		})
		// Reduce 3 times: 0.1 -> 0.05 -> 0.025 -> 0.0125 (stopped by minLR=0.01)
		sched.onPlateauEnd(1.0)
		sched.onPlateauEnd(1.0)
		sched.onPlateauEnd(1.0)
		const lr = sched.getLearningRate(3)
		expect(lr).toBeGreaterThanOrEqual(0.01)
	})

	it("resets state correctly", () => {
		const sched = new ReduceLROnPlateau({
			initialLR: 0.1,
			factor: 0.5,
			patience: 1,
		})
		sched.onPlateauEnd(1.0)
		sched.onPlateauEnd(1.0)
		expect(sched.getLearningRate(2)).toBe(0.05)
		sched.reset()
		expect(sched.getLearningRate(3)).toBe(0.1)
	})
})
