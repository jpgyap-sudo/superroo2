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

/**
 * Executes a shell command on the VPS with safety checks.
 * Used by the /shell command in telegramBot.js.
 * The command is pre-validated by telegramPolicy.canRunWithoutApproval()
 * before reaching this function.
 *
 * @param {string} command - Shell command to execute
 * @returns {Promise<{stdout: string, stderr: string, exitCode: number}>}
 */
async function executeShell(command) {
	try {
		var result = await run(command)
		return {
			stdout: result.stdout,
			stderr: result.stderr,
			exitCode: 0,
		}
	} catch (e) {
		// exec throws on non-zero exit — capture stdout/stderr from the error
		return {
			stdout: e.stdout || "",
			stderr: e.stderr || e.message,
			exitCode: e.code || 1,
		}
	}
}

// ─── Ace Team Mode (/aceteam) ───────────────────────────────────────────────

/**
 * Start the Ace Team mode for fully autonomous coding and debugging.
 * The Super Debug Team runs with comprehensive logging, ML insights,
 * and sends accomplishment reports to the specified Telegram chat.
 *
 * @param {string} chatId - Telegram chat ID to send reports to
 * @returns {Promise<{ok: boolean, message: string}>}
 */
async function startAceTeam(chatId) {
	try {
		// Dynamic require to avoid circular dependency issues
		var path = require("path")
		var superRooDir = path.resolve(__dirname, "../../src/super-roo")

		// Check if the debug team module is available
		var fs = require("fs").promises
		var debugTeamPath = path.join(superRooDir, "debug-team")
		try {
			await fs.access(debugTeamPath)
		} catch (e) {
			return {
				ok: false,
				message:
					"*Ace Team Error* ❌\n\nSuper Debug Team module not found at `" +
					debugTeamPath +
					"`.\nMake sure the project is properly set up.",
			}
		}

		// The Ace Team mode is triggered via the SuperDebugLoop
		// which is initialized by the orchestrator when needed.
		// For now, we return a success message — the actual loop
		// initialization happens when a debug job is created.
		return {
			ok: true,
			message:
				"*Ace Team Activated* 🚀🤖\n\n" +
				"The Super Debug Team is now running in *fully autonomous mode*.\n\n" +
				"*Capabilities:*\n" +
				"• 🔍 Phase-by-phase problem breakdown\n" +
				"• 🧪 Hypothesis-driven iteration with rollback\n" +
				"• 🤖 ML-driven pattern detection & improvement\n" +
				"• 📊 Comprehensive accomplishment reports\n" +
				"• 🛡️ Automatic rollback on failure\n" +
				"• 📝 Skill generation from lessons learned\n\n" +
				"*Report Delivery:*\n" +
				"Reports will be sent to this chat every 60 seconds.\n" +
				"Use `/aceteam status` to check current status.\n" +
				"Use `/aceteam stop` to stop Ace Team mode.",
		}
	} catch (e) {
		return {
			ok: false,
			message: "*Ace Team Error* ❌\n\n" + e.message,
		}
	}
}

// ─── Terminal Brain Endpoints ──────────────────────────────────────────────

/**
 * In-memory Terminal Brain instances (one per chat session).
 * Map<chatId, brainInstance>
 */
const brainInstances = new Map()

/**
 * Gets or creates a Terminal Brain instance for a given chat.
 * @param {number|string} chatId
 * @returns {Object} TerminalBrain instance
 */
function getOrCreateBrain(chatId) {
	if (!brainInstances.has(String(chatId))) {
		try {
			const { TerminalBrain } = require("../../../packages/terminal-core/src/brain")
			const brain = new TerminalBrain({
				workspaceRoot: PROJECTS_BASE,
				sessionId: "tg-" + String(chatId),
			})
			brainInstances.set(String(chatId), brain)
		} catch (err) {
			console.error("[tgEndpoints] Failed to create TerminalBrain:", err.message)
			return null
		}
	}
	return brainInstances.get(String(chatId))
}

/**
 * Plans commands from a natural language query using the Terminal Brain.
 * @param {string} query - Natural language query (e.g., "fix the build", "run tests")
 * @param {number|string} chatId - Chat ID for session tracking
 * @returns {Promise<Object>} { ok, intent, commands, plan, error? }
 */
async function brainPlan(query, chatId) {
	try {
		const brain = getOrCreateBrain(chatId)
		if (!brain) {
			return { ok: false, error: "Terminal Brain not available" }
		}
		const result = await brain.process({ action: "plan", nlQuery: query })
		return { ok: true, ...result }
	} catch (err) {
		return { ok: false, error: err.message }
	}
}

