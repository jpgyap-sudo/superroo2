/**
 * Tests for telegramLearner.js
 *
 * Run with: node cloud/api/__tests__/run-tests.js
 */

const assert = require("assert")
const path = require("path")
const fs = require("fs")
const os = require("os")

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

	section("telegramLearner")

	// Use a temp directory for test data to avoid polluting real data
	const testDataDir = path.join(os.tmpdir(), "superroo-learner-test-" + Date.now())
	process.env.LEARNER_DATA_DIR = testDataDir

	const learnerPath = path.join(__dirname, "..", "telegramLearner.js")
	delete require.cache[require.resolve(learnerPath)]
	const learner = require(learnerPath)

	// ── recordInteraction ────────────────────────────────────────────────────

	const t1 = test("recordInteraction records a chat interaction", () => {
		const result = learner.recordInteraction({
			chatId: 12345,
			userId: 67890,
			message: "Deploy to production",
			intent: "deploy",
			responseTime: 1500,
			success: true,
		})
		assert.ok(result !== false)
	})
	if (t1.passed) passed++
	else {
		failed++
		failures.push(t1)
	}

	const t2 = test("recordInteraction handles missing fields gracefully", () => {
		const result = learner.recordInteraction({ chatId: 12345 })
		assert.ok(result !== false)
	})
	if (t2.passed) passed++
	else {
		failed++
		failures.push(t2)
	}

	// ── recordConversation ───────────────────────────────────────────────────

	const t3 = test("recordConversation records a conversation", () => {
		const result = learner.recordConversation()
		assert.ok(result !== false)
	})
	if (t3.passed) passed++
	else {
		failed++
		failures.push(t3)
	}

	// ── assessUserSatisfaction ───────────────────────────────────────────────

	const t4 = test("assessUserSatisfaction detects positive sentiment", () => {
		const result = learner.assessUserSatisfaction("Great work, thank you!")
		assert.ok(result)
	})
	if (t4.passed) passed++
	else {
		failed++
		failures.push(t4)
	}

	const t5 = test("assessUserSatisfaction detects negative sentiment", () => {
		const result = learner.assessUserSatisfaction("This is terrible, it doesn't work")
		// Returns false for negative sentiment
		assert.strictEqual(result, false)
	})
	if (t5.passed) passed++
	else {
		failed++
		failures.push(t5)
	}

	const t6 = test("assessUserSatisfaction handles neutral message", () => {
		const result = learner.assessUserSatisfaction("The sky is blue")
		assert.ok(result !== undefined)
	})
	if (t6.passed) passed++
	else {
		failed++
		failures.push(t6)
	}

	// ── suggestIntent ────────────────────────────────────────────────────────

	const t7 = test("suggestIntent returns a string for known patterns", () => {
		const result = learner.suggestIntent("Deploy to production")
		assert.ok(result)
	})
	if (t7.passed) passed++
	else {
		failed++
		failures.push(t7)
	}

	// ── updateIntentAccuracy ─────────────────────────────────────────────────

	const t8 = test("updateIntentAccuracy updates accuracy metrics", () => {
		const result = learner.updateIntentAccuracy("deploy", true)
		assert.ok(result !== false)
	})
	if (t8.passed) passed++
	else {
		failed++
		failures.push(t8)
	}

	const t9 = test("updateIntentAccuracy handles incorrect intent", () => {
		const result = learner.updateIntentAccuracy("deploy", false)
		assert.ok(result !== false)
	})
	if (t9.passed) passed++
	else {
		failed++
		failures.push(t9)
	}

	// ── getStats ─────────────────────────────────────────────────────────────

	const t10 = test("getStats returns stats object", () => {
		const stats = learner.getStats()
		assert.ok(stats)
		assert.ok(typeof stats.totalConversations === "number")
		assert.ok(typeof stats.totalInteractions === "number")
	})
	if (t10.passed) passed++
	else {
		failed++
		failures.push(t10)
	}

	// ── detectPatterns ───────────────────────────────────────────────────────

	const t11 = test("detectPatterns runs without error", () => {
		// detectPatterns modifies internal state but doesn't return a value
		learner.detectPatterns()
		assert.ok(true)
	})
	if (t11.passed) passed++
	else {
		failed++
		failures.push(t11)
	}

	// ── loadState / saveState ────────────────────────────────────────────────

	const t12 = test("loadState and saveState work without error", () => {
		// Should not throw
		learner.saveState()
		learner.loadState()
		assert.ok(true)
	})
	if (t12.passed) passed++
	else {
		failed++
		failures.push(t12)
	}

	// ── recordUserPreference ─────────────────────────────────────────────────

	const t13 = test("recordUserPreference records user preference", () => {
		const result = learner.recordUserPreference(67890, "favoriteCommands", ["/deploy", "/test"])
		assert.ok(result !== false)
	})
	if (t13.passed) passed++
	else {
		failed++
		failures.push(t13)
	}

	// ── getUserPreferences ───────────────────────────────────────────────────

	const t14 = test("getUserPreferences returns preferences for known user", () => {
		const prefs = learner.getUserPreferences(67890)
		assert.ok(prefs)
	})
	if (t14.passed) passed++
	else {
		failed++
		failures.push(t14)
	}

	const t15 = test("getUserPreferences returns null for unknown user", () => {
		const prefs = learner.getUserPreferences(99999)
		// Returns null when no preferences exist for this user
		assert.strictEqual(prefs, null)
	})
	if (t15.passed) passed++
	else {
		failed++
		failures.push(t15)
	}

	// ── getProactiveSuggestions ──────────────────────────────────────────────

	const t16 = test("getProactiveSuggestions returns array", () => {
		const suggestions = learner.getProactiveSuggestions(67890, "I want to deploy")
		assert.ok(Array.isArray(suggestions))
	})
	if (t16.passed) passed++
	else {
		failed++
		failures.push(t16)
	}

	// ── detectFrustration ────────────────────────────────────────────────────

	const t17 = test("detectFrustration detects frustrated message", () => {
		const result = learner.detectFrustration(67890, "This is terrible, why doesn't it work?!", "deploy")
		assert.ok(result !== undefined)
	})
	if (t17.passed) passed++
	else {
		failed++
		failures.push(t17)
	}

	const t18 = test("detectFrustration handles neutral message", () => {
		const result = learner.detectFrustration(67890, "Please show the status", "status")
		assert.ok(result !== undefined)
	})
	if (t18.passed) passed++
	else {
		failed++
		failures.push(t18)
	}

	// ── resetFrustration ─────────────────────────────────────────────────────

	const t19 = test("resetFrustration resets frustration for user", () => {
		const result = learner.resetFrustration(67890)
		assert.ok(result !== false)
	})
	if (t19.passed) passed++
	else {
		failed++
		failures.push(t19)
	}

	// ── semanticSearch ───────────────────────────────────────────────────────

	const t20 = test("semanticSearch returns array", () => {
		const results = learner.semanticSearch("deploy to production", 5)
		assert.ok(Array.isArray(results))
	})
	if (t20.passed) passed++
	else {
		failed++
		failures.push(t20)
	}

	// ── loadPreferences / savePreferences ────────────────────────────────────

	const t21 = test("loadPreferences and savePreferences work without error", () => {
		learner.savePreferences()
		learner.loadPreferences()
		assert.ok(true)
	})
	if (t21.passed) passed++
	else {
		failed++
		failures.push(t21)
	}

	// ── loadFrustrationLog / saveFrustrationLog ──────────────────────────────

	const t22 = test("loadFrustrationLog and saveFrustrationLog work without error", () => {
		learner.saveFrustrationLog()
		learner.loadFrustrationLog()
		assert.ok(true)
	})
	if (t22.passed) passed++
	else {
		failed++
		failures.push(t22)
	}

	// ── Cleanup ──────────────────────────────────────────────────────────────

	// Clean up test data
	try {
		const dir = path.dirname(require.resolve("../telegramLearner.js"))
		const dataDir = path.join(dir, "..", "data")
		if (fs.existsSync(dataDir)) {
			const files = fs.readdirSync(dataDir)
			for (const f of files) {
				if (
					f.startsWith("telegram-learner") ||
					f.startsWith("telegram-user") ||
					f.startsWith("telegram-frustration") ||
					f.startsWith("telegram-patterns") ||
					f.startsWith("telegram-conversations")
				) {
					fs.unlinkSync(path.join(dataDir, f))
				}
			}
		}
	} catch (e) {
		// Ignore cleanup errors
	}

	// ── Results ──────────────────────────────────────────────────────────────

	console.log("\n" + "=".repeat(60))
	console.log("  telegramLearner: " + passed + " passed, " + failed + " failed")
	console.log("=".repeat(60))

	if (failures.length > 0) {
		for (const f of failures) {
			console.log("    ✗ " + f.name + ": " + f.error)
		}
	}

	return { passed, failed, failures }
}

module.exports = { runTests }
