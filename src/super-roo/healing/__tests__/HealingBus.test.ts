/**
 * Tests for the HealingBus module.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"

import { MemoryStore } from "../../memory/MemoryStore"
import { EventLog } from "../../logging/EventLog"
import { HealingBus, makeIncidentFingerprint, severityRank } from "../HealingBus"

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

			await healingBus.transitionState(
				created.id,
				"investigating",
				"test",
			)

			const updated = healingBus.get(created.id)
			expect(updated?.status).toBe("investigating")
		})

		it("should throw for invalid transitions", async () => {
			const created = await healingBus.reportIncident({
				title: "Test Error",
				symptom: "Something went wrong",
				status: "verified",
			})

			await expect(
				healingBus.transitionState(created.id, "new", "test"),
			).rejects.toThrow("Invalid state transition")
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
})