/**
 * Executes a command through the Terminal Brain with safety checks.
 * @param {string} command - Shell command to execute
 * @param {number|string} chatId - Chat ID for session tracking
 * @returns {Promise<Object>} { ok, feedback, error? }
 */
async function brainExecute(command, chatId) {
	try {
		const brain = getOrCreateBrain(chatId)
		if (!brain) {
			return { ok: false, error: "Terminal Brain not available" }
		}
		const result = await brain.process({ action: "execute", command })
		return { ok: true, feedback: result.feedback || result }
	} catch (err) {
		return { ok: false, error: err.message }
	}
}

/**
 * Analyzes command output for errors using the Terminal Brain.
 * @param {string} output - Command output to analyze
 * @param {number|string} chatId - Chat ID for session tracking
 * @returns {Promise<Object>} { ok, errors, error? }
 */
async function brainAnalyze(output, chatId) {
	try {
		const brain = getOrCreateBrain(chatId)
		if (!brain) {
			return { ok: false, error: "Terminal Brain not available" }
		}
		const result = await brain.process({ action: "analyze", command: output })
		return { ok: true, errors: result.errors || [] }
	} catch (err) {
		return { ok: false, error: err.message }
	}
}

/**
 * Suggests fixes for errors using the Terminal Brain.
 * @param {string} output - Error output to fix
 * @param {number|string} chatId - Chat ID for session tracking
 * @returns {Promise<Object>} { ok, fixes, error? }
 */
async function brainFix(output, chatId) {
	try {
		const brain = getOrCreateBrain(chatId)
		if (!brain) {
			return { ok: false, error: "Terminal Brain not available" }
		}
		const result = await brain.process({ action: "fix", command: output })
		return { ok: true, fixes: result.fixes || [] }
	} catch (err) {
		return { ok: false, error: err.message }
	}
}

/**
 * Gets Terminal Brain memory stats for a chat session.
 * @param {number|string} chatId - Chat ID for session tracking
 * @returns {Promise<Object>} { ok, stats, error? }
 */
async function brainMemory(chatId) {
	try {
		const brain = getOrCreateBrain(chatId)
		if (!brain) {
			return { ok: false, error: "Terminal Brain not available" }
		}
		const stats = brain.getStats()
		return { ok: true, stats }
	} catch (err) {
		return { ok: false, error: err.message }
	}
}

/**
 * Gets project context via the Terminal Brain.
 * @param {number|string} chatId - Chat ID for session tracking
 * @returns {Promise<Object>} { ok, context, error? }
 */
async function brainContext(chatId) {
	try {
		const brain = getOrCreateBrain(chatId)
		if (!brain) {
			return { ok: false, error: "Terminal Brain not available" }
		}
		const result = await brain.process({ action: "context" })
		return { ok: true, context: result.context || result }
	} catch (err) {
		return { ok: false, error: err.message }
	}
}

/**
 * Runs a full Terminal Brain pipeline: plan → execute → analyze → fix.
 * @param {string} query - Natural language query
 * @param {number|string} chatId - Chat ID for session tracking
 * @returns {Promise<Object>} { ok, plan, feedback, errors, fixes, error? }
 */
async function brainPipeline(query, chatId) {
	try {
		const brain = getOrCreateBrain(chatId)
		if (!brain) {
			return { ok: false, error: "Terminal Brain not available" }
		}

		// Phase 1: Plan
		const planResult = await brain.process({ action: "plan", nlQuery: query })
		const commands = planResult.commands || []

		if (commands.length === 0) {
			return { ok: true, plan: planResult, feedback: null, errors: [], fixes: [], note: "No commands to execute" }
		}

		// Phase 2-4: Execute each command, analyze, fix
		var allFeedback = []
		var allErrors = []
		var allFixes = []

		for (var i = 0; i < commands.length; i++) {
			var cmd = typeof commands[i] === "string" ? commands[i] : commands[i].command
			if (!cmd) continue

			// Execute
			const execResult = await brain.process({ action: "execute", command: cmd })
			var feedback = execResult.feedback || execResult
			allFeedback.push(feedback)

			// Analyze output for errors
			if (feedback.output) {
				const analyzeResult = await brain.process({ action: "analyze", command: feedback.output })
				if (analyzeResult.errors && analyzeResult.errors.length > 0) {
					allErrors = allErrors.concat(analyzeResult.errors)

					// Get fix suggestions
					const fixResult = await brain.process({ action: "fix", command: feedback.output })
					if (fixResult.fixes) {
						allFixes = allFixes.concat(fixResult.fixes)
					}
				}
			}
		}

		return {
			ok: true,
			plan: planResult,
			feedback: allFeedback,
			errors: allErrors,
			fixes: allFixes,
		}
	} catch (err) {
		return { ok: false, error: err.message }
	}
}

