/**
 * E2E Test Script for Telegram Bot Upgrade
 * Run on VPS: node test-e2e-deploy.js
 */
const auth = require("./api/auth")
const telegramBot = require("./api/telegramBot")
const telegramLearner = require("./api/telegramLearner")
const fs = require("fs")

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

async function run() {
	console.log("=== E2E Test: Telegram Bot Upgrade ===\n")

	// Test 1: OTP bypass code exists in auth.js
	console.log("--- Test 1: OTP Bypass ---")
	var authSrc = fs.readFileSync("./api/auth.js", "utf8")
	assert(authSrc.includes("__email_otp_verified__"), "OTP bypass code present in auth.js")
	assert(authSrc.includes("isEmailOtpBypass"), "isEmailOtpBypass variable defined")
	assert(authSrc.includes('telegramInitData.startsWith("email-otp:")'), "email-otp: prefix check present")

	// Test 2: Telegram Learner loads and has expected API
	console.log("\n--- Test 2: Telegram Learner ---")
	assert(typeof telegramLearner.recordInteraction === "function", "recordInteraction is a function")
	assert(typeof telegramLearner.recordConversation === "function", "recordConversation is a function")
	assert(typeof telegramLearner.assessUserSatisfaction === "function", "assessUserSatisfaction is a function")
	assert(typeof telegramLearner.detectPatterns === "function", "detectPatterns is a function")
	assert(typeof telegramLearner.suggestIntent === "function", "suggestIntent is a function")
	assert(typeof telegramLearner.updateIntentAccuracy === "function", "updateIntentAccuracy is a function")
	assert(typeof telegramLearner.getStats === "function", "getStats is a function")
	assert(typeof telegramLearner.startPeriodicTraining === "function", "startPeriodicTraining is a function")

	var stats = telegramLearner.getStats()
	assert(stats && typeof stats === "object", "getStats returns an object")
	console.log("  Learner stats:", JSON.stringify(stats))

	// Test 3: Intent Detection
	console.log("\n--- Test 3: Intent Detection ---")
	assert(telegramBot.detectIntent("fix the login bug") === "debugger", "detectIntent: 'fix bug' -> debugger")
	assert(telegramBot.detectIntent("should I use PostgreSQL") === "consultant", "detectIntent: 'should I' -> consultant")
	assert(telegramBot.detectIntent("deploy to production") === "deployer", "detectIntent: 'deploy' -> deployer")
	assert(telegramBot.detectIntent("run tests") === "tester", "detectIntent: 'test' -> tester")
	assert(telegramBot.detectIntent("implement login feature") === "coder", "detectIntent: 'implement' -> coder")
	assert(telegramBot.detectIntent("what is the architecture") === "consultant", "detectIntent: 'what is' -> consultant")
	assert(telegramBot.detectIntent("how does the system work") === "consultant", "detectIntent: 'how does' -> consultant")
	assert(telegramBot.detectIntent("hello how are you") === "ask", "detectIntent: casual -> ask")

	// Test 4: Telegram Bot exports
	console.log("\n--- Test 4: Telegram Bot Exports ---")
	assert(typeof telegramBot.handleUpdate === "function", "handleUpdate exported")
	assert(typeof telegramBot.sendMessage === "function", "sendMessage exported")
	assert(typeof telegramBot.handleConsultant === "function", "handleConsultant exported")
	assert(typeof telegramBot.detectIntent === "function", "detectIntent exported")
	assert(typeof telegramBot.generateTOTPSecret === "function", "generateTOTPSecret exported")
	assert(typeof telegramBot.verifyTOTP === "function", "verifyTOTP exported")

	// Test 5: Verify askAI signature accepts chatId
	console.log("\n--- Test 5: askAI signature ---")
	var botSrc = fs.readFileSync("./api/telegramBot.js", "utf8")
	assert(botSrc.includes("async function askAI(message, providers, chatId"), "askAI accepts chatId parameter")
	assert(botSrc.includes("getConversationContext(chatId)"), "askAI uses conversation context")
	assert(botSrc.includes("addToConversationContext"), "askAI records to conversation context")
	assert(botSrc.includes("telegramLearner.recordInteraction"), "askAI records to telegram learner")
	assert(botSrc.includes("buildSystemPrompt()"), "askAI uses buildSystemPrompt")
	assert(botSrc.includes("max_tokens: 4096"), "askAI uses 4096 max_tokens")
	assert(botSrc.includes("AbortSignal.timeout(120_000)"), "askAI uses 120s timeout")

	// Test 6: handleNaturalLanguageInstruction handles "chat" intent directly
	console.log("\n--- Test 6: Natural Language Routing ---")
	assert(botSrc.includes('if (intentKind === "chat")'), "handleNaturalLanguageInstruction handles chat intent")
	assert(botSrc.includes("await askAI(chatPrompt, providers || [], chatId)"), "routes ask to enhanced askAI with chatId")

	// Test 7: Telegram Agent files exist
	console.log("\n--- Test 7: Telegram Agent Files ---")
	var agentDir = "./agents/telegram-agent"
	assert(fs.existsSync(agentDir + "/agent.json"), "agent.json exists")
	assert(fs.existsSync(agentDir + "/skills/conversation-flow.md"), "skills/conversation-flow.md exists")
	assert(fs.existsSync(agentDir + "/skills/intent-analysis.md"), "skills/intent-analysis.md exists")
	assert(fs.existsSync(agentDir + "/skills/code-context.md"), "skills/code-context.md exists")
	assert(fs.existsSync(agentDir + "/skills/telegram-response.md"), "skills/telegram-response.md exists")
	assert(fs.existsSync(agentDir + "/workflows/analyze-and-respond.md"), "workflows/analyze-and-respond.md exists")
	assert(fs.existsSync(agentDir + "/workflows/route-to-agent.md"), "workflows/route-to-agent.md exists")
	assert(fs.existsSync(agentDir + "/workflows/research-and-answer.md"), "workflows/research-and-answer.md exists")
	assert(fs.existsSync(agentDir + "/resources/superroo-architecture.md"), "resources/superroo-architecture.md exists")
	assert(fs.existsSync(agentDir + "/resources/project-context.md"), "resources/project-context.md exists")

	// Summary
	console.log("\n=== RESULTS ===")
	console.log("Passed: " + passed)
	console.log("Failed: " + failed)
	if (failed > 0) {
		console.log("❌ Some tests FAILED!")
		process.exit(1)
	} else {
		console.log("✅ All tests PASSED!")
		process.exit(0)
	}
}

run().catch(function(err) {
	console.error("Test error:", err)
	process.exit(1)
})
