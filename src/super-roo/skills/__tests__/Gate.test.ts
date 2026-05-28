import { describe, it, expect } from "vitest"
import { evaluateGate, applyGateResult } from "../Gate"

describe("evaluateGate", () => {
	it("accepts new best when candidate exceeds best", () => {
		const result = evaluateGate(0.95, 0.8, 0.9)
		expect(result.action).toBe("accept_new_best")
		expect(result.candidateScore).toBe(0.95)
		expect(result.bestScore).toBe(0.9)
	})

	it("accepts when candidate improves on previous but not best", () => {
		const result = evaluateGate(0.85, 0.8, 0.9)
		expect(result.action).toBe("accept")
		expect(result.candidateScore).toBe(0.85)
	})

	it("rejects when candidate does not improve", () => {
		const result = evaluateGate(0.75, 0.8, 0.9)
		expect(result.action).toBe("reject")
		expect(result.reasoning).toContain("does not improve")
	})

	it("accepts plateau when allowPlateauAcceptance is true", () => {
		const result = evaluateGate(0.802, 0.8, 0.9, {
			allowPlateauAcceptance: true,
			plateauThreshold: 0.01,
		})
		expect(result.action).toBe("accept")
	})

	it("rejects plateau when allowPlateauAcceptance is false", () => {
		const result = evaluateGate(0.802, 0.8, 0.9, {
			allowPlateauAcceptance: false,
			plateauThreshold: 0.01,
		})
		expect(result.action).toBe("reject")
	})

	it("uses custom improvement threshold", () => {
		// With threshold 0.1, 0.85 - 0.8 = 0.05 is not enough
		const result = evaluateGate(0.85, 0.8, 0.9, { improvementThreshold: 0.1 })
		expect(result.action).toBe("reject")
	})

	it("returns reasoning for each action", () => {
		const result = evaluateGate(0.95, 0.8, 0.9)
		expect(result.reasoning).toBeTruthy()
		expect(result.reasoning.length).toBeGreaterThan(10)
	})
})

describe("applyGateResult", () => {
	it("updates best score on accept_new_best", () => {
		const result = evaluateGate(0.95, 0.8, 0.9)
		const { newBestScore, accepted } = applyGateResult(result, 0.9)
		expect(newBestScore).toBe(0.95)
		expect(accepted).toBe(true)
	})

	it("keeps best score on accept", () => {
		const result = evaluateGate(0.85, 0.8, 0.9)
		const { newBestScore, accepted } = applyGateResult(result, 0.9)
		expect(newBestScore).toBe(0.9)
		expect(accepted).toBe(true)
	})

	it("keeps best score on reject", () => {
		const result = evaluateGate(0.75, 0.8, 0.9)
		const { newBestScore, accepted } = applyGateResult(result, 0.9)
		expect(newBestScore).toBe(0.9)
		expect(accepted).toBe(false)
	})
})
