#!/usr/bin/env node
/**
 * Workflow Compliance Checker
 *
 * This script checks if tasks followed the SuperRoo workflow:
 * - Codex/Claude = plans and reviews
 * - DeepSeek = does the coding
 * - Ollama = summarizes lessons
 *
 * Usage:
 *   node scripts/check-workflow-compliance.mjs [options]
 *
 * Options:
 *   --since <date>      Check commits since date (e.g., "1 day ago", "2026-05-17")
 *   --commit <sha>      Check specific commit
 *   --verify-key <last4> Verify if specific API key was used
 *   --stats             Show workflow statistics
 *   --report            Generate detailed compliance report
 *   --deepseek-only     Show only tasks that skipped DeepSeek
 *   --fix               Attempt to fix non-compliant records
 */

import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ── Configuration ─────────────────────────────────────────────────────────────

const MEMORY_DIR = path.resolve(process.cwd(), "server/src/memory")
const COMMIT_LOG_FILE = path.join(MEMORY_DIR, "commit-deploy-log.json")
const USAGE_LOG_FILE = path.join(MEMORY_DIR, "model-usage-log.json")
const TASK_SUMMARIES_FILE = path.join(MEMORY_DIR, "task-usage-summaries.json")

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

// ── Data Loading ──────────────────────────────────────────────────────────────

async function loadJson(filePath) {
	try {
		const raw = await fs.readFile(filePath, "utf-8")
		return JSON.parse(raw)
	} catch (err) {
		if (err.code === "ENOENT") {
			return null
		}
		throw err
	}
}

async function loadCommitLog() {
	return await loadJson(COMMIT_LOG_FILE)
}

async function loadUsageLog() {
	return await loadJson(USAGE_LOG_FILE)
}

async function loadTaskSummaries() {
	return await loadJson(TASK_SUMMARIES_FILE)
}

// ── Compliance Checking ───────────────────────────────────────────────────────

function parseDate(dateStr) {
	if (!dateStr) return null

	// Handle relative dates like "1 day ago"
	if (dateStr.includes("ago")) {
		const match = dateStr.match(/(\d+)\s+(day|hour|minute|second)s?\s+ago/)
		if (match) {
			const num = parseInt(match[1])
			const unit = match[2]
			const now = new Date()
			switch (unit) {
				case "day":
					return new Date(now.getTime() - num * 24 * 60 * 60 * 1000)
				case "hour":
					return new Date(now.getTime() - num * 60 * 60 * 1000)
				case "minute":
					return new Date(now.getTime() - num * 60 * 1000)
				case "second":
					return new Date(now.getTime() - num * 1000)
				default:
					return null
			}
		}
	}

	// Handle ISO date strings
	return new Date(dateStr)
}

function checkCommitCompliance(commit) {
	const issues = []
	const warnings = []

	// Check if modelsUsed exists
	if (!commit.modelsUsed || commit.modelsUsed.length === 0) {
		issues.push("No model usage recorded")
	} else {
		// Check for coding phase
		const codingPhase = commit.modelsUsed.find((m) => m.phase === "coding")
		if (!codingPhase) {
			issues.push("No coding phase recorded")
		} else {
			// Check if DeepSeek was used for coding
			if (codingPhase.provider !== "deepseek") {
				issues.push(`Coding used ${codingPhase.provider} instead of DeepSeek`)
			}
			// Check if API key is recorded
			if (!codingPhase.apiKeyLast4) {
				warnings.push("Coding phase doesn't record which API key was used")
			}
		}

		// Check for planning phase
		const planningPhase = commit.modelsUsed.find((m) => m.phase === "planning")
		if (!planningPhase) {
			warnings.push("No planning phase recorded")
		}

		// Check for review phase
		const reviewPhase = commit.modelsUsed.find((m) => m.phase === "review")
		if (!reviewPhase) {
			warnings.push("No review phase recorded")
		}

		// Check for summarization phase
		const summarizationPhase = commit.modelsUsed.find((m) => m.phase === "summarization")
		if (!summarizationPhase) {
			warnings.push("No Ollama summarization recorded")
		}
	}

	// Check workflow compliance struct
	if (!commit.workflowCompliance) {
		warnings.push("No workflow compliance data")
	} else {
		if (!commit.workflowCompliance.isCompliant) {
			issues.push("Marked as non-compliant")
		}
		if (!commit.workflowCompliance.steps?.deepseekDelegated) {
			issues.push("DeepSeek delegation not confirmed")
		}
	}

	return {
		isCompliant: issues.length === 0,
		issues,
		warnings,
	}
}

// ── Report Generation ─────────────────────────────────────────────────────────

