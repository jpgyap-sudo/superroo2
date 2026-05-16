/**
 * RooApprovalAdapter tests.
 *
 * The adapter sits at the host boundary, but its behavior is pure: take a
 * SafetyMode, return / apply a known set of flags. We test the mapping table
 * directly because regressions here have direct user-impact (an autonomous
 * agent suddenly being able or unable to do things it shouldn't).
 *
 * No real ClineProvider needed — we use a structural fake matching the one
 * method the adapter calls: `setValues`.
 */

import { describe, expect, it } from "vitest"

import { APPROVAL_PRESETS, RooApprovalAdapter } from "../RooApprovalAdapter"
import { SafetyMode } from "../../super-roo/types"

interface CapturedCall {
	values: Record<string, unknown>
}

function makeFakeProvider(): { provider: { setValues: (v: Record<string, unknown>) => Promise<void> }; calls: CapturedCall[] } {
	const calls: CapturedCall[] = []
	return {
		provider: {
			setValues: async (values) => {
				calls.push({ values })
			},
		},
		calls,
	}
}

describe("RooApprovalAdapter — preset table integrity", () => {
	it("has a preset for every SafetyMode value", () => {
		for (const mode of Object.values(SafetyMode)) {
			expect(APPROVAL_PRESETS[mode]).toBeDefined()
		}
	})

	it("OFF has every flag false (manual approval)", () => {
		const p = APPROVAL_PRESETS[SafetyMode.OFF]
		expect(p.autoApprovalEnabled).toBe(false)
		expect(p.alwaysAllowReadOnly).toBe(false)
		expect(p.alwaysAllowWrite).toBe(false)
		expect(p.alwaysAllowExecute).toBe(false)
		expect(p.alwaysAllowMcp).toBe(false)
		expect(p.alwaysAllowModeSwitch).toBe(false)
		expect(p.alwaysAllowSubtasks).toBe(false)
		expect(p.alwaysAllowFollowupQuestions).toBe(false)
		expect(p.alwaysAllowReadOnlyOutsideWorkspace).toBe(false)
		expect(p.alwaysAllowWriteOutsideWorkspace).toBe(false)
		expect(p.alwaysAllowWriteProtected).toBe(false)
	})

	it("SAFE allows reads but no writes/execute/mcp", () => {
		const p = APPROVAL_PRESETS[SafetyMode.SAFE]
		expect(p.autoApprovalEnabled).toBe(true)
		expect(p.alwaysAllowReadOnly).toBe(true)
		expect(p.alwaysAllowWrite).toBe(false)
		expect(p.alwaysAllowExecute).toBe(false)
		expect(p.alwaysAllowMcp).toBe(false)
	})

	it("SAFE keeps reads scoped to the workspace", () => {
		const p = APPROVAL_PRESETS[SafetyMode.SAFE]
		expect(p.alwaysAllowReadOnlyOutsideWorkspace).toBe(false)
	})

	it("AUTO enables edits, execute, mcp, mode switch, subtasks", () => {
		const p = APPROVAL_PRESETS[SafetyMode.AUTO]
		expect(p.autoApprovalEnabled).toBe(true)
		expect(p.alwaysAllowReadOnly).toBe(true)
		expect(p.alwaysAllowWrite).toBe(true)
		expect(p.alwaysAllowExecute).toBe(true)
		expect(p.alwaysAllowMcp).toBe(true)
		expect(p.alwaysAllowModeSwitch).toBe(true)
		expect(p.alwaysAllowSubtasks).toBe(true)
	})

	it("AUTO still gates protected files (.git, .env, etc.) and outside-workspace writes", () => {
		const p = APPROVAL_PRESETS[SafetyMode.AUTO]
		expect(p.alwaysAllowWriteProtected).toBe(false)
		expect(p.alwaysAllowWriteOutsideWorkspace).toBe(false)
	})

	it("AUTO does not auto-answer follow-up questions (preserves clarification loops)", () => {
		const p = APPROVAL_PRESETS[SafetyMode.AUTO]
		expect(p.alwaysAllowFollowupQuestions).toBe(false)
	})

	it("FULL_AUTONOMOUS opens the protected and outside-workspace gates AUTO leaves closed", () => {
		const p = APPROVAL_PRESETS[SafetyMode.FULL_AUTONOMOUS]
		expect(p.alwaysAllowWriteProtected).toBe(true)
		expect(p.alwaysAllowWriteOutsideWorkspace).toBe(true)
		expect(p.alwaysAllowReadOnlyOutsideWorkspace).toBe(true)
		expect(p.alwaysAllowFollowupQuestions).toBe(true)
	})

	it("FULL_AUTONOMOUS is a strict superset of AUTO (no flag is more restrictive)", () => {
		const auto = APPROVAL_PRESETS[SafetyMode.AUTO]
		const full = APPROVAL_PRESETS[SafetyMode.FULL_AUTONOMOUS]
		for (const key of Object.keys(auto) as Array<keyof typeof auto>) {
			if (auto[key] === true) {
				expect(full[key]).toBe(true)
			}
		}
	})
})

describe("RooApprovalAdapter — apply()", () => {
	it("calls provider.setValues with the matching preset for SafetyMode", async () => {
		const { provider, calls } = makeFakeProvider()
		const adapter = new RooApprovalAdapter(provider)
		await adapter.apply(SafetyMode.AUTO)
		expect(calls).toHaveLength(1)
		expect(calls[0].values).toEqual(APPROVAL_PRESETS[SafetyMode.AUTO])
	})

	it("applies the OFF preset (defense in depth) even though it should not be reached", async () => {
		const { provider, calls } = makeFakeProvider()
		const adapter = new RooApprovalAdapter(provider)
		await adapter.apply(SafetyMode.OFF)
		expect(calls[0].values).toEqual(APPROVAL_PRESETS[SafetyMode.OFF])
	})

	it("normalizes legacy 'MANUAL' to OFF", async () => {
		const { provider, calls } = makeFakeProvider()
		const adapter = new RooApprovalAdapter(provider)
		await adapter.apply("MANUAL")
		expect(calls[0].values).toEqual(APPROVAL_PRESETS[SafetyMode.OFF])
	})

	it("normalizes legacy 'SAFE_AUTO' to SAFE", async () => {
		const { provider, calls } = makeFakeProvider()
		const adapter = new RooApprovalAdapter(provider)
		await adapter.apply("SAFE_AUTO")
		expect(calls[0].values).toEqual(APPROVAL_PRESETS[SafetyMode.SAFE])
	})

	it("getPreset returns the same preset apply() would send", async () => {
		const { provider, calls } = makeFakeProvider()
		const adapter = new RooApprovalAdapter(provider)
		const preset = adapter.getPreset(SafetyMode.FULL_AUTONOMOUS)
		await adapter.apply(SafetyMode.FULL_AUTONOMOUS)
		expect(calls[0].values).toEqual(preset)
	})

	it("only sets managed flags — does not touch unrelated settings", async () => {
		const { provider, calls } = makeFakeProvider()
		const adapter = new RooApprovalAdapter(provider)
		await adapter.apply(SafetyMode.AUTO)
		const sentKeys = Object.keys(calls[0].values).sort()
		const expectedKeys = Object.keys(APPROVAL_PRESETS[SafetyMode.AUTO]).sort()
		expect(sentKeys).toEqual(expectedKeys)
		// No unrelated settings like apiProvider, modelId, customInstructions, etc.
		expect(sentKeys).not.toContain("apiProvider")
		expect(sentKeys).not.toContain("modelId")
		expect(sentKeys).not.toContain("customInstructions")
	})
})
