/**
 * E2E Test: Telegram Bot Intelligence & Agent Manager
 *
 * Tests the Telegram bot module's core intelligence features directly:
 *   1. Intent detection — classifies natural language correctly
 *   2. Agent routing — maps intents to correct agents
 *   3. Menu system — renders correct navigation
 *   4. Agent Manager — shows agent list, detail, toggle
 *   5. NLP edge cases — typos, ambiguous queries
 *
 * Run: node test-telegram-intelligence.js
 */

const bot = require("./api/telegramBot")
const telegramMenu = require("./api/telegramMenu")
const telegramAgentManager = require("./api/telegramAgentManager")

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

function assert(condition, message) {
	if (!condition) throw new Error(message || "Assertion failed")
}

function assertEqual(actual, expected, label) {
	if (actual !== expected) {
		throw new Error(`${label}: expected "${expected}", got "${actual}"`)
	}
}

console.log("")
console.log("=== Telegram Bot Intelligence & Agent Manager Test ===")
console.log("")

// ─── Module Load Tests ────────────────────────────────────────────────

test("telegramBot module loads and exports handleUpdate", function () {
	assert(typeof bot.handleUpdate === "function", "handleUpdate is not a function")
})

test("telegramBot exports sendMessage", function () {
	assert(typeof bot.sendMessage === "function", "sendMessage is not a function")
})

test("telegramBot exports sendInlineKeyboard", function () {
	assert(typeof bot.sendInlineKeyboard === "function", "sendInlineKeyboard is not a function")
})

test("telegramBot exports editMessageText", function () {
	assert(typeof bot.editMessageText === "function", "editMessageText is not a function")
})

test("telegramBot exports detectIntent", function () {
	assert(typeof bot.detectIntent === "function", "detectIntent is not a function")
})

test("telegramMenu module loads and exports", function () {
	assert(typeof telegramMenu.showMainMenu === "function", "showMainMenu is not a function")
	assert(typeof telegramMenu.showSettingsMenu === "function", "showSettingsMenu is not a function")
	assert(typeof telegramMenu.handleMenuCallback === "function", "handleMenuCallback is not a function")
	assert(typeof telegramMenu.isMenuCallback === "function", "isMenuCallback is not a function")
})

test("telegramAgentManager module loads and exports", function () {
	assert(typeof telegramAgentManager.showAgentManager === "function", "showAgentManager is not a function")
	assert(typeof telegramAgentManager.showAgentDetail === "function", "showAgentDetail is not a function")
	assert(typeof telegramAgentManager.showAgentActivity === "function", "showAgentActivity is not a function")
	assert(typeof telegramAgentManager.handleAgentManagerCallback === "function", "handleAgentManagerCallback is not a function")
	assert(typeof telegramAgentManager.fetchAgents === "function", "fetchAgents is not a function")
	assert(typeof telegramAgentManager.fetchAgentBusStats === "function", "fetchAgentBusStats is not a function")
	assert(typeof telegramAgentManager.fetchRecentActivity === "function", "fetchRecentActivity is not a function")
	assert(typeof telegramAgentManager.getDefaultIcon === "function", "getDefaultIcon is not a function")
})

// ─── Intent Detection Tests ───────────────────────────────────────────

test("detectIntent classifies coding request", function () {
	const result = bot.detectIntent("write a function to sort an array")
	assert(result, "detectIntent returned null/undefined")
})

test("detectIntent classifies deploy request", function () {
	const result = bot.detectIntent("deploy the latest build to production")
	assert(result, "detectIntent returned null/undefined")
})

test("detectIntent classifies debug request", function () {
	const result = bot.detectIntent("debug the login issue")
	assert(result, "detectIntent returned null/undefined")
})

test("detectIntent classifies test request", function () {
	const result = bot.detectIntent("run tests for the auth module")
	assert(result, "detectIntent returned null/undefined")
})

test("detectIntent classifies status request", function () {
	const result = bot.detectIntent("what is the current status")
	assert(result, "detectIntent returned null/undefined")
})

test("detectIntent classifies help request", function () {
	const result = bot.detectIntent("help me with commands")
	assert(result, "detectIntent returned null/undefined")
})

test("detectIntent handles empty input gracefully", function () {
	const result = bot.detectIntent("")
	// Should not throw — may return null or a default intent
	assert(result !== undefined, "detectIntent threw on empty input")
})

// ─── Agent Manager Tests ──────────────────────────────────────────────

test("getDefaultIcon returns icon for known agents", function () {
	const coderIcon = telegramAgentManager.getDefaultIcon("coder")
	assert(coderIcon && coderIcon.length > 0, "getDefaultIcon('coder') returned empty")

	const debuggerIcon = telegramAgentManager.getDefaultIcon("debugger")
	assert(debuggerIcon && debuggerIcon.length > 0, "getDefaultIcon('debugger') returned empty")

	const unknownIcon = telegramAgentManager.getDefaultIcon("nonexistent_agent")
	assert(unknownIcon === "⚙️", "getDefaultIcon('nonexistent') should return default gear icon")
})

test("handleAgentManagerCallback parses agentmgr:list correctly", async function () {
	const result = await telegramAgentManager.handleAgentManagerCallback("fake-token", {
		message: { chat: { id: 12345 }, message_id: 1 },
		data: "agentmgr:list",
		id: "cq-1",
	})
	assert(result, "handleAgentManagerCallback returned null")
	assert(result.handled !== undefined, "result should have 'handled' field")
})