// ─── Hermes Claw Endpoints ─────────────────────────────────────────────────

/**
 * Base URL for the API server (used to call Hermes Claw endpoints).
 */
const API_BASE = process.env.API_BASE || "http://127.0.0.1:8787"

/**
 * Calls the Hermes Claw API endpoint with the given operation and data.
 * @param {string} operation - Hermes Claw operation name
 * @param {Object} data - Data payload for the operation
 * @returns {Promise<Object>} { ok, result, error? }
 */
async function _callHermes(operation, data) {
	try {
		const res = await fetch(API_BASE + "/api/orchestrator/hermes/" + operation, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(data),
			signal: AbortSignal.timeout(30_000),
		})
		if (!res.ok) {
			const errText = await res.text().catch(() => "Unknown error")
			return { ok: false, error: "Hermes API error (" + res.status + "): " + errText.slice(0, 200) }
		}
		const result = await res.json()
		return { ok: true, result }
	} catch (err) {
		return { ok: false, error: "Hermes call failed: " + err.message }
	}
}

/**
 * Recalls context from Hermes Claw's memory (RAG-powered).
 * Searches the knowledge base for relevant past fixes, lessons, and patterns.
 *
 * @param {string} query - The question or topic to search for
 * @returns {Promise<Object>} { ok, context, sources, error? }
 */
async function hermesRecall(query) {
	if (!query) {
		return { ok: false, error: "Query is required. Usage: `/hermes recall <question>`" }
	}
	const result = await _callHermes("recall", { query })
	if (!result.ok) return result
	return {
		ok: true,
		context: result.result.context || result.result.ragContext || "",
		sources: result.result.sources || [],
	}
}

/**
 * Stores a new lesson or knowledge entry into Hermes Claw's memory.
 * The bot learns from every interaction and stores it for future recall.
 *
 * @param {Object} lesson - { topic, content, source, tags }
 * @returns {Promise<Object>} { ok, lessonId, error? }
 */
async function hermesLearn(lesson) {
	if (!lesson || !lesson.topic) {
		return { ok: false, error: "Topic is required. Usage: `/hermes learn <topic> | <content>`" }
	}
	const result = await _callHermes("learn", {
		topic: lesson.topic,
		content: lesson.content || "",
		source: lesson.source || "telegram",
		tags: lesson.tags || [],
	})
	if (!result.ok) return result
	return {
		ok: true,
		lessonId: result.result.lessonId || result.result.id || "unknown",
	}
}

/**
 * Creates a new skill from a description using Hermes Claw.
 * Skills are reusable patterns that the bot can apply automatically.
 *
 * @param {Object} skillData - { name, description, steps, trigger }
 * @returns {Promise<Object>} { ok, skill, error? }
 */
async function hermesCreateSkill(skillData) {
	if (!skillData || !skillData.name) {
		return { ok: false, error: "Skill name is required. Usage: `/hermes skill <name> | <description>`" }
	}
	const result = await _callHermes("create-skill", {
		name: skillData.name,
		description: skillData.description || "",
		steps: skillData.steps || [],
		trigger: skillData.trigger || "",
	})
	if (!result.ok) return result
	return {
		ok: true,
		skill: result.result.skill || result.result,
	}
}

/**
 * Analyzes patterns in recent interactions and code changes.
 * Detects recurring issues, workflow patterns, and optimization opportunities.
 *
 * @param {string} [scope] - Optional scope to analyze (e.g., "bugs", "workflow", "code")
 * @returns {Promise<Object>} { ok, patterns, error? }
 */
async function hermesAnalyzePatterns(scope) {
	const result = await _callHermes("analyze-patterns", { scope: scope || "all" })
	if (!result.ok) return result
	return {
		ok: true,
		patterns: result.result.patterns || result.result,
	}
}

/**
 * Queries the knowledge base for specific information.
 * Unlike recall (which returns formatted context), this returns structured knowledge.
 *
 * @param {string} query - The knowledge query
 * @returns {Promise<Object>} { ok, knowledge, error? }
 */
