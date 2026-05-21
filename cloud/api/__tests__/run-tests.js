/**
 * Quick unit test runner for OpenClaw modules.
 * Run with: node cloud/api/__tests__/run-tests.js
 */
const assert = require("assert")
const path = require("path")

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

// ═══════════════════════════════════════════════════════════════════════════════
// telegramPolicy Tests
// ═══════════════════════════════════════════════════════════════════════════════

section("telegramPolicy")

delete process.env.REQUIRE_CODING_APPROVAL
delete require.cache[require.resolve("../telegramPolicy.js")]
const policy = require("../telegramPolicy.js")

test("allows chat without approval", () => assert.strictEqual(policy.canRunWithoutApproval("chat"), true))
test("allows debug_plan without approval", () => assert.strictEqual(policy.canRunWithoutApproval("debug_plan"), true))
test("allows read_logs without approval", () => assert.strictEqual(policy.canRunWithoutApproval("read_logs"), true))
test("allows run_tests without approval", () => assert.strictEqual(policy.canRunWithoutApproval("run_tests"), true))
test("allows create_branch without approval", () =>
	assert.strictEqual(policy.canRunWithoutApproval("create_branch"), true))
test("allows create_pr without approval", () => assert.strictEqual(policy.canRunWithoutApproval("create_pr"), true))
test("allows restart_worker without approval", () =>
	assert.strictEqual(policy.canRunWithoutApproval("restart_worker"), true))
test("blocks deploy without approval", () => assert.strictEqual(policy.canRunWithoutApproval("deploy"), false))
test("blocks delete_data without approval", () =>
	assert.strictEqual(policy.canRunWithoutApproval("delete_data"), false))
test("blocks shell without approval", () => assert.strictEqual(policy.canRunWithoutApproval("shell"), false))
test("blocks destructive shell commands", () => {
	assert.strictEqual(policy.canRunWithoutApproval("shell", "rm -rf /"), false)
	assert.strictEqual(policy.canRunWithoutApproval("shell", "sudo apt install nginx"), false)
	assert.strictEqual(policy.canRunWithoutApproval("shell", "docker run -it ubuntu"), false)
})
test("allows read-only shell commands", () => {
	assert.strictEqual(policy.canRunWithoutApproval("shell", "what version of ollama do i have"), true)
	assert.strictEqual(policy.canRunWithoutApproval("shell", "docker ps"), true)
	assert.strictEqual(policy.canRunWithoutApproval("shell", "systemctl status nginx"), true)
	assert.strictEqual(policy.canRunWithoutApproval("shell", "df -h"), true)
})
test("isBlocked returns true for deploy", () => assert.strictEqual(policy.isBlocked("deploy"), true))
test("isBlocked returns false for chat", () => assert.strictEqual(policy.isBlocked("chat"), false))
test("getBlockedReason contains safety message", () => assert.ok(policy.getBlockedReason("deploy").includes("Blocked")))
test("getActionLabel returns label for chat", () => assert.ok(policy.getActionLabel("chat").includes("Chat")))
test("getActionLabel returns Unknown for unknown", () => assert.ok(policy.getActionLabel("foobar").includes("Unknown")))

// Test REQUIRE_CODING_APPROVAL
process.env.REQUIRE_CODING_APPROVAL = "true"
delete require.cache[require.resolve("../telegramPolicy.js")]
const strictPolicy = require("../telegramPolicy.js")
test("blocks safe actions when REQUIRE_CODING_APPROVAL=true", () => {
	assert.strictEqual(strictPolicy.canRunWithoutApproval("chat"), false)
	assert.strictEqual(strictPolicy.canRunWithoutApproval("debug_plan"), false)
})
delete process.env.REQUIRE_CODING_APPROVAL

// ═══════════════════════════════════════════════════════════════════════════════
// telegramClassifier Tests
// ═══════════════════════════════════════════════════════════════════════════════

section("telegramClassifier")

delete require.cache[require.resolve("../telegramClassifier.js")]
const classifier = require("../telegramClassifier.js")

