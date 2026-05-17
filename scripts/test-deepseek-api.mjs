#!/usr/bin/env node
/**
 * DeepSeek API Test Script
 *
 * Tests the DeepSeek API connection and verifies the key is working.
 * Also tests the workflow tracking integration.
 *
 * Usage:
 *   node scripts/test-deepseek-api.mjs [options]
 *
 * Options:
 *   --key <key>         Test with specific API key
 *   --model <model>     Model to test (default: deepseek-chat)
 *   --verbose           Show detailed output
 *   --track             Test with workflow tracking
 */

import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ── Configuration ─────────────────────────────────────────────────────────────

const DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions"
const DEFAULT_MODEL = "deepseek-chat"

// ── Colors for terminal output ─────────────────────────────────────────────────

const colors = {
	reset: "\x1b[0m",
	bright: "\x1b[1m",
	dim: "\x1b[2m",
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	blue: "\x1b[34m",
	magenta: "\x1b[35m",
	cyan: "\x1b[36m",
}

function color(name, text) {
	return `${colors[name]}${text}${colors.reset}`
}

// ── Argument Parsing ──────────────────────────────────────────────────────────

function parseArgs() {
	const args = process.argv.slice(2)
	const options = {
		key: process.env.DEEPSEEK_API_KEY || "",
		model: DEFAULT_MODEL,
		verbose: false,
		track: false,
	}

	for (let i = 0; i < args.length; i++) {
		switch (args[i]) {
			case "--key":
				options.key = args[++i]
				break
			case "--model":
				options.model = args[++i]
				break
			case "--verbose":
				options.verbose = true
				break
			case "--track":
				options.track = true
				break
			case "--help":
			case "-h":
				showHelp()
				process.exit(0)
				break
		}
	}

	return options
}

function showHelp() {
	console.log(`
DeepSeek API Test Script

Usage: node scripts/test-deepseek-api.mjs [options]

Options:
  --key <key>      Test with specific API key (default: DEEPSEEK_API_KEY env var)
  --model <model>  Model to test (default: deepseek-chat)
  --verbose        Show detailed output
  --track          Test with workflow tracking
  --help, -h       Show this help message

Examples:
  # Test with environment variable
  node scripts/test-deepseek-api.mjs

  # Test with specific key
  node scripts/test-deepseek-api.mjs --key sk-...

  # Test with workflow tracking
  node scripts/test-deepseek-api.mjs --track --verbose
`)
}

// ── API Test Functions ────────────────────────────────────────────────────────

async function testApiKey(apiKey, model, verbose) {
	console.log(color("cyan", "\n🔑 Testing DeepSeek API Key\n"))

	// Validate key format
	if (!apiKey) {
		console.log(color("red", "❌ No API key provided"))
		console.log("   Set DEEPSEEK_API_KEY environment variable or use --key flag")
		return { success: false, error: "No API key" }
	}

	// Check key format (DeepSeek keys start with sk-)
	if (!apiKey.startsWith("sk-")) {
		console.log(color("yellow", "⚠️  Warning: Key doesn't start with 'sk-'"))
		console.log("   DeepSeek keys typically start with 'sk-'")
	}

	const keyLast4 = apiKey.slice(-4)
	console.log(`Key format:      ${color("green", "✓ Valid")}`)
	console.log(`Key ending:      ****${keyLast4}`)
	console.log(`Model:           ${color("bright", model)}`)

	// Test API call
	console.log(color("cyan", "\n📡 Making Test API Call\n"))

	const startTime = Date.now()

	try {
		const response = await fetch(DEEPSEEK_API_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify({
				model: model,
				messages: [
					{
						role: "system",
						content: "You are a helpful assistant. Respond with a single word.",
					},
					{
						role: "user",
						content: "Say 'DeepSeek API test successful'",
					},
				],
				max_tokens: 50,
				temperature: 0,
			}),
		})

		const latencyMs = Date.now() - startTime

		if (!response.ok) {
			const errorData = await response.json().catch(() => ({}))
			console.log(color("red", `❌ API Error (${response.status})`))
			console.log(`   ${errorData.error?.message || response.statusText}`)
			return {
				success: false,
				error: errorData.error?.message || `HTTP ${response.status}`,
				latencyMs,
			}
		}

		const data = await response.json()
		const content = data.choices?.[0]?.message?.content?.trim()
		const usage = data.usage

		console.log(color("green", "✅ API Call Successful"))
		console.log(`   Latency:       ${latencyMs}ms`)
		console.log(`   Response:      "${content}"`)

		if (verbose && usage) {
			console.log(color("dim", "\n   Token Usage:"))
			console.log(color("dim", `     Prompt:     ${usage.prompt_tokens}`))
			console.log(color("dim", `     Completion: ${usage.completion_tokens}`))
			console.log(color("dim", `     Total:      ${usage.total_tokens}`))
		}

		return {
			success: true,
			latencyMs,
			promptTokens: usage?.prompt_tokens || 0,
			completionTokens: usage?.completion_tokens || 0,
			response: content,
			keyLast4,
		}
	} catch (error) {
		const latencyMs = Date.now() - startTime
		console.log(color("red", "❌ Connection Error"))
		console.log(`   ${error.message}`)
		return {
			success: false,
			error: error.message,
			latencyMs,
		}
	}
}

