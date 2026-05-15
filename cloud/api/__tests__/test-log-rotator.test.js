/**
 * Log Rotator Tests
 *
 * Tests for the log rotation module.
 * Run with: node cloud/api/__tests__/test-log-rotator.test.js
 */

const assert = require("assert")
const fs = require("fs")
const path = require("path")
const os = require("os")

/** @type {number} */
let passed = 0
/** @type {number} */
let failed = 0
/** @type {{ name: string, error: string }[]} */
let failures = []

/**
 * @param {string} name
 * @param {() => void} fn
 */
function test(name, fn) {
	try {
		fn()
		passed++
	} catch (/** @type {any} */ e) {
		failed++
		failures.push({ name, error: e.message })
	}
}

/**
 * @param {string} title
 */
function section(title) {
	console.log("\n" + "=".repeat(60))
	console.log("  " + title)
	console.log("=".repeat(60))
}

// ═══════════════════════════════════════════════════════════════════════════════
// Log Rotator Tests
// ═══════════════════════════════════════════════════════════════════════════════

section("logRotator")

// Create a temp directory for test logs
const testLogDir = fs.mkdtempSync(path.join(os.tmpdir(), "log-rotator-test-"))
process.env.LOGS_DIR = testLogDir

// Fresh require
delete require.cache[require.resolve("../logRotator.js")]
const logRotator = require("../logRotator.js")

// --- getLogFiles ---

test("getLogFiles returns empty for new directory", () => {
	const files = logRotator.getLogFiles()
	assert.strictEqual(files.length, 0)
})

test("getLogFiles finds log files", () => {
	// Create a test log file
	fs.writeFileSync(path.join(testLogDir, "superroo-2026-01-01.jsonl"), "test content")
	const files = logRotator.getLogFiles()
	assert.strictEqual(files.length, 1)
	assert.ok(files[0].endsWith(".jsonl"))
})

test("getLogFiles finds compressed files too", () => {
	fs.writeFileSync(path.join(testLogDir, "superroo-2026-01-02.jsonl.gz"), "compressed content")
	const files = logRotator.getLogFiles()
	assert.strictEqual(files.length, 2)
})

test("getLogFiles ignores non-superroo files", () => {
	fs.writeFileSync(path.join(testLogDir, "other-file.txt"), "should be ignored")
	const files = logRotator.getLogFiles()
	assert.strictEqual(files.length, 2)
})

// --- getStats ---

test("getStats returns correct file count", () => {
	const stats = logRotator.getStats()
	assert.strictEqual(stats.fileCount, 2)
	assert.ok(stats.totalSize.includes("B"))
	assert.ok(stats.maxFileSize.includes("MB"))
	assert.strictEqual(stats.maxAgeDays, 30)
	assert.strictEqual(stats.maxFiles, 100)
})

// --- rotateNow ---

test("rotateNow runs without error", async () => {
	const result = await logRotator.rotateNow()
	assert.ok(typeof result.fileCount === "number")
	assert.ok(typeof result.totalSize === "string")
})

// --- start / stop ---

test("start and stop do not throw", () => {
	logRotator.start()
	logRotator.stop()
})

// ═══════════════════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════════════════

console.log("\n" + "=".repeat(60))
console.log("  TOTAL RESULTS: " + passed + " passed, " + failed + " failed")
console.log("=".repeat(60))

// Cleanup temp directory
try {
	fs.rmSync(testLogDir, { recursive: true, force: true })
} catch {
	// ignore
}

if (failures.length > 0) {
	console.log("\n  Failures:")
	for (const f of failures) {
		console.log("    ✗ " + f.name + ": " + f.error)
	}
	process.exit(1)
} else {
	console.log("\n  All tests passed! ✓\n")
}
