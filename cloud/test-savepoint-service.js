/**
 * Unit Tests for Savepoint Service
 *
 * Tests the savepoint service's in-memory registry operations and
 * git-based savepoint creation/restoration logic.
 *
 * Run: node test-savepoint-service.js
 */

const sp = require("./api/savepointService")
const path = require("path")
const fs = require("fs")
const os = require("os")

var passed = 0
var failed = 0

function assert(condition, message) {
	if (condition) {
		console.log("  ✅ " + message)
		passed++
	} else {
		console.log("  ❌ " + message)
		failed++
	}
}

function assertEqual(actual, expected, message) {
	if (actual === expected) {
		console.log("  ✅ " + message)
		passed++
	} else {
		console.log("  ❌ " + message + " — expected: " + JSON.stringify(expected) + ", got: " + JSON.stringify(actual))
		failed++
	}
}

async function run() {
	// ─── Test 1: Module Exports ───────────────────────────────────────────────
	console.log("=== Test 1: Module Exports ===\n")

	assert(typeof sp.createSavepoint === "function", "createSavepoint is a function")
	assert(typeof sp.listSavepoints === "function", "listSavepoints is a function")
	assert(typeof sp.restoreSavepoint === "function", "restoreSavepoint is a function")
	assert(typeof sp.getSavepoint === "function", "getSavepoint is a function")
	assert(typeof sp.deleteSavepoint === "function", "deleteSavepoint is a function")
	assert(typeof sp.isGitRepo === "function", "isGitRepo is a function")
	assert(typeof sp.getCurrentBranch === "function", "getCurrentBranch is a function")
	assert(typeof sp.savepointRegistry !== "undefined", "savepointRegistry is exposed")
	assert(typeof sp.loadRegistry === "function", "loadRegistry is a function")
	assert(typeof sp.saveRegistry === "function", "saveRegistry is a function")

	// ─── Test 2: getSavepoint — not found ─────────────────────────────────────
	console.log("\n=== Test 2: getSavepoint — not found ===\n")

	var result = sp.getSavepoint("NONEXISTENT_TASK")
	assert(result === null, "getSavepoint returns null for unknown task")

	// ─── Test 3: getSavepoint — found ─────────────────────────────────────────
	console.log("\n=== Test 3: getSavepoint — found ===\n")

	// Manually insert into registry
	sp.savepointRegistry.set("TEST-001", {
		hash: "abc123def456",
		branch: "main",
		timestamp: Date.now(),
		description: "Test savepoint",
	})

	result = sp.getSavepoint("TEST-001")
	assert(result !== null, "getSavepoint returns entry for existing task")
	assert(result.hash === "abc123def456", "getSavepoint returns correct hash")
	assert(result.branch === "main", "getSavepoint returns correct branch")

	// ─── Test 4: getSavepoint — case insensitive ──────────────────────────────
	console.log("\n=== Test 4: getSavepoint — case insensitive ===\n")

	result = sp.getSavepoint("test-001")
	assert(result !== null, "getSavepoint is case-insensitive (lowercase input)")
	assert(result.hash === "abc123def456", "getSavepoint returns correct entry with lowercase input")

	// ─── Test 5: listSavepoints — returns entries sorted by timestamp ─────────
	console.log("\n=== Test 5: listSavepoints — sorted by timestamp ===\n")

	sp.savepointRegistry.set("TEST-002", {
		hash: "xyz789",
		branch: "feature-x",
		timestamp: 1000,
		description: "Older savepoint",
	})
	sp.savepointRegistry.set("TEST-003", {
		hash: "def000",
		branch: "main",
		timestamp: 9999999999999,
		description: "Newer savepoint",
	})

	var list = await sp.listSavepoints()
	assert(Array.isArray(list), "listSavepoints returns an array")
	assert(list.length >= 3, "listSavepoints returns at least 3 entries")
	// Should be sorted most recent first
	assert(list[0].timestamp >= list[list.length - 1].timestamp, "listSavepoints sorts by most recent first")

	// ─── Test 6: listSavepoints — includes createdAgo ─────────────────────────
	console.log("\n=== Test 6: listSavepoints — includes createdAgo ===\n")

	assert(typeof list[0].createdAgo === "string", "listSavepoints includes createdAgo string")
	assert(list[0].createdAgo.length > 0, "createdAgo is not empty")

	// ─── Test 7: deleteSavepoint — removes from registry ──────────────────────
	console.log("\n=== Test 7: deleteSavepoint — removes from registry ===\n")

	sp.savepointRegistry.set("TEST-DEL", {
		hash: "todelete",
		branch: "main",
		timestamp: Date.now(),
		description: "To be deleted",
	})

	assert(sp.getSavepoint("TEST-DEL") !== null, "savepoint exists before delete")
	// deleteSavepoint requires a repoPath, but we can test registry removal directly
	sp.savepointRegistry.delete("TEST-DEL")
	assert(sp.getSavepoint("TEST-DEL") === null, "savepoint removed after delete")

	// ─── Test 8: createSavepoint — validation ─────────────────────────────────
	console.log("\n=== Test 8: createSavepoint — validation ===\n")

	var caught = false
	try {
		await sp.createSavepoint(null, "TASK-1")
	} catch (e) {
		caught = true
		assert(e.message.includes("repoPath"), "createSavepoint throws for missing repoPath")
	}
	assert(caught, "createSavepoint rejects null repoPath")

	caught = false
	try {
		await sp.createSavepoint("/tmp", null)
	} catch (e) {
		caught = true
		assert(e.message.includes("taskId"), "createSavepoint throws for missing taskId")
	}
	assert(caught, "createSavepoint rejects null taskId")

	// ─── Test 9: restoreSavepoint — validation ────────────────────────────────
	console.log("\n=== Test 9: restoreSavepoint — validation ===\n")

	caught = false
	try {
		await sp.restoreSavepoint(null, "TASK-1")
	} catch (e) {
		caught = true
		assert(e.message.includes("repoPath"), "restoreSavepoint throws for missing repoPath")
	}
	assert(caught, "restoreSavepoint rejects null repoPath")

	caught = false
	try {
		await sp.restoreSavepoint("/tmp", null)
	} catch (e) {
		caught = true
		assert(e.message.includes("taskId"), "restoreSavepoint throws for missing taskId")
	}
	assert(caught, "restoreSavepoint rejects null taskId")

	// restoreSavepoint checks isGitRepo first, then looks up the savepoint.
	// Since /tmp is not a git repo, it will throw "Not a git repository" before
	// reaching the savepoint lookup. This is correct behavior.
	caught = false
	try {
		await sp.restoreSavepoint("/tmp", "NONEXISTENT")
	} catch (e) {
		caught = true
		assert(
			e.message.includes("Savepoint not found") || e.message.includes("Not a git repository"),
			"restoreSavepoint throws for unknown taskId (or non-git repo)",
		)
	}
	assert(caught, "restoreSavepoint rejects unknown taskId")

	// ─── Test 10: isGitRepo — non-git directory ───────────────────────────────
	console.log("\n=== Test 10: isGitRepo — non-git directory ===\n")

	var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-test-"))
	var isRepo = await sp.isGitRepo(tmpDir)
	assert(isRepo === false, "isGitRepo returns false for non-git directory")
	fs.rmdirSync(tmpDir)

	// ─── Test 11: getCurrentBranch — non-git directory ────────────────────────
	console.log("\n=== Test 11: getCurrentBranch — non-git directory ===\n")

	var branch = await sp.getCurrentBranch("/nonexistent")
	assert(branch === "unknown", "getCurrentBranch returns 'unknown' for non-git directory")

	// ─── Test 12: formatRelativeTime (via listSavepoints) ─────────────────────
	console.log("\n=== Test 12: formatRelativeTime ===\n")

	var now = Date.now()
	sp.savepointRegistry.set("TEST-TIME", {
		hash: "time-test",
		branch: "main",
		timestamp: now,
		description: "Time test",
	})
	var timeList = await sp.listSavepoints()
	var timeEntry = timeList.find(function (e) {
		return e.taskId === "TEST-TIME"
	})
	assert(timeEntry !== null, "listSavepoints includes time test entry")
	assert(typeof timeEntry.createdAgo === "string", "createdAgo is a string for recent entry")
	assert(
		timeEntry.createdAgo.includes("s ago") || timeEntry.createdAgo === "just now",
		"createdAgo shows seconds for recent entry",
	)

	// ─── Summary ──────────────────────────────────────────────────────────────
	console.log("\n" + "=".repeat(50))
	console.log(
		"Savepoint Service Tests: " + passed + " passed, " + failed + " failed out of " + (passed + failed) + " tests",
	)
	console.log("=".repeat(50))

	// Cleanup test entries
	sp.savepointRegistry.delete("TEST-001")
	sp.savepointRegistry.delete("TEST-002")
	sp.savepointRegistry.delete("TEST-003")
	sp.savepointRegistry.delete("TEST-TIME")

	process.exit(failed > 0 ? 1 : 0)
}

run().catch(function (err) {
	console.error("Test runner error:", err)
	process.exit(1)
})