// keywordFallback tests
test("keywordFallback detects chat/research", () => {
	assert.strictEqual(classifier.keywordFallback("What is the best architecture?"), "feature_query")
	assert.strictEqual(classifier.keywordFallback("Explain how this works"), "chat")
	assert.strictEqual(classifier.keywordFallback("Tell me about the project"), "chat")
})

test("keywordFallback detects debug_plan", () => {
	assert.strictEqual(classifier.keywordFallback("Debug this issue"), "debug_plan")
	assert.strictEqual(classifier.keywordFallback("Fix bug in login"), "debug_plan")
	assert.strictEqual(classifier.keywordFallback("There's an error"), "debug_plan")
	assert.strictEqual(classifier.keywordFallback("The app is broken"), "debug_plan")
})

test("keywordFallback detects read_logs", () => {
	assert.strictEqual(classifier.keywordFallback("Show me the logs"), "read_logs")
	assert.strictEqual(classifier.keywordFallback("Check the logs"), "read_logs")
})

test("keywordFallback detects run_tests", () => {
	assert.strictEqual(classifier.keywordFallback("Run the tests"), "run_tests")
	assert.strictEqual(classifier.keywordFallback("Run unit tests"), "run_tests")
})

test("keywordFallback detects create_branch", () => {
	assert.strictEqual(classifier.keywordFallback("Create a new branch"), "create_branch")
})

test("keywordFallback detects create_pr", () => {
	assert.strictEqual(classifier.keywordFallback("Create a PR"), "create_pr")
	assert.strictEqual(classifier.keywordFallback("Open a pull request"), "create_pr")
})

test("keywordFallback detects restart_worker", () => {
	assert.strictEqual(classifier.keywordFallback("Restart the worker"), "restart_worker")
})

test("keywordFallback detects deploy", () => {
	assert.strictEqual(classifier.keywordFallback("Deploy to production"), "deploy")
})

test("keywordFallback detects delete_data", () => {
	assert.strictEqual(classifier.keywordFallback("Delete the database"), "delete_data")
})

test("keywordFallback detects shell", () => {
	assert.strictEqual(classifier.keywordFallback("Run a shell command"), "shell")
})

test("keywordFallback defaults to chat", () => {
	assert.strictEqual(classifier.keywordFallback("Hello how are you?"), "chat")
	assert.strictEqual(classifier.keywordFallback("Good morning"), "chat")
})

// classifyIntent tests
test("classifyIntent falls back to keyword when no providers", async () => {
	const result = await classifier.classifyIntent("Fix this bug", [])
	assert.strictEqual(result.kind, "debug_plan")
	assert.strictEqual(result.message, "Fix this bug")
})

test("classifyIntent falls back when providers is null", async () => {
	const result = await classifier.classifyIntent("Run the tests", null)
	assert.strictEqual(result.kind, "run_tests")
})

test("classifyIntent falls back when providers have no apiKey", async () => {
	const result = await classifier.classifyIntent("Deploy to production", [{ providerId: "test", apiKey: "" }])
	assert.strictEqual(result.kind, "deploy")
})

test("classifyIntent returns chat for casual conversation", async () => {
	const result = await classifier.classifyIntent("Hello, how are you?", [])
	assert.strictEqual(result.kind, "chat")
})

test("buildClassifierPrompt returns valid prompt", () => {
	const prompt = classifier.buildClassifierPrompt()
	assert.ok(typeof prompt === "string")
	assert.ok(prompt.length > 50)
	assert.ok(prompt.includes("JSON"))
	assert.ok(prompt.includes("kind"))
})

// ═══════════════════════════════════════════════════════════════════════════════
// telegramEngineer Tests
// ═══════════════════════════════════════════════════════════════════════════════

section("telegramEngineer")

delete require.cache[require.resolve("../telegramEngineer.js")]
const engineer = require("../telegramEngineer.js")

