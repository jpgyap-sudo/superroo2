/**
 * Tests for WorkingTreeAgent.
 *
 * Verifies that the agent correctly monitors product updates, bug fixes,
 * and feature changes, and emits appropriate events when the working tree
 * needs refreshing.
 */

import { describe, test, expect, vi, beforeEach } from "vitest"
import { WorkingTreeAgent } from "../agents/WorkingTreeAgent"
import type { ProductMemoryService } from "../ProductMemoryService"
import type { EventLog } from "../../logging/EventLog"
import type { AgentRunContext } from "../../types"

// ── Mocks ─────────────────────────────────────────────────────────────────────

function createMockService(): ProductMemoryService {
	return {
		getFeatures: vi.fn().mockResolvedValue({
			features: [
				{
					id: "feat_1",
					name: "Orchestrator Core",
					category: "Orchestrator",
					description: "Core orchestration engine",
					status: "working",
					confidence: 95,
					ownerAgent: "orchestrator",
					relatedFiles: [],
					lastTestedAt: "2025-01-01T00:00:00Z",
					knownBugs: [],
					testChecklist: [],
				},
				{
					id: "feat_2",
					name: "ML Engine",
					category: "ML",
					description: "Neural network engine",
					status: "planned",
					confidence: 30,
					ownerAgent: "ml",
					relatedFiles: [],
					lastTestedAt: null,
					knownBugs: ["bug_1"],
					testChecklist: [],
				},
			],
		}),
		getUpdates: vi.fn().mockResolvedValue({
			updates: [
				{
					id: "upd_1",
					timestamp: "2025-01-01T00:00:00Z",
					type: "feature_added",
					title: "Added Orchestrator Core",
					summary: "",
					filesChanged: [],
					status: "deployed",
					linkedFeatures: ["feat_1"],
					rollbackAvailable: true,
				},
			],
		}),
		addFeature: vi.fn(),
		updateFeature: vi.fn(),
		addUpdate: vi.fn(),
		mapBugToFeature: vi.fn(),
		addAgentNote: vi.fn(),
		recommendImprovements: vi.fn(),
		listFeaturesNeedingTests: vi.fn(),
	} as unknown as ProductMemoryService
}

function createMockEvents(): EventLog {
	return {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	} as unknown as EventLog
}

