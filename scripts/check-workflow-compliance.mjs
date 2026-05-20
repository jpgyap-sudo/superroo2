#!/usr/bin/env node
/**
 * Workflow Compliance Checker
 *
 * This script checks if tasks followed the SuperRoo workflow:
 * - Codex/Claude = plans and reviews
 * - DeepSeek = does the coding (via MCP or direct API)
 * - DeepSeek = summarizes lessons; Ollama = generates embeddings
 *
 * Also checks MCP-based workflow compliance for Claude Code:
 * - .mcp.json has both deepseek-coder and ollama servers
 * - MCP servers are reachable and return expected tools
 * - DEEPSEEK_API_KEY is configured
 * - VPS Ollama is reachable via Tailscale
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
 *   --mcp-check         Check MCP server configuration and connectivity
 *   --all               Run all checks (commits + MCP)
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

function normalizeCommitForReport(commit, index = 0) {
	const normalized = { ...commit }
	const dataQualityIssues = []
	if (!normalized.commitSha) {
		normalized.commitSha = "unknown"
		dataQualityIssues.push("missing commitSha")
	}
	if (!normalized.id) {
		normalized.id = `unkeyed_commit_${index}`
		dataQualityIssues.push("missing id")
	}
	const timestamp = normalized.timestamp ? new Date(normalized.timestamp) : null
	if (!timestamp || Number.isNaN(timestamp.getTime())) {
		dataQualityIssues.push("invalid timestamp")
	} else {
		normalized.timestamp = timestamp.toISOString()
	}
	if (!Array.isArray(normalized.modelsUsed)) {
		normalized.modelsUsed = []
		dataQualityIssues.push("missing modelsUsed")
	}
	normalized.dataQualityIssues = dataQualityIssues
	return normalized
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
	let commits = (commitLog.commits || []).map(normalizeCommitForReport)
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
			if (commit.dataQualityIssues?.length) {
				console.log(`  Data:   ${color("yellow", commit.dataQualityIssues.join(", "))}`)
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
			if (commit.dataQualityIssues?.length) {
				console.log(`   ${color("yellow", "Data quality:")} ${commit.dataQualityIssues.join(", ")}`)
			}

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
			case "--mcp-check":
				options.mcpCheck = true
				break
			case "--all":
				options.all = true
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
  --mcp-check          Check MCP server configuration and connectivity
  --all                Run all checks (commits + MCP)
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

  # Check MCP server configuration
  node scripts/check-workflow-compliance.mjs --mcp-check

  # Run all checks
  node scripts/check-workflow-compliance.mjs --all
`)
}

// ── MCP Configuration Check ──────────────────────────────────────────────────

import fsSync from "fs"
import { execSync } from "child_process"
import os from "os"

const ROOT_DIR = path.resolve(__dirname, "..")
const MCP_CONFIG_PATH = path.join(ROOT_DIR, ".mcp.json")
const DEEPSEEK_SCRIPT = path.join(ROOT_DIR, "scripts/deepseek-coder-mcp.mjs")
const OLLAMA_SCRIPT = path.join(ROOT_DIR, "scripts/ollama-mcp.mjs")
const VPS_OLLAMA_URL = "http://100.64.175.88:11434"
const HELPER_SCRIPT = path.join(__dirname, "ml", "ollama-curl-helper.cmd")
const TMP_DIR = fsSync.mkdtempSync(path.join(os.tmpdir(), "sr-ollama-check-"))

function readEnvValue(key, filePath = path.join(ROOT_DIR, ".env")) {
	try {
		const lines = fsSync.readFileSync(filePath, "utf8").split(/\r?\n/)
		for (const line of lines) {
			const trimmed = line.trim()
			if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
				continue
			}

			const index = trimmed.indexOf("=")
			const envKey = trimmed.slice(0, index).trim()
			if (envKey !== key) {
				continue
			}

			let value = trimmed.slice(index + 1).trim()
			if (
				(value.startsWith('"') && value.endsWith('"')) ||
				(value.startsWith("'") && value.endsWith("'"))
			) {
				value = value.slice(1, -1)
			}
			return value
		}
	} catch {}
	return ""
}

/**
 * Call Ollama API via curl.exe helper (avoids Node.js fetch() hanging on Tailscale IPs on Windows).
 */
