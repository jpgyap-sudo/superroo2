/**
 * Shared test helpers for IDE Terminal unit tests.
 * Mirrors the pattern from cloud/api/__tests__/run-tests.js
 */

const assert = require("assert")

let passed = 0
let failed = 0
let failures = []

function test(name, fn) {
	try {
		fn()
		passed++
	} catch (e) {
		failed++
		failures.push({ name, error: e.message })
	}
}

function section(title) {
	console.log("\n" + "=".repeat(60))
	console.log("  " + title)
	console.log("=".repeat(60))
}

function printSummary() {
	console.log("\n" + "=".repeat(60))
	console.log("  TOTAL RESULTS: " + passed + " passed, " + failed + " failed")
	console.log("=".repeat(60))

	if (failures.length > 0) {
		console.log("\n  Failures:")
		for (const f of failures) {
			console.log("    ✗ " + f.name + ": " + f.error)
		}
		process.exit(1)
	} else {
		console.log("\n  All tests passed! ✓\n")
	}
}

function reset() {
	passed = 0
	failed = 0
	failures = []
}

module.exports = { test, section, printSummary, reset, assert }
