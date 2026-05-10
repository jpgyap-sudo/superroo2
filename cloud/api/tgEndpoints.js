/**
 * Telegram Backend Endpoints
 *
 * Real backend implementations for the 6 OpenClaw-style Telegram endpoints.
 * These are called by the telegramBot.js after intent classification and policy check.
 *
 * Endpoints (called internally, not HTTP):
 *   debugPlan(text, project)   — Creates a structured debug plan
 *   readLogs(target, lines)    — Reads PM2/Docker logs for a target
 *   runTests(project)          — Runs tests for a project
 *   createBranch(branch, base) — Creates a git branch
 *   createPr(title, body)      — Creates a GitHub PR
 *   restartWorker(name)        — Restarts a whitelisted PM2 worker
 *
 * @module tgEndpoints
 */

const { exec } = require("child_process")
const { promisify } = require("util")
const fs = require("fs").promises
const path = require("path")

const execAsync = promisify(exec)

// ─── Configuration ──────────────────────────────────────────────────────────

/** Whitelist of PM2 workers that can be restarted via Telegram */
const ALLOWED_WORKERS = [
	"superroo-api",
	"superroo-worker",
	"superroo-worker-2",
	"superroo-worker-3",
	"superroo-worker-4",
	"superroo-worker-5",
	"superroo-worker-6",
	"superroo-worker-7",
	"superroo-worker-8",
	"superroo-worker-9",
	"superroo-worker-10",
]

/** Base directory for project repos */
const PROJECTS_BASE = process.env.PROJECTS_BASE || "/opt/superroo2"

/** GitHub token for PR creation */
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || ""

/** Default number of log lines to fetch */
const DEFAULT_LOG_LINES = 30

// ─── Helper ─────────────────────────────────────────────────────────────────

/**
 * Runs a shell command and returns stdout + stderr.
 * @param {string} cmd
 * @param {string} [cwd]
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
async function run(cmd, cwd) {
	const opts = { maxBuffer: 1024 * 1024 }
	if (cwd) opts.cwd = cwd
	const result = await execAsync(cmd, opts)
	return { stdout: result.stdout.trim(), stderr: result.stderr.trim() }
}

/**
 * Resolves the project directory from a project name.
 * @param {string} projectName
 * @returns {string} Full path to project
 */
function resolveProjectDir(projectName) {
	if (!projectName) return PROJECTS_BASE
	return path.join(PROJECTS_BASE, projectName)
}

// ─── Endpoint Implementations ───────────────────────────────────────────────

/**
 * Creates a structured debug plan for a given issue description.
 *
 * @param {string} text - The issue/bug description
 * @param {string} [project] - Optional project name
 * @returns {Promise<Object>} { incidentId, phases, project }
 */
async function debugPlan(text, project) {
	const incidentId = "DBG-" + Date.now().toString(36).toUpperCase()
	const projectDir = resolveProjectDir(project)

	// Build phases based on common debugging steps
	const phases = [
		"Reproduce the issue: " + text.slice(0, 100),
		"Check recent logs and error traces",
		"Identify root cause from logs and code",
		"Implement fix with tests",
		"Run full test suite to verify no regressions",
		"Create PR with fix description",
	]

	// Try to get recent git log for context
	try {
		const gitLog = await run("git log --oneline -10", projectDir)
		if (gitLog.stdout) {
			phases.splice(1, 0, "Review recent commits:\n```\n" + gitLog.stdout.slice(0, 500) + "\n```")
		}
	} catch (e) {
		// Not a git repo or no access — skip
	}

	return {
		incidentId,
		phases,
		project: project || "default",
		createdAt: new Date().toISOString(),
	}
}

/**
 * Reads logs for a target (PM2 worker or Docker container).
 *
 * @param {string} target - Worker name or "docker"
 * @param {number} [lines] - Number of lines to fetch
 * @returns {Promise<Object>} { logs, target, source }
 */
