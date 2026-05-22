/**
 * Tests for SelfHealingLoop.js (cloud port of the healing orchestrator).
 *
 * Covers lifecycle, incident processing state machine (new → investigating →
 * queued_for_fix → fixing → fix_ready → deployed → verifying → verified),
 * fingerprint escalation, failure recording, repair runs, and helpers.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import fs from "fs"
import path from "path"

// ── Mock HealingBus ─────────────────────────────────────────────────────────

function createMockHealingBus() {
	return {
		listOpen: vi.fn(() => []),
		updateIncident: vi.fn(),
		transitionState: vi.fn(),
		isAutoFixAllowed: vi.fn(() => true),
	}
}

// ── Import ──────────────────────────────────────────────────────────────────

const { SelfHealingLoop } = await import("../orchestrator/modules/SelfHealingLoop.js")
const { IncidentStatus, RootCauseCategory } = await import("../orchestrator/modules/HealingBus.js")

describe("SelfHealingLoop", () => {
	let healingBus
	let loop

	beforeEach(() => {
		healingBus = createMockHealingBus()
		loop = new SelfHealingLoop({
			healingBus,
			config: {
				loopIntervalMs: 100,
				maxIncidentsPerCycle: 5,
				maxFixAttempts: 3,
				fingerprintEscalationThreshold: 3,
				autoFixEnabled: true,
				autoDeployEnabled: false,
			},
		})
	})

	afterEach(async () => {
		await loop.stop()
	})

	// ── Lifecycle ──────────────────────────────────────────────────────────

	describe("lifecycle", () => {
		it("should throw without healingBus", () => {
			expect(() => new SelfHealingLoop({})).toThrow("requires a healingBus")
		})

		it("should start and schedule next cycle", () => {
			loop.start()
			expect(loop._running).toBe(true)
			expect(loop._loopHandle).not.toBeNull()
		})

		it("should not start twice", () => {
			loop.start()
			const handle1 = loop._loopHandle
			loop.start()
			expect(loop._loopHandle).toBe(handle1)
		})

		it("should stop and clear handle", async () => {
			loop.start()
			expect(loop._running).toBe(true)
			await loop.stop()
			expect(loop._running).toBe(false)
			expect(loop._loopHandle).toBeNull()
		})

		it("should return stats copy", () => {
			loop.stats.cyclesRun = 5
			const stats = loop.getStats()
			expect(stats.cyclesRun).toBe(5)
			// Verify it's a copy
			stats.cyclesRun = 99
			expect(loop.stats.cyclesRun).toBe(5)
		})

		it("should return config copy", () => {
			const config = loop.getConfig()
			expect(config.maxFixAttempts).toBe(3)
			expect(config.loopIntervalMs).toBe(100)
		})

		it("should update config at runtime", () => {
			loop.updateConfig({ maxFixAttempts: 5 })
			expect(loop.config.maxFixAttempts).toBe(5)
		})

		it("should set risk engine", () => {
			const engine = { recordFailurePattern: vi.fn() }
			loop.setRiskEngine(engine)
			expect(loop.riskEngine).toBe(engine)
		})

		it("should set swarm debugger", () => {
			const debugger_ = { debug: vi.fn() }
			loop.setSwarmDebugger(debugger_)
			expect(loop.swarmDebugger).toBe(debugger_)
		})
	})

	// ── Run Healing Cycle ──────────────────────────────────────────────────

	describe("runHealingCycle", () => {
		it("should process no incidents when none are open", async () => {
			healingBus.listOpen.mockReturnValue([])
			const result = await loop.runHealingCycle()
			expect(result.processed).toBe(0)
			expect(result.actions).toEqual([])
		})

		it("should process incidents sorted by severity", async () => {
			const incidents = [
				{ id: "1", severity: "low", status: IncidentStatus.NEW, createdAt: 100, title: "Low" },
				{ id: "2", severity: "critical", status: IncidentStatus.NEW, createdAt: 200, title: "Critical" },
				{ id: "3", severity: "high", status: IncidentStatus.NEW, createdAt: 300, title: "High" },
			]
			healingBus.listOpen.mockReturnValue(incidents)
			healingBus.transitionState.mockResolvedValue()

			const result = await loop.runHealingCycle()
			expect(result.processed).toBe(3)
			// Critical first, then high, then low
			expect(result.actions[0]).toContain("2")
			expect(result.actions[1]).toContain("3")
			expect(result.actions[2]).toContain("1")
		})

		it("should respect maxIncidentsPerCycle", async () => {
			const incidents = Array.from({ length: 10 }, (_, i) => ({
				id: `${i}`,
				severity: "low",
				status: IncidentStatus.NEW,
				createdAt: i * 10,
				title: `Incident ${i}`,
			}))
			healingBus.listOpen.mockReturnValue(incidents)
			healingBus.transitionState.mockResolvedValue()

			const result = await loop.runHealingCycle()
			expect(result.processed).toBe(5) // maxIncidentsPerCycle = 5
		})
	})

	// ── Incident Processing State Machine ──────────────────────────────────

	describe("incident processing", () => {
		it("should process NEW incident: fingerprint + investigate", async () => {
			const incident = {
				id: "inc-1",
				status: IncidentStatus.NEW,
				severity: "low",
				title: "Test failure",
				message: "Something broke",
				source: "test",
			}
			healingBus.listOpen.mockReturnValue([incident])
			healingBus.transitionState.mockResolvedValue()

			const result = await loop.runHealingCycle()
			expect(result.processed).toBe(1)
			expect(result.actions[0]).toContain("inc-1")
			// Should have stamped a fingerprint
			expect(healingBus.updateIncident).toHaveBeenCalledWith(
				"inc-1",
				expect.objectContaining({ fingerprint: expect.any(String) }),
			)
			// Should have transitioned to investigating
			expect(healingBus.transitionState).toHaveBeenCalledWith(
				"inc-1",
				IncidentStatus.INVESTIGATING,
				expect.any(String),
				expect.any(String),
			)
		})

		it("should escalate NEW incident when fingerprint threshold exceeded", async () => {
			const incident = {
				id: "inc-2",
				status: IncidentStatus.NEW,
				severity: "low",
				title: "Repeated failure",
				message: "Keeps breaking",
				source: "test",
			}

			// Pre-populate failure records to exceed threshold
			const fp = "test_fingerprint"
			loop._failureRecords.set(fp, [
				{ incidentId: "prev-1", timestamp: Date.now(), status: "new" },
				{ incidentId: "prev-2", timestamp: Date.now(), status: "new" },
				{ incidentId: "prev-3", timestamp: Date.now(), status: "new" },
			])

			// Mock computeFingerprint to return our known fingerprint
			// We need to set it on the incident directly since computeFingerprint
			// uses crypto internally
			incident.fingerprint = fp

			healingBus.listOpen.mockReturnValue([incident])
			healingBus.transitionState.mockResolvedValue()

			const result = await loop.runHealingCycle()
			expect(result.processed).toBe(1)
			expect(result.actions[0]).toContain("escalated_fingerprint")
			expect(loop.stats.escalations).toBe(1)
		})

		it("should process INVESTIGATING incident: queue for fix when auto-fix allowed", async () => {
			const incident = {
				id: "inc-3",
				status: IncidentStatus.INVESTIGATING,
				severity: "medium",
				title: "Fixable issue",
				fingerprint: "fp-3",
			}
			healingBus.listOpen.mockReturnValue([incident])
			healingBus.transitionState.mockResolvedValue()
			healingBus.isAutoFixAllowed.mockReturnValue(true)

			const result = await loop.runHealingCycle()
			expect(result.actions[0]).toContain("queued_for_fix")
			expect(healingBus.transitionState).toHaveBeenCalledWith(
				"inc-3",
				IncidentStatus.QUEUED_FOR_FIX,
				expect.any(String),
				expect.any(String),
			)
		})

		it("should escalate INVESTIGATING incident when auto-fix not allowed", async () => {
			const incident = {
				id: "inc-4",
				status: IncidentStatus.INVESTIGATING,
				severity: "medium",
				title: "Not fixable",
				fingerprint: "fp-4",
				fixCount: 2,
				rootCauseCategory: RootCauseCategory.UNKNOWN,
			}
			healingBus.listOpen.mockReturnValue([incident])
			healingBus.transitionState.mockResolvedValue()
			healingBus.isAutoFixAllowed.mockReturnValue(false)

			const result = await loop.runHealingCycle()
			expect(result.actions[0]).toContain("escalated")
			expect(loop.stats.escalations).toBe(1)
		})

		it("should process QUEUED_FOR_FIX incident: queue fix task", async () => {
			const taskQueue = { add: vi.fn() }
			loop.taskQueue = taskQueue

			const incident = {
				id: "inc-5",
				status: IncidentStatus.QUEUED_FOR_FIX,
				severity: "critical",
				title: "Critical bug",
				message: "App crashed",
				rootCauseCategory: RootCauseCategory.CODE_BUG,
				source: "monitor",
			}
			healingBus.listOpen.mockReturnValue([incident])
			healingBus.transitionState.mockResolvedValue()

			const result = await loop.runHealingCycle()
			expect(result.actions[0]).toContain("fix_queued")
			expect(taskQueue.add).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "healing_fix",
					priority: 1, // critical
				}),
			)
		})

		it("should process QUEUED_FOR_FIX incident without task queue", async () => {
			const incident = {
				id: "inc-6",
				status: IncidentStatus.QUEUED_FOR_FIX,
				severity: "low",
				title: "Minor issue",
			}
			healingBus.listOpen.mockReturnValue([incident])
			healingBus.transitionState.mockResolvedValue()

			const result = await loop.runHealingCycle()
			expect(result.actions[0]).toContain("fix_ready")
			expect(healingBus.transitionState).toHaveBeenCalledWith(
				"inc-6",
				IncidentStatus.FIX_READY,
				expect.any(String),
				expect.stringContaining("No task queue"),
			)
		})

		it("should process FIXING incident: timeout after 5 minutes", async () => {
			const incident = {
				id: "inc-7",
				status: IncidentStatus.FIXING,
				severity: "high",
				title: "Stuck fix",
				updatedAt: Date.now() - 6 * 60 * 1000, // 6 minutes ago
			}
			healingBus.listOpen.mockReturnValue([incident])
			healingBus.transitionState.mockResolvedValue()

			const result = await loop.runHealingCycle()
			expect(result.actions[0]).toContain("reopened_timeout")
		})

		it("should return null for recent FIXING incident", async () => {
			const incident = {
				id: "inc-8",
				status: IncidentStatus.FIXING,
				severity: "high",
				title: "In progress",
				updatedAt: Date.now() - 1000, // 1 second ago
			}
			healingBus.listOpen.mockReturnValue([incident])

			const result = await loop.runHealingCycle()
			expect(result.actions).toEqual([])
		})

		it("should process FIX_READY incident: deploy when autoDeployEnabled", async () => {
			loop.updateConfig({ autoDeployEnabled: true })
			const incident = {
				id: "inc-9",
				status: IncidentStatus.FIX_READY,
				severity: "high",
				title: "Ready to deploy",
			}
			healingBus.listOpen.mockReturnValue([incident])
			healingBus.transitionState.mockResolvedValue()

			const result = await loop.runHealingCycle()
			expect(result.actions[0]).toContain("deployed")
		})

		it("should return null for FIX_READY without autoDeploy", async () => {
			const incident = {
				id: "inc-10",
				status: IncidentStatus.FIX_READY,
				severity: "high",
				title: "Manual deploy needed",
			}
			healingBus.listOpen.mockReturnValue([incident])

			const result = await loop.runHealingCycle()
			expect(result.actions).toEqual([])
		})

		it("should process DEPLOYED incident: verify", async () => {
			const incident = {
				id: "inc-11",
				status: IncidentStatus.DEPLOYED,
				severity: "high",
				title: "Deployed fix",
			}
			healingBus.listOpen.mockReturnValue([incident])
			healingBus.transitionState.mockResolvedValue()

			const result = await loop.runHealingCycle()
			expect(result.actions[0]).toContain("verifying")
		})

		it("should process VERIFYING incident: auto-verify after grace period", async () => {
			const incident = {
				id: "inc-12",
				status: IncidentStatus.VERIFYING,
				severity: "medium",
				title: "Verifying fix",
				fingerprint: "fp-12",
				updatedAt: Date.now() - 31 * 1000, // 31 seconds ago
			}
			healingBus.listOpen.mockReturnValue([incident])
			healingBus.transitionState.mockResolvedValue()

			const result = await loop.runHealingCycle()
			expect(result.actions[0]).toContain("verified")
			expect(loop.stats.autoFixesApplied).toBe(1)
		})

		it("should return null for recent VERIFYING incident", async () => {
			const incident = {
				id: "inc-13",
				status: IncidentStatus.VERIFYING,
				severity: "medium",
				title: "Still verifying",
				updatedAt: Date.now() - 1000, // 1 second ago
			}
			healingBus.listOpen.mockReturnValue([incident])

			const result = await loop.runHealingCycle()
			expect(result.actions).toEqual([])
		})

		it("should process REOPENED incident: escalate when max attempts reached", async () => {
			const incident = {
				id: "inc-14",
				status: IncidentStatus.REOPENED,
				severity: "high",
				title: "Reopened issue",
				fixCount: 3, // maxFixAttempts = 3
				fingerprint: "fp-14",
			}
			healingBus.listOpen.mockReturnValue([incident])
			healingBus.transitionState.mockResolvedValue()

			const result = await loop.runHealingCycle()
			expect(result.actions[0]).toContain("escalated_max_attempts")
			expect(loop.stats.escalations).toBe(1)
		})

		it("should process REOPENED incident: re-investigate when under max attempts", async () => {
			const incident = {
				id: "inc-15",
				status: IncidentStatus.REOPENED,
				severity: "high",
				title: "Reopened but retryable",
				fixCount: 1,
			}
			healingBus.listOpen.mockReturnValue([incident])
			healingBus.transitionState.mockResolvedValue()

			const result = await loop.runHealingCycle()
			expect(result.actions[0]).toContain("reinvestigating")
			expect(healingBus.updateIncident).toHaveBeenCalledWith("inc-15", { fixCount: 2 })
		})

		it("should return null for unknown status", async () => {
			const incident = {
				id: "inc-16",
				status: "unknown_status",
				severity: "low",
			}
			healingBus.listOpen.mockReturnValue([incident])

			const result = await loop.runHealingCycle()
			expect(result.actions).toEqual([])
		})
	})

	// ── Fingerprint Escalation ─────────────────────────────────────────────

	describe("fingerprint escalation", () => {
		it("should compute fingerprint from incident fields", () => {
			// computeFingerprint is internal, but we can test via the NEW incident path
			const incident = {
				id: "fp-test",
				status: IncidentStatus.NEW,
				severity: "low",
				title: "Test error",
				message: "Connection refused",
				source: "api",
			}
			healingBus.listOpen.mockReturnValue([incident])
			healingBus.transitionState.mockResolvedValue()

			loop.runHealingCycle()
			expect(healingBus.updateIncident).toHaveBeenCalledWith(
				"fp-test",
				expect.objectContaining({
					fingerprint: expect.stringMatching(/^[a-f0-9]{16}$/),
				}),
			)
		})

		it("should detect threshold exceeded", () => {
			loop._failureRecords.set("fp-abc", [
				{ incidentId: "1", timestamp: Date.now(), status: "new" },
				{ incidentId: "2", timestamp: Date.now(), status: "new" },
				{ incidentId: "3", timestamp: Date.now(), status: "new" },
			])
			expect(loop._isFingerprintThresholdExceeded("fp-abc")).toBe(true)
		})

		it("should not detect threshold when under limit", () => {
			loop._failureRecords.set("fp-abc", [{ incidentId: "1", timestamp: Date.now(), status: "new" }])
			expect(loop._isFingerprintThresholdExceeded("fp-abc")).toBe(false)
		})

		it("should return false for missing fingerprint", () => {
			expect(loop._isFingerprintThresholdExceeded(null)).toBe(false)
			expect(loop._isFingerprintThresholdExceeded("")).toBe(false)
		})

		it("should return fingerprint stats sorted by count", () => {
			loop._failureRecords.set("fp-a", [{ incidentId: "1", timestamp: Date.now(), status: "new" }])
			loop._failureRecords.set("fp-b", [
				{ incidentId: "2", timestamp: Date.now(), status: "new" },
				{ incidentId: "3", timestamp: Date.now(), status: "new" },
				{ incidentId: "4", timestamp: Date.now(), status: "new" },
			])
			loop._failureRecords.set("fp-c", [
				{ incidentId: "5", timestamp: Date.now(), status: "new" },
				{ incidentId: "6", timestamp: Date.now(), status: "new" },
			])

			const stats = loop.getFingerprintStats()
			expect(stats).toHaveLength(3)
			expect(stats[0].fingerprint).toBe("fp-b") // highest count first
			expect(stats[0].count).toBe(3)
			expect(stats[1].fingerprint).toBe("fp-c")
			expect(stats[1].count).toBe(2)
			expect(stats[2].fingerprint).toBe("fp-a")
			expect(stats[2].count).toBe(1)
		})
	})

	// ── Failure Recording ──────────────────────────────────────────────────

	describe("failure recording", () => {
		it("should record failure by fingerprint", () => {
			const incident = { id: "inc-1", fingerprint: "fp-1", status: "new" }
			loop.recordFailure(incident)
			const records = loop._failureRecords.get("fp-1")
			expect(records).toHaveLength(1)
			expect(records[0].incidentId).toBe("inc-1")
		})

		it("should record failure by ID when no fingerprint", () => {
			const incident = { id: "inc-2", status: "new" }
			loop.recordFailure(incident)
			const records = loop._failureRecords.get("inc-2")
			expect(records).toHaveLength(1)
		})

		it("should accumulate multiple failures for same fingerprint", () => {
			loop.recordFailure({ id: "inc-1", fingerprint: "fp-1", status: "new" })
			loop.recordFailure({ id: "inc-2", fingerprint: "fp-1", status: "new" })
			loop.recordFailure({ id: "inc-3", fingerprint: "fp-1", status: "new" })
			expect(loop._failureRecords.get("fp-1")).toHaveLength(3)
		})

		it("should clear failure record", () => {
			loop.recordFailure({ id: "inc-1", fingerprint: "fp-1", status: "new" })
			expect(loop._failureRecords.has("fp-1")).toBe(true)
			loop.clearFailureRecord({ fingerprint: "fp-1" })
			expect(loop._failureRecords.has("fp-1")).toBe(false)
		})

		it("should clear by ID when no fingerprint", () => {
			loop.recordFailure({ id: "inc-2", status: "new" })
			expect(loop._failureRecords.has("inc-2")).toBe(true)
			loop.clearFailureRecord({ id: "inc-2" })
			expect(loop._failureRecords.has("inc-2")).toBe(false)
		})
	})

	// ── Escalation Logic ───────────────────────────────────────────────────

	describe("shouldEscalate", () => {
		it("should escalate when fixCount >= maxFixAttempts", () => {
			expect(loop.shouldEscalate({ fixCount: 3 })).toBe(true)
		})

		it("should escalate for SECURITY root cause", () => {
			expect(loop.shouldEscalate({ fixCount: 0, rootCauseCategory: RootCauseCategory.SECURITY })).toBe(true)
		})

		it("should escalate for UNKNOWN root cause with fixCount >= 1", () => {
			expect(loop.shouldEscalate({ fixCount: 1, rootCauseCategory: RootCauseCategory.UNKNOWN })).toBe(true)
		})

		it("should not escalate for low fixCount and known category", () => {
			expect(loop.shouldEscalate({ fixCount: 0, rootCauseCategory: RootCauseCategory.CODE_BUG })).toBe(false)
		})
	})

	// ── Swarm Debugger Integration ─────────────────────────────────────────

	describe("swarm debugger", () => {
		it("should trigger swarm debug for critical NEW incidents", async () => {
			const swarmDebugger = { debug: vi.fn(() => Promise.resolve({ runId: "run-1" })) }
			loop.setSwarmDebugger(swarmDebugger)

			const incident = {
				id: "swarm-1",
				status: IncidentStatus.NEW,
				severity: "critical",
				title: "Critical crash",
				description: "App crashed on startup",
				message: "Segfault",
				source: "monitor",
				projectId: "proj-1",
				filesChanged: ["app.js"],
			}
			healingBus.listOpen.mockReturnValue([incident])
			healingBus.transitionState.mockResolvedValue()

			await loop.runHealingCycle()

			// Swarm debug should have been called
			expect(swarmDebugger.debug).toHaveBeenCalledWith(
				expect.objectContaining({
					projectId: "proj-1",
					taskId: "swarm-1",
				}),
			)
		})

		it("should not trigger swarm debug for low severity incidents", async () => {
			const swarmDebugger = { debug: vi.fn() }
			loop.setSwarmDebugger(swarmDebugger)

			const incident = {
				id: "swarm-2",
				status: IncidentStatus.NEW,
				severity: "low",
				title: "Minor warning",
				message: "Disk at 80%",
				source: "monitor",
			}
			healingBus.listOpen.mockReturnValue([incident])
			healingBus.transitionState.mockResolvedValue()

			await loop.runHealingCycle()

			expect(swarmDebugger.debug).not.toHaveBeenCalled()
		})
	})

	// ── Risk Engine Integration ────────────────────────────────────────────

	describe("risk engine", () => {
		it("should record failure pattern after verification", async () => {
			const riskEngine = { recordFailurePattern: vi.fn(() => Promise.resolve()) }
			loop.setRiskEngine(riskEngine)

			const incident = {
				id: "risk-1",
				status: IncidentStatus.VERIFYING,
				severity: "critical",
				title: "Critical failure",
				description: "App crashed",
				fingerprint: "fp-risk",
				projectId: "proj-1",
				fixDescription: "Fixed memory leak",
				updatedAt: Date.now() - 31 * 1000,
			}
			healingBus.listOpen.mockReturnValue([incident])
			healingBus.transitionState.mockResolvedValue()

			await loop.runHealingCycle()

			expect(riskEngine.recordFailurePattern).toHaveBeenCalledWith(
				expect.objectContaining({
					projectId: "proj-1",
					patternType: "crash",
					signature: "fp-risk",
				}),
			)
		})
	})

	// ── Repair Runs ────────────────────────────────────────────────────────

	describe("repair runs", () => {
		it("should write repair run to JSONL", () => {
			const incident = {
				id: "rr-1",
				fingerprint: "fp-rr",
				title: "Test incident",
				source: "test",
				severity: "high",
				fixCount: 2,
				rootCauseCategory: RootCauseCategory.CODE_BUG,
			}

			// Mock fs.appendFileSync
			const appendSpy = vi.spyOn(fs, "appendFileSync").mockImplementation(() => {})

			loop._writeRepairRun(incident, "fixed", "Applied patch")

			expect(appendSpy).toHaveBeenCalledTimes(1)
			const written = JSON.parse(appendSpy.mock.calls[0][1])
			expect(written.incident_id).toBe("rr-1")
			expect(written.final_status).toBe("fixed")
			expect(written.fix_applied).toBe("Applied patch")
			expect(written.failure_signature).toBe("fp-rr")
			expect(written.attempts_count).toBe(2)

			appendSpy.mockRestore()
		})

		it("should read repair runs from JSONL", () => {
			const testData = [
				{ id: "1", incident_id: "inc-1", final_status: "fixed" },
				{ id: "2", incident_id: "inc-2", final_status: "escalated" },
			]
			const jsonl = testData.map((d) => JSON.stringify(d)).join("\n") + "\n"

			const readSpy = vi.spyOn(fs, "readFileSync").mockReturnValue(jsonl)

			const runs = loop.getRepairRuns(10)
			expect(runs).toHaveLength(2)
			expect(runs[0].incident_id).toBe("inc-2") // reversed
			expect(runs[1].incident_id).toBe("inc-1")

			readSpy.mockRestore()
		})

		it("should return empty array when JSONL file missing", () => {
			const readSpy = vi.spyOn(fs, "readFileSync").mockImplementation(() => {
				throw new Error("ENOENT: no such file")
			})

			const runs = loop.getRepairRuns(10)
			expect(runs).toEqual([])

			readSpy.mockRestore()
		})
	})

	// ── Legacy Constructor ─────────────────────────────────────────────────

	describe("legacy constructor", () => {
		it("should accept orchestrator with healingBus property (legacy form)", () => {
			const healingBus = createMockHealingBus()
			const orchestrator = {
				healingBus,
				taskQueue: { add: vi.fn() },
				submit: vi.fn(),
			}
			const legacyLoop = new SelfHealingLoop(orchestrator, { maxFixAttempts: 5 })
			expect(legacyLoop.healingBus).toBe(healingBus)
			expect(legacyLoop.taskQueue).toBe(orchestrator.taskQueue)
			// Config override should be applied
			expect(legacyLoop.config.maxFixAttempts).toBe(5)
		})

		it("should accept canonical form with config object", () => {
			const healingBus = createMockHealingBus()
			const canonicalLoop = new SelfHealingLoop({
				healingBus,
				config: { maxFixAttempts: 7 },
			})
			expect(canonicalLoop.healingBus).toBe(healingBus)
			expect(canonicalLoop.config.maxFixAttempts).toBe(7)
		})
	})
})
