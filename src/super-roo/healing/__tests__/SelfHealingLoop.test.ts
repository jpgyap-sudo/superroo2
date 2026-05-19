/**
 * Tests for the SelfHealingLoop module.
 *
 * Tests cover:
 * - Lifecycle (start/stop)
 * - Circuit breaker behavior
 * - Backoff delay calculation
 * - Escalation logic
 * - Failure record tracking
 * - Stats tracking
 * - Incident processing flow
 * - Repair attempt tracking
 * - Per-category escalation thresholds
 * - Notification routing
 * - Repair failure circuit breaker
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

import { SelfHealingLoop, type RepairAttempt, type NotificationRoute } from "../SelfHealingLoop"
import type { IncidentRecord, RootCauseCategory } from "../../types"

// ──────────────────────────────────────────────────────────────────────────────
// Mock orchestrator
// ──────────────────────────────────────────────────────────────────────────────

function createMockOrchestrator() {
	const events = {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	}

	const memory = {
		get: vi.fn().mockReturnValue(null),
		set: vi.fn(),
		delete: vi.fn(),
	}

	return {
		events,
		memory,
		submit: vi.fn(),
	}
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe("SelfHealingLoop", () => {
	let orchestrator: ReturnType<typeof createMockOrchestrator>
	let loop: SelfHealingLoop

	beforeEach(() => {
		orchestrator = createMockOrchestrator()
		loop = new SelfHealingLoop(orchestrator as any, {
			cycleIntervalMs: 100, // Fast cycles for testing
			maxPerCycle: 10,
			autoFixPolicies: {
				low: true,
				medium: true,
				high: false,
				critical: false,
			},
			suggestionOnly: false,
			maxRetries: 3,
			circuitBreakerThreshold: 5,
			circuitBreakerTimeoutMs: 50,
			maxBackoffMs: 200,
			cleanupIntervalCycles: 10,
		})
	})

	afterEach(async () => {
		await loop.stop()
	})

	describe("lifecycle", () => {
		it("should start and stop", async () => {
			const statsBefore = loop.getStats()
			expect(statsBefore.isRunning).toBe(false)

			loop.start()
			const statsAfter = loop.getStats()
			expect(statsAfter.isRunning).toBe(true)

			await loop.stop()
			const statsStopped = loop.getStats()
			expect(statsStopped.isRunning).toBe(false)
		})

		it("should not start twice", () => {
			loop.start()
			loop.start() // Should be no-op
			expect(loop.getStats().isRunning).toBe(true)
		})

		it("should not stop if not running", async () => {
			await loop.stop() // Should be no-op
			expect(loop.getStats().isRunning).toBe(false)
		})
	})

	describe("getStats", () => {
		it("should return initial stats with repair tracking fields", () => {
			const stats = loop.getStats()
			expect(stats.cyclesCompleted).toBe(0)
			expect(stats.incidentsProcessed).toBe(0)
			expect(stats.incidentsQueuedForFix).toBe(0)
			expect(stats.incidentsAutoFixed).toBe(0)
			expect(stats.incidentsNeedHumanApproval).toBe(0)
			expect(stats.incidentsBlocked).toBe(0)
			expect(stats.incidentsVerified).toBe(0)
			expect(stats.lastCycleAt).toBeNull()
			expect(stats.isRunning).toBe(false)
			expect(stats.consecutiveFailures).toBe(0)
			expect(stats.circuitBreakerOpen).toBe(false)
			// New repair tracking fields
			expect(stats.totalRepairAttempts).toBe(0)
			expect(stats.successfulRepairs).toBe(0)
			expect(stats.failedRepairs).toBe(0)
			expect(stats.notificationsSent).toBe(0)
		})
	})

	describe("getHealingBus", () => {
		it("should return the healing bus instance", () => {
			const bus = loop.getHealingBus()
			expect(bus).toBeDefined()
		})
	})

	describe("backoff delay", () => {
		it("should calculate exponential backoff with jitter", () => {
			// Access private method via casting
			const loopAny = loop as any

			// With 1 consecutive failure: base = min(100 * 2^0, 200) = 100
			loopAny.stats.consecutiveFailures = 1
			const delay1 = loopAny.getBackoffDelay()
			expect(delay1).toBeGreaterThanOrEqual(75) // 100 - 25% jitter
			expect(delay1).toBeLessThanOrEqual(125) // 100 + 25% jitter

			// With 2 consecutive failures: base = min(100 * 2^1, 200) = 200
			loopAny.stats.consecutiveFailures = 2
			const delay2 = loopAny.getBackoffDelay()
			expect(delay2).toBeGreaterThanOrEqual(150)
			expect(delay2).toBeLessThanOrEqual(250)

			// With 3 consecutive failures: base = min(100 * 2^2, 200) = 200 (capped)
			loopAny.stats.consecutiveFailures = 3
			const delay3 = loopAny.getBackoffDelay()
			expect(delay3).toBeGreaterThanOrEqual(150)
			expect(delay3).toBeLessThanOrEqual(250)
		})
	})

	describe("escalation", () => {
		it("should not escalate incidents with UNKNOWN category", () => {
			const incident = createMockIncident({
				id: "test-1",
				rootCauseCategory: "UNKNOWN",
			})

			expect(loop.shouldEscalate(incident)).toBe(false)
		})

		it("should not escalate incidents with no failure record", () => {
			const incident = createMockIncident({
				id: "test-1",
				rootCauseCategory: "ENV_MISSING",
				affectedFiles: ["src/config.ts"],
			})

			expect(loop.shouldEscalate(incident)).toBe(false)
		})

		it("should escalate after maxRetries failures", () => {
			const incident = createMockIncident({
				id: "test-1",
				rootCauseCategory: "ENV_MISSING",
				affectedFiles: ["src/config.ts"],
			})

			// Record failures
			loop.recordFailure(incident) // 1
			loop.recordFailure(incident) // 2
			expect(loop.shouldEscalate(incident)).toBe(false)

			loop.recordFailure(incident) // 3 — reaches maxRetries
			expect(loop.shouldEscalate(incident)).toBe(true)
		})

		it("should return true for already escalated incidents", () => {
			const incident = createMockIncident({
				id: "test-1",
				rootCauseCategory: "ENV_MISSING",
				affectedFiles: ["src/config.ts"],
			})

			loop.recordFailure(incident)
			loop.recordFailure(incident)
			loop.recordFailure(incident) // Escalated

			expect(loop.shouldEscalate(incident)).toBe(true)
		})
	})

	describe("failure records", () => {
		it("should track failure counts per signature", () => {
			const incident1 = createMockIncident({
				id: "test-1",
				rootCauseCategory: "ENV_MISSING",
				affectedFiles: ["src/config.ts"],
			})
			const incident2 = createMockIncident({
				id: "test-2",
				rootCauseCategory: "API_AUTH_FAILURE",
				affectedFiles: ["src/auth.ts"],
			})

			loop.recordFailure(incident1)
			loop.recordFailure(incident1)
			loop.recordFailure(incident2)

			const records = loop.getFailureRecords()
			expect(records.size).toBe(2)

			const envRecord = records.get("ENV_MISSING::src/config.ts")
			expect(envRecord?.failureCount).toBe(2)
			expect(envRecord?.escalated).toBe(false)

			const authRecord = records.get("API_AUTH_FAILURE::src/auth.ts")
			expect(authRecord?.failureCount).toBe(1)
		})

		it("should clear failure records for a specific incident", () => {
			const incident = createMockIncident({
				id: "test-1",
				rootCauseCategory: "ENV_MISSING",
				affectedFiles: ["src/config.ts"],
			})

			loop.recordFailure(incident)
			expect(loop.getFailureRecords().size).toBe(1)

			loop.clearFailureRecord(incident)
			expect(loop.getFailureRecords().size).toBe(0)
		})
	})

	describe("runHealingCycle", () => {
		it("should process no incidents when none are open", async () => {
			// Mock listOpen to return empty array (avoids SQLite dependency)
			const bus = loop.getHealingBus()
			vi.spyOn(bus, "listOpen").mockReturnValue([])

			const result = await loop.runHealingCycle()
			expect(result.processed).toBe(0)
			expect(result.actions).toEqual([])
		})

		it("should process an open incident through the state machine", async () => {
			const bus = loop.getHealingBus()

			// Mock listOpen to return a mock incident
			const mockIncident: IncidentRecord = {
				id: "test-incident-1",
				fingerprint: "env-missing-fp",
				featureKey: null,
				sourceAgent: "test",
				title: "Missing env variable",
				symptom: "SUPABASE_URL not found",
				severity: "medium",
				status: "new",
				rootCauseCategory: null,
				affectedFiles: [".env"],
				recommendedAction: null,
				evidence: { error: "process.env.SUPABASE_URL is undefined" },
				autoFixAllowed: false,
				fixAttempts: 0,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			}
			vi.spyOn(bus, "listOpen").mockReturnValue([mockIncident])

			// Mock processIncident to return a result
			const processSpy = vi.spyOn(loop as any, "processIncident").mockResolvedValue("classified as ENV_MISSING")

			const result = await loop.runHealingCycle()
			expect(result.processed).toBe(1)
			expect(result.actions).toContain("test-incident-1: classified as ENV_MISSING")
			expect(processSpy).toHaveBeenCalledWith(mockIncident)
		})

		it("should handle cycle errors gracefully", async () => {
			// Mock the healing bus to throw during listOpen
			const bus = loop.getHealingBus()
			vi.spyOn(bus, "listOpen").mockImplementationOnce(() => {
				throw new Error("Simulated error")
			})

			// Should not throw — errors are caught in the loop
			const result = await loop.runHealingCycle()
			expect(result.processed).toBe(0)
		})
	})

	describe("isAutoFixAllowed", () => {
		it("should allow auto-fix for low severity with autoFixPolicies", () => {
			const incident = createMockIncident({
				severity: "low",
				autoFixAllowed: true,
			})

			const loopAny = loop as any
			expect(loopAny.isAutoFixAllowed(incident, "ENV_MISSING")).toBe(true)
		})

		it("should not allow auto-fix for high severity when policy is false", () => {
			const incident = createMockIncident({
				severity: "high",
				autoFixAllowed: true,
			})

			const loopAny = loop as any
			expect(loopAny.isAutoFixAllowed(incident, "ENV_MISSING")).toBe(false)
		})

		it("should not allow auto-fix when incident has autoFixAllowed=false", () => {
			const incident = createMockIncident({
				severity: "low",
				autoFixAllowed: false,
			})

			const loopAny = loop as any
			expect(loopAny.isAutoFixAllowed(incident, "ENV_MISSING")).toBe(false)
		})

		it("should not allow auto-fix for categories requiring human approval", () => {
			const incident = createMockIncident({
				severity: "low",
				autoFixAllowed: true,
			})

			const loopAny = loop as any
			expect(loopAny.isAutoFixAllowed(incident, "SECURITY_RISK")).toBe(false)
		})

		it("should not allow auto-fix in suggestion-only mode", () => {
			const suggestionLoop = new SelfHealingLoop(orchestrator as any, {
				cycleIntervalMs: 100,
				maxPerCycle: 10,
				maxRetries: 3,
				suggestionOnly: true,
				autoFixPolicies: { low: true, medium: true, high: true, critical: true },
			})

			const incident = createMockIncident({
				severity: "low",
				autoFixAllowed: true,
			})

			const loopAny = suggestionLoop as any
			expect(loopAny.isAutoFixAllowed(incident, "ENV_MISSING")).toBe(false)
		})
	})

	// ────────────────────────────────────────────────────────────────────────────
	// Repair tracking tests
	// ────────────────────────────────────────────────────────────────────────────

	describe("repair tracking", () => {
		it("should record a successful repair attempt", () => {
			loop.recordRepairAttempt("incident-1", "ENV_MISSING", true, 1500)

			const history = loop.getRepairHistory()
			expect(history).toHaveLength(1)
			expect(history[0].incidentId).toBe("incident-1")
			expect(history[0].category).toBe("ENV_MISSING")
			expect(history[0].success).toBe(true)
			expect(history[0].durationMs).toBe(1500)
			expect(history[0].timestamp).toBeGreaterThan(0)
			expect(history[0].error).toBeUndefined()

			const stats = loop.getStats()
			expect(stats.totalRepairAttempts).toBe(1)
			expect(stats.successfulRepairs).toBe(1)
			expect(stats.failedRepairs).toBe(0)
		})

		it("should record a failed repair attempt with error", () => {
			loop.recordRepairAttempt("incident-2", "API_AUTH_FAILURE", false, 3000, "Connection refused")

			const history = loop.getRepairHistory()
			expect(history).toHaveLength(1)
			expect(history[0].success).toBe(false)
			expect(history[0].error).toBe("Connection refused")

			const stats = loop.getStats()
			expect(stats.totalRepairAttempts).toBe(1)
			expect(stats.successfulRepairs).toBe(0)
			expect(stats.failedRepairs).toBe(1)
		})

		it("should filter repair history by category", () => {
			loop.recordRepairAttempt("inc-1", "ENV_MISSING", true, 100)
			loop.recordRepairAttempt("inc-2", "API_AUTH_FAILURE", false, 200)
			loop.recordRepairAttempt("inc-3", "ENV_MISSING", false, 150)

			const envHistory = loop.getRepairHistoryByCategory("ENV_MISSING")
			expect(envHistory).toHaveLength(2)
			expect(envHistory[0].incidentId).toBe("inc-1")
			expect(envHistory[1].incidentId).toBe("inc-3")

			const authHistory = loop.getRepairHistoryByCategory("API_AUTH_FAILURE")
			expect(authHistory).toHaveLength(1)
		})

		it("should filter repair history by incident ID", () => {
			loop.recordRepairAttempt("inc-1", "ENV_MISSING", true, 100)
			loop.recordRepairAttempt("inc-2", "API_AUTH_FAILURE", false, 200)
			loop.recordRepairAttempt("inc-1", "ENV_MISSING", false, 150)

			const inc1History = loop.getRepairHistoryByIncident("inc-1")
			expect(inc1History).toHaveLength(2)

			const inc2History = loop.getRepairHistoryByIncident("inc-2")
			expect(inc2History).toHaveLength(1)

			const inc3History = loop.getRepairHistoryByIncident("inc-3")
			expect(inc3History).toHaveLength(0)
		})

		it("should calculate repair success rate for a category", () => {
			// 2 successes, 1 failure = 66.7% success rate
			loop.recordRepairAttempt("inc-1", "ENV_MISSING", true, 100)
			loop.recordRepairAttempt("inc-2", "ENV_MISSING", true, 100)
			loop.recordRepairAttempt("inc-3", "ENV_MISSING", false, 100)

			const rate = loop.getRepairSuccessRate("ENV_MISSING")
			expect(rate).toBeCloseTo(2 / 3, 5)
		})

		it("should return 1 for categories with no repair attempts", () => {
			const rate = loop.getRepairSuccessRate("SECURITY_RISK")
			expect(rate).toBe(1)
		})

		it("should calculate overall repair success rate", () => {
			loop.recordRepairAttempt("inc-1", "ENV_MISSING", true, 100)
			loop.recordRepairAttempt("inc-2", "API_AUTH_FAILURE", true, 100)
			loop.recordRepairAttempt("inc-3", "ENV_MISSING", false, 100)

			const rate = loop.getOverallRepairSuccessRate()
			expect(rate).toBeCloseTo(2 / 3, 5)
		})

		it("should return 1 for overall rate with no attempts", () => {
			const rate = loop.getOverallRepairSuccessRate()
			expect(rate).toBe(1)
		})

		it("should calculate success rate within a custom window", () => {
			// Add 5 attempts, then check window of 3
			loop.recordRepairAttempt("inc-1", "ENV_MISSING", true, 100)
			loop.recordRepairAttempt("inc-2", "ENV_MISSING", true, 100)
			loop.recordRepairAttempt("inc-3", "ENV_MISSING", false, 100)
			loop.recordRepairAttempt("inc-4", "ENV_MISSING", false, 100)
			loop.recordRepairAttempt("inc-5", "ENV_MISSING", true, 100)

			// Window of 3: last 3 are false, false, true = 33.3%
			const rate = loop.getRepairSuccessRate("ENV_MISSING", 3)
			expect(rate).toBeCloseTo(1 / 3, 5)
		})
	})

	// ────────────────────────────────────────────────────────────────────────────
	// Per-category escalation threshold tests
	// ────────────────────────────────────────────────────────────────────────────

	describe("per-category escalation thresholds", () => {
		it("should use global maxRetries when no category override exists", () => {
			const incident = createMockIncident({
				id: "test-1",
				rootCauseCategory: "ENV_MISSING",
				affectedFiles: ["src/config.ts"],
			})

			loop.recordFailure(incident) // 1
			loop.recordFailure(incident) // 2
			expect(loop.shouldEscalate(incident)).toBe(false)

			loop.recordFailure(incident) // 3 — global maxRetries = 3
			expect(loop.shouldEscalate(incident)).toBe(true)
		})

		it("should use category-specific threshold when configured", () => {
			const customLoop = new SelfHealingLoop(orchestrator as any, {
				cycleIntervalMs: 100,
				maxPerCycle: 10,
				maxRetries: 3,
				suggestionOnly: false,
				autoFixPolicies: { low: true, medium: true, high: false, critical: false },
				escalationPolicy: {
					maxRetries: 3,
					escalationAction: "warn",
					skipAutoRepair: true,
					categoryThresholds: {
						SECURITY_RISK: 1, // Escalate after just 1 failure
					},
				},
			})

			const securityIncident = createMockIncident({
				id: "sec-1",
				rootCauseCategory: "SECURITY_RISK",
				affectedFiles: ["src/auth.ts"],
			})

			// Security category should escalate after just 1 failure
			customLoop.recordFailure(securityIncident)
			expect(customLoop.shouldEscalate(securityIncident)).toBe(true)

			// ENV_MISSING should still use global maxRetries (3)
			const envIncident = createMockIncident({
				id: "env-1",
				rootCauseCategory: "ENV_MISSING",
				affectedFiles: ["src/config.ts"],
			})

			customLoop.recordFailure(envIncident)
			expect(customLoop.shouldEscalate(envIncident)).toBe(false)
		})

		it("should use category-specific escalation action when configured", () => {
			const customLoop = new SelfHealingLoop(orchestrator as any, {
				cycleIntervalMs: 100,
				maxPerCycle: 10,
				maxRetries: 1,
				suggestionOnly: false,
				autoFixPolicies: { low: true, medium: true, high: false, critical: false },
				escalationPolicy: {
					maxRetries: 1,
					escalationAction: "warn",
					skipAutoRepair: true,
					categoryActions: {
						SECURITY_RISK: "circuit_breaker",
					},
				},
			})

			const incident = createMockIncident({
				id: "sec-1",
				rootCauseCategory: "SECURITY_RISK",
				affectedFiles: ["src/auth.ts"],
			})

			// Access private method via casting
			const loopAny = customLoop as any
			const action = loopAny.getCategoryEscalationAction("SECURITY_RISK")
			expect(action).toBe("circuit_breaker")

			// ENV_MISSING should fall back to global "warn"
			const envAction = loopAny.getCategoryEscalationAction("ENV_MISSING")
			expect(envAction).toBe("warn")
		})
	})

	// ────────────────────────────────────────────────────────────────────────────
	// Notification routing tests
	// ────────────────────────────────────────────────────────────────────────────

	describe("notification routing", () => {
		it("should send notifications to matching routes on escalation", () => {
			const routes: NotificationRoute[] = [
				{ channel: "telegram", target: "-100123456", minAction: "warn" },
				{ channel: "slack", target: "#alerts", minAction: "block" },
			]

			const customLoop = new SelfHealingLoop(orchestrator as any, {
				cycleIntervalMs: 100,
				maxPerCycle: 10,
				maxRetries: 3,
				suggestionOnly: false,
				autoFixPolicies: { low: true, medium: true, high: false, critical: false },
				escalationPolicy: {
					maxRetries: 1, // Escalate after 1 failure
					escalationAction: "warn",
					skipAutoRepair: true,
				},
				notificationRoutes: routes,
			})

			const incident = createMockIncident({
				id: "test-1",
				rootCauseCategory: "ENV_MISSING",
				affectedFiles: ["src/config.ts"],
			})

			// Record failure triggers escalation (maxRetries=1) which sends notifications
			customLoop.recordFailure(incident)

			// Should have sent notification to telegram (warn >= warn)
			const notificationCalls = orchestrator.events.info.mock.calls.filter(
				(call: any[]) => call[0] === "healing.loop.notification",
			)
			expect(notificationCalls.length).toBeGreaterThanOrEqual(1)

			const telegramCalls = notificationCalls.filter(
				(call: any[]) => typeof call[1] === "string" && call[1].includes("telegram"),
			)
			expect(telegramCalls.length).toBe(1)

			// Should NOT have sent to slack (warn < block)
			const slackCalls = notificationCalls.filter(
				(call: any[]) => typeof call[1] === "string" && call[1].includes("slack"),
			)
			expect(slackCalls).toHaveLength(0)
		})

		it("should track notifications sent in stats", () => {
			const routes: NotificationRoute[] = [{ channel: "telegram", target: "-100123456", minAction: "warn" }]

			const customLoop = new SelfHealingLoop(orchestrator as any, {
				cycleIntervalMs: 100,
				maxPerCycle: 10,
				maxRetries: 3,
				suggestionOnly: false,
				autoFixPolicies: { low: true, medium: true, high: false, critical: false },
				escalationPolicy: {
					maxRetries: 1, // Escalate after 1 failure
					escalationAction: "warn",
					skipAutoRepair: true,
				},
				notificationRoutes: routes,
			})

			const incident = createMockIncident({
				id: "test-1",
				rootCauseCategory: "ENV_MISSING",
				affectedFiles: ["src/config.ts"],
			})

			customLoop.recordFailure(incident)

			const stats = customLoop.getStats()
			expect(stats.notificationsSent).toBe(1)
		})

		it("should not send notifications when no routes configured", () => {
			const incident = createMockIncident({
				id: "test-1",
				rootCauseCategory: "ENV_MISSING",
				affectedFiles: ["src/config.ts"],
			})

			// Default loop has no notification routes
			loop.recordFailure(incident)
			loop.recordFailure(incident)
			loop.recordFailure(incident) // Escalated

			// Should not have sent any notifications
			const notificationCalls = orchestrator.events.info.mock.calls.filter(
				(call: any[]) => call[0] === "healing.loop.notification",
			)
			expect(notificationCalls).toHaveLength(0)
		})
	})

	// ────────────────────────────────────────────────────────────────────────────
	// Repair failure circuit breaker tests
	// ────────────────────────────────────────────────────────────────────────────

	describe("repair failure circuit breaker", () => {
		it("should open circuit breaker when repair failure rate exceeds threshold", () => {
			const customLoop = new SelfHealingLoop(orchestrator as any, {
				cycleIntervalMs: 100,
				maxPerCycle: 10,
				maxRetries: 3,
				suggestionOnly: false,
				autoFixPolicies: { low: true, medium: true, high: false, critical: false },
				repairFailureCircuitBreakerThreshold: 0.5, // 50% failure rate triggers CB
				repairFailureWindowSize: 4,
			})

			// Record 3 failures out of 4 attempts = 75% failure rate > 50% threshold
			customLoop.recordRepairAttempt("inc-1", "ENV_MISSING", true, 100)
			customLoop.recordRepairAttempt("inc-2", "ENV_MISSING", false, 100)
			customLoop.recordRepairAttempt("inc-3", "ENV_MISSING", false, 100)
			customLoop.recordRepairAttempt("inc-4", "ENV_MISSING", false, 100)

			const stats = customLoop.getStats()
			expect(stats.circuitBreakerOpen).toBe(true)

			expect(orchestrator.events.error).toHaveBeenCalledWith(
				"healing.loop.repair_circuit_breaker",
				expect.stringContaining("ENV_MISSING"),
				expect.any(Object),
			)
		})

		it("should not open circuit breaker when repair failure rate is below threshold", () => {
			const customLoop = new SelfHealingLoop(orchestrator as any, {
				cycleIntervalMs: 100,
				maxPerCycle: 10,
				maxRetries: 3,
				suggestionOnly: false,
				autoFixPolicies: { low: true, medium: true, high: false, critical: false },
				repairFailureCircuitBreakerThreshold: 0.8, // 80% failure rate needed
				repairFailureWindowSize: 4,
			})

			// Record 2 failures out of 4 attempts = 50% failure rate < 80% threshold
			customLoop.recordRepairAttempt("inc-1", "ENV_MISSING", true, 100)
			customLoop.recordRepairAttempt("inc-2", "ENV_MISSING", true, 100)
			customLoop.recordRepairAttempt("inc-3", "ENV_MISSING", false, 100)
			customLoop.recordRepairAttempt("inc-4", "ENV_MISSING", false, 100)

			const stats = customLoop.getStats()
			expect(stats.circuitBreakerOpen).toBe(false)
		})
	})
})

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function createMockIncident(overrides: Partial<IncidentRecord> = {}): IncidentRecord {
	return {
		id: "test",
		fingerprint: "test",
		featureKey: null,
		sourceAgent: "test",
		title: "Test",
		symptom: "Test symptom",
		severity: "medium",
		status: "new",
		rootCauseCategory: null,
		affectedFiles: [],
		recommendedAction: null,
		evidence: {},
		autoFixAllowed: false,
		fixAttempts: 0,
		createdAt: Date.now(),
		updatedAt: Date.now(),
		...overrides,
	}
}
