/**
 * E2E Test Script for OpenClaw Integration
 * Run on VPS: node cloud/test-e2e-openclaw.js
 * Run locally: node cloud/test-e2e-openclaw.js
 *
 * Tests:
 *   1. All 4 new modules load correctly
 *   2. telegramClassifier exports and keywordFallback
 *   3. telegramPolicy exports and safety rules
 *   4. telegramEngineer exports and formatting
 *   5. tgEndpoints exports
 *   6. telegramBot exports new modules
 *   7. api.js has new /api/tg/* routes
 *   8. New slash commands registered in telegramBot.js
 */
const fs = require("fs")
const path = require("path")

// Resolve paths relative to this script's location
var scriptDir = __dirname

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

function section(title) {
	console.log("\n" + "=".repeat(60))
	console.log("  " + title)
	console.log("=".repeat(60))
}

async function run() {
	console.log("=== E2E Test: OpenClaw Integration ===\n")

	// ═══════════════════════════════════════════════════════════════════════════
	// Test 1: All 4 new modules load correctly
	// ═══════════════════════════════════════════════════════════════════════════
	section("Test 1: Module Loading")

	var classifier, policy, engineer, endpoints

	try {
		classifier = require(scriptDir + "/api/telegramClassifier.js")
		assert(typeof classifier === "object" && classifier !== null, "telegramClassifier loads")
	} catch (e) {
		assert(false, "telegramClassifier loads: " + e.message)
	}

	try {
		policy = require(scriptDir + "/api/telegramPolicy.js")
		assert(typeof policy === "object" && policy !== null, "telegramPolicy loads")
	} catch (e) {
		assert(false, "telegramPolicy loads: " + e.message)
	}

	try {
		engineer = require(scriptDir + "/api/telegramEngineer.js")
		assert(typeof engineer === "object" && engineer !== null, "telegramEngineer loads")
	} catch (e) {
		assert(false, "telegramEngineer loads: " + e.message)
	}

	try {
		endpoints = require(scriptDir + "/api/tgEndpoints.js")
		assert(typeof endpoints === "object" && endpoints !== null, "tgEndpoints loads")
	} catch (e) {
		assert(false, "tgEndpoints loads: " + e.message)
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// Test 2: telegramClassifier exports
	// ═══════════════════════════════════════════════════════════════════════════
	section("Test 2: telegramClassifier Exports")

	assert(typeof classifier.classifyIntent === "function", "classifyIntent is a function")
	assert(typeof classifier.keywordFallback === "function", "keywordFallback is a function")
	assert(typeof classifier.buildClassifierPrompt === "function", "buildClassifierPrompt is a function")

	// keywordFallback tests
	assert(
		classifier.keywordFallback("Debug this issue") === "debug_plan",
		"keywordFallback: 'Debug this issue' -> debug_plan",
	)
	assert(classifier.keywordFallback("Fix bug in login") === "debug_plan", "keywordFallback: 'Fix bug' -> debug_plan")
	assert(classifier.keywordFallback("Show me the logs") === "read_logs", "keywordFallback: 'Show logs' -> read_logs")
	assert(classifier.keywordFallback("Run the tests") === "run_tests", "keywordFallback: 'Run tests' -> run_tests")
	assert(
		classifier.keywordFallback("Create a new branch") === "create_branch",
		"keywordFallback: 'Create branch' -> create_branch",
	)
	assert(classifier.keywordFallback("Create a PR") === "create_pr", "keywordFallback: 'Create a PR' -> create_pr")
	assert(
		classifier.keywordFallback("Open a pull request") === "create_pr",
		"keywordFallback: 'Pull request' -> create_pr",
	)
	assert(
		classifier.keywordFallback("Restart the worker") === "restart_worker",
		"keywordFallback: 'Restart worker' -> restart_worker",
	)
	assert(classifier.keywordFallback("Deploy to production") === "deploy", "keywordFallback: 'Deploy' -> deploy")
	assert(
		classifier.keywordFallback("Delete the database") === "delete_data",
		"keywordFallback: 'Delete' -> delete_data",
	)
	assert(classifier.keywordFallback("Run a shell command") === "shell", "keywordFallback: 'Shell' -> shell")
	assert(classifier.keywordFallback("Hello how are you?") === "chat", "keywordFallback: casual -> chat")
	assert(classifier.keywordFallback("What is the architecture?") === "chat", "keywordFallback: 'What is' -> chat")

	// classifyIntent falls back to keyword when no providers
	try {
		var result = await classifier.classifyIntent("Fix this bug", [])
		assert(result.kind === "debug_plan", "classifyIntent fallback: 'Fix this bug' -> debug_plan")
		assert(result.message === "Fix this bug", "classifyIntent preserves message")
		assert(typeof result.confidence === "number", "classifyIntent returns confidence")
	} catch (e) {
		assert(false, "classifyIntent fallback: " + e.message)
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// Test 3: telegramPolicy exports
	// ═══════════════════════════════════════════════════════════════════════════
	section("Test 3: telegramPolicy Exports")

	assert(typeof policy.canRunWithoutApproval === "function", "canRunWithoutApproval is a function")
	assert(typeof policy.isBlocked === "function", "isBlocked is a function")
	assert(typeof policy.getBlockedReason === "function", "getBlockedReason is a function")
	assert(typeof policy.getActionLabel === "function", "getActionLabel is a function")

	// Safe actions
	assert(policy.canRunWithoutApproval("chat") === true, "chat allowed without approval")
	assert(policy.canRunWithoutApproval("debug_plan") === true, "debug_plan allowed without approval")
	assert(policy.canRunWithoutApproval("read_logs") === true, "read_logs allowed without approval")
	assert(policy.canRunWithoutApproval("run_tests") === true, "run_tests allowed without approval")
	assert(policy.canRunWithoutApproval("create_branch") === true, "create_branch allowed without approval")
	assert(policy.canRunWithoutApproval("create_pr") === true, "create_pr allowed without approval")
	assert(policy.canRunWithoutApproval("restart_worker") === true, "restart_worker allowed without approval")

	// Blocked actions
	assert(policy.canRunWithoutApproval("deploy") === false, "deploy blocked without approval")
	assert(policy.canRunWithoutApproval("delete_data") === false, "delete_data blocked without approval")
	assert(policy.canRunWithoutApproval("shell") === false, "shell blocked without approval")

	// isBlocked
	assert(policy.isBlocked("deploy") === true, "isBlocked: deploy -> true")
	assert(policy.isBlocked("chat") === false, "isBlocked: chat -> false")
	assert(policy.isBlocked("delete_data") === true, "isBlocked: delete_data -> true")

	// getBlockedReason
	var reason = policy.getBlockedReason("deploy")
	assert(typeof reason === "string" && reason.length > 0, "getBlockedReason returns non-empty string")
	assert(reason.includes("Blocked"), "getBlockedReason contains 'Blocked'")

	// getActionLabel
	assert(policy.getActionLabel("chat").includes("Chat"), "getActionLabel: chat has label")
	assert(policy.getActionLabel("deploy").includes("Deploy"), "getActionLabel: deploy has label")
	assert(policy.getActionLabel("foobar").includes("Unknown"), "getActionLabel: unknown -> Unknown")

	// REQUIRE_CODING_APPROVAL
	process.env.REQUIRE_CODING_APPROVAL = "true"
	delete require.cache[require.resolve(scriptDir + "/api/telegramPolicy.js")]
	var strictPolicy = require(scriptDir + "/api/telegramPolicy.js")
	assert(strictPolicy.canRunWithoutApproval("chat") === false, "chat blocked when REQUIRE_CODING_APPROVAL=true")
	assert(
		strictPolicy.canRunWithoutApproval("debug_plan") === false,
		"debug_plan blocked when REQUIRE_CODING_APPROVAL=true",
	)
	delete process.env.REQUIRE_CODING_APPROVAL

	// ═══════════════════════════════════════════════════════════════════════════
	// Test 4: telegramEngineer exports
	// ═══════════════════════════════════════════════════════════════════════════
	section("Test 4: telegramEngineer Exports")

	assert(typeof engineer.seniorEngineerReply === "function", "seniorEngineerReply is a function")
	assert(typeof engineer.formatFallback === "function", "formatFallback is a function")
	assert(typeof engineer.formatDebugPlan === "function", "formatDebugPlan is a function")
	assert(typeof engineer.formatLogsResult === "function", "formatLogsResult is a function")
	assert(typeof engineer.formatTestResult === "function", "formatTestResult is a function")
	assert(typeof engineer.formatBranchResult === "function", "formatBranchResult is a function")
	assert(typeof engineer.formatPrResult === "function", "formatPrResult is a function")
	assert(typeof engineer.formatRestartResult === "function", "formatRestartResult is a function")

	// formatFallback
	var fb = engineer.formatFallback('{"status":"ok","message":"done"}')
	assert(typeof fb === "string" && fb.length > 0, "formatFallback returns string for JSON")
	assert(fb.includes("status"), "formatFallback includes JSON keys")

	var longStr = "x".repeat(2000)
	var truncated = engineer.formatFallback(longStr)
	assert(truncated.length < 1500, "formatFallback truncates long strings")

	var shortStr = "hello world"
	assert(engineer.formatFallback(shortStr) === shortStr, "formatFallback returns short strings as-is")

	// formatDebugPlan — phases is array of strings, not objects
	var planResult = {
		incidentId: "DBG-123",
		phases: ["Investigate the error", "Apply fix", "Verify"],
	}
	var planMsg = engineer.formatDebugPlan(planResult)
	assert(typeof planMsg === "string", "formatDebugPlan returns string")
	assert(planMsg.includes("DBG-123"), "formatDebugPlan includes incident ID")
	assert(planMsg.includes("Investigate"), "formatDebugPlan includes phase descriptions")

	// formatLogsResult — uses result.logs (array), not result.lines
	var logsResult = { target: "superroo-api", logs: ["line1", "line2"] }
	var logsMsg = engineer.formatLogsResult(logsResult)
	assert(typeof logsMsg === "string", "formatLogsResult returns string")
	assert(logsMsg.includes("superroo-api"), "formatLogsResult includes target")
	assert(logsMsg.includes("line1"), "formatLogsResult includes log content")

	// formatTestResult — uses result.summary, not result.project
	var testResult = { passed: true, command: "npm test", summary: "All tests passed", output: "3 passed, 0 failed" }
	var testMsg = engineer.formatTestResult(testResult)
	assert(typeof testMsg === "string", "formatTestResult returns string")
	assert(testMsg.includes("Tests Passed"), "formatTestResult shows pass status")
	assert(testMsg.includes("npm test"), "formatTestResult includes command")

	// formatBranchResult — uses result.branch and result.baseBranch
	var branchResult = { branch: "feature/test", baseBranch: "main" }
	var branchMsg = engineer.formatBranchResult(branchResult)
	assert(typeof branchMsg === "string", "formatBranchResult returns string")
	assert(branchMsg.includes("feature/test"), "formatBranchResult includes branch name")
	assert(branchMsg.includes("main"), "formatBranchResult includes base branch")

	// formatPrResult — uses result.prUrl, result.prNumber, result.title
	var prResult = { prUrl: "https://github.com/test/pr/1", title: "My PR", prNumber: 1 }
	var prMsg = engineer.formatPrResult(prResult)
	assert(typeof prMsg === "string", "formatPrResult returns string")
	assert(prMsg.includes("github.com"), "formatPrResult includes URL")
	assert(prMsg.includes("My PR"), "formatPrResult includes title")

	// formatRestartResult — uses result.restarted, result.ok, result.message
	var restartResult = { ok: true, restarted: "superroo-api", message: "Worker restarted successfully" }
	var restartMsg = engineer.formatRestartResult(restartResult)
	assert(typeof restartMsg === "string", "formatRestartResult returns string")
	assert(restartMsg.includes("superroo-api"), "formatRestartResult includes worker name")
	assert(restartMsg.includes("Worker Restarted"), "formatRestartResult shows success status")

	// ═══════════════════════════════════════════════════════════════════════════
	// Test 5: tgEndpoints exports
	// ═══════════════════════════════════════════════════════════════════════════
	section("Test 5: tgEndpoints Exports")

	assert(typeof endpoints.debugPlan === "function", "debugPlan is a function")
	assert(typeof endpoints.readLogs === "function", "readLogs is a function")
	assert(typeof endpoints.runTests === "function", "runTests is a function")
	assert(typeof endpoints.createBranch === "function", "createBranch is a function")
	assert(typeof endpoints.createPr === "function", "createPr is a function")
	assert(typeof endpoints.restartWorker === "function", "restartWorker is a function")

	// ═══════════════════════════════════════════════════════════════════════════
	// Test 6: telegramBot source code checks
	// ═══════════════════════════════════════════════════════════════════════════
	section("Test 6: telegramBot Source Checks")

	var botSrc = fs.readFileSync(scriptDir + "/api/telegramBot.js", "utf8")

	// Check imports (no .js extension in require)
	assert(botSrc.includes('require("./telegramClassifier")'), "telegramBot imports telegramClassifier")
	assert(botSrc.includes('require("./telegramPolicy")'), "telegramBot imports telegramPolicy")
	assert(botSrc.includes('require("./telegramEngineer")'), "telegramBot imports telegramEngineer")
	assert(botSrc.includes('require("./tgEndpoints")'), "telegramBot imports tgEndpoints")

	// Check exports
	assert(botSrc.includes("telegramClassifier,"), "telegramBot exports telegramClassifier")
	assert(botSrc.includes("telegramPolicy,"), "telegramBot exports telegramPolicy")
	assert(botSrc.includes("telegramEngineer,"), "telegramBot exports telegramEngineer")
	assert(botSrc.includes("tgEndpoints,"), "telegramBot exports tgEndpoints")

	// Check new slash commands in PUBLIC_COMMANDS
	assert(botSrc.includes('"/debug"'), "PUBLIC_COMMANDS includes /debug")
	assert(botSrc.includes('"/logs"'), "PUBLIC_COMMANDS includes /logs")
	assert(botSrc.includes('"/tests"'), "PUBLIC_COMMANDS includes /tests")
	assert(botSrc.includes('"/restart"'), "PUBLIC_COMMANDS includes /restart")

	// Check new command handlers (uses if/else if pattern, not switch/case)
	assert(botSrc.includes('command === "/debug"'), "telegramBot handles /debug command")
	assert(botSrc.includes('command === "/logs"'), "telegramBot handles /logs command")
	assert(botSrc.includes('command === "/tests"'), "telegramBot handles /tests command")
	assert(botSrc.includes('command === "/restart"'), "telegramBot handles /restart command")

	// Check classifier integration in handleNaturalLanguageInstruction
	assert(botSrc.includes("telegramClassifier.classifyIntent"), "handleNaturalLanguageInstruction uses classifyIntent")
	assert(
		botSrc.includes("telegramPolicy.canRunWithoutApproval"),
		"handleNaturalLanguageInstruction uses canRunWithoutApproval",
	)
	assert(botSrc.includes("telegramPolicy.getBlockedReason"), "handleNaturalLanguageInstruction uses getBlockedReason")

	// Check engineer integration
	assert(botSrc.includes("telegramEngineer.formatDebugPlan"), "telegramBot uses formatDebugPlan")
	assert(botSrc.includes("telegramEngineer.formatLogsResult"), "telegramBot uses formatLogsResult")
	assert(botSrc.includes("telegramEngineer.formatTestResult"), "telegramBot uses formatTestResult")
	assert(botSrc.includes("telegramEngineer.formatRestartResult"), "telegramBot uses formatRestartResult")
	assert(botSrc.includes("telegramEngineer.seniorEngineerReply"), "telegramBot uses seniorEngineerReply")

	// Check tgEndpoints integration
	assert(botSrc.includes("tgEndpoints.debugPlan"), "telegramBot calls tgEndpoints.debugPlan")
	assert(botSrc.includes("tgEndpoints.readLogs"), "telegramBot calls tgEndpoints.readLogs")
	assert(botSrc.includes("tgEndpoints.runTests"), "telegramBot calls tgEndpoints.runTests")
	assert(botSrc.includes("tgEndpoints.restartWorker"), "telegramBot calls tgEndpoints.restartWorker")

	// Check help text includes OpenClaw
	assert(botSrc.includes("OpenClaw"), "Help text mentions OpenClaw")

	// ═══════════════════════════════════════════════════════════════════════════
	// Test 7: api.js has new /api/tg/* routes
	// ═══════════════════════════════════════════════════════════════════════════
	section("Test 7: api.js New Routes")

	var apiSrc = fs.readFileSync(scriptDir + "/api/api.js", "utf8")

	assert(apiSrc.includes("/api/tg/debug-plan"), "api.js has /api/tg/debug-plan route")
	assert(apiSrc.includes("/api/tg/read-logs"), "api.js has /api/tg/read-logs route")
	assert(apiSrc.includes("/api/tg/run-tests"), "api.js has /api/tg/run-tests route")
	assert(apiSrc.includes("/api/tg/create-branch"), "api.js has /api/tg/create-branch route")
	assert(apiSrc.includes("/api/tg/create-pr"), "api.js has /api/tg/create-pr route")
	assert(apiSrc.includes("/api/tg/restart-worker"), "api.js has /api/tg/restart-worker route")

	// Check auth function
	assert(apiSrc.includes("function tgAuth"), "api.js has tgAuth function")
	assert(apiSrc.includes("TELEGRAM_API_TOKEN"), "api.js uses TELEGRAM_API_TOKEN env var")

	// Check tgEndpoints calls in api.js
	assert(apiSrc.includes("tgEndpoints.debugPlan"), "api.js calls tgEndpoints.debugPlan")
	assert(apiSrc.includes("tgEndpoints.readLogs"), "api.js calls tgEndpoints.readLogs")
	assert(apiSrc.includes("tgEndpoints.runTests"), "api.js calls tgEndpoints.runTests")
	assert(apiSrc.includes("tgEndpoints.createBranch"), "api.js calls tgEndpoints.createBranch")
	assert(apiSrc.includes("tgEndpoints.createPr"), "api.js calls tgEndpoints.createPr")
	assert(apiSrc.includes("tgEndpoints.restartWorker"), "api.js calls tgEndpoints.restartWorker")

	// ═══════════════════════════════════════════════════════════════════════════
	// Test 8: Verify actual module exports from telegramBot
	// ═══════════════════════════════════════════════════════════════════════════
	section("Test 8: telegramBot Runtime Exports")

	var bot
	try {
		bot = require(scriptDir + "/api/telegramBot.js")
		assert(typeof bot === "object" && bot !== null, "telegramBot loads")
	} catch (e) {
		assert(false, "telegramBot loads: " + e.message)
	}

	if (bot) {
		assert(typeof bot.telegramClassifier === "object", "telegramBot.telegramClassifier is object")
		assert(typeof bot.telegramPolicy === "object", "telegramBot.telegramPolicy is object")
		assert(typeof bot.telegramEngineer === "object", "telegramBot.telegramEngineer is object")
		assert(typeof bot.tgEndpoints === "object", "telegramBot.tgEndpoints is object")

		assert(
			typeof bot.telegramClassifier.classifyIntent === "function",
			"bot.telegramClassifier.classifyIntent is function",
		)
		assert(
			typeof bot.telegramPolicy.canRunWithoutApproval === "function",
			"bot.telegramPolicy.canRunWithoutApproval is function",
		)
		assert(
			typeof bot.telegramEngineer.formatDebugPlan === "function",
			"bot.telegramEngineer.formatDebugPlan is function",
		)
		assert(typeof bot.tgEndpoints.debugPlan === "function", "bot.tgEndpoints.debugPlan is function")
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// Summary
	// ═══════════════════════════════════════════════════════════════════════════
	console.log("\n" + "=".repeat(60))
	console.log("  RESULTS: " + passed + " passed, " + failed + " failed")
	console.log("=".repeat(60))

	if (failed > 0) {
		process.exit(1)
	}
}

run().catch(function (err) {
	console.error("E2E test crashed:", err)
	process.exit(1)
})
