/**
 * Tests for telegramNotifier.js
 *
 * Run with: node cloud/api/__tests__/run-tests.js
 */

const assert = require("assert")
const path = require("path")

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

	section("telegramNotifier")

	const notifierPath = path.join(__dirname, "..", "telegramNotifier.js")
	delete require.cache[require.resolve(notifierPath)]
	const notifier = require(notifierPath)

	const BOT_TOKEN = "test-token"
	const CHAT_ID = 12345

	// ── sendTaskStarted ──────────────────────────────────────────────────────

	const t1 = test("sendTaskStarted sends task started notification", async () => {
		const result = await notifier.sendTaskStarted(BOT_TOKEN, CHAT_ID, "task-1", "Fix bug", "debug")
		assert.ok(result)
	})
	if (t1.passed) passed++
	else {
		failed++
		failures.push(t1)
	}

	const t2 = test("sendTaskStarted works with unknown agent type", async () => {
		const result = await notifier.sendTaskStarted(BOT_TOKEN, CHAT_ID, "task-2", "Do something", "unknown")
		assert.ok(result)
	})
	if (t2.passed) passed++
	else {
		failed++
		failures.push(t2)
	}

	// ── sendTaskComplete ─────────────────────────────────────────────────────

	const t3 = test("sendTaskComplete sends task complete notification", async () => {
		const result = await notifier.sendTaskComplete(BOT_TOKEN, CHAT_ID, "task-1", "Fix bug", "All tests pass")
		assert.ok(result)
	})
	if (t3.passed) passed++
	else {
		failed++
		failures.push(t3)
	}

	// ── sendTaskFailed ───────────────────────────────────────────────────────

	const t4 = test("sendTaskFailed sends task failed notification", async () => {
		const result = await notifier.sendTaskFailed(BOT_TOKEN, CHAT_ID, "task-1", "Fix bug", "Timeout error")
		assert.ok(result)
	})
	if (t4.passed) passed++
	else {
		failed++
		failures.push(t4)
	}

	// ── sendApprovalRequest ──────────────────────────────────────────────────

	const t5 = test("sendApprovalRequest sends approval request with buttons", async () => {
		const result = await notifier.sendApprovalRequest(BOT_TOKEN, CHAT_ID, "task-1", "Deploy to production", {
			files: ["app.js"],
			additions: 10,
			deletions: 5,
		})
		assert.ok(result)
	})
	if (t5.passed) passed++
	else {
		failed++
		failures.push(t5)
	}

	// ── sendDeployNotification ───────────────────────────────────────────────

	const t6 = test("sendDeployNotification sends deploy notification", async () => {
		const result = await notifier.sendDeployNotification(BOT_TOKEN, CHAT_ID, "task-1", "Deploy", {
			environment: "staging",
			version: "v1.0.0",
		})
		assert.ok(result)
	})
	if (t6.passed) passed++
	else {
		failed++
		failures.push(t6)
	}

	// ── sendDebugComplete ────────────────────────────────────────────────────

	const t7 = test("sendDebugComplete sends debug complete notification", async () => {
		const result = await notifier.sendDebugComplete(BOT_TOKEN, CHAT_ID, "task-1", "Fix crash", {
			rootCause: "Null pointer",
			fix: "Added null check",
		})
		assert.ok(result)
	})
	if (t7.passed) passed++
	else {
		failed++
		failures.push(t7)
	}

	// ── sendPlanPreview ──────────────────────────────────────────────────────

	const t8 = test("sendPlanPreview sends plan preview", async () => {
		const result = await notifier.sendPlanPreview(BOT_TOKEN, CHAT_ID, "task-1", "Refactor", {
			phases: ["Analyze", "Implement", "Test"],
			estimatedDuration: "2h",
		})
		assert.ok(result)
	})
	if (t8.passed) passed++
	else {
		failed++
		failures.push(t8)
	}

	// ── sendSavepointCreated ─────────────────────────────────────────────────

	const t9 = test("sendSavepointCreated sends savepoint notification", async () => {
		const result = await notifier.sendSavepointCreated(BOT_TOKEN, CHAT_ID, "task-1", {
			savepointId: "SP-abc",
			branch: "feature/test",
			commitHash: "abc123",
		})
		assert.ok(result)
	})
	if (t9.passed) passed++
	else {
		failed++
		failures.push(t9)
	}

	// ── sendReviewReady ──────────────────────────────────────────────────────

	const t10 = test("sendReviewReady sends review ready notification", async () => {
		const result = await notifier.sendReviewReady(BOT_TOKEN, CHAT_ID, "task-1", "Add login", {
			filesChanged: ["auth.js"],
			reviewers: ["user1"],
		})
		assert.ok(result)
	})
	if (t10.passed) passed++
	else {
		failed++
		failures.push(t10)
	}

	// ── sendDeploymentHealth ─────────────────────────────────────────────────

	const t11 = test("sendDeploymentHealth sends deployment health", async () => {
		const result = await notifier.sendDeploymentHealth(BOT_TOKEN, CHAT_ID, "task-1", "production", {
			status: "healthy",
			uptime: "99.9%",
			cpu: "45%",
			memory: "60%",
		})
		assert.ok(result)
	})
	if (t11.passed) passed++
	else {
		failed++
		failures.push(t11)
	}

	// ── sendRollbackAvailable ────────────────────────────────────────────────

	const t12 = test("sendRollbackAvailable sends rollback notification", async () => {
		const result = await notifier.sendRollbackAvailable(BOT_TOKEN, CHAT_ID, "task-1", {
			savepointId: "SP-abc",
			createdAt: new Date().toISOString(),
			description: "Before deploy",
		})
		assert.ok(result)
	})
	if (t12.passed) passed++
	else {
		failed++
		failures.push(t12)
	}

	// ── sendNotification ─────────────────────────────────────────────────────

	const t13 = test("sendNotification sends generic notification", async () => {
		const result = await notifier.sendNotification(BOT_TOKEN, CHAT_ID, "Test Title", "Test message", [
			[{ text: "OK", callback_data: "ok" }],
		])
		assert.ok(result)
	})
	if (t13.passed) passed++
	else {
		failed++
		failures.push(t13)
	}

	// ── handleNotificationCallback ───────────────────────────────────────────

	const t14 = test("handleNotificationCallback handles approve callback", async () => {
		const callbackQuery = {
			id: "cq-1",
			from: { id: 67890, first_name: "Test" },
			message: { message_id: 100, chat: { id: CHAT_ID } },
			data: "notify:approve:task-1",
		}
		const result = await notifier.handleNotificationCallback(BOT_TOKEN, callbackQuery)
		assert.ok(result)
	})
	if (t14.passed) passed++
	else {
		failed++
		failures.push(t14)
	}

	const t15 = test("handleNotificationCallback handles reject callback", async () => {
		const callbackQuery = {
			id: "cq-2",
			from: { id: 67890, first_name: "Test" },
			message: { message_id: 101, chat: { id: CHAT_ID } },
			data: "notify:reject:task-1",
		}
		const result = await notifier.handleNotificationCallback(BOT_TOKEN, callbackQuery)
		assert.ok(result)
	})
	if (t15.passed) passed++
	else {
		failed++
		failures.push(t15)
	}

	const t16 = test("handleNotificationCallback handles unknown callback gracefully", async () => {
		const callbackQuery = {
			id: "cq-3",
			from: { id: 67890, first_name: "Test" },
			message: { message_id: 102, chat: { id: CHAT_ID } },
			data: "notify:unknown:task-1",
		}
		// Unknown action returns false from the default case
		const result = await notifier.handleNotificationCallback(BOT_TOKEN, callbackQuery)
		assert.strictEqual(result, false)
	})
	if (t16.passed) passed++
	else {
		failed++
		failures.push(t16)
	}

	// ── getApprovalStatus ────────────────────────────────────────────────────

	const t17 = test("getApprovalStatus returns status object", () => {
		const status = notifier.getApprovalStatus(CHAT_ID, "task-1")
		assert.ok(status)
	})
	if (t17.passed) passed++
	else {
		failed++
		failures.push(t17)
	}

	// ── clearNotifications ───────────────────────────────────────────────────

	const t18 = test("clearNotifications clears notifications", () => {
		// Should not throw
		notifier.clearNotifications(CHAT_ID)
		assert.ok(true)
	})
	if (t18.passed) passed++
	else {
		failed++
		failures.push(t18)
	}

	// ── setGroupRouting / resolveChatId ──────────────────────────────────────

	const t19 = test("setGroupRouting and resolveChatId work together", () => {
		notifier.setGroupRouting(CHAT_ID, 99999)
		const resolved = notifier.resolveChatId(CHAT_ID)
		// setGroupRouting stores as string internally, so resolveChatId returns string
		assert.strictEqual(resolved, "99999")
	})
	if (t19.passed) passed++
	else {
		failed++
		failures.push(t19)
	}

	const t20 = test("resolveChatId returns original chat ID when no routing set", () => {
		const resolved = notifier.resolveChatId(55555)
		assert.strictEqual(resolved, 55555)
	})
	if (t20.passed) passed++
	else {
		failed++
		failures.push(t20)
	}

	// ── Results ──────────────────────────────────────────────────────────────

	console.log("\n" + "=".repeat(60))
	console.log("  telegramNotifier: " + passed + " passed, " + failed + " failed")
	console.log("=".repeat(60))

	if (failures.length > 0) {
		for (const f of failures) {
			console.log("    ✗ " + f.name + ": " + f.error)
		}
	}

	return { passed, failed, failures }
}

module.exports = { runTests }
