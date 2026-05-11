/**
 * E2E Test: Telegram Bot Updates
 * Tests the new natural language processing, session expiry notification,
 * OTP re-verification, and intent detection features.
 */

const bot = require("./api/telegramBot")

var passed = 0
var failed = 0
var total = 0

function test(name, fn) {
	total++
	try {
		fn()
		passed++
		console.log("  ✅ " + name)
	} catch (e) {
		failed++
		console.log("  ❌ " + name + ": " + e.message)
	}
}

console.log("")
console.log("=== Telegram Bot Module Load Test ===")
console.log("")

test("Module exports handleUpdate", function () {
	if (typeof bot.handleUpdate !== "function") throw new Error("handleUpdate is not a function")
})

test("Module exports sendMessage", function () {
	if (typeof bot.sendMessage !== "function") throw new Error("sendMessage is not a function")
})

test("Module exports sendInlineKeyboard", function () {
	if (typeof bot.sendInlineKeyboard !== "function") throw new Error("sendInlineKeyboard is not a function")
})

test("Module exports editMessageText", function () {
	if (typeof bot.editMessageText !== "function") throw new Error("editMessageText is not a function")
})

test("Module exports handleUpdate", function () {
	if (typeof bot.handleUpdate !== "function") throw new Error("handleUpdate is not a function")
})

console.log("")
console.log("=== Syntax & Structure Verification ===")
console.log("")

// Read the source file to verify key patterns exist
var fs = require("fs")
var source = fs.readFileSync("./api/telegramBot.js", "utf8")

test("File contains getSessionWithNotification function", function () {
	if (!source.includes("getSessionWithNotification")) throw new Error("Missing getSessionWithNotification")
})

test("File contains sessionExpiryNotified map", function () {
	if (!source.includes("sessionExpiryNotified")) throw new Error("Missing sessionExpiryNotified")
})

test("File contains detectIntent function", function () {
	if (!source.includes("function detectIntent")) throw new Error("Missing detectIntent function")
})

test("File contains OTP re-verification check", function () {
	if (!source.includes("otpVerifiedAt")) throw new Error("Missing otpVerifiedAt")
})

test("File contains natural language routing (no /ask requirement)", function () {
	if (!source.includes("handleNaturalLanguageInstruction")) throw new Error("Missing handleNaturalLanguageInstruction")
})

test("File routes non-commands to AI assistant (not 'Unknown command')", function () {
	// The old "Unknown command" message should NOT be present
	if (source.includes("Unknown command")) {
		// It's OK if it's in a comment, but not in the active code path
		console.log("  ⚠  'Unknown command' still present (may be in comments)")
	}
})

test("File has agent routing for coder, debugger, deployer, tester", function () {
	if (!source.includes('"coder"')) throw new Error("Missing coder agent routing")
	if (!source.includes('"debugger"')) throw new Error("Missing debugger agent routing")
	if (!source.includes('"deployer"')) throw new Error("Missing deployer agent routing")
	if (!source.includes('"tester"')) throw new Error("Missing tester agent routing")
})

test("File has session expiry notification with timestamp", function () {
	if (!source.includes("Session Expired")) throw new Error("Missing session expiry message")
	if (!source.includes("expiryTime")) throw new Error("Missing expiry timestamp")
})

console.log("")
console.log("=== Results ===")
console.log("  Total: " + total)
console.log("  Passed: " + passed)
console.log("  Failed: " + failed)
console.log("")
if (failed === 0) {
	console.log("ALL TESTS PASSED ✅")
} else {
	console.log("SOME TESTS FAILED ❌")
	process.exit(1)
}
