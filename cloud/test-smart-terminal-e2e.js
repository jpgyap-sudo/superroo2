/**
 * Smart Terminal behavior regression tests.
 *
 * These tests exercise exported runtime helpers instead of scraping source text,
 * so refactors only fail here when behavior changes.
 *
 * Run: node cloud/test-smart-terminal-e2e.js
 */

const assert = require("assert")
const bot = require("./api/telegramBot")

let passed = 0
let failed = 0

function test(name, fn) {
	try {
		fn()
		passed++
		console.log("  OK " + name)
	} catch (err) {
		failed++
		console.log("  FAIL " + name + ": " + err.message)
	}
}

console.log("\nSmart Terminal behavior regression")

test("detectCodingIntent routes direct commands", () => {
	assert.deepStrictEqual(bot.detectCodingIntent("run npm test"), { action: "execute", query: "npm test" })
	assert.deepStrictEqual(bot.detectCodingIntent("fix the build"), { action: "pipeline", query: "the build" })
})

test("smart context stores and renders state", () => {
	bot.updateSmartContext("chat-1", {
		lastCommand: "npm test",
		lastError: "build failed",
		lastProject: "superroo2",
		lastIntent: "coding:execute",
		lastFixApplied: "install deps",
	})
	const ctx = bot.getSmartContext("chat-1")
	assert.strictEqual(ctx.lastCommand, "npm test")
	assert.strictEqual(ctx.lastProject, "superroo2")
	const prompt = bot.buildSmartContextPrompt("chat-1")
	assert.ok(prompt.includes("npm test"))
	assert.ok(prompt.includes("build failed"))
})

test("command correction helpers return nearest command", () => {
	assert.strictEqual(bot.levenshteinDistance("/stats", "/status"), 1)
	assert.strictEqual(bot.findClosestCommand("/stats", ["/help", "/status"]), "/status")
	assert.ok(bot.suggestCommandCorrection("/stats").includes("/status"))
})

test("workflow intent identifies common workflows", () => {
	const deploy = bot.detectWorkflowIntent("deploy")
	assert.strictEqual(deploy.template, "deploy")
	const logs = bot.detectWorkflowIntent("logs")
	assert.strictEqual(logs.template, "logs")
})

console.log(`\nResults: ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