async function generateReport(options) {
	const commitLog = await loadCommitLog()
	const usageLog = await loadUsageLog()
	const taskSummaries = await loadTaskSummaries()

	if (!commitLog) {
		console.log(color("red", "❌ No commit log found. Run this from the project root."))
		process.exit(1)
	}

	console.log(color("bright", "\n═══════════════════════════════════════════════════════════"))
	console.log(color("bright", "       SUPERROO WORKFLOW COMPLIANCE REPORT"))
	console.log(color("bright", "═══════════════════════════════════════════════════════════\n"))

	// Filter commits by date if specified
	let commits = commitLog.commits || []
	if (options.since) {
		const sinceDate = parseDate(options.since)
		if (sinceDate) {
			commits = commits.filter((c) => new Date(c.timestamp) >= sinceDate)
		}
	}

	// Filter by specific commit if specified
	if (options.commit) {
		commits = commits.filter((c) => c.commitSha.startsWith(options.commit))
	}

	// Calculate statistics
	const stats = {
		totalCommits: commits.length,
		withModelUsage: 0,
		withDeepSeek: 0,
		withoutDeepSeek: 0,
		withPlanning: 0,
		withReview: 0,
		withSummarization: 0,
		fullyCompliant: 0,
		nonCompliant: 0,
	}

	const nonCompliantCommits = []

	for (const commit of commits) {
		const compliance = checkCommitCompliance(commit)

		if (commit.modelsUsed?.length > 0) {
			stats.withModelUsage++
		}

		const hasDeepSeek = commit.modelsUsed?.some(
			(m) => m.phase === "coding" && m.provider === "deepseek"
		)
		if (hasDeepSeek) {
			stats.withDeepSeek++
		} else if (commit.modelsUsed?.some((m) => m.phase === "coding")) {
			stats.withoutDeepSeek++
			nonCompliantCommits.push(commit)
		}

		if (commit.modelsUsed?.some((m) => m.phase === "planning")) {
			stats.withPlanning++
		}
		if (commit.modelsUsed?.some((m) => m.phase === "review")) {
			stats.withReview++
		}
		if (commit.modelsUsed?.some((m) => m.phase === "summarization")) {
			stats.withSummarization++
		}

		if (compliance.isCompliant) {
			stats.fullyCompliant++
		} else {
			stats.nonCompliant++
		}
	}

	// Print summary
	console.log(color("cyan", "📊 Summary Statistics\n"))
	console.log(`  Total commits analyzed:      ${color("bright", stats.totalCommits)}`)
	console.log(`  With model usage tracking:   ${color("yellow", stats.withModelUsage)}`)
	console.log(`  Using DeepSeek for coding:   ${color("green", stats.withDeepSeek)}`)
	console.log(`  Skipped DeepSeek:            ${color("red", stats.withoutDeepSeek)}`)
	console.log(`  With planning phase:         ${color("blue", stats.withPlanning)}`)
	console.log(`  With review phase:           ${color("blue", stats.withReview)}`)
	console.log(`  With Ollama summarization:   ${color("magenta", stats.withSummarization)}`)
	console.log(`  Fully compliant:             ${color("green", stats.fullyCompliant)}`)
	console.log(`  Non-compliant:               ${color("red", stats.nonCompliant)}`)

	if (stats.totalCommits > 0) {
		const complianceRate = ((stats.fullyCompliant / stats.totalCommits) * 100).toFixed(1)
		console.log(`\n  Compliance rate:             ${color("bright", complianceRate + "%")}`)
	}

	// Print non-compliant commits if any
	if (options.deepseekOnly || (options.report && nonCompliantCommits.length > 0)) {
		console.log(color("red", "\n\n⚠️  NON-COMPLIANT COMMITS (DeepSeek not used)\n"))
		for (const commit of nonCompliantCommits) {
			console.log(`  Commit: ${color("yellow", commit.commitSha)}`)
			console.log(`  Title:  ${commit.title}`)
			console.log(`  Date:   ${new Date(commit.timestamp).toLocaleString()}`)
			console.log(`  Agent:  ${commit.agent}`)

			const codingPhase = commit.modelsUsed?.find((m) => m.phase === "coding")
			if (codingPhase) {
				console.log(`  Actual: ${color("red", codingPhase.provider + "/" + codingPhase.model)}`)
			} else {
				console.log(`  Actual: ${color("red", "No coding phase recorded")}`)
			}
			console.log("")
		}
	}

	// Print detailed report if requested
	if (options.report) {
		console.log(color("cyan", "\n\n📋 Detailed Commit Report\n"))
		for (const commit of commits.slice(0, 10)) {
			// Limit to 10 for readability
			const compliance = checkCommitCompliance(commit)
			const statusIcon = compliance.isCompliant ? color("green", "✅") : color("red", "❌")

			console.log(`${statusIcon} ${color("bright", commit.commitSha)} - ${commit.title}`)
			console.log(`   Date: ${new Date(commit.timestamp).toLocaleString()}`)
			console.log(`   Agent: ${commit.agent}`)

			if (commit.modelsUsed?.length > 0) {
				console.log("   Models used:")
				for (const usage of commit.modelsUsed) {
					const keyInfo = usage.apiKeyLast4 ? `(key: ****${usage.apiKeyLast4})` : ""
					const fallback = usage.fallbackUsed ? color("yellow", " [FALLBACK]") : ""
					console.log(
						`     - ${usage.phase}: ${usage.provider}/${usage.model} ${keyInfo}${fallback}`
					)
				}
			} else {
				console.log(`   ${color("red", "No model usage recorded")}`)
			}

			if (compliance.issues.length > 0) {
				console.log(`   ${color("red", "Issues:")}`)
				for (const issue of compliance.issues) {
					console.log(`     - ${issue}`)
				}
			}

			if (compliance.warnings.length > 0) {
				console.log(`   ${color("yellow", "Warnings:")}`)
				for (const warning of compliance.warnings) {
					console.log(`     - ${warning}`)
				}
			}

			console.log("")
		}
	}

	// Check API key usage if requested
	if (options.verifyKey) {
		console.log(color("cyan", `\n🔑 API Key Verification (****${options.verifyKey})\n`))

		if (!usageLog || !usageLog.records) {
			console.log(color("yellow", "No usage log found."))
		} else {
			const matchingRecords = usageLog.records.filter((r) => r.apiKeyLast4 === options.verifyKey)

			if (matchingRecords.length === 0) {
				console.log(color("red", `❌ API key ending in ${options.verifyKey} was NOT used`))
			} else {
				console.log(
					color("green", `✅ API key ending in ${options.verifyKey} WAS used ${matchingRecords.length} times`)
				)
				console.log("\nUsage breakdown:")

				const byProvider = {}
				for (const record of matchingRecords) {
					byProvider[record.provider] = (byProvider[record.provider] || 0) + 1
				}

				for (const [provider, count] of Object.entries(byProvider)) {
					console.log(`  - ${provider}: ${count} calls`)
				}

				const lastUsed = matchingRecords[matchingRecords.length - 1]
				console.log(`\nLast used: ${new Date(lastUsed.timestamp).toLocaleString()}`)
			}
		}
	}

	console.log(color("bright", "\n═══════════════════════════════════════════════════════════\n"))
}