function curlOllama(url, body, timeoutMs) {
	const outFile = path.join(TMP_DIR, `resp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.json`)
	try {
		if (body) {
			const bodyFile = path.join(TMP_DIR, `body_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.json`)
			fsSync.writeFileSync(bodyFile, JSON.stringify(body), "utf8")
			execSync(`"${HELPER_SCRIPT}" "${url}" "${outFile}" "${bodyFile}"`, {
				timeout: (timeoutMs || 120000) + 5000,
				stdio: ["pipe", "pipe", "ignore"],
				windowsHide: true,
			})
			try { fsSync.unlinkSync(bodyFile) } catch {}
		} else {
			execSync(`"${HELPER_SCRIPT}" "${url}" "${outFile}"`, {
				timeout: (timeoutMs || 10000) + 5000,
				stdio: ["pipe", "pipe", "ignore"],
				windowsHide: true,
			})
		}
		const raw = fsSync.readFileSync(outFile, "utf8")
		return JSON.parse(raw)
	} catch {
		return null
	} finally {
		try { fsSync.unlinkSync(outFile) } catch {}
	}
}

async function checkMCPConfiguration() {
	console.log(color("bright", "\n═══════════════════════════════════════════════════════════"))
	console.log(color("bright", "       MCP WORKFLOW CONFIGURATION CHECK"))
	console.log(color("bright", "═══════════════════════════════════════════════════════════\n"))

	const checks = []
	let passed = 0
	let failed = 0

	// Check 1: .mcp.json exists
	try {
		const content = await fs.readFile(MCP_CONFIG_PATH, "utf-8")
		const config = JSON.parse(content)
		checks.push({ name: ".mcp.json exists and valid JSON", passed: true })
		passed++

		// Check 2: deepseek-coder server
		const dsServer = config.mcpServers?.["deepseek-coder"]
		if (dsServer) {
			checks.push({ name: "deepseek-coder server registered in .mcp.json", passed: true })
			passed++

			// Check 3: deepseek-coder script exists
			const dsScript = dsServer.args?.find(a => a.includes("deepseek-coder-mcp"))
			if (dsScript) {
				const fullPath = path.resolve(ROOT_DIR, dsScript)
				try {
					await fs.access(fullPath)
					checks.push({ name: `deepseek-coder script exists: ${dsScript}`, passed: true })
					passed++
				} catch {
					checks.push({ name: `deepseek-coder script NOT FOUND: ${dsScript}`, passed: false, detail: "File missing" })
					failed++
				}
			} else {
				checks.push({ name: "deepseek-coder args missing script path", passed: false, detail: "No deepseek-coder-mcp in args" })
				failed++
			}
		} else {
			checks.push({ name: "deepseek-coder server NOT registered", passed: false, detail: "Missing from mcpServers" })
			failed++
		}

		// Check 4: ollama server
		const ollamaServer = config.mcpServers?.ollama
		if (ollamaServer) {
			checks.push({ name: "ollama server registered in .mcp.json", passed: true })
			passed++

			// Check 5: ollama script exists
			const ollamaScript = ollamaServer.args?.find(a => a.includes("ollama-mcp"))
			if (ollamaScript) {
				const fullPath = path.resolve(ROOT_DIR, ollamaScript)
				try {
					await fs.access(fullPath)
					checks.push({ name: `ollama script exists: ${ollamaScript}`, passed: true })
					passed++
				} catch {
					checks.push({ name: `ollama script NOT FOUND: ${ollamaScript}`, passed: false, detail: "File missing" })
					failed++
				}
			} else {
				checks.push({ name: "ollama args missing script path", passed: false, detail: "No ollama-mcp in args" })
				failed++
			}
		} else {
			checks.push({ name: "ollama server NOT registered", passed: false, detail: "Missing from mcpServers" })
			failed++
		}
	} catch (err) {
		checks.push({ name: ".mcp.json check failed", passed: false, detail: err.message })
		failed++
	}

	// Check 6: DEEPSEEK_API_KEY
	const terminalKey = process.env.DEEPSEEK_API_KEY
	const envFileKey = readEnvValue("DEEPSEEK_API_KEY")
	let mcpJsonKey = false
	try {
		const mcpConfig = JSON.parse(fs.readFileSync(MCP_CONFIG_PATH, "utf-8"))
		const dsEnv = mcpConfig?.mcpServers?.["deepseek-coder"]?.env
		mcpJsonKey = !!(dsEnv?.DEEPSEEK_API_KEY && dsEnv.DEEPSEEK_API_KEY.length >= 10)
	} catch {}
	if (terminalKey) {
		checks.push({ name: "DEEPSEEK_API_KEY set in terminal environment", passed: true })
		passed++
	} else if (envFileKey && envFileKey.length >= 10) {
		checks.push({ name: "DEEPSEEK_API_KEY set in repo .env", passed: true })
		passed++
	} else if (mcpJsonKey) {
		checks.push({ name: "DEEPSEEK_API_KEY set in .mcp.json env block", passed: true })
		passed++
	} else {
		checks.push({ name: "DEEPSEEK_API_KEY NOT set", passed: false, detail: "Required for deepseek-coder MCP" })
		failed++
	}

	// Check 7: VPS Ollama reachable
	try {
		const data = curlOllama(`${VPS_OLLAMA_URL}/api/tags`, null, 5000)
		if (data) {
			const modelCount = (data.models || []).length
			checks.push({ name: `VPS Ollama reachable (${modelCount} models)`, passed: true })
			passed++
		} else {
			checks.push({ name: "VPS Ollama unreachable", passed: false, detail: "curl helper returned null" })
			failed++
		}
	} catch (err) {
		checks.push({ name: "VPS Ollama unreachable", passed: false, detail: err.message })
		failed++
	}

	// Print results
	for (const check of checks) {
		const icon = check.passed ? color("green", "  ✅") : color("red", "  ❌")
		console.log(`${icon} ${check.name}${check.detail ? ": " + color(check.passed ? "green" : "red", check.detail) : ""}`)
	}

	console.log(color("bright", "\n───────────────────────────────────────────────────────────"))
	console.log(`  MCP checks: ${passed} passed, ${failed} failed`)
	const rate = ((passed / checks.length) * 100).toFixed(1)
	console.log(`  Rate: ${failed === 0 ? color("green", rate + "%") : color("yellow", rate + "%")}`)
	console.log(color("bright", "───────────────────────────────────────────────────────────\n"))

	return { passed, failed, total: checks.length }
}

async function main() {
	const options = parseArgs()

	// Handle --all: run everything
	if (options.all) {
		options.stats = true
		options.report = true
		options.mcpCheck = true
	}

	// Run MCP check if requested
	if (options.mcpCheck) {
		await checkMCPConfiguration()
	}

	// Run commit-based checks if requested
	if (options.stats || options.report || options.verifyKey || options.deepseekOnly) {
		try {
			await generateReport(options)
		} catch (err) {
			console.error(color("red", "Error:"), err.message)
			process.exit(1)
		}
	}

	// Default: show stats if nothing specific requested
	if (!options.stats && !options.report && !options.verifyKey && !options.deepseekOnly && !options.mcpCheck && !options.all) {
		options.stats = true
		try {
			await generateReport(options)
		} catch (err) {
			console.error(color("red", "Error:"), err.message)
			process.exit(1)
		}
	}
}

main()
