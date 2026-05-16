/**
 * Super Roo — Product Memory Service tests.
 *
 * Tests the ProductMemoryService with isolated temp directories.
 * Each describe block gets its own temp directory.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest"
import fs from "fs/promises"
import path from "path"
import os from "os"

import { ProductMemoryService } from "../ProductMemoryService"
import type { EventLog } from "../../logging/EventLog"

// ── Helpers ───────────────────────────────────────────────────────────────────

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

let suiteCounter = 0

/**
 * Create a fresh service + temp directory for a describe block.
 * The directory is cleaned up after all tests in the block finish.
 */
async function makeService(): Promise<{
	svc: ProductMemoryService
	tmpDir: string
	cleanup: () => Promise<void>
}> {
	const unique = `pm-suite-${process.pid}-${++suiteCounter}-${Date.now()}`
	const tmpDir = path.join(os.tmpdir(), unique)
	await fs.mkdir(tmpDir, { recursive: true })
	const events = fakeEventLog()
	const svc = new ProductMemoryService(events)
	svc.setMemoryDir(tmpDir)
	await svc.initialize()
	const cleanup = async () => {
		try {
			await fs.rm(tmpDir, { recursive: true, force: true })
		} catch {
			// ignore cleanup errors
		}
	}
	return { svc, tmpDir, cleanup }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ProductMemoryService", () => {
	describe("initialize", () => {
		it("creates the memory directory", async () => {
			const { svc, tmpDir, cleanup } = await makeService()
			try {
				const stat = await fs.stat(tmpDir)
				expect(stat.isDirectory()).toBe(true)
			} finally {
				await cleanup()
			}
		})
	})

	describe("listMemoryFiles", () => {
		it("returns all allowed file names", async () => {
			const { svc, cleanup } = await makeService()
			try {
				const files = await svc.listMemoryFiles()
				expect(files).toContain("product-features.json")
				expect(files).toContain("product-updates.json")
				expect(files).toContain("feature-test-history.json")
				expect(files).toContain("bug-feature-map.json")
				expect(files).toContain("agent-notes.json")
				expect(files).toHaveLength(5)
			} finally {
				await cleanup()
			}
		})
	})

	describe("readMemoryFile", () => {
		it("auto-creates a file with default content if it does not exist", async () => {
			const { svc, cleanup } = await makeService()
			try {
				const data = await svc.readMemoryFile<{ features: unknown[] }>("product-features.json")
				expect(data.features).toEqual([])
			} finally {
				await cleanup()
			}
		})

		it("throws for disallowed file names", async () => {
			const { svc, cleanup } = await makeService()
			try {
				await expect(svc.readMemoryFile("evil.json")).rejects.toThrow("Unsupported memory file")
			} finally {
				await cleanup()
			}
		})
	})

	describe("writeMemoryFile", () => {
		it("writes data to a file and can be read back", async () => {
			const { svc, cleanup } = await makeService()
			try {
				await svc.writeMemoryFile("product-features.json", { features: [{ id: "1", name: "Test" }] })
				const data = await svc.readMemoryFile<{ features: Array<{ name: string }> }>("product-features.json")
				expect(data.features[0].name).toBe("Test")
			} finally {
				await cleanup()
			}
		})

		it("throws for disallowed file names", async () => {
			const { svc, cleanup } = await makeService()
			try {
				await expect(svc.writeMemoryFile("evil.json", {})).rejects.toThrow("Unsupported memory file")
			} finally {
				await cleanup()
			}
		})
	})

	// ── Features ──────────────────────────────────────────────────────────

	describe("getFeatures / addFeature / updateFeature", () => {
		it("starts with an empty feature list", async () => {
			const { svc, cleanup } = await makeService()
			try {
				const mem = await svc.getFeatures()
				expect(mem.features).toEqual([])
			} finally {
				await cleanup()
			}
		})

		it("adds a feature with defaults", async () => {
			const { svc, cleanup } = await makeService()
			try {
				const f = await svc.addFeature({ name: "Test Feature" })
				expect(f.id).toBeTruthy()
				expect(f.name).toBe("Test Feature")
				expect(f.status).toBe("planned")
				expect(f.confidence).toBe(0)
				expect(f.ownerAgent).toBe("unknown")
				expect(f.relatedFiles).toEqual([])
				expect(f.knownBugs).toEqual([])
				expect(f.testChecklist).toEqual([])
				expect(f.lastTestedAt).toBeNull()
			} finally {
				await cleanup()
			}
		})

		it("adds a feature with custom fields", async () => {
			const { svc, cleanup } = await makeService()
			try {
				const f = await svc.addFeature({
					name: "Custom Feature",
					category: "Testing",
					description: "A test feature",
					status: "working",
					confidence: 95,
					ownerAgent: "tester",
					relatedFiles: ["src/test.ts"],
					testChecklist: ["Check A", "Check B"],
				})
				expect(f.name).toBe("Custom Feature")
				expect(f.category).toBe("Testing")
				expect(f.description).toBe("A test feature")
				expect(f.status).toBe("working")
				expect(f.confidence).toBe(95)
				expect(f.ownerAgent).toBe("tester")
				expect(f.relatedFiles).toEqual(["src/test.ts"])
				expect(f.testChecklist).toEqual(["Check A", "Check B"])
			} finally {
				await cleanup()
			}
		})

		it("lists all added features", async () => {
			const { svc, cleanup } = await makeService()
			try {
				await svc.addFeature({ name: "Feature A" })
				await svc.addFeature({ name: "Feature B" })
				const mem = await svc.getFeatures()
				expect(mem.features).toHaveLength(2)
				expect(mem.features[0].name).toBe("Feature A")
				expect(mem.features[1].name).toBe("Feature B")
			} finally {
				await cleanup()
			}
		})

		it("updates an existing feature", async () => {
			const { svc, cleanup } = await makeService()
			try {
				const f = await svc.addFeature({ name: "Original" })
				const updated = await svc.updateFeature(f.id, { name: "Updated", confidence: 100 })
				expect(updated.name).toBe("Updated")
				expect(updated.confidence).toBe(100)
			} finally {
				await cleanup()
			}
		})

		it("throws when updating a non-existent feature", async () => {
			const { svc, cleanup } = await makeService()
			try {
				await expect(svc.updateFeature("nonexistent", { name: "Nope" })).rejects.toThrow("Feature not found")
			} finally {
				await cleanup()
			}
		})
	})

	// ── Testing ───────────────────────────────────────────────────────────

	describe("testFeature", () => {
		it("records a passing test and updates feature status", async () => {
			const { svc, cleanup } = await makeService()
			try {
				const f = await svc.addFeature({ name: "Testable" })
				const record = await svc.testFeature(f.id, "pass", "All good")
				expect(record.result).toBe("pass")
				expect(record.featureId).toBe(f.id)
				expect(record.issuesFound).toEqual([])

				const mem = await svc.getFeatures()
				const updated = mem.features[0]
				expect(updated.status).toBe("working")
				expect(updated.confidence).toBe(95)
				expect(updated.lastTestedAt).toBe(record.testedAt)
			} finally {
				await cleanup()
			}
		})

		it("records a failing test and marks feature as broken", async () => {
			const { svc, cleanup } = await makeService()
			try {
				const f = await svc.addFeature({ name: "Fragile" })
				const record = await svc.testFeature(f.id, "fail", "Critical bug found")
				expect(record.result).toBe("fail")
				expect(record.issuesFound).toHaveLength(1)

				const mem = await svc.getFeatures()
				const updated = mem.features[0]
				expect(updated.status).toBe("broken")
				expect(updated.confidence).toBe(40)
			} finally {
				await cleanup()
			}
		})

		it("stores test records in feature-test-history.json", async () => {
			const { svc, cleanup } = await makeService()
			try {
				const f = await svc.addFeature({ name: "Tracked" })
				await svc.testFeature(f.id, "pass")
				await svc.testFeature(f.id, "warning")

				const history = await svc.readMemoryFile<{ tests: Array<{ result: string }> }>(
					"feature-test-history.json",
				)
				expect(history.tests).toHaveLength(2)
				expect(history.tests[0].result).toBe("warning") // most recent first
				expect(history.tests[1].result).toBe("pass")
			} finally {
				await cleanup()
			}
		})
	})

	// ── Updates ───────────────────────────────────────────────────────────

	describe("getUpdates / addUpdate", () => {
		it("starts with an empty update list", async () => {
			const { svc, cleanup } = await makeService()
			try {
				const mem = await svc.getUpdates()
				expect(mem.updates).toEqual([])
			} finally {
				await cleanup()
			}
		})

		it("adds an update with required fields", async () => {
			const { svc, cleanup } = await makeService()
			try {
				const u = await svc.addUpdate({ title: "Added feature X", type: "feature_added" })
				expect(u.id).toBeTruthy()
				expect(u.title).toBe("Added feature X")
				expect(u.type).toBe("feature_added")
				expect(u.filesChanged).toEqual([])
				expect(u.linkedFeatures).toEqual([])
				expect(u.rollbackAvailable).toBe(true)
			} finally {
				await cleanup()
			}
		})

		it("adds an update with all fields", async () => {
			const { svc, cleanup } = await makeService()
			try {
				const u = await svc.addUpdate({
					title: "Fixed critical bug",
					type: "bug_fixed",
					summary: "Fixed the login crash",
					filesChanged: ["src/auth.ts"],
					linkedFeatures: ["feat_login"],
					rollbackAvailable: false,
				})
				expect(u.summary).toBe("Fixed the login crash")
				expect(u.filesChanged).toEqual(["src/auth.ts"])
				expect(u.linkedFeatures).toEqual(["feat_login"])
				expect(u.rollbackAvailable).toBe(false)
			} finally {
				await cleanup()
			}
		})

		it("stores updates in reverse chronological order", async () => {
			const { svc, cleanup } = await makeService()
			try {
				await svc.addUpdate({ title: "First", type: "feature_added" })
				await svc.addUpdate({ title: "Second", type: "bug_fixed" })
				const mem = await svc.getUpdates()
				expect(mem.updates).toHaveLength(2)
				expect(mem.updates[0].title).toBe("Second")
				expect(mem.updates[1].title).toBe("First")
			} finally {
				await cleanup()
			}
		})
	})

	// ── Bug-Feature Mappings ──────────────────────────────────────────────

	describe("mapBugToFeature", () => {
		it("creates a mapping and updates the feature's knownBugs", async () => {
			const { svc, cleanup } = await makeService()
			try {
				const f = await svc.addFeature({ name: "Buggy Feature" })
				const mapping = await svc.mapBugToFeature({
					featureId: f.id,
					severity: "high",
					title: "Login fails",
					description: "Users cannot log in after update",
					logs: ["error: auth failed"],
				})
				expect(mapping.featureId).toBe(f.id)
				expect(mapping.severity).toBe("high")
				expect(mapping.status).toBe("open")

				const mem = await svc.getFeatures()
				expect(mem.features[0].knownBugs).toContain(mapping.bugId)
			} finally {
				await cleanup()
			}
		})

		it("supports all severity levels", async () => {
			const { svc, cleanup } = await makeService()
			try {
				const f = await svc.addFeature({ name: "Multi-Bug" })
				for (const severity of ["low", "medium", "high", "critical"] as const) {
					const m = await svc.mapBugToFeature({
						featureId: f.id,
						severity,
						title: `Bug ${severity}`,
						description: `A ${severity} severity bug`,
					})
					expect(m.severity).toBe(severity)
				}
				const mem = await svc.getFeatures()
				expect(mem.features[0].knownBugs).toHaveLength(4)
			} finally {
				await cleanup()
			}
		})
	})

	// ── Agent Notes ───────────────────────────────────────────────────────

	describe("addAgentNote", () => {
		it("adds a note and stores it", async () => {
			const { svc, cleanup } = await makeService()
			try {
				const note = await svc.addAgentNote("tester", "Checked all features")
				expect(note.agent).toBe("tester")
				expect(note.note).toBe("Checked all features")

				const mem = await svc.readMemoryFile<{ notes: Array<{ note: string }> }>("agent-notes.json")
				expect(mem.notes[0].note).toBe("Checked all features")
			} finally {
				await cleanup()
			}
		})

		it("stores notes in reverse chronological order", async () => {
			const { svc, cleanup } = await makeService()
			try {
				await svc.addAgentNote("agent-a", "First note")
				await svc.addAgentNote("agent-b", "Second note")
				const mem = await svc.readMemoryFile<{ notes: Array<{ agent: string }> }>("agent-notes.json")
				expect(mem.notes[0].agent).toBe("agent-b")
				expect(mem.notes[1].agent).toBe("agent-a")
			} finally {
				await cleanup()
			}
		})
	})

	// ── Recommendations ───────────────────────────────────────────────────

	describe("recommendImprovements", () => {
		it("returns empty when all features are healthy", async () => {
			const { svc, cleanup } = await makeService()
			try {
				await svc.addFeature({ name: "Healthy", status: "working", confidence: 100 })
				const recs = await svc.recommendImprovements()
				expect(recs).toEqual([])
			} finally {
				await cleanup()
			}
		})

		it("recommends broken features", async () => {
			const { svc, cleanup } = await makeService()
			try {
				await svc.addFeature({ name: "Broken Feature", status: "broken", confidence: 30 })
				const recs = await svc.recommendImprovements()
				expect(recs).toHaveLength(1)
				expect(recs[0].name).toBe("Broken Feature")
				expect(recs[0].recommendation).toContain("Prioritize")
			} finally {
				await cleanup()
			}
		})

		it("recommends features needing tests", async () => {
			const { svc, cleanup } = await makeService()
			try {
				await svc.addFeature({ name: "Untested", status: "needs_test", confidence: 50 })
				const recs = await svc.recommendImprovements()
				expect(recs).toHaveLength(1)
				expect(recs[0].name).toBe("Untested")
			} finally {
				await cleanup()
			}
		})

		it("recommends low-confidence features", async () => {
			const { svc, cleanup } = await makeService()
			try {
				await svc.addFeature({ name: "Low Confidence", status: "working", confidence: 70 })
				const recs = await svc.recommendImprovements()
				expect(recs).toHaveLength(1)
				expect(recs[0].name).toBe("Low Confidence")
			} finally {
				await cleanup()
			}
		})
	})

	describe("listFeaturesNeedingTests", () => {
		it("returns features with needs_test status", async () => {
			const { svc, cleanup } = await makeService()
			try {
				await svc.addFeature({ name: "Needs Test", status: "needs_test" })
				await svc.addFeature({
					name: "Working Fine",
					status: "working",
					lastTestedAt: new Date().toISOString(),
				})
				const list = await svc.listFeaturesNeedingTests()
				expect(list).toHaveLength(1)
				expect(list[0].name).toBe("Needs Test")
			} finally {
				await cleanup()
			}
		})

		it("returns features that have never been tested", async () => {
			const { svc, cleanup } = await makeService()
			try {
				await svc.addFeature({ name: "Never Tested", status: "planned" })
				const list = await svc.listFeaturesNeedingTests()
				expect(list).toHaveLength(1)
				expect(list[0].name).toBe("Never Tested")
			} finally {
				await cleanup()
			}
		})
	})
})