async function readLogs(target, lines) {
	const numLines = lines || DEFAULT_LOG_LINES
	const result = { logs: [], target: target || "all", source: "" }

	if (!target || target === "all") {
		// Read PM2 logs for all workers
		try {
			const pm2Logs = await run("pm2 jlist --nostream")
			const processes = JSON.parse(pm2Logs.stdout)
			for (const proc of processes) {
				const procName = proc.name
				if (proc.pm2_env && proc.pm2_env.pm_log_path) {
					try {
						const logData = await run("tail -" + numLines + " " + proc.pm2_env.pm_log_path)
						if (logData.stdout) {
							result.logs.push("--- " + procName + " ---")
							const lines_arr = logData.stdout.split("\n")
							for (let i = 0; i < lines_arr.length; i++) {
								result.logs.push(lines_arr[i])
							}
						}
					} catch (e) {
						result.logs.push("--- " + procName + " (no log file) ---")
					}
				}
			}
			result.source = "pm2"
		} catch (e) {
			result.logs.push("Failed to read PM2 logs: " + e.message)
		}
	} else if (target === "docker") {
		// Read Docker container logs
		try {
			const dockerLogs = await run("docker logs --tail " + numLines + " $(docker ps -q)")
			if (dockerLogs.stdout) {
				result.logs = dockerLogs.stdout.split("\n")
			}
			result.source = "docker"
		} catch (e) {
			result.logs.push("Failed to read Docker logs: " + e.message)
		}
	} else {
		// Read PM2 logs for a specific worker
		try {
			const pm2Logs = await run("pm2 show " + target)
			// Try to find the log path from pm2 show output
			const logPathMatch = pm2Logs.stdout.match(/out log path\s+([^\n]+)/)
			const errPathMatch = pm2Logs.stdout.match(/error log path\s+([^\n]+)/)

			if (logPathMatch) {
				const logData = await run("tail -" + numLines + " " + logPathMatch[1].trim())
				if (logData.stdout) {
					result.logs.push("--- stdout ---")
					const lines_arr = logData.stdout.split("\n")
					for (let i = 0; i < lines_arr.length; i++) {
						result.logs.push(lines_arr[i])
					}
				}
			}
			if (errPathMatch) {
				const errData = await run("tail -" + numLines + " " + errPathMatch[1].trim())
				if (errData.stdout) {
					result.logs.push("--- stderr ---")
					const lines_arr = errData.stdout.split("\n")
					for (let i = 0; i < lines_arr.length; i++) {
						result.logs.push(lines_arr[i])
					}
				}
			}
			result.source = "pm2:" + target
		} catch (e) {
			result.logs.push("Failed to read logs for '" + target + "': " + e.message)
		}
	}

	return result
}

/**
 * Runs tests for a project.
 *
 * @param {string} project - Project name
 * @returns {Promise<Object>} { passed, command, summary, output }
 */
async function runTests(project) {
	const projectDir = resolveProjectDir(project)
	const result = { passed: false, command: "", summary: "", output: "" }

	// Try multiple test commands in order of preference
	const testCommands = [
		{ cmd: "npx vitest run --reporter=verbose 2>&1", name: "vitest" },
		{ cmd: "npm test 2>&1", name: "npm test" },
		{ cmd: "pnpm test 2>&1", name: "pnpm test" },
	]

	for (const tc of testCommands) {
		try {
			result.command = tc.cmd
			const testResult = await run(tc.cmd, projectDir)
			result.output = testResult.stdout || testResult.stderr

			// Check for pass/fail indicators
			const passed =
				!result.output.includes("FAIL") &&
				!result.output.includes("failed") &&
				(result.output.includes("PASS") ||
					result.output.includes("passed") ||
					result.output.includes("Tests:")) &&
				!result.output.includes("Tests:.*failed")

			// More precise check: look for test summary line
			const summaryMatch = result.output.match(/(Tests:\s+\d+.*)/)
			if (summaryMatch) {
				result.summary = summaryMatch[1]
			}

			// Check if vitest exit code was 0
			if (result.output.includes("Tests ") && !result.output.includes("failed")) {
				result.passed = true
			} else if (result.output.includes("Tests ") && result.output.includes("failed")) {
				result.passed = false
			} else {
				result.passed = passed
			}

			// Truncate output for Telegram
			if (result.output.length > 1500) {
				result.output = result.output.slice(0, 1497) + "..."
			}

			return result
		} catch (e) {
			// Command failed — capture output and try next
			result.output = e.message || "Command failed"
			continue
		}
	}

	// All commands failed
	result.output = "No test runner found. Tried: " + testCommands.map((t) => t.name).join(", ")
	return result
}

/**
 * Creates a git branch.
 *
 * @param {string} branchName - Name of the branch to create
 * @param {string} [baseBranch] - Base branch (default: main)
 * @param {string} [project] - Project name
 * @returns {Promise<Object>} { branch, baseBranch, project }
 */
async function createBranch(branchName, baseBranch, project) {
	const base = baseBranch || "main"
	const projectDir = resolveProjectDir(project)

	try {
		// Fetch latest
		await run("git fetch origin " + base, projectDir).catch(() => {})

		// Create branch from base
		await run("git checkout " + base, projectDir)
		await run("git pull origin " + base, projectDir)
		await run("git checkout -b " + branchName, projectDir)

		return {
			branch: branchName,
			baseBranch: base,
			project: project || "default",
			status: "created",
		}
	} catch (e) {
		return {
			branch: branchName,
			baseBranch: base,
			project: project || "default",
			status: "error",
			error: e.message,
		}
	}
}

