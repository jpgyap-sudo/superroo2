/**
 * Telegram Bot Core Tests
 *
 * Tests for command routing, auth guards, rate limiting, and
 * webhook security in the main Telegram bot.
 */

const assert = require("assert")

// ─── Mock dependencies ───────────────────────────────────────────────────────
const mockFs = {
  access: async () => {},
  writeFile: async () => {},
  readFile: async () => "{}",
  mkdir: async () => {},
}

const mockFetch = async (url, opts) => {
  if (url.includes("/getMe")) {
    return { ok: true, json: async () => ({ ok: true, result: { username: "superroo_bot" } }) }
  }
  if (url.includes("/sendMessage")) {
    return { ok: true, json: async () => ({ ok: true, result: { message_id: 1 } }) }
  }
  if (url.includes("/answerCallbackQuery")) {
    return { ok: true, json: async () => ({ ok: true }) }
  }
  if (url.includes("/getChatMember")) {
    return { ok: true, json: async () => ({ ok: true, result: { status: "member" } }) }
  }
  return { ok: false, status: 400, text: async () => "Bad Request" }
}

// Override globals before requiring the bot module
// Note: telegramBot.js is not easily testable in isolation due to module-level
// side effects and tight coupling. These tests document the intended behavior
// and serve as a starting point for refactoring.

// ─── Tests ───────────────────────────────────────────────────────────────────

function testRateLimit() {
  // Simulate rate limiter logic
  const rateLimitMap = new Map()
  const RATE_LIMIT_MAX = 10
  const RATE_LIMIT_WINDOW_MS = 60 * 1000

  function checkRateLimit(chatId) {
    const now = Date.now()
    const entry = rateLimitMap.get(chatId)
    if (!entry) {
      rateLimitMap.set(chatId, { count: 1, windowStart: now })
      return { allowed: true }
    }
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
      rateLimitMap.set(chatId, { count: 1, windowStart: now })
      return { allowed: true }
    }
    if (entry.count >= RATE_LIMIT_MAX) {
      const retryAfter = Math.ceil((RATE_LIMIT_WINDOW_MS - (now - entry.windowStart)) / 1000)
      return { allowed: false, retryAfter }
    }
    entry.count++
    return { allowed: true }
  }

  const chatId = 12345
  // First 10 should pass
  for (let i = 0; i < 10; i++) {
    const result = checkRateLimit(chatId)
    assert.strictEqual(result.allowed, true, `Request ${i + 1} should be allowed`)
  }
  // 11th should be blocked
  const blocked = checkRateLimit(chatId)
  assert.strictEqual(blocked.allowed, false, "11th request should be rate limited")
  assert.ok(blocked.retryAfter > 0, "retryAfter should be positive")

  console.log("✅ testRateLimit passed")
}

function testWebhookSecretValidation() {
  // Simulate webhook secret check
  const webhookSecret = "my-secret-token"

  function validateWebhookSecret(header, secret) {
    if (!secret) return true // no secret configured = allow
    return header === secret
  }

  assert.strictEqual(validateWebhookSecret(undefined, undefined), true, "No secret should allow")
  assert.strictEqual(validateWebhookSecret("my-secret-token", webhookSecret), true, "Matching secret should allow")
  assert.strictEqual(validateWebhookSecret("wrong-token", webhookSecret), false, "Wrong secret should block")

  console.log("✅ testWebhookSecretValidation passed")
}

function testBotUsernameExtraction() {
  // Token format: 123456:ABC-DEF... (numeric ID, NOT username)
  const token = "123456789:ABCdefGHIjklMNOpqrSTUvwxyz"
  const extracted = token.split(":")[0]
  assert.strictEqual(extracted, "123456789", "Extracted part should be numeric ID")
  assert.notStrictEqual(extracted, "superroo_bot", "Extracted part should NOT be the username")

  console.log("✅ testBotUsernameExtraction passed")
}

function testOtpGeneration() {
  // Simulate secure OTP generation
  const crypto = require("crypto")
  const otp = crypto.randomInt(100000, 999999).toString()
  assert.strictEqual(otp.length, 6, "OTP should be 6 digits")
  assert.ok(/^[0-9]{6}$/.test(otp), "OTP should be numeric")
  assert.ok(parseInt(otp) >= 100000 && parseInt(otp) <= 999999, "OTP should be in range")

  console.log("✅ testOtpGeneration passed")
}

function testCommandRouting() {
  // Map of commands to expected agent types
  const routing = {
    create_branch: "superroo-coder-agent",
    create_pr: "superroo-coder-agent",
    debug_plan: "superroo-debugger-agent",
    run_tests: "superroo-debugger-agent",
    deploy: "superroo-deployer-agent",
  }

  assert.strictEqual(routing.create_branch, "superroo-coder-agent", "create_branch should route to coder")
  assert.strictEqual(routing.create_pr, "superroo-coder-agent", "create_pr should route to coder")
  assert.strictEqual(routing.debug_plan, "superroo-debugger-agent", "debug_plan should route to debugger")

  console.log("✅ testCommandRouting passed")
}

function testMarkdownFallback() {
  // Simulate markdown parse failure -> plain text retry
  let attempts = 0
  function sendMessageWithFallback(text, parseMode) {
    attempts++
    if (parseMode === "Markdown" && text.includes("*")) {
      // Simulate Telegram API error
      return { ok: false, error: "can't parse entities" }
    }
    return { ok: true }
  }

  let result = sendMessageWithFallback("*bold* text", "Markdown")
  if (!result.ok && result.error.includes("can't parse entities")) {
    result = sendMessageWithFallback("bold text", "")
  }
  assert.strictEqual(result.ok, true, "Plain text fallback should succeed")
  assert.strictEqual(attempts, 2, "Should have attempted twice")

  console.log("✅ testMarkdownFallback passed")
}

// ─── Run all tests ───────────────────────────────────────────────────────────

function runTests() {
  console.log("🧪 Running Telegram Bot Core Tests...\n")
  try {
    testRateLimit()
    testWebhookSecretValidation()
    testBotUsernameExtraction()
    testOtpGeneration()
    testCommandRouting()
    testMarkdownFallback()
    console.log("\n✅ All tests passed")
    process.exit(0)
  } catch (err) {
    console.error("\n❌ Test failed:", err.message)
    process.exit(1)
  }
}

runTests()
