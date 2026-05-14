/**
 * Tests for tgEndpoints.js
 *
 * Run with: node cloud/api/__tests__/run-tests.js
 */

const assert = require("assert")
const path = require("path")

function section(title) {
	console.log("\n" + "=".repeat(60))
	console.log("  " + title)
	console.log("=".repeat(60))
}

function test(name, fn) {
	try {
		fn()
		return { name, passed: true }
	} catch (e) {
		return { name, passed: false, error: e.message }
	}
}

async function runTests() {
	let passed = 0
	let failed = 0
	let failures = []

	section("tgEndpoints")

	const endpointsPath = path.join(__dirname, "..", "tgEndpoints.js")
	delete require.cache[require.resolve(endpointsPath)]
	const tg = require(endpointsPath)

	// ── debugPlan ────────────────────────────────────────────────────────────

	const t1 = test("debugPlan returns plan structure", async () => {
		const result = await tg.debugPlan("Fix login bug", "superroo2")
		assert.ok(result)
	})
	if (t1.passed) passed++
	else {
		failed++
		failures.push(t1)
	}

	const t2 = test("debugPlan handles empty text", async () => {
		const result = await tg.debugPlan("", "superroo2")
		assert.ok(result)
	})
	if (t2.passed) passed++
	else {
		failed++
		failures.push(t2)
	}

	// ── readLogs ─────────────────────────────────────────────────────────────

	const t3 = test("readLogs returns log entries", async () => {
		const result = await tg.readLogs("superroo-api", 10)
		assert.ok(result)
	})
	if (t3.passed) passed++
	else {
		failed++
		failures.push(t3)
	}

	const t4 = test("readLogs handles unknown target", async () => {
		const result = await tg.readLogs("unknown-service", 5)
		assert.ok(result)
	})
	if (t4.passed) passed++
	else {
		failed++
		failures.push(t4)
	}

	// ── runTests ─────────────────────────────────────────────────────────────

	const t5 = test("runTests returns test result", async () => {
		const result = await tg.runTests("superroo2")
		assert.ok(result)
	})
	if (t5.passed) passed++
	else {
		failed++
		failures.push(t5)
	}

	// ── createBranch ─────────────────────────────────────────────────────────

	const t6 = test("createBranch returns branch result", async () => {
		const result = await tg.createBranch("feature/test-branch", "main", "superroo2")
		assert.ok(result)
	})
	if (t6.passed) passed++
	else {
		failed++
		failures.push(t6)
	}

	const t7 = test("createBranch handles missing branch name", async () => {
		const result = await tg.createBranch("", "main", "superroo2")
		assert.ok(result)
	})
	if (t7.passed) passed++
	else {
		failed++
		failures.push(t7)
	}

	// ── createPr ─────────────────────────────────────────────────────────────

	const t8 = test("createPr returns PR result", async () => {
		const result = await tg.createPr("Test PR", "Test body", "superroo2", "feature/test", "main")
		assert.ok(result)
	})
	if (t8.passed) passed++
	else {
		failed++
		failures.push(t8)
	}

	// ── restartWorker ────────────────────────────────────────────────────────

	const t9 = test("restartWorker returns restart result", async () => {
		const result = await tg.restartWorker("superroo-api")
		assert.ok(result)
	})
	if (t9.passed) passed++
	else {
		failed++
		failures.push(t9)
	}

	const t10 = test("restartWorker handles unknown worker", async () => {
		const result = await tg.restartWorker("unknown-worker")
		assert.ok(result)
	})
	if (t10.passed) passed++
	else {
		failed++
		failures.push(t10)
	}

	// ── startAceTeam ─────────────────────────────────────────────────────────

	const t11 = test("startAceTeam returns team result", async () => {
		const result = await tg.startAceTeam(12345)
		assert.ok(result)
	})
	if (t11.passed) passed++
	else {
		failed++
		failures.push(t11)
	}

	// ── Brain functions ──────────────────────────────────────────────────────

	const t12 = test("brainPlan returns plan", async () => {
		const result = await tg.brainPlan("Plan a feature", 12345)
		assert.ok(result)
	})
	if (t12.passed) passed++
	else {
		failed++
		failures.push(t12)
	}

	const t13 = test("brainExecute returns execution result", async () => {
		const result = await tg.brainExecute("ls -la", 12345)
		assert.ok(result)
	})
	if (t13.passed) passed++
	else {
		failed++
		failures.push(t13)
	}

	const t14 = test("brainAnalyze returns analysis", async () => {
		const result = await tg.brainAnalyze("Error: connection refused", 12345)
		assert.ok(result)
	})
	if (t14.passed) passed++
	else {
		failed++
		failures.push(t14)
	}

	const t15 = test("brainFix returns fix suggestion", async () => {
		const result = await tg.brainFix("npm ERR! missing package", 12345)
		assert.ok(result)
	})
	if (t15.passed) passed++
	else {
		failed++
		failures.push(t15)
	}

	const t16 = test("brainMemory returns memory context", async () => {
		const result = await tg.brainMemory(12345)
		assert.ok(result)
	})
	if (t16.passed) passed++
	else {
		failed++
		failures.push(t16)
	}

	const t17 = test("brainContext returns context", async () => {
		const result = await tg.brainContext(12345)
		assert.ok(result)
	})
	if (t17.passed) passed++
	else {
		failed++
		failures.push(t17)
	}

	const t18 = test("brainPipeline returns pipeline result", async () => {
		const result = await tg.brainPipeline("Run tests and deploy", 12345)
		assert.ok(result)
	})
	if (t18.passed) passed++
	else {
		failed++
		failures.push(t18)
	}

	// ── Results ──────────────────────────────────────────────────────────────

	console.log("\n" + "=".repeat(60))
	console.log("  tgEndpoints: " + passed + " passed, " + failed + " failed")
	console.log("=".repeat(60))

	if (failures.length > 0) {
		for (const f of failures) {
			console.log("    ✗ " + f.name + ": " + f.error)
		}
	}

	return { passed, failed, failures }
}

module.exports = { runTests }