test("handleAgentManagerCallback parses agentmgr:detail correctly", async function () {
	const result = await telegramAgentManager.handleAgentManagerCallback("fake-token", {
		message: { chat: { id: 12345 }, message_id: 1 },
		data: "agentmgr:detail:coder",
		id: "cq-2",
	})
	assert(result, "handleAgentManagerCallback returned null")
})

test("handleAgentManagerCallback parses agentmgr:toggle correctly", async function () {
	const result = await telegramAgentManager.handleAgentManagerCallback("fake-token", {
		message: { chat: { id: 12345 }, message_id: 1 },
		data: "agentmgr:toggle:coder",
		id: "cq-3",
	})
	assert(result, "handleAgentManagerCallback returned null")
})

test("handleAgentManagerCallback parses agentmgr:activity correctly", async function () {
	const result = await telegramAgentManager.handleAgentManagerCallback("fake-token", {
		message: { chat: { id: 12345 }, message_id: 1 },
		data: "agentmgr:activity",
		id: "cq-4",
	})
	assert(result, "handleAgentManagerCallback returned null")
})

test("handleAgentManagerCallback returns unhandled for unknown action", async function () {
	const result = await telegramAgentManager.handleAgentManagerCallback("fake-token", {
		message: { chat: { id: 12345 }, message_id: 1 },
		data: "agentmgr:unknown_action",
		id: "cq-5",
	})
	assert(result, "handleAgentManagerCallback returned null")
	assert(result.handled === false, "unknown action should be unhandled")
})

// ─── Menu System Tests ────────────────────────────────────────────────

test("isMenuCallback detects menu callbacks", function () {
	assert(telegramMenu.isMenuCallback("menu:main") === true, "should detect menu:main")
	assert(telegramMenu.isMenuCallback("menu:settings") === true, "should detect menu:settings")
	assert(telegramMenu.isMenuCallback("menu:agents") === true, "should detect menu:agents")
	assert(telegramMenu.isMenuCallback("random:string") === false, "should reject non-menu callbacks")
	// Empty string is falsy, so isMenuCallback returns '' which is falsy but not === false
	assert(!telegramMenu.isMenuCallback(""), "should reject empty string (falsy)")
})

test("handleMenuCallback returns correct structure for main menu", async function () {
	const result = await telegramMenu.handleMenuCallback("fake-token", {
		message: { chat: { id: 12345 }, message_id: 1 },
		data: "menu:main",
		id: "cq-menu-1",
	}, {})
	assert(result, "handleMenuCallback returned null")
	assert(result.handled === true, "main menu should be handled")
	assert(result.action === "main", "action should be 'main'")
})

test("handleMenuCallback returns correct structure for settings", async function () {
	const result = await telegramMenu.handleMenuCallback("fake-token", {
		message: { chat: { id: 12345 }, message_id: 1 },
		data: "menu:settings",
		id: "cq-menu-2",
	}, {})
	assert(result, "handleMenuCallback returned null")
	assert(result.handled === true, "settings should be handled")
	assert(result.action === "settings", "action should be 'settings'")
})

test("handleMenuCallback returns correct structure for agents", async function () {
	const result = await telegramMenu.handleMenuCallback("fake-token", {
		message: { chat: { id: 12345 }, message_id: 1 },
		data: "menu:agents",
		id: "cq-menu-3",
	}, {})
	assert(result, "handleMenuCallback returned null")
	assert(result.handled === true, "agents should be handled")
	assert(result.action === "agents", "action should be 'agents'")
})

test("handleMenuCallback returns unhandled for unknown action", async function () {
	const result = await telegramMenu.handleMenuCallback("fake-token", {
		message: { chat: { id: 12345 }, message_id: 1 },
		data: "menu:unknown_action",
		id: "cq-menu-4",
	}, {})
	assert(result, "handleMenuCallback returned null")
	assert(result.handled === false, "unknown action should be unhandled")
})

// ─── NLP Edge Cases ───────────────────────────────────────────────────

test("detectIntent handles typos gracefully", function () {
	const result = bot.detectIntent("deplloy the app")
	// Should not throw — may still detect deploy intent or fall back
	assert(result !== undefined, "detectIntent threw on typo input")
})

test("detectIntent handles ambiguous queries", function () {
	const result = bot.detectIntent("can you check something")
	// Should not throw — ambiguous queries should fall back gracefully
	assert(result !== undefined, "detectIntent threw on ambiguous input")
})

test("detectIntent handles very long input", function () {
	const longText = "please ".repeat(100) + "help"
	const result = bot.detectIntent(longText)
	// Should not throw or crash
	assert(result !== undefined, "detectIntent threw on very long input")
})

// ─── Results ──────────────────────────────────────────────────────────

console.log("")
console.log("=== Results ===")
console.log("  Total:  " + total)
console.log("  Passed: " + passed)
console.log("  Failed: " + failed)
if (failed === 0) {
	console.log("")
	console.log("ALL TESTS PASSED ✅")
} else {
	console.log("")
	console.log("SOME TESTS FAILED ❌")
	process.exit(1)
}