test("formatDebugPlan with incident ID and phases", () => {
	const result = { incidentId: "DBG-TEST", phases: ["Reproduce", "Check logs", "Fix"] }
	const f = engineer.formatDebugPlan(result)
	assert.ok(f.includes("Debug Plan"))
	assert.ok(f.includes("DBG-TEST"))
	assert.ok(f.includes("Reproduce"))
})

test("formatDebugPlan handles missing incidentId", () => {
	const f = engineer.formatDebugPlan({ phases: ["Phase 1"] })
	assert.ok(f.includes("Debug Plan"))
	assert.ok(f.includes("Phase 1"))
})

test("formatDebugPlan handles empty result", () => {
	const f = engineer.formatDebugPlan({})
	assert.ok(f.includes("Debug Plan"))
})

test("formatLogsResult formats log entries", () => {
	const result = { logs: ["line 1", "line 2"], target: "superroo-api" }
	const f = engineer.formatLogsResult(result)
	assert.ok(f.includes("Log Results"))
	assert.ok(f.includes("line 1"))
	assert.ok(f.includes("superroo-api"))
})

test("formatLogsResult limits to 10 lines", () => {
	const logs = Array.from({ length: 15 }, (_, i) => "line " + (i + 1))
	const f = engineer.formatLogsResult({ logs, target: "test" })
	const count = (f.match(/line \d+/g) || []).length
	assert.ok(count <= 12)
})

test("formatTestResult formats passed tests", () => {
	const result = { passed: true, command: "npx vitest run", summary: "Tests: 10 passed", output: "All good" }
	const f = engineer.formatTestResult(result)
	assert.ok(f.includes("Tests Passed"))
	assert.ok(f.includes("npx vitest run"))
})

test("formatTestResult formats failed tests", () => {
	const result = { passed: false, command: "npx vitest run", summary: "Tests: 2 failed" }
	const f = engineer.formatTestResult(result)
	assert.ok(f.includes("Tests Failed"))
})

test("formatBranchResult formats branch creation", () => {
	const result = { branch: "feature/test", baseBranch: "main" }
	const f = engineer.formatBranchResult(result)
	assert.ok(f.includes("Branch Created"))
	assert.ok(f.includes("feature/test"))
	assert.ok(f.includes("main"))
})

test("formatPrResult formats PR creation", () => {
	const result = { prUrl: "https://github.com/o/r/pull/42", prNumber: 42, title: "Fix bug" }
	const f = engineer.formatPrResult(result)
	assert.ok(f.includes("Pull Request Created"))
	assert.ok(f.includes("github.com"))
	assert.ok(f.includes("#42"))
})

test("formatRestartResult formats successful restart", () => {
	const result = { ok: true, restarted: "superroo-api", message: "Restarted successfully" }
	const f = engineer.formatRestartResult(result)
	assert.ok(f.includes("Worker Restarted"))
	assert.ok(f.includes("superroo-api"))
})

test("formatRestartResult formats failed restart", () => {
	const result = { ok: false, restarted: "superroo-api", message: "Failed" }
	const f = engineer.formatRestartResult(result)
	assert.ok(f.includes("Restart Failed"))
})

test("formatFallback formats JSON as bullet list", () => {
	const f = engineer.formatFallback(JSON.stringify({ status: "ok", count: 42 }))
	assert.ok(f.includes("status"))
	assert.ok(f.includes("count"))
})

test("formatFallback truncates long strings", () => {
	const long = "x".repeat(2000)
	const f = engineer.formatFallback(long)
	assert.ok(f.length <= 1000)
})

test("formatFallback returns short strings as-is", () => {
	assert.strictEqual(engineer.formatFallback("hello"), "hello")
})

test("seniorEngineerReply falls back when no providers", async () => {
	const result = await engineer.seniorEngineerReply("test input", [])
	assert.ok(typeof result === "string")
	assert.ok(result.length > 0)
})

test("seniorEngineerReply falls back when providers is null", async () => {
	const result = await engineer.seniorEngineerReply("test input", null)
	assert.ok(typeof result === "string")
})

// ═══════════════════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════════════════

console.log("\n" + "=".repeat(60))
console.log("  RESULTS: " + passed + " passed, " + failed + " failed")
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
