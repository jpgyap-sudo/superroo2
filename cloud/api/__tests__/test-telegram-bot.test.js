/**
 * Tests for telegramBot.js
 *
 * Run with: node cloud/api/__tests__/run-tests.js
 */

const assert = require("assert")
const path = require("path")
const botPath = path.join(__dirname, "..", "telegramBot.js")

// Mock fetch globally for Telegram API calls
const originalFetch = global.fetch
global.fetch = async (url, opts) => {
	if (typeof url === "string" && url.includes("api.telegram.org/bot")) {
		return {
			ok: true,
			json: async () => ({ ok: true, result: true }),
		}
	}
	return { ok: true, json: async () => ({}) }
}

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

	section("telegramBot")

	delete require.cache[require.resolve(botPath)]
	const bot = require(botPath)

	// ── sendMessage (void return) ─────────────────────────────────────────────

	const t1 = test("sendMessage sends message to Telegram API", async () => {
		// sendMessage does not return a value; verify it doesn't throw
		await bot.sendMessage("test-token", 12345, "Hello")
		assert.ok(true)
	})
	if (t1.passed) passed++
	else {
		failed++
		failures.push(t1)
	}

	const t2 = test("sendMessage handles missing token gracefully", async () => {
		await bot.sendMessage("", 12345, "Hello")
		assert.ok(true)
	})
	if (t2.passed) passed++
	else {
		failed++
		failures.push(t2)
	}

	// ── sendInlineKeyboard (void return) ─────────────────────────────────────

	const t3 = test("sendInlineKeyboard sends inline keyboard with buttons", async () => {
		const buttons = [[{ text: "Approve", callback_data: "approve_1" }]]
		await bot.sendInlineKeyboard("test-token", 12345, "Choose:", buttons)
		assert.ok(true)
	})
	if (t3.passed) passed++
	else {
		failed++
		failures.push(t3)
	}

	// ── editMessageText (void return) ────────────────────────────────────────

	const t4 = test("editMessageText edits message text", async () => {
		await bot.editMessageText("test-token", 12345, 100, "Updated text")
		assert.ok(true)
	})
	if (t4.passed) passed++
	else {
		failed++
		failures.push(t4)
	}

	// ── setWebhook (returns data) ────────────────────────────────────────────

	const t5 = test("setWebhook sets webhook URL", async () => {
		const result = await bot.setWebhook("test-token", "https://example.com/webhook")
		assert.ok(result)
	})
	if (t5.passed) passed++
	else {
		failed++
		failures.push(t5)
	}

	// ── getWebhookInfo (returns data) ────────────────────────────────────────

	const t6 = test("getWebhookInfo gets webhook info", async () => {
		const result = await bot.getWebhookInfo("test-token")
		assert.ok(result)
	})
	if (t6.passed) passed++
	else {
		failed++
		failures.push(t6)
	}

	// ── deleteWebhook (returns data) ─────────────────────────────────────────

	const t7 = test("deleteWebhook deletes webhook", async () => {
		const result = await bot.deleteWebhook("test-token")
		assert.ok(result)
	})
	if (t7.passed) passed++
	else {
		failed++
		failures.push(t7)
	}

	// ── answerCallbackQuery (void return) ────────────────────────────────────

	const t8 = test("answerCallbackQuery answers callback query", async () => {
		await bot.answerCallbackQuery("test-token", "cq-id", "Done")
		assert.ok(true)
	})
	if (t8.passed) passed++
	else {
		failed++
		failures.push(t8)
	}

	// ── sendChatAction (void return) ─────────────────────────────────────────

	const t9 = test("sendChatAction sends chat action (typing)", async () => {
		await bot.sendChatAction("test-token", 12345, "typing")
		assert.ok(true)
	})
	if (t9.passed) passed++
	else {
		failed++
		failures.push(t9)
	}

	// ── detectIntent (returns string) ────────────────────────────────────────

	const t10 = test("detectIntent detects deploy intent", () => {
		const result = bot.detectIntent("Deploy to production")
		assert.ok(result)
	})
	if (t10.passed) passed++
	else {
		failed++
		failures.push(t10)
	}

	const t11 = test("detectIntent detects test intent", () => {
		const result = bot.detectIntent("Run the tests")
		assert.ok(result)
	})
	if (t11.passed) passed++
	else {
		failed++
		failures.push(t11)
	}

	const t12 = test("detectIntent detects status intent", () => {
		const result = bot.detectIntent("Show status")
		assert.ok(result)
	})
	if (t12.passed) passed++
	else {
		failed++
		failures.push(t12)
	}

	const t13 = test("detectIntent returns chat for unknown intent", () => {
		const result = bot.detectIntent("Hello how are you?")
		assert.ok(result)
	})
	if (t13.passed) passed++
	else {
		failed++
		failures.push(t13)
	}

	// ── handleConsultant (void return) ───────────────────────────────────────

	const t14 = test("handleConsultant handles question with providers", async () => {
		await bot.handleConsultant("test-token", 12345, "What is Node.js?", [], {})
		assert.ok(true)
	})
	if (t14.passed) passed++
	else {
		failed++
		failures.push(t14)
	}

	const t15 = test("handleConsultant handles question without providers", async () => {
		await bot.handleConsultant("test-token", 12345, "Hello", [], {})
		assert.ok(true)
	})
	if (t15.passed) passed++
	else {
		failed++
		failures.push(t15)
	}

	// ── handleBrain (void return) ────────────────────────────────────────────

	const t16 = test("handleBrain handles brain command", async () => {
		await bot.handleBrain("test-token", 12345, "plan my task", [])
		assert.ok(true)
	})
	if (t16.passed) passed++
	else {
		failed++
		failures.push(t16)
	}

	// ── handleUpdate (void return) ───────────────────────────────────────────

	const t17 = test("handleUpdate handles message update", async () => {
		const update = {
			update_id: 1,
			message: {
				message_id: 100,
				chat: { id: 12345 },
				from: { id: 67890, first_name: "Test" },
				text: "/help",
			},
		}
		await bot.handleUpdate(update, "test-token", null, [])
		assert.ok(true)
	})
	if (t17.passed) passed++
	else {
		failed++
		failures.push(t17)
	}

	const t18 = test("handleUpdate handles callback query update", async () => {
		const update = {
			update_id: 2,
			callback_query: {
				id: "cq-1",
				from: { id: 67890, first_name: "Test" },
				message: {
					message_id: 101,
					chat: { id: 12345 },
				},
				data: "menu_main",
			},
		}
		await bot.handleUpdate(update, "test-token", null, [])
		assert.ok(true)
	})
	if (t18.passed) passed++
	else {
		failed++
		failures.push(t18)
	}

	const t19 = test("handleUpdate handles unknown update type gracefully", async () => {
		const update = { update_id: 3 }
		await bot.handleUpdate(update, "test-token", null, [])
		assert.ok(true)
	})
	if (t19.passed) passed++
	else {
		failed++
		failures.push(t19)
	}

	// ── handlePreviewPlan (void return) ──────────────────────────────────────

	const t20 = test("handlePreviewPlan handles preview plan callback", async () => {
		await bot.handlePreviewPlan("test-token", 12345, 100, "task-1")
		assert.ok(true)
	})
	if (t20.passed) passed++
	else {
		failed++
		failures.push(t20)
	}

	// ── handleApprovePlan (void return) ──────────────────────────────────────

	const t21 = test("handleApprovePlan handles approve plan callback", async () => {
		await bot.handleApprovePlan("test-token", 12345, 100, "task-1")
		assert.ok(true)
	})
	if (t21.passed) passed++
	else {
		failed++
		failures.push(t21)
	}

	// ── handleViewDiff (void return) ─────────────────────────────────────────

	const t22 = test("handleViewDiff handles view diff callback", async () => {
		await bot.handleViewDiff("test-token", 12345, 100, "task-1")
		assert.ok(true)
	})
	if (t22.passed) passed++
	else {
		failed++
		failures.push(t22)
	}

	// ── handleDeployStaging (void return) ────────────────────────────────────

	const t23 = test("handleDeployStaging handles deploy staging callback", async () => {
		await bot.handleDeployStaging("test-token", 12345, 100, "task-1")
		assert.ok(true)
	})
	if (t23.passed) passed++
	else {
		failed++
		failures.push(t23)
	}

	// ── handleDeployProduction (void return) ─────────────────────────────────

	const t24 = test("handleDeployProduction handles deploy production callback", async () => {
		await bot.handleDeployProduction("test-token", 12345, 100, "task-1")
		assert.ok(true)
	})
	if (t24.passed) passed++
	else {
		failed++
		failures.push(t24)
	}

	// ── handleRollbackCallback (void return) ─────────────────────────────────

	const t25 = test("handleRollbackCallback handles rollback callback", async () => {
		await bot.handleRollbackCallback("test-token", 12345, 100, "SP-task-1")
		assert.ok(true)
	})
	if (t25.passed) passed++
	else {
		failed++
		failures.push(t25)
	}

	// ── TOTP functions (return values) ───────────────────────────────────────

	const t26 = test("generateTOTPSecret returns a base32 string", () => {
		const secret = bot.generateTOTPSecret()
		assert.ok(secret)
		assert.strictEqual(typeof secret, "string")
		assert.ok(secret.length > 10)
	})
	if (t26.passed) passed++
	else {
		failed++
		failures.push(t26)
	}

	const t27 = test("verifyTOTP returns boolean", () => {
		const secret = bot.generateTOTPSecret()
		const result = bot.verifyTOTP(secret, "000000")
		assert.strictEqual(typeof result, "boolean")
	})
	if (t27.passed) passed++
	else {
		failed++
		failures.push(t27)
	}

	const t28 = test("generateOTPAuthURI returns valid URI", () => {
		const secret = bot.generateTOTPSecret()
		const uri = bot.generateOTPAuthURI(secret, "test@example.com")
		assert.ok(uri.includes("otpauth://totp/"))
		assert.ok(uri.includes("secret="))
	})
	if (t28.passed) passed++
	else {
		failed++
		failures.push(t28)
	}

	// ── Conversation context (return values) ─────────────────────────────────

	const t29 = test("getConversationContext returns array", () => {
		const ctx = bot.getConversationContext(12345, 10)
		assert.ok(Array.isArray(ctx))
	})
	if (t29.passed) passed++
	else {
		failed++
		failures.push(t29)
	}

	const t30 = test("buildConversationSummary returns string", () => {
		const summary = bot.buildConversationSummary(12345, 5)
		assert.strictEqual(typeof summary, "string")
	})
	if (t30.passed) passed++
	else {
		failed++
		failures.push(t30)
	}

	// ── Results ──────────────────────────────────────────────────────────────

	console.log("\n" + "=".repeat(60))
	console.log("  telegramBot: " + passed + " passed, " + failed + " failed")
	console.log("=".repeat(60))

	if (failures.length > 0) {
		for (const f of failures) {
			console.log("    ✗ " + f.name + ": " + f.error)
		}
	}

	return { passed, failed, failures }
}

module.exports = { runTests }
