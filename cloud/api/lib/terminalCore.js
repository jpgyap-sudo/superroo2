/**
 * Terminal Core — Self-contained CJS runtime for the cloud API.
 *
 * Provides TerminalBrain and loadTerminalCore without depending on
 * @superroo/terminal-core (which is ESM-only with cross-package TS imports
 * that cannot be resolved from the cloud CJS runtime).
 *
 * The @superroo/terminal-core package remains the canonical TypeScript source
 * for the monorepo's TS runtime. This file is the cloud-specific CJS adapter.
 */

const { exec } = require("child_process")
const { promisify } = require("util")
const path = require("path")

const execAsync = promisify(exec)

class TerminalBrain {
	constructor(opts = {}) {
		this.workspaceRoot = opts.workspaceRoot || process.cwd()
		this.sessionId = opts.sessionId || `session-${Date.now()}`
		this.context = null
	}

	async process(request) {
		const { action, nlQuery, command } = request || {}

		switch (action) {
			case "plan":
				return this._plan(nlQuery)
			case "execute":
				return this._execute(command)
			case "analyze":
				return this._analyze(command)
			case "fix":
				return this._fix(command)
			case "context":
				return this._getContext()
			default:
				return { ok: false, error: `Unknown action: ${action}` }
		}
	}

	getStats() {
		return {
			sessionId: this.sessionId,
			workspaceRoot: this.workspaceRoot,
			memorySize: 0,
			commandCount: 0,
		}
	}

	async _plan(nlQuery) {
		if (!nlQuery) {
			return { ok: false, error: "No query provided" }
		}

		// Simple intent detection from natural language
		const lower = nlQuery.toLowerCase()
		let intent = "unknown"
		let commands = []

		if (lower.includes("test") || lower.includes("run test")) {
			intent = "test"
			commands = [{ command: `cd "${this.workspaceRoot}" && npm test 2>&1`, description: "Run tests" }]
		} else if (lower.includes("build") || lower.includes("compile")) {
			intent = "build"
			commands = [{ command: `cd "${this.workspaceRoot}" && npm run build 2>&1`, description: "Run build" }]
		} else if (lower.includes("deploy") || lower.includes("release")) {
			intent = "deploy"
			commands = [{ command: `cd "${this.workspaceRoot}" && npm run deploy 2>&1`, description: "Run deploy" }]
		} else if (lower.includes("lint") || lower.includes("format")) {
			intent = "lint"
			commands = [{ command: `cd "${this.workspaceRoot}" && npm run lint 2>&1`, description: "Run linter" }]
		} else if (lower.includes("log") || lower.includes("check log")) {
			intent = "logs"
			commands = [{ command: `pm2 logs --lines 30 --nostream 2>&1`, description: "Fetch PM2 logs" }]
		} else if (lower.includes("status") || lower.includes("health")) {
			intent = "status"
			commands = [{ command: `pm2 list 2>&1`, description: "Check PM2 status" }]
		} else if (lower.includes("fix") || lower.includes("repair")) {
			intent = "fix"
			commands = [{ command: `cd "${this.workspaceRoot}" && npm install 2>&1`, description: "Reinstall dependencies" }]
		} else {
			// Generic fallback — run the query as a shell command
			commands = [{ command: nlQuery, description: "Execute command" }]
		}

		return {
			ok: true,
			intent,
			commands,
			plan: `Plan: ${commands.map((c) => c.description).join(", ")}`,
		}
	}

	async _execute(command) {
		if (!command) {
			return { ok: false, error: "No command provided" }
		}

		try {
			const { stdout, stderr } = await execAsync(command, {
				cwd: this.workspaceRoot,
				timeout: 30000,
				maxBuffer: 1024 * 1024,
			})
			return {
				ok: true,
				feedback: {
					status: stderr ? "warning" : "success",
					output: stdout || stderr,
					exitCode: 0,
				},
			}
		} catch (err) {
			return {
				ok: true,
				feedback: {
					status: "error",
					output: err.stderr || err.message,
					exitCode: err.code || 1,
				},
			}
		}
	}

	async _analyze(output) {
		if (!output) {
			return { ok: true, errors: [] }
		}

		const errors = []
		const errorPatterns = [
			/error:/gi,
			/failed/gi,
			/cannot find module/gi,
			/syntaxerror/gi,
			/referenceerror/gi,
			/typeerror/gi,
		]

		for (const pattern of errorPatterns) {
			const match = output.match(pattern)
			if (match) {
				errors.push({
					type: match[0].toLowerCase(),
					message: match[0],
					line: output.split("\n").findIndex((l) => pattern.test(l)) + 1,
				})
			}
		}

		return { ok: true, errors }
	}

	async _fix(output) {
		const fixes = []

		if (/cannot find module/i.test(output)) {
			fixes.push({ action: "npm install", description: "Install missing dependencies" })
		}
		if (/syntaxerror/i.test(output)) {
			fixes.push({ action: "check syntax", description: "Fix syntax errors in source files" })
		}
		if (/enoent/i.test(output)) {
			fixes.push({ action: "check paths", description: "Verify file paths exist" })
		}

		return { ok: true, fixes }
	}

	async _getContext() {
		try {
			const { stdout } = await execAsync("pm2 list 2>&1", { timeout: 5000 })
			return {
				ok: true,
				context: {
					workspace: this.workspaceRoot,
					pm2: stdout,
				},
			}
		} catch {
			return {
				ok: true,
				context: {
					workspace: this.workspaceRoot,
				},
			}
		}
	}
}

/**
 * Load the terminal-core runtime.
 *
 * Tries the installed @superroo/terminal-core package first (for monorepo
 * contexts where it's been built), then falls back to the self-contained
 * TerminalBrain defined above (for cloud CJS runtime).
 */
function loadTerminalCore() {
	try {
		return require("@superroo/terminal-core")
	} catch {
		return { TerminalBrain }
	}
}

module.exports = { loadTerminalCore, TerminalBrain }