// ── Main ───────────────────────────────────────────────────────────────────────

function parseArgs() {
	const args = process.argv.slice(2)
	const options = {
		since: null,
		commit: null,
		verifyKey: null,
		stats: false,
		report: false,
		deepseekOnly: false,
		fix: false,
	}

	for (let i = 0; i < args.length; i++) {
		switch (args[i]) {
			case "--since":
				options.since = args[++i]
				break
			case "--commit":
				options.commit = args[++i]
				break
			case "--verify-key":
				options.verifyKey = args[++i]
				break
			case "--stats":
				options.stats = true
				break
			case "--report":
				options.report = true
				break
			case "--deepseek-only":
				options.deepseekOnly = true
				break
			case "--fix":
				options.fix = true
				break
			case "--help":
			case "-h":
				showHelp()
				process.exit(0)
				break
			default:
				console.log(`Unknown option: ${args[i]}`)
				showHelp()
				process.exit(1)
		}
	}

	return options
}

function showHelp() {
	console.log(`
Workflow Compliance Checker

Usage: node scripts/check-workflow-compliance.mjs [options]

Options:
  --since <date>       Check commits since date (e.g., "1 day ago", "2026-05-17")
  --commit <sha>       Check specific commit
  --verify-key <last4> Verify if specific API key was used
  --stats              Show workflow statistics (default)
  --report             Generate detailed compliance report
  --deepseek-only      Show only tasks that skipped DeepSeek
  --fix                Attempt to fix non-compliant records
  --help, -h           Show this help message

Examples:
  # Check all commits
  node scripts/check-workflow-compliance.mjs

  # Check commits from last 24 hours
  node scripts/check-workflow-compliance.mjs --since "1 day ago"

  # Verify a specific API key was used
  node scripts/check-workflow-compliance.mjs --verify-key ab12

  # Detailed report for recent commits
  node scripts/check-workflow-compliance.mjs --since "3 days ago" --report
`)
}

async function main() {
	const options = parseArgs()

	// Default to stats if no specific option given
	if (!options.stats && !options.report && !options.verifyKey && !options.deepseekOnly) {
		options.stats = true
	}

	try {
		await generateReport(options)
	} catch (err) {
		console.error(color("red", "Error:"), err.message)
		process.exit(1)
	}
}

main()
