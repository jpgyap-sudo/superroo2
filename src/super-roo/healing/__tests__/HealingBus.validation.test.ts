/**
 * Tests for HealingBus validation and new features.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"

import { MemoryStore } from "../../memory/MemoryStore"
import { EventLog } from "../../logging/EventLog"
import { HealingBus } from "../HealingBus"

describe("HealingBus - Validation", () => {
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

	describe("validateIncidentInput", () => {
		it("should reject empty titles", async () => {
			await expect(healingBus.reportIncident({ title: "", symptom: "Test" })).rejects.toThrow(
				"title cannot be empty",
			)
		})

		it("should reject whitespace-only titles", async () => {
			await expect(healingBus.reportIncident({ title: "   ", symptom: "Test" })).rejects.toThrow(
				"title cannot be empty",
			)
		})

		it("should reject titles that are too long", async () => {
			const longTitle = "A".repeat(501)
			await expect(healingBus.reportIncident({ title: longTitle, symptom: "Test" })).rejects.toThrow(
				"exceeds maximum length of 500",
			)
		})

		it("should reject empty symptoms", async () => {
			await expect(healingBus.reportIncident({ title: "Test", symptom: "" })).rejects.toThrow(
				"symptom cannot be empty",
			)
		})

		it("should reject symptoms that are too long", async () => {
			const longSymptom = "A".repeat(2001)
			await expect(healingBus.reportIncident({ title: "Test", symptom: longSymptom })).rejects.toThrow(
				"exceeds maximum length of 2000",
			)
		})

		it("should reject invalid severity values", async () => {
			await expect(
				healingBus.reportIncident({
					title: "Test",
					symptom: "Test",
					severity: "invalid_severity" as any,
				}),
			).rejects.toThrow("Invalid severity")
		})

		it("should reject invalid status values", async () => {
			await expect(
				healingBus.reportIncident({
					title: "Test",
					symptom: "Test",
					status: "invalid_status" as any,
				}),
			).rejects.toThrow("Invalid status")
		})

		it("should reject non-array affectedFiles", async () => {
			await expect(
				healingBus.reportIncident({
					title: "Test",
					symptom: "Test",
					affectedFiles: "not-an-array" as any,
				}),
			).rejects.toThrow("must be an array")
		})

		it("should reject too many affectedFiles", async () => {
			const manyFiles = Array(101).fill("file.ts")
			await expect(
				healingBus.reportIncident({
					title: "Test",
					symptom: "Test",
					affectedFiles: manyFiles,
				}),
			).rejects.toThrow("exceeds maximum of 100 files")
		})

		it("should reject non-string items in affectedFiles", async () => {
			await expect(
				healingBus.reportIncident({
					title: "Test",
					symptom: "Test",
					affectedFiles: ["file.ts", 123 as any, "file2.ts"],
				}),
			).rejects.toThrow("must contain only strings")
		})

		it("should reject non-serializable evidence", async () => {
			const circular: any = { a: 1 }
			circular.self = circular

			await expect(
				healingBus.reportIncident({
					title: "Test",
					symptom: "Test",
					evidence: circular,
				}),
			).rejects.toThrow("must be JSON-serializable")
		})

		it("should trim title and symptom", async () => {
			const incident = await healingBus.reportIncident({
				title: "  Test Title  ",
				symptom: "  Test Symptom  ",
			})

			expect(incident.title).toBe("Test Title")
			expect(incident.symptom).toBe("Test Symptom")
		})

		it("should accept valid severities", async () => {
			const severities = ["low", "medium", "high", "critical"] as const

			for (const severity of severities) {
				const incident = await healingBus.reportIncident({
					title: `Test ${severity}`,
					symptom: "Test",
					severity,
				})
				expect(incident.severity).toBe(severity)
			}
		})

		it("should accept valid statuses", async () => {
			const statuses = [
				"new",
				"investigating",
				"queued_for_fix",
				"fixing",
				"fix_ready",
				"deployed",
				"verifying",
				"verified",
				"reopened",
				"blocked",
				"needs_human_approval",
			] as const

			for (const status of statuses) {
				const incident = await healingBus.reportIncident({
					title: `Test ${status}`,
					symptom: "Test",
					status,
				})
				expect(incident.status).toBe(status)
			}
		})
	})

	describe("cleanupOldHealingActions", () => {
		it("should cleanup old actions", async () => {
			const incident = await healingBus.reportIncident({
				title: "Test",
				symptom: "Test",
			})

			// Create an action
			await healingBus.logHealingAction(incident.id, "test_action", "test_agent", "Test")

			// Cleanup with 0 days should delete everything
			const deleted = healingBus.cleanupOldHealingActions(0)
			expect(deleted).toBeGreaterThan(0)

			const actions = healingBus.getHealingActions(incident.id)
			expect(actions).toHaveLength(0)
		})

		it("should not cleanup recent actions", async () => {
			const incident = await healingBus.reportIncident({
				title: "Test",
				symptom: "Test",
			})

			// Create an action
			await healingBus.logHealingAction(incident.id, "test_action", "test_agent", "Test")

			// Cleanup with 30 days should not delete recent actions
			const deleted = healingBus.cleanupOldHealingActions(30)
			expect(deleted).toBe(0)

			const actions = healingBus.getHealingActions(incident.id)
			expect(actions).toHaveLength(2)
		})

		it("should use default cleanup days", async () => {
			const deleted = healingBus.cleanupOldHealingActions()
			expect(typeof deleted).toBe("number")
		})
	})

	describe("getHealingMetrics", () => {
		it("should return metrics for empty database", () => {
			const metrics = healingBus.getHealingMetrics()

			expect(metrics.totalIncidents).toBe(0)
			expect(metrics.openIncidents).toBe(0)
			expect(metrics.verifiedIncidents).toBe(0)
			expect(metrics.blockedIncidents).toBe(0)
			expect(metrics.autoFixSuccessRate).toBe(0)
			expect(metrics.averageTimeToResolution).toBeNull()
			expect(metrics.incidentsBySeverity).toEqual({})
			expect(metrics.incidentsByStatus).toEqual({})
		})

		it("should return correct incident counts", async () => {
			await healingBus.reportIncident({
				title: "New",
				symptom: "Test",
				status: "new",
				severity: "high",
			})

			await healingBus.reportIncident({
				title: "Verified",
				symptom: "Test",
				status: "verified",
				severity: "low",
			})

			await healingBus.reportIncident({
				title: "Blocked",
				symptom: "Test",
				status: "blocked",
				severity: "critical",
			})

			const metrics = healingBus.getHealingMetrics()

			expect(metrics.totalIncidents).toBe(3)
			expect(metrics.openIncidents).toBe(1) // new
			expect(metrics.verifiedIncidents).toBe(1)
			expect(metrics.blockedIncidents).toBe(1)
		})

		it("should calculate incidents by severity", async () => {
			await healingBus.reportIncident({
				title: "Low",
				symptom: "Test",
				severity: "low",
			})

			await healingBus.reportIncident({
				title: "High 1",
				symptom: "Test",
				severity: "high",
			})

			await healingBus.reportIncident({
				title: "High 2",
				symptom: "Test",
				severity: "high",
			})

			const metrics = healingBus.getHealingMetrics()

			expect(metrics.incidentsBySeverity.low).toBe(1)
			expect(metrics.incidentsBySeverity.high).toBe(2)
		})

		it("should calculate incidents by status", async () => {
			await healingBus.reportIncident({
				title: "New",
				symptom: "Test",
				status: "new",
			})

			await healingBus.reportIncident({
				title: "Investigating",
				symptom: "Test",
				status: "investigating",
			})

			const metrics = healingBus.getHealingMetrics()

			expect(metrics.incidentsByStatus.new).toBe(1)
			expect(metrics.incidentsByStatus.investigating).toBe(1)
		})

		it("should count open incidents correctly", async () => {
			const openStatuses = [
				"new",
				"investigating",
				"queued_for_fix",
				"fixing",
				"fix_ready",
				"deployed",
				"verifying",
				"reopened",
			] as const

			for (const status of openStatuses) {
				await healingBus.reportIncident({
					title: `Test ${status}`,
					symptom: "Test",
					status,
				})
			}

			await healingBus.reportIncident({
				title: "Verified",
				symptom: "Test",
				status: "verified",
			})

			await healingBus.reportIncident({
				title: "Blocked",
				symptom: "Test",
				status: "blocked",
			})

			const metrics = healingBus.getHealingMetrics()
			expect(metrics.openIncidents).toBe(openStatuses.length)
		})
	})
})