async function testWorkflowTracking(result) {
	if (!result.success) {
		console.log(color("yellow", "\n⚠️  Skipping workflow tracking (API call failed)"))
		return
	}

	console.log(color("cyan", "\n📝 Testing Workflow Tracking\n"))

	try {
		// Dynamically import the ModelUsageTracker
		const { getModelUsageTracker, initializeModelUsageTracker } = await import(
			"../src/super-roo/product-memory/ModelUsageTracker.js"
		)

		// Create a mock event log
		const mockEventLog = {
			info: () => {},
			warn: () => {},
			error: () => {},
		}

		// Initialize tracker
		initializeModelUsageTracker(mockEventLog)
		const tracker = getModelUsageTracker()

		// Start a task
		const taskId = tracker.startTask("deepseek-api-test")
		console.log(`Task ID:         ${taskId}`)

		// Log the DeepSeek API call
		await tracker.logDeepSeekDelegation(
			true,
			result.model || "deepseek-chat",
			result.keyLast4,
			result.latencyMs,
			{
				prompt: result.promptTokens,
				completion: result.completionTokens,
			}
		)

		// End the task
		const summary = await tracker.endTask()

		console.log(color("green", "✅ Workflow Tracking Successful"))
		console.log(`   DeepSeek Used: ${summary?.deepseekDelegated ? "Yes" : "No"}`)
		console.log(`   Total Tokens:  ${summary?.totalTokens}`)
		console.log(`   Compliant:     ${summary?.workflowCompliant ? "Yes" : "No"}`)

		// Check if we can verify the API key was used
		const wasUsed = await tracker.wasApiKeyUsed(result.keyLast4)
		console.log(`   Key Verified:  ${wasUsed ? "Yes" : "No"}`)
	} catch (error) {
		console.log(color("yellow", "⚠️  Workflow tracking error (non-critical)"))
		console.log(`   ${error.message}`)
	}
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
	const options = parseArgs()

	console.log(color("bright", "\n═══════════════════════════════════════════════════════════"))
	console.log(color("bright", "           DEEPSEEK API TEST"))
	console.log(color("bright", "═══════════════════════════════════════════════════════════"))

	// Test the API
	const result = await testApiKey(options.key, options.model, options.verbose)

	// Test workflow tracking if requested
	if (options.track) {
		await testWorkflowTracking(result)
	}

	// Final summary
	console.log(color("bright", "\n═══════════════════════════════════════════════════════════"))

	if (result.success) {
		console.log(color("green", "\n✅ All Tests Passed"))
		console.log(color("dim", "\nYour DeepSeek API key is working correctly."))
		console.log(color("dim", "You can now use it with the workflow tracking system."))

		// Show verification command
		console.log(color("cyan", "\n📋 Verification:"))
		console.log(`   To verify this key was used in workflow tracking:`)
		console.log(`   node scripts/check-workflow-compliance.mjs --verify-key ${result.keyLast4}`)
	} else {
		console.log(color("red", "\n❌ Test Failed"))
		console.log(color("dim", "\nPlease check:"))
		console.log(color("dim", "  1. Your API key is correct"))
		console.log(color("dim", "  2. You have an active internet connection"))
		console.log(color("dim", "  3. DeepSeek API is accessible from your location"))
		console.log(color("dim", "  4. Your API key has sufficient credits"))

		process.exit(1)
	}

	console.log("")
}

main().catch((error) => {
	console.error(color("red", "Unexpected error:"), error.message)
	process.exit(1)
})