function createMockContext(): AgentRunContext {
	return {
		task: {
			id: "task_1",
			agent: "working-tree",
			goal: "Test working tree",
			priority: "normal",
			status: "running",
			payload: {},
			createdAt: Date.now(),
			updatedAt: Date.now(),
			attempts: 0,
		},
		emit: vi.fn(),
		signal: new AbortController().signal,
		safetyMode: "AUTO",
	} as unknown as AgentRunContext
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("WorkingTreeAgent", () => {
	let agent: WorkingTreeAgent
	let service: ProductMemoryService
	let events: EventLog

	beforeEach(() => {
		service = createMockService()
		events = createMockEvents()
		agent = new WorkingTreeAgent({ service, events })
	})

	describe("checkTree", () => {
		test("takes a baseline snapshot on first run", async () => {
			const ctx = createMockContext()
			ctx.task.payload = { operation: "checkTree" }

			const result = await agent.run(ctx)

			expect(result.ok).toBe(true)
			expect(result.summary).toContain("baseline snapshot")
			expect(result.data).toBeDefined()
			expect((result.data as any).firstRun).toBe(true)
			expect((result.data as any).snapshot).toBeDefined()
			expect((result.data as any).snapshot.featureCount).toBe(2)
			expect((result.data as any).snapshot.updateCount).toBe(1)
		})

		test("detects changes on second run", async () => {
			const ctx = createMockContext()
			ctx.task.payload = { operation: "checkTree" }

			// First run — baseline
			await agent.run(ctx)

			// Change the mock data
			;(service.getFeatures as any).mockResolvedValue({
				features: [
					{
						id: "feat_1",
						name: "Orchestrator Core",
						category: "Orchestrator",
						description: "Core orchestration engine",
						status: "working",
						confidence: 95,
						ownerAgent: "orchestrator",
						relatedFiles: [],
						lastTestedAt: "2025-01-01T00:00:00Z",
						knownBugs: [],
						testChecklist: [],
					},
					{
						id: "feat_2",
						name: "ML Engine",
						category: "ML",
						description: "Neural network engine",
						status: "working", // changed from "planned"
						confidence: 85, // changed from 30
						ownerAgent: "ml",
						relatedFiles: [],
						lastTestedAt: "2025-01-02T00:00:00Z",
						knownBugs: [],
						testChecklist: [],
					},
					{
						id: "feat_3",
						name: "New Feature",
						category: "Healing",
						description: "New healing feature",
						status: "planned",
						confidence: 10,
						ownerAgent: "healing",
						relatedFiles: [],
						lastTestedAt: null,
						knownBugs: [],
						testChecklist: [],
					},
				],
			})

			// Second run — should detect changes
			const result = await agent.run(ctx)

			expect(result.ok).toBe(true)
			expect(result.summary).toContain("changes detected")
			expect((result.data as any).needsRefresh).toBe(true)
			expect((result.data as any).changes.length).toBeGreaterThan(0)
		})

		test("reports no changes when state is identical", async () => {
			const ctx = createMockContext()
			ctx.task.payload = { operation: "checkTree" }

			// First run — baseline
			await agent.run(ctx)

			// Second run — no changes
			const result = await agent.run(ctx)

			expect(result.ok).toBe(true)
			expect(result.summary).toContain("up to date")
			expect((result.data as any).needsRefresh).toBe(false)
		})
	})

	describe("refreshTree", () => {
		test("takes a fresh snapshot and emits event", async () => {
			const ctx = createMockContext()
			ctx.task.payload = { operation: "refreshTree" }

			const result = await agent.run(ctx)

			expect(result.ok).toBe(true)
			expect(result.summary).toContain("refreshed")
			expect(events.info).toHaveBeenCalledWith("working_tree.refreshed", expect.any(String), expect.any(Object))
		})
	})

	describe("getTreeStatus", () => {
		test("returns current status without modifying state", async () => {
			const ctx = createMockContext()
			ctx.task.payload = { operation: "getTreeStatus" }

			const result = await agent.run(ctx)

			expect(result.ok).toBe(true)
			expect(result.data).toBeDefined()
			expect((result.data as any).snapshot).toBeDefined()
			expect((result.data as any).lastChecked).toBeDefined()
		})
	})

	describe("onProductUpdate", () => {
		test("refreshes tree for structural update types", async () => {
			const ctx = createMockContext()
			ctx.task.payload = {
				operation: "onProductUpdate",
				type: "feature_added",
				title: "New Feature Added",
			}

			const result = await agent.run(ctx)

			expect(result.ok).toBe(true)
			expect(result.summary).toContain("refreshed")
			expect(events.info).toHaveBeenCalledWith(
				"working_tree.updated_from_product_update",
				expect.any(String),
				expect.any(Object),
			)
		})

		test("only checks tree for non-structural update types", async () => {
			const ctx = createMockContext()
			ctx.task.payload = {
				operation: "onProductUpdate",
				type: "test_result",
				title: "Test Result",
			}

			const result = await agent.run(ctx)

			expect(result.ok).toBe(true)
			// Should not have emitted the refresh event
			expect(events.info).not.toHaveBeenCalledWith(
				"working_tree.updated_from_product_update",
				expect.any(String),
				expect.any(Object),
			)
		})
	})

	describe("onBugFix", () => {
		test("checks tree when bug fix has a featureId", async () => {
			const ctx = createMockContext()
			ctx.task.payload = {
				operation: "onBugFix",
				bugId: "bug_1",
				featureId: "feat_2",
			}

			const result = await agent.run(ctx)

			expect(result.ok).toBe(true)
			expect(events.info).toHaveBeenCalledWith(
				"working_tree.checked_after_bug_fix",
				expect.any(String),
				expect.any(Object),
			)
		})

		test("reports no tree effect when bug fix has no featureId", async () => {
			const ctx = createMockContext()
			ctx.task.payload = {
				operation: "onBugFix",
				bugId: "bug_1",
			}

			const result = await agent.run(ctx)

			expect(result.ok).toBe(true)
			expect((result.data as any).treeAffected).toBe(false)
		})
	})

	describe("onFeatureChange", () => {
		test("checks tree for significant status changes", async () => {
			const ctx = createMockContext()
			ctx.task.payload = {
				operation: "onFeatureChange",
				featureId: "feat_1",
				status: "deprecated",
			}

			const result = await agent.run(ctx)

			expect(result.ok).toBe(true)
			expect(events.info).toHaveBeenCalledWith(
				"working_tree.checked_after_feature_change",
				expect.any(String),
				expect.any(Object),
			)
		})

		test("reports no tree effect for minor status changes", async () => {
			const ctx = createMockContext()
			ctx.task.payload = {
				operation: "onFeatureChange",
				featureId: "feat_1",
				status: "testing",
			}

			const result = await agent.run(ctx)

			expect(result.ok).toBe(true)
			expect((result.data as any).treeAffected).toBe(false)
		})
	})

	describe("unknown operation", () => {
		test("returns error for unknown operation", async () => {
			const ctx = createMockContext()
			ctx.task.payload = { operation: "unknownOp" }

			const result = await agent.run(ctx)

			expect(result.ok).toBe(false)
			expect(result.summary).toContain("Unknown operation")
		})
	})
})
