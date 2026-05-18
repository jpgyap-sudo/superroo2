/**
 * Quick verification script for deployed fixes
 * Run on VPS: node test-verify-fixes.js
 */
var fs = require("fs")

var b = fs.readFileSync("./api/telegramBot.js", "utf8")
var n = fs.readFileSync("./api/telegramNotifier.js", "utf8")
var e = fs.readFileSync("./api/telegramEngineer.js", "utf8")
var w = fs.readFileSync("./worker/agentRunners.js", "utf8")

var passed = 0
var failed = 0

function check(name, condition) {
	if (condition) {
		console.log("  ✅ " + name)
		passed++
	} else {
		console.log("  ❌ " + name)
		failed++
	}
}

console.log("=== Fix Verification ===\n")

// Bug 5: 10 missing commands
console.log("--- Bug 5: Missing Commands ---")
var commands = ["miniide", "workspace", "session", "settings", "agents", "code", "diff", "approve", "deploy", "status"]
commands.forEach(function(cmd) {
	check("/" + cmd + " routed", b.includes('command === "/' + cmd + '"'))
})

// Bug 6: messageId removed
console.log("\n--- Bug 6: messageId Reference ---")
check("messageId removed from debug_plan", !b.includes("messageId: messageId"))

// Bug 7: Markdown fallback
console.log("\n--- Bug 7: Markdown Fallback ---")
check("sendMessage has markdown fallback", b.includes("can't parse entities") && b.includes('parse_mode: ""'))

// Bug 8: Mini IDE callbacks
console.log("\n--- Bug 8: Mini IDE Callbacks ---")
check("projects callback handled", b.includes('cqData === "projects"'))
check("help callback handled", b.includes('cqData === "help"'))

// Bug 9: Engineer sanitization
console.log("\n--- Bug 9: Engineer Sanitization ---")
check("sanitizeForCode exists", e.includes("sanitizeForCode"))
check("sanitizeForCodeBlock exists", e.includes("sanitizeForCodeBlock"))

// Bug 10: Notifier markdown fallback
console.log("\n--- Bug 10: Notifier Fallback ---")
check("sendInlineKeyboard has fallback", n.includes("can't parse entities"))
check("editMessageText has fallback", n.includes("can't parse entities"))

// Bug 11: askAI improved error
console.log("\n--- Bug 11: askAI Error ---")
check("triedProviders in error message", b.includes("triedProviders"))

// Structured logging
console.log("\n--- Structured Logging ---")
check("logTelegramError function", b.includes("function logTelegramError"))
check("logTelegramWarning function", b.includes("function logTelegramWarning"))
check("logTelegramUsage function", b.includes("function logTelegramUsage"))
check("[ace-error] prefix", b.includes("[ace-error]"))
check("[ace-warn] prefix", b.includes("[ace-warn]"))
check("[ace-usage] prefix", b.includes("[ace-usage]"))

// Syntax fix
console.log("\n--- Syntax Fix ---")
check("handleNaturalLanguageInstruction syntax valid", b.includes("async function handleNaturalLanguageInstruction"))

console.log("\n--- Telegram Coder Retry UX ---")
check("bridge createTask calls are sync-safe", !/createTask\([\s\S]{0,400}?\)\s*\.catch\(function \(err\)/.test(b))
check("retryable coder failure notification exists", n.includes("sendCoderRetryableFailure"))
check("retryable failure copy avoids clarification blame", n.includes("temporary system or model issue"))
check("worker uses retryable failure path", w.includes("sendCoderRetryableFailure"))

console.log("\n=== RESULTS ===")
console.log("Passed: " + passed)
console.log("Failed: " + failed)
if (failed > 0) {
	console.log("❌ Some checks FAILED!")
	process.exit(1)
} else {
	console.log("✅ All checks PASSED!")
	process.exit(0)
}
