import { describe, it, expect } from "vitest"
import { ConstantSkillLR, LinearSkillLR, CosineSkillLR, buildSkillLRScheduler } from "../SkillLRScheduler"

describe("ConstantSkillLR", () => {
	it("returns maxEdits for every step", () => {
		const s = new ConstantSkillLR(10, 1, 100)
		for (let i = 0; i < 10; i++) {
			expect(s.step()).toBe(10)
		}
	})

	it("peek returns same value without advancing", () => {
		const s = new ConstantSkillLR(5, 1, 100)
		expect(s.peek()).toBe(5)
		expect(s.peek()).toBe(5) // still 5
		s.step()
		expect(s.peek()).toBe(5) // still 5 after step
	})

	it("reset restores state", () => {
		const s = new ConstantSkillLR(10, 1, 100)
		s.step()
		s.step()
		s.reset()
		expect(s.peek()).toBe(10)
	})

	it("throws on invalid params", () => {
		expect(() => new ConstantSkillLR(0, 1, 100)).toThrow("maxEdits must be >= 1")
		expect(() => new ConstantSkillLR(5, 0, 100)).toThrow("minEdits must be >= 1")
		expect(() => new ConstantSkillLR(3, 5, 100)).toThrow("minEdits must be <= maxEdits")
		expect(() => new ConstantSkillLR(5, 1, 0)).toThrow("totalSteps must be >= 1")
	})
})

describe("LinearSkillLR", () => {
	it("decays linearly from maxEdits to minEdits", () => {
		const s = new LinearSkillLR(10, 2, 10)
		const values: number[] = []
		for (let i = 0; i < 10; i++) {
			values.push(s.step())
		}
		// First step should be maxEdits
		expect(values[0]).toBe(10)
		// Last step should be minEdits
		expect(values[9]).toBe(2)
		// Should be monotonically decreasing
		for (let i = 1; i < values.length; i++) {
			expect(values[i]).toBeLessThanOrEqual(values[i - 1])
		}
	})

	it("clamps to minEdits after total steps", () => {
		const s = new LinearSkillLR(10, 2, 5)
		for (let i = 0; i < 5; i++) s.step()
		// After total steps, should stay at minEdits
		expect(s.step()).toBe(2)
		expect(s.step()).toBe(2)
	})
})

describe("CosineSkillLR", () => {
	it("decays smoothly from maxEdits to minEdits", () => {
		const s = new CosineSkillLR(10, 1, 10)
		const values: number[] = []
		for (let i = 0; i < 10; i++) {
			values.push(s.step())
		}
		expect(values[0]).toBe(10)
		expect(values[9]).toBe(1)
		// Should be monotonically decreasing
		for (let i = 1; i < values.length; i++) {
			expect(values[i]).toBeLessThanOrEqual(values[i - 1])
		}
	})
})

describe("buildSkillLRScheduler", () => {
	it("builds constant scheduler", () => {
		const s = buildSkillLRScheduler("constant", 10, 1, 100)
		expect(s).toBeInstanceOf(ConstantSkillLR)
	})

	it("builds linear scheduler", () => {
		const s = buildSkillLRScheduler("linear", 10, 1, 100)
		expect(s).toBeInstanceOf(LinearSkillLR)
	})

	it("builds cosine scheduler", () => {
		const s = buildSkillLRScheduler("cosine", 10, 1, 100)
		expect(s).toBeInstanceOf(CosineSkillLR)
	})

	it("throws for unknown type", () => {
		expect(() => buildSkillLRScheduler("unknown" as any, 10, 1, 100)).toThrow("Unknown scheduler type")
	})
})
