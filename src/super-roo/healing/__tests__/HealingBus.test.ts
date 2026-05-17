/**
 * Tests for the HealingBus module.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"

import { MemoryStore } from "../../memory/MemoryStore"
import { EventLog } from "../../logging/EventLog"
import { HealingBus, makeIncidentFingerprint, severityRank } from "../HealingBus"
import type { RepairPlan, IncidentInputRaw } from "../../types"

describe("HealingBus", () => {
	let memory: MemoryStore
	let events: EventLog
	let healingBus: HealingBus

	beforeEach(() => {
		memory = new MemoryStore(":memory:")
		events = new EventLog(memory, { mirrorToConsole: false })
		healingBus = new HealingBus(memory, events)
	})

	afterEach(() => {
		memory.close()
	})

	describe("makeIncidentFingerprint", () => {
		it("should generate deterministic fingerprints", () => {
			const fp1 = makeIncidentFingerprint({
				featureKey: "test",
				sourceAgent: "agent1",
				title: "Error occurred",
				symptom: "Stack overflow",
			})
			const fp2 = makeIncidentFingerprint({
				featureKey: "test",
				sourceAgent: "agent1",
				title: "Error occurred",
				symptom: "Stack overflow",
			})
			expect(fp1).toBe(fp2)
		})

		it("should generate different fingerprints for different inputs", () => {
			const fp1 = makeIncidentFingerprint({
				featureKey: "test",
				sourceAgent: "agent1",
				title: "Error A",
				symptom: "Stack overflow",
			})
			const fp2 = makeIncidentFingerprint({
				featureKey: "test",
				sourceAgent: "agent1",
				title: "Error B",
				symptom: "Stack overflow",
			})
			expect(fp1).not.toBe(fp2)
		})

		it("should be case insensitive", () => {
			const fp1 = makeIncidentFingerprint({
				title: "ERROR",
				symptom: "FAIL",
			})
			const fp2 = makeIncidentFingerprint({
				title: "error",
				symptom: "fail",
			})
			expect(fp1).toBe(fp2)
		})
	})

	describe("severityRank", () => {
		it("should return correct ranks", () => {
			expect(severityRank("critical")).toBe(4)
			expect(severityRank("high")).toBe(3)
			expect(severityRank("medium")).toBe(2)
			expect(severityRank("low")).toBe(1)
		})

		it("should default to medium for unknown severity", () => {
			expect(severityRank("unknown" as any)).toBe(2)
		})
	})

	describe("reportIncident", () => {
		it("should create a new incident", async () => {
			const incident = await healingBus.reportIncident({
				title: "Test Error",
				symptom: "Something went wrong",
				severity: "high",
			})

			expect(incident.title).toBe("Test Error")
			expect(incident.symptom).toBe("Something went wrong")
			expect(incident.severity).toBe("high")
			expect(incident.status).toBe("new")
			expect(incident.id).toMatch(/^inc_/)
			expect(incident.fingerprint).toBeDefined()
		})

		it("should use default values when not provided", async () => {
			const incident = await healingBus.reportIncident({
				title: "Test Error",
				symptom: "Something went wrong",
			})

			expect(incident.severity).toBe("medium")
			expect(incident.status).toBe("new")
			expect(incident.sourceAgent).toBe("unknown_agent")
			expect(incident.affectedFiles).toEqual([])
		})

		it("should update existing incident with same fingerprint", async () => {
			const incident1 = await healingBus.reportIncident({
				title: "Test Error",
				symptom: "Something went wrong",
				severity: "medium",
			})

			const incident2 = await healingBus.reportIncident({
				title: "Test Error",
				symptom: "Something went wrong",
				severity: "high", // Changed severity
			})

			expect(incident1.id).toBe(incident2.id)
			expect(incident2.severity).toBe("high")
		})
	})

	describe("list and get", () => {
		it("should list incidents", async () => {
			await healingBus.reportIncident({
				title: "Error 1",
				symptom: "Symptom 1",
			})
			await healingBus.reportIncident({
				title: "Error 2",
				symptom: "Symptom 2",
			})

			const incidents = healingBus.list()
			expect(incidents).toHaveLength(2)
		})

		it("should get incident by id", async () => {
			const created = await healingBus.reportIncident({
				title: "Test Error",
				symptom: "Something went wrong",
			})

			const fetched = healingBus.get(created.id)
			expect(fetched).not.toBeNull()
			expect(fetched?.id).toBe(created.id)
		})

		it("should filter by status", async () => {
			const incident1 = await healingBus.reportIncident({
				title: "Error 1",
				symptom: "Symptom 1",
				status: "new",
			})
			await healingBus.reportIncident({
				title: "Error 2",
				symptom: "Symptom 2",
				status: "verified",
			})

			const open = healingBus.list({ status: ["new", "investigating"] })
			expect(open).toHaveLength(1)
			expect(open[0].id).toBe(incident1.id)
		})

		it("should list open incidents", async () => {
			await healingBus.reportIncident({
				title: "Open Error",
				symptom: "Still broken",
				status: "new",
			})
			await healingBus.reportIncident({
				title: "Fixed Error",
				symptom: "All good",
				status: "verified",
			})

			const open = healingBus.listOpen()
			expect(open).toHaveLength(1)
			expect(open[0].title).toBe("Open Error")
		})
	})

	describe("updateIncident", () => {
		it("should update incident properties", async () => {
			const created = await healingBus.reportIncident({
				title: "Test Error",
				symptom: "Something went wrong",
			})

			const updated = healingBus.updateIncident(created.id, {
				status: "investigating",
				rootCauseCategory: "ENV_MISSING",
			})

			expect(updated.status).toBe("investigating")
			expect(updated.rootCauseCategory).toBe("ENV_MISSING")
		})

		it("should throw for non-existent incident", () => {
			expect(() => {
				healingBus.updateIncident("non-existent", { status: "investigating" })
			}).toThrow("Incident non-existent not found")
		})
	})

	describe("transitionState", () => {
		it("should transition through state machine", async () => {
			const created = await healingBus.reportIncident({
				title: "Test Error",
				symptom: "Something went wrong",
			})

			await healingBus.transitionState(created.id, "investigating", "test")

			const updated = healingBus.get(created.id)
			expect(updated?.status).toBe("investigating")
		})

		it("should throw for invalid transitions", async () => {
			const created = await healingBus.reportIncident({
				title: "Test Error",
				symptom: "Something went wrong",
				status: "verified",
			})

			await expect(healingBus.transitionState(created.id, "new", "test")).rejects.toThrow(
				"Invalid state transition",
			)
		})
	})

	describe("autoFix policies", () => {
		it("should allow auto-fix based on severity policy", async () => {
			const bus = new HealingBus(memory, events, {
				autoFixEnabled: true,
				autoFixPolicies: {
					low: true,
					medium: false,
					high: false,
					critical: false,
				},
			})

			const lowIncident = await bus.reportIncident({
				title: "Low Error",
				symptom: "Minor issue",
				severity: "low",
			})

			const mediumIncident = await bus.reportIncident({
				title: "Medium Error",
				symptom: "Moderate issue",
				severity: "medium",
			})

			expect(bus.isAutoFixAllowed(lowIncident)).toBe(true)
			expect(bus.isAutoFixAllowed(mediumIncident)).toBe(false)
		})

		it("should respect explicit autoFixAllowed override", async () => {
			const incident = await healingBus.reportIncident({
				title: "Error",
				symptom: "Issue",
				severity: "low",
				autoFixAllowed: false,
			})

			expect(healingBus.isAutoFixAllowed(incident)).toBe(false)
		})
	})

	describe("healing actions", () => {
		it("should log healing actions", async () => {
			const incident = await healingBus.reportIncident({
				title: "Test Error",
				symptom: "Something went wrong",
			})

			await healingBus.logHealingAction(
				incident.id,
				"test_action",
				"test_agent",
				"Test action summary",
				{ test: "input" },
				{ test: "output" },
			)

			const actions = healingBus.getHealingActions(incident.id)
			expect(actions).toHaveLength(2) // 1 from report + 1 from test
			expect(actions[0].actionType).toBe("test_action")
		})
	})

	describe("repair plans", () => {
		it("should store a repair plan", async () => {
			const incident = await healingBus.reportIncident({
				title: "Repair Test",
				symptom: "Needs repair",
			})

			const plan: RepairPlan = {
				incidentId: incident.id,
				featureKey: "test-feature",
				severity: "medium",
				rootCauseCategory: "TEST_FAILURE",
				affectedFiles: ["src/test.ts"],
				diagnosticSteps: ["Check logs"],
				safePatchPlan: ["Fix logic"],
				testsToRun: ["test/test.ts"],
				approvalRequired: false,
				executionStatus: "pending",
			}

			await healingBus.storeRepairPlan(incident.id, plan, "test_agent")
			const plans = healingBus.getRepairPlans(incident.id)
			expect(plans).toHaveLength(1)
			expect(plans[0].incidentId).toBe(incident.id)
			expect(plans[0].executionStatus).toBe("pending")
		})

		it("should execute a repair plan successfully", async () => {
			const incident = await healingBus.reportIncident({
				title: "Execute Test",
				symptom: "Will be fixed",
			})

			const plan: RepairPlan = {
				incidentId: incident.id,
				featureKey: "test-feature",
				severity: "low",
				rootCauseCategory: "CONFIGURATION_ERROR",
				affectedFiles: ["src/config.ts"],
				diagnosticSteps: ["Check config"],
				safePatchPlan: ["Update config"],
				testsToRun: ["test/config.test.ts"],
				approvalRequired: false,
				executionStatus: "pending",
			}

			await healingBus.storeRepairPlan(incident.id, plan, "test_agent")
			const executed = await healingBus.executeRepairPlan(
				incident.id,
				plan,
				"test_agent",
				true,
				"Repair completed successfully",
			)

			expect(executed.executionStatus).toBe("completed")
			expect(executed.executedAt).toBeDefined()
			expect(executed.executionResult).toEqual({
				success: true,
				message: "Repair completed successfully",
			})
		})

		it("should track failed repair execution", async () => {
			const incident = await healingBus.reportIncident({
				title: "Fail Test",
				symptom: "Will fail",
			})

			const plan: RepairPlan = {
				incidentId: incident.id,
				featureKey: "test-feature",
				severity: "high",
				rootCauseCategory: "NETWORK_TIMEOUT",
				affectedFiles: ["src/network.ts"],
				diagnosticSteps: ["Check network"],
				safePatchPlan: ["Retry connection"],
				testsToRun: ["test/network.test.ts"],
				approvalRequired: false,
				executionStatus: "pending",
			}

			await healingBus.storeRepairPlan(incident.id, plan, "test_agent")
			const executed = await healingBus.executeRepairPlan(
				incident.id,
				plan,
				"test_agent",
				false,
				"Repair failed: timeout",
			)

			expect(executed.executionStatus).toBe("failed")
			expect(executed.executionResult).toEqual({
				success: false,
				message: "Repair failed: timeout",
			})
		})
	})

	describe("getDetailedHealingMetrics", () => {
		it("should return empty metrics when no incidents exist", () => {
			const metrics = healingBus.getDetailedHealingMetrics()
			expect(metrics.totalIncidents).toBe(0)
			expect(metrics.incidentsBySeverity).toEqual({})
			expect(metrics.recentTrend).toHaveLength(1)
			expect(metrics.recentTrend[0].period).toBe("last_7_days")
		})

		it("should calculate per-severity breakdown", async () => {
			await healingBus.reportIncident({
				title: "Critical Error",
				symptom: "Critical failure",
				severity: "critical",
			})
			await healingBus.reportIncident({
				title: "High Error",
				symptom: "High failure",
				severity: "high",
			})
			await healingBus.reportIncident({
				title: "Medium Error",
				symptom: "Medium failure",
				severity: "medium",
			})

			const metrics = healingBus.getDetailedHealingMetrics()
			expect(metrics.totalIncidents).toBe(3)
			expect(metrics.incidentsBySeverity.critical).toBe(1)
			expect(metrics.incidentsBySeverity.high).toBe(1)
			expect(metrics.incidentsBySeverity.medium).toBe(1)
		})

		it("should include success rate by severity", async () => {
			await healingBus.reportIncident({
				title: "Test Error",
				symptom: "Test failure",
				severity: "high",
			})

			const metrics = healingBus.getDetailedHealingMetrics()
			expect(metrics.successRateBySeverity.high).toBeDefined()
			expect(typeof metrics.successRateBySeverity.high).toBe("number")
		})

		it("should include recent trend data", async () => {
			await healingBus.reportIncident({
				title: "Trend Error",
				symptom: "Trending",
			})

			const metrics = healingBus.getDetailedHealingMetrics()
			expect(metrics.recentTrend).toHaveLength(1)
			expect(metrics.recentTrend[0]).toHaveProperty("period")
			expect(metrics.recentTrend[0]).toHaveProperty("verified")
			expect(metrics.recentTrend[0]).toHaveProperty("failed")
		})
	})

	describe("escalation", () => {
		it("should escalate incident with too many fix attempts", async () => {
			const incident = await healingBus.reportIncident({
				title: "Escalation Test",
				symptom: "Keeps failing",
			})

			// Simulate multiple fix attempts
			healingBus.updateIncident(incident.id, {
				fixAttempts: 3,
			} as unknown as Partial<IncidentInputRaw> & { updatedAt?: number })

			// needsEscalation reads from the stored record, so re-fetch
			const updated = healingBus.get(incident.id)!
			expect(healingBus.needsEscalation(updated)).toBe(true)
		})

		it("should escalate critical severity incidents", async () => {
			const incident = await healingBus.reportIncident({
				title: "Critical Escalation",
				symptom: "Critical issue",
				severity: "critical",
			})

			expect(healingBus.needsEscalation(incident)).toBe(true)
		})

		it("should not escalate low severity incidents with few attempts", async () => {
			const incident = await healingBus.reportIncident({
				title: "Low Severity",
				symptom: "Minor issue",
				severity: "low",
			})

			expect(healingBus.needsEscalation(incident)).toBe(false)
		})

		it("should get escalated incidents", async () => {
			await healingBus.reportIncident({
				title: "Get Escalated",
				symptom: "Will be escalated",
				severity: "critical",
			})

			const escalated = healingBus.getEscalatedIncidents()
			expect(escalated.length).toBeGreaterThanOrEqual(1)
		})

		it("should escalate incident and log action", async () => {
			const incident = await healingBus.reportIncident({
				title: "Manual Escalation",
				symptom: "Needs human",
			})

			await healingBus.escalateIncident(incident.id, "test_agent", "Needs human review")

			const updated = healingBus.get(incident.id)
			expect(updated?.status).toBe("blocked")

			const actions = healingBus.getHealingActions(incident.id)
			const escalationAction = actions.find((a) => a.actionType === "escalation")
			expect(escalationAction).toBeDefined()
			expect(escalationAction?.summary).toContain("Needs human review")
		})
	})
})