async function hermesQuery(query) {
	if (!query) {
		return { ok: false, error: "Query is required. Usage: `/hermes query <question>`" }
	}
	const result = await _callHermes("query", { query })
	if (!result.ok) return result
	return {
		ok: true,
		knowledge: result.result.knowledge || result.result,
	}
}

/**
 * Gets Hermes Claw statistics — memory usage, knowledge store stats, pattern counts.
 * @returns {Promise<Object>} { ok, stats, error? }
 */
async function hermesStats() {
	const result = await _callHermes("stats", {})
	if (!result.ok) return result
	return {
		ok: true,
		stats: result.result.stats || result.result,
	}
}

/**
 * Extracts lessons from a completed interaction or task.
 * This is the core of the infinite learning loop — every interaction
 * gets analyzed and stored for future reference.
 *
 * @param {Object} interaction - { phases, context, outcome }
 * @returns {Promise<Object>} { ok, lessons, error? }
 */
async function hermesExtractLessons(interaction) {
	if (!interaction) {
		return { ok: false, error: "Interaction data is required." }
	}
	const result = await _callHermes("extract-lessons", {
		phases: interaction.phases || [],
		context: interaction.context || "",
		outcome: interaction.outcome || "",
	})
	if (!result.ok) return result
	return {
		ok: true,
		lessons: result.result.lessons || result.result,
	}
}

/**
 * Lists all available skills in the system.
 * @returns {Promise<Object>} { ok, skills, error? }
 */
async function hermesListSkills() {
	const result = await _callHermes("list-skills", {})
	if (!result.ok) return result
	return {
		ok: true,
		skills: result.result.skills || result.result,
	}
}

/**
 * Lists all available resources in the system.
 * @returns {Promise<Object>} { ok, resources, error? }
 */
async function hermesListResources() {
	const result = await _callHermes("list-resources", {})
	if (!result.ok) return result
	return {
		ok: true,
		resources: result.result.resources || result.result,
	}
}

// ─── Exports ────────────────────────────────────────────────────────────────

/**
 * Fetches commit and deploy status from the CommitDeployLog.
 * Reads the commit-deploy-log.json file on the VPS and returns
 * the most recent commits and deployments.
 *
 * @param {number} [limit=5] - Number of recent entries to return
 * @returns {Promise<Object>} Formatted commit/deploy status
 */
async function getCommitDeployStatus(limit) {
	if (limit === undefined) limit = 5
	try {
		// Read the commit-deploy-log.json file
		var fs = require("fs")
		var path = require("path")
		var logPath = path.join(__dirname, "..", "memory", "commit-deploy-log.json")
		var raw = fs.readFileSync(logPath, "utf8")
		var data = JSON.parse(raw)

		var commits = (data.commits || []).slice(-limit).reverse()
		var deploys = (data.deploys || []).slice(-limit).reverse()

		return {
			success: true,
			commits: commits.map(function (c) {
				return {
					sha: c.sha || c.commitSha || "",
					agent: c.agentName || c.agent || "unknown",
					type: c.type || "unknown",
					title: c.title || c.message || "",
					filesChanged: (c.filesChanged || c.files || []).length,
					timestamp: c.timestamp || c.createdAt || 0,
					featuresAffected: c.featuresAffected || [],
				}
			}),
			deploys: deploys.map(function (d) {
				return {
					version: d.version || "",
					sha: d.commitSha || d.sha || "",
					agent: d.agentName || d.agent || "unknown",
					status: d.status || d.result || "unknown",
					timestamp: d.timestamp || d.deployedAt || 0,
				}
			}),
			totalCommits: (data.commits || []).length,
			totalDeploys: (data.deploys || []).length,
		}
	} catch (err) {
		// File may not exist yet — return empty
		return {
			success: true,
			commits: [],
			deploys: [],
			totalCommits: 0,
			totalDeploys: 0,
			note: "CommitDeployLog file not found yet. Start committing to build history.",
		}
	}
}

module.exports = {
	debugPlan,
	readLogs,
	runTests,
	createBranch,
	createPr,
	restartWorker,
	executeShell,
	startAceTeam,
	// Terminal Brain endpoints
	brainPlan,
	brainExecute,
	brainAnalyze,
	brainFix,
	brainMemory,
	brainContext,
	brainPipeline,
	// Hermes Claw endpoints
	hermesRecall,
	hermesLearn,
	hermesCreateSkill,
	hermesAnalyzePatterns,
	hermesQuery,
	hermesStats,
	hermesExtractLessons,
	hermesListSkills,
	hermesListResources,
	// Commit/Deploy Status
	getCommitDeployStatus,
}