/**
 * Creates a GitHub Pull Request.
 *
 * @param {string} title - PR title
 * @param {string} [body] - PR body/description
 * @param {string} [project] - Project name
 * @param {string} [headBranch] - Head branch (default: current branch)
 * @param {string} [baseBranch] - Base branch (default: main)
 * @returns {Promise<Object>} { prUrl, prNumber, title }
 */
async function createPr(title, body, project, headBranch, baseBranch) {
	const base = baseBranch || "main"
	const projectDir = resolveProjectDir(project)

	try {
		// Get current branch if not specified
		let branch = headBranch
		if (!branch) {
			const branchResult = await run("git rev-parse --abbrev-ref HEAD", projectDir)
			branch = branchResult.stdout
		}

		// Push branch
		await run("git push origin " + branch, projectDir)

		// Get remote URL to extract owner/repo
		const remoteResult = await run("git config --get remote.origin.url", projectDir)
		const remoteUrl = remoteResult.stdout

		// Parse owner/repo from git remote URL
		let owner = ""
		let repo = ""
		const httpsMatch = remoteUrl.match(/github\.com\/([^\/]+)\/([^\/\.]+)/)
		const sshMatch = remoteUrl.match(/git@github\.com:([^\/]+)\/([^\/\.]+)/)

		if (httpsMatch) {
			owner = httpsMatch[1]
			repo = httpsMatch[2]
		} else if (sshMatch) {
			owner = sshMatch[1]
			repo = sshMatch[2]
		}

		if (!owner || !repo) {
			return {
				prUrl: "",
				prNumber: 0,
				title: title,
				status: "error",
				error: "Could not parse GitHub remote URL: " + remoteUrl,
			}
		}

		// Create PR via GitHub API
		const prBody = body || "Automated PR created via Telegram assistant."
		const ghResponse = await fetch("https://api.github.com/repos/" + owner + "/" + repo + "/pulls", {
			method: "POST",
			headers: {
				Authorization: "Bearer " + GITHUB_TOKEN,
				"Content-Type": "application/json",
				Accept: "application/vnd.github.v3+json",
			},
			body: JSON.stringify({
				title: title,
				body: prBody,
				head: branch,
				base: base,
			}),
		})

		if (!ghResponse.ok) {
			const ghError = await ghResponse.text()
			return {
				prUrl: "",
				prNumber: 0,
				title: title,
				status: "error",
				error: "GitHub API error: " + ghResponse.status + " " + ghError.slice(0, 200),
			}
		}

		const prData = await ghResponse.json()
		return {
			prUrl: prData.html_url,
			prNumber: prData.number,
			title: prData.title,
			status: "created",
		}
	} catch (e) {
		return {
			prUrl: "",
			prNumber: 0,
			title: title,
			status: "error",
			error: e.message,
		}
	}
}

/**
 * Restarts a whitelisted PM2 worker.
 *
 * @param {string} workerName - Name of the PM2 worker to restart
 * @returns {Promise<Object>} { ok, restarted, message }
 */
async function restartWorker(workerName) {
	// Validate worker is in whitelist
	const normalizedWorker = workerName.toLowerCase()
	const matched = ALLOWED_WORKERS.find(function (w) {
		return w.toLowerCase() === normalizedWorker
	})

	if (!matched) {
		return {
			ok: false,
			restarted: workerName,
			message:
				"Worker '" +
				workerName +
				"' is not in the restart whitelist.\n\nAllowed workers:\n" +
				ALLOWED_WORKERS.map(function (w) {
					return "• `" + w + "`"
				}).join("\n"),
		}
	}

	try {
		await run("pm2 restart " + matched)
		// Wait a moment and verify it's running
		await new Promise(function (resolve) {
			return setTimeout(resolve, 2000)
		})
		const status = await run("pm2 show " + matched)
		const isOnline = status.stdout.includes("online")

		return {
			ok: isOnline,
			restarted: matched,
			message: isOnline
				? "Worker `" + matched + "` restarted successfully and is now online."
				: "Worker `" + matched + "` restarted but may not be online yet. Check status with `/status`.",
		}
	} catch (e) {
		return {
			ok: false,
			restarted: matched,
			message: "Failed to restart `" + matched + "`: " + e.message,
		}
	}
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
	debugPlan,
	readLogs,
	runTests,
	createBranch,
	createPr,
	restartWorker,
}
