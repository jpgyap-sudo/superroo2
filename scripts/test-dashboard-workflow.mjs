#!/usr/bin/env node
/**
 * Test Dashboard Workflow Compliance API
 *
 * Tests the cloud dashboard workflow compliance endpoints to ensure
 * they are working correctly before deploying.
 */

import { execSync } from "child_process"

const API_BASE = process.env.API_BASE || "http://localhost:3001"

// ── Colors ────────────────────────────────────────────────────────────────────

const colors = {
	reset: "\x1b[0m",
	green: "\x1b[32m",
	red: "\x1b[31m",
	yellow: "\x1b[33m",
	blue: "\x1b[34m",
}

function color(name, text) {
	return `${colors[name]}${text}${colors.reset}`
}

// ── Test Functions ────────────────────────────────────────────────────────────

async function testEndpoint(name, url) {
	console.log(color("blue", `\n📡 Testing: ${name}`))
	console.log(`   URL: ${url}`)

	try {
		const response = await fetch(url)
		const data = await response.json()

		if (response.ok) {
			console.log(color("green", "   ✅ SUCCESS"))
			return { success: true, data }
		} else {
			console.log(color("red", `   ❌ FAILED (${response.status})`))
			console.log(`   Error: ${data.error || "Unknown error"}`)
			return { success: false, error: data.error }
		}
	} catch (error) {
		console.log(color("red", "   ❌ ERROR"))
		console.log(`   ${error.message}`)
		return { success: false, error: error.message }
	}
}

function printStats(data) {
	if (!data) return

	console.log(color("yellow", "\n📊 Statistics:"))
	console.log(`   Total Commits: ${data.totalCommits || 0}`)
	console.log(`   With Model Tracking: ${data.withModelUsage || 0}`)
	console.log(`   Using DeepSeek: ${data.withDeepSeek || 0}`)
	console.log(`   Fully Compliant: ${data.fullyCompliant || 0}`)
	console.log(`   Compliance Rate: ${data.complianceRate || 0}%`)
	console.log(`   Delegation Rate: ${data.delegationRate || 0}%`)

	if (data.deepseekUsage) {
		console.log(color("yellow", "\n🤖 DeepSeek Usage:"))
		console.log(`   Total Calls: ${data.deepseekUsage.totalCalls}`)
		console.log(`   Total Tokens: ${data.deepseekUsage.totalTokens}`)
		console.log(`   Avg Latency: ${data.deepseekUsage.averageLatencyMs}ms`)
	}
}

function printDeepSeekStats(data) {
	if (!data) return

	console.log(color("yellow", "\n🤖 DeepSeek Detailed Stats:"))
	console.log(`   Total Calls: ${data.totalCalls}`)
	console.log(`   Total Tokens: ${data.totalTokens}`)
	console.log(`   Success Rate: ${data.successRate}%`)
	console.log(`   Fallback Rate: ${data.fallbackRate}%`)
	console.log(`   Delegation Rate: ${data.delegationRate}%`)
	console.log(`   Avg Latency: ${data.averageLatencyMs}ms`)

	if (data.apiKeysUsed?.length > 0) {
		console.log(`   API Keys Used: ${data.apiKeysUsed.map((k) => `****${k}`).join(", ")}`)
	}
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
	console.log(color("blue", "═══════════════════════════════════════════════════════════"))
	console.log(color("blue", "       WORKFLOW COMPLIANCE API TEST"))
	console.log(color("blue", "═══════════════════════════════════════════════════════════"))
	console.log(`\nAPI Base: ${API_BASE}`)

	// Test 1: Stats endpoint
	const statsResult = await testEndpoint("Stats", `${API_BASE}/api/workflow-compliance/stats`)
	if (statsResult.success) {
		printStats(statsResult.data.data)
	}

	// Test 2: Commits endpoint
	const commitsResult = await testEndpoint(
		"Commits",
		`${API_BASE}/api/workflow-compliance/commits?limit=5`,
	)
	if (commitsResult.success) {
		const commits = commitsResult.data.data
		console.log(color("yellow", `\n📋 Recent Commits (${commits.length}):`))
		commits.slice(0, 3).forEach((commit, i) => {
			const status = commit.workflowCompliance?.isCompliant ? "✅" : "❌"
			console.log(`   ${i + 1}. ${status} ${commit.title.substring(0, 50)}`)
		})
	}

	// Test 3: DeepSeek stats endpoint
	const deepseekResult = await testEndpoint(
		"DeepSeek Stats",
		`${API_BASE}/api/workflow-compliance/deepseek-stats`,
	)
	if (deepseekResult.success) {
		printDeepSeekStats(deepseekResult.data.data)
	}

	// Test 4: Verify API key (using b52d as example)
	const verifyResult = await testEndpoint(
		"Verify API Key (b52d)",
		`${API_BASE}/api/workflow-compliance/verify-key/b52d`,
	)
	if (verifyResult.success) {
		const data = verifyResult.data.data
		console.log(`   Was Used: ${data.wasUsed ? "Yes" : "No"}`)
		console.log(`   Count: ${data.count}`)
		if (data.lastUsed) {
			console.log(`   Last Used: ${new Date(data.lastUsed).toLocaleString()}`)
		}
	}

	// Test 5: Usage endpoint
	const usageResult = await testEndpoint(
		"Usage Records",
		`${API_BASE}/api/workflow-compliance/usage?limit=5`,
	)
	if (usageResult.success) {
		const usage = usageResult.data.data
		console.log(color("yellow", `\n📈 Recent API Calls (${usage.length}):`))
		usage.slice(0, 3).forEach((u, i) => {
			console.log(`   ${i + 1}. ${u.provider}/${u.model} (${u.phase})`)
		})
	}

	// Summary
	console.log(color("blue", "\n═══════════════════════════════════════════════════════════"))
	const allPassed = [statsResult, commitsResult, deepseekResult, verifyResult, usageResult].every(
		(r) => r.success,
	)

	if (allPassed) {
		console.log(color("green", "✅ All API Tests Passed!"))
		console.log("\nThe workflow compliance dashboard is ready to use.")
		console.log("Visit your dashboard and click the 'Workflow' tab.")
	} else {
		console.log(color("red", "❌ Some Tests Failed"))
		console.log("\nPlease check:")
		console.log("  1. Is the API server running? (pm2 status)")
		console.log("  2. Is the memory directory accessible?")
		console.log("  3. Check the API logs for errors")
		process.exit(1)
	}
	console.log("")
}

main().catch((err) => {
	console.error(color("red", "\n❌ Test failed with error:"), err.message)
	process.exit(1)
})
