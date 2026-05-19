/**
 * Tests for the SelfHealingAgent module.
 *
 * Tests cover:
 * - All 8 operations (report_incident, run_cycle, approve_fix, reject_fix,
 *   list_incidents, get_status, classify, build_repair_plan)
 * - Error handling for uninitialized dependencies
 * - Missing field validation
 * - Factory functions (createReportIncidentTask, createRunHealingCycleTask)
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

import { SelfHealingAgent, createReportIncidentTask, createRunHealingCycleTask } from "../SelfHealingAgent"
import type { AgentRunContext, IncidentRecord, BugSeverity, RootCauseCategory } from "../../types"

// ──────────────────────────────────────────────────────────────────────────────
// Mocks
// ──────────────────────────────────────────────────────────────────────────────

function createMockHealingBus() {
	const incidents = new Map<string, IncidentRecord>()

	return {
		reportIncident: vi.fn().mockImplementation(async (input: Record<string, unknown>) => {
			const id = `inc-${incidents.size + 1}`
			const incident: IncidentRecord = {
				id,
				fingerprint: id,
				featureKey: (input.featureKey as string) ?? null,
				sourceAgent: (input.sourceAgent as string) ?? "test",
				title: (input.title as string) ?? "Test",
				symptom: (input.symptom as string) ?? "Test symptom",
				severity: (input.severity as BugSeverity) ?? "medium",
				status: "new",
				rootCauseCategory: (input.rootCauseCategory as RootCauseCategory) ?? null,
				affectedFiles: (input.affectedFiles as string[]) ?? [],
				recommendedAction: null,
				evidence: (input.evidence as Record<string, unknown>) ?? {},
				autoFixAllowed: (input.autoFixAllowed as boolean) ?? false,
				fixAttempts: 0,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			}
			incidents.set(id, incident)
			return incident
		}),
		storeRepairPlan: vi.fn().mockResolvedValue(undefined),
		isAutoFixAllowed: vi.fn().mockReturnValue(true),
		transitionState: vi.fn().mockImplementation(async (id: string, status: string) => {
			const incident = incidents.get(id)
			if (!incident) throw new Error(`Incident ${id} not found`)
			incident.status = status as IncidentRecord["status"]
			return incident
		}),
		list: vi.fn().mockReturnValue([]),
		listOpen: vi.fn().mockReturnValue([]),
		get: vi.fn().mockImplementation((id: string) => incidents.get(id) ?? null),
	}
}

function createMockHealingLoop() {
	return {
		runHealingCycle: vi.fn().mockResolvedValue({ processed: 2, actions: ["inc-1: fixed", "inc-2: verified"] }),
		getStats: vi.fn().mockReturnValue({
			isRunning: true,
			cyclesCompleted: 5,
			incidentsProcessed: 12,
			incidentsAutoFixed: 8,
			incidentsNeedHumanApproval: 2,
			incidentsBlocked: 1,
			incidentsVerified: 7,
			incidentsQueuedForFix: 0,
			lastCycleAt: Date.now(),
			consecutiveFailures: 0,
			circuitBreakerOpen: false,
		}),
	}
}

function createMockContext(overrides: Partial<AgentRunContext> = {}): AgentRunContext {
	return {
		task: {
			id: "task-1",
			agent: "self-healing",
			goal: "Test goal",
			priority: "normal",
			requiredCapabilities: ["read.file"],
			payload: {},
			status: "running",
			attempts: 1,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		},
		...overrides,
	} as unknown as AgentRunContext
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe("SelfHealingAgent", () => {
	let agent: SelfHealingAgent
	let mockBus: ReturnType<typeof createMockHealingBus>
	let mockLoop: ReturnType<typeof createMockHealingLoop>

	beforeEach(() => {
		mockBus = createMockHealingBus()
		mockLoop = createMockHealingLoop()
		agent = new SelfHealingAgent({ allowAutoFix: true })
		agent.setHealingBus(mockBus as any)
		agent.setHealingLoop(mockLoop as any)
	})

	describe("initialization", () => {
		it("should have correct name and description", () => {
			expect(agent.name).toBe("self-healing")
			expect(agent.description).toContain("self-healing")
		})

		it("should have required capabilities", () => {
			expect(agent.requiredCapabilities).toContain("read.file")
		})
	})

	describe("report_incident", () => {
		it("should report an incident successfully", async () => {
			const ctx = createMockContext({
				task: {
					...createMockContext().task,
					payload: {
						operation: "report_incident",
						title: "Missing env variable",
						symptom: "SUPABASE_URL not found",
						severity: "high",
						affectedFiles: [".env"],
						evidence: { error: "process.env.SUPABASE_URL is undefined" },
					},
				},
			})

			const result = await agent.run(ctx)

			expect(result.ok).toBe(true)
			expect(result.summary).toContain("Incident")
			expect(result.summary).toContain("ENV_MISSING")
			expect(mockBus.reportIncident).toHaveBeenCalledTimes(1)
			expect(mockBus.storeRepairPlan).toHaveBeenCalledTimes(1)
		})

		it("should return error when healing bus is not initialized", async () => {
			const uninitAgent = new SelfHealingAgent()
			const ctx = createMockContext({
				task: {
					...createMockContext().task,
					payload: {
						operation: "report_incident",
						title: "Test",
						symptom: "Test symptom",
					},
				},
			})

			const result = await uninitAgent.run(ctx)

			expect(result.ok).toBe(false)
			expect(result.error).toBe("not_initialized")
		})

		it("should return error when title or symptom is missing", async () => {
			const ctx = createMockContext({
				task: {
					...createMockContext().task,
					payload: {
						operation: "report_incident",
						title: "",
						symptom: "",
					},
				},
			})

			const result = await agent.run(ctx)

			expect(result.ok).toBe(false)
			expect(result.error).toBe("missing_fields")
		})

		it("should auto-classify when no rootCauseCategory is provided", async () => {
			const ctx = createMockContext({
				task: {
					...createMockContext().task,
					payload: {
						operation: "report_incident",
						title: "Missing env variable",
						symptom: "SUPABASE_URL not found",
					},
				},
			})

			const result = await agent.run(ctx)

			expect(result.ok).toBe(true)
			expect(result.summary).toContain("ENV_MISSING")
		})
	})

	describe("run_cycle", () => {
		it("should run a healing cycle successfully", async () => {
			const ctx = createMockContext({
				task: {
					...createMockContext().task,
					payload: { operation: "run_cycle" },
				},
			})

			const result = await agent.run(ctx)

			expect(result.ok).toBe(true)
			expect(result.summary).toContain("2 incidents processed")
			expect(mockLoop.runHealingCycle).toHaveBeenCalledTimes(1)
		})

		it("should return error when healing loop is not initialized", async () => {
			const uninitAgent = new SelfHealingAgent()
			uninitAgent.setHealingBus(mockBus as any)
			const ctx = createMockContext({
				task: {
					...createMockContext().task,
					payload: { operation: "run_cycle" },
				},
			})

			const result = await uninitAgent.run(ctx)

			expect(result.ok).toBe(false)
			expect(result.error).toBe("not_initialized")
		})
	})

	describe("approve_fix", () => {
		it("should approve a fix for an incident", async () => {
			// First report an incident so it exists
			await mockBus.reportIncident({
				title: "Test",
				symptom: "Test symptom",
			})

			const ctx = createMockContext({
				task: {
					...createMockContext().task,
					payload: {
						operation: "approve_fix",
						incidentId: "inc-1",
						reason: "Looks good, proceed",
					},
				},
			})

			const result = await agent.run(ctx)

			expect(result.ok).toBe(true)
			expect(result.summary).toContain("approved")
			expect(mockBus.transitionState).toHaveBeenCalledWith(
				"inc-1",
				"queued_for_fix",
				"self_healing_agent",
				expect.objectContaining({
					approvedBy: "self-healing",
					reason: "Looks good, proceed",
				}),
			)
		})

		it("should return error when incidentId is missing", async () => {
			const ctx = createMockContext({
				task: {
					...createMockContext().task,
					payload: {
						operation: "approve_fix",
						incidentId: "",
					},
				},
			})

			const result = await agent.run(ctx)

			expect(result.ok).toBe(false)
			expect(result.error).toBe("missing_fields")
		})
	})

	describe("reject_fix", () => {
		it("should reject/block a fix for an incident", async () => {
			await mockBus.reportIncident({
				title: "Test",
				symptom: "Test symptom",
			})

			const ctx = createMockContext({
				task: {
					...createMockContext().task,
					payload: {
						operation: "reject_fix",
						incidentId: "inc-1",
						reason: "Needs more investigation",
					},
				},
			})

			const result = await agent.run(ctx)

			expect(result.ok).toBe(true)
			expect(result.summary).toContain("rejected")
			expect(mockBus.transitionState).toHaveBeenCalledWith(
				"inc-1",
				"blocked",
				"self_healing_agent",
				expect.objectContaining({
					rejectedBy: "self-healing",
					reason: "Needs more investigation",
				}),
			)
		})
	})

	describe("list_incidents", () => {
		it("should list incidents with optional filters", async () => {
			const ctx = createMockContext({
				task: {
					...createMockContext().task,
					payload: {
						operation: "list_incidents",
						status: "new",
						severity: "high",
						limit: 10,
					},
				},
			})

			const result = await agent.run(ctx)

			expect(result.ok).toBe(true)
			expect(result.summary).toContain("0 incidents")
			expect(mockBus.list).toHaveBeenCalledWith(
				expect.objectContaining({
					status: "new",
					severity: "high",
					limit: 10,
				}),
			)
		})

		it("should return error when healing bus is not initialized", async () => {
			const uninitAgent = new SelfHealingAgent()
			const ctx = createMockContext({
				task: {
					...createMockContext().task,
					payload: { operation: "list_incidents" },
				},
			})

			const result = await uninitAgent.run(ctx)

			expect(result.ok).toBe(false)
			expect(result.error).toBe("not_initialized")
		})
	})

	describe("get_status", () => {
		it("should return healing system status", async () => {
			const ctx = createMockContext({
				task: {
					...createMockContext().task,
					payload: { operation: "get_status" },
				},
			})

			const result = await agent.run(ctx)

			expect(result.ok).toBe(true)
			expect(result.summary).toContain("running")
			expect(result.data).toBeDefined()
			const data = result.data as Record<string, unknown>
			const stats = data.stats as Record<string, unknown>
			expect(stats.isRunning).toBe(true)
			expect(stats.cyclesCompleted).toBe(5)
		})

		it("should return error when healing system is not initialized", async () => {
			const uninitAgent = new SelfHealingAgent()
			const ctx = createMockContext({
				task: {
					...createMockContext().task,
					payload: { operation: "get_status" },
				},
			})

			const result = await uninitAgent.run(ctx)

			expect(result.ok).toBe(false)
			expect(result.error).toBe("not_initialized")
		})
	})

	describe("classify", () => {
		it("should classify text into a root cause category", async () => {
			const ctx = createMockContext({
				task: {
					...createMockContext().task,
					payload: {
						operation: "classify",
						text: "Missing env variable SUPABASE_URL",
					},
				},
			})

			const result = await agent.run(ctx)

			expect(result.ok).toBe(true)
			expect(result.summary).toContain("ENV_MISSING")
			expect(result.data).toBeDefined()
			expect(result.data!.category).toBe("ENV_MISSING")
		})

		it("should return error when text is missing", async () => {
			const ctx = createMockContext({
				task: {
					...createMockContext().task,
					payload: {
						operation: "classify",
						text: "",
					},
				},
			})

			const result = await agent.run(ctx)

			expect(result.ok).toBe(false)
			expect(result.error).toBe("missing_fields")
		})
	})

	describe("build_repair_plan", () => {
		it("should build a repair plan for an existing incident", async () => {
			// Report an incident first
			await mockBus.reportIncident({
				title: "Missing env variable",
				symptom: "SUPABASE_URL not found",
			})

			const ctx = createMockContext({
				task: {
					...createMockContext().task,
					payload: {
						operation: "build_repair_plan",
						incidentId: "inc-1",
					},
				},
			})

			const result = await agent.run(ctx)

			expect(result.ok).toBe(true)
			expect(result.summary).toContain("Repair plan built")
			expect(mockBus.storeRepairPlan).toHaveBeenCalled()
		})

		it("should return error when incidentId is missing", async () => {
			const ctx = createMockContext({
				task: {
					...createMockContext().task,
					payload: {
						operation: "build_repair_plan",
						incidentId: "",
					},
				},
			})

			const result = await agent.run(ctx)

			expect(result.ok).toBe(false)
			expect(result.error).toBe("missing_fields")
		})

		it("should return error when incident is not found", async () => {
			const ctx = createMockContext({
				task: {
					...createMockContext().task,
					payload: {
						operation: "build_repair_plan",
						incidentId: "nonexistent",
					},
				},
			})

			const result = await agent.run(ctx)

			expect(result.ok).toBe(false)
			expect(result.error).toBe("not_found")
		})
	})

	describe("unknown operation", () => {
		it("should return error for unknown operation", async () => {
			const ctx = createMockContext({
				task: {
					...createMockContext().task,
					payload: { operation: "unknown_op" },
				},
			})

			const result = await agent.run(ctx)

			expect(result.ok).toBe(false)
			expect(result.error).toBe("unknown_operation")
		})
	})
})

// ──────────────────────────────────────────────────────────────────────────────
// Factory Functions
// ──────────────────────────────────────────────────────────────────────────────

describe("createReportIncidentTask", () => {
	it("should create a valid report incident task", () => {
		const task = createReportIncidentTask("Missing env variable", "SUPABASE_URL not found", {
			severity: "high",
			affectedFiles: [".env"],
			evidence: { error: "undefined" },
		})

		expect(task.agent).toBe("self-healing")
		expect(task.goal).toContain("Missing env variable")
		expect(task.priority).toBe("high")
		expect(task.requiredCapabilities).toContain("read.file")
		expect(task.payload?.operation).toBe("report_incident")
		expect(task.payload?.title).toBe("Missing env variable")
		expect(task.payload?.symptom).toBe("SUPABASE_URL not found")
		expect(task.payload?.severity).toBe("high")
		expect(task.payload?.affectedFiles).toEqual([".env"])
	})

	it("should map critical severity to critical priority", () => {
		const task = createReportIncidentTask("Critical issue", "System down", { severity: "critical" })
		expect(task.priority).toBe("critical")
	})

	it("should map low severity to normal priority", () => {
		const task = createReportIncidentTask("Minor issue", "Cosmetic", { severity: "low" })
		expect(task.priority).toBe("normal")
	})
})

describe("createRunHealingCycleTask", () => {
	it("should create a valid run healing cycle task", () => {
		const task = createRunHealingCycleTask()

		expect(task.agent).toBe("self-healing")
		expect(task.goal).toBe("Run self-healing cycle")
		expect(task.priority).toBe("high")
		expect(task.requiredCapabilities).toContain("read.file")
		expect(task.payload?.operation).toBe("run_cycle")
	})
})
