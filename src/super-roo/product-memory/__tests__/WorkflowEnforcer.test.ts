import { describe, it, expect, beforeEach, vi } from "vitest"
import { WorkflowEnforcer, type WorkflowEnforcerConfig } from "../WorkflowEnforcer"
import type { EventLog } from "../../logging/EventLog"

describe("WorkflowEnforcer", () => {
	let enforcer: WorkflowEnforcer
	let mockEventLog: EventLog

	beforeEach(() => {
		mockEventLog = {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
		} as unknown as EventLog

		const config: WorkflowEnforcerConfig = {
			requireDeepseekForCoding: true,
			violationAction: "warn",
			requireApiKeyTracking: true,
			requireAllPhases: true,
			requireOllamaSummary: true,
			storeKeyLast4: true,
			deepseek: {
				primaryApiKey: "test-api-key-1234",
				fallbackApiKey: "",
				model: "deepseek-chat",
				maxTokens: 4096,
				timeoutMs: 30000,
				retryAttempts: 2,
			},
		}

		enforcer = new WorkflowEnforcer(mockEventLog, config)
	})

	describe("task lifecycle", () => {
		it("should start a new task", () => {
			const state = enforcer.startTask("test-task-1")

			expect(state.taskId).toBe("test-task-1")
			expect(state.completedPhases.size).toBe(0)
			expect(state.violations).toHaveLength(0)
			expect(state.isCompliant).toBe(true)
		})

		it("should end task with compliance report", async () => {
			enforcer.startTask("test-task-2")

			// Simulate completing all required workflow phases
			await enforcer.validateApiCall({ phase: "planning", provider: "codex", model: "codex" })
			await enforcer.validateApiCall({ phase: "coding", provider: "deepseek", model: "deepseek-chat" })
			await enforcer.validateApiCall({ phase: "review", provider: "codex", model: "codex" })
			await enforcer.validateApiCall({ phase: "summarization", provider: "ollama", model: "qwen" })
			await enforcer.validateApiCall({ phase: "memory_storage", provider: "central_brain", model: "pgvector" })

			const result = await enforcer.endTask()

			expect(result.isCompliant).toBe(true)
			expect(result.violations).toHaveLength(0)
			expect(result.complianceData.isCompliant).toBe(true)
			expect(result.complianceData.steps.deepseekDelegated).toBe(true)
			expect(result.complianceData.steps.codexReviewed).toBe(true)
		})

		it("should detect missing phases", async () => {
			enforcer.startTask("test-task-3")

			// Only do coding, skip planning and review
			await enforcer.validateApiCall({ phase: "coding", provider: "deepseek", model: "deepseek-chat" })

			const result = await enforcer.endTask()

			expect(result.isCompliant).toBe(false)
			expect(result.violations.length).toBeGreaterThan(0)
			expect(result.complianceData.steps.lessonsRead).toBe(false)
			expect(result.complianceData.steps.codexReviewed).toBe(false)
		})

		it("should throw if ending without starting", async () => {
			await expect(enforcer.endTask()).rejects.toThrow("No active task to end")
		})
	})

	describe("API call validation", () => {
		it("should approve valid DeepSeek coding call", async () => {
			enforcer.startTask("test-task")

			const result = await enforcer.validateApiCall({
				phase: "coding",
				provider: "deepseek",
				model: "deepseek-chat",
			})

			expect(result.approved).toBe(true)
			expect(result.violation).toBeUndefined()
		})

		it("should warn on non-DeepSeek coding call when action is 'warn'", async () => {
			enforcer.startTask("test-task")

			const result = await enforcer.validateApiCall({
				phase: "coding",
				provider: "openai",
				model: "gpt-4o",
			})

			expect(result.approved).toBe(true)
			expect(result.violation).toBeDefined()
			expect(result.violation?.severity).toBe("warning")
			expect(result.violation?.expectedProvider).toBe("deepseek")
			expect(result.violation?.actualProvider).toBe("openai")
		})

		it("should block non-DeepSeek coding call when action is 'block'", async () => {
			enforcer.updateConfig({ violationAction: "block" })
			enforcer.startTask("test-task")

			const result = await enforcer.validateApiCall({
				phase: "coding",
				provider: "openai",
				model: "gpt-4o",
			})

			expect(result.approved).toBe(false)
			expect(result.violation).toBeDefined()
			expect(result.violation?.severity).toBe("error")
		})

		it("should approve any provider when requireDeepseekForCoding is false", async () => {
			enforcer.updateConfig({ requireDeepseekForCoding: false })
			enforcer.startTask("test-task")

			const result = await enforcer.validateApiCall({
				phase: "coding",
				provider: "openai",
				model: "gpt-4o",
			})

			expect(result.approved).toBe(true)
			expect(result.violation).toBeUndefined()
		})

		it("should track phase completion", async () => {
			enforcer.startTask("test-task")

			await enforcer.validateApiCall({ phase: "planning", provider: "codex", model: "codex" })
			await enforcer.validateApiCall({ phase: "coding", provider: "deepseek", model: "deepseek-chat" })
			await enforcer.validateApiCall({ phase: "review", provider: "codex", model: "codex" })

			const state = enforcer.getCurrentState()
			expect(state?.completedPhases.has("planning")).toBe(true)
			expect(state?.completedPhases.has("coding")).toBe(true)
			expect(state?.completedPhases.has("review")).toBe(true)
		})
	})

	describe("violation callbacks", () => {
		it("should call violation handlers", async () => {
			const violationHandler = vi.fn()
			enforcer.onViolation(violationHandler)
			enforcer.startTask("test-task")

			await enforcer.validateApiCall({
				phase: "coding",
				provider: "openai",
				model: "gpt-4o",
			})

			expect(violationHandler).toHaveBeenCalledOnce()
			expect(violationHandler).toHaveBeenCalledWith(
				expect.objectContaining({
					phase: "coding",
					expectedProvider: "deepseek",
					actualProvider: "openai",
				}),
			)
		})
	})

	describe("logging", () => {
		it("should log API calls without throwing", async () => {
			enforcer.startTask("test-task")

			await expect(
				enforcer.logApiCall({
					phase: "coding",
					provider: "deepseek",
					model: "deepseek-chat",
					success: true,
				}),
			).resolves.not.toThrow()
		})

		it("should log DeepSeek delegation", async () => {
			enforcer.startTask("test-task")

			await expect(
				enforcer.logDeepseekDelegation(true, 1234, { prompt: 100, completion: 50 }),
			).resolves.not.toThrow()

			const state = enforcer.getCurrentState()
			expect(state?.completedPhases.has("coding")).toBe(true)
		})
	})

	describe("API key verification", () => {
		it("should return false when ModelUsageTracker is not available", async () => {
			const result = await enforcer.verifyApiKeyUsage("ab12")
			expect(result).toBe(false)
		})
	})

	describe("state management", () => {
		it("should return undefined state when no task is active", () => {
			const state = enforcer.getCurrentState()
			expect(state).toBeUndefined()
		})

		it("should return current state when task is active", () => {
			enforcer.startTask("active-task")

			const state = enforcer.getCurrentState()
			expect(state).toBeDefined()
			expect(state?.taskId).toBe("active-task")
		})
	})
})
