/**
 * Unit Tests for Telegram Notifier — Group Chat Routing & New Functions
 *
 * Tests the group chat routing feature and new notification functions
 * in telegramNotifier.js.
 *
 * Run: node test-notifier-routing.js
 */

const notifier = require("./api/telegramNotifier")

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

function assertEqual(actual, expected, message) {
	if (actual === expected) {
		console.log("  ✅ " + message)
		passed++
	} else {
		console.log("  ❌ " + message + " — expected: " + JSON.stringify(expected) + ", got: " + JSON.stringify(actual))
		failed++
	}
}

// ─── Test 1: Module Exports — New Functions ──────────────────────────────
console.log("=== Test 1: Module Exports — New Functions ===\n")

assert(typeof notifier.sendPlanPreview === "function", "sendPlanPreview is exported")
assert(typeof notifier.sendSavepointCreated === "function", "sendSavepointCreated is exported")
assert(typeof notifier.sendReviewReady === "function", "sendReviewReady is exported")
assert(typeof notifier.sendDeploymentHealth === "function", "sendDeploymentHealth is exported")
assert(typeof notifier.sendRollbackAvailable === "function", "sendRollbackAvailable is exported")
assert(typeof notifier.setGroupRouting === "function", "setGroupRouting is exported")
assert(typeof notifier.resolveChatId === "function", "resolveChatId is exported")
assert(typeof notifier.handleNotificationCallback === "function", "handleNotificationCallback is exported")
assert(typeof notifier.getApprovalStatus === "function", "getApprovalStatus is exported")
assert(typeof notifier.clearNotifications === "function", "clearNotifications is exported")

// ─── Test 2: setGroupRouting — registers routing ─────────────────────────
console.log("\n=== Test 2: setGroupRouting — registers routing ===\n")

notifier.setGroupRouting("user123", "-1001234567890")
var resolved = notifier.resolveChatId("user123")
assertEqual(resolved, "-1001234567890", "resolveChatId returns group chat after setGroupRouting")

// ─── Test 3: setGroupRouting — removes routing when groupChatId is null ──
console.log("\n=== Test 3: setGroupRouting — removes routing ===\n")

notifier.setGroupRouting("user123", null)
resolved = notifier.resolveChatId("user123")
assertEqual(resolved, "user123", "resolveChatId returns original chatId after routing removed")

// ─── Test 4: resolveChatId — returns original when no routing exists ─────
console.log("\n=== Test 4: resolveChatId — no routing ===\n")

resolved = notifier.resolveChatId("user456")
assertEqual(resolved, "user456", "resolveChatId returns original chatId for unregistered user")

// ─── Test 5: resolveChatId — handles numeric IDs ─────────────────────────
console.log("\n=== Test 5: resolveChatId — numeric IDs ===\n")

notifier.setGroupRouting(789, -1009876543210)
resolved = notifier.resolveChatId(789)
assertEqual(resolved, "-1009876543210", "resolveChatId handles numeric userChatId")
assertEqual(typeof resolved, "string", "resolveChatId returns string chatId")

// Cleanup
notifier.setGroupRouting(789, null)

// ─── Test 6: resolveChatId — handles string IDs ──────────────────────────
console.log("\n=== Test 6: resolveChatId — string IDs ===\n")

notifier.setGroupRouting("user999", "-1005555555555")
resolved = notifier.resolveChatId("user999")
assertEqual(resolved, "-1005555555555", "resolveChatId handles string userChatId")
notifier.setGroupRouting("user999", null)

// ─── Test 7: Multiple users can route to same group ──────────────────────
console.log("\n=== Test 7: Multiple users → same group ===\n")

notifier.setGroupRouting("userA", "-100GROUP")
notifier.setGroupRouting("userB", "-100GROUP")

assertEqual(notifier.resolveChatId("userA"), "-100GROUP", "userA routes to group")
assertEqual(notifier.resolveChatId("userB"), "-100GROUP", "userB routes to same group")

notifier.setGroupRouting("userA", null)
notifier.setGroupRouting("userB", null)

// ─── Test 8: setGroupRouting — overwrites existing routing ───────────────
console.log("\n=== Test 8: setGroupRouting — overwrite ===\n")

notifier.setGroupRouting("userOverwrite", "-100FIRST")
assertEqual(notifier.resolveChatId("userOverwrite"), "-100FIRST", "first routing works")

notifier.setGroupRouting("userOverwrite", "-100SECOND")
assertEqual(notifier.resolveChatId("userOverwrite"), "-100SECOND", "routing overwritten successfully")

notifier.setGroupRouting("userOverwrite", null)

// ─── Test 9: pendingApprovals — is a Map ─────────────────────────────────
console.log("\n=== Test 9: pendingApprovals ===\n")

assert(notifier.pendingApprovals instanceof Map, "pendingApprovals is a Map")
assertEqual(notifier.pendingApprovals.size, 0, "pendingApprovals starts empty")

// ─── Test 10: clearNotifications — does not throw ────────────────────────
console.log("\n=== Test 10: clearNotifications ===\n")

var threw = false
try {
	notifier.clearNotifications("user123")
} catch (e) {
	threw = true
}
assert(!threw, "clearNotifications does not throw for unregistered user")

// ─── Test 11: getApprovalStatus — returns null for unknown ───────────────
console.log("\n=== Test 11: getApprovalStatus ===\n")

var status = notifier.getApprovalStatus("user123", "TASK-001")
assert(status === null, "getApprovalStatus returns null for unknown approval")

// ─── Summary ──────────────────────────────────────────────────────────────
console.log("\n" + "=".repeat(50))
console.log(
	"Notifier Routing Tests: " + passed + " passed, " + failed + " failed out of " + (passed + failed) + " tests",
)
console.log("=".repeat(50))

process.exit(failed > 0 ? 1 : 0)
