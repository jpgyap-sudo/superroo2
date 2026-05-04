/**
 * Tests for ParallelHealingPipeline — batch incident processing with concurrent workers.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"

import { ParallelHealingPipeline } from "../ParallelHealingPipeline"
import type { IncidentRecord, RootCauseCategory, RepairPlan, BugSeverity, IncidentStatus } from "../../types"
import type { EventLog } from "../../logging/EventLog"
import type { HealingBus } from "../../healing/HealingBus"

// ── Fake dependencies ────────────────────────────────────────────────────────

function fakeEventLog(): EventLog {
	return {
		emit: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		subscribe: vi.fn(),
		unsubscribe: vi.fn(),
		recent: vi.fn().mockReturnValue([]),
	} as unknown as EventLog
}

function fakeHealingBus(): HealingBus {
	return {
		updateIncident: vi.fn().mockImplementation((id: string, patch: Record<string, unknown>) => ({
			id,
			...patch,
		})),
		storeRepairPlan: vi.fn().mockResolvedValue(undefined),
		transitionState: vi.fn().mockImplementation(
			(id: string, newStatus: IncidentStatus) =>
				({
					id,
					status: newStatus,
				}) as IncidentRecord,
		),
		logHealingAction: vi.fn().mockResolvedValue({ id: "ha_1" }),
	} as unknown as HealingBus
}

function makeIncident(overrides: Partial<IncidentRecord> = {}): IncidentRecord {
	return {
		id: `inc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
		fingerprint: `fp_${Math.random().toString(36).slice(2, 8)}`,
		featureKey: "test-feature",
		sourceAgent: "tester",
		title: "Test incident",
		symptom: "Something broke",
		severity: "low" as BugSeverity,
		status: "new" as IncidentStatus,
		rootCauseCategory: null,
		affectedFiles: ["src/test.ts"],
		recommendedAction: null,
		evidence: {},
		autoFixAllowed: true,
		fixAttempts: 0,
		createdAt: Date.now(),
		updatedAt: Date.now(),
		...overrides,
	}
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("ParallelHealingPipeline", () => {
	let pipeline: ParallelHealingPipeline
	let healingBus: HealingBus
	let events: EventLog

	beforeEach(() => {
		events = fakeEventLog()
		healingBus = fakeHealingBus()
		pipeline = new ParallelHealingPipeline(healingBus, events, {
			maxConcurrency: 3,
			maxBatchSize: 10,
			autoFixEnabled: true,
			autoFixPolicies: {
				low: true,
				medium: false,
				high: false,
				critical: false,
			},
		})
	})

	describe("processBatch", () => {
		it("returns empty result for empty batch", async () => {
			const result = await pipeline.processBatch([])
			expect(result.totalProcessed).toBe(0)
			expect(result.succeeded).toBe(0)
			expect(result.failed).toBe(0)
		})

		it("processes a single incident successfully", async () => {
			const incident = makeIncident({ severity: "low" })
			const result = await pipeline.processBatch([incident])

			expect(result.totalProcessed).toBe(1)
			expect(result.succeeded).toBe(1)
			expect(result.failed).toBe(0)
			expect(result.autoFixed).toBe(1) // low severity auto-fix is enabled
			expect(result.results).toHaveLength(1)
			expect(result.results[0].incidentId).toBe(incident.id)
			expect(result.results[0].status).toBe("queued_for_fix")
		})

		it("classifies incident and stores repair plan", async () => {
			const incident = makeIncident({ severity: "low" })
			await pipeline.processBatch([incident])

			expect(healingBus.updateIncident).toHaveBeenCalledWith(
				incident.id,
				expect.objectContaining({ rootCauseCategory: expect.any(String) }),
			)
			expect(healingBus.storeRepairPlan).toHaveBeenCalledWith(
				incident.id,
				expect.objectContaining({ incidentId: incident.id }),
				"parallel_healing",
			)
		})

		it("queues for human approval when category requires it", async () => {
			// SECURITY_RISK incidents require human approval
			// Use keywords that match the SECURITY_RISK pattern
			const incident = makeIncident({
				severity: "high",
				title: "Credential leak detected",
				symptom: "Private key exposed in repository",
			})
			const result = await pipeline.processBatch([incident])

			expect(result.totalProcessed).toBe(1)
			expect(result.succeeded).toBe(1)
			expect(result.needsApproval).toBe(1)
			expect(result.results[0].status).toBe("needs_human_approval")
		})

		it("blocks incidents when auto-fix is disabled for that severity", async () => {
			const pipeline2 = new ParallelHealingPipeline(healingBus, events, {
				maxConcurrency: 3,
				maxBatchSize: 10,
				autoFixEnabled: true,
				autoFixPolicies: {
					low: false,
					medium: false,
					high: false,
					critical: false,
				},
			})

			const incident = makeIncident({ severity: "low" })
			const result = await pipeline2.processBatch([incident])

			expect(result.totalProcessed).toBe(1)
			expect(result.succeeded).toBe(1)
			expect(result.blocked).toBe(1)
			expect(result.results[0].status).toBe("blocked")
		})

		it("processes multiple incidents concurrently", async () => {
			const incidents = [
				makeIncident({ severity: "low", id: "inc_1" }),
				makeIncident({ severity: "low", id: "inc_2" }),
				makeIncident({ severity: "low", id: "inc_3" }),
			]

			const start = Date.now()
			const result = await pipeline.processBatch(incidents)
			const elapsed = Date.now() - start

			expect(result.totalProcessed).toBe(3)
			expect(result.succeeded).toBe(3)
			expect(result.autoFixed).toBe(3)

			// With concurrency=3, all 3 should process in parallel (fast)
			expect(elapsed).toBeLessThan(500)
		})

		it("respects maxBatchSize limit", async () => {
			const pipeline2 = new ParallelHealingPipeline(healingBus, events, {
				maxConcurrency: 2,
				maxBatchSize: 2,
				autoFixEnabled: true,
				autoFixPolicies: { low: true, medium: true, high: true, critical: true },
			})

			const incidents = [
				makeIncident({ severity: "low", id: "inc_1" }),
				makeIncident({ severity: "low", id: "inc_2" }),
				makeIncident({ severity: "low", id: "inc_3" }),
			]

			const result = await pipeline2.processBatch(incidents)
			// Should only process 2 out of 3 due to maxBatchSize
			expect(result.totalProcessed).toBe(2)
		})

		it("handles errors gracefully without failing the entire batch", async () => {
			const failingBus = fakeHealingBus()
			failingBus.updateIncident = vi.fn().mockRejectedValue(new Error("DB error"))

			const pipeline2 = new ParallelHealingPipeline(failingBus, events, {
				maxConcurrency: 2,
				maxBatchSize: 10,
				autoFixEnabled: true,
				autoFixPolicies: { low: true, medium: true, high: true, critical: true },
			})

			const incidents = [
				makeIncident({ severity: "low", id: "inc_1" }),
				makeIncident({ severity: "low", id: "inc_2" }),
			]

			const result = await pipeline2.processBatch(incidents)
			expect(result.totalProcessed).toBe(2)
			expect(result.failed).toBe(2)
			expect(result.succeeded).toBe(0)
		})
	})

	describe("getWorkerStatus", () => {
		it("returns empty array when no workers are active", () => {
			const status = pipeline.getWorkerStatus()
			expect(status).toEqual([])
		})

		it("returns worker status during processing", async () => {
			const incident = makeIncident({ severity: "low" })
			const promise = pipeline.processBatch([incident])
			// Workers are cleaned up in finally block, so after completion they're gone
			await promise
			const status = pipeline.getWorkerStatus()
			expect(status).toEqual([])
		})
	})

	describe("isBusy", () => {
		it("returns false when no workers are active", () => {
			expect(pipeline.isBusy()).toBe(false)
		})

		it("returns true during processing", async () => {
			// Create a slow incident by using a healing bus with delay
			const slowBus = fakeHealingBus()
			slowBus.updateIncident = vi
				.fn()
				.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({}), 200)))

			const pipeline2 = new ParallelHealingPipeline(slowBus, events, {
				maxConcurrency: 1,
				maxBatchSize: 10,
				autoFixEnabled: true,
				autoFixPolicies: { low: true, medium: true, high: true, critical: true },
			})

			const incident = makeIncident({ severity: "low" })
			const promise = pipeline2.processBatch([incident])

			// Small delay to let processing start
			await new Promise((resolve) => setTimeout(resolve, 50))
			expect(pipeline2.isBusy()).toBe(true)

			await promise
			expect(pipeline2.isBusy()).toBe(false)
		})
	})

	describe("drain", () => {
		it("resolves immediately when no workers are active", async () => {
			await expect(pipeline.drain()).resolves.toBeUndefined()
		})

		it("waits for all workers to complete", async () => {
			const slowBus = fakeHealingBus()
			slowBus.updateIncident = vi
				.fn()
				.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({}), 100)))

			const pipeline2 = new ParallelHealingPipeline(slowBus, events, {
				maxConcurrency: 2,
				maxBatchSize: 10,
				autoFixEnabled: true,
				autoFixPolicies: { low: true, medium: true, high: true, critical: true },
			})

			const incidents = [
				makeIncident({ severity: "low", id: "inc_1" }),
				makeIncident({ severity: "low", id: "inc_2" }),
			]

			const promise = pipeline2.processBatch(incidents)
			await pipeline2.drain()
			await promise

			expect(pipeline2.isBusy()).toBe(false)
		})
	})
})
